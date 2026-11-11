// ==================== COLOR & DOMINANT PALETTE EXTRACTION HUD ====================
// CIELAB (D65) & LCh Color Science, Median-Cut Clustering & Live Eyedropper

/**
 * Convert 8-bit standard gamma sRGB channel [0..255] to linear sRGB [0..1]
 */
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Convert linear sRGB channel [0..1] back to standard gamma sRGB [0..255]
 */
function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/**
 * Convert 8-bit sRGB (r, g, b) to CIELAB (L*, a*, b*) under standard D65 illuminant (2° observer)
 * Standard reference white: Xn = 0.95047, Yn = 1.00000, Zn = 1.08883
 */
function srgbToLab(r, g, b) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  // sRGB to CIE XYZ matrix (D65)
  const X = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const Y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const Z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;

  const Xn = 0.95047;
  const Yn = 1.00000;
  const Zn = 1.08883;

  const xr = X / Xn;
  const yr = Y / Yn;
  const zr = Z / Zn;

  const eps = 216 / 24389; // (6/29)^3 ≈ 0.00885645167
  const kappa = 24389 / 27; // (29/3)^3 ≈ 903.296296

  function f(t) {
    return t > eps ? Math.cbrt(t) : (kappa * t + 16) / 116;
  }

  const fx = f(xr);
  const fy = f(yr);
  const fz = f(zr);

  const L = Math.max(0, Math.min(100, 116 * fy - 16));
  let a = 500 * (fx - fy);
  let bVal = 200 * (fy - fz);

  // Eliminate tiny floating point precision artifacts for pure achromatic neutrals
  if (r === g && g === b) {
    a = 0;
    bVal = 0;
  }

  return { L, a, b: bVal };
}

/**
 * Convert CIELAB (L*, a*, b*) to cylindrical LCh(ab)
 * C* = Chroma, h = Hue angle in degrees [0..360)
 */
function labToLCh(L, a, b) {
  if (Math.abs(a) < 1e-6 && Math.abs(b) < 1e-6) {
    return { L, C: 0, h: 0 };
  }
  const C = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return { L, C, h };
}

/**
 * CIE76 Delta-E color difference (Euclidean distance in Lab space)
 */
function deltaE76(lab1, lab2) {
  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * CIEDE2000 Delta-E color difference
 * Perceptually uniform standard ISO/CIE 11664-6:2014
 */
function deltaE2000(lab1, lab2) {
  const L1 = lab1.L, a1 = lab1.a, b1 = lab1.b;
  const L2 = lab2.L, a2 = lab2.a, b2 = lab2.b;

  const avgL = (L1 + L2) / 2;
  const c1 = Math.sqrt(a1 * a1 + b1 * b1);
  const c2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (c1 + c2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const c1p = Math.sqrt(a1p * a1p + b1 * b1);
  const c2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avgCp = (c1p + c2p) / 2;

  let h1p = Math.atan2(b1, a1p) * (180 / Math.PI);
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * (180 / Math.PI);
  if (h2p < 0) h2p += 360;

  let deltahp = 0;
  if (c1p * c2p !== 0) {
    if (Math.abs(h2p - h1p) <= 180) {
      deltahp = h2p - h1p;
    } else if (h2p - h1p > 180) {
      deltahp = h2p - h1p - 360;
    } else {
      deltahp = h2p - h1p + 360;
    }
  }

  const deltaLp = L2 - L1;
  const deltaCp = c2p - c1p;
  const deltaHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((deltahp / 2) * (Math.PI / 180));

  let avghp = 0;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) {
      avghp = (h1p + h2p) / 2;
    } else if (h1p + h2p < 360) {
      avghp = (h1p + h2p + 360) / 2;
    } else {
      avghp = (h1p + h2p - 360) / 2;
    }
  }

  const T = 1 - 0.17 * Math.cos((avghp - 30) * (Math.PI / 180))
            + 0.24 * Math.cos((2 * avghp) * (Math.PI / 180))
            + 0.32 * Math.cos((3 * avghp + 6) * (Math.PI / 180))
            - 0.20 * Math.cos((4 * avghp - 63) * (Math.PI / 180));

  const sl = 1 + ((0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2)));
  const sc = 1 + 0.045 * avgCp;
  const sh = 1 + 0.015 * avgCp * T;

  const deltaTheta = 30 * Math.exp(-Math.pow((avghp - 275) / 25, 2));
  const rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const rt = -Math.sin((2 * deltaTheta) * (Math.PI / 180)) * rc;

  const kl = 1, kc = 1, kh = 1;
  return Math.sqrt(
    Math.pow(deltaLp / (kl * sl), 2) +
    Math.pow(deltaCp / (kc * sc), 2) +
    Math.pow(deltaHp / (kh * sh), 2) +
    rt * (deltaCp / (kc * sc)) * (deltaHp / (kh * sh))
  );
}

/**
 * Classify absolute temperature (Warm / Cool / Neutral) by LCh hue and chroma,
 * and relative temperature vs the image's average hue.
 */
function classifyTemperature(C, h, imgAvgHue = null) {
  // Absolute temperature: neutral if chroma is low; warm is orange/red/magenta; cool is cyan/blue/green
  let temp = 'Neutral';
  if (C >= 5.0) {
    if ((h >= 0 && h <= 105) || (h >= 330 && h <= 360)) {
      temp = 'Warm';
    } else {
      temp = 'Cool';
    }
  }

  // Relative temperature: warmth metric W = cos(h - 50°) where 50° (orange-red) is maximally warm (+1)
  // and 230° (cyan-blue) is maximally cool (-1).
  let relTemp = 'Balanced';
  if (imgAvgHue !== null && !isNaN(imgAvgHue)) {
    const W_color = Math.cos(((h - 50) * Math.PI) / 180);
    const W_img = Math.cos(((imgAvgHue - 50) * Math.PI) / 180);
    const diff = W_color - W_img;
    if (diff > 0.08) {
      relTemp = 'Warmer than avg';
    } else if (diff < -0.08) {
      relTemp = 'Cooler than avg';
    } else {
      relTemp = 'Similar to avg';
    }
  } else {
    // Compare to neutral midpoint
    const W_color = Math.cos(((h - 50) * Math.PI) / 180);
    if (W_color > 0.1) relTemp = 'Warmer';
    else if (W_color < -0.1) relTemp = 'Cooler';
    else relTemp = 'Balanced';
  }

  return { temp, relTemp };
}

// Precomputed linear lookup table for 8-bit sRGB channels
const _srgbLinearLut = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  _srgbLinearLut[i] = srgbToLinear(i);
}

/**
 * Get band index [0..numBands - 1] for a CIELAB L* value [0..100]
 */
function getBandIndex(L, numBands = 3) {
  if (numBands <= 0) return 0;
  const clampedL = Math.max(0, Math.min(100, L));
  const bandWidth = 100 / numBands;
  const idx = Math.floor(clampedL / bandWidth);
  return Math.min(numBands - 1, Math.max(0, idx));
}

/**
 * Get standard human-readable band names for 3, 5, or 9 bands
 */
function getBandNames(numBands = 3) {
  if (numBands === 3) {
    return ['Darks', 'Midtones', 'Lights'];
  }
  if (numBands === 5) {
    return ['Deep Darks', 'Darks', 'Midtones', 'Lights', 'Highlights'];
  }
  if (numBands === 9) {
    return [
      'Band 1', 'Band 2', 'Band 3',
      'Band 4', 'Band 5', 'Band 6',
      'Band 7', 'Band 8', 'Band 9'
    ];
  }
  const names = [];
  for (let i = 1; i <= numBands; i++) {
    names.push(`Band ${i}`);
  }
  return names;
}

/**
 * Convert CIELAB L* (0..100) to representative neutral gray sRGB channel [0..255]
 */
function labLightnessToSrgbGray(L) {
  L = Math.max(0, Math.min(100, L));
  const eps = 216 / 24389;
  const kappa = 24389 / 27;
  let yr;
  if (L > 8) {
    const fy = (L + 16) / 116;
    yr = fy * fy * fy;
  } else {
    yr = L / kappa;
  }
  return linearToSrgb(yr);
}

/**
 * Get representative neutral midpoint gray colors for each value band
 */
function getBandColors(numBands = 3) {
  const colors = [];
  for (let k = 0; k < numBands; k++) {
    const L = ((k + 0.5) / numBands) * 100;
    const g = labLightnessToSrgbGray(L);
    const hex = '#' + [g, g, g].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    colors.push({
      r: g,
      g: g,
      b: g,
      hex,
      L
    });
  }
  return colors;
}

/**
 * Distribute integer percentages to guarantee sum === 100%
 * using the Hare-Niemeyer / Largest Remainder Method
 */
function calculateBandPercentages(counts) {
  if (!counts || counts.length === 0) return [];
  const total = counts.reduce((acc, c) => acc + c, 0);
  if (total === 0) {
    return new Array(counts.length).fill(0);
  }

  const rawPcts = counts.map(c => (c / total) * 100);
  const floors = rawPcts.map(p => Math.floor(p));
  const currentSum = floors.reduce((acc, f) => acc + f, 0);
  const remainderNeeded = 100 - currentSum;

  const remainders = rawPcts.map((p, idx) => ({
    idx,
    rem: p - floors[idx]
  }));

  remainders.sort((a, b) => b.rem - a.rem);

  const finalPcts = floors.slice();
  for (let i = 0; i < remainderNeeded; i++) {
    finalPcts[remainders[i % remainders.length].idx] += 1;
  }

  return finalPcts;
}

/**
 * Compute CIELAB L* value bands breakdown from ImageData
 */
