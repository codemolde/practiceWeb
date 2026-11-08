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
const PORT = process.env.PORT || 3000;

// Enable JSON body parser with generous limit for large image collections & review history
app.use(express.json({ limit: '50mb' }));

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Persistent Disk Storage for SRS Database & Visual Sketch History
const USERDATA_DIR = process.env.USER_DATA_DIR || path.join(__dirname, 'userdata');
const STATE_FILE = path.join(USERDATA_DIR, 'srs_state.json');
const SKETCHES_DIR = path.join(USERDATA_DIR, 'sketches');

// Ensure userdata and sketches directories exist on startup
fs.mkdirSync(SKETCHES_DIR, { recursive: true });

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
          if (attempt && typeof attempt.sketchUrl === 'string' && attempt.sketchUrl.startsWith('data:image/')) {
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
      // Skip hidden directories
      if (!entry.name.startsWith('.')) {
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
    // Skip hidden files/dirs
    if (entry.name.startsWith('.')) continue;

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

  const resolved = path.resolve(target);

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: `File not found: ${resolved}` });
  }

  // Determine MIME type
  const ext = path.extname(resolved).toLowerCase();
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

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  if (req.query.hash) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  res.sendFile(resolved);
});

/**
 * POST /api/sync
 * Writes the SRS database (cards, decks, history, wallpaper settings) directly to userdata/srs_state.json.
 * Uses a serialized Promise queue, unique .tmp file, fileHandle.sync(), and .bak backup before rename.
 */
let stateWriteQueue = Promise.resolve();

async function writeStateFile(state) {
  const task = async () => {
    if (!fs.existsSync(USERDATA_DIR)) {
      await fs.promises.mkdir(USERDATA_DIR, { recursive: true });
    }

    let tempFile = `${STATE_FILE}.${Date.now()}.tmp`;
    if (fs.existsSync(tempFile)) {
      tempFile = `${STATE_FILE}.${Date.now()}_${Math.random().toString(36).slice(2, 6)}.tmp`;
    }
    const bakFile = `${STATE_FILE}.bak`;
    const jsonStr = JSON.stringify(state, null, 2);

    const fileHandle = await fs.promises.open(tempFile, 'w');
    try {
      await fileHandle.writeFile(jsonStr, 'utf8');
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    if (fs.existsSync(STATE_FILE)) {
      try {
        await fs.promises.copyFile(STATE_FILE, bakFile);
      } catch (bakErr) {
        console.warn('[Sync] Failed to backup previous state file:', bakErr);
      }
    }

    await fs.promises.rename(tempFile, STATE_FILE);
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

    const state = {
      version: 1,
      lastSaved: new Date().toISOString(),
      decks: Array.isArray(payload.decks) ? payload.decks : [],
      cards: payload.cards && typeof payload.cards === 'object' ? payload.cards : {},
      history: payload.history && typeof payload.history === 'object' ? payload.history : {},
      wallpaperSettings: payload.wallpaperSettings || null
    };

    const stats = await writeStateFile(state);

    const totalDecks = state.decks.length;
    const totalCards = Object.values(state.cards).reduce((acc, d) => acc + Object.keys(d || {}).length, 0);

    res.json({
      success: true,
      lastSaved: state.lastSaved,
      sizeBytes: stats.size,
      decksCount: totalDecks,
      cardsCount: totalCards
    });
  } catch (err) {
    console.error('[API /api/sync] Error writing SRS state to disk:', err);
    res.status(500).json({ error: `Failed to save SRS database to disk: ${err.message}` });
  }
});

/**
 * GET /api/sync
 * Reads the persistent SRS database from userdata/srs_state.json on disk.
 * Falls back to srs_state.json.bak if the primary file fails JSON parsing.
 */
