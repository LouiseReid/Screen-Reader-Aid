/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 */

import './index.css';
import { describeAnnouncement } from './announce';
import { detectIssues } from './issues';
import { getConcept, type Concept } from './concepts';
import { suggestNextActions } from './next-actions';
import { VOICEOVER_GUIDE } from './voiceover-guide';
import { classifyApp } from './browser';

const loadingView = document.getElementById('loading-view');
const permissionView = document.getElementById('permission-view');
const mainView = document.getElementById('main-view');
const onboardingView = document.getElementById('onboarding-view');
const onboardSteps = Array.from(
  document.querySelectorAll<HTMLElement>('.onboard-step'),
);
const onboardOpenSettings = document.getElementById('onboard-open-settings');
const onboardRecheck = document.getElementById('onboard-recheck');
const onboardPermStatus = document.getElementById('onboard-perm-status');
const onboardDone = document.getElementById('onboard-done');
const openSettingsButton = document.getElementById('open-settings');
const recheckButton = document.getElementById('recheck');
const elementOutput = document.getElementById('element-output');
const announcementText = document.getElementById('announcement-text');
const announcementParts = document.getElementById('announcement-parts');
const issuesList = document.getElementById('issues-list');
const nextList = document.getElementById('next-list');
const browserBanner = document.getElementById('browser-banner');
const guideContainer = document.getElementById('guide');
const tabInspector = document.getElementById('tab-inspector');
const tabGuide = document.getElementById('tab-guide');
const tabSettings = document.getElementById('tab-settings');
const inspectorPanel = document.getElementById('tab-inspector-panel');
const guidePanel = document.getElementById('tab-guide-panel');
const settingsPanel = document.getElementById('tab-settings-panel');
const liveTrackingInput = document.getElementById(
  'set-live-tracking',
) as HTMLInputElement | null;
const pinnedInput = document.getElementById(
  'set-pinned',
) as HTMLInputElement | null;
const opacityInput = document.getElementById(
  'set-opacity',
) as HTMLInputElement | null;
const opacityValue = document.getElementById('set-opacity-value');
const resetButton = document.getElementById('set-reset');

const allViews = [loadingView, permissionView, mainView, onboardingView];

const FIELDS: Array<[keyof FocusedElement, string]> = [
  ['role', 'Role'],
  ['subrole', 'Subrole'],
  ['roleDescription', 'Role description'],
  ['title', 'Title'],
  ['value', 'Value'],
  ['description', 'Description'],
  ['help', 'Help'],
  ['enabled', 'Enabled'],
  ['focused', 'Focused'],
  ['pid', 'App PID'],
  ['appName', 'App'],
  ['bundleId', 'Bundle ID'],
];

function show(view: HTMLElement | null): void {
  for (const candidate of allViews) {
    if (candidate) {
      candidate.hidden = candidate !== view;
    }
  }
}

function renderAnnouncement(data: FocusedElement): void {
  const announcement = describeAnnouncement(data);
  if (announcementText) {
    announcementText.textContent = announcement.utterance || '\u2014';
  }
  if (announcementParts) {
    announcementParts.innerHTML = '';
    for (const part of announcement.parts) {
      const term = document.createElement('dt');
      term.textContent = part.text;
      const definition = document.createElement('dd');
      definition.textContent = part.source;
      announcementParts.appendChild(term);
      announcementParts.appendChild(definition);
    }
  }
}

function buildConceptDetails(concept: Concept): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'learn-more';

  const summary = document.createElement('summary');
  summary.textContent = 'Learn more';
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'concept';

  const title = document.createElement('p');
  title.className = 'concept-title';
  title.textContent = concept.title;
  body.appendChild(title);

  const sections: Array<[string, string]> = [
    ['What it is', concept.whatItIs],
    ['Why it matters', concept.whyItMatters],
    ['How to fix', concept.howToFix],
  ];
  for (const [label, text] of sections) {
    const para = document.createElement('p');
    para.className = 'concept-section';
    const heading = document.createElement('span');
    heading.className = 'concept-heading';
    heading.textContent = label;
    para.appendChild(heading);
    para.appendChild(document.createTextNode(text));
    body.appendChild(para);
  }

  details.appendChild(body);
  return details;
}