function computeValueBands(imageData, numBands = 3) {
  numBands = [3, 5, 9].includes(numBands) ? numBands : 3;
  const counts = new Array(numBands).fill(0);
  const data = imageData && imageData.data ? imageData.data : [];
  const bandWidth = 100 / numBands;

  let totalValidPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue; // Skip transparent pixels

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const Y = 0.2126729 * _srgbLinearLut[r] + 0.7151522 * _srgbLinearLut[g] + 0.0721750 * _srgbLinearLut[b];
    const fy = Y > 0.00885645167 ? Math.cbrt(Y) : (903.296296 * Y + 16) / 116;
    const L = Math.max(0, Math.min(100, 116 * fy - 16));

    const bandIdx = Math.min(numBands - 1, Math.max(0, Math.floor(L / bandWidth)));
    counts[bandIdx]++;
    totalValidPixels++;
  }

  const percentages = calculateBandPercentages(counts);
  const names = getBandNames(numBands);
  const colors = getBandColors(numBands);

  const bands = [];
  for (let i = 0; i < numBands; i++) {
    const minL = i * bandWidth;
    const maxL = (i + 1) * bandWidth;
    bands.push({
      index: i,
      name: names[i],
      count: counts[i],
      percentage: percentages[i],
      color: colors[i],
      range: { min: Math.round(minL), max: Math.round(maxL) }
    });
  }

  return {
    numBands,
    totalPixels: totalValidPixels,
    counts,
    percentages,
    bands
  };
}

/**
 * Generate a strict, factual one-line note comparing sketch value coverage to reference
 * Note format: "your darks cover 12% more area" or "your darks cover 8% less area"
 * Strictly numbers and deltas; zero subjective or interpretive art-teaching commentary.
 */
function generateDeltaNote(refPcts, sketchPcts, numBands = 3) {
  if (!refPcts || !sketchPcts || refPcts.length === 0 || sketchPcts.length === 0) {
    return '';
  }

  const n = Math.min(refPcts.length, sketchPcts.length, numBands);
  if (n === 0) return '';

  let maxAbsDelta = -1;
  let bestIdx = -1;
  let bestDelta = 0;

  for (let i = 0; i < n; i++) {
    const delta = sketchPcts[i] - refPcts[i];
    const absDelta = Math.abs(delta);
    if (absDelta > maxAbsDelta) {
      maxAbsDelta = absDelta;
      bestIdx = i;
      bestDelta = delta;
    }
  }

  if (bestIdx === -1 || maxAbsDelta === 0) {
    return 'your values match the reference (0% difference)';
  }

  const names = getBandNames(n);
  const bandName = names[bestIdx].toLowerCase();
  const diff = Math.abs(bestDelta);

  if (bestDelta > 0) {
    return `your ${bandName} cover ${diff}% more area`;
  } else {
    return `your ${bandName} cover ${diff}% less area`;
  }
}

/**
 * Posterize an ImageData buffer to CIELAB L* representative band grays
 * Pure canvas pixel manipulation; zero SVG filters.
 */
function posterizeImageDataToBands(srcData, dstData, numBands = 3) {
  numBands = [3, 5, 9].includes(numBands) ? numBands : 3;
  const sData = srcData.data;
  const dData = dstData.data;
  const bandWidth = 100 / numBands;
  const bandColors = getBandColors(numBands);

  for (let i = 0; i < sData.length; i += 4) {
    const a = sData[i + 3];
    if (a < 128) {
      dData[i] = sData[i];
      dData[i + 1] = sData[i + 1];
      dData[i + 2] = sData[i + 2];
      dData[i + 3] = a;
      continue;
    }
    const r = sData[i];
    const g = sData[i + 1];
    const b = sData[i + 2];

    const Y = 0.2126729 * _srgbLinearLut[r] + 0.7151522 * _srgbLinearLut[g] + 0.0721750 * _srgbLinearLut[b];
    const fy = Y > 0.00885645167 ? Math.cbrt(Y) : (903.296296 * Y + 16) / 116;
    const L = Math.max(0, Math.min(100, 116 * fy - 16));
    const bandIdx = Math.min(numBands - 1, Math.max(0, Math.floor(L / bandWidth)));

    const rep = bandColors[bandIdx];
    dData[i] = rep.r;
    dData[i + 1] = rep.g;
    dData[i + 2] = rep.b;
    dData[i + 3] = 255;
  }
  return dstData;
}

// ==================== CIELAB LCh COLOR WHEEL & GAMUT MASK SCIENCE ====================

/**
 * Convert CIELAB LCh(ab) to sRGB {r, g, b} under D65
 */
function lchToSrgb(L, C, h) {
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const eps = 216 / 24389;
  const kappa = 24389 / 27;

  const xr = Math.pow(fx, 3) > eps ? Math.pow(fx, 3) : (116 * fx - 16) / kappa;
  const yr = L > 8 ? Math.pow(fy, 3) : L / kappa;
  const zr = Math.pow(fz, 3) > eps ? Math.pow(fz, 3) : (116 * fz - 16) / kappa;

  const X = xr * 0.95047;
  const Y = yr * 1.00000;
  const Z = zr * 1.08883;

  const rl =  3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const gl = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  const bl =  0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;

  return {
    r: linearToSrgb(Math.max(0, Math.min(1, rl))),
    g: linearToSrgb(Math.max(0, Math.min(1, gl))),
    b: linearToSrgb(Math.max(0, Math.min(1, bl)))
  };
}

/**
 * Map CIELAB Chroma C* and Hue h to canvas wheel coordinates (cx, cy, R)
 * Standard layout confirmed by user:
 * 0° Red (+a*, 3 o'clock / Right)
 * 90° Yellow (+b*, 12 o'clock / Top)
 * 180° Cyan (-a*, 9 o'clock / Left)
 * 270° Blue (-b*, 6 o'clock / Bottom)
 * radius = clamp(C* / maxChroma, 0, 1)
 */
function lchToWheelCoords(C, h, cx, cy, R, maxChroma = 120) {
  const rNorm = Math.min(1, Math.max(0, C / maxChroma));
  const rho = rNorm * R;
  const rad = (h * Math.PI) / 180;
  const x = cx + rho * Math.cos(rad);
  const y = cy - rho * Math.sin(rad); // screen Y is inverted relative to Cartesian
  return { x, y };
}

/**
 * Map canvas wheel coordinates back to CIELAB (C*, h)
 */
function wheelCoordsToLch(x, y, cx, cy, R, maxChroma = 120) {
  const dx = x - cx;
  const dy = cy - y;
  const rho = Math.sqrt(dx * dx + dy * dy);
  const rNorm = Math.min(1, rho / R);
  const C = rNorm * maxChroma;
  let h = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { C, h };
}

/**
 * Andrew's Monotone Chain 2D Convex Hull Algorithm
 * Returns the counter-clockwise convex polygon vertices for an array of 2D points [{x, y}, ...].
 */
function convexHull(points) {
  if (!points || points.length <= 1) return points ? points.slice() : [];

  // Sort primarily by x, secondarily by y
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  // Cross product of OA and OB vectors (> 0 for strictly CCW turn)
  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  // Build lower hull
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Build upper hull
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Pop duplicated end points
  lower.pop();
  upper.pop();

  // If all points were collinear or only single point remains
  if (lower.length === 0 && upper.length > 0) return upper;
  if (upper.length === 0 && lower.length > 0) return lower;
  return lower.concat(upper);
}

/**
 * Outlier filtering: retain dominant percentile (e.g. 90%) of points around geometric centroid
 */
function filterDominantPoints(points, percentile = 0.90) {
  if (!points || points.length <= 3) return points ? points.slice() : [];

  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;

  const withDist = points.map(p => ({
    p,
    d2: (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy)
  }));
  withDist.sort((a, b) => a.d2 - b.d2);

  const count = Math.max(3, Math.min(points.length, Math.ceil(points.length * percentile)));
  return withDist.slice(0, count).map(item => item.p);
}

/**
 * Ray Casting point-in-polygon test (Jordan curve theorem)
 * Returns true if point {x, y} lies inside polygon [{x, y}, ...]
 */
function isPointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  const x = point.x, y = point.y;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Compute drift score = percent of sketch pixels outside reference gamut mask polygon
 */
function calculateDriftScore(sketchPoints, polygon) {
  if (!sketchPoints || sketchPoints.length === 0 || !polygon || polygon.length < 3) {
    return 0;
  }
  let outsideCount = 0;
  for (const pt of sketchPoints) {
    if (!isPointInPolygon(pt, polygon)) {
      outsideCount++;
    }
  }
  return Math.round((outsideCount / sketchPoints.length) * 100);
}

/**
 * Compute ratio of mean sketch chroma to mean reference chroma
 */
function calculateMeanChromaRatio(refPoints, sketchPoints) {
  if (!refPoints || refPoints.length === 0 || !sketchPoints || sketchPoints.length === 0) {
    return 1.0;
  }
  const sumRef = refPoints.reduce((acc, p) => acc + (p.C !== undefined ? p.C : 0), 0);
  const sumSketch = sketchPoints.reduce((acc, p) => acc + (p.C !== undefined ? p.C : 0), 0);
  const meanRef = sumRef / refPoints.length;
  const meanSketch = sumSketch / sketchPoints.length;

  if (meanRef <= 0.001) return 1.0;
  return parseFloat((meanSketch / meanRef).toFixed(2));
}

/**
 * Spatial 2D grid binning for density-weighted dot scatter plot
 */
function binPoints(points, binSize = 4) {
  if (!points || points.length === 0) return [];
  const bins = new Map();
  let maxCount = 0;

  for (const p of points) {
    const bx = Math.floor(p.x / binSize);
    const by = Math.floor(p.y / binSize);
    const key = `${bx}_${by}`;
    let bin = bins.get(key);
    if (!bin) {
      bin = { sumX: 0, sumY: 0, sumR: 0, sumG: 0, sumB: 0, count: 0 };
      bins.set(key, bin);
    }
    bin.sumX += p.x;
    bin.sumY += p.y;
    bin.sumR += (p.r || 0);
    bin.sumG += (p.g || 0);
    bin.sumB += (p.b || 0);
    bin.count++;
    if (bin.count > maxCount) maxCount = bin.count;
  }

  const result = [];
  for (const bin of bins.values()) {
    result.push({
      x: bin.sumX / bin.count,
      y: bin.sumY / bin.count,
      r: Math.round(bin.sumR / bin.count),
      g: Math.round(bin.sumG / bin.count),
      b: Math.round(bin.sumB / bin.count),
      count: bin.count,
      dotRadius: Math.min(5.5, 1.2 + Math.log2(bin.count + 1) * 0.55),
      dotAlpha: Math.min(0.9, 0.28 + (bin.count / maxCount) * 0.62)
    });
  }
  return result;
}