app.get('/api/sync', (req, res) => {
  const bakFile = `${STATE_FILE}.bak`;
  try {
    if (!fs.existsSync(STATE_FILE)) {
      if (fs.existsSync(bakFile)) {
        try {
          const bakRaw = fs.readFileSync(bakFile, 'utf8');
          const data = JSON.parse(bakRaw);
          console.warn('[API /api/sync] Primary STATE_FILE not found; recovered from .bak');
          return res.json({
            exists: true,
            lastSaved: data.lastSaved,
            data
          });
        } catch (bakErr) {
          console.error('[API /api/sync] Error reading backup SRS state from disk:', bakErr);
        }
      }
      return res.json({ exists: false, data: null });
    }

    let data;
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.warn('[API /api/sync] Primary STATE_FILE corrupted/invalid JSON, falling back to .bak:', parseErr.message);
      if (fs.existsSync(bakFile)) {
        const bakRaw = fs.readFileSync(bakFile, 'utf8');
        data = JSON.parse(bakRaw);
        console.warn('[API /api/sync] Successfully recovered SRS state from .bak file');
      } else {
        throw parseErr;
      }
    }

    res.json({
      exists: true,
      lastSaved: data.lastSaved,
      data
    });
  } catch (err) {
    console.error('[API /api/sync] Error reading SRS state from disk:', err);
    res.status(500).json({ error: `Failed to read SRS database from disk: ${err.message}` });
  }
});

/**
 * POST /api/sketch
 * Saves a Base64 sketch image to userdata/sketches/sk_${Date.now()}.png
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
    const filename = `sk_${Date.now()}.png`;
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
 * POST /api/sketch-history
 * Saves an artist's digital sketch screenshot/photo to disk in userdata/sketches/
 * and returns the persistent local URL for visual history comparison.
 */
app.post('/api/sketch-history', (req, res) => {
  try {
    const { imageId, dataUrl } = req.body || {};
    if (!dataUrl || !imageId) {
      return res.status(400).json({ error: 'Missing imageId or dataUrl' });
    }

    if (!fs.existsSync(SKETCHES_DIR)) {
      fs.mkdirSync(SKETCHES_DIR, { recursive: true });
    }

    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid data URL format' });
    }

    let ext = matches[1].toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const safeId = String(imageId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(-32);
    const filename = `sketch_${safeId}_${Date.now()}.${ext}`;
    const filePath = path.join(SKETCHES_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    const sketchUrl = `/api/sketch?file=${encodeURIComponent(filename)}`;
    res.json({
      success: true,
      filename,
      sketchUrl,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('[API /api/sketch-history] Error saving sketch:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sketch?file=<filename>
 * Serves a saved sketch image from userdata/sketches/
 */
app.get('/api/sketch', (req, res) => {
  const filename = req.query.file;
  if (!filename) {
    return res.status(400).json({ error: 'Missing "file" query parameter' });
  }

  const safeFilename = path.basename(filename);
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
});

/**
 * DELETE /api/sketch?file=<filename>
 * Deletes a saved sketch attempt from disk
 */
app.delete('/api/sketch', (req, res) => {
  const filename = req.query.file || (req.body && req.body.file);
  if (!filename) return res.status(400).json({ error: 'Missing "file" parameter' });

  const safeFilename = path.basename(filename);
  const resolved = path.join(SKETCHES_DIR, safeFilename);

  if (fs.existsSync(resolved)) {
    try {
      fs.unlinkSync(resolved);
    } catch (e) {}
  }

  res.json({ success: true });
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

    const reqOptions = {
      method,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...headers
      },
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

    const trimmedUrl = String(url).trim();

    // Upfront SSRF validation on the initial URL
    const initialCheck = await validateExternalUrl(trimmedUrl);
    if (initialCheck.blocked) {
      return res.status(400).json({ error: initialCheck.reason });
    }

    const resolvedFolder = path.resolve(folderPath);
    if (!fs.existsSync(resolvedFolder)) {
      return res.status(404).json({ error: `Target folder not found: ${resolvedFolder}` });
    }

    const stat = fs.statSync(resolvedFolder);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Target path is not a directory: ${resolvedFolder}` });
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

// ==================== Electron Native Floating Mode API ====================
let electronFloatHandler = null;

function setElectronFloatHandler(handler) {
  electronFloatHandler = handler;
}

/**
 * Endpoint to toggle or query native Electron Always-on-Top float mode.
 * In Electron, window.documentPictureInPicture is not supported by default;
 * calling this turns the studio window into a compact frameless Always-on-Top window.
 */
app.all('/api/electron-float', (req, res) => {
  if (typeof electronFloatHandler === 'function') {
    try {
      const payload = req.method === 'POST' ? req.body : req.query;
      const result = electronFloatHandler(payload || {});
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('[API /api/electron-float] Error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  return res.json({ success: false, isElectron: false, floating: false });
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
  setElectronFloatHandler,
  USERDATA_DIR,
  SKETCHES_DIR,
  STATE_FILE
};
