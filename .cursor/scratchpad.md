# VoiceOver Companion — Project Scratchpad

## Background and Motivation

Many sighted developers know they *should* test their UIs with a screen reader, but
the barrier to actually doing it is high: VoiceOver has a steep learning curve, its
announcements are hard to interpret if you don't use it daily, and it's difficult to
know whether a confusing announcement is "your bug" or "just how VoiceOver works."

**Scope (clarified 2026-06-19): WEB APPS, not native macOS apps.** The developer is
testing a **website / web app in a browser** (Chrome, Safari, etc.) with VoiceOver.
The Companion inspects the focused element *inside that web page*. Native macOS app
(SwiftUI/AppKit) inspection is explicitly out of scope.

**VoiceOver Companion** is a macOS Electron app that acts as a *live accessibility
co-pilot* while a developer drives their **web app in a browser** with VoiceOver. As
the developer moves focus around (with VoiceOver or the keyboard), the Companion:

1. Inspects the **currently focused element in the web page** via the macOS
   Accessibility (AX) APIs (which expose the browser's rendered accessibility tree).
2. Explains, in plain language, **what VoiceOver is likely to announce** for it and why.
3. Flags **potential accessibility issues** with that element (e.g. unlabeled control,
   missing alt text, wrong ARIA role).
4. **Teaches the relevant concept in context** (short, just-in-time HTML/ARIA tips).

**Primary goal:** reduce the barrier to *real* screen reader testing of the
developer's own web user journeys. This is NOT a generic accessibility training course
and NOT a prescriptive automated test runner. It observes what the developer is
already doing and makes it legible.

### Explicit non-goals (for now)
- **Not for native macOS apps** (SwiftUI/AppKit) — web content only.
- Not an automated WCAG audit / crawler.
- Not a replacement for VoiceOver itself.
- Not cross-platform (macOS + VoiceOver + browser only for v1).
- Not a curriculum / lesson-sequence app.

---

## Key Challenges and Analysis

### 1. Electron cannot call macOS Accessibility APIs directly
Electron runs on Node.js and cannot execute the C/Objective-C `AXUIElement` API
directly. We need a **native Node addon** (`.mm` Objective-C++ file) compiled against
Electron's headers with `electron-rebuild`, exposing a small JS surface.
*Confirmed via Electron docs + community examples.*

### 2. Reading the focused element
- Get the system-wide element: `AXUIElementCreateSystemWide()`.
- Read `kAXFocusedUIElementAttribute` to get the focused element.
- Read attributes that drive announcements: `AXRole`, `AXSubrole`,
  `AXRoleDescription`, `AXTitle`, `AXValue`, `AXDescription`, `AXHelp`,
  `AXLabel`/`AXTitleUIElement`, `AXEnabled`, `AXFocused`, `AXSelected`,
  `AXValueDescription`, `AXPlaceholderValue`, position/size, plus any
  `AXSelectedText` for text fields.

### 3. Live focus tracking (the hard part)
- Use `AXObserver` + `kAXFocusedUIElementChangedNotification` (and
  `kAXValueChangedNotification`, `kAXFocusedWindowChangedNotification`).
- AX notifications fire on a native run loop thread, so we must bridge to the JS
  world using **`Napi::ThreadSafeFunction`** (`BlockingCall`).
- Observers are per-PID, so when the frontmost app changes we must re-attach the
  observer to the newly focused application (`NSWorkspace` frontmost-app changes).
- Electron's main process already runs a Cocoa run loop, so `CFRunLoopAddSource`
  works without us spinning our own loop.

### 4. Inspecting web content in the browser (THE core path)
This is the whole product: the target is a **web page in a browser** (Chrome/Chromium
or Safari/WebKit). The browser maps the DOM + ARIA into the macOS AX tree, so the
focused web element shows up with attributes derived from HTML/ARIA (role, name,
value, etc.) — which is exactly what VoiceOver itself consumes.
- **Chromium (Chrome/Edge/Brave/Electron):** only exposes its full AX tree on demand.
  We must set the private attribute `AXManualAccessibility = true` (with
  `AXEnhancedUserInterface` fallback) on the *target* browser's AX element first, or
  focus inspection returns an empty/opaque tree. *Confirmed via Electron a11y docs.*
- **Safari/WebKit:** generally exposes its web AX tree once Accessibility permission
  is granted (it also responds to `AXEnhancedUserInterface`).
- We should detect which browser is frontmost (by bundle id) and apply the right
  unlock attribute. Recommend validating against **Chrome first** (most common).
- Note: AX attributes are an approximation of the DOM — we read the browser's
  computed accessibility tree, not the raw HTML. Good enough to explain VO behaviour
  and flag most issues, but we can't see source attributes the browser didn't expose.

### 5. The Companion window must NOT steal focus
If our window becomes the active app, it changes "the focused element" and breaks
the very thing we're observing. Mitigation:
- Create the panel with `type: 'panel'`, `alwaysOnTop`, `focusable: false`.
- Show it with `showInactive()`, never `show()`.
- Electron 28+ no longer calls `activateIgnoringOtherApps` for panels.
*Confirmed via Electron docs + issues #35815 / PR #41750.*

### 6. We can only *approximate* VoiceOver output (be honest about this)
VoiceOver's exact phrasing and announcement order are **not a public API**. We
derive a *plausible* announcement from AX attributes (role description + label +
value + state + position-in-set). The UI must frame this as "VoiceOver will likely
announce…" and never claim byte-for-byte accuracy. VoiceOver's review cursor can
also differ from keyboard focus — document this limitation.

### 7. Permissions & distribution
- App needs **Accessibility permission** (`AXIsProcessTrusted()`); we must detect
  the un-granted state and deep-link the user to System Settings.
- App must **not be sandboxed** (AX calls return nil under the sandbox).
- For the permission to persist and for distribution, the app must be
  **code-signed and notarized**. Unsigned dev builds work but re-prompt often.

### 8. Issue-detection scope (web/ARIA framed)
Reliable-from-AX heuristics (v1), all expressed in web terms: image/button/link/input
with **no accessible name** (missing `alt`/`aria-label`/label), focusable element with
no name, input with no associated `<label>`, empty heading, link whose text is a raw
URL, generic `div`/`group` acting as a control, disabled-but-focusable. **Contrast**
requires sampling pixels (screenshot + color math) and is deferred to a later phase.

---

## High-level Task Breakdown

> Executor: do ONE task at a time, verify the success criteria, then stop and ask
> the human to confirm before moving on. Keep changes minimal and contained.

### Phase 0 — Project skeleton & spike (prove the risky bits early)

**Task 0.1 — Electron + TypeScript skeleton**
- Scaffold an Electron app (main + preload + renderer) with TypeScript and a basic
  build script. Add `electron`, `electron-builder` (or `electron-forge`), and
  `node-addon-api` / `electron-rebuild` as dev deps.
- Success: `npm start` opens a blank window; `npm run build` produces a runnable app.

**Task 0.2 — Native addon "hello world"**
- Create a native addon (`binding.gyp` + `addon.mm`) that exports a trivial function
  (e.g. `isTrusted()` calling `AXIsProcessTrusted()`), built with `electron-rebuild`.
- Success: from the main process, calling `addon.isTrusted()` returns a boolean and
  logs it; app still launches.

**Task 0.3 — Accessibility permission flow**
- On launch, check `AXIsProcessTrusted()`. If false, show a screen explaining the
  permission and a button that opens
  `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`.
- Success: With permission off, app shows the prompt; after granting + relaunch, app
  proceeds to the main view.

**Task 0.4 — Read the focused element once (spike)**
- Add a native function `getFocusedElement()` that returns the focused element's core
  attributes (role, roleDescription, title, value, description, enabled, focused) as
  a JS object. Add a "Refresh" button in the UI to call it.
- Success: Focus a control inside a web page (e.g. a button/link in Safari), click
  Refresh, and see correct attribute values rendered in the Companion.

**Task 0.5 — Chromium web target spike (the critical de-risk)**
- Extend `getFocusedElement()` to detect the frontmost browser and set
  `AXManualAccessibility`/`AXEnhancedUserInterface` on its PID before reading.
- Success: Focusing an element **inside a web page in Chrome** returns meaningful
  role/label data (not an empty/opaque result).

> Milestone A: We can read the focused web element in both Chrome and Safari, behind
> the right permission. This de-risks the whole project.

### Phase 1 — Live tracking

**Task 1.1 — AXObserver live focus updates**
- Implement `AXObserver` for `kAXFocusedUIElementChangedNotification` on the frontmost
  app's PID, bridged to JS via `ThreadSafeFunction`; re-attach when the frontmost app
  changes (`NSWorkspace`).
- Success: Moving focus with the keyboard/VoiceOver in another app updates the
  Companion automatically (no Refresh button), within a fraction of a second.

**Task 1.2 — Non-focus-stealing panel window**
- Reconfigure the main window as `type: 'panel'`, `focusable: false`, `alwaysOnTop`,
  shown via `showInactive()`.
- Success: Interacting with the Companion (or showing it) does NOT change the focused
  element reported by the OS; the developer's app stays active.

> Milestone B: Hands-off live focus mirroring that doesn't interfere with testing.

### Phase 2 — "What VoiceOver will likely announce"

**Task 2.1 — Announcement synthesizer (pure function + tests)**
- Write a pure TS function `describeAnnouncement(element)` that composes a plausible
  VoiceOver utterance from AX attributes (name → role description → value → state →
  hints). TDD: cover button, link, text field, checkbox, heading, image, disabled.
- Success: Unit tests pass for the cases above; output reads like a believable VO
  utterance.

**Task 2.2 — Render announcement in UI**
- Show the synthesized announcement prominently, with a clear "approximation"
  disclaimer and an expandable "why" (which attributes produced it).
- Success: Live focusing elements shows a sensible announcement string + breakdown.

> Milestone C: Developer can see, in plain language, what VO will likely say.

### Phase 3 — Issue detection

**Task 3.1 — Heuristic issue rules (pure functions + tests)**
- Implement the v1 reliable-from-AX rules (see Challenge #8) as small, individually
  tested rule functions returning `{severity, message, learnMoreId}`.
- Success: Unit tests pass; e.g. a button with no name yields a "missing accessible
  name" issue.

**Task 3.2 — Surface issues in UI**
- Show detected issues for the focused element with severity styling.
- Success: Focusing a known-bad control (unlabeled icon button) shows the issue live.

> Milestone D: Live, contextual issue flags for the focused element.

### Phase 4 — Teach in context

**Task 4.1 — Concept knowledge base**
- A small content map keyed by role/issue → short explanation ("what this is", "why
  it matters", "how to fix in HTML/SwiftUI"). Keep it concise and contextual.
- Success: Each issue/role surfaced in the UI can show a relevant 2–4 sentence
  explanation on demand.

**Task 4.2 — Wire learn-more into UI**
- Issues and the announcement breakdown link to the matching concept entry.
- Success: Clicking "learn more" on an issue shows the relevant concept inline.

> Milestone E: Just-in-time teaching tied to what the developer is actually doing.

### Phase 5 — Polish & distribution (later)

**Task 5.1 — Packaging, signing, notarization** (success: installable signed `.app`
where Accessibility permission persists across launches).
**Task 5.2 — Onboarding & settings** (toggle live tracking, pin/unpin, opacity).
**Task 5.3 — (Stretch) contrast checks via screen sampling.**

---

## Project Status Board

- [x] 0.1 Electron + TypeScript skeleton (VERIFIED by human 2026-06-19)
- [x] 0.2 Native addon hello world (`AXIsProcessTrusted`) (VERIFIED by human 2026-06-19)
- [x] 0.3 Accessibility permission flow (VERIFIED by human 2026-06-19)
- [x] 0.4 Read focused element once (spike) (VERIFIED by human 2026-06-19)
- [x] 0.5 Web/Electron target spike (`AXManualAccessibility`) (VERIFIED by human 2026-06-19)
- [x] ✅ MILESTONE A reached — read focused web element in Chrome + Safari behind permission (2026-06-19)
- [x] 1.1 AXObserver live focus updates (VERIFIED by human 2026-06-19)
- [x] 1.2 Non-focus-stealing panel window (VERIFIED by human 2026-06-19)
- [x] ✅ MILESTONE B reached — hands-off live focus mirroring that doesn't interfere with testing (2026-06-19)
- [x] 2.1 Announcement synthesizer (+ tests) (awaiting human review)
- [x] 2.2 Render announcement in UI (awaiting human verification)
- [ ] 3.1 Heuristic issue rules (+ tests)
- [ ] 3.2 Surface issues in UI
- [ ] 4.1 Concept knowledge base
- [ ] 4.2 Wire learn-more into UI
- [ ] 5.1 Packaging / signing / notarization
- [ ] 5.2 Onboarding & settings
- [ ] 5.3 (Stretch) contrast checks

---

## Executor's Feedback or Assistance Requests

### Task 0.1 complete — awaiting human verification (2026-06-19)
- Scaffolded with the official `electron-forge` Vite + TypeScript template (matches
  locked decisions: plain TS + Vite, forge, local).
- Personalised app name → `voiceover-companion` / "VoiceOver Companion" in
  `package.json` and `index.html`; version set to `0.1.0`.
- Files of note: `src/main.ts` (creates the BrowserWindow), `src/preload.ts`,
  `src/renderer.ts`, `index.html`, `forge.config.ts`, `vite.*.config.ts`.
- **Verified by Executor:** Vite production bundles build cleanly; Electron binary
  installed; `npm start` runs past the point it previously failed with no errors.
- **Needs human check (I can't see the GUI):** run `npm start` and confirm a window
  titled "VoiceOver Companion" opens showing the heading text. DevTools opens by
  default (that's the template default; we can disable later).
- **Note on `npm run package`/`make`:** packaging needs network access to fetch
  native-dependency/Electron headers and timed out in this environment. The dev
  build (`npm start`) is the reliable path for now; full packaging is part of the
  deferred Phase 5.1, so this does not block Phase 0.

**Question for Planner/human:** Please confirm the window opens, then tell me to
proceed to Task 0.2 (native addon hello-world).

### Task 0.2 complete — awaiting human verification (2026-06-19)
- Added native N-API addon: `native/addon.mm` (exports `isTrusted()` calling
  `AXIsProcessTrusted()`) + `native/binding.gyp` (links `ApplicationServices` +
  `AppKit`, c++17).
- Added deps: `node-addon-api` (dep), `node-gyp` (devDep); npm script
  `build:native` builds against the installed Electron version's headers.
- Wired into `src/main.ts`: loads the addon via `createRequire` at runtime and logs
  `[a11y] AXIsProcessTrusted = <bool>` on app `ready`. Vite externalises `.node`
  (`vite.main.config.ts`) so the addon is never bundled. Added `native/build/` to
  `.gitignore`.
- **Verified by Executor:** `npm run build:native` compiles and links →
  `native/build/Release/addon.node` (55 KB). Loading that exact binary and calling
  `isTrusted()` returns a real boolean (`false`, expected — permission not yet
  granted). No lint errors.
- **Could NOT verify in this sandbox:** launching the full Electron GUI — the
  sandbox sets `ELECTRON_RUN_AS_NODE=1` and aborts the GUI runtime with `SIGABRT`.
  So `npm start` can't actually open a window *from inside the agent sandbox*. This
  affects Executor verification only; it should work in your normal Terminal.
- **Needs human check:** in a normal Terminal run `npm start`; the window should open
  and the terminal should print `[a11y] AXIsProcessTrusted = false` (it'll say
  `true` once you grant Accessibility permission in Task 0.3).

### Task 0.3 complete — awaiting human verification (2026-06-19)
- Main process (`src/main.ts`): added IPC handlers `a11y:isTrusted` (returns the
  addon's `isTrusted()`) and `a11y:openSettings` (deep-links to System Settings >
  Privacy & Security > Accessibility via `shell.openExternal`).
- Preload (`src/preload.ts`): exposes a sandboxed `window.companion` API
  (`isTrusted()`, `openAccessibilitySettings()`) via `contextBridge`.
- Types (`src/global.d.ts`): declares `window.companion`.
- UI (`index.html`, `src/renderer.ts`, `src/index.css`): three views —
  loading → permission-needed (with "Open Accessibility Settings" + "Re-check"
  buttons and step-by-step instructions) → granted/main view. On load it checks
  trust and shows the right view; "Re-check" re-queries.
- **Verified by Executor:** no lint/type errors across main/preload/renderer/types.
  (GUI can't run in the agent sandbox — see lessons — so functional toggling is for
  human verification.)
- **Needs human check (IMPORTANT — restart required):** main + preload changes don't
  hot-reload. In the terminal running `npm start`, type `rs` (or quit and re-run
  `npm start`). Then:
  1. With permission OFF you should see the "needs Accessibility permission" screen.
  2. Click "Open Accessibility Settings" → System Settings opens to the right pane.
  3. Enable the app (shows as "Electron" in dev), return, click "Re-check".
  4. The view should switch to "Accessibility permission granted." (If not, quit +
     relaunch — macOS sometimes only reflects the grant in a fresh process.)

### Task 0.4 complete — awaiting human verification (2026-06-19)
- Native (`native/addon.mm`): added `getFocusedElement()` — reads the system-wide
  `kAXFocusedUIElementAttribute` and returns role, subrole, roleDescription, title,
  value, description, help, enabled, focused (CF→JS string/bool/number conversion,
  graceful `{error}` when nothing is focused). Rebuilt OK; verified exports +
  returns an object in headless Node.
- Main: added IPC `a11y:getFocusedElement` and a **global shortcut ⌘⇧A** that reads
  the focused element and pushes it to the renderer (`a11y:focusedElement`).
- Preload: exposed `getFocusedElement()` + `onFocusedElement(cb)`. Types in
  `global.d.ts` (`FocusedElement`). UI renders the attributes as a definition list.
- **DEVIATION (flagged):** the plan said "Refresh button", but clicking inside our
  window steals focus, so a button alone would only read our own control. I added
  the ⌘⇧A global shortcut as the real capture path (button kept for reading our own
  window). The proper non-focus-stealing panel is still Task 1.2. Please confirm
  this approach is acceptable.
- **Verified by Executor:** rebuild + addon load + no lint errors. (GUI behaviour is
  for human verification — sandbox can't run the Electron GUI.)
- **Needs human check (restart required — Ctrl-C then `npm start`):**
  1. Focus a control in another app (Safari toolbar button, a TextEdit field, or a
     button/link on a web page) and press **⌘⇧A**. The Companion should show that
     element's role/title/value/etc.
  2. Try a native control first (most reliable). **Safari** web elements should also
     populate. **Chrome web page** elements may be sparse until Task 0.5 (which sets
     `AXManualAccessibility` to unlock Chromium's tree) — that's expected.

### Task 0.5 complete — awaiting human verification (2026-06-19)
- Native (`native/addon.mm`): in `getFocusedElement()` we now read the focused
  element's owning PID (`AXUIElementGetPid`), create the app element
  (`AXUIElementCreateApplication`), set `AXManualAccessibility` +
  `AXEnhancedUserInterface` to `true` (unlocks Chromium/WebKit web AX trees;
  harmless no-op on native apps), then re-fetch the focused element so the now-built
  web tree is read. Added owning `pid` to the output (debug aid).
- Types + UI updated to surface `pid`. Rebuilt addon OK; no lint errors.
- **Verified by Executor:** compiles/links/loads. Web behaviour is for human check.
- **Needs human check (restart required — Ctrl-C then `npm start`; the .node binary
  reloads only on a fresh launch):**
  1. Open a normal website in **Chrome**, click into a link/button/text field, press
     **⌘⇧A**. You should now get meaningful values (e.g. role `AXButton`/`AXLink`,
     a title/value) instead of the previous sparse/empty result.
  2. First capture right after Chrome launches can still be sparse while the tree
     builds — press **⌘⇧A** again and it should populate.
  3. Compare with Safari to confirm both browsers work.

**Fix during 0.5 testing (chicken-and-egg):** first attempt read the focused element
to get the pid, but Chrome exposes NO focused element until unlocked → always "No
focused element". Reworked to get the frontmost app via `NSWorkspace`
(`frontmostApplication`) and unlock THAT pid before querying. (Global shortcut
doesn't activate our app, so the frontmost app stays the one under test.) Rebuilt OK.
- **Re-test (restart — Ctrl-C then `npm start`):** in Chrome, focus a link/button,
  press ⌘⇧A; should now populate. First press after unlocking may still need a
  second ⌘⇧A while the tree builds.

> Milestone A (read focused web element in Chrome + Safari behind permission) reached
> pending this human verification. De-risks the core of the project.

### Task 1.1 complete — awaiting human verification (2026-06-19)
- Native (`native/addon.mm`): added `startFocusTracking(cb)` / `stopFocusTracking()`.
  Uses `AXObserver` on the frontmost app for `kAXFocusedUIElementChangedNotification`
  + `kAXFocusedWindowChangedNotification`, run-loop source added to the main
  `CFRunLoop`, results delivered to JS via `Napi::ThreadSafeFunction`
  (NonBlockingCall). Re-attaches on app switch via
  `NSWorkspaceDidActivateApplicationNotification`. Unlocks each app
  (`AXManualAccessibility`) on attach. Enabled ObjC ARC in `binding.gyp` to manage
  the workspace observer token.
- Main (`src/main.ts`): starts tracking on `ready` (pushes to renderer via
  `a11y:focusedElement`, the same channel the ⌘⇧A shortcut uses), stops on
  `will-quit`. UI copy updated: "updates live …".
- **Verified by Executor:** compiles/links/loads with all 4 exports; no lint errors.
- **Needs human check (restart — Ctrl-C then `npm start`):**
  1. With the Companion visible, switch to Chrome/Safari and Tab/arrow through
     controls — the Companion should update **automatically** (no ⌘⇧A) within a
     fraction of a second.
  2. Switch between apps (e.g. Chrome → TextEdit) — it should follow the new app's
     focus.
- **Known caveat (fixed by Task 1.2):** when YOU click the Companion window it
  becomes frontmost and will track *its own* focused element. The non-focus-stealing
  panel in 1.2 resolves this.

### Task 1.2 complete — awaiting human verification (2026-06-19)
- Main (`src/main.ts`, `createWindow`): window is now a floating non-activating panel
  — `type: 'panel'`, `focusable: false`, `alwaysOnTop: true` +
  `setAlwaysOnTop(true, 'floating')`, created with `show: false` and shown via
  `showInactive()` on `ready-to-show`. Removed the auto-open DevTools (it stole focus
  and opened a separate window). Window resized to a 420×640 panel.
- **Verified by Executor:** no lint errors. (Behaviour needs the GUI → human check.)
- **Needs human check (restart — Ctrl-C then `npm start`):**
  1. On launch the panel should appear floating on top WITHOUT stealing focus — the
     previously active app/menu bar stays active.
  2. Clicking the Companion panel should NOT make it the active app (the app under
     test stays frontmost) and live tracking should keep following the target — i.e.
     the 1.1 caveat (clicking the Companion showed its own element) should be GONE.
  3. The panel should stay above other windows while you test.
  - Note: DevTools no longer auto-opens. If you want the renderer console, we can add
    a toggle later. Permission-screen buttons still need to be clickable while the
    window is non-focusable — if they don't respond, flag it (mouse clicks should
    still work even though keyboard focus is disabled).

> Milestone B (hands-off live focus mirroring that doesn't interfere with testing)
> reached pending this human verification.

### Task 2.1 complete — awaiting human review (2026-06-19)
- Added Vitest (`npm test` → `vitest run`).
- `src/announce.ts`: pure `describeAnnouncement(element): { utterance, parts }`.
  Composes a plausible VoiceOver utterance in the order name → dimmed → role →
  value/state (+ help hint), with a `parts` breakdown recording the source attribute
  for each piece (for the 2.2 "why" panel). Handles button, link, text field/area,
  checkbox, radio, heading (with level), image (alt), static text, disabled, and
  no-name controls.
- `src/announce.test.ts`: 12 tests covering all the above. **All pass.** No lint
  errors. This task is fully Executor-verifiable (pure function, no GUI needed).
- **Approximation choices (for human review):** phrasing/order is our convention,
  not VoiceOver's real private output (e.g. "Submit, dimmed, button"; checkbox →
  "checked"/"unchecked"; heading → "heading level N"). Flag if you'd prefer
  different wording/order before 2.2 wires it into the UI.

### Task 2.2 complete — awaiting human verification (2026-06-19)
- `index.html` main view: prominent announcement card ("VoiceOver will likely
  announce" + big utterance), an approximation disclaimer, a collapsible "Why this
  announcement?" (parts → source attribute), and the raw attributes moved into a
  collapsible. Capture button relabelled "Capture now".
- `src/renderer.ts`: imports `describeAnnouncement`, renders the utterance + parts on
  every focus update (live). `src/index.css`: announcement card styling.
- **Verified by Executor:** tests still 12/12, no lint errors. Renderer-only change →
  Vite hot-reloads (no app restart needed).
- **Needs human check:** focus elements in Chrome/Safari and watch the panel show a
  sensible "VoiceOver will likely announce" line that updates live; expand "Why" to
  see the attribute breakdown; expand "Raw accessibility attributes" for the source.

> Milestone C (developer can see, in plain language, what VO will likely say) reached
> pending this human verification.

### ⚠️ Heads-up for Planner: dependency vulnerabilities
`npm audit` reports 30 vulns (26 high) — **all inside the electron-forge build
toolchain** (`@electron-forge/*`, `tar`, `tmp`, `cacache`, `@inquirer/*`). These are
dev/build-time only and not shipped in the app. The only remediation is
`npm audit fix --force`, which downgrades `@electron-forge/cli` to 7.6.1 (a breaking
change). I have NOT run it. Decision needed: leave as-is for now, or attempt the
forced downgrade? Recommend leaving as-is until packaging (Phase 5).

### Decisions made (locked 2026-06-19)
1. **Renderer stack:** Plain HTML/CSS/TS + Vite (no React).
2. **Packaging tool:** `electron-forge`.
3. **Distribution target:** Local-only unsigned dev build for now. Phase 5.1
   (signing/notarization) is deferred / optional until others need to install it.
4. **Teach content:** Short explanations + HTML/ARIA fix examples (web-focused).

---

## Lessons

- (project-specific) Electron/Chromium and other web targets only expose their AX
  tree when `AXManualAccessibility` (fallback `AXEnhancedUserInterface`) is set on the
  target app's AX element — must do this before reading focused web elements.
- (project-specific) Use `showInactive()` + `type: 'panel'` + `focusable: false` so
  the Companion never steals focus and corrupts the observed focused element.
- (project-specific) AX notifications arrive on a native run-loop thread; bridge to JS
  with `Napi::ThreadSafeFunction`, not a direct callback.
- (project-specific) AX requires Accessibility permission AND a non-sandboxed app; AX
  calls return nil under the sandbox even with permission granted.
- (project-specific) VoiceOver's exact output is not a public API — always present
  announcements as approximations.
- (env/tooling) `create-electron-app` refuses a non-empty dir; scaffold into a temp
  subfolder (`app_tmp`) then move everything up with zsh `mv app_tmp/*(D) .` (the
  `(D)` qualifier includes dotfiles). Shell here is zsh, so `shopt` is unavailable.
- (env/tooling) In this sandbox, Electron's binary postinstall download and
  `electron-forge package` need real network — run them with full network access.
  The Electron binary fetch is `node node_modules/electron/install.js`.
- (env/tooling) `ps`/`pgrep` are blocked by the sandbox ("sysmond service not
  found"); confirm long-running GUI launches via the terminal log file instead.
- (env/tooling) The agent sandbox sets `ELECTRON_RUN_AS_NODE=1` and the Electron GUI
  runtime aborts with `SIGABRT` inside it — you cannot open an Electron window from
  the agent here. Verify GUI behaviour in a real Terminal. To test native addons
  headlessly, load the compiled `.node` in plain Node (N-API is ABI-stable across
  Node/Electron) and call the exported function.
- (build) binding.gyp + project path with spaces: use `node-addon-api`'s
  `.include_dir` (unquoted) with single-eval `<!(...)`, NOT `.include` with `<!@(...)`
  — the latter splits on the space in "Learning Things" and breaks the include path.
- (build) Build the addon against Electron headers with
  `node-gyp rebuild --directory=native --target=<electron version>
  --dist-url=https://electronjs.org/headers`.
- (a11y permission, dev) `AXIsProcessTrusted()` is evaluated per-process and cached
  for that process's lifetime — after granting, you MUST fully relaunch (Ctrl-C +
  `npm start`); `rs`/"Re-check" in the same process keep returning false.
- (a11y permission, dev) When launched from Cursor's integrated terminal, macOS
  attributes the Accessibility grant to the PARENT app (Cursor), so **Cursor** also
  needs Accessibility permission for the dev Electron child to be trusted. Once the
  app is packaged (Phase 5) it's attributed to "VoiceOver Companion" directly.
- (a11y permission, dev) Just *checking* `AXIsProcessTrusted()` does not add the app
  to the Accessibility list; call `systemPreferences.isTrustedAccessibilityClient(true)`
  to prompt + register it. System Settings also doesn't refresh the list live — quit
  and reopen it to see new entries.
- (security) Current `npm audit` highs are all in the electron-forge build toolchain
  (dev-only). Fix requires `npm audit fix --force` (breaking). Deferred — ask before
  forcing.
