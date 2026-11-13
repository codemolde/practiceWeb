// ============================================================
// Art Practice Reference Studio — Electron Main Process
// ============================================================

const fs = require('fs');
const path = require('path');

let electronModule;
try {
  electronModule = require('electron');
} catch (e) {
  electronModule = null;
}
const isElectron = typeof electronModule === 'object' && electronModule !== null && !!electronModule.app;
const { app, BrowserWindow, ipcMain, shell, Menu, dialog, globalShortcut, session, Tray, nativeImage } = isElectron ? electronModule : {};

// 1. Configure OS-writable user data directory BEFORE loading server.js
// On macOS: ~/Library/Application Support/<AppName>/userdata
// On Windows: %APPDATA%/<AppName>/userdata
if (isElectron && typeof app.getPath === 'function') {
  process.env.USER_DATA_DIR = process.env.USER_DATA_DIR || path.join(app.getPath('userData'), 'userdata');
} else if (!process.env.USER_DATA_DIR) {
  process.env.USER_DATA_DIR = path.join(__dirname, 'userdata');
}

/**
 * Recursively retrieves all items (files and directories) within a directory.
 * Ignores hidden files (starting with '.') and active temporary files (ending with '.tmp').
 */
function getDirectoryEntriesRecursive(dir, base = '') {
  const entries = [];
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return entries;
  }

  for (const item of items) {
    if (item.name.startsWith('.') || item.name.endsWith('.tmp')) continue;
    const relPath = base ? path.join(base, item.name) : item.name;
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      entries.push({ relPath, fullPath, isDirectory: true });
      entries.push(...getDirectoryEntriesRecursive(fullPath, relPath));
    } else if (item.isFile()) {
      entries.push({ relPath, fullPath, isDirectory: false });
    }
  }

  return entries;
}

/**
 * Clean up leftover temporary (.tmp) files from previously interrupted copies.
 */
function cleanStaleTempFiles(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        cleanStaleTempFiles(fullPath);
      } else if (item.isFile() && item.name.endsWith('.tmp')) {
        try {
          fs.unlinkSync(fullPath);
        } catch (e) { }
      }
    }
  } catch (err) { }
}

/**
 * Atomically copies a file from src to dest using a temp file and fs.renameSync.
 */
