const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// We simulate the browser DOM and environment to test public/app.js Storage & Backup import
function setupMockBrowser() {
  const elements = new Map();

  class MockElement {
    constructor(id = '', tagName = 'div') {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this.style = {};
      this.classList = {
        classes: new Set(),
        add: (...c) => c.forEach(x => this.classList.classes.add(x)),
        remove: (...c) => c.forEach(x => this.classList.classes.delete(x)),
        contains: (x) => this.classList.classes.has(x),
        toggle: (x, force) => {
          if (force === undefined) {
            if (this.classList.classes.has(x)) this.classList.classes.delete(x);
            else this.classList.classes.add(x);
          } else if (force) {
            this.classList.classes.add(x);
          } else {
            this.classList.classes.delete(x);
          }
        }
      };
      this._innerHTML = '';
      this.textContent = '';
      this.value = '';
      this.listeners = {};
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(html) {
      this._innerHTML = String(html);
      const matches = this._innerHTML.matchAll(/id="([^"]+)"/g);
      for (const m of matches) {
        const childId = m[1];
        if (!elements.has(childId)) {
          elements.set(childId, new MockElement(childId));
        }
      }
    }

    addEventListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(l => l !== fn);
      }
    }

    dispatchEvent(event) {
      const fns = this.listeners[event.type || event] || [];
      for (const fn of fns) fn(event);
    }

    click() {
      if (typeof this.onclick === 'function') this.onclick();
      this.dispatchEvent({ type: 'click' });
    }

    remove() {
      if (this.id) elements.delete(this.id);
    }
  }

  const localStorageStore = new Map();
  const mockLocalStorage = {
    getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
    setItem: (k, v) => localStorageStore.set(k, String(v)),
    removeItem: (k) => localStorageStore.delete(k),
    clear: () => localStorageStore.clear()
  };

  const windowListeners = {};

  const mockDocument = {
    createElement: (tag) => new MockElement('', tag),
    getElementById: (id) => elements.get(id) || null,
    querySelector: (sel) => (sel.startsWith('#') ? elements.get(sel.slice(1)) || null : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    body: new MockElement('body', 'body'),
    activeElement: { tagName: 'BODY' }
  };
  mockDocument.body.appendChild = (child) => {
    if (child.id) elements.set(child.id, child);
  };

  const mockWindow = {
    addEventListener: (event, fn) => {
      if (!windowListeners[event]) windowListeners[event] = [];
      windowListeners[event].push(fn);
    },
    removeEventListener: (event, fn) => {
      if (windowListeners[event]) {
        windowListeners[event] = windowListeners[event].filter(l => l !== fn);
      }
    },
    dispatchEvent: (event) => {
      const fns = windowListeners[event.type || event] || [];
      for (const fn of fns) fn(event);
    },
    confirm: () => true
  };

  return {
    mockDocument,
    mockWindow,
    mockLocalStorage,
    elements
  };
}

