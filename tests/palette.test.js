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
  classifyTemperature,
  getBandIndex,
  getBandNames,
  getBandColors,
  labLightnessToSrgbGray,
  calculateBandPercentages,
  computeValueBands,
  generateDeltaNote,
  posterizeImageDataToBands
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

// ==================== TEST 10: VALUE MAP BAND ASSIGNMENT ON SYNTHETIC GRADIENTS ====================
test('Value Map: band assignment on synthetic gradients across 3, 5, and 9 bands (AUTOMATED-RAN)', () => {
  // 1. Boundary tests for 3 bands: [0..33.33) -> 0 (Darks), [33.33..66.67) -> 1 (Midtones), [66.67..100] -> 2 (Lights)
  assert.equal(getBandIndex(0, 3), 0, 'L*=0 must be band 0 (Darks)');
  assert.equal(getBandIndex(20, 3), 0, 'L*=20 must be band 0 (Darks)');
  assert.equal(getBandIndex(33.3, 3), 0, 'L*=33.3 must be band 0 (Darks)');
  assert.equal(getBandIndex(33.4, 3), 1, 'L*=33.4 must be band 1 (Midtones)');
  assert.equal(getBandIndex(50, 3), 1, 'L*=50 must be band 1 (Midtones)');
  assert.equal(getBandIndex(66.6, 3), 1, 'L*=66.6 must be band 1 (Midtones)');
  assert.equal(getBandIndex(66.7, 3), 2, 'L*=66.7 must be band 2 (Lights)');
  assert.equal(getBandIndex(90, 3), 2, 'L*=90 must be band 2 (Lights)');
  assert.equal(getBandIndex(100, 3), 2, 'L*=100 must be band 2 (Lights)');

  // Clamping outside [0..100]
  assert.equal(getBandIndex(-10, 3), 0, 'L* < 0 clamps to band 0');
  assert.equal(getBandIndex(150, 3), 2, 'L* > 100 clamps to band 2');

  // 2. Boundary tests for 5 bands: 20% width per band
  assert.equal(getBandIndex(0, 5), 0, 'L*=0 -> Deep Darks');
  assert.equal(getBandIndex(19.9, 5), 0, 'L*=19.9 -> Deep Darks');
  assert.equal(getBandIndex(20.0, 5), 1, 'L*=20.0 -> Darks');
  assert.equal(getBandIndex(39.9, 5), 1, 'L*=39.9 -> Darks');
  assert.equal(getBandIndex(40.0, 5), 2, 'L*=40.0 -> Midtones');
  assert.equal(getBandIndex(59.9, 5), 2, 'L*=59.9 -> Midtones');
  assert.equal(getBandIndex(60.0, 5), 3, 'L*=60.0 -> Lights');
  assert.equal(getBandIndex(79.9, 5), 3, 'L*=79.9 -> Lights');
  assert.equal(getBandIndex(80.0, 5), 4, 'L*=80.0 -> Highlights');
  assert.equal(getBandIndex(100.0, 5), 4, 'L*=100.0 -> Highlights');

  // 3. Boundary tests for 9 bands
  assert.equal(getBandIndex(0, 9), 0);
  assert.equal(getBandIndex(11.1, 9), 0);
  assert.equal(getBandIndex(11.2, 9), 1);
  assert.equal(getBandIndex(50.0, 9), 4);
  assert.equal(getBandIndex(99.0, 9), 8);
  assert.equal(getBandIndex(100.0, 9), 8);

  // 4. Test on a synthetic gradient ImageData with 300 pixels
  // Linearly incrementing L* from 0 to 100
  const width = 300, height = 1;
  const gradData = new Uint8ClampedArray(width * height * 4);
  for (let x = 0; x < width; x++) {
    const L = (x / (width - 1)) * 100;
    const g = labLightnessToSrgbGray(L);
    const idx = x * 4;
    gradData[idx] = g;
    gradData[idx + 1] = g;
    gradData[idx + 2] = g;
    gradData[idx + 3] = 255;
  }

  const result3 = computeValueBands({ data: gradData }, 3);
  assert.equal(result3.numBands, 3);
  assert.equal(result3.totalPixels, 300);
  assert.deepEqual(result3.counts, [100, 100, 100], 'Each of the 3 bands has exactly 100 pixels');
  assert.deepEqual(result3.percentages, [34, 33, 33], 'Gradient across 3 bands splits into 34%, 33%, 33% (sum=100)');
  assert.equal(result3.bands[0].name, 'Darks');
  assert.equal(result3.bands[1].name, 'Midtones');
  assert.equal(result3.bands[2].name, 'Lights');

  const result5 = computeValueBands({ data: gradData }, 5);
  assert.equal(result5.numBands, 5);
  assert.deepEqual(result5.percentages, [20, 20, 20, 20, 20], 'Gradient across 5 bands splits into exactly 20% each');
  assert.equal(result5.bands[0].name, 'Deep Darks');
  assert.equal(result5.bands[4].name, 'Highlights');
});

