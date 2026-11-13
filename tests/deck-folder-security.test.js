const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const {
  startServer,
  USERDATA_DIR,
  STATE_FILE,
  registerTrustedFolder,
  clearTrustedFolders,
  getRegisteredDeckFolders,
  computeFileHash
} = require('../server.js');

test('Deck Folder Trust & Endpoint Access Control Tests', async (t) => {
  let serverInstance = null;
  let boundPort = null;
  let baseUrl = null;

  // Setup test directories in os.tmpdir()
  const tmpBase = path.join(os.tmpdir(), 'tmp_deck_test_' + Date.now());
  const pickedFolder = path.join(tmpBase, 'picked_deck');
  const unregisteredFolder = path.join(tmpBase, 'unregistered_deck');
  const persistedFolder = path.join(tmpBase, 'persisted_deck');

  fs.mkdirSync(pickedFolder, { recursive: true });
  fs.mkdirSync(unregisteredFolder, { recursive: true });
  fs.mkdirSync(persistedFolder, { recursive: true });

  // Create sample image files in test folders
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const jpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

  const pickedImg1 = path.join(pickedFolder, 'picked1.png');
  const pickedImg2 = path.join(pickedFolder, 'picked2.jpg');
  fs.writeFileSync(pickedImg1, pngHeader);
  fs.writeFileSync(pickedImg2, jpgHeader);

  const outsideImg = path.join(unregisteredFolder, 'outside.png');
  fs.writeFileSync(outsideImg, pngHeader);

  const persistedImg = path.join(persistedFolder, 'persisted.png');
  fs.writeFileSync(persistedImg, pngHeader);

  // Backup original state file if present
  fs.mkdirSync(USERDATA_DIR, { recursive: true });
  const originalState = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf8') : null;

  // Start with clean state
  fs.writeFileSync(STATE_FILE, JSON.stringify({ decks: [], cards: {}, confirmReplace: true }, null, 2));

  t.before(async () => {
    process.env.APP_RUNTIME = 'electron';
    clearTrustedFolders();
    const res = await startServer(0);
    serverInstance = res.server;
    boundPort = res.port;
    baseUrl = `http://127.0.0.1:${boundPort}`;
  });

  t.after(() => {
    delete process.env.APP_RUNTIME;
    clearTrustedFolders();
    if (serverInstance && serverInstance.close) {
      serverInstance.close();
    }
    if (originalState) {
      fs.writeFileSync(STATE_FILE, originalState);
    } else {
      try { fs.unlinkSync(STATE_FILE); } catch (e) {}
    }
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) {}
  });

  await t.test('1. unregistered folder returns 403 on all four endpoints (AUTOMATED-RAN)', async () => {
    process.env.APP_RUNTIME = 'electron';

    // Verify folder is not in getRegisteredDeckFolders
    const registered = getRegisteredDeckFolders();
    assert.equal(registered.has(fs.realpathSync(unregisteredFolder)), false, 'Folder must not be registered');

    // 1. /api/images -> 403
    const resImages = await fetch(`${baseUrl}/api/images?folder=${encodeURIComponent(unregisteredFolder)}`);
    assert.equal(resImages.status, 403, '/api/images must return 403 for unregistered folder');
    const imagesBody = await resImages.json();
    assert.ok(imagesBody.error.includes('Access denied'), 'Error message indicates access denied');

    // 2. /api/deck-meta -> 403
    const resMeta = await fetch(`${baseUrl}/api/deck-meta?folder=${encodeURIComponent(unregisteredFolder)}`);
    assert.equal(resMeta.status, 403, '/api/deck-meta must return 403 for unregistered folder');
    const metaBody = await resMeta.json();
    assert.ok(metaBody.error.includes('Access denied'), 'Error message indicates access denied');

    // 3. /api/image -> 403
    const resImage = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(outsideImg)}`);
    assert.equal(resImage.status, 403, '/api/image must return 403 for image in unregistered folder');
    const imageBody = await resImage.json();
    assert.ok(imageBody.error.includes('Access denied'), 'Error message indicates access denied');

    // 4. /api/download-url -> 403
    const resDownload = await fetch(`${baseUrl}/api/download-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: unregisteredFolder,
        url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800'
      })
    });
    assert.equal(resDownload.status, 403, '/api/download-url must return 403 for unregistered folder');
    const downloadBody = await resDownload.json();
    assert.ok(downloadBody.error.includes('Access denied'), 'Error message indicates access denied');
  });

  await t.test('2. pick-then-create-deck-then-load-images with no sync wait works (AUTOMATED-RAN)', async () => {
    process.env.APP_RUNTIME = 'electron';

    // Simulate folder picking via registerTrustedFolder (as done by dialog:pick-directory handler)
    registerTrustedFolder(pickedFolder);

    // Verify STATE_FILE still does not contain pickedFolder
    const rawState = fs.readFileSync(STATE_FILE, 'utf8');
    const stateObj = JSON.parse(rawState);
    const inState = (stateObj.decks || []).some(d => d.folderPath === pickedFolder);
    assert.equal(inState, false, 'STATE_FILE does not contain the deck folder yet (no sync wait)');

    // Verify getRegisteredDeckFolders union includes pickedFolder
    const realPicked = fs.realpathSync(pickedFolder);
    const registered = getRegisteredDeckFolders();
    assert.ok(registered.has(realPicked), 'getRegisteredDeckFolders includes pickedFolder from in-memory trusted Set');

    // 1. /api/images loads images immediately with 200
    const resImages = await fetch(`${baseUrl}/api/images?folder=${encodeURIComponent(pickedFolder)}`);
    assert.equal(resImages.status, 200, '/api/images returns 200 for newly picked folder');
    const images = await resImages.json();
    assert.ok(Array.isArray(images), 'images is an array');
    assert.equal(images.length, 2, 'found both sample images');
    assert.ok(images[0].hash.startsWith('ch_'), 'each image has content hash id');

    // 2. /api/deck-meta loads meta immediately with 200
    const resMeta = await fetch(`${baseUrl}/api/deck-meta?folder=${encodeURIComponent(pickedFolder)}`);
    assert.equal(resMeta.status, 200, '/api/deck-meta returns 200 for newly picked folder');
    const meta = await resMeta.json();
    assert.equal(meta.total, 2, 'meta total matches image count');
    assert.ok(Array.isArray(meta.covers), 'meta covers is an array');

    // 3. /api/image loads the image immediately with 200
    const resImage = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(pickedImg1)}`);
    assert.equal(resImage.status, 200, '/api/image returns 200 for newly picked folder');
    assert.equal(resImage.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(resImage.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  });

  await t.test('3. hash request works (AUTOMATED-RAN)', async () => {
    process.env.APP_RUNTIME = 'electron';

    // Compute content hash for pickedImg1 (which registers it in hashToPathMap)
    const hash = computeFileHash(pickedImg1);
    assert.ok(hash.startsWith('ch_'), 'Hash has ch_ prefix');

    // Request image via content hash
    const resHash = await fetch(`${baseUrl}/api/image?hash=${hash}`);
    assert.equal(resHash.status, 200, '/api/image?hash=ch_... must return 200');
    assert.equal(resHash.headers.get('content-type'), 'image/png');
    assert.equal(resHash.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(resHash.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(resHash.headers.get('content-security-policy'), "sandbox; default-src 'none'");

    // Verify content buffer matches the file
    const buf = Buffer.from(await resHash.arrayBuffer());
    const expectedBuf = fs.readFileSync(pickedImg1);
    assert.deepEqual(buf, expectedBuf, 'Served image content matches file on disk');
  });

  await t.test('4. restart simulation keeps decks accessible via STATE_FILE (AUTOMATED-RAN)', async () => {
    process.env.APP_RUNTIME = 'electron';

    // Write deck to STATE_FILE
    const state = {
      decks: [
        { id: 'deck_persisted', name: 'Persisted Deck', folderPath: persistedFolder }
      ],
      cards: {},
      confirmReplace: true
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    // Simulate restart: clear in-memory trusted Set
    clearTrustedFolders();

    // Verify persistedFolder is resolved from STATE_FILE
    const realPersisted = fs.realpathSync(persistedFolder);
    const registered = getRegisteredDeckFolders();
    assert.ok(registered.has(realPersisted), 'persistedFolder is found in getRegisteredDeckFolders via STATE_FILE');

    // /api/images returns 200
    const resImages = await fetch(`${baseUrl}/api/images?folder=${encodeURIComponent(persistedFolder)}`);
    assert.equal(resImages.status, 200, '/api/images returns 200 after restart via STATE_FILE');
    const images = await resImages.json();
    assert.equal(images.length, 1);

    // /api/deck-meta returns 200
    const resMeta = await fetch(`${baseUrl}/api/deck-meta?folder=${encodeURIComponent(persistedFolder)}`);
    assert.equal(resMeta.status, 200, '/api/deck-meta returns 200 after restart via STATE_FILE');

    // /api/image returns 200
    const resImage = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(persistedImg)}`);
    assert.equal(resImage.status, 200, '/api/image returns 200 after restart via STATE_FILE');

    // /api/download-url allows folder (reaches SSRF or URL validation, not 403 access denied)
    const resDownload = await fetch(`${baseUrl}/api/download-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: persistedFolder,
        url: 'http://127.0.0.1:1/nonexistent.jpg'
      })
    });
    // Port 1 is blocked by SSRF (400) or connection error, but must NOT be 403 access denied
    assert.notEqual(resDownload.status, 403, '/api/download-url does not return 403 for persisted deck folder');
  });

  await t.test('5. Browser mode leaves endpoints unrestricted while keeping Host/Origin middleware (AUTOMATED-RAN)', async () => {
    // In browser mode (no APP_RUNTIME)
    delete process.env.APP_RUNTIME;
    clearTrustedFolders();

    // /api/images with unregistered folder -> 200 (unrestricted in browser mode)
    const resImages = await fetch(`${baseUrl}/api/images?folder=${encodeURIComponent(unregisteredFolder)}`);
    assert.equal(resImages.status, 200, 'Browser mode leaves /api/images unrestricted');

    // /api/deck-meta with unregistered folder -> 200
    const resMeta = await fetch(`${baseUrl}/api/deck-meta?folder=${encodeURIComponent(unregisteredFolder)}`);
    assert.equal(resMeta.status, 200, 'Browser mode leaves /api/deck-meta unrestricted');

    // /api/image with unregistered folder -> 200
    const resImage = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(outsideImg)}`);
    assert.equal(resImage.status, 200, 'Browser mode leaves /api/image unrestricted');

    // But Host/Origin protection is still active
    const badHostStatus = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: boundPort,
        path: `/api/images?folder=${encodeURIComponent(unregisteredFolder)}`,
        headers: { Host: 'evil.com' }
      }, (res) => resolve(res.statusCode));
      req.on('error', reject);
      req.end();
    });
    assert.equal(badHostStatus, 403, 'Browser mode still enforces Host middleware');

    const resCrossSite = await fetch(`${baseUrl}/api/images?folder=${encodeURIComponent(unregisteredFolder)}`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' }
    });
    assert.equal(resCrossSite.status, 403, 'Browser mode still enforces Sec-Fetch-Site middleware');
  });

  await t.test('6. electron-main.js dialog:pick-directory handler calls registerTrustedFolder on user pick (AUTOMATED-RAN)', async () => {
    const ipcFolder = path.join(tmpBase, 'ipc_picked_deck');
    fs.mkdirSync(ipcFolder, { recursive: true });

    clearTrustedFolders();
    assert.equal(getRegisteredDeckFolders().has(fs.realpathSync(ipcFolder)), false, 'Folder initially not trusted');

    const electronPath = require.resolve('electron');
    const ipcMainHandlers = {};

    let dialogResult = { canceled: false, filePaths: [ipcFolder] };

    const mockWindow = {
      isDestroyed: () => false,
      isAlwaysOnTop: () => false,
      webContents: {
        isDestroyed: () => false,
        executeJavaScript: () => Promise.resolve(),
        send: () => {},
        setWindowOpenHandler: () => {}
      }
    };

    const mockElectron = {
      app: {
        whenReady: () => new Promise(() => {}),
        on: () => {},
        quit: () => {},
        getPath: () => path.resolve(__dirname, '..')
      },
      BrowserWindow: Object.assign(
        function MockBrowserWindow() { return mockWindow; },
        {
          fromWebContents: () => mockWindow,
          getAllWindows: () => [mockWindow]
        }
      ),
      ipcMain: {
        handle: (channel, fn) => {
          ipcMainHandlers[channel] = fn;
        },
        on: () => {}
      },
      dialog: {
        showOpenDialog: () => Promise.resolve(dialogResult)
      },
      Menu: {
        getApplicationMenu: () => null,
        buildFromTemplate: () => ({}),
        setApplicationMenu: () => {}
      },
      shell: { openExternal: () => Promise.resolve() },
      globalShortcut: { register: () => {}, unregisterAll: () => {} },
      session: { defaultSession: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} } }
    };

    const prevElectronCache = require.cache[electronPath];
    const prevMainCache = require.cache[require.resolve('../electron-main.js')];

    try {
      require.cache[electronPath] = {
        id: electronPath,
        filename: electronPath,
        loaded: true,
        exports: mockElectron
      };
      delete require.cache[require.resolve('../electron-main.js')];

      const electronMain = require('../electron-main.js');
      if (typeof electronMain.setServerPort === 'function') {
        electronMain.setServerPort(boundPort);
      }

      assert.equal(typeof ipcMainHandlers['dialog:pick-directory'], 'function', 'dialog:pick-directory registered');
      const pickHandler = ipcMainHandlers['dialog:pick-directory'];

      // Untrusted sender -> rejected and not registered
      const untrustedRes = await pickHandler({
        senderFrame: { url: 'http://evil.com/' },
        sender: { getURL: () => 'http://evil.com/' }
      });
      assert.equal(untrustedRes.canceled, true);
      assert.equal(getRegisteredDeckFolders().has(fs.realpathSync(ipcFolder)), false, 'Untrusted sender does not register folder');

      // Trusted sender with canceled dialog -> not registered
      dialogResult = { canceled: true, filePaths: [] };
      const canceledRes = await pickHandler({
        senderFrame: { url: `http://127.0.0.1:${boundPort}/` },
        sender: { getURL: () => `http://127.0.0.1:${boundPort}/` }
      });
      assert.equal(canceledRes.canceled, true);
      assert.equal(getRegisteredDeckFolders().has(fs.realpathSync(ipcFolder)), false, 'Canceled picker does not register folder');

      // Trusted sender with picked folder -> registered in trusted Set!
      dialogResult = { canceled: false, filePaths: [ipcFolder] };
      const successRes = await pickHandler({
        senderFrame: { url: `http://127.0.0.1:${boundPort}/` },
        sender: { getURL: () => `http://127.0.0.1:${boundPort}/` }
      });
      assert.equal(successRes.canceled, false);
      assert.equal(successRes.path, ipcFolder);
      assert.equal(getRegisteredDeckFolders().has(fs.realpathSync(ipcFolder)), true, 'Picked folder is now registered in trusted Set');
    } finally {
      if (prevElectronCache) require.cache[electronPath] = prevElectronCache;
      else delete require.cache[electronPath];
      if (prevMainCache) require.cache[require.resolve('../electron-main.js')] = prevMainCache;
      else delete require.cache[require.resolve('../electron-main.js')];
    }
  });

  await t.test('7. POST /api/crop validates folder trust, magic bytes, size limits, and saves to _crops (AUTOMATED-RAN)', async () => {
    process.env.APP_RUNTIME = 'electron';
    registerTrustedFolder(pickedFolder);

    const validPngBase64 = 'data:image/png;base64,' + Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ]).toString('base64');

    const validJpgBase64 = 'data:image/jpeg;base64,' + Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46
    ]).toString('base64');

    const validWebpBase64 = 'data:image/webp;base64,' + Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
      Buffer.from('VP8 ')
    ]).toString('base64');

    // 1. Unregistered folder -> 403
    const resUnregistered = await fetch(`${baseUrl}/api/crop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: unregisteredFolder,
        dataUrl: validPngBase64
      })
    });
    assert.equal(resUnregistered.status, 403, 'POST /api/crop rejects unregistered folder with 403');
    const unregBody = await resUnregistered.json();
    assert.ok(unregBody.error.includes('Access denied'));

    // 2. Missing fields -> 400
    const resMissing = await fetch(`${baseUrl}/api/crop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: pickedFolder })
    });
    assert.equal(resMissing.status, 400, 'POST /api/crop rejects missing dataUrl with 400');

    // 3. Invalid magic bytes (e.g. text/html) -> 415
    const invalidFormatBase64 = 'data:text/plain;base64,' + Buffer.from('hello not an image').toString('base64');
    const resBadFormat = await fetch(`${baseUrl}/api/crop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: pickedFolder,
        dataUrl: invalidFormatBase64
      })
    });
    assert.equal(resBadFormat.status, 415, 'POST /api/crop rejects invalid magic bytes with 415');

    // 4. Successful PNG crop
    const resPng = await fetch(`${baseUrl}/api/crop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: pickedFolder,
        dataUrl: validPngBase64,
        cardId: 'card_123',
        tag: 'focal-point'
      })
    });
    assert.equal(resPng.status, 200, 'POST /api/crop succeeds with valid PNG');
    const pngBody = await resPng.json();
    assert.equal(pngBody.ok, true);
    assert.ok(pngBody.cropPath.includes(path.join(pickedFolder, '_crops')));
    assert.ok(pngBody.cropPath.endsWith('.png'));
    assert.ok(pngBody.cropUrl.startsWith('/api/image?path='));
    assert.ok(fs.existsSync(pngBody.cropPath), 'Saved crop file exists on disk');

    // Verify cropUrl is servable via /api/image
    const resServed = await fetch(`${baseUrl}${pngBody.cropUrl}`);
    assert.equal(resServed.status, 200, '/api/image serves saved crop file');
    assert.equal(resServed.headers.get('content-type'), 'image/png');

    // 5. Successful JPG and WEBP crops
    const resJpg = await fetch(`${baseUrl}/api/crop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: pickedFolder,
        dataUrl: validJpgBase64
      })
    });
    assert.equal(resJpg.status, 200);
    const jpgBody = await resJpg.json();
    assert.ok(jpgBody.cropPath.endsWith('.jpg'));
    assert.ok(fs.existsSync(jpgBody.cropPath));

    const resWebp = await fetch(`${baseUrl}/api/crop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: pickedFolder,
        dataUrl: validWebpBase64
      })
    });
    assert.equal(resWebp.status, 200);
    const webpBody = await resWebp.json();
    assert.ok(webpBody.cropPath.endsWith('.webp'));
    assert.ok(fs.existsSync(webpBody.cropPath));
  });

  await t.test('8. GET /api/images excludes _crops subdirectories from recursive scan (AUTOMATED-RAN)', async () => {
    process.env.APP_RUNTIME = 'electron';

    // pickedFolder now contains picked1.png, picked2.jpg, and _crops/ with 3 crop files
    const resImages = await fetch(`${baseUrl}/api/images?folder=${encodeURIComponent(pickedFolder)}`);
    assert.equal(resImages.status, 200);
    const images = await resImages.json();

    // Must only have picked1.png and picked2.jpg, NOT the crop files
    assert.equal(images.length, 2, 'images count must be 2, ignoring _crops');
    const paths = images.map(img => img.path);
    assert.ok(paths.some(p => p.includes('picked1.png')));
    assert.ok(paths.some(p => p.includes('picked2.jpg')));
    assert.ok(!paths.some(p => p.includes('_crops')), 'No _crops paths included in GET /api/images');
  });

  await t.test('9. DELETE /api/crop unlinks crop file and forbids deleting parent reference or outside files (AUTOMATED-RAN)', async () => {
    process.env.APP_RUNTIME = 'electron';
    registerTrustedFolder(pickedFolder);

    // 1. Create a dedicated crop file to delete
    const cropsDir = path.join(pickedFolder, '_crops');
    fs.mkdirSync(cropsDir, { recursive: true });
    const cropFile = path.join(cropsDir, 'crop_test_delete.png');
    fs.writeFileSync(cropFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.ok(fs.existsSync(cropFile), 'Crop file exists before delete');

    // 2. Reject missing cropPath -> 400
    const resMissing = await fetch(`${baseUrl}/api/crop`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(resMissing.status, 400, 'DELETE /api/crop rejects missing cropPath with 400');

    // 3. Forbid deleting parent reference file picked1.png -> 403
    const resParent = await fetch(`${baseUrl}/api/crop`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cropPath: pickedImg1 })
    });
    assert.equal(resParent.status, 403, 'DELETE /api/crop rejects deleting parent reference with 403');
    assert.ok(fs.existsSync(pickedImg1), 'Parent reference file remains intact');

    // 4. Forbid deleting via path traversal (<pickedFolder>/_crops/../picked1.png) -> 403
    const traversalPath = path.join(cropsDir, '..', 'picked1.png');
    const resTraversal = await fetch(`${baseUrl}/api/crop`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cropPath: traversalPath })
    });
    assert.equal(resTraversal.status, 403, 'DELETE /api/crop rejects path traversal with 403');
    assert.ok(fs.existsSync(pickedImg1), 'Parent reference file still exists');

    // 5. Forbid deleting outside unregistered file -> 403
    const resOutside = await fetch(`${baseUrl}/api/crop`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cropPath: outsideImg })
    });
    assert.equal(resOutside.status, 403, 'DELETE /api/crop rejects deleting outside file with 403');
    assert.ok(fs.existsSync(outsideImg), 'Outside file remains intact');

    // 6. Successfully delete valid crop file -> 200 { ok: true }
    const resDelete = await fetch(`${baseUrl}/api/crop`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cropPath: cropFile })
    });
    assert.equal(resDelete.status, 200, 'DELETE /api/crop deletes valid crop');
    const deleteBody = await resDelete.json();
    assert.equal(deleteBody.ok, true);
    assert.equal(fs.existsSync(cropFile), false, 'Crop file was unlinked from disk');

    // 7. Deleting already deleted crop file (ENOENT) -> 200 { ok: true }
    const resDeleteAgain = await fetch(`${baseUrl}/api/crop`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cropPath: cropFile })
    });
    assert.equal(resDeleteAgain.status, 200, 'DELETE /api/crop ignores ENOENT and returns 200 { ok: true }');
    const deleteAgainBody = await resDeleteAgain.json();
    assert.equal(deleteAgainBody.ok, true);
  });

  await t.test('10. Origin Gate and Host header middleware protects /api/crop (AUTOMATED-RAN)', async () => {
    // 1. Host header protection
    const badHostStatus = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: boundPort,
        path: '/api/crop',
        method: 'POST',
        headers: {
          Host: 'evil.com',
          'Content-Type': 'application/json'
        }
      }, (res) => resolve(res.statusCode));
      req.on('error', reject);
      req.write(JSON.stringify({ folderPath: pickedFolder }));
      req.end();
    });
    assert.equal(badHostStatus, 403, 'Host: evil.com rejected with 403');

    // 2. Cross-origin POST protection
    const crossOriginRes = await fetch(`${baseUrl}/api/crop`, {
      method: 'POST',
      headers: {
        Origin: 'http://malicious.example.com',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ folderPath: pickedFolder })
    });
    assert.equal(crossOriginRes.status, 403, 'Cross-origin POST rejected with 403');

    // 3. Cross-origin DELETE protection
    const crossOriginDelete = await fetch(`${baseUrl}/api/crop`, {
      method: 'DELETE',
      headers: {
        Origin: 'http://malicious.example.com',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ cropPath: path.join(pickedFolder, '_crops', 'some.png') })
    });
    assert.equal(crossOriginDelete.status, 403, 'Cross-origin DELETE rejected with 403');
  });
});
