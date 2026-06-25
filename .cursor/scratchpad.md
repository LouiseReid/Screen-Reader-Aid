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

**Task 4.3 — VoiceOver driving guide / quick reference (ADDED 2026-06-19 by user request)**
- Rationale: a big part of "reducing the barrier to real screen reader testing" is
  knowing how to *operate* VoiceOver. Add a quick-reference of the common commands a
  developer needs while testing: turn VO on/off, the VO modifier, basic navigation,
  activating elements, the rotor, and jumping by headings/links/form controls/
  landmarks.
- Scope (v1): a STATIC, categorised cheat-sheet shown in its own section/view in the
  panel (so it doesn't clutter the live inspector). Content data lives in a small TS
  map so it's easy to extend. Accuracy of key combos must be verified.
- Success: A "VoiceOver keys" section is reachable from the panel and lists the
  common commands grouped by category, readable without leaving the app.
**Task 4.4 — Contextual "what to do next" hints (ADDED 2026-06-19 by user request)**
- Rationale: on top of the static cheat-sheet, the user wants a helper that looks at
  where VO focus currently is and tells the dev what to do next with THAT element.
- Scope: a pure function `suggestNextActions(element)` that maps the focused element's
  role/state to the most relevant next VoiceOver command(s) (e.g. button -> VO+Space
  to activate; heading -> VO+Command+H next heading; text field -> VO+Shift+Down to
  interact; group/web area -> VO+Shift+Down to step inside; disabled -> note it's
  dimmed). TDD with unit tests. Rendered as a "Try next" section in the Inspector
  view, updating live with focus.
- Success: focusing a button shows "VO+Space to activate"; focusing a heading shows
  heading-jump hints; the list changes sensibly as focus moves.

> Milestone E: Just-in-time teaching tied to what the developer is actually doing,
> plus a quick reference for driving VoiceOver itself.

### Phase 5 — Polish & distribution

> Re-planned 2026-06-23 with execution order **5.2 → 5.1 → 5.3** (per user). 5.2 ships
> the most user-facing value and doesn't require an Apple Developer account; 5.1 needs
> credentials/decisions from the human; 5.3 is a stretch and needs a second OS
> permission, so it sits last.

#### Phase 5.0 — Pre-bundling UX feedback (added 2026-06-25, do FIRST)

> User testing surfaced three UX issues to fix BEFORE bundling (5.1). All three are
> small and independent. Execute one at a time with human verification, as usual.

**Task UX.1 — Remove the "Capture now" button**
- Rationale (user): the in-window "Capture now" button is unclear, unlikely to be
  used, and wastes panel real estate.
- Change: remove the `#capture` button + its `.actions` wrapper from `index.html`;
  remove the `captureButton` lookup + click listener from `src/renderer.ts`.
- KEEP: the global `⌘⇧A` capture shortcut in `main.ts` (it's free, non-focus-stealing,
  and a real capture path). Keep a short hint mentioning it (trim wording).
  Decision flagged to human: keep shortcut+hint vs remove hint too.
- Locate: `index.html` lines ~81–85 (button), ~53–56 (hint); `src/renderer.ts`
  lines ~21, ~294–296. `getFocusedElement` IPC/preload stay (shortcut still uses it).
- Success: panel no longer shows the button; live tracking + ⌘⇧A still work; no dead
  references; `npm test` green; no lint errors.

**Task UX.2 — Tighten the announcement ("drop likely" + closer to actual)**
- Rationale (user): "VoiceOver will likely announce" should read closer to what is
  actually announced, and drop the word "likely".
- UI copy (`index.html`):
  - Label: "VoiceOver will likely announce" → "VoiceOver announces".
  - Disclaimer: reword from "Approximation … not VoiceOver's exact wording." to a
    lighter-but-honest line, e.g. "Wording can vary by VoiceOver version and system
    language." **Honesty constraint retained** (Challenge #6 forbids claiming exact
    output) — flagged to human; we drop "likely" but keep a brief caveat.
- Synthesizer accuracy (`src/announce.ts`) — research-backed (tetralogical VO-mac
  HTML support + Apple docs):
  - Fallback ROLE_WORDS: `AXTextField`/`AXTextArea` → **"edit text"** (VO on Mac
    says "edit text", not "text field"). Only affects the fallback used when
    `AXRoleDescription` is absent (we still prefer the real roleDescription, which is
    what VO actually speaks).
  - Empty edit text: when role is text field/area and there is no value, append
    **"blank"** (VO says "edit text, blank"). Flag for VO verification.
  - Keep name-first order (confirmed correct for buttons/links/fields/headings).
  - **NEEDS REAL-VO VERIFICATION (human has VO+Safari):** checkbox/radio state-vs-role
    order. Research suggests state may precede role for checkboxes on Mac; current
    code emits role then state. Leave as-is in code, list as a question; tune only if
    the human confirms the real order.
- Tests: update `src/announce.test.ts` expectations for "edit text"/"blank"; keep all
  green.
- Success: label reads "VoiceOver announces" with no "likely"; text fields announce
  "edit text"; `npm test` green; human confirms the live output reads believably in
  Safari.

**Task UX.3 — Warning banner for non-Safari browsers**
- Rationale (user): VoiceOver is best used with Safari; when the app under test is a
  non-Safari browser, show a warning banner recommending Safari.
