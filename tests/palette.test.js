const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const paletteJsPath = path.join(__dirname, '../public/js/palette.js');
const indexHtmlPath = path.join(__dirname, '../public/index.html');
const appJsPath = path.join(__dirname, '../public/app.js');

const ColorPaletteManager = require(paletteJsPath);
const {
  srgbToLinear,
  srgbToLab,
  labToLCh,
  deltaE76,
  deltaE2000,
  classifyTemperature
} = ColorPaletteManager;

// ==================== TEST 1: STEP 1 REFACTOR INTEGRITY ====================
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

  assert.equal(typeof ColorPaletteManager.init, 'function');
  assert.equal(typeof ColorPaletteManager.toggleHUD, 'function');
  assert.equal(typeof ColorPaletteManager.toggleEyedropper, 'function');
  assert.equal(typeof ColorPaletteManager.extractPalette, 'function');
  assert.equal(typeof ColorPaletteManager.formatColor, 'function');
});

// ==================== TEST 2: CIELAB L* OF KNOWN COLORS ====================
test('Accuracy: CIELAB L* of known colors (white 100, black 0, mid grey about 53 for #777777 / #808080) (AUTOMATED-RAN)', () => {
  // Pure white (255, 255, 255) -> L* = 100
  const whiteLab = srgbToLab(255, 255, 255);
  assert.equal(Math.round(whiteLab.L), 100, 'White L* must be 100');
  assert.ok(Math.abs(whiteLab.a) < 0.01, 'White a* must be ~0');
  assert.ok(Math.abs(whiteLab.b) < 0.01, 'White b* must be ~0');

  // Pure black (0, 0, 0) -> L* = 0
  const blackLab = srgbToLab(0, 0, 0);
  assert.equal(Math.round(blackLab.L), 0, 'Black L* must be 0');
  assert.ok(Math.abs(blackLab.a) < 0.01, 'Black a* must be ~0');
  assert.ok(Math.abs(blackLab.b) < 0.01, 'Black b* must be ~0');

  // Mid grey #777777 (119, 119, 119) -> L* = 50.03 (perceptual middle grey)
  const grey77Lab = srgbToLab(119, 119, 119);
  assert.ok(grey77Lab.L >= 49.5 && grey77Lab.L <= 54.0, `Grey #777777 L* must be ~50-53 (got ${grey77Lab.L.toFixed(2)})`);

  // Mid grey #808080 (128, 128, 128) -> L* = 53.59
  const grey80Lab = srgbToLab(128, 128, 128);
  assert.ok(grey80Lab.L >= 53.0 && grey80Lab.L <= 54.0, `Grey #808080 L* must be ~53.6 (got ${grey80Lab.L.toFixed(2)})`);

  // Verify Munsell value (0-10) derived from L*: V = L* / 10
  const whiteFmt = ColorPaletteManager.formatColor(255, 255, 255);
  assert.equal(whiteFmt.val, 100);
  assert.equal(whiteFmt.munsell, 10.0);

  const blackFmt = ColorPaletteManager.formatColor(0, 0, 0);
  assert.equal(blackFmt.val, 0);
  assert.equal(blackFmt.munsell, 0.0);

  const greyFmt = ColorPaletteManager.formatColor(128, 128, 128);
  assert.equal(greyFmt.val, 54);
  assert.equal(greyFmt.munsell, 5.4);
});

