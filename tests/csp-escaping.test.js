const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

const appJsCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

function setupTestEnvironment() {
  const elements = new Map();

  function makeElement(id, tagName = 'div') {
    const classList = new Set();
    const listeners = {};
    const dataset = {};
    const style = {};
    let textContent = '';
    let innerHTML = '';

    const el = {
      id,
      tagName: tagName.toUpperCase(),
      dataset,
      style,
      get textContent() { return textContent; },
      set textContent(v) { textContent = String(v); },
      get innerHTML() { return innerHTML; },
      set innerHTML(v) { innerHTML = String(v); },
      classList: {
        add(...cls) { cls.forEach(c => classList.add(c)); },
        remove(...cls) { cls.forEach(c => classList.delete(c)); },
        contains(c) { return classList.has(c); },
        toggle(c, force) {
          if (force !== undefined) {
            if (force) classList.add(c);
            else classList.delete(c);
            return force;
          }
          if (classList.has(c)) {
            classList.delete(c);
            return false;
          } else {
            classList.add(c);
            return true;
          }
        }
      },
      addEventListener(event, fn) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
      },
      removeEventListener(event, fn) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(f => f !== fn);
      },
      dispatchEvent(event) {
        if (listeners[event.type]) {
          listeners[event.type].forEach(fn => fn(event));
        }
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
      },
      appendChild(c) { return c; },
      removeChild(c) { return c; },
      click() {}
    };
    elements.set(id, el);
    return el;
  }

  const docElements = [
    'today-due', 'today-practiced', 'today-streak', 'today-decks', 'today-strip',
    'deck-list', 'empty-state', 'view-session', 'modal-shortcuts', 'opacity-hud',
    'heatmap-grid', 'heatmap-months', 'session-rating-area', 'session-workspace',
    'session-pip-placeholder', 'btn-session-pip', 'svg-filters', 'crop-label-input',
    'session-focal-pill', 'session-image', 'timer-text', 'session-progress',
    'floating-heatmap-tooltip', 'todays-reviewed-count', 'todays-reviewed-summary',
    'todays-reviewed-list', 'modal-todays-reviewed', 'stat-longest-streak', 'stat-current-streak',
    'stat-total', 'stat-due', 'stat-reviewed', 'stat-new', 'btn-new-count', 'btn-review-count',
    'btn-study-new', 'btn-review', 'btn-free-study', 'modal-backup', 'btn-export-data', 'btn-import-data',
    'backup-file-input', 'backup-status', 'btn-close-backup', 'btn-close-backup-x',
    'folder-browser-list', 'folder-browser-empty'
  ];
  docElements.forEach(id => makeElement(id));

  const mockStorageMap = new Map();
  const mockLocalStorage = {
    getItem(k) { return mockStorageMap.has(k) ? mockStorageMap.get(k) : null; },
    setItem(k, v) { mockStorageMap.set(k, String(v)); },
    removeItem(k) { mockStorageMap.delete(k); },
    clear() { mockStorageMap.clear(); }
  };

  const context = {
    window: {},
    document: {
      activeElement: null,
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector(sel) {
        if (sel.startsWith('#')) return elements.get(sel.slice(1)) || null;
        return null;
      },
      querySelectorAll() { return []; },
      createElement(tag) { return makeElement('dynamic_' + Math.random().toString(36).slice(2), tag); },
      addEventListener() {},
      removeEventListener() {},
      body: makeElement('body', 'body')
    },
    localStorage: mockLocalStorage,
    navigator: { userAgent: 'test-agent' },
    location: { search: '' },
    console,
    setTimeout,
    clearTimeout,
    Date: global.Date,
    URL: {
      createObjectURL() { return 'blob:mock-url'; },
      revokeObjectURL() {}
    },
    AudioContext: class {
      constructor() { this.state = 'suspended'; this.destination = {}; }
      createOscillator() { return { type: 'sine', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      resume() { this.state = 'running'; return Promise.resolve(); }
    }
  };

  context.window.document = context.document;
  context.window.location = context.location;
  context.window.navigator = context.navigator;
  context.window.AudioContext = context.AudioContext;
  context.window.URL = context.URL;
  context.window.localStorage = context.localStorage;

  vm.createContext(context);
  const exported = vm.runInContext(
    appJsCode + '\n;({ UI, CardManager, DeckManager, Storage, isValidSketchUrl, localDateStr })',
    context
  );

  return { context, elements, ...exported };
}

// ==================== TEST 1: UI._esc ESCAPES ", ', &, <, > ====================
test('a file named a"onmouseover="alert(1).png renders inert (MOCKED)', () => {
  const { UI } = setupTestEnvironment();

  // Basic escaping check
  assert.equal(UI._esc(''), '');
  assert.equal(UI._esc(null), '');
  assert.equal(UI._esc(undefined), '');
  assert.equal(UI._esc('Hello & World'), 'Hello &amp; World');
  assert.equal(UI._esc('<script>'), '&lt;script&gt;');
  assert.equal(UI._esc('"quoted"'), '&quot;quoted&quot;');
  assert.equal(UI._esc("'single'"), '&#39;single&#39;');

  // Critical requirement: a file named a"onmouseover="alert(1).png
  const craftedFileName = 'a"onmouseover="alert(1).png';
  const escaped = UI._esc(craftedFileName);

  assert.equal(escaped, 'a&quot;onmouseover=&quot;alert(1).png');

  // Verify that when placed inside an attribute template literal, quotes do NOT break out
  const titleAttrHtml = `<span class="card-name" title="${escaped}">${escaped}</span>`;
  assert.ok(!titleAttrHtml.includes('title="a"onmouseover='), 'Double quotes must be escaped to &quot;');
  assert.ok(titleAttrHtml.includes('title="a&quot;onmouseover=&quot;alert(1).png"'), 'Must render as inert attribute content');

  const dataPathAttrHtml = `<div class="folder-item" data-path="${UI._esc('/dir/' + craftedFileName)}">`;
  assert.ok(!dataPathAttrHtml.includes('data-path="/dir/a"onmouseover='), 'Data-path attribute must be escaped');
  assert.ok(dataPathAttrHtml.includes('data-path="/dir/a&quot;onmouseover=&quot;alert(1).png"'), 'Attribute remains contained');

  // Verify att.rating escaping prevents attribute breakout
  const craftedRating = 'good" onmouseover="alert(1)';
  const escapedRating = UI._esc(craftedRating);
  const ratingDotHtml = `<span class="rating-dot dot-${escapedRating}"></span>`;
  const ratingBtnHtml = `<button title="${UI._esc(`2026-11-10 • ${craftedRating}`)}">${ratingDotHtml} #1 (${escapedRating})</button>`;
  assert.ok(!ratingDotHtml.includes('dot-good" onmouseover='), 'Rating in dot class must not break out of attribute');
  assert.ok(!ratingBtnHtml.includes('title="2026-11-10 • good" onmouseover='), 'Rating in button title must not break out');
});

// ==================== TEST 2: attempt.sketchUrl VALIDATION & CARDMANAGER CHECKS ====================
test('attempt.sketchUrl only allows /api/sketch/, /api/sketch?file= or data:image/png|jpeg|webp; drops or rejects invalid/dangerous values (MOCKED)', async () => {
  const { isValidSketchUrl, CardManager } = setupTestEnvironment();

  // 1. Allowed values (including legacy /api/sketch?file=)
  assert.equal(isValidSketchUrl('/api/sketch/sketch_12345.png'), true);
  assert.equal(isValidSketchUrl('/api/sketch?file=sketch_12345.png'), true);
  assert.equal(isValidSketchUrl('/api/sketch?file=sketch%20123.png'), true);
  assert.equal(isValidSketchUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='), true);
  assert.equal(isValidSketchUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(isValidSketchUrl('data:image/webp;base64,UklGRm=='), true);

  // 2. Disallowed values
  assert.equal(isValidSketchUrl('javascript:alert(1)'), false);
  assert.equal(isValidSketchUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isValidSketchUrl('data:image/svg+xml;base64,PHN2Zz...'), false);
  assert.equal(isValidSketchUrl('http://malicious.com/exploit.png'), false);
  assert.equal(isValidSketchUrl('https://evil.com/test.png'), false);
  assert.equal(isValidSketchUrl(''), false);
  assert.equal(isValidSketchUrl(null), false);
  assert.equal(isValidSketchUrl(123), false);

  // 3. CardManager.addAttempt drops disallowed sketchUrl
  CardManager.init();
  const testDeckId = 'deck_test';
  CardManager.cards[testDeckId] = {
    img_test: {
      imageId: 'img_test',
      reviewCount: 0,
      attempts: []
    }
  };

  await CardManager.addAttempt(
    testDeckId,
    'img_test',
    { sketchUrl: 'javascript:alert(document.domain)', rating: 'good' }
  );

  const savedCard = CardManager.cards[testDeckId]['img_test'];
  assert.ok(savedCard, 'Card should exist');
  assert.equal(savedCard.attempts.length, 1);
  assert.equal(savedCard.attempts[0].sketchUrl, '', 'Disallowed sketchUrl must be dropped to empty string');
});

// ==================== TEST 3: CRAFTED BACKUP IMPORT REJECTION ====================
test('a backup with a javascript: sketchUrl is rejected (MOCKED)', async () => {
  const env = setupTestEnvironment();
  const { UI, context } = env;

  // Bind backup event handlers
  UI.bindBackupEvents();

  const fileInput = context.document.getElementById('backup-file-input');
  assert.ok(fileInput, 'Backup file input exists');

  // Case A: Backup with javascript: sketchUrl MUST BE REJECTED
  const maliciousBackup = {
    decks: [{ id: 'deck1', name: 'Deck 1', folderPath: '/gestures' }],
    cards: {
      deck1: {
        card1: {
          imageId: 'card1',
          attempts: [
            { id: 'att1', sketchUrl: 'javascript:alert(1)' }
          ]
        }
      }
    }
  };

  const statusEl = context.document.getElementById('backup-status');

  // Hook FileReader in context to deliver the malicious backup payload
  context.FileReader = class {
    readAsText() {
      // Simulate file reading
      this.onload({ target: { result: JSON.stringify(maliciousBackup) } });
    }
  };

  const mockFile = { name: 'backup-evil.json' };
  fileInput.dispatchEvent({ type: 'change', target: { files: [mockFile] } });

  // Allow async handler to run
  await new Promise(r => setTimeout(r, 50));

  // Verify statusEl reports rejection error
  assert.ok(
    statusEl.textContent.includes('Failed to import backup') ||
    statusEl.textContent.includes('disallowed') ||
    statusEl.textContent.includes('Rejected'),
    `Crafted backup with javascript: sketchUrl must be rejected. Got status: "${statusEl.textContent}"`
  );
});

// ==================== TEST 4: SERVER CSP HEADER & SERVER SYNC VALIDATION ====================
test('Server HTML response sends correct CSP header, and POST /api/sync rejects javascript: sketchUrl', async (t) => {
  const { fork } = require('node:child_process');
  const serverPath = path.join(__dirname, '../server.js');

  const testPort = 50992;
  const child = fork(serverPath, [], {
    env: { ...process.env, PORT: String(testPort) },
    silent: true
  });

  t.after(() => {
    child.kill('SIGTERM');
  });

  // Wait for server to bind
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 1. Check CSP header on GET /
  const cspHeader = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${testPort}/`, (res) => {
      resolve(res.headers['content-security-policy']);
    }).on('error', reject);
  });

  assert.ok(cspHeader, 'GET / must return Content-Security-Policy header');
  assert.equal(
    cspHeader,
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    'CSP header must match required policy exactly'
  );

  // 2. Check CSP header on GET /index.html
  const cspIndexHeader = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${testPort}/index.html`, (res) => {
      resolve(res.headers['content-security-policy']);
    }).on('error', reject);
  });

  assert.equal(
    cspIndexHeader,
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
  );

  // 3. POST /api/sync with javascript: sketchUrl MUST BE REJECTED with 400
  const postData = JSON.stringify({
    decks: [{ id: 'deck_malicious', name: 'Malicious Deck', folderPath: '/test' }],
    cards: {
      deck_malicious: {
        card1: {
          imageId: 'card1',
          attempts: [{ sketchUrl: 'javascript:alert(document.cookie)' }]
        }
      }
    },
    confirmReplace: true
  });

  const syncRes = await new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${testPort}/api/sync`, {
      method: 'POST',
      headers: {
        'Host': `127.0.0.1:${testPort}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Sec-Fetch-Site': 'same-origin'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  assert.equal(syncRes.status, 400, 'POST /api/sync must reject javascript: sketchUrl with 400');
  assert.ok(syncRes.body.includes('disallowed sketchUrl'), 'Error message notes disallowed sketchUrl');
});

