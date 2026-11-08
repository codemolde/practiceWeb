// ============================================================
// Art Practice Reference Studio — Child / Popup Window Preload
// Minimal, unprivileged API surface for internal child windows
// ============================================================

const { contextBridge } = require('electron');

// Expose strictly non-privileged identification to child windows (e.g. PiP).
// Sensitive capabilities (file picker, window state mutation) are NOT exposed.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  isChildWindow: true
});
