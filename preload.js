const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  toggleFloatMode: (flag) => ipcRenderer.invoke('toggle-float-mode', flag),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  isAlwaysOnTop: () => ipcRenderer.invoke('is-always-on-top'),
  toggleGhostMode: (flag) => ipcRenderer.invoke('toggle-ghost-mode', flag),
  adjustOpacity: (delta) => ipcRenderer.invoke('adjust-opacity', delta),
  setOpacity: (target) => ipcRenderer.invoke('set-opacity', target),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  onGlobalShortcut: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }

    const listener = (_event, action, data) => callback(action, data);

    ipcRenderer.on('shortcut:action', listener);

    return () => {
      ipcRenderer.removeListener('shortcut:action', listener);
    };
  }
});

