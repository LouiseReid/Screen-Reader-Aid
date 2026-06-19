/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 */

import './index.css';

const loadingView = document.getElementById('loading-view');
const permissionView = document.getElementById('permission-view');
const mainView = document.getElementById('main-view');
const openSettingsButton = document.getElementById('open-settings');
const recheckButton = document.getElementById('recheck');
const captureButton = document.getElementById('capture');
const elementOutput = document.getElementById('element-output');

const allViews = [loadingView, permissionView, mainView];

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
];

function show(view: HTMLElement | null): void {
  for (const candidate of allViews) {
    if (candidate) {
      candidate.hidden = candidate !== view;
    }
  }
}

function renderElement(data: FocusedElement): void {
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

async function refreshTrust(): Promise<void> {
  const trusted = await window.companion.isTrusted();
  console.log('[a11y] renderer isTrusted =', trusted);
  show(trusted ? mainView : permissionView);
}

openSettingsButton?.addEventListener('click', () => {
  void window.companion.openAccessibilitySettings();
});

recheckButton?.addEventListener('click', () => {
  show(loadingView);
  void refreshTrust();
});

captureButton?.addEventListener('click', async () => {
  renderElement(await window.companion.getFocusedElement());
});

window.companion.onFocusedElement((data) => {
  renderElement(data);
});

void refreshTrust();