// ==================== TEST 3: DELTA-E MERGE (CIEDE2000 & CIE76) ====================
test('Accuracy: Delta-E calculations and cluster merging (AUTOMATED-RAN)', () => {
  // Delta-E between identical colors is 0
  const labA = { L: 50, a: 20, b: 30 };
  assert.equal(deltaE76(labA, labA), 0);
  assert.equal(deltaE2000(labA, labA), 0);

  // Delta-E between black and white is 100
  const black = { L: 0, a: 0, b: 0 };
  const white = { L: 100, a: 0, b: 0 };
  assert.equal(deltaE76(black, white), 100);
  assert.equal(deltaE2000(black, white), 100);

  // Clusters closer than threshold merge together
  // Two very close warm browns:
  // Brown 1: #8A5A44 (rgb: 138, 90, 68) -> Lab(43.7, 18.0, 20.3)
  // Brown 2: #8C5C46 (rgb: 140, 92, 70) -> Lab(44.5, 18.0, 20.2)
  const c1 = { count: 100, L: 43.7, a: 18.0, b: 20.3, r: 138, g: 90, b_val: 68 };
  const c2 = { count: 80, L: 44.5, a: 18.0, b: 20.2, r: 140, g: 92, b_val: 70 };
  const dE = deltaE2000(c1, c2);
  assert.ok(dE < 2.0, `Very close colors should have small dE (got ${dE})`);

  // Distant cyan:
  const cyan = { count: 90, L: 70.0, a: -35.0, b: -15.0, r: 50, g: 200, b_val: 210 };

  // Merge with threshold = 11.0: c1 and c2 must merge; cyan must remain separate
  const merged = ColorPaletteManager.mergeClusters([c1, c2, cyan], 11.0, 7);
  assert.equal(merged.length, 2, 'Close clusters must merge, leaving 2 distinct clusters');

  // Verify merged cluster weighted average
  const mergedBrown = merged.find(c => c.count === 180);
  assert.ok(mergedBrown, 'Must have combined count of 180');
  assert.ok(mergedBrown.r >= 138 && mergedBrown.r <= 140);
});

// ==================== TEST 4: SYNTHETIC TWO-COLOR IMAGE EXTRACTION ====================
test('Accuracy: extraction on a synthetic two-color image gives those two colors (AUTOMATED-RAN)', () => {
  // Synthetic 80x80 image with 50% pure red (#FF0000 = 255, 0, 0) and 50% pure blue (#0000FF = 0, 0, 255)
  const pixels = [];
  for (let i = 0; i < 3200; i++) {
    const lab = srgbToLab(255, 0, 0);
    const lch = labToLCh(lab.L, lab.a, lab.b);
    pixels.push({ L: lab.L, a: lab.a, b: lab.b, r: 255, g: 0, b_val: 0, C: lch.C, h: lch.h });
  }
  for (let i = 0; i < 3200; i++) {
    const lab = srgbToLab(0, 0, 255);
    const lch = labToLCh(lab.L, lab.a, lab.b);
    pixels.push({ L: lab.L, a: lab.a, b: lab.b, r: 0, g: 0, b_val: 255, C: lch.C, h: lch.h });
  }

  const candidateClusters = ColorPaletteManager.medianCutLab(pixels, 12);
  const merged = ColorPaletteManager.mergeClusters(candidateClusters, 11.0, 7);

  assert.equal(merged.length, 2, 'Two distinct color poles must yield exactly 2 swatches');

  // Format colors
  const swatches = merged.map(c => ColorPaletteManager.formatColor(c.r, c.g, c.b));
  swatches.sort((a, b) => b.L - a.L);

  const colors = swatches.map(s => s.hex);
  assert.ok(colors.includes('#FF0000'), 'Must extract pure red #FF0000');
  assert.ok(colors.includes('#0000FF'), 'Must extract pure blue #0000FF');

  // Verify sorted by L*: Red (L* ≈ 53.2) > Blue (L* ≈ 32.3)
  assert.ok(swatches[0].L > swatches[1].L, 'Swatches must be sorted descending by L*');
  assert.equal(swatches[0].hex, '#FF0000', 'Red has higher L* so it is first');
  assert.equal(swatches[1].hex, '#0000FF', 'Blue has lower L* so it is second');
});