function renderIssues(data: FocusedElement): void {
  if (!issuesList) {
    return;
  }
  issuesList.innerHTML = '';

  const issues = detectIssues(data);
  if (issues.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'issue issue-none';
    empty.textContent = data.error
      ? '\u2014'
      : 'No issues detected for this element.';
    issuesList.appendChild(empty);
    return;
  }

  for (const issue of issues) {
    const item = document.createElement('li');
    item.className = `issue issue-${issue.severity}`;

    const badge = document.createElement('span');
    badge.className = 'issue-badge';
    badge.textContent = issue.severity;

    const body = document.createElement('div');
    body.className = 'issue-body';

    const message = document.createElement('span');
    message.className = 'issue-message';
    message.textContent = issue.message;
    body.appendChild(message);

    const concept = getConcept(issue.learnMoreId);
    if (concept) {
      body.appendChild(buildConceptDetails(concept));
    }

    item.appendChild(badge);
    item.appendChild(body);
    issuesList.appendChild(item);
  }
}

function renderNextActions(data: FocusedElement): void {
  if (!nextList) {
    return;
  }
  nextList.innerHTML = '';

  const hints = suggestNextActions(data);
  if (hints.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'next-empty';
    empty.textContent = '\u2014';
    nextList.appendChild(empty);
    return;
  }

  for (const hint of hints) {
    const item = document.createElement('li');
    item.className = 'next-item';

    if (hint.keys) {
      const keys = document.createElement('span');
      keys.className = 'next-keys';
      const tokens = hint.keys.split(' + ');
      tokens.forEach((token, index) => {
        const key = document.createElement('kbd');
        key.textContent = token;
        keys.appendChild(key);
        if (index < tokens.length - 1) {
          keys.appendChild(document.createTextNode('+'));
        }
      });
      item.appendChild(keys);
    }

    const action = document.createElement('span');
    action.className = 'next-action';
    action.textContent = hint.action;
    item.appendChild(action);

    nextList.appendChild(item);
  }
}

function renderBrowserBanner(data: FocusedElement): void {
  if (!browserBanner) {
    return;
  }
  const info = classifyApp(data.bundleId);
  if (info.isBrowser && !info.isSafari) {
    browserBanner.textContent = `You\u2019re testing in ${info.name}. VoiceOver is designed for Safari \u2014 results are most accurate there.`;
    browserBanner.hidden = false;
  } else {
    browserBanner.textContent = '';
    browserBanner.hidden = true;
  }
}

function renderElement(data: FocusedElement): void {
  renderBrowserBanner(data);
  renderAnnouncement(data);
  renderNextActions(data);
  renderIssues(data);

  if (!elementOutput) {
    return;
  }
  elementOutput.innerHTML = '';

  if (data.error) {
    const message = document.createElement('p');
    message.className = 'hint';
    message.textContent = `Could not read element: ${data.error}`;
    elementOutput.appendChild(message);
    return;
  }

  for (const [key, label] of FIELDS) {
    const value = data[key];
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    definition.textContent =
      value === null || value === undefined || value === ''
        ? '\u2014'
        : String(value);
    elementOutput.appendChild(term);
    elementOutput.appendChild(definition);
  }
}

function renderGuide(): void {
  if (!guideContainer) {
    return;
  }
  guideContainer.innerHTML = '';
  for (const category of VOICEOVER_GUIDE) {
    const section = document.createElement('section');
    section.className = 'guide-category';

    const heading = document.createElement('h2');
    heading.textContent = category.title;
    section.appendChild(heading);

    const list = document.createElement('dl');
    list.className = 'guide-list';
    for (const command of category.commands) {
      const term = document.createElement('dt');
      const tokens = command.keys.split(' + ');
      tokens.forEach((token, index) => {
        const key = document.createElement('kbd');
        key.textContent = token;
        term.appendChild(key);
        if (index < tokens.length - 1) {
          term.appendChild(document.createTextNode('+'));
        }
      });

      const definition = document.createElement('dd');
      definition.textContent = command.action;

      list.appendChild(term);
      list.appendChild(definition);
    }
    section.appendChild(list);
    guideContainer.appendChild(section);
  }
}

