const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const { app, startServer } = require('../server.js');
const { isTrustedIpcSender } = require('../electron-main.js');

function makeRequest(port, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path || '/api/browse',
      method: options.method || 'GET',
      headers: { ...options.headers }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

test('API Security Middleware & State IPC Tests', async (t) => {
  let serverInstance;
  let boundPort;

  await t.test('Server startup and dynamic port binding', async () => {
    const res = await startServer(0);
    serverInstance = res.server;
    boundPort = res.port;
    assert.ok(boundPort > 0, 'Server bound to a valid dynamic port');
  });

  await t.test('1. Wrong Host header -> 403', async () => {
    // Arbitrary external host
    const res1 = await makeRequest(boundPort, {
      path: '/api/browse',
      headers: { host: 'evil.com' }
    });
    assert.equal(res1.statusCode, 403, 'evil.com host rejected with 403');

    // Wrong port on 127.0.0.1
    const res2 = await makeRequest(boundPort, {
      path: '/api/browse',
      headers: { host: `127.0.0.1:${boundPort + 1}` }
    });
    assert.equal(res2.statusCode, 403, 'Wrong port on 127.0.0.1 rejected with 403');

    // Wrong port on localhost
    const res3 = await makeRequest(boundPort, {
      path: '/api/browse',
      headers: { host: `localhost:${boundPort + 1}` }
    });
    assert.equal(res3.statusCode, 403, 'Wrong port on localhost rejected with 403');

    // Private network IP that is not 127.0.0.1
    const res4 = await makeRequest(boundPort, {
      path: '/api/browse',
      headers: { host: `192.168.1.100:${boundPort}` }
    });
    assert.equal(res4.statusCode, 403, 'LAN host header rejected with 403');
  });

  await t.test('2. Cross-origin state-changing methods -> 403', async () => {
    // Malicious external Origin
    const res1 = await makeRequest(boundPort, {
      path: '/api/sync',
      method: 'POST',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        origin: 'http://evil.com',
        'content-type': 'application/json'
      },
      body: { decks: [] }
    });
    assert.equal(res1.statusCode, 403, 'Cross-origin POST rejected with 403');

    // Origin null (sandboxed frames / data urls) -> 403 (POST)
    const res2 = await makeRequest(boundPort, {
      path: '/api/sync',
      method: 'POST',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        origin: 'null',
        'content-type': 'application/json'
      },
      body: { decks: [] }
    });
    assert.equal(res2.statusCode, 403, 'Origin null rejected with 403');

    // Origin null -> 403 (GET)
    const resGetNull = await makeRequest(boundPort, {
      path: '/api/browse',
      method: 'GET',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        origin: 'null'
      }
    });
    assert.equal(resGetNull.statusCode, 403, 'GET with Origin null rejected with 403');

    // Sec-Fetch-Site cross-site -> 403 (POST)
    const res3 = await makeRequest(boundPort, {
      path: '/api/sync',
      method: 'POST',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        origin: `http://127.0.0.1:${boundPort}`,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json'
      },
      body: { decks: [] }
    });
    assert.equal(res3.statusCode, 403, 'Sec-Fetch-Site cross-site rejected with 403');

    // Sec-Fetch-Site cross-site -> 403 (GET)
    const resGetCross = await makeRequest(boundPort, {
      path: '/api/browse',
      method: 'GET',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        'sec-fetch-site': 'cross-site'
      }
    });
    assert.equal(resGetCross.statusCode, 403, 'GET with Sec-Fetch-Site cross-site rejected with 403');

    // Sec-Fetch-Site same-site (not same-origin or none)
    const res4 = await makeRequest(boundPort, {
      path: '/api/sync',
      method: 'POST',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        origin: `http://127.0.0.1:${boundPort}`,
        'sec-fetch-site': 'same-site',
        'content-type': 'application/json'
      },
      body: { decks: [] }
    });
    assert.equal(res4.statusCode, 403, 'Sec-Fetch-Site same-site rejected with 403');
  });

  await t.test('3. GET /api/electron-float and POST /api/electron-float -> 404', async () => {
    const resGet = await makeRequest(boundPort, {
      path: '/api/electron-float',
      method: 'GET',
      headers: {
        host: `127.0.0.1:${boundPort}`
      }
    });
    assert.equal(resGet.statusCode, 404, 'GET /api/electron-float returns 404');

    const resPost = await makeRequest(boundPort, {
      path: '/api/electron-float',
      method: 'POST',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        origin: `http://127.0.0.1:${boundPort}`,
        'content-type': 'application/json'
      },
      body: { enable: true }
    });
    assert.equal(resPost.statusCode, 404, 'POST /api/electron-float returns 404');
  });

  await t.test('4. Same-origin requests still work and send NO CORS headers', async () => {
    // GET request with 127.0.0.1 host
    const resGetV4 = await makeRequest(boundPort, {
      path: '/api/browse',
      method: 'GET',
      headers: {
        host: `127.0.0.1:${boundPort}`
      }
    });
    assert.equal(resGetV4.statusCode, 200, 'GET /api/browse works with 127.0.0.1');
    assert.equal(resGetV4.headers['access-control-allow-origin'], undefined, 'No Access-Control-Allow-Origin header');

    // GET request with localhost host
    const resGetLocal = await makeRequest(boundPort, {
      path: '/api/browse',
      method: 'GET',
      headers: {
        host: `localhost:${boundPort}`
      }
    });
    assert.equal(resGetLocal.statusCode, 200, 'GET /api/browse works with localhost');

    // POST request with matching Origin and same-origin Sec-Fetch-Site
    const resPost = await makeRequest(boundPort, {
      path: '/api/sync',
      method: 'POST',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        origin: `http://127.0.0.1:${boundPort}`,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json'
      },
      body: { decks: [{ id: 'test_deck', name: 'Test' }], cards: {}, history: {}, confirmReplace: true }
    });
    assert.equal(resPost.statusCode, 200, 'POST /api/sync works for same-origin');
    assert.equal(resPost.headers['access-control-allow-origin'], undefined, 'No CORS headers on POST response');

    // POST request with Sec-Fetch-Site: none (browser address bar navigation or internal client)
    const resPostNone = await makeRequest(boundPort, {
      path: '/api/sync',
      method: 'POST',
      headers: {
        host: `localhost:${boundPort}`,
        origin: `http://localhost:${boundPort}`,
        'sec-fetch-site': 'none',
        'content-type': 'application/json'
      },
      body: { decks: [{ id: 'test_deck', name: 'Test' }], cards: {}, history: {}, confirmReplace: true }
    });
    assert.equal(resPostNone.statusCode, 200, 'POST /api/sync works with Sec-Fetch-Site none');

    // POST request with absent Origin and absent Sec-Fetch-Site (e.g. server-to-server or Electron main)
    const resPostNoOrigin = await makeRequest(boundPort, {
      path: '/api/sync',
      method: 'POST',
      headers: {
        host: `127.0.0.1:${boundPort}`,
        'content-type': 'application/json'
      },
      body: { decks: [{ id: 'test_deck', name: 'Test' }], cards: {}, history: {}, confirmReplace: true }
    });
    assert.equal(resPostNoOrigin.statusCode, 200, 'POST /api/sync works with absent Origin');
  });

  await t.test('5. IPC contracts & get-window-state handler (MOCKED)', async () => {
    const electronPath = require.resolve('electron');
    const ipcMainHandlers = {};
    const ipcMainListeners = {};
    let exposedApi = null;

    const mockWindow = {
      isDestroyed: () => false,
      isAlwaysOnTop: () => false,
      webContents: {
        isDestroyed: () => false,
        executeJavaScript: () => Promise.resolve()
      }
    };

    const mockElectron = {
      app: {
        getPath: () => path.resolve(__dirname, '..'),
        whenReady: () => new Promise(() => {}),
        on: () => {},
        quit: () => {}
      },
      BrowserWindow: Object.assign(
        function MockBrowserWindow() { return mockWindow; },
        {
          fromWebContents: () => mockWindow,
          getAllWindows: () => [mockWindow]
        }
      ),
      ipcMain: {
        handle: (channel, handler) => {
          ipcMainHandlers[channel] = handler;
        },
        on: (channel, listener) => {
          ipcMainListeners[channel] = listener;
        }
      },
      ipcRenderer: {
        invoke: async (channel, ...args) => {
          if (typeof ipcMainHandlers[channel] === 'function') {
            return ipcMainHandlers[channel]({
              senderFrame: { url: `http://127.0.0.1:${boundPort}/` },
              sender: { getURL: () => `http://127.0.0.1:${boundPort}/` }
            }, ...args);
          }
          throw new Error(`No ipcMain handler registered for ${channel}`);
        },
        send: (channel, ...args) => {
          if (typeof ipcMainListeners[channel] === 'function') {
            ipcMainListeners[channel]({
              senderFrame: { url: `http://127.0.0.1:${boundPort}/` },
              sender: { getURL: () => `http://127.0.0.1:${boundPort}/` }
            }, ...args);
          }
        },
        on: () => {},
        removeListener: () => {}
      },
      contextBridge: {
        exposeInMainWorld: (apiKey, apiObject) => {
          if (apiKey === 'electronAPI') {
            exposedApi = apiObject;
          }
        }
      },
      shell: {
        openExternal: () => Promise.resolve()
      },
      Menu: {
        getApplicationMenu: () => null,
        buildFromTemplate: () => ({}),
        setApplicationMenu: () => {}
      },
      dialog: {
        showOpenDialog: () => Promise.resolve({ canceled: true })
      },
      globalShortcut: {
        register: () => {},
        unregisterAll: () => {}
      },
      session: {
        defaultSession: {
          setPermissionRequestHandler: () => {},
          setPermissionCheckHandler: () => {}
        }
      }
    };

    const prevElectronCache = require.cache[electronPath];
    const prevPreloadCache = require.cache[require.resolve('../preload.js')];
    const prevMainCache = require.cache[require.resolve('../electron-main.js')];

    try {
      require.cache[electronPath] = {
        id: electronPath,
        filename: electronPath,
        loaded: true,
        exports: mockElectron
      };

      delete require.cache[require.resolve('../preload.js')];
      delete require.cache[require.resolve('../electron-main.js')];

      // Load preload.js and electron-main.js with the mocked electron module
      require('../preload.js');
      const electronMain = require('../electron-main.js');
      if (typeof electronMain.setServerPort === 'function') {
        electronMain.setServerPort(boundPort);
      }

      // Assert 1: get-window-state is registered via ipcMain.handle
      assert.equal(
        typeof ipcMainHandlers['get-window-state'],
        'function',
        'get-window-state is registered via ipcMain.handle'
      );

      const handler = ipcMainHandlers['get-window-state'];

      // Assert 2: rejects an untrusted sender
      const untrustedEvent = {
        senderFrame: { url: 'http://evil.com/' },
        sender: { getURL: () => 'http://evil.com/' }
      };
      const untrustedRes = await handler(untrustedEvent);
      assert.equal(untrustedRes.isElectron, false, 'Untrusted sender receives isElectron false');
      assert.equal(untrustedRes.error, 'Unauthorized', 'Untrusted sender rejected with error Unauthorized');

      // Assert 3: returns the four fields for a trusted sender
      const trustedEvent = {
        senderFrame: { url: `http://127.0.0.1:${boundPort}/` },
        sender: { getURL: () => `http://127.0.0.1:${boundPort}/` }
      };
      const trustedRes = await handler(trustedEvent);
      assert.ok(trustedRes, 'Trusted sender receives result');
      assert.equal(typeof trustedRes.isElectron, 'boolean', 'returns isElectron boolean');
      assert.equal(typeof trustedRes.floating, 'boolean', 'returns floating boolean');
      assert.equal(typeof trustedRes.isAlwaysOnTop, 'boolean', 'returns isAlwaysOnTop boolean');
      assert.equal(typeof trustedRes.isGhostMode, 'boolean', 'returns isGhostMode boolean');
      assert.equal(trustedRes.isElectron, true, 'isElectron is true');
      assert.equal(trustedRes.error, undefined, 'No error on trusted result');

      // Assert via preload exposed API
      assert.ok(exposedApi, 'preload.js exposed electronAPI');
      assert.equal(typeof exposedApi.getWindowState, 'function', 'getWindowState exposed in preload');
      const apiRes = await exposedApi.getWindowState();
      assert.equal(apiRes.isElectron, true);
      assert.equal(typeof apiRes.floating, 'boolean');
      assert.equal(typeof apiRes.isAlwaysOnTop, 'boolean');
      assert.equal(typeof apiRes.isGhostMode, 'boolean');
    } finally {
      if (prevElectronCache) require.cache[electronPath] = prevElectronCache;
      else delete require.cache[electronPath];

      if (prevPreloadCache) require.cache[require.resolve('../preload.js')] = prevPreloadCache;
      else delete require.cache[require.resolve('../preload.js')];

      if (prevMainCache) require.cache[require.resolve('../electron-main.js')] = prevMainCache;
      else delete require.cache[require.resolve('../electron-main.js')];
    }
  });

  await t.test('6. app.js enterElectronFloat, toggleGhostMode & toggleAlwaysOnTop UI error handling (MOCKED)', async () => {
    let lastToast = null;
    const mockUI = {
      isElectron: true,
      isElectronFloating: false,
      isGhostMode: false,
      isAlwaysOnTop: false,
      showToast: (msg, icon) => { lastToast = { msg, icon }; },
      setElectronFloatState: function(val) { this.isElectronFloating = val; },
      setGhostModeState: function(val) { this.isGhostMode = val; },
      setAlwaysOnTopState: function(val) { this.isAlwaysOnTop = val; }
    };

    const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const enterMatch = appJs.match(/async enterElectronFloat\(\) \{[\s\S]*?\n  \},/);
    const ghostMatch = appJs.match(/async toggleGhostMode\(targetState\) \{[\s\S]*?\n  \},/);
    const aotMatch = appJs.match(/async toggleAlwaysOnTop\(targetState\) \{[\s\S]*?\n  \},/);

    assert.ok(enterMatch && ghostMatch && aotMatch, 'Found float/ghost/aot method definitions in app.js');

    mockUI.enterElectronFloat = (new Function('return ({' + enterMatch[0] + '})')()).enterElectronFloat.bind(mockUI);
    mockUI.toggleGhostMode = (new Function('return ({' + ghostMatch[0] + '})')()).toggleGhostMode.bind(mockUI);
    mockUI.toggleAlwaysOnTop = (new Function('return ({' + aotMatch[0] + '})')()).toggleAlwaysOnTop.bind(mockUI);

    const prevWindow = global.window;
    try {
      // 1. enterElectronFloat: missing result or res.error -> show alert toast, UI state unchanged
      global.window = {
        electronAPI: {
          toggleFloatMode: async () => null // missing result
        }
      };
      await mockUI.enterElectronFloat();
      assert.equal(mockUI.isElectronFloating, false, 'UI state unchanged on missing result');
      assert.equal(lastToast?.icon, 'alert', 'Alert toast shown on missing result');

      lastToast = null;
      global.window.electronAPI.toggleFloatMode = async () => ({ error: 'Unauthorized' });
      await mockUI.enterElectronFloat();
      assert.equal(mockUI.isElectronFloating, false, 'UI state unchanged on res.error');
      assert.equal(lastToast?.icon, 'alert', 'Alert toast shown on res.error');

      // 1b. enterElectronFloat: default to NOT floating if floating property missing
      lastToast = null;
      global.window.electronAPI.toggleFloatMode = async () => ({ isElectron: true });
      await mockUI.enterElectronFloat();
      assert.equal(mockUI.isElectronFloating, false, 'Defaults to NOT floating');

      // 1c. enterElectronFloat: success sets float state
      lastToast = null;
      global.window.electronAPI.toggleFloatMode = async () => ({ isElectron: true, floating: true });
      await mockUI.enterElectronFloat();
      assert.equal(mockUI.isElectronFloating, true, 'Float state updated on success');
      assert.equal(lastToast?.icon, 'pin');

      // 2. toggleGhostMode: on res.error show toast and change nothing; update only when typeof res.isGhostMode === 'boolean'
      lastToast = null;
      mockUI.isGhostMode = false;
      global.window.electronAPI.toggleGhostMode = async () => ({ error: 'Unauthorized', isGhostMode: true });
      await mockUI.toggleGhostMode(true);
      assert.equal(mockUI.isGhostMode, false, 'Ghost mode UI state unchanged on res.error');
      assert.equal(lastToast?.icon, 'alert', 'Alert toast shown on ghost mode error');

      lastToast = null;
      global.window.electronAPI.toggleGhostMode = async () => ({ isGhostMode: true });
      await mockUI.toggleGhostMode(true);
      assert.equal(mockUI.isGhostMode, true, 'Ghost mode UI state updated when isGhostMode boolean returned');

      lastToast = null;
      global.window.electronAPI.toggleGhostMode = async () => ({ error: 'IPC Error' });
      await mockUI.toggleGhostMode(false);
      assert.equal(mockUI.isGhostMode, true, 'Ghost mode UI state unchanged on res.error when currently active');
      assert.equal(lastToast?.icon, 'alert');

      // 3. toggleAlwaysOnTop: on res.error show toast and change nothing; update only when boolean returned
      lastToast = null;
      mockUI.isAlwaysOnTop = false;
      global.window.electronAPI.setAlwaysOnTop = async () => ({ error: 'Unauthorized', isAlwaysOnTop: true });
      await mockUI.toggleAlwaysOnTop(true);
      assert.equal(mockUI.isAlwaysOnTop, false, 'AOT UI state unchanged on res.error');
      assert.equal(lastToast?.icon, 'alert', 'Alert toast shown on AOT error');

      lastToast = null;
      global.window.electronAPI.setAlwaysOnTop = async () => ({ isAlwaysOnTop: true });
      await mockUI.toggleAlwaysOnTop(true);
      assert.equal(mockUI.isAlwaysOnTop, true, 'AOT UI state updated when isAlwaysOnTop boolean returned');

      lastToast = null;
      global.window.electronAPI.setAlwaysOnTop = async () => ({ error: 'IPC Error' });
      await mockUI.toggleAlwaysOnTop(false);
      assert.equal(mockUI.isAlwaysOnTop, true, 'AOT UI state unchanged on res.error when currently active');
      assert.equal(lastToast?.icon, 'alert');
    } finally {
      global.window = prevWindow;
    }
  });

  t.after(() => {
    if (serverInstance && typeof serverInstance.close === 'function') {
      serverInstance.close();
    }
  });
});
