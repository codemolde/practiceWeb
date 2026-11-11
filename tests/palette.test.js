const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const paletteJsPath = path.join(__dirname, '../public/js/palette.js');
const indexHtmlPath = path.join(__dirname, '../public/index.html');
const appJsPath = path.join(__dirname, '../public/app.js');

test('Step 1: ColorPaletteManager moved out of app.js into public/js/palette.js', () => {
  assert.ok(fs.existsSync(paletteJsPath), 'public/js/palette.js must exist');

  const paletteCode = fs.readFileSync(paletteJsPath, 'utf8');
  assert.ok(paletteCode.includes('ColorPaletteManager'), 'palette.js contains ColorPaletteManager');

  // Verify ColorPaletteManager is no longer declared as an object in app.js
  const appJsCode = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(!appJsCode.includes('const ColorPaletteManager = {'), 'app.js must not declare ColorPaletteManager');

  // Verify index.html loads palette.js before app.js
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const paletteIdx = indexHtml.indexOf('src="js/palette.js');
  const appIdx = indexHtml.indexOf('src="app.js');
  assert.ok(paletteIdx !== -1, 'index.html must load js/palette.js');
  assert.ok(appIdx !== -1, 'index.html must load app.js');
  assert.ok(paletteIdx < appIdx, 'js/palette.js must be loaded before app.js');

  // Require palette.js and verify exported methods
  const ColorPaletteManager = require(paletteJsPath);
  assert.ok(ColorPaletteManager, 'ColorPaletteManager is exported');
  assert.equal(typeof ColorPaletteManager.init, 'function');
  assert.equal(typeof ColorPaletteManager.toggleHUD, 'function');
  assert.equal(typeof ColorPaletteManager.toggleEyedropper, 'function');
  assert.equal(typeof ColorPaletteManager.extractPalette, 'function');
  assert.equal(typeof ColorPaletteManager.formatColor, 'function');
  assert.equal(typeof ColorPaletteManager.copyActiveHex, 'function');
  assert.equal(typeof ColorPaletteManager.clearSampled, 'function');
});
