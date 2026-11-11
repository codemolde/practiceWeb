const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const EventEmitter = require('node:events');

// Ensure USER_DATA_DIR points to project userdata to prevent unwanted legacy migration logs
process.env.USER_DATA_DIR = path.join(__dirname, '..', 'userdata');

// Setup mock menu items to verify menu checkbox synchronization
const menuItems = {
  'menu-always-on-top': { id: 'menu-always-on-top', checked: false },
  'menu-float-mode': { id: 'menu-float-mode', checked: false },
  'menu-ghost-mode': { id: 'menu-ghost-mode', checked: false }
};

const mockMenu = {
  getApplicationMenu: () => ({
    getMenuItemById: (id) => menuItems[id] || null
  }),
  buildFromTemplate: (template) => {
    const items = {};
    for (const item of template) {
      if (item.id) items[item.id] = item;
      if (item.label) items[item.label] = item;
      if (item.submenu) {
        for (const sub of item.submenu) {
          if (sub.id) items[sub.id] = sub;
          if (sub.label) items[sub.label] = sub;
        }
      }
    }
    return {
      template,
      getMenuItemById: (id) => items[id] || null,
      items
    };
  },
  setApplicationMenu: () => {}
};

const registeredShortcuts = new Map();
const mockGlobalShortcut = {
  register: (key, handler) => {
    registeredShortcuts.set(key, handler);
    return true;
  },
  unregister: (key) => {
    registeredShortcuts.delete(key);
  },
  unregisterAll: () => {
    registeredShortcuts.clear();
  },
  isRegistered: (key) => registeredShortcuts.has(key)
};

let mockTrayInstance = null;
class MockTray {
  constructor(icon) {
    this.icon = icon;
    this.toolTip = '';
    this.contextMenu = null;
    this.destroyed = false;
    mockTrayInstance = this;
  }
  setToolTip(tip) {
    this.toolTip = tip;
  }
  setContextMenu(menu) {
    this.contextMenu = menu;
  }
  destroy() {
    this.destroyed = true;
    mockTrayInstance = null;
  }
}

const mockNativeImage = {
  createFromBuffer: (buf) => ({ buffer: buf }),
  createEmpty: () => ({ empty: true })
};

const ipcHandlers = new Map();
const ipcListeners = new Map();
const mockIpcMain = {
  handle: (channel, handler) => {
    ipcHandlers.set(channel, handler);
  },
  on: (channel, listener) => {
    ipcListeners.set(channel, listener);
  }
};

const mockAppListeners = new Map();
const mockApp = {
  getPath: () => path.join(__dirname, '..', 'userdata'),
  whenReady: () => new Promise(() => {}),
  on: (event, handler) => {
    mockAppListeners.set(event, handler);
  },
  quit: () => {}
};

// Install mock electron in require.cache before requiring electron-main
const mockElectron = {
  app: mockApp,
  BrowserWindow: class {},
  ipcMain: mockIpcMain,
  Menu: mockMenu,
  Tray: MockTray,
  nativeImage: mockNativeImage,
  dialog: {},
  globalShortcut: mockGlobalShortcut,
  session: {},
  screen: {
    getDisplayMatching: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    })
  }
};

require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: mockElectron
};

const {
  getState,
  windowStates,
  setAlwaysOnTopMode,
  toggleFloatMode,
  toggleGhostMode,
  keepGhostMode,
  setRestoreGhostOnBlur,
  getRestoreGhostOnBlur,
  handleWindowBlur,
  clearGhostAutoRestoreTimer,
  safeSetOpacity,
  setWindowOpacity,
  setWindowFullScreen,
  toggleWindowFullScreen,
  setMainWindow,
  getMainWindow,
  setupTray,
  getAppTray,
  setAppTray,
  registerGhostModeShortcuts,
  unregisterGhostModeShortcuts,
  setServerPort
} = require('../electron-main.js');

setServerPort(3000);

class MockBrowserWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this._bounds = {
      x: options.x ?? 120,
      y: options.y ?? 100,
      width: options.width ?? 1280,
      height: options.height ?? 820
    };
    this._alwaysOnTop = options.alwaysOnTop ?? false;
    this._opacity = options.opacity ?? 1.0;
    this._ignoreMouseEvents = false;
    this._destroyed = false;
    this._visibleOnAllWorkspaces = false;
    this._fullScreenable = true;
    this._minSize = { width: 320, height: 280 };
    this._buttonVisibility = true;
    this._customSetOpacity = options.customSetOpacity;
    this.webContents = {
      isDestroyed: () => this._destroyed,
      executeJavaScript: async () => {},
      send: () => {}
    };

    if (this._customSetOpacity !== undefined) {
      this.setOpacity = this._customSetOpacity;
    }
  }

  isDestroyed() {
    return this._destroyed;
  }

  getBounds() {
    return { ...this._bounds };
  }

  setBounds(bounds) {
    this._bounds = { ...this._bounds, ...bounds };
  }

  setSize(width, height) {
    this._bounds.width = width;
    this._bounds.height = height;
  }

  center() {
    this._bounds.x = 200;
    this._bounds.y = 100;
  }

  setMinimumSize(w, h) {
    this._minSize = { width: w, height: h };
  }

  isAlwaysOnTop() {
    return this._alwaysOnTop;
  }

  setAlwaysOnTop(flag) {
    this._alwaysOnTop = !!flag;
  }

  getOpacity() {
    if (this._destroyed) throw new TypeError('Object has been destroyed');
    return this._opacity;
  }

  setOpacity(val) {
    this._opacity = val;
  }

  isIgnoreMouseEvents() {
    return this._ignoreMouseEvents;
  }

  setIgnoreMouseEvents(ignore) {
    this._ignoreMouseEvents = !!ignore;
  }

  setVisibleOnAllWorkspaces(flag) {
    this._visibleOnAllWorkspaces = !!flag;
  }

  setFullScreenable(flag) {
    this._fullScreenable = !!flag;
  }

  isFullScreen() {
    return !!this._isFullScreen;
  }

  setFullScreen(flag) {
    this._isFullScreen = !!flag;
    if (flag) this.emit('enter-full-screen');
    else this.emit('leave-full-screen');
  }

  setWindowButtonVisibility(flag) {
    this._buttonVisibility = !!flag;
  }

  destroy() {
    this._destroyed = true;
    this.emit('closed');
  }

  close() {
    this.destroy();
  }
}