- Native (`native/addon.mm`): expose the frontmost/owning app's **bundle identifier**
  (and localized name) so the renderer can identify the browser.
  - `getFocusedElement`: we already have `frontPid`; add `bundleId`/`appName` from the
    `NSRunningApplication` we already fetch.
  - Live tracking: add `bundleId`/`appName` to `FocusedData` (look up
    `NSRunningApplication runningApplicationWithProcessIdentifier:data.pid`), set in
    `ReadElement`/`BuildObject`, so every pushed focus carries the active app id.
  - Requires `npm run build:native` + full app restart (human step).
- Pure helper (`src/browser.ts` + tests): `classifyApp(bundleId): { isBrowser,
  isSafari, name }` (or `browserWarning(bundleId): string | null`). Known browsers:
  Safari (`com.apple.Safari`, `com.apple.SafariTechnologyPreview`), Chrome
  (`com.google.Chrome*`), Edge (`com.microsoft.edgemac`), Brave (`com.brave.Browser`),
  Arc (`company.thebrowser.Browser`), Firefox (`org.mozilla.firefox`), Opera, Vivaldi.
  Non-browsers and unknown bundle ids → no warning (null).
- Types (`src/global.d.ts`): add `bundleId?`, `appName?` to `FocusedElement`.
- UI (`index.html` + `src/renderer.ts` + `src/index.css`): a live banner at the top of
  the inspector panel; shows when `isBrowser && !isSafari`, hides for Safari /
  non-browsers / unknown. Auto show/hide on focus change (not dismissible) so it always
  reflects the current target. Copy e.g. "You're testing in <Browser>. VoiceOver is
  designed for Safari — results are most accurate there."
- Success: focusing web content in Chrome/Edge/etc. shows the banner naming the
  browser; focusing in Safari hides it; focusing a non-browser app shows nothing;
  unit tests for `classifyApp` pass; `npm test` green.

> Milestone E.1 (Phase 5.0 done): cleaner panel, more accurate/less-hedged
> announcement, and a Safari-recommendation banner — ready to bundle.

#### Phase 5.2 — Onboarding & settings (PRIORITY — execute next)

Original brief: "toggle live tracking, pin/unpin, opacity". The app today has no
settings infrastructure at all, so the work splits into a tiny foundation + each
toggle + a first-run onboarding flow. Sub-tasks are intentionally small and each one
should be reviewed by the human before moving on.

**Task 5.2.1 — Settings persistence layer (foundation, no UI)**
- Add `electron-store` (de-facto Electron choice, JSON in `app.getPath('userData')`).
- Define a `Settings` type with sensible defaults:
  `{ liveTracking: true, pinned: true, opacity: 1, captureShortcut: 'CommandOrControl+Shift+A', hasOnboarded: false }`.
- Main process: `settings:get` / `settings:set` IPC handlers.
- Preload: expose `window.companion.settings.{get(), set(partial), onChange(cb)}`.
- Types in `src/global.d.ts`.
- Success criteria:
  - `npm test` still green; add a small unit test for the default-merging helper
    (pure function, no Electron needed).
  - Manual: from the renderer console (after wiring a temporary call), `await
    window.companion.settings.get()` returns the defaults on first run, and a
    `set({ opacity: 0.8 })` value survives an app restart.

**Task 5.2.2 — Wire each setting into runtime behaviour (no UI yet)**
- `liveTracking`: when toggled false, call existing native `stopFocusTracking()`;
  when true, `startFocusTracking()`. `⌘⇧A` shortcut keeps working either way.
- `pinned`: `mainWindow.setAlwaysOnTop(value, 'floating')`.
- `opacity`: clamp 0.3–1.0, `mainWindow.setOpacity(value)`.
- `captureShortcut`: on change, `globalShortcut.unregister(old)` then `register(new)`;
  validate via `globalShortcut.isRegistered()` and revert if it fails.
- Apply current settings on startup (after window create + tracker start).
- Success criteria:
  - With temporary IPC calls from devtools (or a debug button), each setting visibly
    changes behaviour at runtime.
  - Toggling `liveTracking` off then on does NOT crash or leak observers (re-attach
    works — already proven in 1.1).

**Task 5.2.3 — Settings UI (third tab)**
- Add a third tab "Settings" to the existing tab bar (sits next to Inspector /
  VoiceOver keys — keeps the panel compact, no separate window).
- Controls:
  - Live tracking — checkbox
  - Always on top (pin) — checkbox
  - Opacity — range slider 30–100% with live preview
  - Capture shortcut — read-only display of the current combo (v1; capture/edit can
    be a follow-up if we want it)
  - "Reset to defaults" button
- All controls keyboard-accessible and labelled (we're an a11y app — must walk the
  walk).
- Success criteria:
  - Changes in the UI apply immediately and persist across restart.
  - Tabbing through the settings tab reads sensible labels in VoiceOver (manual
    human check).

**Task 5.2.4 — First-run onboarding**
- Triggered when `settings.hasOnboarded === false`. Lightweight 3-step flow inside
  the existing window (NOT a separate window):
  1. **Welcome** — one paragraph: what this is (live AX co-pilot for web + VO),
     scope (web apps, not native), the "approximation" caveat.
  2. **Permission** — reuses the existing permission view's content/buttons.
  3. **How to use** — capture shortcut, the 3 tabs, that focus updates live.
- "Get started" on step 3 sets `hasOnboarded = true` and shows the inspector.
- Success criteria:
  - Wiping `userData` or setting `hasOnboarded=false` triggers the flow on next
    launch; clicking through ends at the inspector.
  - Subsequent launches go straight to the inspector (or the permission view if
    permission is still missing).

