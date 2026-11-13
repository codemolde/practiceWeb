const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');
const { URL } = require('url');

const app = express();
let boundServerPort = null;
const PORT = process.env.PORT || 3000;

// API Security Middleware registered before any route
app.use('/api', (req, res, next) => {
  const boundPort = req.socket?.localPort || boundServerPort || app.get('port') || PORT;
  const host = req.headers.host;
  const allowedHosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];

  // 1. Rejects unless the Host header is exactly 127.0.0.1:<boundPort> or localhost:<boundPort>
  if (!host || !allowedHosts.includes(host)) {
    return res.status(403).json({ error: 'Forbidden: invalid Host header' });
  }

  // Reject Sec-Fetch-Site: cross-site for all /api requests, GET included
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return res.status(403).json({ error: 'Forbidden: cross-site request rejected' });
  }

  // Reject opaque / null origins for all /api requests
  const origin = req.headers.origin;
  if (origin === 'null') {
    return res.status(403).json({ error: 'Forbidden: null origin rejected' });
  }

  // 2. Rejects state-changing methods (POST/PUT/PATCH/DELETE) unless Origin is absent or equals the app origin,
  // and Sec-Fetch-Site (when present) is same-origin or none
  const method = req.method ? req.method.toUpperCase() : '';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const allowedOrigins = [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`];
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: 'Forbidden: cross-origin request rejected' });
    }

    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      return res.status(403).json({ error: 'Forbidden: invalid Sec-Fetch-Site' });
    }
  }

  next();
});

// Enable JSON body parser with generous limit for large image collections & review history
app.use(express.json({ limit: '50mb' }));

// CSP header on the app HTML
const APP_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";

app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Content-Security-Policy', APP_CSP);
  }
  next();
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Security-Policy', APP_CSP);
    }
  }
}));

// Persistent Disk Storage for SRS Database & Visual Sketch History
const USERDATA_DIR = process.env.USER_DATA_DIR || path.join(__dirname, 'userdata');
const STATE_FILE = path.join(USERDATA_DIR, 'srs_state.json');
const SKETCHES_DIR = path.join(USERDATA_DIR, 'sketches');
const BACKUPS_DIR = path.join(USERDATA_DIR, 'backups');

// Ensure userdata, sketches, and backups directories exist on startup
fs.mkdirSync(SKETCHES_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// In-memory set of folders explicitly trusted (e.g. chosen via native folder picker this session)
const trustedFolders = new Set();

/**
 * Registers an absolute folder path into the trusted folders Set.
 * Canonicalizes via fs.realpathSync (or path.resolve if realpath fails).
 */
function registerTrustedFolder(absPath) {
  if (!absPath || typeof absPath !== 'string') return;
  try {
    const real = fs.realpathSync(absPath);
    trustedFolders.add(real);
  } catch (e) {
    trustedFolders.add(path.resolve(absPath));
  }
}

function clearTrustedFolders() {
  trustedFolders.clear();
}

/**
 * Returns a Set of resolved real paths for all registered deck folders
 * as the union of folders from STATE_FILE and in-memory trustedFolders.
 */
function getRegisteredDeckFolders() {
  const folders = new Set(trustedFolders);
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const state = JSON.parse(raw);
      const decks = Array.isArray(state.decks)
        ? state.decks
        : (state.data && Array.isArray(state.data.decks) ? state.data.decks : []);
      for (const d of decks) {
        if (d && d.folderPath) {
          try {
            folders.add(fs.realpathSync(d.folderPath));
          } catch (e) {
            folders.add(path.resolve(d.folderPath));
          }
        }
      }
    } catch (e) {
      console.warn('[Server] Error reading registered deck folders from STATE_FILE:', e.message);
    }
  }
  return folders;
}

function isPathInside(childPath, parentPath) {
  const rel = path.relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isPathAllowedInRegisteredDecks(targetPath) {
  let realTarget;
  try {
    realTarget = fs.realpathSync(targetPath);
  } catch (e) {
    realTarget = path.resolve(targetPath);
  }
  const deckFolders = getRegisteredDeckFolders();
  for (const df of deckFolders) {
    if (realTarget === df || isPathInside(realTarget, df)) {
      return true;
    }
  }
  return false;
}

/**
 * Startup helper: checks userdata/srs_state.json once when the server starts
 * and converts any old data:image/... strings inside attempts into files inside userdata/sketches/.
 */
function migrateBase64SketchesOnStartup() {
  if (!fs.existsSync(STATE_FILE)) return;

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    const cards = state.cards || (state.data && state.data.cards);
    if (!cards || typeof cards !== 'object') return;

    let migratedCount = 0;

    for (const deckId of Object.keys(cards)) {
      const deckCards = cards[deckId];
      if (!deckCards || typeof deckCards !== 'object') continue;

      for (const cardId of Object.keys(deckCards)) {
        const card = deckCards[cardId];
        if (!card || !Array.isArray(card.attempts)) continue;

        for (const attempt of card.attempts) {
          if (attempt && typeof attempt.sketchUrl === 'string') {
            if (attempt.sketchUrl.startsWith('data:image/')) {
              try {
                const base64Data = attempt.sketchUrl.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const filename = `sk_migrated_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
                const filePath = path.join(SKETCHES_DIR, filename);

                fs.writeFileSync(filePath, buffer);
                attempt.sketchUrl = `/api/sketch/${filename}`;
                migratedCount++;
              } catch (err) {
                console.warn(`[Migration] Failed to migrate sketch for card ${cardId}:`, err.message);
              }
            } else if (attempt.sketchUrl.startsWith('/api/sketch?file=')) {
              try {
                const urlObj = new URL(attempt.sketchUrl, 'http://localhost');
                const fileParam = urlObj.searchParams.get('file');
                if (fileParam) {
                  attempt.sketchUrl = `/api/sketch/${path.basename(fileParam)}`;
                  migratedCount++;
                }
              } catch (err) {
                console.warn(`[Migration] Failed to migrate legacy sketchUrl for card ${cardId}:`, err.message);
              }
            }
          }
        }
      }
    }

    if (migratedCount > 0) {
      state.lastSaved = new Date().toISOString();
      const tempFile = path.join(USERDATA_DIR, `srs_state_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.tmp`);
      fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tempFile, STATE_FILE);
      console.log(`[Startup] Migrated ${migratedCount} Base64 sketch(es) to disk in userdata/sketches/`);
    }
  } catch (err) {
    console.error('[Startup] Error during Base64 sketch migration:', err);
  }
}

migrateBase64SketchesOnStartup();

// In-memory hash caches for file-move resilience:
// fileHashCache: filePath -> { mtimeMs, size, hash }
// hashToPathMap: hash -> filePath
const fileHashCache = new Map();
const hashToPathMap = new Map();

/**
 * Compute a fast content hash for an image file:
 * SHA-1 of (file size + first 64KB).
 * Takes ~0.02ms per file and survives renaming, moving between subfolders,
 * or moving the entire reference directory.
 */
