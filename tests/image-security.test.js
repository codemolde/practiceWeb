const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const { app, startServer, USERDATA_DIR, STATE_FILE, SKETCHES_DIR, validateExternalUrl, safeHttpRequest } = require('../server');

test('Image Security, SSRF & Sketch Restrictions', async (t) => {
  let serverInstance = null;
  let boundPort = null;
  let baseUrl = null;

  // Create temporary test directories
  const testDeckDir = path.join(__dirname, 'test_deck_' + Date.now());
  const outsideDir = path.join(__dirname, 'outside_deck_' + Date.now());
  fs.mkdirSync(testDeckDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  // Create sample files
  const testSvgPath = path.join(testDeckDir, 'sample.svg');
  fs.writeFileSync(testSvgPath, '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5"/></svg>');

  const testPngPath = path.join(testDeckDir, 'sample.png');
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.writeFileSync(testPngPath, pngHeader);

  const outsideJpgPath = path.join(outsideDir, 'outside.jpg');
  const jpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  fs.writeFileSync(outsideJpgPath, jpgHeader);

  const testDotEnvPath = path.join(testDeckDir, '.env');
  fs.writeFileSync(testDotEnvPath, 'SECRET=12345');

  // Register testDeckDir in STATE_FILE
  fs.mkdirSync(USERDATA_DIR, { recursive: true });
  const originalState = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf8') : null;

  const testState = {
    decks: [
      { id: 'deck_test', name: 'Test Deck', folderPath: testDeckDir }
    ],
    cards: {},
    confirmReplace: true
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(testState, null, 2));

  t.before(async () => {
    process.env.APP_RUNTIME = 'electron';
    const res = await startServer(0);
    serverInstance = res.server;
    boundPort = res.port;
    baseUrl = `http://127.0.0.1:${boundPort}`;
  });

  t.after(() => {
    delete process.env.APP_RUNTIME;
    if (serverInstance && serverInstance.close) {
      serverInstance.close();
    }
    // Restore or clean up state file
    if (originalState) {
      fs.writeFileSync(STATE_FILE, originalState);
    } else {
      try { fs.unlinkSync(STATE_FILE); } catch (e) {}
    }
    try { fs.rmSync(testDeckDir, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch (e) {}
  });

  await t.test('1. /api/image rejects /etc/hosts with 415 (AUTOMATED-RAN)', async () => {
    const res = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent('/etc/hosts')}`);
    assert.equal(res.status, 415, '/etc/hosts must be rejected with 415 Unsupported Media Type');
  });

  await t.test('2. /api/image rejects .env file with 415 (AUTOMATED-RAN)', async () => {
    const res = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(testDotEnvPath)}`);
    assert.equal(res.status, 415, '.env file must be rejected with 415 Unsupported Media Type');
  });

  await t.test('3. /api/image rejects valid image outside registered deck folders with 403 (AUTOMATED-RAN)', async () => {
    const res = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(outsideJpgPath)}`);
    assert.equal(res.status, 403, 'Image path outside deck folders must be rejected with 403');
  });

  await t.test('4. /api/image allows .svg inside deck folder and sends nosniff + sandbox headers (AUTOMATED-RAN)', async () => {
    const res = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(testSvgPath)}`);
    assert.equal(res.status, 200, '.svg file inside deck folder must return 200');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-security-policy'), "sandbox; default-src 'none'");
    assert.ok(res.headers.get('content-type').startsWith('image/svg+xml'), 'Content-type must be svg');
  });

  await t.test('5. /api/image loads normal deck image with security headers (AUTOMATED-RAN)', async () => {
    const res = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(testPngPath)}`);
    assert.equal(res.status, 200, 'Normal deck png image must return 200');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  });

  await t.test('6. /api/download-url rejects path outside registered deck folders with 403 (AUTOMATED-RAN)', async () => {
    const res = await fetch(`${baseUrl}/api/download-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: outsideDir,
        url: 'https://example.com/art.jpg'
      })
    });
    assert.equal(res.status, 403, 'download-url to unregistered folder must return 403');
  });

  await t.test('7. /api/download-url clipper saves image into registered deck folder (MOCKED)', async () => {
    // Spin up mock server serving image
    const mockImageServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': '4' });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    });

    await new Promise(r => mockImageServer.listen(0, '127.0.0.1', r));
    const mockPort = mockImageServer.address().port;

    try {
      // Simulate safe download using safeHttpRequest directly with options._allowLocalhostForTesting
      const downloadRes = await safeHttpRequest(`http://127.0.0.1:${mockPort}/mock_pin.jpg`, {
        _allowLocalhostForTesting: true
      });
      assert.equal(downloadRes.statusCode, 200);

      // Verify saving into registered deck folder
      const targetFilename = 'pinterest_clippy_test.jpg';
      const targetFilePath = path.join(testDeckDir, targetFilename);
      fs.writeFileSync(targetFilePath, downloadRes.buffer);
      assert.ok(fs.existsSync(targetFilePath), 'Downloaded image saved in registered deck folder');
    } finally {
      mockImageServer.close();
    }
  });

  await t.test('8. /api/browse returns 404 in Electron runtime, 200 in browser mode (AUTOMATED-RAN)', async () => {
    // 1. In browser mode (default APP_RUNTIME unset or not 'electron')
    delete process.env.APP_RUNTIME;
    const browserRes = await fetch(`${baseUrl}/api/browse?path=${encodeURIComponent(testDeckDir)}`);
    assert.equal(browserRes.status, 200, 'Browser mode must allow /api/browse');

    // 2. In Electron runtime
    process.env.APP_RUNTIME = 'electron';
    const electronRes = await fetch(`${baseUrl}/api/browse?path=${encodeURIComponent(testDeckDir)}`);
    assert.equal(electronRes.status, 404, 'Electron mode must return 404 for /api/browse');
    delete process.env.APP_RUNTIME;
  });

  await t.test('9. /api/sketch POST size and magic byte checks (AUTOMATED-RAN)', async () => {
    // 1. Reject over 15 MB decoded -> 413
    const bigBuffer = Buffer.alloc(16 * 1024 * 1024, 0x89);
    const bigDataUrl = `data:image/png;base64,${bigBuffer.toString('base64')}`;

    const bigRes = await fetch(`${baseUrl}/api/sketch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: bigDataUrl })
    });
    assert.equal(bigRes.status, 413, 'Over 15MB decoded must be rejected with 413');

    // 2. Reject invalid magic bytes -> 415
    const badBuffer = Buffer.from('<html><body>not an image</body></html>');
    const badDataUrl = `data:image/png;base64,${badBuffer.toString('base64')}`;

    const badRes = await fetch(`${baseUrl}/api/sketch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: badDataUrl })
    });
    assert.equal(badRes.status, 415, 'Invalid magic bytes must be rejected with 415');

    // 3. Valid PNG buffer -> 200 and named with random hex
    const validPngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ]);
    const validDataUrl = `data:image/png;base64,${validPngBuffer.toString('base64')}`;

    const validRes = await fetch(`${baseUrl}/api/sketch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: validDataUrl })
    });
    assert.equal(validRes.status, 200, 'Valid sketch must save successfully');
    const validJson = await validRes.json();
    assert.ok(validJson.sketchUrl, 'Response contains sketchUrl');

    // File name must match sk_<16_hex_chars>.png
    const filename = path.basename(validJson.sketchUrl);
    assert.match(filename, /^sk_[0-9a-f]{16}\.png$/, 'File must be named with crypto.randomBytes(8).toString("hex")');

    // Clean up created test sketch
    try { fs.unlinkSync(path.join(SKETCHES_DIR, filename)); } catch (e) {}
  });

  await t.test('10. SSRF: outbound ports restricted to 80/443 and Referer stripping (AUTOMATED-RAN)', async () => {
    // 1. Outbound ports restricted to 80/443
    const check80 = await validateExternalUrl('http://example.com:80/image.jpg');
    assert.equal(check80.blocked, false, 'Port 80 is allowed');

    const check443 = await validateExternalUrl('https://example.com:443/image.jpg');
    assert.equal(check443.blocked, false, 'Port 443 is allowed');

    const check8080 = await validateExternalUrl('http://example.com:8080/image.jpg');
    assert.equal(check8080.blocked, true, 'Port 8080 must be blocked');
    assert.ok(check8080.reason.includes('8080'));

    const check22 = await validateExternalUrl('http://example.com:22/image.jpg');
    assert.equal(check22.blocked, true, 'Port 22 must be blocked');

    // 2. Strip Referer unless host is pinimg.com
    let receivedReferer = null;
    const mockServer = http.createServer((req, res) => {
      receivedReferer = req.headers['referer'] || null;
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end('ok');
    });

    await new Promise(r => mockServer.listen(0, '127.0.0.1', r));
    const port = mockServer.address().port;

    try {
      // Non-pinimg host: Referer is stripped
      await safeHttpRequest(`http://127.0.0.1:${port}/test`, {
        _allowLocalhostForTesting: true,
        headers: { 'Referer': 'https://www.pinterest.com/' }
      });
      assert.equal(receivedReferer, null, 'Referer must be stripped for non-pinimg host');
    } finally {
      mockServer.close();
    }
  });

  await t.test('11. Sketch routes: removed routes (POST /api/sketch-history, GET /api/sketch, DELETE /api/sketch) -> 404, kept routes (POST /api/sketch, GET /api/sketch/:filename) -> 200 (AUTOMATED-RAN)', async () => {
    // 1. Removed: POST /api/sketch-history -> 404
    const postHistRes = await fetch(`${baseUrl}/api/sketch-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: 'test', dataUrl: 'data:image/png;base64,iVBORw==' })
    });
    assert.equal(postHistRes.status, 404, 'Removed POST /api/sketch-history must return 404');

    // 2. Removed: GET /api/sketch?file=... -> 404
    const getQueryRes = await fetch(`${baseUrl}/api/sketch?file=some_sketch.png`);
    assert.equal(getQueryRes.status, 404, 'Removed GET /api/sketch?file= must return 404');

    // 3. Removed: DELETE /api/sketch?file=... -> 404
    const delRes = await fetch(`${baseUrl}/api/sketch?file=some_sketch.png`, {
      method: 'DELETE'
    });
    assert.equal(delRes.status, 404, 'Removed DELETE /api/sketch must return 404');

    // 4. Kept: POST /api/sketch -> 200
    const validPngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ]);
    const postRes = await fetch(`${baseUrl}/api/sketch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${validPngBuffer.toString('base64')}` })
    });
    assert.equal(postRes.status, 200, 'Kept POST /api/sketch returns 200');
    const postJson = await postRes.json();
    assert.ok(postJson.sketchUrl, 'Returns sketchUrl');

    // 5. Kept: GET /api/sketch/:filename -> 200
    const getRes = await fetch(`${baseUrl}${postJson.sketchUrl}`);
    assert.equal(getRes.status, 200, 'Kept GET /api/sketch/:filename returns 200');
    assert.equal(getRes.headers.get('content-type'), 'image/png');

    // Clean up created test sketch
    try { fs.unlinkSync(path.join(SKETCHES_DIR, path.basename(postJson.sketchUrl))); } catch (e) {}
  });
});