**Task 5.2.5 — "Help" entry to re-open onboarding**
- Tiny `?` button in the panel header → re-runs the onboarding flow (sets
  `hasOnboarded=false` for that session, navigates to step 1; on completion, sets
  back to true).
- Success: clicking `?` re-shows the onboarding at any time.

> Milestone F (Phase 5.2 done): users can customise the panel (live tracking,
> alwaysOnTop, opacity), settings persist, and first-time users get a short guided
> intro.

#### Phase 5.1 — Packaging, signing, notarization

Path selection up front, then small sub-tasks. **Default plan = Path C** (Developer
ID signed + notarized). If no Apple Developer account is available, Path B (ad-hoc
local signing) reuses the same sub-tasks with different credentials — just no
notarization step and no Gatekeeper-clean distribution.

**Task 5.1.0 — Decide path + collect credentials (PLANNER GATE — human input)**
- Confirm Path B vs Path C. If C: Apple Developer Team ID, Developer ID Application
  certificate installed in Keychain, app-specific password for `notarytool`, Apple
  ID email.
- Decide bundle identifier (proposal: `com.louisereid.voiceovercompanion`), product
  name (proposal: "VoiceOver Companion"), distribution artefact (proposal: DMG +
  ZIP), architectures (proposal: arm64 + x64 universal).
- Success: a short decision block recorded in the scratchpad before any 5.1.x work
  starts.

**Task 5.1.1 — App identity polish**
- Set `productName`, `appBundleId`, `appCategoryType` in `forge.config.ts`.
- Add an `.icns` icon under `build/icon.icns` (placeholder generated from text logo
  is fine for v1).
- Success: `Electron.app` resource shows the right name/icon in Finder/Dock after
  `npm run package`.

**Task 5.1.2 — Configure forge makers + osxSign / osxNotarize**
- Add `@electron-forge/maker-dmg` (already have ZIP from the template).
- `osxSign` config: identity from `process.env.APPLE_IDENTITY` (or auto-detect on
  Path B/ad-hoc).
- `osxNotarize` config (Path C only): `tool: 'notarytool'` with `appleId`,
  `appleIdPassword`, `teamId` from env. Path B: omit notarize entirely.
- `.env.example` committed; real `.env` gitignored.
- Success: `npm run make` produces `out/make/...dmg` (and `.zip`); for Path C, the
  output is also notarized + stapled.

**Task 5.1.3 — Verify nested binaries are signed**
- The native `.node` addon must be signed too. electron-forge + `@electron/osx-sign`
  do this with deep signing by default; verify with
  `codesign --verify --deep --strict --verbose=2 out/.../VoiceOver\ Companion.app`.
- Success: command exits 0; `spctl -a -t exec -vv` (Path C) reports
  "accepted source=Notarized Developer ID".

**Task 5.1.4 — Accessibility-grant persistence test**
- Install signed `.app` to `/Applications`, launch, grant Accessibility once, kill,
  re-launch — grant should persist. Then rebuild + reinstall same version — grant
  should still persist (same bundle id + same signature → same identity to TCC).
- Success: AXIsProcessTrusted logs `true` after the rebuild without re-granting.

**Task 5.1.5 — Audit / dependency cleanup (revisit deferred work)**
- Revisit the deferred `npm audit` issue (electron-forge toolchain highs). Now that
  we're actually shipping, decide: tolerate (dev-only deps), forced downgrade, or
  upgrade path. Document decision.
- Success: documented decision + (if any) the chosen remediation applied without
  breaking `npm run make`.

> Milestone G (Phase 5.1 done): a `.dmg` you can hand to another macOS user,
> Accessibility grant persists across rebuilds, dependency hygiene reviewed.

#### Phase 5.3 — Contrast checks (stretch)

**Task 5.3.1 — Screen Recording permission flow**
- New native helpers: `screenRecordingTrusted()` (`CGPreflightScreenCaptureAccess`)
  and `requestScreenRecording()` (`CGRequestScreenCaptureAccess`). New permission
  view in renderer (parallel to Accessibility permission view).
- Success: with permission off, the contrast feature shows a permission prompt; with
  it on, the contrast UI activates.

**Task 5.3.2 — Native region screenshot**
- `captureElementRegion(x, y, w, h) → PNG Buffer` using `CGWindowListCreateImage` at
  the focused element's reported AX bounds.
- Success: returns a non-empty buffer; written to a temp `.png` it visually matches
  the focused element area.

**Task 5.3.3 — Color sampling + WCAG contrast (pure TS, TDD)**
- `analyzeContrast(pngBuffer) → { fg, bg, ratio, passes: { AA, AAA, AAlarge } }`.
  v1 simplified: dominant background = most-common edge color; foreground = most
  contrasting cluster vs background. Use standard WCAG luminance formula.
- TDD with small fixture PNGs (black-on-white, mid-grey-on-white, etc.).
- Success: unit tests pass on the fixtures; ratios match a manual calculator within
  ±0.1.

**Task 5.3.4 — Surface contrast in the Inspector**
- For elements with valid bounds (skip when missing), show a "Contrast" row with
  the ratio + AA/AAA badge. Hidden / N/A otherwise.
- Success: focusing a text element shows a sensible ratio + pass/fail that updates
  live with focus.