function computeFileHash(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const cached = fileHashCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      hashToPathMap.set(cached.hash, filePath);
      return cached.hash;
    }

    const size = stat.size;
    const bufferSize = Math.min(size, 64 * 1024); // read up to 64KB
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(bufferSize);
    fs.readSync(fd, buffer, 0, bufferSize, 0);
    fs.closeSync(fd);

    const hash = crypto.createHash('sha1');
    hash.update(`${size}:`);
    hash.update(buffer);
    const digest = 'ch_' + hash.digest('hex');

    fileHashCache.set(filePath, { mtimeMs: stat.mtimeMs, size, hash: digest });
    hashToPathMap.set(digest, filePath);
    return digest;
  } catch (err) {
    // Fallback deterministic hash if file cannot be opened directly
    const fallback = 'ch_' + crypto.createHash('sha1').update(filePath).digest('hex');
    hashToPathMap.set(fallback, filePath);
    return fallback;
  }
}

// Supported image extensions
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.tif'
]);

/**
 * Recursively scan a directory for image files.
 * Returns an array of absolute file paths.
 */
function scanForImages(dirPath, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden directories and _crops subdirectories
      if (!entry.name.startsWith('.') && entry.name.toLowerCase() !== '_crops') {
        scanForImages(fullPath, results);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * GET /api/browse?path=<absolute_path>
 * Lists subdirectories and image count at a given path.
 * Defaults to user's home directory if no path given.
 */
app.get('/api/browse', (req, res) => {
  if (process.env.APP_RUNTIME === 'electron') {
    return res.status(404).json({ error: 'Endpoint not available in desktop runtime' });
  }

  const os = require('os');
  const requestedPath = req.query.path || os.homedir();
  const resolved = path.resolve(requestedPath);

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: `Path not found: ${resolved}` });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `Not a directory: ${resolved}` });
  }

  let entries;
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (err) {
    return res.status(403).json({ error: `Cannot read directory: ${err.message}` });
  }

  const dirs = [];
  let imageCount = 0;

  for (const entry of entries) {
    // Skip hidden files/dirs and _crops
    if (entry.name.startsWith('.') || entry.name.toLowerCase() === '_crops') continue;

    if (entry.isDirectory()) {
      dirs.push(entry.name);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        imageCount++;
      }
    }
  }

  dirs.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  res.json({
    current: resolved,
    parent: path.dirname(resolved),
    dirs,
    imageCount
  });
});

/**
 * GET /api/images?folder=<absolute_path>
 * Returns JSON array of image file paths found in the given folder (recursive).
 */
app.get('/api/images', (req, res) => {
  const folderPath = req.query.folder;

  if (!folderPath) {
    return res.status(400).json({ error: 'Missing "folder" query parameter' });
  }

  // Resolve to absolute path
  const resolved = path.resolve(folderPath);

  if (process.env.APP_RUNTIME === 'electron') {
    if (!isPathAllowedInRegisteredDecks(resolved)) {
      return res.status(403).json({ error: 'Access denied: folder is not a registered deck folder' });
    }
  }

  // Check if the directory exists
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: `Folder not found: ${resolved}` });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `Not a directory: ${resolved}` });
  }

  const images = scanForImages(resolved);

  // Return relative display names along with resilient content-hash IDs
  const result = images.map(imgPath => {
    const hash = computeFileHash(imgPath);
    return {
      id: hash,
      hash: hash,
      path: imgPath,
      name: path.relative(resolved, imgPath),
      folder: resolved
    };
  });

  res.json(result);
});

/**
 * GET /api/deck-meta?folder=<absolute_path>
 * Lightweight deck summary used by the home screen:
 * total image count + up to 3 random cover image paths.
 * Scan results are cached briefly so re-renders stay instant.
 */
const metaCache = new Map();
const META_TTL_MS = 60 * 1000;

app.get('/api/deck-meta', (req, res) => {
  const folderPath = req.query.folder;
  if (!folderPath) {
    return res.status(400).json({ error: 'Missing "folder" query parameter' });
  }

  const resolved = path.resolve(folderPath);

  if (process.env.APP_RUNTIME === 'electron') {
    if (!isPathAllowedInRegisteredDecks(resolved)) {
      return res.status(403).json({ error: 'Access denied: folder is not a registered deck folder' });
    }
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(404).json({ error: `Folder not found: ${resolved}` });
  }

  let cached = metaCache.get(resolved);
  if (!cached || Date.now() - cached.time > META_TTL_MS) {
    cached = { time: Date.now(), images: scanForImages(resolved) };
    metaCache.set(resolved, cached);
  }

  // Pick up to 3 distinct random covers
  const pool = [...cached.images];
  const covers = [];
  while (covers.length < 3 && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    covers.push(pool.splice(idx, 1)[0]);
  }

  res.json({ total: cached.images.length, covers });
});

/**
 * GET /api/image?path=<absolute_path>&hash=<content_hash>
 * Serves a single image file from disk. Supports both file paths and content hashes.
 */
app.get('/api/image', (req, res) => {
  let target = req.query.path || req.query.hash;

  if (!target) {
    return res.status(400).json({ error: 'Missing "path" or "hash" query parameter' });
  }

  // If a content hash was requested (starts with 'ch_'), resolve from hashToPathMap
  if (target.startsWith('ch_') && hashToPathMap.has(target)) {
    target = hashToPathMap.get(target);
  }

  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg'];
  const ext = path.extname(target).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return res.status(415).json({ error: `Unsupported media type: ${ext || 'none'}` });
  }

  const resolved = path.resolve(target);

  let realPath;
  try {
    realPath = fs.realpathSync(resolved);
  } catch (err) {
    return res.status(404).json({ error: `File not found: ${resolved}` });
  }

  const realExt = path.extname(realPath).toLowerCase();
  if (!allowedExtensions.includes(realExt)) {
    return res.status(415).json({ error: `Unsupported media type: ${realExt || 'none'}` });
  }

  // When APP_RUNTIME === 'electron', require resolved real path to be inside a folder in getRegisteredDeckFolders() or inside USERDATA_DIR
  if (process.env.APP_RUNTIME === 'electron') {
    let realUserDataDir;
    try {
      realUserDataDir = fs.realpathSync(USERDATA_DIR);
    } catch (e) {
      realUserDataDir = path.resolve(USERDATA_DIR);
    }

    const isAllowed = isPathInside(realPath, realUserDataDir) || isPathAllowedInRegisteredDecks(realPath);

    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied: path is not inside a registered deck folder or userdata directory' });
    }
  }

  // Determine MIME type
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff'
  };

  const contentType = mimeTypes[realExt] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  if (req.query.hash) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  res.sendFile(realPath);
});

/**
 * Backup rotation & state writing utilities:
 * - Rotates srs_state.json.bak1..bak5 (shifted on write, throttled to at most once per 10 minutes)
 * - Keeps one daily snapshot for the last 7 days in userdata/backups/
 * - Logs all rotations
 */
let stateWriteQueue = Promise.resolve();
let lastRotationTime = 0;
let customClock = null;
const ROTATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes default
const BACKUP_COUNT = 5;

