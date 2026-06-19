// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('companion', {
  isTrusted: (): Promise<boolean> => ipcRenderer.invoke('a11y:isTrusted'),
  openAccessibilitySettings: (): Promise<void> =>
    ipcRenderer.invoke('a11y:openSettings'),
});