> Milestone H (Phase 5.3 done, stretch): contrast feedback on the focused element.

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
- [x] 2.2 Render announcement in UI (VERIFIED by human 2026-06-19)
- [x] ✅ MILESTONE C reached — developer can see, in plain language, what VO will likely say (2026-06-19)
- [x] 3.1 Heuristic issue rules (+ tests) (awaiting human review)
- [x] 3.2 Surface issues in UI (VERIFIED by human 2026-06-19)
- [x] ✅ MILESTONE D reached — live, contextual issue flags for the focused element (2026-06-19)
- [x] 4.1 Concept knowledge base (VERIFIED by human 2026-06-23)
- [x] 4.2 Wire learn-more into UI (VERIFIED by human 2026-06-23)
- [x] 4.3 VoiceOver driving guide / quick reference (VERIFIED by human 2026-06-19)
- [x] 4.4 Contextual "what to do next" hints (VERIFIED by human 2026-06-19)
- [x] **5.0 Pre-bundling UX feedback (added 2026-06-25)**
  - [x] UX.1 Remove "Capture now" button (VERIFIED by human 2026-06-25)
  - [x] UX.2 Tighten announcement (drop "likely" + "edit text"/"blank" accuracy) (VERIFIED by human 2026-06-25 — "blank" + checkbox order confirmed correct against real VoiceOver)
  - [x] UX.3 Non-Safari browser warning banner (native bundleId + classifier + UI) (VERIFIED by human 2026-06-25)
  - [x] ✅ MILESTONE E.1 reached — cleaner panel, less-hedged/more-accurate announcement, Safari-recommendation banner (2026-06-25)
- [ ] **5.2 Onboarding & settings (PRIORITY — in progress)**
  - [x] 5.2.1 Settings persistence layer (DIY JSON + IPC + preload + types) — awaiting human verification (2026-06-23)
  - [ ] 5.2.2 Wire settings into runtime behaviour (tracking / pin / opacity / shortcut)
  - [ ] 5.2.3 Settings UI (third tab)
  - [ ] 5.2.4 First-run onboarding (3-step in-window flow)
  - [ ] 5.2.5 "Help" entry to re-open onboarding
- [ ] 5.1 Packaging / signing / notarization
  - [x] 5.1.0 Decide path — **Path C** chosen; bundle id/name/arch locked; cert NOT yet present (2026-06-25)
  - [x] 5.1.1 App identity polish (bundleId + category + icon) — launch verified; icon awaiting visual check (2026-06-25)
  - [x] 5.1.1b Ship native addon in packaged app (extraResource + require-path) — awaiting human launch test (2026-06-25)
  - [ ] 5.1.2 Configure forge makers (darwin + DMG) + osxSign / osxNotarize — NEEDS cert + creds
  - [ ] 5.1.3 Verify nested binaries are signed (native .node) — NEEDS cert
  - [ ] 5.1.4 Accessibility-grant persistence test across rebuild — NEEDS signed build
  - [ ] 5.1.5 Audit / dependency cleanup decision
- [ ] 5.3 (Stretch) contrast checks
  - [ ] 5.3.1 Screen Recording permission flow
  - [ ] 5.3.2 Native region screenshot (CGWindowListCreateImage)
  - [ ] 5.3.3 Color sampling + WCAG contrast (pure TS, TDD)
  - [ ] 5.3.4 Surface contrast in Inspector

---

## Executor's Feedback or Assistance Requests

### Task 5.1.1 icon complete — awaiting human visual check (2026-06-25)
- User explicitly asked for an app icon → generated one (allowed: explicit request).
- Concept: blue→indigo squircle with a white VoiceOver-style focus ring + voice waves.
- The generated raw image was 1536×1024 with NO alpha (near-white background), so it
  was processed with Pillow into a proper macOS icon:
  - cropped tight to the squircle bbox `(302,41,1234,972)`, padded square,
  - applied a supersampled rounded-rectangle alpha mask (transparent corners),
  - scaled to 824px and centered on a 1024 transparent canvas (~100px macOS margin),
  - built `build/icon.icns` via `iconutil` from a full 16→1024 iconset (incl. @2x).
- Files added (tracked — `build/icon.*` is NOT gitignored; only `build/Release` +
  `native/build/` are): `build/icon.png` (1024 processed source) + `build/icon.icns`.
- `forge.config.ts`: `packagerConfig.icon = './build/icon'`.
- Re-packaged: app now has `Contents/Resources/electron.icns` (1024) +
  `CFBundleIconFile = electron.icns`.
- Tooling notes (Lessons-worthy): no ImageMagick/Pillow preinstalled — installed
  Pillow via pip (network); `iconutil` fails with "Invalid Iconset" **inside the agent
  sandbox** (needs a system service) — run it with full/all permissions.
- **Needs human visual check:** open the new build at
  `out/VoiceOver Companion-darwin-arm64/VoiceOver Companion.app` (right-click → Open)
  and confirm the icon looks right in Finder/Dock. (Dev `npm start` still shows the
  default Electron dock icon — only the packaged app uses ours.)

### Tasks 5.1.1 + 5.1.1b complete — awaiting human verification (2026-06-25)
**Scope:** credential-free packaging work — app identity + make the native addon ship
in a packaged build. No signing (deferred until Developer ID cert exists).