function setRotationClock(clockFn) {
  customClock = clockFn;
}

function resetRotationState() {
  lastRotationTime = 0;
  customClock = null;
}

function getNow(options = {}) {
  if (typeof options.now === 'number') return options.now;
  if (typeof options.clock === 'function') return options.clock();
  if (typeof customClock === 'function') return customClock();
  return Date.now();
}

function getLocalDateString(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pruneDailySnapshots(backupsDir, maxDays = 7) {
  try {
    if (!fs.existsSync(backupsDir)) return;
    const files = fs.readdirSync(backupsDir)
      .filter(f => /^srs_state_\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort(); // chronological sort for YYYY-MM-DD

    if (files.length > maxDays) {
      const toDelete = files.slice(0, files.length - maxDays);
      for (const f of toDelete) {
        try {
          fs.unlinkSync(path.join(backupsDir, f));
          console.log(`[Sync] Pruned old daily snapshot: ${f}`);
        } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('[Sync] Error pruning daily snapshots:', err.message);
  }
}

function rotateBackups(options = {}) {
  if (!fs.existsSync(STATE_FILE)) return;

  const now = getNow(options);
  let lastMtime = 0;
  const bak1 = `${STATE_FILE}.bak1`;
  if (fs.existsSync(bak1)) {
    try {
      lastMtime = fs.statSync(bak1).mtimeMs;
    } catch (e) {}
  }
  const lastTime = Math.max(lastRotationTime, lastMtime);
  const minInterval = options.minRotationIntervalMs !== undefined
    ? options.minRotationIntervalMs
    : (process.env.SYNC_ROTATION_INTERVAL_MS !== undefined ? parseInt(process.env.SYNC_ROTATION_INTERVAL_MS, 10) : ROTATION_WINDOW_MS);

  const shouldRotate = options.forceRotation || (now - lastTime >= minInterval);

  if (!shouldRotate) {
    return;
  }

  try {
    // 1. Shift bak1..bak5
    const bak5 = `${STATE_FILE}.bak5`;
    if (fs.existsSync(bak5)) {
      try { fs.unlinkSync(bak5); } catch (e) {}
    }

    for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
      const src = `${STATE_FILE}.bak${i}`;
      const dest = `${STATE_FILE}.bak${i + 1}`;
      if (fs.existsSync(src)) {
        try {
          fs.renameSync(src, dest);
        } catch (err) {
          console.warn(`[Sync] Error shifting backup ${src} to ${dest}:`, err.message);
        }
      }
    }

    // Copy current STATE_FILE to bak1
    fs.copyFileSync(STATE_FILE, bak1);
    lastRotationTime = now;
    if (options.clock || options.now || customClock) {
      try {
        fs.utimesSync(bak1, new Date(now), new Date(now));
      } catch (e) {}
    }
    console.log(`[Sync] Rotated backups: ${path.basename(STATE_FILE)} -> .bak1 (holding up to .bak${BACKUP_COUNT})`);
  } catch (err) {
    console.warn('[Sync] Failed during backup rotation:', err.message);
  }
}

function createDailySnapshot(options = {}) {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    if (!fs.existsSync(STATE_FILE)) return;

    const now = getNow(options);
    const todayStr = getLocalDateString(new Date(now));
    const dailySnapshotPath = path.join(BACKUPS_DIR, `srs_state_${todayStr}.json`);

    // Only create if today's snapshot doesn't exist yet
    if (!fs.existsSync(dailySnapshotPath)) {
      // Taken from the new state (STATE_FILE was just atomically replaced with new state)
      fs.copyFileSync(STATE_FILE, dailySnapshotPath);
      console.log(`[Sync] Created daily snapshot: ${path.basename(dailySnapshotPath)}`);
    }

    // Prune daily snapshots older than 7 days
    pruneDailySnapshots(BACKUPS_DIR, 7);
  } catch (err) {
    console.warn('[Sync] Failed creating daily snapshot:', err.message);
  }
}

function getBackupCandidates() {
  const candidates = [];
  // 1. srs_state.json.bak1..bak5
  for (let i = 1; i <= BACKUP_COUNT; i++) {
    candidates.push(`${STATE_FILE}.bak${i}`);
  }
  // 2. Legacy srs_state.json.bak
  candidates.push(`${STATE_FILE}.bak`);
  // 3. Daily snapshots in userdata/backups/ (newest first)
  if (fs.existsSync(BACKUPS_DIR)) {
    try {
      const dailyFiles = fs.readdirSync(BACKUPS_DIR)
        .filter(f => /^srs_state_\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .reverse();
      for (const f of dailyFiles) {
        candidates.push(path.join(BACKUPS_DIR, f));
      }
    } catch (e) {}
  }
  return candidates;
}

async function writeStateFile(state, options = {}) {
  const task = async () => {
    if (!fs.existsSync(USERDATA_DIR)) {
      await fs.promises.mkdir(USERDATA_DIR, { recursive: true });
    }

    let tempFile = `${STATE_FILE}.${Date.now()}.tmp`;
    if (fs.existsSync(tempFile)) {
      tempFile = `${STATE_FILE}.${Date.now()}_${Math.random().toString(36).slice(2, 6)}.tmp`;
    }
    const jsonStr = JSON.stringify(state, null, 2);

    const fileHandle = await fs.promises.open(tempFile, 'w');
    try {
      await fileHandle.writeFile(jsonStr, 'utf8');
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    // Rotate backups before atomically replacing the primary state file
    rotateBackups(options);

    await fs.promises.rename(tempFile, STATE_FILE);

    // Create daily snapshot from the new state using LOCAL date
    createDailySnapshot(options);

    return await fs.promises.stat(STATE_FILE);
  };

  const currentOp = stateWriteQueue.then(task, task);
  stateWriteQueue = currentOp.catch(() => {});
  return currentOp;
}

app.post('/api/sync', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON payload for sync' });
    }

    const incomingDecks = Array.isArray(payload.decks) ? payload.decks : [];
    const incomingCards = payload.cards && typeof payload.cards === 'object' ? payload.cards : {};

    // Validate sketch URLs in attempts: reject dangerous schemes like javascript:, and drop invalid sketch URLs
    for (const deckId of Object.keys(incomingCards)) {
      const deckCards = incomingCards[deckId];
      if (deckCards && typeof deckCards === 'object') {
        for (const cardId of Object.keys(deckCards)) {
          const card = deckCards[cardId];
          if (card && Array.isArray(card.attempts)) {
            for (const att of card.attempts) {
              if (att && att.sketchUrl) {
                const sUrl = String(att.sketchUrl).trim().toLowerCase();
                if (sUrl.startsWith('javascript:') || sUrl.startsWith('vbscript:') || sUrl.startsWith('data:text/html')) {
                  return res.status(400).json({ error: 'Rejected: payload contains disallowed sketchUrl scheme' });
                }
                if (sUrl.startsWith('/api/sketch?file=')) {
                  try {
                    const urlObj = new URL(att.sketchUrl, 'http://localhost');
                    const fileParam = urlObj.searchParams.get('file');
                    if (fileParam) {
                      att.sketchUrl = `/api/sketch/${path.basename(fileParam)}`;
                    }
                  } catch (e) {}
                }
                const updatedUrl = String(att.sketchUrl).trim().toLowerCase();
                const valid = updatedUrl.startsWith('/api/sketch/') ||
                  updatedUrl.startsWith('/api/sketch?file=') ||
                  updatedUrl.startsWith('data:image/png') ||
                  updatedUrl.startsWith('data:image/jpeg') ||
                  updatedUrl.startsWith('data:image/webp');
                if (!valid) {
                  delete att.sketchUrl;
                }
              }
            }
          }
        }
      }
    }

    const incomingDeckCount = incomingDecks.length;
    const incomingCardCount = Object.values(incomingCards).reduce((acc, d) => acc + Object.keys(d || {}).length, 0);

    // Guard against accidental database wipe: 0 decks AND 0 cards while existing file has >0 of either
    if (incomingDeckCount === 0 && incomingCardCount === 0 && !payload.confirmReplace) {
      let existingDeckCount = 0;
      let existingCardCount = 0;

      if (fs.existsSync(STATE_FILE)) {
        try {
          const raw = fs.readFileSync(STATE_FILE, 'utf8');
          const existing = JSON.parse(raw);
          const eDecks = Array.isArray(existing.decks) ? existing.decks : [];
          const eCards = existing.cards && typeof existing.cards === 'object'
            ? existing.cards
            : (existing.data && existing.data.cards ? existing.data.cards : {});
          existingDeckCount = eDecks.length;
          existingCardCount = Object.values(eCards).reduce((acc, d) => acc + Object.keys(d || {}).length, 0);
        } catch (e) {}
      }

      if (existingDeckCount > 0 || existingCardCount > 0) {
        return res.status(409).json({
          error: 'Conflict: Incoming state has 0 decks and 0 cards while existing state contains data. Use confirmReplace: true to overwrite.'
        });
      }
    }

    const state = {
      version: 1,
      lastSaved: new Date().toISOString(),
      decks: incomingDecks,
      cards: incomingCards,
      history: payload.history && typeof payload.history === 'object' ? payload.history : {},
      wallpaperSettings: payload.wallpaperSettings || null
    };

    const writeOptions = {
      forceRotation: Boolean(payload.forceRotation || req.headers['x-force-rotation']),
      minRotationIntervalMs: typeof payload.minRotationIntervalMs === 'number' ? payload.minRotationIntervalMs : undefined
    };

    const stats = await writeStateFile(state, writeOptions);

    res.json({
      success: true,
      lastSaved: state.lastSaved,
      sizeBytes: stats.size,
      decksCount: incomingDeckCount,
      cardsCount: incomingCardCount
    });
  } catch (err) {
    console.error('[API /api/sync] Error writing SRS state to disk:', err);
    res.status(500).json({ error: `Failed to save SRS database to disk: ${err.message}` });
  }
});

/**
 * GET /api/sync
 * Reads the persistent SRS database from userdata/srs_state.json on disk.
 * Falls back through the backups in order (bak1..bak5, legacy .bak, daily snapshots) if primary is invalid.
 */
app.get('/api/sync', (req, res) => {
  try {
    let data = null;
    let loadedFrom = null;

    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        data = JSON.parse(raw);
        loadedFrom = STATE_FILE;
      } catch (parseErr) {
        console.warn('[API /api/sync] Primary STATE_FILE corrupted/invalid JSON, falling back to backups:', parseErr.message);
      }
    } else {
      console.warn('[API /api/sync] Primary STATE_FILE not found, searching backups...');
    }

    if (!data) {
      const candidates = getBackupCandidates();
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          try {
            const raw = fs.readFileSync(candidate, 'utf8');
            data = JSON.parse(raw);
            loadedFrom = candidate;
            console.warn(`[API /api/sync] Successfully recovered SRS state from backup: ${path.basename(candidate)}`);
            break;
          } catch (bakErr) {
            console.warn(`[API /api/sync] Backup ${path.basename(candidate)} is corrupted/invalid:`, bakErr.message);
          }
        }
      }
    }

    if (data) {
      return res.json({
        exists: true,
        lastSaved: data.lastSaved,
        data,
        recoveredFrom: loadedFrom !== STATE_FILE && loadedFrom ? path.basename(loadedFrom) : undefined
      });
    }

    if (!fs.existsSync(STATE_FILE)) {
      return res.json({ exists: false, data: null });
    }

    res.status(500).json({ error: 'Failed to read SRS database: primary file and all backups are corrupted or unreadable' });
  } catch (err) {
    console.error('[API /api/sync] Error reading SRS state from disk:', err);
    res.status(500).json({ error: `Failed to read SRS database from disk: ${err.message}` });
  }
});