test('WeakMap Window State Management Tests', async (t) => {
  t.beforeEach(() => {
    menuItems['menu-always-on-top'].checked = false;
    menuItems['menu-float-mode'].checked = false;
    menuItems['menu-ghost-mode'].checked = false;
    registeredShortcuts.clear();
  });

  await t.test('1. Toggle float on main, open child, toggle ghost on child -> main state unchanged and menu reflects main only (MOCKED)', () => {
    const mainWin = new MockBrowserWindow({ x: 50, y: 50, width: 1200, height: 800 });
    const childWin = new MockBrowserWindow({ x: 300, y: 200, width: 400, height: 500 });
    setMainWindow(mainWin);

    // Initial states
    const mainState = getState(mainWin);
    const childState = getState(childWin);
    assert.equal(mainState.floating, false);
    assert.equal(mainState.ghost, false);
    assert.equal(childState.floating, false);
    assert.equal(childState.ghost, false);

    // Toggle float mode on main window
    toggleFloatMode(mainWin, true);
    assert.equal(mainState.floating, true, 'Main window floating is now true');
    assert.equal(menuItems['menu-float-mode'].checked, true, 'Float menu checkbox updated for main window');
    assert.equal(childState.floating, false, 'Child window floating remains false');

    // Toggle ghost mode on child window
    toggleGhostMode(childWin, true);
    assert.equal(childState.ghost, true, 'Child window ghost mode is active');
    assert.equal(childWin.getOpacity(), 0.40, 'Child window opacity lowered for ghost mode');

    // Main window state must remain completely unchanged
    assert.equal(mainState.floating, true, 'Main window floating remains true');
    assert.equal(mainState.ghost, false, 'Main window ghost mode is still false');
    assert.equal(mainWin.getOpacity(), 1.0, 'Main window opacity remains 1.0');

    // Menu checkboxes reflect mainWindow only: child window toggling ghost must NOT change menu-ghost-mode
    assert.equal(menuItems['menu-ghost-mode'].checked, false, 'menu-ghost-mode checkbox remains false because main window is not in ghost mode');

    // Clean up
    mainWin.close();
    childWin.close();
    setMainWindow(null);
  });

  await t.test('2. Close and reopen windows -> no stale bounds carried over (MOCKED)', () => {
    const win1 = new MockBrowserWindow({ x: 80, y: 90, width: 1400, height: 900 });
    const state1 = getState(win1);
    assert.equal(state1.normalBounds, null, 'Initial normalBounds is null');

    // Toggle float mode so win1 stores its normalBounds
    toggleFloatMode(win1, true);
    assert.deepEqual(state1.normalBounds, { x: 80, y: 90, width: 1400, height: 900 });

    // Close win1
    win1.close();
    // Verify cleanup on 'closed' event removed state1 from WeakMap
    assert.equal(windowStates.has(win1), false, 'win1 is removed from WeakMap on closed');

    // Reopen / create new window
    const win2 = new MockBrowserWindow({ x: 200, y: 150, width: 1100, height: 750 });
    const state2 = getState(win2);
    assert.equal(state2.normalBounds, null, 'Reopened window has fresh state with normalBounds === null (no stale bounds)');
    assert.equal(state2.floating, false, 'Reopened window has floating === false');

    win2.close();
    assert.equal(windowStates.has(win2), false, 'win2 is removed from WeakMap on closed');
  });

  await t.test('3. Always-on-top on/off round trips without moving or resizing the window (MOCKED)', () => {
    const initialBounds = { x: 250, y: 180, width: 950, height: 600 };
    const win = new MockBrowserWindow(initialBounds);
    setMainWindow(win);

    const state = getState(win);
    assert.equal(win.isAlwaysOnTop(), false);
    assert.equal(state.alwaysOnTop, false);

    // Turn always-on-top ON
    const onResult = setAlwaysOnTopMode(win, true);
    assert.equal(onResult.isAlwaysOnTop, true);
    assert.equal(win.isAlwaysOnTop(), true);
    assert.equal(state.alwaysOnTop, true);
    assert.equal(menuItems['menu-always-on-top'].checked, true, 'menu-always-on-top checked');
    assert.deepEqual(win.getBounds(), initialBounds, 'Bounds are completely identical after setting always-on-top true');

    // Turn always-on-top OFF
    const offResult = setAlwaysOnTopMode(win, false);
    assert.equal(offResult.isAlwaysOnTop, false);
    assert.equal(win.isAlwaysOnTop(), false);
    assert.equal(state.alwaysOnTop, false);
    assert.equal(menuItems['menu-always-on-top'].checked, false, 'menu-always-on-top unchecked');
    assert.deepEqual(win.getBounds(), initialBounds, 'Bounds are completely identical after setting always-on-top false');

    win.close();
    setMainWindow(null);
  });

  await t.test('4. toggleFloatMode does not change alwaysOnTop state, and turning floating off keeps always-on-top if enabled independently (MOCKED)', () => {
    const initialBounds = { x: 100, y: 100, width: 1200, height: 800 };
    const win = new MockBrowserWindow(initialBounds);
    setMainWindow(win);

    // 1. Enable independent always-on-top
    setAlwaysOnTopMode(win, true);
    const state = getState(win);
    assert.equal(state.alwaysOnTop, true);
    assert.equal(win.isAlwaysOnTop(), true);

    // 2. Toggle float mode ON
    toggleFloatMode(win, true);
    assert.equal(state.floating, true);
    assert.equal(state.alwaysOnTop, true, 'toggleFloatMode must NOT change alwaysOnTop state');
    assert.equal(win.isAlwaysOnTop(), true);
    assert.equal(win.getBounds().width, 480, 'Window shrunk to compact float width');

    // 3. Toggle float mode OFF
    toggleFloatMode(win, false);
    assert.equal(state.floating, false, 'Window no longer floating');
    assert.equal(state.alwaysOnTop, true, 'alwaysOnTop state is still preserved');
    assert.equal(win.isAlwaysOnTop(), true, 'Window remains always-on-top because it was enabled independently');
    assert.deepEqual(win.getBounds(), initialBounds, 'Bounds restored to original pre-float bounds');

    // 4. Now turn float on when alwaysOnTop was NOT enabled
    setAlwaysOnTopMode(win, false);
    assert.equal(win.isAlwaysOnTop(), false);
    assert.equal(state.alwaysOnTop, false);

    toggleFloatMode(win, true);
    assert.equal(state.floating, true);
    assert.equal(state.alwaysOnTop, false, 'alwaysOnTop remains false during float');
    assert.equal(win.isAlwaysOnTop(), true, 'Electron window is stacked floating during float mode');

    // Turn float OFF: since alwaysOnTop was false, window should return to non-always-on-top
    toggleFloatMode(win, false);
    assert.equal(state.floating, false);
    assert.equal(state.alwaysOnTop, false);
    assert.equal(win.isAlwaysOnTop(), false, 'Window is no longer always-on-top after floating off');

    win.close();
    setMainWindow(null);
  });

  await t.test('5. Ghost on/off x10 never leaves the window in click-through mode', () => {
    const win = new MockBrowserWindow({ width: 1000, height: 700 });
    setMainWindow(win);

    const isLinux = process.platform === 'linux';

    for (let i = 0; i < 10; i++) {
      // Toggle ON
      const resOn = toggleGhostMode(win, true);
      assert.equal(resOn.isGhostMode, true);
      if (!isLinux) {
        assert.equal(win.isIgnoreMouseEvents(), true, `Iteration ${i + 1}: Window is ignoring mouse events while in ghost mode`);
      }

      // Toggle OFF
      const resOff = toggleGhostMode(win, false);
      assert.equal(resOff.isGhostMode, false);
      assert.equal(win.isIgnoreMouseEvents(), false, `Iteration ${i + 1}: Window MUST NOT be ignoring mouse events after exiting ghost mode`);
    }

    const finalState = getState(win);
    assert.equal(finalState.ghost, false);
    assert.equal(win.isIgnoreMouseEvents(), false, 'Window mouse interaction is completely restored after 10 rapid toggles');

    win.close();
    setMainWindow(null);
  });

  await t.test('6. Tray exit works: tray context menu allows exiting ghost mode directly', () => {
    const win = new MockBrowserWindow({ width: 1000, height: 700 });
    setMainWindow(win);

    setupTray();
    const tray = getAppTray();
    assert.ok(tray, 'Tray was created');

    // Put window in ghost mode
    toggleGhostMode(win, true);
    assert.equal(getState(win).ghost, true);

    // Verify context menu has Exit Ghost Mode enabled
    const menu = tray.contextMenu;
    assert.ok(menu, 'Tray has a context menu');
    const exitItem = menu.items['tray-exit-ghost-mode'] || menu.items['Exit Ghost Mode'];
    assert.ok(exitItem, 'Exit Ghost Mode menu item exists');
    assert.equal(exitItem.enabled, true, 'Exit Ghost Mode item is enabled while in ghost mode');

    // Simulate clicking Exit Ghost Mode from tray
    exitItem.click();

    // Verify ghost mode was disabled on the main window
    assert.equal(getState(win).ghost, false, 'Window exited ghost mode via tray');
    assert.equal(win.isIgnoreMouseEvents(), false, 'Mouse events restored');

    win.close();
    setMainWindow(null);
    tray.destroy();
  });

  await t.test('7. Shortcuts unregister on quit and dynamic opacity shortcuts register only while ghost mode is active', () => {
    const win = new MockBrowserWindow({ width: 1000, height: 700 });
    setMainWindow(win);

    // Initially, no opacity shortcuts registered
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+Up'), false);
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+Down'), false);
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+O'), false);
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+K'), false);

    // Turn Ghost Mode ON: dynamic shortcuts register
    toggleGhostMode(win, true);
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+Up'), true, 'CmdOrCtrl+Shift+Up registered when ghost mode is active');
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+Down'), true, 'CmdOrCtrl+Shift+Down registered when ghost mode is active');
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+O'), true, 'CmdOrCtrl+Shift+O registered when ghost mode is active');
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+K'), true, 'Keep-ghost hotkey CmdOrCtrl+Shift+K registered');

    // Turn Ghost Mode OFF: dynamic shortcuts are immediately unregistered to not hijack other apps
    toggleGhostMode(win, false);
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+Up'), false, 'CmdOrCtrl+Shift+Up unregistered on ghost exit');
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+Down'), false, 'CmdOrCtrl+Shift+Down unregistered on ghost exit');
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+O'), false, 'CmdOrCtrl+Shift+O unregistered on ghost exit');
    assert.equal(registeredShortcuts.has('CmdOrCtrl+Shift+K'), false, 'CmdOrCtrl+Shift+K unregistered on ghost exit');

    // Simulate app before-quit
    registeredShortcuts.set('CmdOrCtrl+Shift+G', () => {});
    const beforeQuitHandler = mockAppListeners.get('before-quit');
    if (beforeQuitHandler) {
      beforeQuitHandler({ preventDefault: () => {} });
      assert.equal(registeredShortcuts.size, 0, 'All global shortcuts unregistered on app before-quit');
      // Immediately acknowledge quit flush so timer does not wait 3s
      const ackListener = ipcListeners.get('app:quit-flush-ack');
      if (ackListener) {
        ackListener({ sender: { getURL: () => 'http://localhost:3000?electron=1' } });
      }
    }

    win.close();
    setMainWindow(null);
  });

  await t.test('8. 60-second auto-restore failsafe restores mouse interaction unless keep-ghost is triggered', () => {
    const win = new MockBrowserWindow({ width: 1000, height: 700 });
    setMainWindow(win);

    // Turn ghost mode ON
    toggleGhostMode(win, true);
    const state = getState(win);

    if (process.platform !== 'linux') {
      assert.ok(state.ghostTimer, '60s auto-restore timer armed');
      assert.equal(win.isIgnoreMouseEvents(), true);

      // Trigger keep-ghost hotkey (CmdOrCtrl+Shift+K)
      const res = keepGhostMode(win);
      assert.equal(res.success, true);
      assert.equal(state.keepGhost, true, 'keepGhost flag set');
      assert.equal(state.ghostTimer, null, '60s auto-restore timer disarmed by keep-ghost');
      assert.equal(win.isIgnoreMouseEvents(), true, 'Window stays in click-through mode indefinitely');
    }

    // Toggle off cleans up keep-ghost
    toggleGhostMode(win, false);
    assert.equal(state.keepGhost, false);

    win.close();
    setMainWindow(null);
  });

  await t.test('9. Linux does not support forward:true: ghost mode uses opacity only with no click-through', () => {
    const win = new MockBrowserWindow({ width: 1000, height: 700 });
    setMainWindow(win);

    const prevPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    try {
      const res = toggleGhostMode(win, true);
      assert.equal(res.isGhostMode, true);
      assert.equal(res.isLinux, true);
      assert.equal(res.clickThrough, false, 'Click-through is disabled on Linux');
      assert.equal(win.isIgnoreMouseEvents(), false, 'Linux must not call setIgnoreMouseEvents(true)');
      assert.equal(win.getOpacity(), 0.40, 'Opacity was still applied on Linux');

      toggleGhostMode(win, false);
      assert.equal(win.isIgnoreMouseEvents(), false);
      assert.equal(win.getOpacity(), 1.0);
    } finally {
      Object.defineProperty(process, 'platform', { value: prevPlatform, configurable: true });
      win.close();
      setMainWindow(null);
    }
  });

  await t.test('10. ipcMain set-ignore-mouse-events validation: rejects non-boolean ignore and non-boolean options.forward', () => {
    const win = new MockBrowserWindow({ width: 1000, height: 700 });
    setMainWindow(win);

    const listener = ipcListeners.get('set-ignore-mouse-events');
    assert.ok(listener, 'set-ignore-mouse-events listener registered');

    const trustedEvent = {
      sender: {
        getURL: () => 'http://localhost:3000?electron=1'
      }
    };

    // Toggle ghost mode on first so ignore mouse events is permitted
    getState(win).ghost = true;

    // 1. Non-boolean ignore -> rejected
    win.setIgnoreMouseEvents(false);
    listener(trustedEvent, 'true', { forward: true });
    assert.equal(win.isIgnoreMouseEvents(), false, 'String ignore rejected');

    listener(trustedEvent, null, { forward: true });
    assert.equal(win.isIgnoreMouseEvents(), false, 'null ignore rejected');

    // 2. Non-boolean options.forward -> rejected
    listener(trustedEvent, true, { forward: 'yes' });
    assert.equal(win.isIgnoreMouseEvents(), false, 'Invalid forward string rejected');

    listener(trustedEvent, true, { forward: 1 });
    assert.equal(win.isIgnoreMouseEvents(), false, 'Invalid forward number rejected');

    // 3. Valid call (on non-linux)
    if (process.platform !== 'linux') {
      listener(trustedEvent, true, { forward: true });
      assert.equal(win.isIgnoreMouseEvents(), true, 'Valid boolean options accepted');
    }

    win.close();
    setMainWindow(null);
  });

  await t.test('11. setOpacity platform unavailability fallback without crashing', () => {
    // Window where setOpacity is unavailable
    const winNoOpacity = new MockBrowserWindow({ customSetOpacity: null });
    setMainWindow(winNoOpacity);

    const supported = safeSetOpacity(winNoOpacity, 0.50);
    assert.equal(supported, false, 'safeSetOpacity reports unsupported when setOpacity is null');

    const res = setWindowOpacity(winNoOpacity, 0.50);
    assert.equal(res.opacitySupported, false, 'setWindowOpacity reports opacitySupported: false');
    assert.equal(res.opacity, 0.50, 'State still tracks intended target opacity safely');

    // Window where setOpacity throws an error
    const winThrowingOpacity = new MockBrowserWindow({
      customSetOpacity: () => { throw new Error('Platform does not support window translucency'); }
    });
    const supported2 = safeSetOpacity(winThrowingOpacity, 0.50);
    assert.equal(supported2, false, 'safeSetOpacity catches throw and reports false safely');

    winNoOpacity.close();
    winThrowingOpacity.close();
    setMainWindow(null);
  });

  await t.test('12. Opt-in blur-loss failsafe: restores mouse interaction on window blur only when enabled', () => {
    const win = new MockBrowserWindow();
    setMainWindow(win);

    // Initial state: restoreOnBlur is false by default
    assert.equal(getRestoreGhostOnBlur(win), false, 'restoreOnBlur is false by default');

    // 1. Enter Ghost Mode
    toggleGhostMode(win, true);
    assert.equal(getState(win).ghost, true, 'Window is in Ghost Mode');
    if (process.platform !== 'linux') {
      assert.equal(win.isIgnoreMouseEvents(), true, 'Window is ignoring mouse events (click-through)');
    }

    // 2. Trigger blur while restoreOnBlur is FALSE -> click-through MUST remain active!
    handleWindowBlur(win);
    assert.equal(getState(win).ghost, true, 'Window remains in Ghost Mode across blur when opt-in is false');
    if (process.platform !== 'linux') {
      assert.equal(win.isIgnoreMouseEvents(), true, 'Click-through remains active across blur');
    }

    // 3. Opt in to blur-loss failsafe
    setRestoreGhostOnBlur(true, win);
    assert.equal(getRestoreGhostOnBlur(win), true, 'restoreOnBlur is now true');

    // 4. Trigger blur while restoreOnBlur is TRUE -> immediately exits Ghost Mode & restores mouse
    handleWindowBlur(win);
    assert.equal(getState(win).ghost, false, 'Window exited Ghost Mode on blur when opt-in is true');
    assert.equal(win.isIgnoreMouseEvents(), false, 'Mouse interaction restored on blur');

    // Reset opt-in back to false
    setRestoreGhostOnBlur(false, win);
    win.close();
    setMainWindow(null);
  });

  await t.test('13. Fullscreen state management & IPC controls', async () => {
    const win = new MockBrowserWindow();
    setMainWindow(win);

    // Initial state: not fullscreen
    assert.equal(win.isFullScreen(), false, 'Window is initially not fullscreen');

    // 1. setWindowFullScreen(win, true) enters fullscreen
    let enteredFsFired = false;
    win.on('enter-full-screen', () => { enteredFsFired = true; });
    const res1 = setWindowFullScreen(win, true);
    assert.equal(res1.success, true);
    assert.equal(res1.isFullScreen, true);
    assert.equal(win.isFullScreen(), true, 'Window is now fullscreen');
    assert.equal(enteredFsFired, true, 'enter-full-screen event fired');

    // 2. toggleWindowFullScreen(win) exits fullscreen
    let leftFsFired = false;
    win.on('leave-full-screen', () => { leftFsFired = true; });
    const res2 = toggleWindowFullScreen(win);
    assert.equal(res2.success, true);
    assert.equal(res2.isFullScreen, false);
    assert.equal(win.isFullScreen(), false, 'Window exited fullscreen');
    assert.equal(leftFsFired, true, 'leave-full-screen event fired');

    // 3. If floating mode is active, entering fullscreen auto-disables float mode
    toggleFloatMode(win, true);
    assert.equal(getState(win).floating, true, 'Window is floating');
    const res3 = setWindowFullScreen(win, true);
    assert.equal(res3.success, true);
    assert.equal(res3.isFullScreen, true);
    assert.equal(getState(win).floating, false, 'Floating mode was automatically disabled when entering fullscreen');

    // 4. IPC handlers: verify get-window-state reports isFullScreen
    const getStateHandler = ipcHandlers.get('get-window-state');
    assert.ok(getStateHandler, 'get-window-state handler registered');
    const trustedEvent = { senderFrame: { url: 'http://localhost:3000' } };
    const winState = await getStateHandler(trustedEvent);
    assert.equal(winState.isFullScreen, true, 'get-window-state reports isFullScreen: true');

    // 5. IPC handler set-fullscreen exiting
    const setFsHandler = ipcHandlers.get('set-fullscreen');
    assert.ok(setFsHandler, 'set-fullscreen IPC handler registered');
    await setFsHandler(trustedEvent, false);
    assert.equal(win.isFullScreen(), false, 'IPC set-fullscreen set window to windowed mode');

    win.close();
    setMainWindow(null);
  });

  await t.test('14. Closing/destroying window cleans up without "Object has been destroyed" error on getState or clearGhostAutoRestoreTimer', () => {
    const win = new MockBrowserWindow();
    setMainWindow(win);

    // Initial state creation
    const state = getState(win);
    assert.ok(state, 'Initial state created');

    // Simulate ghost timer running
    state.ghostTimer = setTimeout(() => {}, 60000);

    // Close the window (marks destroyed and emits 'closed')
    win.close();
    assert.equal(win.isDestroyed(), true, 'Window is destroyed');

    // Calling clearGhostAutoRestoreTimer on closed window should NOT throw
    assert.doesNotThrow(() => {
      clearGhostAutoRestoreTimer(win);
    }, 'clearGhostAutoRestoreTimer does not throw on destroyed window');

    // Calling getState on closed/destroyed window should NOT throw Object has been destroyed
    assert.doesNotThrow(() => {
      const deadState = getState(win);
      assert.ok(deadState, 'Returns safe default state');
      assert.equal(deadState.ghost, false);
    }, 'getState does not throw on destroyed window');

    setMainWindow(null);
  });
});