type TabName = 'inspector' | 'guide' | 'settings';

const TABS: Array<{
  name: TabName;
  button: HTMLElement | null;
  panel: HTMLElement | null;
}> = [
  { name: 'inspector', button: tabInspector, panel: inspectorPanel },
  { name: 'guide', button: tabGuide, panel: guidePanel },
  { name: 'settings', button: tabSettings, panel: settingsPanel },
];

function selectTab(tab: TabName): void {
  for (const entry of TABS) {
    const active = entry.name === tab;
    if (entry.panel) {
      entry.panel.hidden = !active;
    }
    entry.button?.classList.toggle('is-active', active);
  }
}

function renderSettings(settings: Settings): void {
  if (liveTrackingInput) {
    liveTrackingInput.checked = settings.liveTracking;
  }
  if (pinnedInput) {
    pinnedInput.checked = settings.pinned;
  }
  const percent = Math.round(settings.opacity * 100);
  if (opacityInput) {
    opacityInput.value = String(percent);
  }
  if (opacityValue) {
    opacityValue.textContent = `${percent}%`;
  }
}

async function refreshTrust(): Promise<void> {
  const trusted = await window.companion.isTrusted();
  console.log('[a11y] renderer isTrusted =', trusted);
  show(trusted ? mainView : permissionView);
}

let onboardStep = 1;

function showOnboardStep(step: number): void {
  const total = onboardSteps.length;
  onboardStep = Math.min(Math.max(step, 1), total);
  for (const el of onboardSteps) {
    el.hidden = Number(el.dataset.step) !== onboardStep;
  }
}

function startOnboarding(): void {
  if (onboardPermStatus) {
    onboardPermStatus.textContent = '';
  }
  showOnboardStep(1);
  show(onboardingView);
}

openSettingsButton?.addEventListener('click', () => {
  void window.companion.openAccessibilitySettings();
});

recheckButton?.addEventListener('click', () => {
  show(loadingView);
  void refreshTrust();
});

tabInspector?.addEventListener('click', () => selectTab('inspector'));
tabGuide?.addEventListener('click', () => selectTab('guide'));
tabSettings?.addEventListener('click', () => selectTab('settings'));

liveTrackingInput?.addEventListener('change', () => {
  void window.companion.settings.set({ liveTracking: liveTrackingInput.checked });
});

pinnedInput?.addEventListener('change', () => {
  void window.companion.settings.set({ pinned: pinnedInput.checked });
});

opacityInput?.addEventListener('input', () => {
  const percent = Number(opacityInput.value);
  if (opacityValue) {
    opacityValue.textContent = `${percent}%`;
  }
  void window.companion.settings.set({ opacity: percent / 100 });
});

resetButton?.addEventListener('click', () => {
  void window.companion.settings.set({
    liveTracking: true,
    pinned: true,
    opacity: 1,
  });
});

onboardingView?.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest(
    '[data-onboard]',
  ) as HTMLElement | null;
  if (!target) {
    return;
  }
  if (target.dataset.onboard === 'next') {
    showOnboardStep(onboardStep + 1);
  } else if (target.dataset.onboard === 'back') {
    showOnboardStep(onboardStep - 1);
  }
});

onboardOpenSettings?.addEventListener('click', () => {
  void window.companion.openAccessibilitySettings();
});

onboardRecheck?.addEventListener('click', () => {
  void window.companion.isTrusted().then((trusted) => {
    if (onboardPermStatus) {
      onboardPermStatus.textContent = trusted
        ? 'Permission granted. You can continue.'
        : 'Not granted yet. Turn on VoiceOver Companion, then re-check.';
    }
  });
});

onboardDone?.addEventListener('click', () => {
  void window.companion.settings
    .set({ hasOnboarded: true })
    .then(() => refreshTrust());
});

window.companion.settings.onChange((settings) => {
  renderSettings(settings);
});

window.companion.onFocusedElement((data) => {
  renderElement(data);
});

async function init(): Promise<void> {
  const settings = await window.companion.settings.get();
  renderSettings(settings);
  if (settings.hasOnboarded) {
    await refreshTrust();
  } else {
    startOnboarding();
  }
}

renderGuide();
void init();