// ==================== TEST 5: INDEX.HTML HAS NO INLINE SCRIPTS OR INLINE EVENT HANDLERS ====================
test('index.html contains no inline <script> tags or inline event handlers', () => {
  // Check for inline <script> tags (excluding script tags with src=...)
  const scriptTags = indexHtml.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const tag of scriptTags) {
    const hasSrc = /<script\b[^>]*\bsrc\s*=/i.test(tag);
    assert.ok(hasSrc, `Every <script> tag must have a src attribute; found inline script: ${tag.slice(0, 50)}...`);
  }

  // Check for inline event handlers (e.g. onclick=, onload=, onerror=, onmouseover=)
  const inlineHandlerMatch = indexHtml.match(/\s(on[a-z]+)\s*=\s*["'][^"']*["']/gi);
  assert.equal(inlineHandlerMatch, null, `index.html must have no inline event handlers; found: ${inlineHandlerMatch}`);
});

// ==================== TEST 6: LEGACY SKETCHURL SURVIVES SYNC ====================
test('a legacy sketchUrl survives sync (AUTOMATED-RAN)', async (t) => {
  const { fork } = require('node:child_process');
  const serverPath = path.join(__dirname, '../server.js');

  const testPort = 50995;
  const child = fork(serverPath, [], {
    env: { ...process.env, PORT: String(testPort) },
    silent: true
  });

  t.after(() => {
    child.kill('SIGTERM');
  });

  // Wait for server to bind
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const legacySketchUrl = '/api/sketch?file=sketch_legacy_artist_123.png';
  const postData = JSON.stringify({
    decks: [{ id: 'deck_legacy_sync', name: 'Legacy Sync Deck', folderPath: '/test-legacy' }],
    cards: {
      deck_legacy_sync: {
        card_legacy: {
          imageId: 'card_legacy',
          imageName: 'legacy.png',
          attempts: [
            { id: 'att_leg_1', date: '2026-11-10', rating: 'good', sketchUrl: legacySketchUrl }
          ]
        }
      }
    },
    confirmReplace: true
  });

  const syncRes = await new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${testPort}/api/sync`, {
      method: 'POST',
      headers: {
        'Host': `127.0.0.1:${testPort}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Sec-Fetch-Site': 'same-origin'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  assert.equal(syncRes.status, 200, `POST /api/sync must accept legacy sketchUrl. Got: ${syncRes.status} ${syncRes.body}`);

  // Fetch back via GET /api/sync
  const getRes = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${testPort}/api/sync`, {
      headers: {
        'Host': `127.0.0.1:${testPort}`,
        'Sec-Fetch-Site': 'same-origin'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
    }).on('error', reject);
  });

  assert.equal(getRes.status, 200, 'GET /api/sync returns 200');
  const attempts = getRes.json.data?.cards?.deck_legacy_sync?.card_legacy?.attempts;
  assert.ok(Array.isArray(attempts) && attempts.length === 1, 'Card must have saved attempts');
  assert.equal(attempts[0].sketchUrl, '/api/sketch/sketch_legacy_artist_123.png', 'Legacy /api/sketch?file= must survive sync without deletion (migrated to /api/sketch/:filename)');
});
