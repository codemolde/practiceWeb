const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  toggleFloatMode: (flag) => ipcRenderer.invoke('toggle-float-mode', flag),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  isAlwaysOnTop: () => ipcRenderer.invoke('is-always-on-top'),
  toggleGhostMode: (flag) => ipcRenderer.invoke('toggle-ghost-mode', flag),
  keepGhostMode: () => ipcRenderer.invoke('keep-ghost-mode'),
  setRestoreGhostOnBlur: (flag) => ipcRenderer.invoke('set-restore-ghost-on-blur', flag),
  getRestoreGhostOnBlur: () => ipcRenderer.invoke('get-restore-ghost-on-blur'),
  adjustOpacity: (delta) => ipcRenderer.invoke('adjust-opacity', delta),
  setOpacity: (target) => ipcRenderer.invoke('set-opacity', target),
  setFullScreen: (flag) => ipcRenderer.invoke('set-fullscreen', flag),
  toggleFullScreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullScreen: () => ipcRenderer.invoke('is-fullscreen'),
  onFullscreenChange: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    const listener = (_event, isFs) => callback(isFs);
    ipcRenderer.on('window:fullscreen-change', listener);
    return () => {
      ipcRenderer.removeListener('window:fullscreen-change', listener);
    };
  },
  setIgnoreMouseEvents: (ignore, options) => {
    if (typeof ignore !== 'boolean') {
      throw new TypeError('ignore must be a boolean');
    }
    if (options !== undefined && options !== null) {
      if (typeof options !== 'object' || typeof options.forward !== 'boolean') {
        throw new TypeError('options.forward must be a boolean');
      }
    }
    return ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  onGlobalShortcut: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }

    const listener = (_event, action, data) => callback(action, data);

    ipcRenderer.on('shortcut:action', listener);

    return () => {
      ipcRenderer.removeListener('shortcut:action', listener);
    };
  },
  onBeforeQuit: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }

    const listener = async () => {
      try {
        await callback();
      } finally {
        ipcRenderer.send('app:quit-flush-ack');
      }
    };

    ipcRenderer.on('app:before-quit', listener);

    return () => {
      ipcRenderer.removeListener('app:before-quit', listener);
    };
  }
});