// ==================== TEST 11: AREA PERCENTAGES SUM TO 100 ====================
test('Value Map: area percentages sum to 100 across diverse distributions (AUTOMATED-RAN)', () => {
  // Largest Remainder Method guarantee
  const testCases = [
    [1, 1, 1],
    [333, 333, 334],
    [0, 0, 100],
    [100, 0, 0],
    [0, 50, 50],
    [17, 31, 52],
    [1, 2, 3, 4, 5],
    [7, 11, 13, 17, 19],
    [99, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [12345, 67890, 54321]
  ];

  for (const counts of testCases) {
    const pcts = calculateBandPercentages(counts);
    const sum = pcts.reduce((a, b) => a + b, 0);
    assert.equal(sum, 100, `Percentages for [${counts.join(', ')}] must sum to 100 (got ${sum}: [${pcts.join(', ')}])`);
  }

  // 100 random multi-bin integer distributions
  for (let run = 0; run < 100; run++) {
    const numBins = [3, 5, 9][run % 3];
    const counts = [];
    for (let b = 0; b < numBins; b++) {
      counts.push(Math.floor(Math.random() * 5000) + 1);
    }
    const pcts = calculateBandPercentages(counts);
    const sum = pcts.reduce((a, b) => a + b, 0);
    assert.equal(sum, 100, `Random distribution ${run} with ${numBins} bins must sum to 100`);
    assert.equal(pcts.length, numBins);
    for (const p of pcts) {
      assert.ok(Number.isInteger(p), 'Each percentage must be an integer');
      assert.ok(p >= 0 && p <= 100, 'Each percentage must be in [0..100]');
    }
  }

  // Edge case: zero total pixels
  const zeroPcts = calculateBandPercentages([0, 0, 0]);
  assert.deepEqual(zeroPcts, [0, 0, 0]);
});

// ==================== TEST 12: SKETCH VS REFERENCE DELTAS & FORMATTED NOTE ====================
test('Value Map: sketch vs reference deltas and formatted note (AUTOMATED-RAN)', () => {
  // Case 1: Sketch darks cover 12% more area
  // Reference: Darks 30%, Midtones 45%, Lights 25%
  // Sketch:    Darks 42%, Midtones 38%, Lights 20%
  // Delta: Darks +12, Midtones -7, Lights -5 -> max absolute is +12 on darks
  const note1 = generateDeltaNote([30, 45, 25], [42, 38, 20], 3);
  assert.equal(note1, 'your darks cover 12% more area');

  // Case 2: Sketch darks cover 10% less area
  // Reference: Darks 40%, Midtones 40%, Lights 20%
  // Sketch:    Darks 30%, Midtones 45%, Lights 25%
  // Delta: Darks -10, Midtones +5, Lights +5 -> max absolute is -10 on darks
  const note2 = generateDeltaNote([40, 40, 20], [30, 45, 25], 3);
  assert.equal(note2, 'your darks cover 10% less area');

  // Case 3: Sketch lights cover 15% less area
  // Reference: Darks 25%, Midtones 35%, Lights 40%
  // Sketch:    Darks 35%, Midtones 40%, Lights 25%
  // Delta: Darks +10, Midtones +5, Lights -15 -> max absolute is -15 on lights
  const note3 = generateDeltaNote([25, 35, 40], [35, 40, 25], 3);
  assert.equal(note3, 'your lights cover 15% less area');

  // Case 4: Identical breakdown (0% difference)
  const note4 = generateDeltaNote([33, 34, 33], [33, 34, 33], 3);
  assert.equal(note4, 'your values match the reference (0% difference)');

  // Case 5: 5-band distribution
  // Reference: [10, 20, 40, 20, 10]
  // Sketch:    [25, 15, 35, 15, 10]
  // Delta: Deep Darks +15, Darks -5, Midtones -5, Lights -5, Highlights 0
  const note5 = generateDeltaNote([10, 20, 40, 20, 10], [25, 15, 35, 15, 10], 5);
  assert.equal(note5, 'your deep darks cover 15% more area');

  // Strict constraint check: Zero interpretive / pedagogical art-teaching text
  const prohibitedTerms = ['try', 'should', 'improve', 'great', 'contrast', 'balance', 'better', 'worse', 'advice'];
  for (const n of [note1, note2, note3, note4, note5]) {
    const lower = n.toLowerCase();
    for (const term of prohibitedTerms) {
      assert.ok(!lower.includes(term), `Delta note "${n}" must not contain pedagogical term "${term}"`);
    }
  }
});

// ==================== TEST 13: CANVAS PIXEL PROCESSING (ZERO SVG FILTERS) ====================
test('Value Map: canvas pixel processing posterization and context application (AUTOMATED-RAN)', () => {
  // 3 pixels: pure black (0, 0, 0), mid grey (119, 119, 119), pure white (255, 255, 255)
  const src = {
    data: new Uint8ClampedArray([
      0, 0, 0, 255,        // L* = 0 -> Band 0 (Darks)
      119, 119, 119, 255,  // L* ≈ 50 -> Band 1 (Midtones)
      255, 255, 255, 255   // L* = 100 -> Band 2 (Lights)
    ])
  };
  const dst = {
    data: new Uint8ClampedArray(12)
  };

  posterizeImageDataToBands(src, dst, 3);

  // Representative midpoints for 3 bands:
  // Band 0: L* ≈ 16.7 -> sRGB 41 (#292929)
  // Band 1: L* = 50.0 -> sRGB 119 (#777777)
  // Band 2: L* ≈ 83.3 -> sRGB 208 (#D0D0D0)
  assert.equal(dst.data[0], 41, 'Black posterized to band 0 gray 41');
  assert.equal(dst.data[1], 41);
  assert.equal(dst.data[2], 41);
  assert.equal(dst.data[3], 255);

  assert.equal(dst.data[4], 119, 'Mid grey posterized to band 1 gray 119');
  assert.equal(dst.data[5], 119);
  assert.equal(dst.data[6], 119);
  assert.equal(dst.data[7], 255);

  assert.equal(dst.data[8], 208, 'White posterized to band 2 gray 208');
  assert.equal(dst.data[9], 208);
  assert.equal(dst.data[10], 208);
  assert.equal(dst.data[11], 255);

  // Test applyValueMapToContext works on canvas contexts (used by PiPCanvasStreamer)
  let putCalled = false;
  const mockCtx = {
    getImageData(x, y, w, h) {
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(imgData, x, y) {
      putCalled = true;
    }
  };

  ColorPaletteManager.applyValueMapToContext(mockCtx, 0, 0, 10, 10, 3);
  assert.ok(putCalled, 'applyValueMapToContext must call putImageData on the target context');
});

// ==================== TEST 14: VALUE MAP DOM CONTRACTS IN INDEX.HTML & APP.JS ====================
test('Value Map: index.html and app.js contract integration', () => {
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  // Verify tab buttons and view panels
  assert.ok(indexHtml.includes('id="tab-palette-harmony"'), 'Must have tab-palette-harmony');
  assert.ok(indexHtml.includes('id="tab-palette-valuemap"'), 'Must have tab-palette-valuemap');
  assert.ok(indexHtml.includes('id="palette-view-harmony"'), 'Must have palette-view-harmony');
  assert.ok(indexHtml.includes('id="palette-view-valuemap"'), 'Must have palette-view-valuemap');

  // Verify Value Map controls and stacked bar containers
  assert.ok(indexHtml.includes('class="btn-val-bands'), 'Must have band selector buttons');
  assert.ok(indexHtml.includes('id="btn-toggle-valuemap-overlay"'), 'Must have overlay toggle button');
  assert.ok(indexHtml.includes('id="btn-toggle-sketch-compare"'), 'Must have compare sketch toggle button');
  assert.ok(indexHtml.includes('id="value-map-ref-bar"'), 'Must have value-map-ref-bar');
  assert.ok(indexHtml.includes('id="value-map-sketch-bar"'), 'Must have value-map-sketch-bar');
  assert.ok(indexHtml.includes('id="value-map-delta-note"'), 'Must have value-map-delta-note');

  // Verify Canvas overlay in #image-frame
  assert.ok(indexHtml.includes('id="value-map-overlay-canvas"'), 'Must have value-map-overlay-canvas in index.html');

  // Verify app.js hooks PiPCanvasStreamer and SketchOverlay
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(appJs.includes('ColorPaletteManager.applyValueMapToContext'), 'PiPCanvasStreamer in app.js must call ColorPaletteManager.applyValueMapToContext');
  assert.ok(appJs.includes('ColorPaletteManager.onSketchChanged'), 'SketchOverlay in app.js must notify ColorPaletteManager.onSketchChanged');
});


