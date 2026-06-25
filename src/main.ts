import { app, BrowserWindow, ipcMain, shell, systemPreferences } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import started from 'electron-squirrel-startup';
import { SettingsStore } from './settings';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Load the native accessibility addon at runtime (Vite leaves .node external).
// In a packaged app the addon is copied to Resources via forge `extraResource`;
// in dev it lives under the project's native build output.
const nativeRequire = createRequire(__filename);
const addonPath = app.isPackaged
  ? path.join(process.resourcesPath, 'addon.node')
  : path.join(app.getAppPath(), 'native', 'build', 'Release', 'addon.node');
const accessibility = nativeRequire(addonPath) as {
  isTrusted: () => boolean;
  startFocusTracking: (callback: (element: Record<string, unknown>) => void) => boolean;
  stopFocusTracking: () => boolean;
};

let mainWindow: BrowserWindow | null = null;
let settingsStore: SettingsStore | null = null;

let trackingActive = false;

const pushFocused = (element: Record<string, unknown>): void => {
  mainWindow?.webContents.send('a11y:focusedElement', element);
};

// Start/stop live AX focus tracking to match the liveTracking setting.
const setLiveTracking = (enabled: boolean): void => {
  if (enabled && !trackingActive) {
    accessibility.startFocusTracking(pushFocused);
    trackingActive = true;
  } else if (!enabled && trackingActive) {
    accessibility.stopFocusTracking();
    trackingActive = false;
  }
};

// Apply the window-related settings (pin + opacity) to the panel.
const applyWindowSettings = (s: Settings): void => {
  if (!mainWindow) {
    return;
  }
  mainWindow.setAlwaysOnTop(s.pinned, 'floating');
  mainWindow.setOpacity(s.opacity);
};

// Deep link to System Settings > Privacy & Security > Accessibility.
const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

ipcMain.handle('a11y:isTrusted', () => accessibility.isTrusted());
ipcMain.handle('a11y:openSettings', () => {
  // Prompting registers this app in the Accessibility list (so the user has
  // something to toggle) and shows the macOS system dialog.
  systemPreferences.isTrustedAccessibilityClient(true);
  return shell.openExternal(ACCESSIBILITY_SETTINGS_URL);
});

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    show: false,
    alwaysOnTop: true,
    focusable: false,
    type: 'panel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Show without taking focus from the app under test.
  mainWindow.once('ready-to-show', () => {
    mainWindow?.showInactive();
  });
};

app.on('ready', async () => {
  console.log('[a11y] AXIsProcessTrusted =', accessibility.isTrusted());

  settingsStore = new SettingsStore(
    path.join(app.getPath('userData'), 'settings.json'),
  );
  await settingsStore.load();
  ipcMain.handle('settings:get', () => settingsStore?.get());
  ipcMain.handle('settings:set', (_event, partial: Partial<Settings>) =>
    settingsStore?.set(partial ?? {}),
  );
  settingsStore.subscribe((next) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', next);
    }
    applyWindowSettings(next);
    setLiveTracking(next.liveTracking);
  });

  createWindow();

  // Apply persisted settings to the freshly created window + runtime.
  const settings = settingsStore.get();
  applyWindowSettings(settings);
  setLiveTracking(settings.liveTracking);
});

app.on('will-quit', () => {
  accessibility.stopFocusTracking();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