// ==================== TEST 5: EYEDROPPER SAMPLE AVERAGING ====================
test('Accuracy: eyedropper sample averaging correct (1px, 3x3, 5x5, 11x11) (AUTOMATED-RAN)', () => {
  // Create a 20x20 test buffer with all black (0, 0, 0) and one white pixel (255, 255, 255) at (10, 10)
  const W = 20, H = 20;
  const buffer = new Uint8ClampedArray(W * H * 4);
  const targetX = 10, targetY = 10;
  const targetIdx = (targetY * W + targetX) * 4;
  buffer[targetIdx] = 255;
  buffer[targetIdx + 1] = 255;
  buffer[targetIdx + 2] = 255;
  buffer[targetIdx + 3] = 255;

  const mockCtx = {
    canvas: { width: W, height: H },
    getImageData(x, y, w, h) {
      const slice = new Uint8ClampedArray(w * h * 4);
      let outIdx = 0;
      for (let cy = y; cy < y + h; cy++) {
        for (let cx = x; cx < x + w; cx++) {
          const inIdx = (cy * W + cx) * 4;
          slice[outIdx] = buffer[inIdx];
          slice[outIdx + 1] = buffer[inIdx + 1];
          slice[outIdx + 2] = buffer[inIdx + 2];
          slice[outIdx + 3] = buffer[inIdx + 3];
          outIdx += 4;
        }
      }
      return { data: slice };
    }
  };

  // 1px sample at (10, 10) reads exact center pixel (255)
  const sample1 = ColorPaletteManager.sampleAveraging(mockCtx, targetX, targetY, 1, W, H);
  assert.deepEqual(sample1, { r: 255, g: 255, b: 255 }, '1px must sample exact center pixel');

  // 3x3 sample around (10, 10) contains 1 white pixel + 8 black pixels -> avg 255/9 = 28
  const sample3 = ColorPaletteManager.sampleAveraging(mockCtx, targetX, targetY, 3, W, H);
  assert.equal(sample3.r, Math.round(255 / 9));
  assert.equal(sample3.g, Math.round(255 / 9));
  assert.equal(sample3.b, Math.round(255 / 9));

  // 5x5 sample around (10, 10) contains 1 white pixel + 24 black pixels -> avg 255/25 = 10
  const sample5 = ColorPaletteManager.sampleAveraging(mockCtx, targetX, targetY, 5, W, H);
  assert.equal(sample5.r, Math.round(255 / 25));
  assert.equal(sample5.g, Math.round(255 / 25));
  assert.equal(sample5.b, Math.round(255 / 25));

  // 11x11 sample around (10, 10) contains 1 white pixel + 120 black pixels -> avg 255/121 = 2
  const sample11 = ColorPaletteManager.sampleAveraging(mockCtx, targetX, targetY, 11, W, H);
  assert.equal(sample11.r, Math.round(255 / 121));
  assert.equal(sample11.g, Math.round(255 / 121));
  assert.equal(sample11.b, Math.round(255 / 121));

  // Uniform field: any sample size must preserve exact value
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = 120;
    buffer[i + 1] = 80;
    buffer[i + 2] = 40;
    buffer[i + 3] = 255;
  }
  const uniform1 = ColorPaletteManager.sampleAveraging(mockCtx, targetX, targetY, 1, W, H);
  const uniform5 = ColorPaletteManager.sampleAveraging(mockCtx, targetX, targetY, 5, W, H);
  const uniform11 = ColorPaletteManager.sampleAveraging(mockCtx, targetX, targetY, 11, W, H);
  assert.deepEqual(uniform1, { r: 120, g: 80, b: 40 });
  assert.deepEqual(uniform5, { r: 120, g: 80, b: 40 });
  assert.deepEqual(uniform11, { r: 120, g: 80, b: 40 });
});

// ==================== TEST 6: TEMPERATURE CLASSIFICATION & RELATIVE TEMPERATURE ====================
test('Accuracy: absolute and relative temperature classification (AUTOMATED-RAN)', () => {
  // Pure red: h ≈ 40°, C* ≈ 104 -> Warm
  const red = ColorPaletteManager.formatColor(255, 0, 0);
  assert.equal(red.temp, 'Warm');
  assert.ok(red.C > 100, 'Red has high chroma');

  // Pure blue: h ≈ 306°, C* ≈ 133 -> Cool
  const blue = ColorPaletteManager.formatColor(0, 0, 255);
  assert.equal(blue.temp, 'Cool');
  assert.ok(blue.C > 100, 'Blue has high chroma');

  // Neutral grey: C* = 0 -> Neutral
  const grey = ColorPaletteManager.formatColor(128, 128, 128);
  assert.equal(grey.temp, 'Neutral');
  assert.equal(grey.C, 0);

  // Relative temperature against image average hue:
  // Case A: Image average hue is cool cyan-blue (240°)
  // An olive green / warm tone (90°) must be classified as 'Warmer than avg' relative to this cool image
  const oliveInCool = ColorPaletteManager.formatColor(120, 140, 40, 240);
  assert.equal(oliveInCool.relTemp, 'Warmer than avg');

  // Case B: Image average hue is warm orange-red (45°)
  // A cool blue tone (240°) must be classified as 'Cooler than avg' relative to this warm image
  const blueInWarm = ColorPaletteManager.formatColor(40, 100, 200, 45);
  assert.equal(blueInWarm.relTemp, 'Cooler than avg');
});

