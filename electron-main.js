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
const { app, BrowserWindow, ipcMain, shell, Menu, dialog, globalShortcut, session } = isElectron ? electronModule : {};

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
        } catch (e) {}
      }
    }
  } catch (err) {}
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
 * For srs_state.json, verifies that it is valid JSON.
 * For all other files, verifies that it has size > 0 (or matches source if source is 0).
 */
function isDestinationFileValid(destPath, srcStat) {
  if (!fs.existsSync(destPath)) return false;
  try {
    const destStat = fs.statSync(destPath);
    if (srcStat.size > 0 && destStat.size === 0) {
      return false; // Incomplete / 0-byte file from crash
    }
    if (path.basename(destPath) === 'srs_state.json' || destPath.endsWith('.json')) {
      const raw = fs.readFileSync(destPath, 'utf8');
      JSON.parse(raw); // Verify valid JSON
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
      if (isDestinationFileValid(destFilePath, srcStat)) {
        // Destination already has valid data -> NEVER blindly overwrite!
        // Preserves existing SRS progress and newer destination data.
        continue;
      } else {
        logger.warn(`[Migration] Destination file "${destFilePath}" exists but is empty or invalid JSON. Re-migrating from legacy source.`);
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
        if (!isDestinationFileValid(destPath, srcStat)) {
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

// Load express backend startup helper and native float mode handler
let startServer, setElectronFloatHandler;
if (isElectron) {
  const serverModule = require('./server.js');
  startServer = serverModule.startServer;
  setElectronFloatHandler = serverModule.setElectronFloatHandler;
}

let mainWindow = null;
let serverInstance = null;
let serverPort = null;
let isWindowFloating = false;
let isWindowAlwaysOnTop = false;
let isWindowGhostMode = false;
let normalWindowBounds = null;

const GHOST_MODE_OPACITY = 0.40;
const windowGhostStates = new WeakMap();

/**
 * Retrieve or initialize independent Ghost Mode state for a BrowserWindow.
 * Tracks isGhostMode and preserves original opacity for reliable restoration.
 */
function getWindowGhostState(win) {
  if (!win) return { isGhostMode: false, originalOpacity: 1.0 };
  let state = windowGhostStates.get(win);
  if (!state) {
    const currentOpacity = (typeof win.getOpacity === 'function') ? win.getOpacity() : 1.0;
    state = {
      isGhostMode: false,
      originalOpacity: (typeof currentOpacity === 'number' && currentOpacity > 0) ? currentOpacity : 1.0
    };
    windowGhostStates.set(win, state);
  }
  return state;
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
    return {
      isElectron: true,
      isAlwaysOnTop: false,
      floating: isWindowFloating
    };
  }

  // Handle boolean or toggle if undefined/non-boolean
  const shouldBeOnTop = typeof targetState === 'boolean'
    ? targetState
    : !targetWin.isAlwaysOnTop();

  isWindowAlwaysOnTop = shouldBeOnTop;

  // Stacking level only: do NOT modify bounds, position, min size, buttons, or fullscreenable
  targetWin.setAlwaysOnTop(shouldBeOnTop, 'floating');

  // Synchronize menu item checkbox if present
  try {
    const aotMenuItem = Menu.getApplicationMenu()?.getMenuItemById('menu-always-on-top');
    if (aotMenuItem) aotMenuItem.checked = shouldBeOnTop;
  } catch (e) { }

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
    floating: isWindowFloating
  };
}

/**
 * Turns the window itself into a compact, frameless Always-on-Top floating window
 * or restores it back to standard studio dimensions.
 */
function toggleFloatMode(win, targetState) {
  const targetWin = win || mainWindow;
  if (!targetWin || targetWin.isDestroyed()) {
    return {
      isElectron: true,
      floating: false,
      isAlwaysOnTop: isWindowAlwaysOnTop
    };
  }

  const shouldFloat = typeof targetState === 'boolean' ? targetState : !isWindowFloating;

  if (shouldFloat) {
    if (!isWindowFloating) {
      normalWindowBounds = targetWin.getBounds();
    }

    setFloatingMode(targetWin, true);

    const { screen } = require('electron');
    const display = screen.getDisplayMatching(targetWin.getBounds());
    const workArea = display.workArea;

    const compactWidth = 480;
    const compactHeight = 620;

    const posX = Math.max(workArea.x + 20, Math.min(workArea.x + workArea.width - compactWidth - 20, (normalWindowBounds ? normalWindowBounds.x + normalWindowBounds.width - compactWidth : workArea.x + workArea.width - compactWidth - 30)));
    const posY = Math.max(workArea.y + 20, Math.min(workArea.y + workArea.height - compactHeight - 20, (normalWindowBounds ? normalWindowBounds.y : workArea.y + 40)));

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

    isWindowFloating = true;
  } else {
    // If independent always-on-top was explicitly enabled, preserve always-on-top stacking
    if (isWindowAlwaysOnTop) {
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
    if (normalWindowBounds) {
      targetWin.setBounds(normalWindowBounds, true);
    } else {
      targetWin.setSize(1280, 820, true);
      targetWin.center();
    }

    isWindowFloating = false;
  }

  // Synchronize menu item checkbox if present
  try {
    const floatMenuItem = Menu.getApplicationMenu()?.getMenuItemById('menu-float-mode');
    if (floatMenuItem) floatMenuItem.checked = isWindowFloating;
  } catch (e) { }

  // Inform renderer webContents
  if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
    targetWin.webContents.executeJavaScript(`
      if (window.UI && typeof window.UI.setElectronFloatState === 'function') {
        window.UI.setElectronFloatState(${isWindowFloating});
      }
    `).catch(() => { });
  }

  return {
    isElectron: true,
    floating: isWindowFloating,
    isAlwaysOnTop: targetWin.isAlwaysOnTop()
  };
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

  if (typeof targetWin.setOpacity === 'function') {
    targetWin.setOpacity(opacity);
  }

  const ghostState = getWindowGhostState(targetWin);
  if (ghostState.isGhostMode) {
    ghostState.ghostOpacity = opacity;
  } else {
    ghostState.originalOpacity = opacity;
  }

  // Inform renderer to display the transient, auto-hiding Opacity HUD
  if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
    targetWin.webContents.executeJavaScript(`
      if (window.UI && typeof window.UI.showOpacityHUD === 'function') {
        window.UI.showOpacityHUD(${opacity}, ${ghostState.isGhostMode});
      }
    `).catch(() => { });

    targetWin.webContents.send('shortcut:action', 'opacity-changed', {
      opacity,
      isGhostMode: ghostState.isGhostMode
    });
  }

  return {
    isElectron: true,
    opacity,
    isGhostMode: ghostState.isGhostMode
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
    return {
      isElectron: true,
      isGhostMode: false,
      isAlwaysOnTop: isWindowAlwaysOnTop,
      floating: isWindowFloating,
      error: 'Window not found'
    };
  }

  try {
    const ghostState = getWindowGhostState(targetWin);
    const shouldGhost = typeof targetState === 'boolean'
      ? targetState
      : !ghostState.isGhostMode;

    if (shouldGhost) {
      // 1. Capture original opacity only when transitioning from non-ghost mode
      // (prevents repeated toggles from overwriting saved original opacity)
      if (!ghostState.isGhostMode) {
        const currentOpacity = typeof targetWin.getOpacity === 'function' ? targetWin.getOpacity() : 1.0;
        ghostState.originalOpacity = (typeof currentOpacity === 'number' && currentOpacity > 0)
          ? currentOpacity
          : 1.0;
        ghostState.isGhostMode = true;
      }

      // 2. Set translucent opacity (~40% or user preference)
      const targetGhostOpacity = (typeof ghostState.ghostOpacity === 'number' && ghostState.ghostOpacity > 0)
        ? ghostState.ghostOpacity
        : GHOST_MODE_OPACITY;
      if (typeof targetWin.setOpacity === 'function') {
        targetWin.setOpacity(targetGhostOpacity);
      }

      // 3. Ensure window is always on top while in ghost mode so it remains visible above drawing app
      targetWin.setAlwaysOnTop(true, 'floating');

      // 4. Pass mouse clicks through, but forward moves to allow hover-exit
      targetWin.setIgnoreMouseEvents(true, { forward: true });
    } else {
      // 1. Restore original opacity safely
      const restoreOpacity = (typeof ghostState.originalOpacity === 'number' && ghostState.originalOpacity > 0)
        ? ghostState.originalOpacity
        : 1.0;
      if (typeof targetWin.setOpacity === 'function') {
        targetWin.setOpacity(restoreOpacity);
      }
      ghostState.isGhostMode = false;

      // 2. Restore normal mouse interaction
      targetWin.setIgnoreMouseEvents(false);

      // 3. Restore always-on-top state to prior state
      if (isWindowAlwaysOnTop || isWindowFloating) {
        targetWin.setAlwaysOnTop(true, 'floating');
      } else {
        targetWin.setAlwaysOnTop(false);
      }
    }

    if (targetWin === mainWindow) {
      isWindowGhostMode = shouldGhost;
    }

    // Synchronize menu item checkbox if present
    try {
      const ghostMenuItem = Menu.getApplicationMenu()?.getMenuItemById('menu-ghost-mode');
      if (ghostMenuItem) ghostMenuItem.checked = shouldGhost;
    } catch (e) { }

    // Inform renderer webContents
    if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
      targetWin.webContents.executeJavaScript(`
        if (window.UI && typeof window.UI.setGhostModeState === 'function') {
          window.UI.setGhostModeState(${shouldGhost});
        }
      `).catch(() => { });

      targetWin.webContents.send('shortcut:action', shouldGhost ? 'ghost-mode-enabled' : 'ghost-mode-disabled');
    }

    return {
      isElectron: true,
      isGhostMode: shouldGhost,
      isAlwaysOnTop: targetWin.isAlwaysOnTop(),
      floating: isWindowFloating,
      opacity: typeof targetWin.getOpacity === 'function' ? targetWin.getOpacity() : (shouldGhost ? GHOST_MODE_OPACITY : 1.0)
    };
  } catch (err) {
    console.error('[Electron] Error in toggleGhostMode:', err);
    return {
      isElectron: true,
      isGhostMode: false,
      isAlwaysOnTop: targetWin.isAlwaysOnTop(),
      floating: isWindowFloating,
      error: err.message
    };
  }
}

// Register float handler with Express backend for /api/electron-float
if (isElectron && typeof setElectronFloatHandler === 'function') {
  setElectronFloatHandler((data) => {
    const currentAot = mainWindow && !mainWindow.isDestroyed() ? mainWindow.isAlwaysOnTop() : isWindowAlwaysOnTop;
    if (data && (data.query === true || data.check === true)) {
      return { isElectron: true, floating: isWindowFloating, isAlwaysOnTop: currentAot, isGhostMode: isWindowGhostMode };
    }
    if (data && typeof data.ghostMode === 'boolean') {
      return toggleGhostMode(mainWindow, data.ghostMode);
    }
    if (data && typeof data.alwaysOnTop === 'boolean') {
      return setAlwaysOnTopMode(mainWindow, data.alwaysOnTop);
    }
    if (data && typeof data.opacity === 'number') {
      return setWindowOpacity(mainWindow, data.opacity);
    }
    if (data && typeof data.opacityDelta === 'number') {
      return adjustWindowOpacity(mainWindow, data.opacityDelta);
    }
    if (data && data.cycleOpacity === true) {
      return cycleWindowOpacity(mainWindow);
    }
    const flag = typeof data?.enable === 'boolean' ? data.enable : (typeof data?.floating === 'boolean' ? data.floating : !isWindowFloating);
    return toggleFloatMode(mainWindow, flag);
  });
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

/**
 * Validates that an IPC invocation originated from a trusted internal frame.
 */
function isTrustedIpcSender(event, trustedPort) {
  if (!event) return false;
  const senderFrame = event.senderFrame;
  const senderUrl = (senderFrame && senderFrame.url) || (event.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');

  // Allow about:blank ONLY if the sender window is explicitly our primary mainWindow
  if (!senderUrl || senderUrl === 'about:blank') {
    const win = (event.sender && BrowserWindow && typeof BrowserWindow.fromWebContents === 'function')
      ? BrowserWindow.fromWebContents(event.sender)
      : null;
    return Boolean(mainWindow && win && win === mainWindow);
  }

  return isTrustedAppUrl(senderUrl, trustedPort);
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

    childWindow.on('close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      }
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    isWindowFloating = false;
    isWindowAlwaysOnTop = false;
    isWindowGhostMode = false;
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
          click: (menuItem) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              setAlwaysOnTopMode(mainWindow, menuItem.checked);
            }
          }
        },
        {
          id: 'menu-float-mode',
          label: 'Float Above Other Apps (Always-on-Top)',
          accelerator: 'CmdOrCtrl+Shift+A',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              toggleFloatMode(mainWindow, menuItem.checked);
            }
          }
        },
        {
          id: 'menu-ghost-mode',
          label: 'Ghost Mode (Click-Through Overlay)',
          accelerator: 'CmdOrCtrl+Shift+G',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              toggleGhostMode(mainWindow, menuItem.checked);
            }
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
  ipcMain.handle('dialog:pick-directory', async (event) => {
    // Sensitive capability: only permit from trusted origin and specifically the primary mainWindow
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized dialog:pick-directory from untrusted sender');
      return { canceled: true, path: null, error: 'Unauthorized IPC sender' };
    }
    const callingWin = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : null;
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
    return { canceled: false, path: result.filePaths[0] };
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

  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    if (!isTrustedIpcSender(event, serverPort)) {
      console.warn('[Security] Blocked unauthorized set-ignore-mouse-events');
      return;
    }
    const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : mainWindow;
    if (!win || win.isDestroyed()) return;

    const ghostState = getWindowGhostState(win);
    if (ghostState.isGhostMode) {
      win.setIgnoreMouseEvents(!!ignore, options || { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  });
}

// Application Lifecycle
if (isElectron && app) {
  app.whenReady().then(async () => {
    try {
      setupApplicationMenu();

      // Deny all unnecessary device/sensor/hardware permission requests by default
      if (session && session.defaultSession) {
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
          console.warn(`[Security] Denied permission request '${permission}' from:`, webContents?.getURL());
          callback(false);
        });
        session.defaultSession.setPermissionCheckHandler(() => false);
      }

      // Register global shortcuts for Ghost Mode & Opacity controls
      if (globalShortcut && typeof globalShortcut.register === 'function') {
        const registerGlobal = (accelerator, handler) => {
          try {
            globalShortcut.register(accelerator, handler);
          } catch (err) {
            console.warn(`[Electron] Failed to register global shortcut ${accelerator}:`, err);
          }
        };

        registerGlobal('CmdOrCtrl+Shift+G', () => {
          if (mainWindow && !mainWindow.isDestroyed()) toggleGhostMode(mainWindow);
        });
        registerGlobal('CmdOrCtrl+Shift+Up', () => {
          if (mainWindow && !mainWindow.isDestroyed()) adjustWindowOpacity(mainWindow, 0.10);
        });
        registerGlobal('CmdOrCtrl+Shift+Down', () => {
          if (mainWindow && !mainWindow.isDestroyed()) adjustWindowOpacity(mainWindow, -0.10);
        });
        registerGlobal('CmdOrCtrl+Shift+]', () => {
          if (mainWindow && !mainWindow.isDestroyed()) adjustWindowOpacity(mainWindow, 0.10);
        });
        registerGlobal('CmdOrCtrl+Shift+[', () => {
          if (mainWindow && !mainWindow.isDestroyed()) adjustWindowOpacity(mainWindow, -0.10);
        });
        registerGlobal('CmdOrCtrl+Shift+O', () => {
          if (mainWindow && !mainWindow.isDestroyed()) cycleWindowOpacity(mainWindow);
        });
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
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (globalShortcut && typeof globalShortcut.unregisterAll === 'function') {
      globalShortcut.unregisterAll();
    }
    if (serverInstance && typeof serverInstance.close === 'function') {
      serverInstance.close();
    }
  });
}

module.exports = {
  migrateLegacyRepoUserdata,
  setFloatingMode,
  toggleFloatMode,
  setAlwaysOnTopMode,
  toggleGhostMode,
  setWindowOpacity,
  adjustWindowOpacity,
  cycleWindowOpacity,
  getWindowGhostState,
  GHOST_MODE_OPACITY,
  isTrustedAppUrl,
  safeOpenExternal,
  isTrustedIpcSender
};

