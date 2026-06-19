import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  systemPreferences,
} from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Load the native accessibility addon at runtime (Vite leaves .node external).
const nativeRequire = createRequire(__filename);
const accessibility = nativeRequire(
  path.join(app.getAppPath(), 'native', 'build', 'Release', 'addon.node'),
) as {
  isTrusted: () => boolean;
  getFocusedElement: () => Record<string, unknown>;
};

let mainWindow: BrowserWindow | null = null;

// Capturing via a global shortcut avoids stealing focus from the app under test
// (clicking inside our window would make our own control the "focused element").
const CAPTURE_SHORTCUT = 'CommandOrControl+Shift+A';

// Deep link to System Settings > Privacy & Security > Accessibility.
const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

ipcMain.handle('a11y:isTrusted', () => accessibility.isTrusted());
ipcMain.handle('a11y:getFocusedElement', () => accessibility.getFocusedElement());
ipcMain.handle('a11y:openSettings', () => {
  // Prompting registers this app in the Accessibility list (so the user has
  // something to toggle) and shows the macOS system dialog.
  systemPreferences.isTrustedAccessibilityClient(true);
  return shell.openExternal(ACCESSIBILITY_SETTINGS_URL);
});

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  console.log('[a11y] AXIsProcessTrusted =', accessibility.isTrusted());
  createWindow();

  const registered = globalShortcut.register(CAPTURE_SHORTCUT, () => {
    const element = accessibility.getFocusedElement();
    mainWindow?.webContents.send('a11y:focusedElement', element);
  });
  if (!registered) {
    console.warn('[a11y] Failed to register capture shortcut', CAPTURE_SHORTCUT);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