/**
 * POST /api/sketch
 * Saves a Base64 sketch image to userdata/sketches/sk_<random>.png
 * and returns JSON { sketchUrl: '/api/sketch/sk_...' }.
 */
app.post('/api/sketch', (req, res) => {
  try {
    const { imageId, dataUrl } = req.body || {};
    if (!dataUrl) {
      return res.status(400).json({ error: 'Missing dataUrl' });
    }

    const base64Data = dataUrl.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Reject over 15 MB decoded
    const MAX_SKETCH_BYTES = 15 * 1024 * 1024;
    if (buffer.length > MAX_SKETCH_BYTES) {
      return res.status(413).json({ error: 'Payload too large: sketch exceeds 15 MB' });
    }

    // Magic bytes verification for PNG / JPEG / WebP
    let imgExt = null;
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    ) {
      imgExt = 'png';
    } else if (
      buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    ) {
      imgExt = 'jpg';
    } else if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      imgExt = 'webp';
    }

    if (!imgExt) {
      return res.status(415).json({ error: 'Invalid image format: buffer magic bytes must be PNG, JPEG, or WebP' });
    }

    const randomName = crypto.randomBytes(8).toString('hex');
    const filename = `sk_${randomName}.${imgExt}`;
    const filePath = path.join(SKETCHES_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    res.json({ sketchUrl: `/api/sketch/${filename}` });
  } catch (err) {
    console.error('[API /api/sketch] Error saving sketch:', err);
    res.status(500).json({ error: `Failed to save sketch: ${err.message}` });
  }
});

/**
 * GET /api/sketch/:filename
 * Sanitizes :filename with path.basename() and serves the file from userdata/sketches/
 */
app.get('/api/sketch/:filename', (req, res) => {
  try {
    const safeFilename = path.basename(req.params.filename);
    const resolved = path.join(SKETCHES_DIR, safeFilename);

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Sketch not found' });
    }

    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(resolved);
  } catch (err) {
    console.error('[API /api/sketch/:filename] Error serving sketch:', err);
    res.status(500).json({ error: `Failed to serve sketch: ${err.message}` });
  }
});

