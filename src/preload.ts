// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('companion', {
  isTrusted: (): Promise<boolean> => ipcRenderer.invoke('a11y:isTrusted'),
  openAccessibilitySettings: (): Promise<void> =>
    ipcRenderer.invoke('a11y:openSettings'),
  getFocusedElement: (): Promise<FocusedElement> =>
    ipcRenderer.invoke('a11y:getFocusedElement'),
  onFocusedElement: (callback: (data: FocusedElement) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: FocusedElement): void =>
      callback(data);
    ipcRenderer.on('a11y:focusedElement', listener);
    return () => ipcRenderer.removeListener('a11y:focusedElement', listener);
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (partial: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke('settings:set', partial),
    onChange: (callback: (settings: Settings) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, data: Settings): void =>
        callback(data);
      ipcRenderer.on('settings:changed', listener);
      return () => ipcRenderer.removeListener('settings:changed', listener);
    },
  },
});