**Files changed:**
- `forge.config.ts` — `packagerConfig` now sets `appBundleId`
  (`com.louisereid.voiceovercompanion`), `appCategoryType`
  (`public.app-category.developer-tools`), and `extraResource:
  ['./native/build/Release/addon.node']` so the custom addon is copied into the app's
  `Contents/Resources/`. (Product name already came from `package.json` productName.)
- `src/main.ts` — addon require path is now conditional: `app.isPackaged` →
  `path.join(process.resourcesPath, 'addon.node')`; dev → existing
  `app.getAppPath()/native/build/Release/addon.node`.

**Verified by Executor (`npm run package`, arm64):**
- Build succeeded → `out/VoiceOver Companion-darwin-arm64/VoiceOver Companion.app`.
- `Info.plist`: CFBundleIdentifier `com.louisereid.voiceovercompanion`, CFBundleName
  `VoiceOver Companion`, LSApplicationCategoryType `public.app-category.developer-tools`.
- Executable is Mach-O arm64.
- `Contents/Resources/addon.node` present (84 KB, executable) → addon ships correctly.
- `out/` is gitignored (line 92).

**COULD NOT verify in sandbox (needs human — sandbox can't launch the Electron GUI):**
that the PACKAGED app actually launches and loads the addon. Please:
1. Open `out/VoiceOver Companion-darwin-arm64/VoiceOver Companion.app`. It's UNSIGNED
   (ad-hoc), so Gatekeeper will block a double-click — **right-click → Open** the first
   time (or `xattr -dr com.apple.quarantine "…/VoiceOver Companion.app"`).
2. It will appear as a NEW app identity to macOS, so grant **Accessibility** permission
   to "VoiceOver Companion" (not Electron/Cursor) in System Settings, then relaunch.
3. Confirm live focus tracking + announcements work in the packaged app (this proves
   the addon loaded from Resources).
- Caveat: Fuses (`OnlyLoadAppFromAsar`, asar integrity) are on; addon loading from
  Resources should be unaffected, but the launch test is the real proof.

**STILL PENDING (flagged, not done this turn):**
- App **icon** (`.icns`) — deferred. I won't auto-generate an image without you asking;
  tell me if you want a placeholder icon generated or you'll supply one.
- Signing/notarization (5.1.2–5.1.4) — blocked on the Developer ID cert.

### Task 5.1.0 — bundling decision recorded + gate findings (2026-06-25)

**DECISION (locked with human 2026-06-25):**
- **Signing path: C** — Developer ID Application + notarization (shippable to other
  Macs without Gatekeeper warnings).
- **Bundle identifier:** `com.louisereid.voiceovercompanion`
- **Product name:** `VoiceOver Companion`
- **Architecture:** **arm64 only** (Apple Silicon). NOTE/assumption flagged: this
  means the notarized build runs on Apple-Silicon Macs only, not Intel. Accepted by
  human.
- **Artefacts:** DMG (primary) + ZIP.

**GATE FINDINGS (block full Path C execution — surfaced to human):**
1. `security find-identity -v -p codesigning` → **0 valid identities**. There is NO
   "Developer ID Application" certificate in the Keychain yet, so signing +
   notarization (Tasks 5.1.2+) cannot run until the human:
   - has an active Apple Developer Program membership ($99/yr), and
   - installs a **Developer ID Application** certificate into the login Keychain, and
   - provides (later, via a GITIGNORED `.env`, never chat/commit): Apple **Team ID**,
     Apple ID **email**, and an **app-specific password** for `notarytool`.
2. Current `forge.config.ts` is not macOS-ready for this app:
   - Ships Windows (`MakerSquirrel`) + Linux (`MakerDeb`/`MakerRpm`) makers — should be
     scoped to darwin; add `@electron-forge/maker-dmg`.
   - `packagerConfig.asar: true` but our custom native addon lives at
     `native/build/Release/addon.node` and is loaded via
     `app.getAppPath()` — it will NOT be inside the asar / found at runtime in a
     packaged build. **Prerequisite for ANY runnable bundle (B or C):** ship the
     addon via `extraResource` (or relocate) and update the runtime require path.

**PLANNER NOTE — re-sequencing proposal:** Tasks 5.1.1 (app identity polish) and a new
prerequisite (native-addon packaging) are **credential-free** and can proceed now
while the human sorts the Apple Developer cert. Signing/notarization (5.1.2–5.1.4)
waits for the cert. Proposed new task inserted: **5.1.1b — ship native addon in
packaged app** (extraResource + require-path fix), done before signing.

### Task UX.3 complete — awaiting human verification (2026-06-25)
**Scope:** warn when the app under test is a non-Safari browser. Native bundle-id
exposure + pure classifier + UI banner.

**Files changed:**
- `native/addon.mm` — exposes the active app's **bundle identifier** + localized
  **name** on both capture paths:
  - `getFocusedElement` (⌘⇧A): reads `bundleIdentifier`/`localizedName` from the
    frontmost `NSRunningApplication`; set early so even the "no focused element" result
    carries them.
  - Live tracking: added `bundleId`/`appName` to `FocusedData`, looked up via
    `runningApplicationWithProcessIdentifier:` for the focused element's pid (wrapped
    in `@autoreleasepool`), emitted in `BuildObject`.
  - **Rebuilt: `npm run build:native` → addon.node OK.**