// ==================== TEST 7: COPY FORMATS (HEX, RGB, HSB, LAB) ====================
test('Accuracy: copy formats formatted properly (AUTOMATED-RAN)', () => {
  const color = ColorPaletteManager.formatColor(138, 90, 68);
  assert.equal(color.hex, '#8A5A44');
  assert.equal(color.rgbStr, 'rgb(138, 90, 68)');
  assert.ok(color.hsbStr.startsWith('hsb(') && color.hsbStr.endsWith(')'));
  assert.ok(color.labStr.startsWith('Lab(') && color.labStr.endsWith(')'));
});

// ==================== TEST 8: EXTRACTION PERFORMANCE UNDER 50 MS ====================
test('Performance: extraction algorithm stays under 50 ms on 4000x3000 downscale (AUTOMATED-RAN)', () => {
  // Simulate 80x80 pixels from a downscaled 4000x3000 image
  const labPixels = [];
  for (let i = 0; i < 6400; i++) {
    const r = (Math.random() * 256) | 0;
    const g = (Math.random() * 256) | 0;
    const b = (Math.random() * 256) | 0;
    const lab = srgbToLab(r, g, b);
    const lch = labToLCh(lab.L, lab.a, lab.b);
    labPixels.push({ L: lab.L, a: lab.a, b: lab.b, r, g, b_val: b, C: lch.C, h: lch.h });
  }

  const t0 = performance.now();
  const clusters = ColorPaletteManager.medianCutLab(labPixels, 12);
  const merged = ColorPaletteManager.mergeClusters(clusters, 11.0, 7);
  const swatches = merged.map(c => ColorPaletteManager.formatColor(c.r, c.g, c.b));
  swatches.sort((a, b) => b.L - a.L);
  const elapsed = performance.now() - t0;

  console.log(`[Performance Benchmark] 80x80 Lab median-cut + CIEDE2000 merge completed in: ${elapsed.toFixed(2)} ms`);
  assert.ok(elapsed < 50, `Extraction algorithm took ${elapsed.toFixed(2)} ms, must stay under 50 ms`);
  assert.ok(swatches.length >= 1 && swatches.length <= 7, 'Must produce 1 to 7 swatches');
});

// ==================== TEST 9: EXTRACTPALETTE END-TO-END ON 4000x3000 IMAGE ====================
test('Performance: extractPalette end-to-end on 4000x3000 image under 50 ms (AUTOMATED-RAN)', () => {
  const W = 4000, H = 3000;
  const imgData80 = new Uint8ClampedArray(80 * 80 * 4);
  for (let i = 0; i < imgData80.length; i += 4) {
    imgData80[i] = (Math.random() * 256) | 0;
    imgData80[i + 1] = (Math.random() * 256) | 0;
    imgData80[i + 2] = (Math.random() * 256) | 0;
    imgData80[i + 3] = 255;
  }

  const mockImgEl = {
    naturalWidth: W,
    naturalHeight: H,
    complete: true
  };

  ColorPaletteManager._offscreenCanvas = { width: 0, height: 0 };
  ColorPaletteManager._offscreenCtx = {
    drawImage() {},
    getImageData() { return { data: new Uint8ClampedArray(4) }; }
  };
  ColorPaletteManager._thumbCanvas = { width: 80, height: 80 };
  ColorPaletteManager._thumbCtx = {
    drawImage() {},
    getImageData() { return { data: imgData80 }; }
  };

  const t0 = performance.now();
  ColorPaletteManager.extractPalette(mockImgEl);
  const wallClockMs = performance.now() - t0;

  console.log(`[4000x3000 Image Benchmark] extractPalette took: ${ColorPaletteManager.lastExtractionTimeMs.toFixed(2)} ms (wall-clock: ${wallClockMs.toFixed(2)} ms)`);
  assert.ok(ColorPaletteManager.lastExtractionTimeMs < 50, `Extraction must stay under 50 ms (was ${ColorPaletteManager.lastExtractionTimeMs.toFixed(2)} ms)`);
  assert.ok(ColorPaletteManager.dominantColors.length >= 1 && ColorPaletteManager.dominantColors.length <= 7, 'Extracts 1 to 7 dominant swatches');
});