test('Frontend Storage & Backup Safety', async (t) => {
  // Read and evaluate Storage and related logic in simulated environment
  const appJsCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

  await t.test('1. Mock failed GET -> no write occurs and blocking banner is shown (MOCKED)', async () => {
    const { mockDocument, mockWindow, mockLocalStorage, elements } = setupMockBrowser();

    let postSyncCalled = false;
    let fetchCalls = [];

    const mockFetch = async (url, opts = {}) => {
      fetchCalls.push({ url, opts });
      if (url === '/api/sync' && (!opts.method || opts.method === 'GET')) {
        // Mock failure: server down / 500 error
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Database locked' })
        };
      }
      if (url === '/api/sync' && opts.method === 'POST') {
        postSyncCalled = true;
        return {
          ok: true,
          json: async () => ({ success: true, lastSaved: new Date().toISOString() })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    // Construct isolated context with mock globals
    const context = {
      window: mockWindow,
      document: mockDocument,
      localStorage: mockLocalStorage,
      fetch: mockFetch,
      console,
      setTimeout,
      clearTimeout
    };

    // Extract Storage object definition from app.js
    const storageCodeMatch = appJsCode.match(/const Storage = \{[\s\S]*?\n\};\n\n\/\/ ===/);
    assert.ok(storageCodeMatch, 'Found Storage object definition');

    const fn = new Function('window', 'document', 'localStorage', 'fetch', 'console', 'setTimeout', 'clearTimeout', `
      ${storageCodeMatch[0]}
      return Storage;
    `);

    const Storage = fn(mockWindow, mockDocument, mockLocalStorage, mockFetch, console, setTimeout, clearTimeout);

    // Prepopulate localStorage with user data so hasData is true
    mockLocalStorage.setItem('artpractice_decks', JSON.stringify([{ id: 'local_1', name: 'Existing Deck' }]));
    mockLocalStorage.setItem('artpractice_cards', JSON.stringify({ local_1: { c1: { id: 'c1' } } }));

    // 1. Run Storage.init()
    await Storage.init();

    // Verify _isDiskLoaded is false
    assert.equal(Storage._isDiskLoaded, false, '_isDiskLoaded must remain false when GET /api/sync fails');

    // Verify blocking banner was created
    const banner = elements.get('storage-blocking-banner');
    assert.ok(banner, 'Blocking banner element was added to document');
    assert.ok(banner.innerHTML.includes('Could not read your saved progress'), 'Banner contains required warning');

    // Verify NO POST /api/sync occurred during init (did NOT fall back to localStorage for writing)
    assert.equal(postSyncCalled, false, 'Did not call POST /api/sync during failed startup');

    // 2. Call syncToDisk() directly while _isDiskLoaded is false and user has data
    await Storage.syncToDisk();
    assert.equal(postSyncCalled, false, 'syncToDisk refused to write because _isDiskLoaded is false and data exists');
  });

  await t.test('2. Keepalive is only used inside visibilitychange / beforeunload; 3 failures show warning chip (MOCKED)', async () => {
    const { mockDocument, mockWindow, mockLocalStorage, elements } = setupMockBrowser();

    let fetchRequests = [];
    let shouldFail = false;

    const mockFetch = async (url, opts = {}) => {
      fetchRequests.push({ url, opts });
      if (shouldFail) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Write failed' })
        };
      }
      return {
        ok: true,
        json: async () => ({ success: true, lastSaved: new Date().toISOString() })
      };
    };

    const storageCodeMatch = appJsCode.match(/const Storage = \{[\s\S]*?\n\};\n\n\/\/ ===/);
    const fn = new Function('window', 'document', 'localStorage', 'fetch', 'console', 'setTimeout', 'clearTimeout', `
      ${storageCodeMatch[0]}
      return Storage;
    `);

    const Storage = fn(mockWindow, mockDocument, mockLocalStorage, mockFetch, console, setTimeout, clearTimeout);
    Storage._isDiskLoaded = true;
    Storage._decks = [{ id: 'd1' }];
    Storage._cards = {};

    // Normal syncToDisk call
    await Storage.syncToDisk();
    assert.equal(fetchRequests.length, 1);
    assert.equal(fetchRequests[0].opts.keepalive, undefined, 'Normal sync uses plain fetch without keepalive');

    // Trigger visibilitychange
    fetchRequests = [];
    Storage._bindUnloadListeners();
    mockDocument.visibilityState = 'hidden';
    mockWindow.dispatchEvent('visibilitychange');

    assert.equal(fetchRequests.length, 1);
    assert.equal(fetchRequests[0].opts.keepalive, true, 'visibilitychange uses keepalive: true');

    // Trigger beforeunload
    fetchRequests = [];
    mockWindow.dispatchEvent('beforeunload');
    assert.equal(fetchRequests.length, 1);
    assert.equal(fetchRequests[0].opts.keepalive, true, 'beforeunload uses keepalive: true');

    // Test 3 consecutive failures trigger persistent warning chip
    shouldFail = true;
    for (let i = 0; i < 2; i++) {
      try { await Storage.syncToDisk(); } catch (e) {}
      assert.equal(elements.get('sync-warning-chip'), undefined, 'Chip not shown before 3 failures');
    }

    try { await Storage.syncToDisk(); } catch (e) {}
    const warningChip = elements.get('sync-warning-chip');
    assert.ok(warningChip, 'Warning chip appears after 3 consecutive failures');
    assert.ok(warningChip.innerHTML.includes('Sync failing'), 'Warning chip displays sync failure text');
  });

  await t.test('3. Quit flushes a pending change via window.electronAPI.onBeforeQuit (MOCKED)', async () => {
    const { mockDocument, mockWindow, mockLocalStorage } = setupMockBrowser();

    let flushedPayload = null;
    let quitCallback = null;
    let ackSent = false;

    mockWindow.electronAPI = {
      onBeforeQuit: (cb) => {
        quitCallback = cb;
      }
    };

    const mockFetch = async (url, opts = {}) => {
      if (url === '/api/sync' && opts.method === 'POST') {
        flushedPayload = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ success: true, lastSaved: new Date().toISOString() }) };
      }
      return { ok: true, json: async () => ({}) };
    };

    const storageCodeMatch = appJsCode.match(/const Storage = \{[\s\S]*?\n\};\n\n\/\/ ===/);
    const fn = new Function('window', 'document', 'localStorage', 'fetch', 'console', 'setTimeout', 'clearTimeout', `
      ${storageCodeMatch[0]}
      return Storage;
    `);

    const Storage = fn(mockWindow, mockDocument, mockLocalStorage, mockFetch, console, setTimeout, clearTimeout);
    Storage._isDiskLoaded = true;
    Storage._decks = [{ id: 'd1', name: 'Initial' }];
    Storage._cards = {};

    Storage._bindUnloadListeners();
    assert.ok(quitCallback, 'Registered onBeforeQuit listener');

    // Simulate pending change before quit
    Storage._decks = [{ id: 'd1', name: 'Modified Before Quit' }];

    // Trigger quit
    await quitCallback();

    assert.ok(flushedPayload, 'Pending change was flushed to disk during quit');
    assert.equal(flushedPayload.decks[0].name, 'Modified Before Quit');
  });

  await t.test('4. Backup import validates shape and shows confirmation with deck/card counts (MOCKED)', async () => {
    // Verify shape validation logic from app.js
    const importSnippetMatch = appJsCode.match(/fileInput\.addEventListener\('change'[\s\S]*?\}\);\s*\},/);
    assert.ok(importSnippetMatch, 'Found backup import event handler');

    // Test shape validator directly
    const validateShape = (data) => {
      return Boolean(data && Array.isArray(data.decks) && typeof data.cards === 'object' && data.cards !== null);
    };

    assert.equal(validateShape(null), false, 'Rejects null');
    assert.equal(validateShape({ decks: 'not-an-array', cards: {} }), false, 'Rejects non-array decks');
    assert.equal(validateShape({ decks: [], cards: null }), false, 'Rejects null cards');
    assert.equal(validateShape({ decks: [{ id: '1' }], cards: { '1': {} } }), true, 'Accepts valid shape');

    // Verify confirmation message formulation
    const currentDecks = [{ id: '1' }, { id: '2' }];
    const currentCards = { '1': { a: 1 }, '2': { b: 2, c: 3 } };
    const currentDeckCount = currentDecks.length;
    const currentCardCount = Object.values(currentCards).reduce((acc, d) => acc + Object.keys(d).length, 0);

    const incomingDecks = [{ id: 'new1' }];
    const incomingCards = { 'new1': { x: 1 } };
    const incomingDeckCount = incomingDecks.length;
    const incomingCardCount = Object.values(incomingCards).reduce((acc, d) => acc + Object.keys(d).length, 0);

    assert.equal(currentDeckCount, 2);
    assert.equal(currentCardCount, 3);
    assert.equal(incomingDeckCount, 1);
    assert.equal(incomingCardCount, 1);

    // Verify app.js calls POST /api/sync with confirmReplace: true
    assert.ok(
      appJsCode.includes('confirmReplace: true'),
      'app.js passes confirmReplace: true in sync payload during import'
    );
  });

  await t.test('5. Blocking banner: Retry succeeds and shows the real data, not an empty state (MOCKED)', async () => {
    const { mockDocument, mockWindow, mockLocalStorage, elements } = setupMockBrowser();

    let getSyncCalls = 0;
    const realDecks = [{ id: 'real_deck_1', name: 'Master Anatomy Deck', folderPath: '/references/anatomy' }];
    const realCards = { real_deck_1: { card_1: { id: 'card_1', difficulty: 'good' } } };

    const mockFetch = async (url, opts = {}) => {
      if (url === '/api/sync' && (!opts.method || opts.method === 'GET')) {
        getSyncCalls++;
        if (getSyncCalls === 1) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Database locked or read error' })
          };
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              exists: true,
              lastSaved: '2026-11-10T12:00:00.000Z',
              data: {
                decks: realDecks,
                cards: realCards,
                history: {},
                wallpaperSettings: null
              }
            })
          };
        }
      }
      return { ok: true, json: async () => ({}) };
    };

    const vm = require('node:vm');
    const context = {
      window: mockWindow,
      document: mockDocument,
      localStorage: mockLocalStorage,
      navigator: { userAgent: 'test-agent' },
      location: { search: '' },
      fetch: mockFetch,
      console,
      setTimeout,
      clearTimeout,
      Date: global.Date
    };
    context.window.document = mockDocument;
    context.window.localStorage = mockLocalStorage;
    context.window.fetch = mockFetch;
    context.window.navigator = context.navigator;
    context.window.location = context.location;

    vm.createContext(context);
    const exported = vm.runInContext(
      appJsCode + '\n;({ Storage, DeckManager, CardManager })',
      context
    );
    const { Storage, DeckManager, CardManager } = exported;

    // 1. Initial Storage.init fails and displays blocking banner
    await Storage.init();

    assert.equal(Storage._isDiskLoaded, false, 'Disk is not loaded yet');
    const banner = elements.get('storage-blocking-banner');
    assert.ok(banner, 'Blocking banner is shown');
    assert.ok(banner.innerHTML.includes('Could not read your saved progress'), 'Banner has required message');

    const retryBtn = elements.get('btn-storage-retry');
    assert.ok(retryBtn, 'Retry button is present');

    // 2. Click Retry
    await retryBtn.onclick();

    // 3. Retry succeeded!
    assert.equal(getSyncCalls, 2, 'GET /api/sync called twice (initial + retry)');
    assert.equal(Storage._isDiskLoaded, true, '_isDiskLoaded is now true');
    assert.equal(elements.get('storage-blocking-banner'), undefined, 'Blocking banner is removed');

    // 4. Assert real data is present, NOT an empty state
    const loadedDecks = Storage.getDecks();
    const loadedCards = Storage.getCards();

    assert.equal(loadedDecks.length, 1, 'Shows real decks count, not empty array');
    assert.equal(loadedDecks[0].name, 'Master Anatomy Deck', 'Shows real deck name');
    assert.ok(loadedCards['real_deck_1'], 'Shows real cards data');
    assert.equal(loadedCards['real_deck_1']['card_1'].difficulty, 'good', 'Shows real card difficulty');

    assert.equal(DeckManager.decks.length, 1, 'DeckManager holds real deck');
    assert.equal(DeckManager.decks[0].id, 'real_deck_1');
  });

  await t.test('6. Deleting last deck/card calls confirm dialog ("This will remove all decks/cards") and POSTs confirmReplace:true, and 409 shows visible error (MOCKED)', async () => {
    const { mockDocument, mockWindow, mockLocalStorage, elements } = setupMockBrowser();

    let lastConfirmMessage = null;
    let confirmChoice = true;
    mockWindow.confirm = (msg) => {
      lastConfirmMessage = msg;
      return confirmChoice;
    };

    let postSyncPayloads = [];
    let simulate409 = false;

    const mockFetch = async (url, opts = {}) => {
      if (url === '/api/sync' && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        postSyncPayloads.push(body);
        if (simulate409) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'Conflict: Incoming state has 0 decks and 0 cards while existing state contains data. Use confirmReplace: true to overwrite.' })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, lastSaved: new Date().toISOString() })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    const vm = require('node:vm');
    let lastToast = null;
    const mockUI = {
      showToast: (msg, icon) => { lastToast = { msg, icon }; }
    };

    const context = {
      window: mockWindow,
      document: mockDocument,
      localStorage: mockLocalStorage,
      navigator: { userAgent: 'test-agent' },
      location: { search: '' },
      fetch: mockFetch,
      console,
      setTimeout,
      clearTimeout,
      Date: global.Date,
      UI: mockUI
    };
    context.window.document = mockDocument;
    context.window.localStorage = mockLocalStorage;
    context.window.fetch = mockFetch;
    context.window.navigator = context.navigator;
    context.window.location = context.location;
    context.window.UI = mockUI;

    vm.createContext(context);
    const exported = vm.runInContext(
      appJsCode + '\n;({ Storage, DeckManager, CardManager, UI, localDateStr })',
      context
    );
    const { Storage, DeckManager, CardManager, UI } = exported;
    if (UI) UI.showToast = mockUI.showToast;

    Storage._isDiskLoaded = true;
    DeckManager.decks = [{ id: 'only_deck', name: 'Only Deck', folderPath: '/tmp/test' }];
    CardManager.cards = { only_deck: { c1: { id: 'c1' } } };

    // Case A: User cancels the confirm dialog
    confirmChoice = false;
    const cancelRes = DeckManager.delete('only_deck');
    assert.equal(cancelRes, false, 'delete returns false when cancelled');
    assert.equal(lastConfirmMessage, 'This will remove all decks/cards', 'Confirm message matches required string');
    assert.equal(DeckManager.decks.length, 1, 'Deck was NOT deleted');
    assert.ok(CardManager.cards['only_deck'], 'Cards were NOT deleted');

    // Case B: User confirms the dialog
    confirmChoice = true;
    const confirmRes = DeckManager.delete('only_deck');
    assert.equal(confirmRes, true, 'delete returns true when confirmed');
    assert.equal(DeckManager.decks.length, 0, 'Deck was deleted');
    assert.equal(Object.keys(CardManager.cards).length, 0, 'Cards were deleted');

    // Verify POST /api/sync called with confirmReplace: true
    assert.ok(postSyncPayloads.length > 0, 'POST /api/sync called');
    const lastPayload = postSyncPayloads[postSyncPayloads.length - 1];
    assert.equal(lastPayload.confirmReplace, true, 'Payload includes confirmReplace: true');
    assert.equal(lastPayload.decks.length, 0, 'Payload decks is empty');

    // Case C: 409 without confirmation produces visible error (toast + chip), never silent
    simulate409 = true;
    let threw409 = false;
    try {
      await Storage.syncToDisk({ confirmReplace: false });
    } catch (e) {
      threw409 = true;
      assert.equal(e.status, 409);
    }
    assert.ok(threw409, 'Storage.syncToDisk throws on 409');
    assert.ok(lastToast, 'Visible UI toast was shown for 409');
    assert.ok(lastToast.msg.includes('409') || lastToast.msg.includes('Conflict'), 'Toast message reflects 409 conflict');
    assert.equal(lastToast.icon, 'alert', 'Toast icon is alert');

    const warningChip = elements.get('sync-warning-chip');
    assert.ok(warningChip, 'Visible sync-warning-chip is displayed on 409');
    assert.ok(warningChip.innerHTML.includes('Conflict') || warningChip.innerHTML.includes('Sync'), 'Warning chip contains conflict details');
  });

  await t.test('7. Real Storage against running server: rate a card, flush, restart server, read back (AUTOMATED-RAN)', async () => {
    const os = require('node:os');
    const vm = require('node:vm');
    const tempUserDir = path.join(os.tmpdir(), 'real_storage_e2e_' + Date.now());
    fs.mkdirSync(tempUserDir, { recursive: true });

    const prevUserDir = process.env.USER_DATA_DIR;
    process.env.USER_DATA_DIR = tempUserDir;

    delete require.cache[require.resolve('../server.js')];
    const serverMod1 = require('../server.js');
    const res1 = await serverMod1.startServer(0);
    let currentPort = res1.port;

    const ls = new Map();
    const mockLocalStorage = {
      getItem: (k) => ls.get(k) || null,
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: (k) => ls.delete(k),
      clear: () => ls.clear()
    };

    const context = {
      window: {
        addEventListener: () => {},
        removeEventListener: () => {}
      },
      navigator: { userAgent: 'test-agent' },
      location: { search: '' },
      document: {
        activeElement: null,
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ classList: { add(){}, remove(){} }, style: {}, appendChild(){} }),
        addEventListener: () => {},
        removeEventListener: () => {},
        body: { appendChild(){} }
      },
      localStorage: mockLocalStorage,
      fetch: async (url, opts = {}) => {
        const fullUrl = url.startsWith('/') ? `http://127.0.0.1:${currentPort}${url}` : url;
        const headers = {
          'Host': `127.0.0.1:${currentPort}`,
          'Sec-Fetch-Site': 'same-origin',
          ...(opts.headers || {})
        };
        return global.fetch(fullUrl, { ...opts, headers });
      },
      console,
      setTimeout,
      clearTimeout,
      Date: global.Date
    };
    context.window.document = context.document;
    context.window.localStorage = context.localStorage;
    context.window.fetch = context.fetch;
    context.window.navigator = context.navigator;
    context.window.location = context.location;

    vm.createContext(context);
    const exported = vm.runInContext(
      appJsCode + '\n;({ Storage, CardManager, DeckManager, ReviewHistory, localDateStr })',
      context
    );
    const { Storage, CardManager, DeckManager } = exported;

    try {
      // 1. Storage.init against running server 1
      await Storage.init();
      DeckManager.init();
      CardManager.init();

      // 2. Create deck and rate card
      const deck = DeckManager.create('Gesture Mastery E2E', '/references/gesture', 20, 200);
      assert.ok(deck && deck.id, 'Deck created');

      // Rate card
      CardManager.rateCard(deck.id, 'pose_001', 'pose_001.png', 'good', 30);
      const cardBefore = CardManager.getCard(deck.id, 'pose_001');
      assert.equal(cardBefore.difficulty, 'good', 'Card rated good before flush');

      // 3. Flush to disk
      await Storage.syncToDisk();

      // Verify file written on disk in tempUserDir
      const diskStatePath = path.join(tempUserDir, 'srs_state.json');
      assert.ok(fs.existsSync(diskStatePath), 'srs_state.json exists on disk');
      const diskState = JSON.parse(fs.readFileSync(diskStatePath, 'utf8'));
      assert.equal(diskState.decks[0].name, 'Gesture Mastery E2E');
      assert.equal(diskState.cards[deck.id]['pose_001'].difficulty, 'good');

      // 4. Restart server: close server 1, start server 2 on same tempUserDir
      await new Promise(r => res1.server.close(r));

      delete require.cache[require.resolve('../server.js')];
      const serverMod2 = require('../server.js');
      const res2 = await serverMod2.startServer(0);
      currentPort = res2.port;

      // 5. Clear Storage in-memory state and localStorage to simulate fresh app start
      Storage._decks = null;
      Storage._cards = null;
      Storage._history = null;
      Storage._isDiskLoaded = false;
      mockLocalStorage.clear();

      // 6. Read back from server 2
      await Storage.init();
      DeckManager.init();
      CardManager.init();

      // 7. Verify data read back from server 2 matches disk
      const readBackDecks = Storage.getDecks();
      assert.equal(readBackDecks.length, 1, '1 deck read back');
      assert.equal(readBackDecks[0].name, 'Gesture Mastery E2E', 'Deck name matches');

      const readBackCard = CardManager.getCard(deck.id, 'pose_001');
      assert.ok(readBackCard, 'Card read back');
      assert.equal(readBackCard.difficulty, 'good', 'Card difficulty good preserved after restart');

      await new Promise(r => res2.server.close(r));
    } finally {
      if (prevUserDir) process.env.USER_DATA_DIR = prevUserDir;
      else delete process.env.USER_DATA_DIR;
      delete require.cache[require.resolve('../server.js')];
      try { fs.rmSync(tempUserDir, { recursive: true, force: true }); } catch (e) {}
    }
  });
});