function copyFileAtomic(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const tempFile = `${dest}.${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.copyFileSync(src, tempFile);

  try {
    const fd = fs.openSync(tempFile, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (syncErr) {
    // Non-fatal if fsync is unsupported by filesystem
  }

  fs.renameSync(tempFile, dest);
}

/**
 * Checks whether an existing destination file has valid content.
 * For srs_state.json: verifies valid JSON AND treats the file as REPLACEABLE (returns false)
 * if destination has 0 decks and 0 cards while the legacy source file has more.
 * For all other files: verifies that it has size > 0 (or matches source if source is 0).
 */
function isDestinationFileValid(destPath, srcStat, srcPath) {
  if (!fs.existsSync(destPath)) return false;
  try {
    const destStat = fs.statSync(destPath);
    if (srcStat && srcStat.size > 0 && destStat.size === 0) {
      return false; // Incomplete / 0-byte file from crash
    }
    const isStateFile = path.basename(destPath) === 'srs_state.json';
    if (isStateFile || destPath.endsWith('.json')) {
      const raw = fs.readFileSync(destPath, 'utf8');
      const parsed = JSON.parse(raw); // Verify valid JSON

      // Treat srs_state.json as REPLACEABLE if it has 0 decks and 0 cards while legacy has more
      if (isStateFile && srcPath && fs.existsSync(srcPath)) {
        const destDecks = Array.isArray(parsed?.decks) ? parsed.decks.length : (Array.isArray(parsed?.data?.decks) ? parsed.data.decks.length : 0);
        const destCards = (parsed?.cards && typeof parsed.cards === 'object')
          ? Object.keys(parsed.cards).length
          : (parsed?.data?.cards && typeof parsed.data.cards === 'object' ? Object.keys(parsed.data.cards).length : 0);

        if (destDecks === 0 && destCards === 0) {
          try {
            const srcRaw = fs.readFileSync(srcPath, 'utf8');
            const srcParsed = JSON.parse(srcRaw);
            const srcDecks = Array.isArray(srcParsed?.decks) ? srcParsed.decks.length : (Array.isArray(srcParsed?.data?.decks) ? srcParsed.data.decks.length : 0);
            const srcCards = (srcParsed?.cards && typeof srcParsed.cards === 'object')
              ? Object.keys(srcParsed.cards).length
              : (srcParsed?.data?.cards && typeof srcParsed.data.cards === 'object' ? Object.keys(srcParsed.data.cards).length : 0);

            if (srcDecks > 0 || srcCards > 0) {
              return false; // REPLACEABLE: existing dest is empty while legacy has data
            }
          } catch (srcErr) {
            // Non-fatal if src cannot be parsed
          }
        }
      }
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Reliable, resumable, non-destructive migration from legacy repository userdata
 * into Electron's userData directory.
 */
function migrateLegacyRepoUserdata(options = {}) {
  const logger = options.logger || console;
  const legacyDir = options.legacyDir || path.join(__dirname, 'userdata');
  const targetDir = options.targetDir || process.env.USER_DATA_DIR;

  if (!targetDir) {
    logger.warn('[Migration] Target user-data directory not defined; skipping migration.');
    return { success: false, error: 'Target directory not defined' };
  }

  // 1. If source and destination resolve to the identical path, skip
  if (path.resolve(legacyDir) === path.resolve(targetDir)) {
    return { success: true, message: 'Source and destination directories are identical; migration skipped.', migratedFiles: [] };
  }

  const markerFile = path.join(targetDir, '.migrated_v1');

  // 2. Handle missing legacy directory gracefully (Fresh installation)
  if (!fs.existsSync(legacyDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.mkdirSync(path.join(targetDir, 'sketches'), { recursive: true });
      if (!fs.existsSync(markerFile)) {
        const markerData = JSON.stringify({
          migratedAt: new Date().toISOString(),
          version: 1,
          freshInstall: true,
          migratedFiles: []
        }, null, 2);
        fs.writeFileSync(markerFile, markerData, 'utf8');
      }
      logger.log(`[Migration] No legacy userdata directory found at ${legacyDir}. Clean fresh install initialized.`);
      return { success: true, freshInstall: true, migratedFiles: [] };
    } catch (err) {
      logger.error('[Migration] Failed to initialize fresh destination directory:', err);
      return { success: false, error: err.message };
    }
  }

  // 3. Ensure destination directory exists
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    logger.error(`[Migration] Failed to create destination directory "${targetDir}":`, err);
    return { success: false, error: err.message };
  }

  // 4. Clean up any leftover .tmp files from previous interrupted runs
  cleanStaleTempFiles(targetDir);

  // 5. Discover all user data files and directories in legacyDir
  const legacyEntries = getDirectoryEntriesRecursive(legacyDir);

  // If markerFile already exists and is not forced, verify idempotency
  if (fs.existsSync(markerFile) && !options.force) {
    let allPresent = true;
    for (const entry of legacyEntries) {
      const destPath = path.join(targetDir, entry.relPath);
      if (!fs.existsSync(destPath)) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) {
      return { success: true, alreadyCompleted: true, migratedFiles: [] };
    }
    logger.log('[Migration] Completion marker was present but unmigrated legacy files detected; resuming migration.');
  }

  const migratedFiles = [];
  const errors = [];

  // 6. Migrate directories first
  for (const entry of legacyEntries) {
    if (entry.isDirectory) {
      const destDirPath = path.join(targetDir, entry.relPath);
      try {
        if (!fs.existsSync(destDirPath)) {
          fs.mkdirSync(destDirPath, { recursive: true });
        }
      } catch (err) {
        logger.error(`[Migration] Failed to create directory "${destDirPath}":`, err);
        errors.push({ path: destDirPath, error: err.message });
      }
    }
  }

  // 7. Migrate files (non-destructive, atomic, resumable)
  for (const entry of legacyEntries) {
    if (entry.isDirectory) continue;

    const destFilePath = path.join(targetDir, entry.relPath);
    let srcStat;
    try {
      srcStat = fs.statSync(entry.fullPath);
    } catch (err) {
      logger.error(`[Migration] Failed to stat legacy file "${entry.fullPath}":`, err);
      errors.push({ path: entry.fullPath, error: err.message });
      continue;
    }

    // Check if destination file already exists and is valid
    if (fs.existsSync(destFilePath)) {
      if (isDestinationFileValid(destFilePath, srcStat, entry.fullPath)) {
        // Destination already has valid data -> NEVER blindly overwrite!
        // Preserves existing SRS progress and newer destination data.
        continue;
      } else {
        logger.warn(`[Migration] Destination file "${destFilePath}" exists but is empty or invalid JSON. Re-migrating from legacy source.`);
        // Back up the replaced file as srs_state.json.pre-migration before overwriting
        if (path.basename(destFilePath) === 'srs_state.json') {
          try {
            const backupPath = path.join(path.dirname(destFilePath), 'srs_state.json.pre-migration');
            copyFileAtomic(destFilePath, backupPath);
            logger.log(`[Migration] Created pre-migration backup of replaced state file at: ${backupPath}`);
          } catch (backupErr) {
            logger.warn(`[Migration] Failed to create pre-migration backup of "${destFilePath}":`, backupErr.message);
          }
        }
      }
    }

    // Copy atomically using temp file and rename
    try {
      copyFileAtomic(entry.fullPath, destFilePath);
      migratedFiles.push(entry.relPath);
      logger.log(`[Migration] Migrated: ${entry.relPath}`);
    } catch (err) {
      logger.error(`[Migration] Failed to copy "${entry.fullPath}" to "${destFilePath}":`, err);
      errors.push({ path: entry.relPath, error: err.message });
    }
  }

  // 8. Verification pass: Verify all legacy files now exist in destination with valid content
  const verificationFailures = [];
  for (const entry of legacyEntries) {
    const destPath = path.join(targetDir, entry.relPath);
    if (!fs.existsSync(destPath)) {
      verificationFailures.push({ relPath: entry.relPath, reason: 'File or directory missing in destination' });
      continue;
    }
    if (!entry.isDirectory) {
      try {
        const srcStat = fs.statSync(entry.fullPath);
        if (!isDestinationFileValid(destPath, srcStat, entry.fullPath)) {
          verificationFailures.push({ relPath: entry.relPath, reason: 'Destination file corrupted or empty' });
        }
      } catch (err) {
        verificationFailures.push({ relPath: entry.relPath, reason: err.message });
      }
    }
  }

  if (verificationFailures.length > 0 || errors.length > 0) {
    logger.error(`[Migration] Migration incomplete (${verificationFailures.length} verification failure(s), ${errors.length} error(s)). Marker will NOT be written so migration can resume on next launch.`);
    return {
      success: false,
      migratedFiles,
      errors,
      verificationFailures
    };
  }

  // 9. Write completion marker only after all items have been verified
  try {
    const markerData = JSON.stringify({
      migratedAt: new Date().toISOString(),
      version: 1,
      totalEntriesVerified: legacyEntries.length,
      migratedFilesCount: migratedFiles.length,
      migratedFiles
    }, null, 2);

    const tempMarker = `${markerFile}.${Date.now()}.tmp`;
    fs.writeFileSync(tempMarker, markerData, 'utf8');
    fs.renameSync(tempMarker, markerFile);

    logger.log(`[Migration] Legacy userdata migration completed successfully (${migratedFiles.length} file(s) migrated, ${legacyEntries.length} items verified).`);
    return {
      success: true,
      migratedFiles,
      totalVerified: legacyEntries.length
    };
  } catch (err) {
    logger.error('[Migration] Failed to write completion marker:', err);
    return {
      success: false,
      migratedFiles,
      error: 'Failed to write completion marker: ' + err.message
    };
  }
}

if (isElectron) {
  migrateLegacyRepoUserdata();
}

// Load express backend startup helper
let startServer;
if (isElectron) {
  process.env.APP_RUNTIME = 'electron';
  const serverModule = require('./server.js');
  startServer = serverModule.startServer;
}

let mainWindow = null;
let serverInstance = null;
let serverPort = null;
let isWindowFloating = false;
let isWindowAlwaysOnTop = false;
let isWindowGhostMode = false;

const GHOST_MODE_OPACITY = 0.40;
const windowStates = new WeakMap();

/**
 * Retrieves or initializes state for a BrowserWindow.
 * Tracks { floating, normalBounds, alwaysOnTop, ghost, originalOpacity, ghostOpacity }.
 * Automatically registers cleanup on the window's 'closed' event.
 */
function getState(win) {
  if (!win) {
    return {
      floating: false,
      normalBounds: null,
      alwaysOnTop: false,
      ghost: false,
      originalOpacity: 1.0,
      ghostOpacity: GHOST_MODE_OPACITY,
      get isGhostMode() { return this.ghost; },
      set isGhostMode(v) { this.ghost = v; }
    };
  }
  let state = windowStates.get(win);
  if (!state) {
    // If the window has already been destroyed, do NOT invoke native methods (e.g. getOpacity, isAlwaysOnTop)
    const isDestroyed = typeof win.isDestroyed === 'function' ? win.isDestroyed() : false;
    if (isDestroyed) {
      return {
        floating: false,
        normalBounds: null,
        alwaysOnTop: false,
        ghost: false,
        originalOpacity: 1.0,
        ghostOpacity: GHOST_MODE_OPACITY,
        ghostTimer: null,
        keepGhost: false,
        restoreOnBlur: false,
        get isGhostMode() { return this.ghost; },
        set isGhostMode(v) { this.ghost = v; }
      };
    }

    let currentOpacity = 1.0;
    try {
      if (typeof win.getOpacity === 'function') {
        currentOpacity = win.getOpacity();
      }
    } catch (e) {
      currentOpacity = 1.0;
    }

    let isAot = false;
    try {
      if (typeof win.isAlwaysOnTop === 'function') {
        isAot = win.isAlwaysOnTop();
      }
    } catch (e) {
      isAot = false;
    }

    state = {
      floating: false,
      normalBounds: null,
      alwaysOnTop: Boolean(isAot),
      ghost: false,
      originalOpacity: (typeof currentOpacity === 'number' && currentOpacity > 0) ? currentOpacity : 1.0,
      ghostOpacity: GHOST_MODE_OPACITY,
      ghostTimer: null,
      keepGhost: false,
      restoreOnBlur: false,
      get isGhostMode() { return this.ghost; },
      set isGhostMode(v) { this.ghost = v; }
    };
    windowStates.set(win, state);
    if (typeof win.once === 'function') {
      win.once('closed', () => {
        clearGhostAutoRestoreTimer(win);
        windowStates.delete(win);
      });
    }
  }
  return state;
}

/**
 * Retrieve or initialize independent Ghost Mode state for a BrowserWindow.
 * Backward-compatible helper routing through getState(win).
 */
function getWindowGhostState(win) {
  return getState(win);
}

/**
 * Configure native OS Always-on-Top floating state.
 * On macOS, 'floating' level + visibleOnAllWorkspaces guarantees
 * the studio stays visible above fullscreen Photoshop, Blender, and CSP.
 */
function setFloatingMode(win, enabled = true) {
  if (!win || win.isDestroyed()) return;

  if (enabled) {
    win.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setFullScreenable(false);
    }
  } else {
    win.setAlwaysOnTop(false);
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(false);
      win.setFullScreenable(true);
    }
  }
}

/**
 * Configures standard OS Always-on-Top stacking independently of floating mode.
 * Keeps the window above other windows without changing dimensions, position,
 * min size, traffic light buttons, or fullscreen behavior.
 */
function setAlwaysOnTopMode(win, targetState) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) {
    const s = getState(targetWin);
    return {
      isElectron: true,
      isAlwaysOnTop: false,
      floating: s.floating
    };
  }

  const state = getState(targetWin);

  // Handle boolean or toggle if undefined/non-boolean
  const shouldBeOnTop = typeof targetState === 'boolean'
    ? targetState
    : !state.alwaysOnTop;

  state.alwaysOnTop = shouldBeOnTop;

  // Stacking level only: do NOT modify bounds, position, min size, buttons, or fullscreenable
  if (!state.floating && !state.ghost) {
    targetWin.setAlwaysOnTop(shouldBeOnTop, 'floating');
  }

  // Synchronize menu item checkbox if present (for mainWindow only)
  if (targetWin === mainWindow) {
    try {
      const aotMenuItem = Menu?.getApplicationMenu?.()?.getMenuItemById('menu-always-on-top');
      if (aotMenuItem) aotMenuItem.checked = shouldBeOnTop;
    } catch (e) { }
  }

  // Inform renderer webContents
  if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
    targetWin.webContents.executeJavaScript(`
      if (window.UI && typeof window.UI.setAlwaysOnTopState === 'function') {
        window.UI.setAlwaysOnTopState(${shouldBeOnTop});
      }
    `).catch(() => { });
  }

  return {
    isElectron: true,
    isAlwaysOnTop: shouldBeOnTop,
    floating: state.floating
  };
}

/**
 * Turns the window itself into a compact, frameless Always-on-Top floating window
 * or restores it back to standard studio dimensions.
 */
function toggleFloatMode(win, targetState) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) {
    const s = getState(targetWin);
    return {
      isElectron: true,
      floating: false,
      isAlwaysOnTop: s.alwaysOnTop
    };
  }

  const state = getState(targetWin);
  const shouldFloat = typeof targetState === 'boolean' ? targetState : !state.floating;

  if (shouldFloat) {
    if (!state.floating) {
      state.normalBounds = targetWin.getBounds();
    }

    setFloatingMode(targetWin, true);

    let workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    try {
      const electronObj = require('electron');
      const scr = (typeof electronObj === 'object' && electronObj?.screen) ? electronObj.screen : null;
      if (scr && typeof scr.getDisplayMatching === 'function') {
        const display = scr.getDisplayMatching(targetWin.getBounds());
        if (display && display.workArea) workArea = display.workArea;
      }
    } catch (e) { }

    const compactWidth = 480;
    const compactHeight = 620;

    const posX = Math.max(workArea.x + 20, Math.min(workArea.x + workArea.width - compactWidth - 20, (state.normalBounds ? state.normalBounds.x + state.normalBounds.width - compactWidth : workArea.x + workArea.width - compactWidth - 30)));
    const posY = Math.max(workArea.y + 20, Math.min(workArea.y + workArea.height - compactHeight - 20, (state.normalBounds ? state.normalBounds.y : workArea.y + 40)));

    targetWin.setMinimumSize(240, 220);
    targetWin.setBounds({
      x: Math.round(posX),
      y: Math.round(posY),
      width: compactWidth,
      height: compactHeight
    }, true);

    if (process.platform === 'darwin' && typeof targetWin.setWindowButtonVisibility === 'function') {
      targetWin.setWindowButtonVisibility(false);
    }

    state.floating = true;
  } else {
    // If independent always-on-top was explicitly enabled, preserve always-on-top stacking
    if (state.alwaysOnTop) {
      if (process.platform === 'darwin') {
        targetWin.setVisibleOnAllWorkspaces(false);
        targetWin.setFullScreenable(true);
      }
      targetWin.setAlwaysOnTop(true, 'floating');
    } else {
      setFloatingMode(targetWin, false);
    }

    if (process.platform === 'darwin' && typeof targetWin.setWindowButtonVisibility === 'function') {
      targetWin.setWindowButtonVisibility(true);
    }

    targetWin.setMinimumSize(320, 280);
    if (state.normalBounds) {
      targetWin.setBounds(state.normalBounds, true);
    } else {
      targetWin.setSize(1280, 820, true);
      targetWin.center();
    }

    state.floating = false;
  }

  // Synchronize menu item checkbox if present (for mainWindow only)
  if (targetWin === mainWindow) {
    try {
      const floatMenuItem = Menu?.getApplicationMenu?.()?.getMenuItemById('menu-float-mode');
      if (floatMenuItem) floatMenuItem.checked = state.floating;
    } catch (e) { }
  }

  // Inform renderer webContents
  if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
    targetWin.webContents.executeJavaScript(`
      if (window.UI && typeof window.UI.setElectronFloatState === 'function') {
        window.UI.setElectronFloatState(${state.floating});
      }
    `).catch(() => { });
  }

  return {
    isElectron: true,
    floating: state.floating,
    isAlwaysOnTop: targetWin.isAlwaysOnTop()
  };
}

/**
 * Sets or exits native OS fullscreen for a window.
 * Ensures macOS fullScreenable capability is restored if previously disabled by floating mode.
 */
function setWindowFullScreen(win, flag) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) {
    return { success: false, isFullScreen: false };
  }

  const shouldBeFullScreen = Boolean(flag);

  // If entering fullscreen while floating mode is active, disable float mode first
  const state = getState(targetWin);
  if (shouldBeFullScreen && state.floating) {
    toggleFloatMode(targetWin, false);
  }

  if (process.platform === 'darwin' && typeof targetWin.setFullScreenable === 'function') {
    targetWin.setFullScreenable(true);
  }

  if (typeof targetWin.setFullScreen === 'function') {
    targetWin.setFullScreen(shouldBeFullScreen);
  }

  const isFs = typeof targetWin.isFullScreen === 'function' ? targetWin.isFullScreen() : shouldBeFullScreen;
  return { success: true, isFullScreen: isFs };
}

function toggleWindowFullScreen(win) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) {
    return { success: false, isFullScreen: false };
  }
  const current = typeof targetWin.isFullScreen === 'function' ? targetWin.isFullScreen() : false;
  return setWindowFullScreen(targetWin, !current);
}

/**
 * Safely sets window opacity with platform capability check.
 * Reports warning and falls back safely if setOpacity is not available.
 */
function safeSetOpacity(win, opacity) {
  if (!win || win.isDestroyed()) return false;
  if (typeof win.setOpacity !== 'function') {
    console.warn('[Electron] setOpacity is unavailable on this platform or window.');
    return false;
  }
  try {
    win.setOpacity(opacity);
    return true;
  } catch (err) {
    console.warn('[Electron] Error calling setOpacity:', err.message);
    return false;
  }
}

let appTray = null;

function setupTray() {
  if (!isElectron || !Tray) return;
  if (appTray) return;
  try {
    let icon = null;
    if (nativeImage && typeof nativeImage.createFromBuffer === 'function') {
      const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      icon = nativeImage.createFromBuffer(transparentPng);
    } else if (nativeImage && typeof nativeImage.createEmpty === 'function') {
      icon = nativeImage.createEmpty();
    }
    if (!icon) return;

    appTray = new Tray(icon);
    appTray.setToolTip('Art Practice Reference Studio');
    updateTrayMenu();
  } catch (err) {
    console.warn('[Electron] Failed to initialize tray:', err.message);
  }
}

function updateTrayMenu() {
  if (!appTray) return;
  try {
    const isGhost = mainWindow && !mainWindow.isDestroyed() ? Boolean(getState(mainWindow).ghost) : false;
    const contextMenu = Menu.buildFromTemplate([
      {
        id: 'tray-exit-ghost-mode',
        label: 'Exit Ghost Mode',
        enabled: isGhost,
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            toggleGhostMode(mainWindow, false);
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Studio',
        click: () => {
          if (app && typeof app.quit === 'function') {
            app.quit();
          }
        }
      }
    ]);
    appTray.setContextMenu(contextMenu);
  } catch (err) {
    console.warn('[Electron] Failed to update tray menu:', err.message);
  }
}

const GHOST_OPACITY_SHORTCUTS = [
  { key: 'CmdOrCtrl+Shift+Up', handler: () => mainWindow && !mainWindow.isDestroyed() && adjustWindowOpacity(mainWindow, 0.10) },
  { key: 'CmdOrCtrl+Shift+Down', handler: () => mainWindow && !mainWindow.isDestroyed() && adjustWindowOpacity(mainWindow, -0.10) },
  { key: 'CmdOrCtrl+Shift+]', handler: () => mainWindow && !mainWindow.isDestroyed() && adjustWindowOpacity(mainWindow, 0.10) },
  { key: 'CmdOrCtrl+Shift+[', handler: () => mainWindow && !mainWindow.isDestroyed() && adjustWindowOpacity(mainWindow, -0.10) },
  { key: 'CmdOrCtrl+Shift+O', handler: () => mainWindow && !mainWindow.isDestroyed() && cycleWindowOpacity(mainWindow) },
  { key: 'CmdOrCtrl+Shift+K', handler: () => mainWindow && !mainWindow.isDestroyed() && keepGhostMode(mainWindow) }
];

let ghostShortcutsRegistered = false;

function registerGhostModeShortcuts() {
  if (!globalShortcut || typeof globalShortcut.register !== 'function') return;
  if (ghostShortcutsRegistered) return;
  for (const { key, handler } of GHOST_OPACITY_SHORTCUTS) {
    try {
      globalShortcut.register(key, handler);
    } catch (err) {
      console.warn(`[Electron] Failed to register ghost shortcut ${key}:`, err.message);
    }
  }
  ghostShortcutsRegistered = true;
}

function unregisterGhostModeShortcuts() {
  if (!globalShortcut || typeof globalShortcut.unregister !== 'function') return;
  if (!ghostShortcutsRegistered) return;
  for (const { key } of GHOST_OPACITY_SHORTCUTS) {
    try {
      globalShortcut.unregister(key);
    } catch (err) {
      console.warn(`[Electron] Failed to unregister ghost shortcut ${key}:`, err.message);
    }
  }
  ghostShortcutsRegistered = false;
}

function startGhostAutoRestoreTimer(win) {
  const state = getState(win);
  clearGhostAutoRestoreTimer(win);
  state.keepGhost = false;

  state.ghostTimer = setTimeout(() => {
    if (win && !win.isDestroyed() && state.ghost && !state.keepGhost) {
      console.warn('[Electron] Ghost Mode 60s failsafe auto-restored mouse interaction.');
      try {
        win.setIgnoreMouseEvents(false);
      } catch (e) { }
      if (win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('shortcut:action', 'ghost-mouse-restored');
        win.webContents.executeJavaScript(`
          if (window.UI && typeof window.UI.showToast === 'function') {
            window.UI.showToast('Mouse interaction auto-restored (60s failsafe)', 'info');
          }
        `).catch(() => { });
      }
    }
  }, 60000);
}

function clearGhostAutoRestoreTimer(win) {
  if (!win) return;
  const state = windowStates.get(win);
  if (state && state.ghostTimer) {
    clearTimeout(state.ghostTimer);
    state.ghostTimer = null;
  }
}

function keepGhostMode(win) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) return { success: false };
  const state = getState(targetWin);
  if (!state.ghost) return { success: false, isGhostMode: false };

  state.keepGhost = true;
  clearGhostAutoRestoreTimer(targetWin);

  if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
    targetWin.webContents.send('shortcut:action', 'keep-ghost-activated');
    targetWin.webContents.executeJavaScript(`
      if (window.UI && typeof window.UI.showToast === 'function') {
        window.UI.showToast('Ghost Mode timer disarmed (staying in Ghost Mode) [Cmd+Shift+K]', 'check');
      }
    `).catch(() => { });
  }
  return { success: true, isGhostMode: true, keepGhost: true };
}

let globalRestoreGhostOnBlur = false;

/**
 * Configure opt-in failsafe: exit Ghost Mode / restore mouse interaction on window blur (focus loss).
 * When disabled (default): mouse click-through remains active across focus loss (e.g. while drawing
 * in Photoshop or Blender underneath), relying on the 60s auto-restore timer, Tray icon, and Cmd+Shift+G.
 * When enabled (opt-in): losing focus immediately restores mouse interaction and exits Ghost Mode.
 */
function setRestoreGhostOnBlur(enabled, win) {
  const bool = Boolean(enabled);
  globalRestoreGhostOnBlur = bool;
  if (win && !win.isDestroyed()) {
    getState(win).restoreOnBlur = bool;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    getState(mainWindow).restoreOnBlur = bool;
  }
  try {
    const item = Menu?.getApplicationMenu?.()?.getMenuItemById('menu-ghost-restore-on-blur');
    if (item) item.checked = bool;
  } catch (e) { }
  return { isElectron: true, restoreGhostOnBlur: bool };
}

function getRestoreGhostOnBlur(win) {
  if (win && !win.isDestroyed()) {
    const s = getState(win);
    if (typeof s.restoreOnBlur === 'boolean') return s.restoreOnBlur;
  }
  return globalRestoreGhostOnBlur;
}

function handleWindowBlur(win) {
  if (!win || win.isDestroyed()) return;
  const state = getState(win);
  const shouldRestore = Boolean(state.restoreOnBlur || globalRestoreGhostOnBlur);
  if (state.ghost && shouldRestore && !state.keepGhost) {
    console.info('[Electron] Window focus lost with restoreGhostOnBlur enabled: exiting Ghost Mode');
    toggleGhostMode(win, false);
  }
}

/**
 * Sets window opacity to an exact target (0.10 to 1.00).
 * If the window is currently in Ghost Mode, updates ghostOpacity preference.
 * If the window is in normal mode, updates originalOpacity.
 */
function setWindowOpacity(win, targetOpacity) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) return;

  const opacity = Math.max(0.10, Math.min(1.00, Math.round(targetOpacity * 100) / 100));
  const supported = safeSetOpacity(targetWin, opacity);

  const state = getState(targetWin);
  if (state.ghost) {
    state.ghostOpacity = opacity;
  } else {
    state.originalOpacity = opacity;
  }

  if (!supported) {
    if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
      targetWin.webContents.executeJavaScript(`
        if (window.UI && typeof window.UI.showToast === 'function') {
          window.UI.showToast('Window opacity is unavailable on this platform.', 'alert');
        }
      `).catch(() => { });
    }
  }

  // Inform renderer to display the transient, auto-hiding Opacity HUD
  if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
    targetWin.webContents.executeJavaScript(`
      if (window.UI && typeof window.UI.showOpacityHUD === 'function') {
        window.UI.showOpacityHUD(${opacity}, ${state.ghost});
      }
    `).catch(() => { });

    targetWin.webContents.send('shortcut:action', 'opacity-changed', {
      opacity,
      isGhostMode: state.ghost
    });
  }

  return {
    isElectron: true,
    opacity,
    isGhostMode: state.ghost,
    opacitySupported: supported
  };
}

/**
 * Adjusts window opacity by a delta (e.g. +0.10 or -0.10).
 */
function adjustWindowOpacity(win, delta) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) return;

  const current = typeof targetWin.getOpacity === 'function' ? targetWin.getOpacity() : 1.0;
  const rawTarget = Math.round((current + delta) * 100) / 100;
  const target = Math.max(0.10, Math.min(1.00, rawTarget));
  return setWindowOpacity(targetWin, target);
}

/**
 * Cycles window opacity across convenient presets (20%, 40%, 60%, 80%, 100%).
 */
function cycleWindowOpacity(win) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) return;

  const current = typeof targetWin.getOpacity === 'function' ? targetWin.getOpacity() : 1.0;
  const presets = [0.20, 0.40, 0.60, 0.80, 1.00];
  let next = presets.find(p => p > current + 0.05);
  if (!next) next = presets[0];

  return setWindowOpacity(targetWin, next);
}

/**
 * Toggles Ghost Mode (click-through overlay for drawing through reference).
 * When active:
 * - Passes mouse clicks through to windows underneath (e.g. Photoshop/Blender),
 *   while forwarding mouse move events so hover-restore remains possible.
 * - Makes the window translucent (~40% opacity or user preferred) so the artwork underneath is visible.
 * - Stacks the window on top ('floating' level) while active.
 * When deactivated:
 * - Restores original opacity safely without progressive degradation.
 * - Restores normal mouse interaction.
 * - Restores prior always-on-top state.
 */
function toggleGhostMode(win, targetState) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) {
    const s = getState(targetWin);
    return {
      isElectron: true,
      isGhostMode: false,
      isAlwaysOnTop: s.alwaysOnTop,
      floating: s.floating,
      error: 'Window not found'
    };
  }

  try {
    const state = getState(targetWin);
    const shouldGhost = typeof targetState === 'boolean'
      ? targetState
      : !state.ghost;

    const isLinux = process.platform === 'linux';

    if (shouldGhost) {
      // 1. Capture original opacity only when transitioning from non-ghost mode
      // (prevents repeated toggles from overwriting saved original opacity)
      if (!state.ghost) {
        const currentOpacity = typeof targetWin.getOpacity === 'function' ? targetWin.getOpacity() : 1.0;
        state.originalOpacity = (typeof currentOpacity === 'number' && currentOpacity > 0)
          ? currentOpacity
          : 1.0;
        state.ghost = true;
      }

      // 2. Set translucent opacity (~40% or user preference) safely
      const targetGhostOpacity = (typeof state.ghostOpacity === 'number' && state.ghostOpacity > 0)
        ? state.ghostOpacity
        : GHOST_MODE_OPACITY;
      safeSetOpacity(targetWin, targetGhostOpacity);

      // 3. Ensure window is always on top while in ghost mode so it remains visible above drawing app
      targetWin.setAlwaysOnTop(true, 'floating');

      // 4. Pass mouse clicks through, but forward moves to allow hover-exit (not supported on Linux)
      if (!isLinux) {
        targetWin.setIgnoreMouseEvents(true, { forward: true });
        startGhostAutoRestoreTimer(targetWin);
      } else {
        console.info('[Electron] Linux detected: ghost mode uses opacity only (click-through disabled).');
      }

      // 5. Register opacity shortcuts while ghost mode is active on mainWindow
      if (targetWin === mainWindow) {
        registerGhostModeShortcuts();
      }
    } else {
      // 1. Restore original opacity safely
      const restoreOpacity = (typeof state.originalOpacity === 'number' && state.originalOpacity > 0)
        ? state.originalOpacity
        : 1.0;
      safeSetOpacity(targetWin, restoreOpacity);
      state.ghost = false;

      // 2. Restore normal mouse interaction & clear timer
      targetWin.setIgnoreMouseEvents(false);
      clearGhostAutoRestoreTimer(targetWin);
      state.keepGhost = false;

      // 3. Unregister ghost opacity shortcuts when ghost mode ends on mainWindow
      if (targetWin === mainWindow) {
        unregisterGhostModeShortcuts();
      }

      // 4. Restore always-on-top state to prior state
      if (state.alwaysOnTop || state.floating) {
        targetWin.setAlwaysOnTop(true, 'floating');
      } else {
        targetWin.setAlwaysOnTop(false);
      }
    }

    // Synchronize menu item checkbox if present (for mainWindow only)
    if (targetWin === mainWindow) {
      try {
        const ghostMenuItem = Menu?.getApplicationMenu?.()?.getMenuItemById('menu-ghost-mode');
        if (ghostMenuItem) ghostMenuItem.checked = state.ghost;
      } catch (e) { }
      updateTrayMenu();
    }

    // Inform renderer webContents
    if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
      targetWin.webContents.executeJavaScript(`
        if (window.UI && typeof window.UI.setGhostModeState === 'function') {
          window.UI.setGhostModeState(${shouldGhost});
        }
        if (${shouldGhost} && ${isLinux}) {
          if (window.UI && typeof window.UI.showToast === 'function') {
            window.UI.showToast('Ghost Mode active (translucent opacity only; click-through is not supported on Linux)', 'ghost');
          }
        }
      `).catch(() => { });

      targetWin.webContents.send('shortcut:action', shouldGhost ? 'ghost-mode-enabled' : 'ghost-mode-disabled', {
        isLinux,
        clickThrough: !isLinux && shouldGhost
      });
    }

    return {
      isElectron: true,
      isGhostMode: shouldGhost,
      isAlwaysOnTop: targetWin.isAlwaysOnTop(),
      floating: state.floating,
      isLinux,
      clickThrough: !isLinux && shouldGhost,
      opacity: typeof targetWin.getOpacity === 'function' ? targetWin.getOpacity() : (shouldGhost ? GHOST_MODE_OPACITY : 1.0)
    };
  } catch (err) {
    console.error('[Electron] Error in toggleGhostMode:', err);
    const s = getState(targetWin);
    return {
      isElectron: true,
      isGhostMode: false,
      isAlwaysOnTop: targetWin.isAlwaysOnTop(),
      floating: s.floating,
      error: err.message
    };
  }
}


/**
 * Starts the internal Express server:
 * Attempts port 3000 first, falling back to dynamic port (0) if busy.
 */
async function initializeServer() {
  try {
    const res = await startServer(3000);
    return res;
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.log('[Electron] Port 3000 is occupied; binding to available dynamic port...');
      return await startServer(0);
    }
    throw err;
  }
}

/**
 * Strict validator for application origin.
 * Confirms that a URL matches the active Express instance on http://localhost:port or http://127.0.0.1:port.
 * Does not trust arbitrary localhost ports or deceptive hostnames.
 */
function isTrustedAppUrl(rawUrl, trustedPort) {
  if (!rawUrl || !trustedPort) return false;
  try {
    const parsed = new URL(rawUrl);
    const isHttp = parsed.protocol === 'http:';
    const isHostLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isPortMatch = String(parsed.port || '80') === String(trustedPort);
    return isHttp && isHostLocal && isPortMatch;
  } catch (err) {
    return false;
  }
}

/**
 * Opens an external URL in the user's default OS browser only after validating
 * that the scheme is strictly http: or https:, catching and logging any errors.
 */
async function safeOpenExternal(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn('[Security] Refused to open unsafe external protocol:', parsed.protocol, rawUrl);
      return false;
    }
    if (isElectron && shell && typeof shell.openExternal === 'function') {
      await shell.openExternal(rawUrl);
    }
    return true;
  } catch (err) {
    console.error('[Security] Failed to open external URL:', rawUrl, err.message);
    return false;
  }
}

function getEffectiveServerPort() {
  if (serverPort) return serverPort;
  try {
    const s = require('./server.js');
    if (s && s.app && typeof s.app.get === 'function') {
      const p = s.app.get('port');
      if (p) return p;
    }
  } catch (e) { }
  return null;
}

function setServerPort(port) {
  serverPort = port;
}

function setMainWindow(win) {
  mainWindow = win;
}

function getMainWindow() {
  return mainWindow;
}

/**
 * Validates that an IPC invocation originated from a trusted internal frame.
 */
function isTrustedIpcSender(event, trustedPort) {
  if (!event) return false;
  const port = trustedPort || getEffectiveServerPort();
  const senderFrame = event.senderFrame;
  const senderUrl = (senderFrame && senderFrame.url) || (event.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');

  // Allow about:blank ONLY if the sender window is explicitly our primary mainWindow
  if (!senderUrl || senderUrl === 'about:blank') {
    const win = (event.sender && BrowserWindow && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : null;
    return Boolean(mainWindow && win && win === mainWindow);
  }

  return isTrustedAppUrl(senderUrl, port);
}

/**
 * Creates the primary studio BrowserWindow with dark atelier theme.
 */
function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 320,
    minHeight: 280,
    backgroundColor: '#121212',
    title: 'Art Practice Reference Studio',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.env.DEVTOOLS || process.argv.includes('--devtools') || process.argv.includes('--debug')) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Load the running Express application (with ?electron=1 parameter for instant detection)
  mainWindow.loadURL(`http://localhost:${port}?electron=1`);

  // Intercept window.open / Document PiP child windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 1. Allow legitimate internal popups (empty, about:blank, or matching our active server port)
    const isBlank = !url || url === 'about:blank';
    const isInternal = isTrustedAppUrl(url, port);

    if (isBlank || isInternal) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 540,
          height: 640,
          minWidth: 260,
          minHeight: 240,
          backgroundColor: '#121212',
          alwaysOnTop: true,
          title: 'Reference PiP — Art Practice',
          titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
          trafficLightPosition: { x: 10, y: 10 },
          webPreferences: {
            preload: path.join(__dirname, 'child-preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false
          }
        }
      };
    }

    // 2. Safely delegate external links (http/https) to default OS browser
    safeOpenExternal(url);
    return { action: 'deny' };
  });

  // Block unexpected navigation away from trusted origin in the main window
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedAppUrl(navigationUrl, port)) {
      event.preventDefault();
      console.warn('[Security] Prevented unexpected navigation in main window to:', navigationUrl);
      safeOpenExternal(navigationUrl);
    }
  });

  // Block unexpected HTTP 30x redirects away from trusted origin in the main window
  mainWindow.webContents.on('will-redirect', (event, redirectUrl) => {
    if (!isTrustedAppUrl(redirectUrl, port)) {
      event.preventDefault();
      console.warn('[Security] Prevented unexpected redirect in main window to:', redirectUrl);
      safeOpenExternal(redirectUrl);
    }
  });

  // When a PiP child window is created, apply macOS system-level floating across Spaces
  mainWindow.webContents.on('did-create-window', (childWindow) => {
    setFloatingMode(childWindow, true);
    const childState = getState(childWindow);
    childState.alwaysOnTop = true;
    if (typeof childWindow.once === 'function') {
      childWindow.once('closed', () => {
        windowStates.delete(childWindow);
      });
    }

    // Child windows must never open secondary popups
    childWindow.webContents.setWindowOpenHandler(({ url }) => {
      safeOpenExternal(url);
      return { action: 'deny' };
    });

    // Prevent child window from navigating away from blank or trusted application origin
    childWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      if (navigationUrl !== 'about:blank' && !isTrustedAppUrl(navigationUrl, port)) {
        event.preventDefault();
        console.warn('[Security] Prevented unexpected navigation in child window to:', navigationUrl);
        safeOpenExternal(navigationUrl);
      }
    });

    // Prevent child window from redirecting away from blank or trusted application origin
    childWindow.webContents.on('will-redirect', (event, redirectUrl) => {
      if (redirectUrl !== 'about:blank' && !isTrustedAppUrl(redirectUrl, port)) {
        event.preventDefault();
        console.warn('[Security] Prevented unexpected redirect in child window to:', redirectUrl);
        safeOpenExternal(redirectUrl);
      }
    });

    childWindow.on('blur', () => {
      handleWindowBlur(childWindow);
    });

    childWindow.on('close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      }
    });
  });

  // Handle HTML5 Fullscreen requests (e.g. document.documentElement.requestFullscreen())
  mainWindow.webContents.on('enter-html-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      setWindowFullScreen(mainWindow, true);
    }
  });

  mainWindow.webContents.on('leave-html-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      setWindowFullScreen(mainWindow, false);
    }
  });

  // Notify renderer when native window enters or leaves full screen
  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-change', true);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-change', false);
    }
  });

  mainWindow.on('blur', () => {
    handleWindowBlur(mainWindow);
  });

  mainWindow.on('closed', () => {
    if (mainWindow) {
      clearGhostAutoRestoreTimer(mainWindow);
      windowStates.delete(mainWindow);
    }
    mainWindow = null;
    unregisterGhostModeShortcuts();
    updateTrayMenu();
  });
}