const ColorPaletteManager = {
  hudOpen: false,
  eyedropperActive: false,
  isMinimized: false,
  customPos: null,
  dominantColors: [],
  sampledColors: [],
  activeColor: null,
  sampleSize: 1, // 1, 3, 5, or 11
  valueMode: 'percent', // 'percent' (0-100) or 'munsell' (0-10)
  imageAvgHue: null,
  deltaEMethod: 'CIEDE2000', // We use CIEDE2000 for perceptually uniform swatch merging
  deltaEThreshold: 11.0,
  lastExtractionTimeMs: 0,
  _offscreenCanvas: null,
  _offscreenCtx: null,
  _thumbCanvas: null,
  _thumbCtx: null,
  valueMapActiveTab: 'harmony', // 'harmony' or 'valuemap'
  valueMapBands: 3, // 3, 5, or 9
  valueMapOverlayActive: false,
  valueMapCompareSketch: false,
  valueMapRefResult: null,
  valueMapSketchResult: null,
  _valCanvas: null,
  _valCtx: null,
  _sketchValCanvas: null,
  _sketchValCtx: null,
  gamutMaskVertices: [],
  gamutMaskRawHull: [],
  gamutRefPoints: [],
  gamutSketchPoints: [],
  gamutRefDensityBins: [],
  gamutSketchDensityBins: [],
  gamutDriftScore: null,
  gamutChromaRatio: null,
  draggedVertexIndex: -1,
  hoveredVertexIndex: -1,
  _wheelCanvas: null,
  _wheelCtx: null,
  _wheelBgCanvas: null,
  _wheelBgCtx: null,
  _wheelSampleCanvas: null,
  _wheelSampleCtx: null,

  get isOpen() {
    return this.hudOpen;
  },

  init() {
    this.loadSettings();

    if (typeof document !== 'undefined') {
      // Reusable offscreen canvas for eyedropper sampling (preserves sRGB decoding)
      this._offscreenCanvas = document.createElement('canvas');
      this._offscreenCtx = this._offscreenCanvas.getContext('2d', { willReadFrequently: true });

      // Reusable 80x80 thumbnail canvas for dominant palette extraction
      this._thumbCanvas = document.createElement('canvas');
      this._thumbCanvas.width = 80;
      this._thumbCanvas.height = 80;
      this._thumbCtx = this._thumbCanvas.getContext('2d', { willReadFrequently: true });

      this.setupDraggable();
      this.bindEvents();
      this.updateUIModes();
      this.initGamutWheel();
    }
  },

  loadSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        const savedMode = localStorage.getItem('art_palette_value_mode');
        if (savedMode === 'percent' || savedMode === 'munsell') {
          this.valueMode = savedMode;
        }
        const savedSize = parseInt(localStorage.getItem('art_palette_sample_size'), 10);
        if ([1, 3, 5, 11].includes(savedSize)) {
          this.sampleSize = savedSize;
        }
        const savedBands = parseInt(localStorage.getItem('art_palette_valuemap_bands'), 10);
        if ([3, 5, 9].includes(savedBands)) {
          this.valueMapBands = savedBands;
        }
      }
    } catch (e) {}
  },

  updateUIModes() {
    if (typeof document === 'undefined') return;
    // Reflect sample size in button group
    const sizeButtons = document.querySelectorAll('.btn-sample-size');
    sizeButtons.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === this.sampleSize);
    });

    // Reflect Munsell value mode
    const munsellBtn = document.getElementById('btn-toggle-munsell');
    const munsellLabel = document.getElementById('munsell-btn-label');
    if (munsellLabel) {
      munsellLabel.textContent = this.valueMode === 'munsell' ? 'Munsell (0-10)' : 'Value (L*) %';
    }
    if (munsellBtn) {
      munsellBtn.classList.toggle('active', this.valueMode === 'munsell');
    }

    // Reflect Value Map bands
    const bandButtons = document.querySelectorAll('.btn-val-bands');
    bandButtons.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.bands, 10) === this.valueMapBands);
    });
  },

  setValueMode(mode) {
    if (mode !== 'percent' && mode !== 'munsell') return;
    this.valueMode = mode;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('art_palette_value_mode', mode);
      }
    } catch (e) {}

    this.updateUIModes();

    if (this.activeColor) {
      this.setActiveColor(this.activeColor);
    }
    this.renderDominantSwatches();
    this.renderSampledSwatches();

    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  },

  toggleValueMode() {
    this.setValueMode(this.valueMode === 'percent' ? 'munsell' : 'percent');
  },

  setSampleSize(size) {
    size = parseInt(size, 10);
    if (![1, 3, 5, 11].includes(size)) return;
    this.sampleSize = size;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('art_palette_sample_size', size);
      }
    } catch (e) {}

    const sizeButtons = document.querySelectorAll('.btn-sample-size');
    sizeButtons.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === size);
    });

    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  },

  getDisplayValue(color) {
    if (!color) return '';
    if (this.valueMode === 'munsell') {
      const mv = color.munsell !== undefined ? color.munsell : (color.L / 10);
      return Number(mv).toFixed(1);
    }
    const val = color.val !== undefined ? color.val : Math.round(color.L);
    return `${val}%`;
  },

  setupDraggable() {
    const hud = document.getElementById('palette-extraction-hud');
    if (!hud) return;
    const header = hud.querySelector('.palette-hud-header');
    if (!header) return;

    if (typeof FloatingWindowManager !== 'undefined' && FloatingWindowManager.makeDraggable) {
      FloatingWindowManager.makeDraggable(hud, header, {
        onEnd: (pos) => {
          this.customPos = pos;
        }
      });
    }
  },

  toggleMinimize(forceState = null) {
    const next = forceState !== null ? forceState : !this.isMinimized;
    this.isMinimized = next;
    const hud = document.getElementById('palette-extraction-hud');
    const btnMin = document.getElementById('btn-min-palette-hud');
    if (hud) hud.classList.toggle('minimized', this.isMinimized);
    if (btnMin) {
      btnMin.title = this.isMinimized ? 'Expand Palette HUD' : 'Minimize Palette HUD';
      btnMin.innerHTML = this.isMinimized
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    }
    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  },

  bindEvents() {
    // Toolbar button to toggle palette HUD
    const btnPalette = document.getElementById('btn-art-palette');
    if (btnPalette) {
      btnPalette.addEventListener('click', () => this.toggleHUD());
    }

    // Close HUD button
    const btnClose = document.getElementById('btn-close-palette-hud');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.toggleHUD(false));
    }

    // Minimize HUD button
    const btnMin = document.getElementById('btn-min-palette-hud');
    if (btnMin) {
      btnMin.addEventListener('click', () => this.toggleMinimize());
    }

    // Toggle Eyedropper button inside HUD
    const btnEyedropper = document.getElementById('btn-toggle-eyedropper');
    if (btnEyedropper) {
      btnEyedropper.addEventListener('click', () => this.toggleEyedropper());
    }

    // Sample size selector buttons (1px, 3x3, 5x5, 11x11)
    const sizeButtons = document.querySelectorAll('.btn-sample-size');
    sizeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setSampleSize(btn.dataset.size);
      });
    });

    // Munsell value toggle button
    const btnMunsell = document.getElementById('btn-toggle-munsell');
    if (btnMunsell) {
      btnMunsell.addEventListener('click', () => this.toggleValueMode());
    }

    // Copy HEX button (default action)
    const btnCopyHex = document.getElementById('btn-copy-inspector-hex');
    if (btnCopyHex) {
      btnCopyHex.addEventListener('click', () => this.copyActiveHex());
    }
    const inspectorHex = document.getElementById('inspector-hex');
    if (inspectorHex) {
      inspectorHex.addEventListener('click', () => this.copyActiveHex());
    }

    // Copy format dropdown trigger & menu items (HEX, RGB, HSB, Lab)
    const btnMenuTrigger = document.getElementById('btn-copy-menu-trigger');
    if (btnMenuTrigger) {
      btnMenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleCopyMenu();
      });
    }

    const copyItems = document.querySelectorAll('.palette-copy-item');
    copyItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const fmt = item.dataset.format || 'hex';
        this.copyColor(fmt);
      });
    });

    // Dismiss copy menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.copy-dropdown-group')) {
        this.hideCopyMenu();
      }
    });

    // Clear sampled colors
    const btnClearSampled = document.getElementById('btn-clear-sampled-colors');
    if (btnClearSampled) {
      btnClearSampled.addEventListener('click', () => this.clearSampled());
    }

    // Stage pointer events for live eyedropper
    const stage = document.getElementById('image-stage');
    if (stage) {
      stage.addEventListener('pointermove', (e) => this.onStagePointerMove(e));
      stage.addEventListener('pointerleave', () => this.onStagePointerLeave());
      stage.addEventListener('click', (e) => this.onStageClick(e));
    }

    // Palette HUD Tab Switcher (Palette & Harmony vs Value Map)
    const tabHarmony = document.getElementById('tab-palette-harmony');
    if (tabHarmony) {
      tabHarmony.addEventListener('click', () => this.setActiveTab('harmony'));
    }
    const tabValueMap = document.getElementById('tab-palette-valuemap');
    if (tabValueMap) {
      tabValueMap.addEventListener('click', () => this.setActiveTab('valuemap'));
    }

    // Value Map bands buttons (3, 5, 9)
    const valBandButtons = document.querySelectorAll('.btn-val-bands');
    valBandButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setValueMapBands(btn.dataset.bands);
      });
    });

    // Value Map overlay toggle
    const btnValOverlay = document.getElementById('btn-toggle-valuemap-overlay');
    if (btnValOverlay) {
      btnValOverlay.addEventListener('click', () => this.toggleValueMapOverlay());
    }

    // Value Map compare sketch toggle
    const btnCompare = document.getElementById('btn-toggle-sketch-compare');
    if (btnCompare) {
      btnCompare.addEventListener('click', () => this.toggleSketchCompare());
    }

    // Gamut Mask tab
    const tabGamut = document.getElementById('tab-palette-gamut');
    if (tabGamut) {
      tabGamut.addEventListener('click', () => this.setActiveTab('gamut'));
    }

    // Reset Gamut Mask button
    const btnResetGamut = document.getElementById('btn-reset-gamut-mask');
    if (btnResetGamut) {
      btnResetGamut.addEventListener('click', () => this.resetGamutMask());
    }
  },

  toggleCopyMenu(forceState = null) {
    const menu = document.getElementById('palette-copy-menu');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    const next = forceState !== null ? forceState : isHidden;
    menu.classList.toggle('hidden', !next);
  },

  hideCopyMenu() {
    const menu = document.getElementById('palette-copy-menu');
    if (menu) menu.classList.add('hidden');
  },

  copyColor(format = 'hex') {
    if (!this.activeColor) return;
    let textToCopy = this.activeColor.hex;
    if (format === 'rgb') textToCopy = this.activeColor.rgbStr;
    else if (format === 'hsb') textToCopy = this.activeColor.hsbStr;
    else if (format === 'lab') textToCopy = this.activeColor.labStr;

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        this.showCopiedFeedback(format.toUpperCase());
        if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
      }).catch(() => {});
    }
    this.hideCopyMenu();
  },

  copyActiveHex() {
    this.copyColor('hex');
  },

  showCopiedFeedback(label = 'HEX') {
    const btn = document.getElementById('btn-copy-inspector-hex');
    const labelEl = document.getElementById('copy-btn-label');
    if (btn) {
      const origText = labelEl ? labelEl.textContent : 'Copy';
      if (labelEl) labelEl.textContent = `Copied ${label}!`;
      btn.classList.add('copied');
      setTimeout(() => {
        if (labelEl) labelEl.textContent = origText;
        btn.classList.remove('copied');
      }, 1200);
    }
  },

  toggleHUD(forceState = null) {
    const next = forceState !== null ? forceState : !this.hudOpen;
    this.hudOpen = next;
    const hud = document.getElementById('palette-extraction-hud');
    const btn = document.getElementById('btn-art-palette');
    if (hud) {
      hud.classList.toggle('hidden', !this.hudOpen);
      hud.classList.toggle('minimized', this.isMinimized);
      if (this.hudOpen && this.customPos) {
        hud.classList.add('is-positioned');
        hud.style.left = `${this.customPos.left}px`;
        hud.style.top = `${this.customPos.top}px`;
        hud.style.right = 'auto';
        hud.style.transform = 'none';
      }
    }
    if (btn) btn.classList.toggle('active', this.hudOpen);

    if (this.hudOpen) {
      if (typeof SoundFX !== 'undefined' && SoundFX.toolToggle) SoundFX.toolToggle();
      if (hud && typeof FloatingWindowManager !== 'undefined' && FloatingWindowManager.bringToFront) {
        FloatingWindowManager.bringToFront(hud);
      }
      const img = document.getElementById('session-image');
      if (img && img.complete && img.naturalWidth > 0) {
        if (this.dominantColors.length === 0) {
          this.extractPalette(img);
        }
        this.updateValueMapUI();
        this.updateGamutMaskUI();
      }
    } else {
      if (this.eyedropperActive) {
        this.toggleEyedropper(false);
      }
      this.hideCopyMenu();
    }
  },

  toggleEyedropper(forceState = null) {
    const next = forceState !== null ? forceState : !this.eyedropperActive;
    this.eyedropperActive = next;
    const btn = document.getElementById('btn-toggle-eyedropper');
    const label = document.getElementById('eyedropper-btn-label');
    const stage = document.getElementById('image-stage');

    if (btn) btn.classList.toggle('active', this.eyedropperActive);
    if (label) label.textContent = this.eyedropperActive ? 'Eyedropper ON' : 'Eyedropper Off';
    if (stage) stage.classList.toggle('eyedropper-mode', this.eyedropperActive);

    if (typeof SoundFX !== 'undefined' && SoundFX.toolToggle) SoundFX.toolToggle();
    if (this.eyedropperActive) {
      if (!this.hudOpen) this.toggleHUD(true);
    } else {
      this.hideLoupe();
    }
  },

  onImageLoaded(imgEl) {
    this.dominantColors = [];
    this.extractPalette(imgEl);
    this.updateValueMapUI();
    this.gamutMaskVertices = []; // New image: recompute gamut mask
    this.updateGamutMaskUI();
    if (this.valueMapOverlayActive) {
      this.renderValueMapOverlay();
    }
    this.hideLoupe();
  },

  /**
   * Fast CIELAB dominant palette extraction:
   * 1. Reuses one offscreen canvas and downscales directly to 80x80.
   * 2. Computes image average hue (chroma-weighted circular mean).
   * 3. Partitions into candidate clusters via Median-Cut in Lab space.
   * 4. Merges swatches closer than Delta-E threshold using CIEDE2000 (ΔE < 11).
   * 5. Sorts dominant swatches by CIELAB L* (highlights to shadows).
   * 6. Execution completes well under 50 ms without blocking the UI thread.
   */
  extractPalette(imgEl) {
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return;

    const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const nw = imgEl.naturalWidth;
      const nh = imgEl.naturalHeight;

      // 1. Maintain reused offscreen canvas for eyedropper sampling (clamped to 1200px max)
      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(nw, nh));
      const cw = Math.max(10, Math.round(nw * scale));
      const ch = Math.max(10, Math.round(nh * scale));

      if (this._offscreenCanvas.width !== cw || this._offscreenCanvas.height !== ch) {
        this._offscreenCanvas.width = cw;
        this._offscreenCanvas.height = ch;
      }
      this._offscreenCtx.drawImage(imgEl, 0, 0, cw, ch);

      // 2. Downscale to small 80x80 buffer on reused thumbnail canvas
      if (this._thumbCanvas.width !== 80 || this._thumbCanvas.height !== 80) {
        this._thumbCanvas.width = 80;
        this._thumbCanvas.height = 80;
      }
      this._thumbCtx.drawImage(imgEl, 0, 0, 80, 80);
      const imgData = this._thumbCtx.getImageData(0, 0, 80, 80).data;

      // 3. Convert pixels to Lab and calculate average hue of image
      const labPixels = [];
      let sumSin = 0;
      let sumCos = 0;
      let chromaWeightSum = 0;

      for (let i = 0; i < imgData.length; i += 4) {
        const a = imgData[i + 3];
        if (a < 128) continue;
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];

        const lab = srgbToLab(r, g, b);
        const lch = labToLCh(lab.L, lab.a, lab.b);
        labPixels.push({
          L: lab.L,
          a: lab.a,
          b: lab.b,
          r, g, b_val: b,
          C: lch.C,
          h: lch.h
        });

        // Chroma-weighted circular mean for image's dominant tone
        if (lch.C >= 4.0) {
          const rad = (lch.h * Math.PI) / 180;
          sumSin += lch.C * Math.sin(rad);
          sumCos += lch.C * Math.cos(rad);
          chromaWeightSum += lch.C;
        }
      }

      if (chromaWeightSum > 0 && Math.sqrt(sumSin * sumSin + sumCos * sumCos) > 0.01) {
        let avgHue = Math.atan2(sumSin, sumCos) * (180 / Math.PI);
        if (avgHue < 0) avgHue += 360;
        this.imageAvgHue = Math.round(avgHue);
      } else {
        this.imageAvgHue = null; // Achromatic / neutral image
      }

      if (labPixels.length === 0) return;

      // 4. Cluster colors using Median-Cut in Lab space (target 12 candidate boxes)
      const candidateClusters = this.medianCutLab(labPixels, 12);

      // 5. Merge clusters closer than Delta-E threshold using CIEDE2000 (ΔE < 11.0)
      const mergedSwatches = this.mergeClusters(candidateClusters, this.deltaEThreshold, 7);

      // 6. Format swatches and sort by perceptual L* (highlights to shadows)
      const swatches = mergedSwatches.map(c => this.formatColor(c.r, c.g, c.b, this.imageAvgHue));
      swatches.sort((a, b) => b.L - a.L);

      this.dominantColors = swatches;
      this.renderDominantSwatches();

      if (swatches.length > 0 && !this.activeColor) {
        this.setActiveColor(swatches[0]);
      }
    } catch (e) {
      console.warn('Dominant palette extraction failed:', e);
    } finally {
      const tEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.lastExtractionTimeMs = tEnd - tStart;
      console.log(`[ColorPaletteManager] Extraction completed in ${this.lastExtractionTimeMs.toFixed(2)} ms`);
    }
  },

  /**
   * Median-Cut clustering in CIELAB space
   */
  medianCutLab(pixels, targetBoxes = 12) {
    if (!pixels || pixels.length === 0) return [];
    let boxes = [pixels];

    while (boxes.length < targetBoxes) {
      let bestBoxIdx = -1;
      let maxRange = -1;
      let splitChannel = 'L';

      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.length < 2) continue;

        let minL = 100, maxL = 0;
        let minA = 128, maxA = -128;
        let minB = 128, maxB = -128;

        for (let j = 0; j < box.length; j++) {
          const p = box[j];
          if (p.L < minL) minL = p.L;
          if (p.L > maxL) maxL = p.L;
          if (p.a < minA) minA = p.a;
          if (p.a > maxA) maxA = p.a;
          if (p.b < minB) minB = p.b;
          if (p.b > maxB) maxB = p.b;
        }

        const rangeL = maxL - minL;
        const rangeA = maxA - minA;
        const rangeB = maxB - minB;
        const mRange = Math.max(rangeL, rangeA, rangeB);

        if (mRange > maxRange) {
          maxRange = mRange;
          bestBoxIdx = i;
          if (mRange === rangeL) splitChannel = 'L';
          else if (mRange === rangeA) splitChannel = 'a';
          else splitChannel = 'b';
        }
      }

      if (bestBoxIdx === -1 || maxRange <= 0.001) break;

      const boxToSplit = boxes[bestBoxIdx];
      boxToSplit.sort((p1, p2) => p1[splitChannel] - p2[splitChannel]);
      const medianIdx = Math.floor(boxToSplit.length / 2);
      boxes.splice(bestBoxIdx, 1, boxToSplit.slice(0, medianIdx), boxToSplit.slice(medianIdx));
    }

    return boxes.map(box => {
      let sumL = 0, sumA = 0, sumB = 0;
      let sumR = 0, sumG = 0, sumBch = 0;
      for (const p of box) {
        sumL += p.L; sumA += p.a; sumB += p.b;
        sumR += p.r; sumG += p.g; sumBch += (p.b_val !== undefined ? p.b_val : p.b);
      }
      const count = box.length;
      return {
        count,
        L: sumL / count,
        a: sumA / count,
        b: sumB / count,
        r: Math.round(sumR / count),
        g: Math.round(sumG / count),
        b: Math.round(sumBch / count)
      };
    });
  },

  /**
   * Agglomerative Delta-E cluster merging (CIEDE2000 or CIE76)
   */
  mergeClusters(clusters, deltaEThreshold = 11.0, maxSwatches = 7) {
    if (!clusters || clusters.length === 0) return [];
    let list = clusters.slice();

    const deFn = this.deltaEMethod === 'CIE76' ? deltaE76 : deltaE2000;

    while (list.length > 1) {
      let minDE = Infinity;
      let bestI = -1, bestJ = -1;

      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const dE = deFn(list[i], list[j]);
          if (dE < minDE) {
            minDE = dE;
            bestI = i;
            bestJ = j;
          }
        }
      }

      // Merge clusters if closer than threshold, or if we need to reduce count to maxSwatches
      if (minDE < deltaEThreshold || list.length > maxSwatches) {
        const c1 = list[bestI];
        const c2 = list[bestJ];
        const count = c1.count + c2.count;
        const merged = {
          count,
          L: (c1.L * c1.count + c2.L * c2.count) / count,
          a: (c1.a * c1.count + c2.a * c2.count) / count,
          b: (c1.b * c1.count + c2.b * c2.count) / count,
          r: Math.round((c1.r * c1.count + c2.r * c2.count) / count),
          g: Math.round((c1.g * c1.count + c2.g * c2.count) / count),
          b: Math.round((c1.b * c1.count + c2.b * c2.count) / count)
        };
        list.splice(bestJ, 1);
        list.splice(bestI, 1, merged);
      } else {
        break;
      }
    }

    return list;
  },

  /**
   * Compute formatted color metadata including CIELAB L*, Munsell Value, HSB, LCh, and temperatures
   */
  formatColor(r, g, b, imgAvgHue = null) {
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));

    const hex = '#' + [r, g, b].map(x => {
      const h = x.toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('').toUpperCase();

    // CIELAB L*, a*, b* (sRGB -> linear -> XYZ D65 -> Lab)
    const { L, a, b: bVal } = srgbToLab(r, g, b);
    const { C, h } = labToLCh(L, a, bVal);

    // Lightness value % (0-100)
    const valPercent = Math.round(L);
    // Munsell value (0-10) derived from L*
    const munsellVal = Math.max(0, Math.min(10, parseFloat((L / 10).toFixed(1))));

    // HSB
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const delta = max - min;

    let hsbH = 0;
    if (delta > 0) {
      if (max === rf) {
        hsbH = ((gf - bf) / delta) % 6;
      } else if (max === gf) {
        hsbH = (bf - rf) / delta + 2;
      } else {
        hsbH = (rf - gf) / delta + 4;
      }
      hsbH = Math.round(hsbH * 60);
      if (hsbH < 0) hsbH += 360;
    }

    const hsbS = max === 0 ? 0 : Math.round((delta / max) * 100);
    const hsbB = Math.round(max * 100);

    // Temperature classification by LCh hue and chroma
    const avgHue = imgAvgHue !== null ? imgAvgHue : this.imageAvgHue;
    const { temp, relTemp } = classifyTemperature(C, h, avgHue);

    // Formatted strings
    const rgbStr = `rgb(${r}, ${g}, ${b})`;
    const hsbStr = `hsb(${hsbH}°, ${hsbS}%, ${hsbB}%)`;
    const labStr = `Lab(${L.toFixed(1)}, ${a.toFixed(1)}, ${bVal.toFixed(1)})`;

    return {
      hex,
      r, g, b,
      L, a, bVal,
      C, h: Math.round(h),
      val: valPercent,
      munsell: munsellVal,
      hsbH, hsbS, hsbB,
      s: hsbS,
      bri: hsbB,
      temp,
      relTemp,
      rgbStr,
      hsbStr,
      labStr
    };
  },

  /**
   * Sample pixel neighborhood with box averaging (1x1, 3x3, 5x5, 11x11)
   */
  sampleAveraging(ctx, x, y, size = 1, maxW = null, maxH = null) {
    const cw = maxW || (ctx && ctx.canvas ? ctx.canvas.width : 100);
    const ch = maxH || (ctx && ctx.canvas ? ctx.canvas.height : 100);

    const half = Math.floor(size / 2);
    const x0 = Math.max(0, Math.min(cw - 1, x - half));
    const x1 = Math.max(0, Math.min(cw - 1, x + half));
    const y0 = Math.max(0, Math.min(ch - 1, y - half));
    const y1 = Math.max(0, Math.min(ch - 1, y + half));
    const w = Math.max(1, x1 - x0 + 1);
    const h = Math.max(1, y1 - y0 + 1);

    if (!ctx) return { r: 0, g: 0, b: 0 };
    const data = ctx.getImageData(x0, y0, w, h).data;
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      count++;
    }
    if (count === 0) return { r: 0, g: 0, b: 0 };
    return {
      r: Math.round(sumR / count),
      g: Math.round(sumG / count),
      b: Math.round(sumB / count)
    };
  },

  renderDominantSwatches() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('palette-dominant-swatches');
    if (!container) return;

    if (this.dominantColors.length === 0) {
      container.innerHTML = '<span class="palette-empty-sampled-hint">Analyzing image lighting...</span>';
      return;
    }

    container.innerHTML = this.dominantColors.map((color, idx) => {
      const displayVal = this.getDisplayValue(color);
      const titleEsc = typeof UI !== 'undefined' && UI._esc
        ? UI._esc(`${color.hex} • ${displayVal} • ${color.temp} (${color.relTemp})`)
        : `${color.hex} • ${displayVal} • ${color.temp}`;
      return `
        <div class="palette-swatch-chip" style="background-color: ${color.hex}" data-idx="${idx}" title="${titleEsc}">
          <span class="swatch-value-tag">${displayVal}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.palette-swatch-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = parseInt(chip.dataset.idx, 10);
        if (this.dominantColors[idx]) {
          this.setActiveColor(this.dominantColors[idx]);
          this.copyActiveHex();
        }
      });
    });
  },

  setActiveColor(color) {
    if (!color) return;
    this.activeColor = color;
    if (typeof document === 'undefined') return;

    const prevBox = document.getElementById('inspector-preview-color');
    const badge = document.getElementById('inspector-temp-badge');
    const hex = document.getElementById('inspector-hex');
    const val = document.getElementById('inspector-val-lightness');
    const valLabel = document.getElementById('inspector-metric-label-val');
    const hue = document.getElementById('inspector-val-hue');
    const sat = document.getElementById('inspector-val-sat');
    const bri = document.getElementById('inspector-val-bri');
    const chroma = document.getElementById('inspector-val-chroma');
    const lab = document.getElementById('inspector-val-lab');
    const rgb = document.getElementById('inspector-val-rgb');

    if (prevBox) prevBox.style.backgroundColor = color.hex;
    if (badge) {
      badge.textContent = `${color.temp} • ${color.relTemp}`;
      badge.className = `inspector-temp-badge ${color.temp.toLowerCase()}`;
      badge.title = `LCh Hue: ${color.h}°, Chroma: ${color.C.toFixed(1)} | Relative to image avg: ${color.relTemp}`;
    }
    if (hex) hex.textContent = color.hex;
    if (valLabel) {
      valLabel.textContent = this.valueMode === 'munsell' ? 'Munsell Value' : 'Value (L*)';
    }
    if (val) {
      val.textContent = this.valueMode === 'munsell' ? `${color.munsell} / 10` : `${color.val}%`;
    }
    if (hue) hue.textContent = `${color.hsbH !== undefined ? color.hsbH : color.h}°`;
    if (sat) sat.textContent = `${color.hsbS !== undefined ? color.hsbS : color.s}%`;
    if (bri) bri.textContent = `${color.hsbB !== undefined ? color.hsbB : color.bri}%`;
    if (chroma) chroma.textContent = color.C !== undefined ? color.C.toFixed(1) : '0';
    if (lab) lab.textContent = `${color.L.toFixed(1)}, ${color.a.toFixed(1)}, ${color.bVal.toFixed(1)}`;
    if (rgb) rgb.textContent = color.rgbStr;

    // Update copy dropdown menu preview labels
    const menuHex = document.getElementById('menu-val-hex');
    const menuRgb = document.getElementById('menu-val-rgb');
    const menuHsb = document.getElementById('menu-val-hsb');
    const menuLab = document.getElementById('menu-val-lab');
    if (menuHex) menuHex.textContent = color.hex;
    if (menuRgb) menuRgb.textContent = color.rgbStr;
    if (menuHsb) menuHsb.textContent = color.hsbStr;
    if (menuLab) menuLab.textContent = color.labStr;
  },

  getPixelUnderCursor(clientX, clientY) {
    const stage = document.getElementById('image-stage');
    const frame = document.getElementById('image-frame');
    const img = document.getElementById('session-image');
    if (!stage || !frame || !img || !img.naturalWidth || !this._offscreenCanvas.width) return null;

    const stageRect = stage.getBoundingClientRect();
    const cx = stageRect.left + stageRect.width / 2 + (typeof ArtistToolbox !== 'undefined' ? (ArtistToolbox.panX || 0) : 0);
    const cy = stageRect.top + stageRect.height / 2 + (typeof ArtistToolbox !== 'undefined' ? (ArtistToolbox.panY || 0) : 0);

    const dx = clientX - cx;
    const dy = clientY - cy;

    const zoom = (typeof ArtistToolbox !== 'undefined' && ArtistToolbox.zoom) || 1;
    const flipX = (typeof ArtistToolbox !== 'undefined' && ArtistToolbox.flipX) || 1;
    const rotateTotal = (typeof ArtistToolbox !== 'undefined' && ArtistToolbox.rotateTotal) || 0;

    const sx = dx / zoom;
    const sy = dy / zoom;

    const rad = (-rotateTotal * Math.PI) / 180;
    const rx = sx * Math.cos(rad) - sy * Math.sin(rad);
    const ry = sx * Math.sin(rad) + sy * Math.cos(rad);

    const fx = rx * flipX;
    const fy = ry;

    const frameW = frame.offsetWidth;
    const frameH = frame.offsetHeight;

    const frameX = fx + frameW / 2;
    const frameY = fy + frameH / 2;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const imgX = (frameX / frameW) * nw;
    const imgY = (frameY / frameH) * nh;

    if (imgX < 0 || imgX >= nw || imgY < 0 || imgY >= nh) return null;

    // Map to offscreen canvas dimensions
    const cw = this._offscreenCanvas.width;
    const ch = this._offscreenCanvas.height;
    const sx_c = Math.max(0, Math.min(cw - 1, Math.floor((imgX / nw) * cw)));
    const sy_c = Math.max(0, Math.min(ch - 1, Math.floor((imgY / nh) * ch)));

    try {
      const avg = this.sampleAveraging(this._offscreenCtx, sx_c, sy_c, this.sampleSize || 1, cw, ch);
      return this.formatColor(avg.r, avg.g, avg.b, this.imageAvgHue);
    } catch (e) {
      return null;
    }
  },

  onStagePointerMove(e) {
    if (!this.eyedropperActive) return;

    const color = this.getPixelUnderCursor(e.clientX, e.clientY);
    const loupe = document.getElementById('eyedropper-loupe');

    if (!color || !loupe) {
      this.hideLoupe();
      return;
    }

    // Position loupe offset from cursor
    loupe.classList.remove('hidden');
    const stage = document.getElementById('image-stage');
    const stageRect = stage.getBoundingClientRect();

    let lx = e.clientX - stageRect.left + 16;
    let ly = e.clientY - stageRect.top - 58;

    // Clamp within stage
    lx = Math.max(8, Math.min(stageRect.width - 180, lx));
    ly = Math.max(8, Math.min(stageRect.height - 70, ly));

    loupe.style.transform = `translate(${lx}px, ${ly}px)`;

    // Update loupe UI
    const circle = document.getElementById('loupe-swatch-circle');
    const badge = document.getElementById('loupe-temp-badge');
    const hex = document.getElementById('loupe-hex');
    const val = document.getElementById('loupe-val');
    const hue = document.getElementById('loupe-hue');
    const sat = document.getElementById('loupe-sat');
    const bri = document.getElementById('loupe-bri');
    const chroma = document.getElementById('loupe-chroma');

    if (circle) circle.style.backgroundColor = color.hex;
    if (badge) {
      badge.textContent = color.temp;
      badge.className = `loupe-temp-badge ${color.temp.toLowerCase()}`;
      badge.title = `${color.temp} (${color.relTemp})`;
    }
    if (hex) hex.textContent = color.hex;
    if (val) val.textContent = this.getDisplayValue(color);
    if (hue) hue.textContent = `${color.hsbH !== undefined ? color.hsbH : color.h}°`;
    if (sat) sat.textContent = `${color.hsbS !== undefined ? color.hsbS : color.s}%`;
    if (bri) bri.textContent = `${color.hsbB !== undefined ? color.hsbB : color.bri}%`;
    if (chroma) chroma.textContent = color.C !== undefined ? color.C.toFixed(1) : '0';

    // Also update inspector active color
    this.setActiveColor(color);
  },

  onStagePointerLeave() {
    this.hideLoupe();
  },

  hideLoupe() {
    const loupe = document.getElementById('eyedropper-loupe');
    if (loupe) loupe.classList.add('hidden');
  },

  onStageClick(e) {
    if (!this.eyedropperActive) return;

    const color = this.getPixelUnderCursor(e.clientX, e.clientY);
    if (!color) return;

    // Add to sampled list (max 12 swatches)
    this.sampledColors.unshift(color);
    if (this.sampledColors.length > 12) this.sampledColors.pop();

    this.renderSampledSwatches();
    this.setActiveColor(color);
    this.copyActiveHex();
    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  },

  renderSampledSwatches() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('palette-sampled-swatches');
    const clearBtn = document.getElementById('btn-clear-sampled-colors');
    if (!container) return;

    if (this.sampledColors.length === 0) {
      container.innerHTML = '<span class="palette-empty-sampled-hint">Turn on Live Eyedropper & click reference to sample custom swatches</span>';
      if (clearBtn) clearBtn.classList.add('hidden');
      return;
    }

    if (clearBtn) clearBtn.classList.remove('hidden');

    container.innerHTML = this.sampledColors.map((color, idx) => {
      const displayVal = this.getDisplayValue(color);
      const titleEsc = typeof UI !== 'undefined' && UI._esc
        ? UI._esc(`${color.hex} • ${displayVal} • ${color.temp} (${color.relTemp})`)
        : `${color.hex} • ${displayVal} • ${color.temp}`;
      return `
        <div class="sampled-chip" style="background-color: ${color.hex}" data-idx="${idx}" title="${titleEsc}">
          <span class="sampled-val">${displayVal}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.sampled-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(chip.dataset.idx, 10);
        if (this.sampledColors[idx]) {
          this.setActiveColor(this.sampledColors[idx]);
          this.copyActiveHex();
        }
      });
    });
  },

  clearSampled() {
    this.sampledColors = [];
    this.renderSampledSwatches();
    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  },

  // ==================== VALUE MAP METHODS ====================

  setActiveTab(tab) {
    if (tab !== 'harmony' && tab !== 'valuemap' && tab !== 'gamut') return;
    this.valueMapActiveTab = tab;

    if (typeof document !== 'undefined') {
      const tabHarm = document.getElementById('tab-palette-harmony');
      const tabVal = document.getElementById('tab-palette-valuemap');
      const tabGamut = document.getElementById('tab-palette-gamut');
      const viewHarm = document.getElementById('palette-view-harmony');
      const viewVal = document.getElementById('palette-view-valuemap');
      const viewGamut = document.getElementById('palette-view-gamut');

      if (tabHarm) tabHarm.classList.toggle('active', tab === 'harmony');
      if (tabVal) tabVal.classList.toggle('active', tab === 'valuemap');
      if (tabGamut) tabGamut.classList.toggle('active', tab === 'gamut');
      if (viewHarm) viewHarm.classList.toggle('hidden', tab !== 'harmony');
      if (viewVal) viewVal.classList.toggle('hidden', tab !== 'valuemap');
      if (viewGamut) viewGamut.classList.toggle('hidden', tab !== 'gamut');

      if (tab === 'valuemap') {
        this.updateValueMapUI();
      } else if (tab === 'gamut') {
        this.updateGamutMaskUI();
      }
    }
    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  },

  setValueMapBands(bands) {
    bands = parseInt(bands, 10);
    if (![3, 5, 9].includes(bands)) return;
    this.valueMapBands = bands;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('art_palette_valuemap_bands', bands);
      }
    } catch (e) {}

    if (typeof document !== 'undefined') {
      document.querySelectorAll('.btn-val-bands').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.bands, 10) === bands);
      });
    }

    this.updateValueMapUI();
    if (this.valueMapOverlayActive) {
      this.renderValueMapOverlay();
    }
    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  },

  toggleValueMapOverlay(forceState = null) {
    const next = forceState !== null ? forceState : !this.valueMapOverlayActive;
    this.valueMapOverlayActive = next;

    if (typeof document !== 'undefined') {
      const btn = document.getElementById('btn-toggle-valuemap-overlay');
      const label = document.getElementById('valuemap-overlay-btn-label');
      if (btn) btn.classList.toggle('active', this.valueMapOverlayActive);
      if (label) label.textContent = this.valueMapOverlayActive ? 'Overlay ON' : 'Overlay Map';
    }

    this.renderValueMapOverlay();
    if (typeof SoundFX !== 'undefined' && SoundFX.toolToggle) SoundFX.toolToggle();
  },

  toggleSketchCompare(forceState = null) {
    const next = forceState !== null ? forceState : !this.valueMapCompareSketch;
    this.valueMapCompareSketch = next;

    if (typeof document !== 'undefined') {
      const btn = document.getElementById('btn-toggle-sketch-compare');
      const label = document.getElementById('sketch-compare-btn-label');
      const section = document.getElementById('value-map-sketch-section');
      if (btn) btn.classList.toggle('active', this.valueMapCompareSketch);
      if (label) label.textContent = this.valueMapCompareSketch ? 'Compare ON' : 'Compare Sketch';
      if (section) section.classList.toggle('hidden', !this.valueMapCompareSketch);
    }

    if (this.valueMapCompareSketch) {
      this.updateValueMapUI();
    }
    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  },

  onSketchChanged() {
    if (this.valueMapCompareSketch) {
      this.updateValueMapUI();
    }
    this.updateGamutMaskUI();
  },

  renderStackedBar(containerId, bands) {
    if (typeof document === 'undefined') return;
    const barEl = document.getElementById(containerId);
    if (!barEl) return;

    if (!bands || bands.length === 0) {
      barEl.innerHTML = '';
      return;
    }

    barEl.innerHTML = bands.map(b => {
      const pct = b.percentage;
      if (pct <= 0) return '';
      // Contrast text color: white for dark bands L < 55, dark for light bands L >= 55
      const textColor = b.color.L < 55 ? '#FFFFFF' : '#111111';
      const showLabel = pct >= 8;
      const title = `${b.name}: ${pct}% (L* ${b.range.min}–${b.range.max})`;

      return `
        <div class="value-map-bar-segment" style="width: ${pct}%; background-color: ${b.color.hex};" title="${title}">
          ${showLabel ? `<span class="value-map-segment-label" style="color: ${textColor};">${pct}%</span>` : ''}
        </div>
      `;
    }).join('');
  },

  renderLegend(containerId, bands) {
    if (typeof document === 'undefined') return;
    const legendEl = document.getElementById(containerId);
    if (!legendEl) return;

    if (!bands || bands.length === 0) {
      legendEl.innerHTML = '';
      return;
    }

    legendEl.innerHTML = bands.map(b => {
      return `
        <div class="value-map-legend-item" title="${b.name}: ${b.percentage}%">
          <span class="value-map-legend-swatch" style="background-color: ${b.color.hex};"></span>
          <span class="value-map-legend-name">${b.name}</span>
          <span class="value-map-legend-range">(L* ${b.range.min}–${b.range.max})</span>
          <strong class="value-map-legend-pct">${b.percentage}%</strong>
        </div>
      `;
    }).join('');
  },

  updateValueMapUI() {
    if (typeof document === 'undefined') return;

    // 1. Analyze reference image
    const refImg = document.getElementById('session-image');
    if (refImg && refImg.complete && refImg.naturalWidth > 0) {
      if (!this._valCanvas) {
        this._valCanvas = document.createElement('canvas');
        this._valCanvas.width = 160;
        this._valCanvas.height = 160;
        this._valCtx = this._valCanvas.getContext('2d', { willReadFrequently: true });
      }
      try {
        this._valCtx.drawImage(refImg, 0, 0, 160, 160);
        const refData = this._valCtx.getImageData(0, 0, 160, 160);
        this.valueMapRefResult = computeValueBands(refData, this.valueMapBands);

        this.renderStackedBar('value-map-ref-bar', this.valueMapRefResult.bands);
        this.renderLegend('value-map-ref-legend', this.valueMapRefResult.bands);
      } catch (e) {
        console.warn('[ColorPaletteManager] Failed to analyze reference image values:', e);
      }
    }

    // 2. If sketch compare is active, analyze sketch
    if (this.valueMapCompareSketch) {
      const sketchImg = document.getElementById('sketch-overlay-img');
      const sketchContent = document.getElementById('value-map-sketch-content');
      const sketchEmpty = document.getElementById('value-map-sketch-empty');
      const deltaNote = document.getElementById('value-map-delta-note');

      const isSketchLoaded = sketchImg && sketchImg.src && sketchImg.complete && sketchImg.naturalWidth > 0;

      if (isSketchLoaded) {
        if (sketchContent) sketchContent.classList.remove('hidden');
        if (sketchEmpty) sketchEmpty.classList.add('hidden');

        if (!this._sketchValCanvas) {
          this._sketchValCanvas = document.createElement('canvas');
          this._sketchValCanvas.width = 160;
          this._sketchValCanvas.height = 160;
          this._sketchValCtx = this._sketchValCanvas.getContext('2d', { willReadFrequently: true });
        }
        try {
          this._sketchValCtx.clearRect(0, 0, 160, 160);
          this._sketchValCtx.drawImage(sketchImg, 0, 0, 160, 160);
          const sketchData = this._sketchValCtx.getImageData(0, 0, 160, 160);
          this.valueMapSketchResult = computeValueBands(sketchData, this.valueMapBands);

          this.renderStackedBar('value-map-sketch-bar', this.valueMapSketchResult.bands);
          this.renderLegend('value-map-sketch-legend', this.valueMapSketchResult.bands);

          // Compute and display factual one-line delta note
          if (this.valueMapRefResult && deltaNote) {
            const note = generateDeltaNote(
              this.valueMapRefResult.percentages,
              this.valueMapSketchResult.percentages,
              this.valueMapBands
            );
            deltaNote.textContent = note;
            deltaNote.classList.remove('hidden');
          }
        } catch (e) {
          console.warn('[ColorPaletteManager] Failed to analyze sketch values:', e);
        }
      } else {
        if (sketchContent) sketchContent.classList.add('hidden');
        if (sketchEmpty) sketchEmpty.classList.remove('hidden');
        if (deltaNote) deltaNote.classList.add('hidden');
      }
    }
  },

  renderValueMapOverlay() {
    if (typeof document === 'undefined') return;
    const canvas = document.getElementById('value-map-overlay-canvas');
    if (!canvas) return;

    if (!this.valueMapOverlayActive) {
      canvas.classList.add('hidden');
      return;
    }

    const img = document.getElementById('session-image');
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) {
      canvas.classList.add('hidden');
      return;
    }

    try {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const maxDim = 1920;
      const scale = Math.min(1, maxDim / Math.max(nw, nh));
      const cw = Math.max(10, Math.round(nw * scale));
      const ch = Math.max(10, Math.round(nh * scale));

      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, cw, ch);
      const imgData = ctx.getImageData(0, 0, cw, ch);
      posterizeImageDataToBands(imgData, imgData, this.valueMapBands);
      ctx.putImageData(imgData, 0, 0);

      canvas.classList.remove('hidden');
    } catch (e) {
      console.warn('[ColorPaletteManager] Failed to render value map overlay:', e);
    }

    if (typeof UI !== 'undefined' && UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  applyValueMapToContext(ctx, stageX, stageY, stageW, stageH, numBands = 3) {
    if (!ctx || stageW <= 0 || stageH <= 0) return;
    try {
      const imgData = ctx.getImageData(stageX, stageY, stageW, stageH);
      posterizeImageDataToBands(imgData, imgData, numBands);
      ctx.putImageData(imgData, stageX, stageY);
    } catch (e) {
      console.warn('[ColorPaletteManager] Failed to apply value map to context:', e);
    }
  },

  // ==================== GAMUT MASK METHODS ====================

  initGamutWheel() {
    if (typeof document === 'undefined') return;
    const canvas = document.getElementById('gamut-wheel-canvas');
    if (!canvas) return;
    this._wheelCanvas = canvas;
    this._wheelCtx = canvas.getContext('2d');

    // Create offscreen buffer for continuous wheel background (280x280)
    if (!this._wheelBgCanvas) {
      this._wheelBgCanvas = document.createElement('canvas');
      this._wheelBgCanvas.width = 280;
      this._wheelBgCanvas.height = 280;
      this._wheelBgCtx = this._wheelBgCanvas.getContext('2d');
      this.renderWheelBackground(this._wheelBgCtx, 140, 140, 120);
    }

    // Create reused 128x128 offscreen sampling canvas
    if (!this._wheelSampleCanvas) {
      this._wheelSampleCanvas = document.createElement('canvas');
      this._wheelSampleCanvas.width = 128;
      this._wheelSampleCanvas.height = 128;
      this._wheelSampleCtx = this._wheelSampleCanvas.getContext('2d', { willReadFrequently: true });
    }

    // Pointer events for dragging mask vertices
    canvas.addEventListener('pointerdown', (e) => this.onGamutPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onGamutPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onGamutPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onGamutPointerUp(e));
    canvas.addEventListener('pointerleave', (e) => this.onGamutPointerLeave(e));
  },

  renderWheelBackground(ctx, cx, cy, R) {
    if (!ctx) return;
    const imgData = ctx.createImageData(280, 280);
    const d = imgData.data;

    for (let py = 0; py < 280; py++) {
      for (let px = 0; px < 280; px++) {
        const dx = px - cx;
        const dy = cy - py; // standard cartesian (+y up)
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (py * 280 + px) * 4;

        if (dist <= R) {
          const rNorm = dist / R;
          const C = rNorm * 120;
          let h = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (h < 0) h += 360;

          const rgb = lchToSrgb(62, C, h);
          d[idx] = rgb.r;
          d[idx + 1] = rgb.g;
          d[idx + 2] = rgb.b;
          d[idx + 3] = 230;
        } else if (dist <= R + 1.5) {
          d[idx] = 40; d[idx + 1] = 40; d[idx + 2] = 40;
          d[idx + 3] = Math.round((R + 1.5 - dist) * 180);
        } else {
          d[idx + 3] = 0;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Subtle 12 radial sector lines (30 deg intervals)
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1;
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(rad), cy - R * Math.sin(rad));
      ctx.stroke();
    }

    // Concentric chroma rings (C* = 40, 80, 120)
    const ringRadii = [R * (40 / 120), R * (80 / 120), R];
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.setLineDash([2, 3]);
    for (let i = 0; i < ringRadii.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, ringRadii[i], 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // Cardinal sector labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R', cx + R - 10, cy);
    ctx.fillText('Y', cx, cy - R + 10);
    ctx.fillText('C', cx - R + 10, cy);
    ctx.fillText('B', cx, cy + R - 10);
    ctx.restore();
  },

  updateGamutMaskUI() {
    if (typeof document === 'undefined') return;
    if (!this._wheelCanvas) this.initGamutWheel();
    if (!this._wheelCanvas) return;

    const refImg = document.getElementById('session-image');
    if (!refImg || !refImg.complete || !refImg.naturalWidth) return;

    const cx = 140, cy = 140, R = 120;

    // 1. Downsample reference to 128x128
    if (!this._wheelSampleCanvas) {
      this._wheelSampleCanvas = document.createElement('canvas');
      this._wheelSampleCanvas.width = 128;
      this._wheelSampleCanvas.height = 128;
      this._wheelSampleCtx = this._wheelSampleCanvas.getContext('2d', { willReadFrequently: true });
    }
    this._wheelSampleCtx.clearRect(0, 0, 128, 128);
    this._wheelSampleCtx.drawImage(refImg, 0, 0, 128, 128);
    const refImgData = this._wheelSampleCtx.getImageData(0, 0, 128, 128).data;

    const refPoints = [];
    for (let i = 0; i < refImgData.length; i += 4) {
      if (refImgData[i + 3] < 128) continue;
      const r = refImgData[i];
      const g = refImgData[i + 1];
      const b = refImgData[i + 2];
      const lab = srgbToLab(r, g, b);
      const lch = labToLCh(lab.L, lab.a, lab.b);
      const pt = lchToWheelCoords(lch.C, lch.h, cx, cy, R, 120);
      refPoints.push({
        x: pt.x,
        y: pt.y,
        C: lch.C,
        h: lch.h,
        r, g, b
      });
    }
    this.gamutRefPoints = refPoints;
    this.gamutRefDensityBins = binPoints(refPoints, 4);

    // 2. Compute convex hull around dominant 90% of reference points
    const dominant = filterDominantPoints(refPoints, 0.90);
    const hull = convexHull(dominant);
    this.gamutMaskRawHull = hull;
    if (!this.gamutMaskVertices || this.gamutMaskVertices.length === 0) {
      this.gamutMaskVertices = hull.map(v => ({ x: v.x, y: v.y }));
    }

    // 3. Process sketch image if available
    const sketchImg = document.getElementById('sketch-overlay-img');
    const isSketchLoaded = sketchImg && sketchImg.src && sketchImg.complete && sketchImg.naturalWidth > 0;
    const emptyHint = document.getElementById('gamut-empty-sketch-hint');

    if (isSketchLoaded) {
      this._wheelSampleCtx.clearRect(0, 0, 128, 128);
      this._wheelSampleCtx.drawImage(sketchImg, 0, 0, 128, 128);
      const sketchImgData = this._wheelSampleCtx.getImageData(0, 0, 128, 128).data;

      const sketchPoints = [];
      for (let i = 0; i < sketchImgData.length; i += 4) {
        if (sketchImgData[i + 3] < 128) continue;
        const r = sketchImgData[i];
        const g = sketchImgData[i + 1];
        const b = sketchImgData[i + 2];
        const lab = srgbToLab(r, g, b);
        const lch = labToLCh(lab.L, lab.a, lab.b);
        const pt = lchToWheelCoords(lch.C, lch.h, cx, cy, R, 120);
        sketchPoints.push({
          x: pt.x,
          y: pt.y,
          C: lch.C,
          h: lch.h,
          r, g, b
        });
      }
      this.gamutSketchPoints = sketchPoints;
      this.gamutSketchDensityBins = binPoints(sketchPoints, 4);

      this.gamutDriftScore = calculateDriftScore(sketchPoints, this.gamutMaskVertices);
      this.gamutChromaRatio = calculateMeanChromaRatio(refPoints, sketchPoints);

      if (emptyHint) emptyHint.classList.add('hidden');
    } else {
      this.gamutSketchPoints = [];
      this.gamutSketchDensityBins = [];
      this.gamutDriftScore = null;
      this.gamutChromaRatio = null;
      if (emptyHint) emptyHint.classList.remove('hidden');
    }

    this.renderGamutWheel();
  },

  renderGamutWheel() {
    if (typeof document === 'undefined') return;
    if (!this._wheelCtx || !this._wheelCanvas) return;
    const ctx = this._wheelCtx;
    const w = this._wheelCanvas.width;
    const h = this._wheelCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // 1. Draw continuous background wheel
    if (this._wheelBgCanvas) {
      ctx.drawImage(this._wheelBgCanvas, 0, 0);
    }

    // 2. Draw density-weighted reference dots
    if (this.gamutRefDensityBins) {
      for (const b of this.gamutRefDensityBins) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${b.r}, ${b.g}, ${b.b}, ${b.dotAlpha})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // 3. Draw gamut mask polygon
    if (this.gamutMaskVertices && this.gamutMaskVertices.length >= 3) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.gamutMaskVertices[0].x, this.gamutMaskVertices[0].y);
      for (let i = 1; i < this.gamutMaskVertices.length; i++) {
        ctx.lineTo(this.gamutMaskVertices[i].x, this.gamutMaskVertices[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.0;
      ctx.stroke();
      ctx.restore();

      // Draw draggable vertex control handles
      for (let i = 0; i < this.gamutMaskVertices.length; i++) {
        const v = this.gamutMaskVertices[i];
        const isHover = (i === this.hoveredVertexIndex);
        const isDrag = (i === this.draggedVertexIndex);
        const radius = isDrag ? 6.5 : (isHover ? 5.5 : 4.0);

        ctx.beginPath();
        ctx.arc(v.x, v.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isDrag ? '#ffffff' : (isHover ? '#fef08a' : '#f59e0b');
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 4. Overlay sketch colors on same wheel (if available)
    if (this.gamutSketchDensityBins && this.gamutSketchDensityBins.length > 0) {
      for (const b of this.gamutSketchDensityBins) {
        const isInside = this.gamutMaskVertices && this.gamutMaskVertices.length >= 3
          ? isPointInPolygon(b, this.gamutMaskVertices)
          : true;

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.dotRadius + 0.5, 0, Math.PI * 2);
        if (isInside) {
          ctx.strokeStyle = '#38bdf8';
          ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
        } else {
          ctx.strokeStyle = '#ef4444';
          ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
        }
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
    }

    // 5. Update stats DOM readouts
    const driftEl = document.getElementById('gamut-drift-score');
    const chromaEl = document.getElementById('gamut-chroma-ratio');

    if (driftEl) {
      if (this.gamutDriftScore !== null && this.gamutDriftScore !== undefined) {
        driftEl.textContent = `${this.gamutDriftScore}%`;
        driftEl.style.color = this.gamutDriftScore > 20 ? '#ef4444' : (this.gamutDriftScore > 5 ? '#f59e0b' : '#10b981');
      } else {
        driftEl.textContent = '—';
        driftEl.style.color = '';
      }
    }
    if (chromaEl) {
      if (this.gamutChromaRatio !== null && this.gamutChromaRatio !== undefined) {
        chromaEl.textContent = `${this.gamutChromaRatio.toFixed(2)}×`;
      } else {
        chromaEl.textContent = '—';
      }
    }
  },

  onGamutPointerDown(e) {
    if (!this.gamutMaskVertices || this.gamutMaskVertices.length === 0) return;
    const rect = this._wheelCanvas.getBoundingClientRect();
    const scaleX = this._wheelCanvas.width / rect.width;
    const scaleY = this._wheelCanvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    let closestIdx = -1;
    let minD = 12;
    for (let i = 0; i < this.gamutMaskVertices.length; i++) {
      const v = this.gamutMaskVertices[i];
      const d = Math.hypot(v.x - px, v.y - py);
      if (d < minD) {
        minD = d;
        closestIdx = i;
      }
    }

    if (closestIdx !== -1) {
      this.draggedVertexIndex = closestIdx;
      try { this._wheelCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      this.renderGamutWheel();
    }
  },

  onGamutPointerMove(e) {
    if (!this._wheelCanvas) return;
    const rect = this._wheelCanvas.getBoundingClientRect();
    const scaleX = this._wheelCanvas.width / rect.width;
    const scaleY = this._wheelCanvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    if (this.draggedVertexIndex !== -1 && this.gamutMaskVertices[this.draggedVertexIndex]) {
      const cx = 140, cy = 140, R = 120;
      let dx = px - cx;
      let dy = py - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > R) {
        dx = (dx / dist) * R;
        dy = (dy / dist) * R;
      }
      this.gamutMaskVertices[this.draggedVertexIndex] = {
        x: cx + dx,
        y: cy + dy
      };

      if (this.gamutSketchPoints && this.gamutSketchPoints.length > 0) {
        this.gamutDriftScore = calculateDriftScore(this.gamutSketchPoints, this.gamutMaskVertices);
      }
      this.renderGamutWheel();
      return;
    }

    if (!this.gamutMaskVertices) return;
    let hovered = -1;
    for (let i = 0; i < this.gamutMaskVertices.length; i++) {
      const v = this.gamutMaskVertices[i];
      if (Math.hypot(v.x - px, v.y - py) <= 12) {
        hovered = i;
        break;
      }
    }
    if (this.hoveredVertexIndex !== hovered) {
      this.hoveredVertexIndex = hovered;
      this._wheelCanvas.style.cursor = hovered !== -1 ? 'grab' : 'default';
      this.renderGamutWheel();
    }
  },

  onGamutPointerUp(e) {
    if (this.draggedVertexIndex !== -1) {
      this.draggedVertexIndex = -1;
      try { this._wheelCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
      this.renderGamutWheel();
    }
  },

  onGamutPointerLeave(e) {
    if (this.draggedVertexIndex === -1 && this.hoveredVertexIndex !== -1) {
      this.hoveredVertexIndex = -1;
      if (this._wheelCanvas) this._wheelCanvas.style.cursor = 'default';
      this.renderGamutWheel();
    }
  },

  resetGamutMask() {
    if (!this.gamutMaskRawHull || this.gamutMaskRawHull.length === 0) return;
    this.gamutMaskVertices = this.gamutMaskRawHull.map(v => ({ x: v.x, y: v.y }));
    if (this.gamutSketchPoints && this.gamutSketchPoints.length > 0) {
      this.gamutDriftScore = calculateDriftScore(this.gamutSketchPoints, this.gamutMaskVertices);
    }
    this.renderGamutWheel();
    if (typeof SoundFX !== 'undefined' && SoundFX.click) SoundFX.click();
  }
};

ColorPaletteManager.getBandIndex = getBandIndex;
ColorPaletteManager.getBandNames = getBandNames;
ColorPaletteManager.getBandColors = getBandColors;
ColorPaletteManager.labLightnessToSrgbGray = labLightnessToSrgbGray;
ColorPaletteManager.calculateBandPercentages = calculateBandPercentages;
ColorPaletteManager.computeValueBands = computeValueBands;
ColorPaletteManager.generateDeltaNote = generateDeltaNote;
ColorPaletteManager.posterizeImageDataToBands = posterizeImageDataToBands;
ColorPaletteManager.lchToSrgb = lchToSrgb;
ColorPaletteManager.lchToWheelCoords = lchToWheelCoords;
ColorPaletteManager.wheelCoordsToLch = wheelCoordsToLch;
ColorPaletteManager.convexHull = convexHull;
ColorPaletteManager.filterDominantPoints = filterDominantPoints;
ColorPaletteManager.isPointInPolygon = isPointInPolygon;
ColorPaletteManager.calculateDriftScore = calculateDriftScore;
ColorPaletteManager.calculateMeanChromaRatio = calculateMeanChromaRatio;
ColorPaletteManager.binPoints = binPoints;

if (typeof window !== 'undefined') {
  window.ColorPaletteManager = ColorPaletteManager;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ColorPaletteManager = ColorPaletteManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ColorPaletteManager;
  ColorPaletteManager.srgbToLinear = srgbToLinear;
  ColorPaletteManager.linearToSrgb = linearToSrgb;
  ColorPaletteManager.srgbToLab = srgbToLab;
  ColorPaletteManager.labToLCh = labToLCh;
  ColorPaletteManager.deltaE76 = deltaE76;
  ColorPaletteManager.deltaE2000 = deltaE2000;
  ColorPaletteManager.classifyTemperature = classifyTemperature;
  ColorPaletteManager.getBandIndex = getBandIndex;
  ColorPaletteManager.getBandNames = getBandNames;
  ColorPaletteManager.getBandColors = getBandColors;
  ColorPaletteManager.labLightnessToSrgbGray = labLightnessToSrgbGray;
  ColorPaletteManager.calculateBandPercentages = calculateBandPercentages;
  ColorPaletteManager.computeValueBands = computeValueBands;
  ColorPaletteManager.generateDeltaNote = generateDeltaNote;
  ColorPaletteManager.posterizeImageDataToBands = posterizeImageDataToBands;
  ColorPaletteManager.lchToSrgb = lchToSrgb;
  ColorPaletteManager.lchToWheelCoords = lchToWheelCoords;
  ColorPaletteManager.wheelCoordsToLch = wheelCoordsToLch;
  ColorPaletteManager.convexHull = convexHull;
  ColorPaletteManager.filterDominantPoints = filterDominantPoints;
  ColorPaletteManager.isPointInPolygon = isPointInPolygon;
  ColorPaletteManager.calculateDriftScore = calculateDriftScore;
  ColorPaletteManager.calculateMeanChromaRatio = calculateMeanChromaRatio;
  ColorPaletteManager.binPoints = binPoints;
}