- `src/browser.ts` (new) — pure `classifyApp(bundleId): { isBrowser, isSafari, name }`.
  Known families (exact id or `${id}.` prefix for channel variants): Safari (+ Tech
  Preview, isSafari=true), Chrome, Chromium, Edge, Brave, Arc, Firefox (+ Dev/Nightly),
  Opera (+ GX), Vivaldi, DuckDuckGo. Unknown / native / empty → not-a-browser.
- `src/browser.test.ts` (new) — 10 tests (Safari, Chrome + variants, Edge variant,
  other browsers, the firefox-vs-firefoxdeveloperedition prefix guard, native apps,
  null/undefined/empty, whitespace trim).
- `src/global.d.ts` — `FocusedElement` gains `bundleId?`, `appName?`.
- `index.html` — `#browser-banner` (`role="status"`, hidden) at the top of the
  inspector panel.
- `src/renderer.ts` — `renderBrowserBanner()` runs `classifyApp(data.bundleId)` on
  every focus update; shows the banner only when `isBrowser && !isSafari`, otherwise
  hides it. Also added `appName`/`bundleId` to the raw-attributes list (debug aid).
- `src/index.css` — `.browser-banner` (warning-amber palette, matches issues styling).

**Verified by Executor:** `npm test` → 66 passed (was 56); native rebuild OK; no lint
errors.

**Needs human check (restart REQUIRED — native `.node` reloads only on a fresh launch:
Ctrl-C then `npm start`):**
1. Focus web content in **Chrome** (or Edge/Brave/etc.) → amber banner appears naming
   the browser ("You're testing in Google Chrome. VoiceOver is designed for Safari…").
2. Switch to **Safari** and focus web content → banner disappears.
3. Focus a **native app** (e.g. TextEdit) → no banner.
4. (Optional) expand "Raw accessibility attributes" to confirm `App` / `Bundle ID`
   populate (useful if the banner ever misbehaves).

### Task UX.2 complete — awaiting human verification (2026-06-25)
**Scope (held to):** announcement wording + targeted accuracy. Pure function + UI copy.

**Files changed:**
- `index.html` — announcement label "VoiceOver will likely announce" → **"VoiceOver
  announces"** (dropped "likely"); disclaimer reworded to **"Wording can vary by
  VoiceOver version and system language."** (kept a brief honest caveat per Challenge
  #6 — we never claim byte-for-byte output).
- `src/announce.ts`:
  - New `VO_ROLE_WORDS` override map that takes precedence over `AXRoleDescription`
    for roles where VoiceOver diverges from the system role description. Currently
    `AXTextField`/`AXTextArea` → **"edit text"** (Safari reports AXRoleDescription
    "text field", but VoiceOver actually says "edit text" — confirmed via tetralogical
    VO-mac HTML support reference). Also updated the fallback `ROLE_WORDS` to "edit
    text" for consistency.
  - Empty editable field now appends **"blank"** (e.g. "Email, edit text, blank").
  - Role-word source label in the "why" panel reads `role (VoiceOver)` when the
    override is used.
  - Top-of-file doc comment dehedged (dropped "likely").
- `src/announce.test.ts` — updated the text-field expectation to "edit text"; added
  empty-field ("…, blank") and text-area cases.

**Verified by Executor:** `npm test` → 56 passed (was 54); no lint errors. Renderer +
pure-function change → Vite hot-reloads (no app restart needed).