/**
 * Build native application menu with keyboard shortcuts
 */
function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          id: 'menu-always-on-top',
          label: 'Always on Top',
          type: 'checkbox',
          checked: false,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              const res = setAlwaysOnTopMode(mainWindow);
              const aotMenuItem = Menu?.getApplicationMenu?.()?.getMenuItemById('menu-always-on-top');
              if (aotMenuItem) aotMenuItem.checked = Boolean(res?.isAlwaysOnTop);
            }
          }
        },
        {
          id: 'menu-float-mode',
          label: 'Float Above Other Apps (Always-on-Top)',
          accelerator: 'CmdOrCtrl+Shift+A',
          type: 'checkbox',
          checked: false,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              const res = toggleFloatMode(mainWindow);
              const floatMenuItem = Menu?.getApplicationMenu?.()?.getMenuItemById('menu-float-mode');
              if (floatMenuItem) floatMenuItem.checked = Boolean(res?.floating);
            }
          }
        },
        {
          id: 'menu-ghost-mode',
          label: 'Ghost Mode (Click-Through Overlay)',
          type: 'checkbox',
          checked: false,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              const res = toggleGhostMode(mainWindow);
              const ghostMenuItem = Menu?.getApplicationMenu?.()?.getMenuItemById('menu-ghost-mode');
              if (ghostMenuItem) ghostMenuItem.checked = Boolean(res?.isGhostMode);
            }
          }
        },
        {
          id: 'menu-ghost-restore-on-blur',
          label: 'Exit Ghost Mode on Focus Loss',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            setRestoreGhostOnBlur(Boolean(menuItem.checked));
          }
        },
        { type: 'separator' },
        {
          id: 'menu-opacity-increase',
          label: 'Increase Opacity (+10%)',
          accelerator: 'CmdOrCtrl+Shift+Up',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) adjustWindowOpacity(mainWindow, 0.10);
          }
        },
        {
          id: 'menu-opacity-decrease',
          label: 'Decrease Opacity (-10%)',
          accelerator: 'CmdOrCtrl+Shift+Down',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) adjustWindowOpacity(mainWindow, -0.10);
          }
        },
        {
          id: 'menu-opacity-cycle',
          label: 'Cycle Opacity Preset',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) cycleWindowOpacity(mainWindow);
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers for frontend float / always-on-top requests
if (isElectron && ipcMain) {
  ipcMain.handle('get-window-state', (event) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized get-window-state');
      return { isElectron: false, floating: false, isAlwaysOnTop: false, isGhostMode: false, error: 'Unauthorized' };
    }
    const win = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : mainWindow;
    const state = getState(win || mainWindow);
    const currentAot = win && !win.isDestroyed() && typeof win.isAlwaysOnTop === 'function' ? win.isAlwaysOnTop() : state.alwaysOnTop;
    const currentFs = win && !win.isDestroyed() && typeof win.isFullScreen === 'function' ? win.isFullScreen() : false;
    return {
      isElectron: true,
      floating: Boolean(state.floating),
      isAlwaysOnTop: Boolean(currentAot),
      isGhostMode: Boolean(state.isGhostMode),
      isFullScreen: Boolean(currentFs),
      isLinux: process.platform === 'linux',
      isClickThroughSupported: process.platform !== 'linux',
      restoreGhostOnBlur: getRestoreGhostOnBlur(win || mainWindow)
    };
  });

  ipcMain.handle('dialog:pick-directory', async (event) => {
    // Sensitive capability: only permit from trusted origin and specifically the primary mainWindow
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized dialog:pick-directory from untrusted sender');
      return { canceled: true, path: null, error: 'Unauthorized IPC sender' };
    }
    const callingWin = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : null;
    if (callingWin && mainWindow && callingWin !== mainWindow) {
      console.warn('[Security] Blocked dialog:pick-directory called from non-main child window');
      return { canceled: true, path: null, error: 'Directory picking only permitted from main window' };
    }

    const result = await dialog.showOpenDialog(mainWindow || callingWin, {
      title: 'Select Reference Folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }
    const pickedPath = result.filePaths[0];
    const { registerTrustedFolder } = require('./server.js');
    registerTrustedFolder(pickedPath);
    return { canceled: false, path: pickedPath };
  });

  ipcMain.handle('toggle-float-mode', (event, flag) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized toggle-float-mode');
      return { isElectron: true, floating: false, error: 'Unauthorized' };
    }
    const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : mainWindow;
    return toggleFloatMode(win || mainWindow, flag);
  });

  ipcMain.handle('set-always-on-top', (event, flag) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized set-always-on-top');
      return { isElectron: true, alwaysOnTop: false, error: 'Unauthorized' };
    }
    const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : mainWindow;
    return setAlwaysOnTopMode(win || mainWindow, flag);
  });

  ipcMain.on('set-always-on-top', (event, flag) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized set-always-on-top event');
      return;
    }
    const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : mainWindow;
    setAlwaysOnTopMode(win || mainWindow, flag);
  });

  ipcMain.handle('is-always-on-top', (event) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      return false;
    }
    const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : mainWindow;
    if (!win || win.isDestroyed()) return false;
    return win.isAlwaysOnTop();
  });

  ipcMain.handle('toggle-ghost-mode', (event, flag) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized toggle-ghost-mode');
      return { isElectron: true, isGhostMode: false, error: 'Unauthorized' };
    }
    const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : mainWindow;
    return toggleGhostMode(win || mainWindow, flag);
  });

  ipcMain.handle('adjust-opacity', (event, delta) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized adjust-opacity');
      return { isElectron: true, error: 'Unauthorized' };
    }
    const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : mainWindow;
    return adjustWindowOpacity(win || mainWindow, typeof delta === 'number' ? delta : 0.10);
  });

  ipcMain.handle('set-opacity', (event, targetOpacity) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized set-opacity');
      return { isElectron: true, error: 'Unauthorized' };
    }
    const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : mainWindow;
    return setWindowOpacity(win || mainWindow, targetOpacity);
  });

  ipcMain.handle('keep-ghost-mode', (event) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      return { success: false, error: 'Unauthorized' };
    }
    const win = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : mainWindow;
    return keepGhostMode(win || mainWindow);
  });

  ipcMain.handle('set-restore-ghost-on-blur', (event, flag) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized set-restore-ghost-on-blur');
      return { isElectron: true, error: 'Unauthorized' };
    }
    const win = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : mainWindow;
    return setRestoreGhostOnBlur(flag, win || mainWindow);
  });

  ipcMain.handle('get-restore-ghost-on-blur', (event) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      return false;
    }
    const win = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : mainWindow;
    return getRestoreGhostOnBlur(win || mainWindow);
  });

  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized set-ignore-mouse-events');
      return;
    }
    if (typeof ignore !== 'boolean') {
      console.warn('[Security] Rejected set-ignore-mouse-events: ignore must be a boolean');
      return;
    }
    let forward = true;
    if (options !== undefined && options !== null) {
      if (typeof options !== 'object' || typeof options.forward !== 'boolean') {
        console.warn('[Security] Rejected set-ignore-mouse-events: options.forward must be a boolean');
        return;
      }
      forward = options.forward;
    }

    if (process.platform === 'linux') {
      // Linux does not support forward:true or click-through safely
      return;
    }

    const win = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : mainWindow;
    if (!win || win.isDestroyed()) return;

    const ghostState = getState(win);
    if (ghostState.ghost) {
      win.setIgnoreMouseEvents(ignore, { forward });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.handle('set-fullscreen', (event, flag) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized set-fullscreen');
      return { success: false, isFullScreen: false, error: 'Unauthorized' };
    }
    const win = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : mainWindow;
    return setWindowFullScreen(win || mainWindow, flag);
  });

  ipcMain.handle('toggle-fullscreen', (event) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized toggle-fullscreen');
      return { success: false, isFullScreen: false, error: 'Unauthorized' };
    }
    const win = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : mainWindow;
    return toggleWindowFullScreen(win || mainWindow);
  });

  ipcMain.handle('is-fullscreen', (event) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      return false;
    }
    const win = (event && event.sender && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : mainWindow;
    if (!win || win.isDestroyed()) return false;
    return typeof win.isFullScreen === 'function' ? win.isFullScreen() : false;
  });

  ipcMain.on('app:quit-flush-ack', (event) => {
    if (!isTrustedIpcSender(event, serverPort)) return;
    if (quitFlushResolve) {
      quitFlushResolve();
      quitFlushResolve = null;
    }
  });
}

