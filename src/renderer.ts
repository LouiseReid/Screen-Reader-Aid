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

const allViews = [loadingView, permissionView, mainView];

function show(view: HTMLElement | null): void {
  for (const candidate of allViews) {
    if (candidate) {
      candidate.hidden = candidate !== view;
    }
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

void refreshTrust();