**NEEDS REAL-VO VERIFICATION (you have VO + Safari, I can't run the GUI):**
1. **"blank" for empty fields** — confirm VoiceOver actually says "blank" on an empty
   text input in Safari. I'm high-confidence on "edit text" but only medium on
   "blank" / its exact placement. If VO doesn't say it (or says it elsewhere), tell me
   and I'll remove/adjust — it's an isolated 3-line block.
2. **Checkbox / radio order** (left UNCHANGED, flagged in plan): current output is
   "name, checkbox, checked" (role then state). Some references suggest VoiceOver on
   Mac may say state before role. Please listen to a real checkbox in Safari and tell
   me the order you hear; I'll tune only if it's wrong.
3. General gut-check: focus a few real controls in Safari (button, link, empty +
   filled text field, heading, image) and confirm the "VoiceOver announces" line reads
   like what you actually hear.

### Task UX.1 complete — awaiting human verification (2026-06-25)
**Scope (held to):** remove the in-window "Capture now" button + its hint. No logic
changes; renderer/HTML only.

**Files changed:**
- `index.html` — removed the `.actions` wrapper + `#capture` button from the inspector
  panel; trimmed the hint to drop the "Press ⌘⇧A to capture on demand" sentence
  (kept the "Updates live as you move focus…" orientation line).
- `src/renderer.ts` — removed the `captureButton` lookup and its click listener.

**Decision flagged (kept minimal, did NOT over-reach):**
- I KEPT the `⌘⇧A` global shortcut in `main.ts` (and its `getFocusedElement`
  IPC/preload/native plumbing). It takes no screen real estate, so it doesn't conflict
  with the user's complaint. Removing it would cascade into deleting the
  `getFocusedElement` handler, the preload method, the `global.d.ts` type, and the
  native export — out of scope for a "remove the button" task.
- **Minor downside to be aware of:** the shortcut globally intercepts ⌘⇧A from every
  app while the Companion runs (it's now undocumented in the UI). If you'd rather I
  remove the shortcut entirely (and its now-unused capture plumbing), say so and I'll
  do it as a small follow-up.

**Verified by Executor:** `npm test` → 54 passed; no lint errors. Renderer-only →
Vite hot-reloads (no app restart needed).

**Needs human check:** confirm the "Capture now" button is gone from the Inspector and
the panel still shows live announcement / Try next / issues as focus moves.

### Task 5.2.1 complete — awaiting human verification (2026-06-23)
**Scope (held to):** persistence layer + IPC + preload + types only. NO UI, NO runtime
behaviour wired to settings yet (that's 5.2.2). Existing app behaviour unchanged.

**Planner-gate hit + resolved:** `electron-store` (the planned dep) is 403 Forbidden
on the Skyscanner Artifactory mirror. Human chose **DIY persistence** instead. Done
in ~120 lines, zero new deps.

**Files changed:**
- `src/settings.ts` (new) — `Settings` type, `DEFAULT_SETTINGS`, pure
  `mergeSettings()` (type-safe, opacity clamped to 0.3–1, shortcut trimmed/non-empty,
  unknown fields stripped), and `SettingsStore` class (`load`/`get`/`set`/`subscribe`,
  serialized writes via a queued tmp-file-then-rename for atomicity).
- `src/settings.test.ts` (new) — 11 tests for `mergeSettings` (defaults, partial,
  type-rejection per field, opacity clamping, shortcut trim, unknown-field drop,
  custom-defaults override).
- `src/global.d.ts` — re-exports `Settings` from `src/settings.ts` as an ambient type
  (single source of truth, no drift), adds `CompanionSettingsApi`, extends
  `CompanionApi` with `settings`.
- `src/preload.ts` — exposes `window.companion.settings.{get, set, onChange}`
  (`onChange` mirrors the existing `onFocusedElement` unsubscribe pattern).
- `src/main.ts` — on `ready`: creates `SettingsStore` at
  `path.join(app.getPath('userData'), 'settings.json')`, awaits `load()`, registers
  `settings:get` / `settings:set` IPC, broadcasts `settings:changed` to all windows
  on every change. IPC handlers registered before `createWindow()`, so no
  ready-race for the first renderer `get()`.

**Verified by Executor:**
- `npm test` → 54 passed (was 43). No lint errors.
- GUI verification is not possible from the agent sandbox (documented lesson).

**Needs human check (restart required — main + preload changed, no hot reload):**
1. Ctrl-C the running `npm start`, then `npm start` again.
2. In the renderer DevTools console (you may need to add `mainWindow.webContents.openDevTools({ mode: 'detach' })` to `main.ts` temporarily, OR just trust the file check in step 3), run:
   ```
   await window.companion.settings.get()
   ```
   Should return `{ liveTracking: true, pinned: true, opacity: 1, captureShortcut: 'CommandOrControl+Shift+A', hasOnboarded: false }`.
3. Then run:
   ```
   await window.companion.settings.set({ opacity: 0.8 })
   ```
   Should return the updated object.
4. Quit + relaunch the app. `await window.companion.settings.get()` should still
   return `{ ..., opacity: 0.8 }`. The file at
   `~/Library/Application Support/voiceover-companion/settings.json` should exist
   and contain the JSON.

**If you don't want to open DevTools just for this**, just confirm the file appears
at the path above after step 3 and contains the expected JSON. That's sufficient
proof persistence works end-to-end; the runtime wiring will be exercised properly in
5.2.2 anyway.

**Question for Planner/human:** confirm 5.2.1 verified, then say "proceed to 5.2.2"
(wire each setting into runtime behaviour: tracking on/off, pin, opacity, shortcut
re-registration).

### Planner note — Phase 5 re-planned, ready to execute 5.2.1 (2026-06-23)
- Execution order locked with human: **5.2 → 5.1 → 5.3**.
- 5.2 is broken into 5 small sub-tasks; each one stops for human verification before
  the next (per working agreement).
- 5.1 is gated on **Task 5.1.0** (decide Path B vs Path C, collect Apple Developer
  credentials). Do NOT start 5.1.x until that gate is cleared.
- 5.3 (contrast) stays a stretch and needs a SECOND OS permission (Screen Recording)
  — not Accessibility.
- **Next executable task: 5.2.1 (Settings persistence layer).** Adds `electron-store`,
  defines the `Settings` shape + defaults, adds `settings:get`/`settings:set` IPC,
  exposes `window.companion.settings` from preload, types in `global.d.ts`, plus a
  small unit test for the default-merging helper. NO UI changes yet — that's 5.2.3.
  Wait for human "proceed" before starting.

### Task 4.2 complete — awaiting human verification (2026-06-19)
- Wired the concept knowledge base (4.1) into the issues UI.
- Files changed (renderer + CSS only; no pure-logic changes):
  - `src/renderer.ts` — `renderIssues` now wraps the message in an `.issue-body` and,
    when `getConcept(issue.learnMoreId)` resolves, appends a collapsible "Learn more"
    (`<details>`) showing the concept's title + what-it-is / why-it-matters /
    how-to-fix. Added `buildConceptDetails(concept)` helper.
  - `src/index.css` — styling for `.issue-body`, `.learn-more`, and `.concept*`.
- Scope decision: the plan also mentioned linking the ANNOUNCEMENT breakdown to
  concepts, but announcement parts carry attribute `source` strings (e.g. "name
  (title)"), not concept ids, so there is no clean 1:1 mapping. I scoped 4.2 to the
  issues (which is the stated success criterion). Flagging for Planner: if we want
  announcement-part learn-more too, that needs a small mapping layer (could be a
  follow-up task).
- **Verified by Executor:** `npm test` → 43 passed; no lint errors.
- **Needs human check (GUI):** `npm start`, focus a known-bad control (e.g. an
  unlabeled icon button or an image with no alt), then click "Learn more" under the
  issue and confirm the explanation expands inline and reads sensibly.

### Task 4.1 complete — awaiting human verification (2026-06-19)
- Scope kept minimal/contained: this task is the CONTENT + lookup only; wiring into
  the UI is Task 4.2.
- Files added:
  - `src/concepts.ts` — `Concept` type + `CONCEPTS` map keyed by the exact
    `learnMoreId`s issues already emit (image-alt, control-name, field-label,
    empty-heading, link-text, generic-role, disabled-focus). Each has title +
    what-it-is / why-it-matters / how-to-fix (HTML+ARIA). Exposed via `getConcept(id)`.
  - `src/concepts.test.ts` — 3 tests, incl. one asserting every issue learnMoreId
    resolves to a concept (guards against future drift).
- **Verified by Executor:** `npm test` → 43 passed (was 40); no lint errors. No UI or
  runtime wiring touched, so no GUI regression risk.
- **Note for human:** nothing visible in the app changes yet — that happens in 4.2
  (clicking "learn more" on an issue shows the matching concept inline).

### Task 4.4 complete — awaiting human verification (2026-06-19)
- User clarified the guide should also include a CONTEXTUAL helper: detect where VO
  focus is and hint what to do next with that element. Built on top of 4.3.
- Files changed:
  - `src/next-actions.ts` — pure `suggestNextActions(element)` mapping role/state to
    relevant next VoiceOver commands (button/link/checkbox/radio/text field/slider/
    heading/image/static text/container roles + disabled note), de-duped by key, with
    a universal "move next" + rotor fallback.
  - `src/next-actions.test.ts` — 10 tests.
  - `index.html` — new "Try next" section in the inspector view (above issues).
  - `src/renderer.ts` — `renderNextActions()` renders the hints live per focus.
  - `src/index.css` — "Try next" styling.
- **Verified by Executor:** `npm test` → 40 passed (was 30); no lint errors.
- **Needs human check (I can't see the GUI):** `npm start`, then move VO/keyboard
  focus across different elements (a button, a link, a heading, a text field) and
  confirm the "Try next" hints change sensibly for each.

### Task 4.3 complete — awaiting human verification (2026-06-19)
- New requirement from user: a guide for driving VoiceOver. Decisions captured via
  questions — tab toggle UX, build now (before 4.1/4.2), essentials scope.
- Built a STATIC, categorised cheat-sheet (4 categories, 16 commands: getting
  started, reading, moving around, jump-by-type). Key combos verified against
  Apple's VoiceOver guide + Deque/AppleVis (2026).
- Files changed:
  - `src/voiceover-guide.ts` — typed data (`VoCategory`/`VoCommand`) for the guide.
  - `src/voiceover-guide.test.ts` — 4 structural tests (non-empty, essentials present).
  - `index.html` — main view now has an "Inspector" / "VoiceOver keys" tab bar; the
    existing inspector content moved under `#tab-inspector-panel`; new
    `#tab-guide-panel` holds the guide.
  - `src/renderer.ts` — `renderGuide()` builds the list from data, `selectTab()` +
    listeners switch panels; guide rendered once on load.
  - `src/index.css` — tab bar + guide list styling.
- **Verified by Executor:** `npm test` → 30 passed (was 26); no lint errors.
- **Needs human check (I can't see the GUI):** run `npm start`, grant the inspector
  view, click the "VoiceOver keys" tab, and confirm the commands list reads sensibly
  and switching back to "Inspector" still shows live focus + announcement + issues.

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

### Task 3.1 complete — awaiting human review (2026-06-19)
- `src/issues.ts`: pure `detectIssues(element): Issue[]` (`{id, severity, message,
  learnMoreId}`). Rules: missing image alt (error), missing control name for
  button/link/checkbox/radio/popup/combobox (error), missing form-field label
  (error), empty heading (warning), link text is a raw URL (warning), focus on a
  generic container AXGroup/AXUnknown (warning), disabled-but-focusable (warning).
  `learnMoreId`s map to Phase 4 concept content.
- `src/issues.test.ts`: 14 tests, all pass (suite now 26 total). No lint errors.
  Fully Executor-verifiable (pure functions).
- **For human review:** rule set + severities + wording are my v1 choices. The
  generic-container rule may occasionally false-positive (e.g. a legitimately
  focusable scroll area). Flag any rules to add/remove/retune before 3.2 surfaces
  them in the UI.

### Task 3.2 complete — awaiting human verification (2026-06-19)
- `index.html`: "Potential issues" section in the main view. `src/renderer.ts`:
  `renderIssues()` runs `detectIssues()` on every focus update; shows a coloured
  severity badge + message per issue, or "No issues detected for this element."
  when clean. `src/index.css`: error (red) / warning (amber) / info (blue) styling.
- **Verified by Executor:** 26/26 tests pass, no lint errors. Renderer-only →
  Vite hot-reloads (no restart).
- **Needs human check:** focus a known-bad control (e.g. an icon-only button with no
  label, or an `<img>` with no alt) and confirm the matching issue appears live with
  the right severity colour; focus a well-labelled control and confirm it shows
  "No issues detected".

> Milestone D (live, contextual issue flags for the focused element) reached pending
> this human verification.

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