let isQuitting = false;
let quitFlushResolve = null;

// Application Lifecycle
if (isElectron && app) {
  app.whenReady().then(async () => {
    try {
      setupApplicationMenu();
      setupTray();

      // Deny all unnecessary device/sensor/hardware permission requests by default
      if (session && session.defaultSession) {
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
          console.warn(`[Security] Denied permission request '${permission}' from:`, webContents?.getURL());
          callback(false);
        });
        session.defaultSession.setPermissionCheckHandler(() => false);
      }

      // Register global shortcuts: keep ONLY CmdOrCtrl+Shift+G
      if (globalShortcut && typeof globalShortcut.register === 'function') {
        try {
          globalShortcut.register('CmdOrCtrl+Shift+G', () => {
            if (mainWindow && !mainWindow.isDestroyed()) toggleGhostMode(mainWindow);
          });
        } catch (err) {
          console.warn('[Electron] Failed to register global shortcut CmdOrCtrl+Shift+G:', err);
        }
      }

      const { server, port } = await initializeServer();
      serverInstance = server;
      serverPort = port;
      createMainWindow(serverPort);
    } catch (err) {
      console.error('[Electron] Failed to start studio:', err);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
        createMainWindow(serverPort);
      }
    });

    app.on('browser-window-blur', (event, win) => {
      handleWindowBlur(win);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (globalShortcut && typeof globalShortcut.unregisterAll === 'function') {
      globalShortcut.unregisterAll();
    }
    if (appTray && typeof appTray.destroy === 'function') {
      appTray.destroy();
      appTray = null;
    }

    if (isQuitting) {
      if (serverInstance && typeof serverInstance.close === 'function') {
        serverInstance.close();
      }
      return;
    }

    event.preventDefault();
    isQuitting = true;

    let timeoutId;
    const waitForFlush = new Promise((resolve) => {
      quitFlushResolve = resolve;
      timeoutId = setTimeout(() => {
        console.warn('[Electron] Renderer quit flush timed out after 3s; proceeding with quit.');
        resolve();
      }, 3000);
    });

    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('app:before-quit');
    } else {
      if (quitFlushResolve) {
        quitFlushResolve();
        quitFlushResolve = null;
      }
    }

    waitForFlush.then(() => {
      clearTimeout(timeoutId);
      app.quit();
    });
  });
}

module.exports = {
  migrateLegacyRepoUserdata,
  isDestinationFileValid,
  setFloatingMode,
  toggleFloatMode,
  setAlwaysOnTopMode,
  toggleGhostMode,
  safeSetOpacity,
  setWindowFullScreen,
  toggleWindowFullScreen,
  setupTray,
  updateTrayMenu,
  getAppTray: () => appTray,
  setAppTray: (tray) => { appTray = tray; },
  startGhostAutoRestoreTimer,
  clearGhostAutoRestoreTimer,
  keepGhostMode,
  setRestoreGhostOnBlur,
  getRestoreGhostOnBlur,
  handleWindowBlur,
  registerGhostModeShortcuts,
  unregisterGhostModeShortcuts,
  setWindowOpacity,
  adjustWindowOpacity,
  cycleWindowOpacity,
  getWindowGhostState,
  getState,
  windowStates,
  GHOST_MODE_OPACITY,
  isTrustedAppUrl,
  safeOpenExternal,
  isTrustedIpcSender,
  setServerPort,
  setMainWindow,
  getMainWindow
};