/**
 * POST /api/crop
 * Accepts JSON { folderPath, dataUrl, cardId, tag }
 * Verifies folderPath is a trusted/registered deck folder,
 * validates decoded image buffer (PNG/JPEG/WebP magic bytes, max 15MB),
 * ensures <deckFolder>/_crops exists,
 * saves to <deckFolder>/_crops/crop_<timestamp>_<randomHex>.<ext>,
 * and returns JSON { ok: true, cropPath, cropUrl }.
 */
app.post('/api/crop', (req, res) => {
  try {
    const { folderPath, dataUrl, cardId, tag } = req.body || {};
    if (!folderPath || typeof folderPath !== 'string' || !dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid folderPath or dataUrl' });
    }

    const resolvedFolder = path.resolve(folderPath);
    if (!fs.existsSync(resolvedFolder)) {
      return res.status(404).json({ error: `Folder not found: ${resolvedFolder}` });
    }

    let realFolder;
    try {
      realFolder = fs.realpathSync(resolvedFolder);
    } catch (err) {
      return res.status(404).json({ error: `Folder not found: ${resolvedFolder}` });
    }

    const stat = fs.statSync(realFolder);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Not a directory: ${resolvedFolder}` });
    }

    if (!isPathAllowedInRegisteredDecks(realFolder)) {
      return res.status(403).json({ error: 'Access denied: folderPath must be a registered deck folder' });
    }

    const base64Data = dataUrl.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Reject over 15 MB decoded
    const MAX_CROP_BYTES = 15 * 1024 * 1024;
    if (buffer.length > MAX_CROP_BYTES) {
      return res.status(413).json({ error: 'Payload too large: crop exceeds 15 MB' });
    }

    // Magic bytes verification for PNG / JPEG / WebP
    let imgExt = null;
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    ) {
      imgExt = 'png';
    } else if (
      buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    ) {
      imgExt = 'jpg';
    } else if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      imgExt = 'webp';
    }

    if (!imgExt) {
      return res.status(415).json({ error: 'Invalid image format: buffer magic bytes must be PNG, JPEG, or WebP' });
    }

    const cropsDir = path.join(realFolder, '_crops');
    if (!fs.existsSync(cropsDir)) {
      fs.mkdirSync(cropsDir, { recursive: true });
    }

    const randomHex = crypto.randomBytes(4).toString('hex');
    const filename = `crop_${Date.now()}_${randomHex}.${imgExt}`;
    const savedFilePath = path.join(cropsDir, filename);

    fs.writeFileSync(savedFilePath, buffer);

    res.json({
      ok: true,
      cropPath: savedFilePath,
      cropUrl: '/api/image?path=' + encodeURIComponent(savedFilePath)
    });
  } catch (err) {
    console.error('[API /api/crop] Error saving crop:', err);
    res.status(500).json({ error: `Failed to save crop: ${err.message}` });
  }
});

/**
 * DELETE /api/crop
 * Accepts JSON { cropPath }
 * Verifies cropPath resides inside a _crops subfolder within a registered deck folder,
 * unlinks the file from disk (ignoring ENOENT if already gone), and returns JSON { ok: true }.
 */
app.delete('/api/crop', (req, res) => {
  try {
    const cropPath = (req.body && req.body.cropPath) ? req.body.cropPath : (req.query && (req.query.cropPath || req.query.path));
    if (!cropPath || typeof cropPath !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid cropPath' });
    }

    const resolved = path.resolve(cropPath);
    let realCropPath;
    try {
      realCropPath = fs.realpathSync(resolved);
    } catch (err) {
      if (err.code === 'ENOENT') {
        const parentDir = path.dirname(resolved);
        try {
          const realParent = fs.realpathSync(parentDir);
          realCropPath = path.join(realParent, path.basename(resolved));
        } catch (e) {
          realCropPath = resolved;
        }
      } else {
        return res.status(400).json({ error: `Invalid crop path: ${err.message}` });
      }
    }

    if (fs.existsSync(realCropPath) && fs.statSync(realCropPath).isDirectory()) {
      return res.status(400).json({ error: 'Target path is a directory, not a crop file' });
    }

    const deckFolders = getRegisteredDeckFolders();
    let isInsideRegisteredCrops = false;

    for (const df of deckFolders) {
      let realDf;
      try {
        realDf = fs.realpathSync(df);
      } catch (e) {
        realDf = path.resolve(df);
      }

      // Check if realCropPath is inside <realDf>/_crops
      const allowedCropsDir = path.join(realDf, '_crops');
      let realCropsDir;
      try {
        realCropsDir = fs.realpathSync(allowedCropsDir);
      } catch (e) {
        realCropsDir = path.resolve(allowedCropsDir);
      }

      if (isPathInside(realCropPath, realCropsDir) && realCropPath !== realCropsDir) {
        isInsideRegisteredCrops = true;
        break;
      }

      // Also allow subdirectories inside realDf that have a _crops directory
      if (isPathInside(realCropPath, realDf) && realCropPath !== realDf) {
        const relativeParts = path.relative(realDf, realCropPath).split(path.sep);
        const cropsIndex = relativeParts.indexOf('_crops');
        if (cropsIndex !== -1 && cropsIndex < relativeParts.length - 1) {
          isInsideRegisteredCrops = true;
          break;
        }
      }
    }

    if (!isInsideRegisteredCrops) {
      return res.status(403).json({ error: 'Access denied: cropPath must reside inside a _crops subfolder of a registered deck folder' });
    }

    try {
      fs.unlinkSync(realCropPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[API /api/crop DELETE] Error deleting crop:', err);
    res.status(500).json({ error: `Failed to delete crop: ${err.message}` });
  }
});

// ==================== SSRF Protection & Safe Network Client ====================

// IPv4 private & reserved ranges (RFC 1122, RFC 1918, RFC 3927, RFC 5737, RFC 6598, etc.)
const IPV4_BLOCKED_CIDRS = [
  '0.0.0.0/8',       // "This" network
  '10.0.0.0/8',      // RFC 1918 private
  '100.64.0.0/10',   // CGNAT / shared address space
  '127.0.0.0/8',     // Loopback
  '169.254.0.0/16',  // Link-local / AWS/GCP cloud metadata (169.254.169.254)
  '172.16.0.0/12',   // RFC 1918 private
  '192.0.0.0/24',    // IETF Protocol Assignments
  '192.0.2.0/24',    // TEST-NET-1 documentation
  '192.88.99.0/24',  // 6to4 relay anycast
  '192.168.0.0/16',  // RFC 1918 private
  '198.18.0.0/15',   // Benchmarking
  '198.51.100.0/24', // TEST-NET-2 documentation
  '203.0.113.0/24',  // TEST-NET-3 documentation
  '224.0.0.0/4',     // Multicast
  '240.0.0.0/4',     // Reserved
  '255.255.255.255/32' // Limited broadcast
];

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

function longToIp(num) {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
}

const PARSED_V4_CIDRS = IPV4_BLOCKED_CIDRS.map(cidr => {
  const [base, prefix] = cidr.split('/');
  const prefixLen = parseInt(prefix, 10);
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return { baseLong: ipToLong(base) & mask, mask, cidr };
});

function isPrivateOrReservedIPv4(ip) {
  const ipLong = ipToLong(ip);
  for (const { baseLong, mask, cidr } of PARSED_V4_CIDRS) {
    if ((ipLong & mask) === baseLong) return { blocked: true, reason: `Matched ${cidr}` };
  }
  return { blocked: false };
}

function ipv6ToBigInt(ip) {
  let cleanIp = ip.toLowerCase();
  const matchDotted = cleanIp.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (matchDotted) {
    const v4 = matchDotted[1].split('.').map(Number);
    const hex = ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
    cleanIp = cleanIp.replace(matchDotted[1], hex);
  }
  const parts = cleanIp.split('::');
  let left = parts[0] ? parts[0].split(':') : [];
  let right = parts[1] ? parts[1].split(':') : [];
  if (parts.length > 1) {
    const missing = 8 - (left.length + right.length);
    const middle = new Array(missing).fill('0');
    left = [...left, ...middle, ...right];
  }
  const groups = left.map(g => parseInt(g || '0', 16));
  let result = 0n;
  for (const g of groups) {
    result = (result << 16n) | BigInt(g);
  }
  return result;
}

const IPV6_BLOCKED_CIDRS = [
  '::/128',          // Unspecified
  '::1/128',        // Loopback
  'fc00::/7',       // Unique Local Addresses (ULA)
  'fe80::/10',      // Link-Local Unicast
  'ff00::/8',       // Multicast
  '2001:db8::/32',  // Documentation
  '100::/64',       // Discard-only
  '64:ff9b::/96'    // IPv4/IPv6 translation
];

const PARSED_V6_CIDRS = IPV6_BLOCKED_CIDRS.map(cidr => {
  const [base, prefix] = cidr.split('/');
  const prefixLen = parseInt(prefix, 10);
  const totalBits = 128n;
  const shift = totalBits - BigInt(prefixLen);
  const mask = prefixLen === 0 ? 0n : (((1n << BigInt(prefixLen)) - 1n) << shift);
  return { baseInt: ipv6ToBigInt(base) & mask, mask, cidr };
});

function isPrivateOrReservedIPv6(ip) {
  const bigInt = ipv6ToBigInt(ip);
  for (const { baseInt, mask, cidr } of PARSED_V6_CIDRS) {
    if ((bigInt & mask) === baseInt) return { blocked: true, reason: `Matched ${cidr}` };
  }
  // IPv4-mapped (::ffff:0:0/96)
  const v4MappedMask = ((1n << 96n) - 1n) << 32n;
  const v4MappedBase = 0xffffn << 32n;
  if ((bigInt & v4MappedMask) === v4MappedBase) {
    const lower32 = Number(bigInt & 0xffffffffn);
    const extractedV4 = longToIp(lower32);
    const v4Check = isPrivateOrReservedIPv4(extractedV4);
    if (v4Check.blocked) {
      return { blocked: true, reason: `IPv4-mapped address ${extractedV4} is private/reserved (${v4Check.reason})` };
    }
  }
  // 6to4 (2002::/16)
  const v6to4Mask = ((1n << 16n) - 1n) << 112n;
  const v6to4Base = 0x2002n << 112n;
  if ((bigInt & v6to4Mask) === v6to4Base) {
    const lowerV4 = Number((bigInt >> 80n) & 0xffffffffn);
    const extractedV4 = longToIp(lowerV4);
    const v4Check = isPrivateOrReservedIPv4(extractedV4);
    if (v4Check.blocked) {
      return { blocked: true, reason: `6to4 embedded address ${extractedV4} is private/reserved (${v4Check.reason})` };
    }
  }
  return { blocked: false };
}

function isPrivateOrReservedIP(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateOrReservedIPv4(ip);
  if (kind === 6) return isPrivateOrReservedIPv6(ip);
  return { blocked: true, reason: `Invalid IP address format: ${ip}` };
}

/**
 * Validates a user-supplied external URL upfront:
 * - Scheme must be strictly http: or https:
 * - Reject embedded credentials (user:pass@)
 * - Block local/internal hostnames (localhost, *.local, *.internal, etc.)
 * - Check literal IP addresses against private and reserved CIDRs
 * - Perform DNS resolution and verify that all resolved IPv4/IPv6 addresses are public
 */
async function validateExternalUrl(urlString, options = {}) {
  if (!urlString || typeof urlString !== 'string') {
    return { blocked: true, reason: 'Empty or non-string URL provided' };
  }

  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch (err) {
    return { blocked: true, reason: `Malformed URL: ${err.message}` };
  }

  const protocol = (parsed.protocol || '').toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { blocked: true, reason: `Disallowed protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.` };
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : (protocol === 'https:' ? 443 : 80);
  if (port !== 80 && port !== 443 && !options._allowLocalhostForTesting) {
    return { blocked: true, reason: `Disallowed port "${port}". Outbound requests are restricted to ports 80 and 443.` };
  }

  if (parsed.username || parsed.password) {
    return { blocked: true, reason: 'URLs with embedded credentials (user:pass@) are prohibited.' };
  }

  let hostname = (parsed.hostname || '').toLowerCase().trim();
  if (!hostname) {
    return { blocked: true, reason: 'Missing hostname in URL.' };
  }

  // Strip IPv6 brackets
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  const allowLocalForTesting = Boolean(options._allowLocalhostForTesting);

  // Block obvious local names
  if (
    !allowLocalForTesting && (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.home.arpa') ||
      hostname === '0.0.0.0'
    )
  ) {
    return { blocked: true, reason: `Blocked local or internal hostname: ${parsed.hostname}` };
  }

  // Check if hostname is already a literal IP
  const ipKind = net.isIP(hostname);
  if (ipKind !== 0) {
    if (allowLocalForTesting && (hostname === '127.0.0.1' || hostname === '::1')) {
      return { blocked: false, parsedUrl: parsed, isLiteralIp: true, ip: hostname };
    }
    const ipCheck = isPrivateOrReservedIP(hostname);
    if (ipCheck.blocked) {
      return { blocked: true, reason: `Blocked private or reserved IP address: ${hostname} (${ipCheck.reason})` };
    }
    return { blocked: false, parsedUrl: parsed, isLiteralIp: true, ip: hostname };
  }

  // Resolve hostname via DNS to verify all associated addresses
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (!addresses || addresses.length === 0) {
      return { blocked: true, reason: `DNS lookup returned no addresses for host "${hostname}".` };
    }

    for (const addr of addresses) {
      if (allowLocalForTesting && (addr.address === '127.0.0.1' || addr.address === '::1')) {
        continue;
      }
      const check = isPrivateOrReservedIP(addr.address);
      if (check.blocked) {
        return {
          blocked: true,
          reason: `Host "${hostname}" resolved to blocked private/reserved IP: ${addr.address} (${check.reason})`
        };
      }
    }
  } catch (err) {
    return { blocked: true, reason: `DNS resolution failed for host "${hostname}": ${err.message}` };
  }

  return { blocked: false, parsedUrl: parsed, isLiteralIp: false };
}

/**
 * Socket-level DNS lookup handler preventing DNS rebinding during connection.
 */
function createSafeLookup(options = {}) {
  const allowLocalForTesting = Boolean(options._allowLocalhostForTesting);
  return function safeLookup(hostname, lookupOpts, callback) {
    if (typeof lookupOpts === 'function') {
      callback = lookupOpts;
      lookupOpts = {};
    }

    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses || addresses.length === 0) {
        return callback(new Error(`DNS resolution returned no addresses for "${hostname}"`));
      }

      for (const addr of addresses) {
        if (allowLocalForTesting && (addr.address === '127.0.0.1' || addr.address === '::1')) {
          continue;
        }
        const check = isPrivateOrReservedIP(addr.address);
        if (check.blocked) {
          return callback(new Error(`Security violation: host "${hostname}" resolved to blocked IP ${addr.address} (${check.reason})`));
        }
      }

      if (lookupOpts && lookupOpts.all) {
        return callback(null, addresses);
      }
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/**
 * Performs a hardened HTTP(S) request with:
 * - Upfront URL & DNS validation
 * - Socket-level DNS rebinding protection (safeLookup)
 * - Safe manual redirect following with per-hop validation
 * - Hard timeout
 * - Response size capping (streaming abort)
 */
async function safeHttpRequest(initialUrl, options = {}) {
  const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : 5;
  const timeoutMs = options.timeoutMs || 10000;
  const maxBytes = options.maxBytes || 25 * 1024 * 1024; // 25 MB default
  const headers = options.headers || {};
  const method = (options.method || 'GET').toUpperCase();
  const lookup = createSafeLookup(options);

  let currentUrl = initialUrl;
  let redirectCount = 0;
  const visitedUrls = new Set();

  while (true) {
    const validateOpts = redirectCount === 0 ? options : {};
    const valResult = await validateExternalUrl(currentUrl, validateOpts);
    if (valResult.blocked) {
      const err = new Error(`SSRF Validation Error: ${valResult.reason}`);
      err.code = 'ERR_SSRF_BLOCKED';
      throw err;
    }

    const parsed = valResult.parsedUrl;
    visitedUrls.add(currentUrl);

    const client = parsed.protocol === 'https:' ? https : http;

    // Strip Referer unless host is pinimg.com (or *.pinimg.com)
    const isPinImg = parsed.hostname === 'pinimg.com' || parsed.hostname.endsWith('.pinimg.com');
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...headers
    };
    if (!isPinImg) {
      delete reqHeaders['Referer'];
      delete reqHeaders['referer'];
      delete reqHeaders['REFERER'];
    }

    const reqOptions = {
      method,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: reqHeaders,
      lookup
    };

    const response = await new Promise((resolve, reject) => {
      let isSettled = false;
      let downloadedBytes = 0;
      const chunks = [];

      const timer = setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        const err = new Error(`Request timed out after ${timeoutMs}ms`);
        err.code = 'ETIMEDOUT';
        req.destroy(err);
        reject(err);
      }, timeoutMs);

      const req = client.request(reqOptions, (res) => {
        // Check content-length header upfront if present
        const clHeader = res.headers['content-length'];
        if (clHeader) {
          const declaredSize = parseInt(clHeader, 10);
          if (declaredSize > maxBytes) {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);
            const err = new Error(`Response size (${declaredSize} bytes) exceeds maximum permitted limit (${maxBytes} bytes)`);
            err.code = 'ERR_RESPONSE_TOO_LARGE';
            req.destroy(err);
            res.destroy(err);
            return reject(err);
          }
        }

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (downloadedBytes > maxBytes) {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);
            const err = new Error(`Response exceeded maximum permitted limit of ${maxBytes} bytes`);
            err.code = 'ERR_RESPONSE_TOO_LARGE';
            req.destroy(err);
            res.destroy(err);
            return reject(err);
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timer);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
            finalUrl: currentUrl
          });
        });

        res.on('error', (err) => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timer);
          reject(err);
        });
      });

      req.on('error', (err) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        reject(err);
      });

      req.end();
    });

    // Handle redirects (301, 302, 303, 307, 308)
    const isRedirect = [301, 302, 303, 307, 308].includes(response.statusCode);
    if (isRedirect && response.headers.location) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        const err = new Error(`Too many redirects (exceeded limit of ${maxRedirects})`);
        err.code = 'ERR_TOO_MANY_REDIRECTS';
        throw err;
      }

      const nextUrl = new URL(response.headers.location, currentUrl).toString();
      if (visitedUrls.has(nextUrl)) {
        const err = new Error(`Redirect loop detected: ${nextUrl}`);
        err.code = 'ERR_REDIRECT_LOOP';
        throw err;
      }

      currentUrl = nextUrl;
      continue;
    }

    return response;
  }
}

/**
 * Checks if a hostname belongs to Pinterest (e.g. pinterest.com, *.pinterest.com, pin.it, *.pin.it)
 */
function isPinterestHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const clean = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');
  return /^([a-z0-9-]+\.)*(pinterest\.[a-z.]+|pin\.it)$/i.test(clean);
}

/**
 * POST /api/download-url
 * Downloads an image from a direct URL or resolves a Pinterest Pin URL (originals resolution)
 * and saves it directly to the target deck's folder on disk with comprehensive SSRF protection.
 */
app.post('/api/download-url', async (req, res) => {
  try {
    const { folderPath, url } = req.body || {};

    if (!folderPath || !url) {
      return res.status(400).json({ error: 'Missing "folderPath" or "url" in request body' });
    }

    const resolvedFolder = path.resolve(folderPath);
    if (!fs.existsSync(resolvedFolder)) {
      return res.status(404).json({ error: `Target folder not found: ${resolvedFolder}` });
    }

    const stat = fs.statSync(resolvedFolder);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Target path is not a directory: ${resolvedFolder}` });
    }

    // When APP_RUNTIME === 'electron', folderPath must be inside or equal to a registered deck folder. Otherwise 403.
    if (process.env.APP_RUNTIME === 'electron') {
      if (!isPathAllowedInRegisteredDecks(resolvedFolder)) {
        return res.status(403).json({ error: 'Access denied: folderPath must be a registered deck folder' });
      }
    }

    const trimmedUrl = String(url).trim();

    // Upfront SSRF validation on the initial URL
    const initialCheck = await validateExternalUrl(trimmedUrl);
    if (initialCheck.blocked) {
      return res.status(400).json({ error: initialCheck.reason });
    }

    let targetImageUrl = trimmedUrl;

    // Check if URL is a Pinterest webpage (e.g. pinterest.com/pin/... or pin.it/...)
    const initialHostname = initialCheck.parsedUrl.hostname;
    const isPinterestPage = isPinterestHost(initialHostname) &&
      (/(?:pinterest\.[a-z.]+\/pin\/|pin\.it\/)/i.test(targetImageUrl) || targetImageUrl.includes('/pin/'));

    if (isPinterestPage) {
      // Scrape Pinterest pin page HTML safely with 2MB response cap and 10s timeout
      let pageRes;
      try {
        pageRes = await safeHttpRequest(targetImageUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          timeoutMs: 10000,
          maxBytes: 2 * 1024 * 1024 // 2MB HTML max
        });
      } catch (pageErr) {
        const statusCode = pageErr.code === 'ETIMEDOUT' ? 504 : 400;
        return res.status(statusCode).json({ error: `Failed to fetch Pinterest webpage: ${pageErr.message}` });
      }

      if (pageRes.statusCode < 200 || pageRes.statusCode >= 300) {
        return res.status(pageRes.statusCode).json({
          error: `Failed to fetch Pinterest webpage (${pageRes.statusCode})`
        });
      }

      const html = pageRes.buffer.toString('utf8');

      // Extract image URL from <meta property="og:image" content="..."> or https://i.pinimg.com/...
      const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
                      html.match(/<meta[^>]+name=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["'](?:og:image|twitter:image)["']/i);

      if (ogMatch && ogMatch[1]) {
        targetImageUrl = ogMatch[1].replace(/&amp;/g, '&');
      } else {
        const pinImgMatch = html.match(/https:\/\/i\.pinimg\.com\/(?:originals|\d+x)\/[^"'\s<>)]+\.(?:jpg|jpeg|png|webp)/i);
        if (pinImgMatch && pinImgMatch[0]) {
          targetImageUrl = pinImgMatch[0];
        } else {
          return res.status(404).json({ error: 'Could not resolve image URL from Pinterest page' });
        }
      }

      // Re-validate the newly extracted image URL
      const targetCheck = await validateExternalUrl(targetImageUrl);
      if (targetCheck.blocked) {
        return res.status(400).json({ error: targetCheck.reason });
      }
    }

    let finalImageUrl = targetImageUrl;
    let imageRes = null;

    // Upgrade any i.pinimg.com/236x/, 474x, 564x, or 736x URL to i.pinimg.com/originals/
    if (targetImageUrl.includes('i.pinimg.com')) {
      const originalsUrl = targetImageUrl.replace(/\/(?:236x|474x|564x|736x)\//, '/originals/');
      if (originalsUrl !== targetImageUrl) {
        try {
          const testRes = await safeHttpRequest(originalsUrl, {
            headers: {
              'Referer': 'https://www.pinterest.com/'
            },
            timeoutMs: 10000,
            maxBytes: 25 * 1024 * 1024
          });
          if (testRes.statusCode >= 200 && testRes.statusCode < 300) {
            imageRes = testRes;
            finalImageUrl = originalsUrl;
          }
        } catch (origErr) {
          // If originals URL fails or 404s, fall back to downloading targetImageUrl below
        }
      }
    }

    // Fetch the image (or fallback to original targetImageUrl)
    if (!imageRes) {
      try {
        imageRes = await safeHttpRequest(targetImageUrl, {
          headers: {
            'Referer': 'https://www.pinterest.com/'
          },
          timeoutMs: 10000,
          maxBytes: 25 * 1024 * 1024
        });
      } catch (imgErr) {
        const statusCode = imgErr.code === 'ETIMEDOUT' ? 504 : 400;
        return res.status(statusCode).json({ error: `Failed to download image: ${imgErr.message}` });
      }
    }

    if (imageRes.statusCode < 200 || imageRes.statusCode >= 300) {
      return res.status(imageRes.statusCode).json({
        error: `Failed to download image from ${finalImageUrl} (${imageRes.statusCode})`
      });
    }

    const buffer = imageRes.buffer;

    // Validate that downloaded content is actually an image (content-type or magic bytes)
    const contentType = (imageRes.headers['content-type'] || '').toLowerCase();
    let ext = '';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      ext = 'jpg';
    } else if (contentType.includes('png')) {
      ext = 'png';
    } else if (contentType.includes('webp')) {
      ext = 'webp';
    } else if (contentType.includes('gif')) {
      ext = 'gif';
    }

    // Magic byte sniffing
    if (!ext) {
      if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        ext = 'jpg';
      } else if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 && buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
        ext = 'png';
      } else if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        ext = 'webp';
      } else if (buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')) {
        ext = 'gif';
      } else {
        try {
          const pathname = new URL(finalImageUrl).pathname;
          const pathExt = path.extname(pathname).toLowerCase().replace('.', '');
          if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(pathExt)) {
            ext = pathExt === 'jpeg' ? 'jpg' : pathExt;
          }
        } catch (e) {}
      }
    }

    if (!ext) {
      return res.status(400).json({ error: 'Downloaded file does not appear to be a valid image (JPEG, PNG, WebP, GIF).' });
    }

    let fileName = `pin_${Date.now()}.${ext}`;
    let savedFilePath = path.join(resolvedFolder, fileName);
    if (fs.existsSync(savedFilePath)) {
      fileName = `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      savedFilePath = path.join(resolvedFolder, fileName);
    }

    fs.writeFileSync(savedFilePath, buffer);

    const hash = computeFileHash(savedFilePath);
    hashToPathMap.set(hash, savedFilePath);
    metaCache.delete(resolvedFolder);

    res.json({
      success: true,
      image: {
        id: hash,
        hash,
        path: savedFilePath,
        name: fileName
      }
    });
  } catch (err) {
    console.error('[API /api/download-url] Error:', err);
    res.status(500).json({ error: `Download failed: ${err.message}` });
  }
});

/**
 * Starts the HTTP server on the specified port.
 * Explicitly binds to loopback (127.0.0.1) for local security,
 * and automatically retries on dynamic port 0 if the preferred port is occupied (EADDRINUSE).
 * Resolves with { server, port } once the port is bound.
 */
function startServer(port = 3000) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const boundPort = server.address().port;
      boundServerPort = boundPort;
      app.set('port', boundPort);
      console.log(`\n  Art Practice Reference App running at:`);
      console.log(`  → http://127.0.0.1:${boundPort}`);
      console.log(`  → http://localhost:${boundPort}\n`);
      resolve({ server, port: boundPort });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port !== 0) {
        console.warn(`[Server] Port ${port} is in use; retrying on dynamic port (0)...`);
        startServer(0).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

// Auto-start when executed directly via `node server.js`
if (require.main === module) {
  startServer(PORT).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  USERDATA_DIR,
  SKETCHES_DIR,
  STATE_FILE,
  BACKUPS_DIR,
  writeStateFile,
  safeHttpRequest,
  validateExternalUrl,
  ROTATION_WINDOW_MS,
  setRotationClock,
  resetRotationState,
  getLocalDateString,
  pruneDailySnapshots,
  createDailySnapshot,
  getBackupCandidates,
  registerTrustedFolder,
  clearTrustedFolders,
  getRegisteredDeckFolders,
  isPathAllowedInRegisteredDecks,
  computeFileHash,
  hashToPathMap
};
