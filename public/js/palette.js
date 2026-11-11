// ==================== COLOR & DOMINANT PALETTE EXTRACTION HUD ====================
const ColorPaletteManager = {
  hudOpen: false,
  eyedropperActive: false,
  isMinimized: false,
  customPos: null,
  dominantColors: [],
  sampledColors: [],
  activeColor: null,
  _offscreenCanvas: null,
  _offscreenCtx: null,

  get isOpen() {
    return this.hudOpen;
  },

  init() {
    this._offscreenCanvas = document.createElement('canvas');
    this._offscreenCtx = this._offscreenCanvas.getContext('2d', { willReadFrequently: true });
    this.setupDraggable();
    this.bindEvents();
  },

  setupDraggable() {
    const hud = document.getElementById('palette-extraction-hud');
    if (!hud) return;
    const header = hud.querySelector('.palette-hud-header');
    if (!header) return;

    FloatingWindowManager.makeDraggable(hud, header, {
      onEnd: (pos) => {
        this.customPos = pos;
      }
    });
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
    SoundFX.click();
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

    // Copy HEX button
    const btnCopyHex = document.getElementById('btn-copy-inspector-hex');
    if (btnCopyHex) {
      btnCopyHex.addEventListener('click', () => this.copyActiveHex());
    }
    const inspectorHex = document.getElementById('inspector-hex');
    if (inspectorHex) {
      inspectorHex.addEventListener('click', () => this.copyActiveHex());
    }

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
      SoundFX.toolToggle();
      if (hud) FloatingWindowManager.bringToFront(hud);
      const img = document.getElementById('session-image');
      if (img && img.complete && img.naturalWidth > 0 && this.dominantColors.length === 0) {
        this.extractPalette(img);
      }
    } else {
      if (this.eyedropperActive) {
        this.toggleEyedropper(false);
      }
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

    SoundFX.toolToggle();
    if (this.eyedropperActive) {
      if (!this.hudOpen) this.toggleHUD(true);
    } else {
      this.hideLoupe();
    }
  },

  onImageLoaded(imgEl) {
    this.dominantColors = [];
    this.extractPalette(imgEl);
    this.hideLoupe();
  },

  extractPalette(imgEl) {
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return;

    try {
      // 1. Prepare offscreen canvas (clamped to max 1200px for instant memory efficiency)
      const nw = imgEl.naturalWidth;
      const nh = imgEl.naturalHeight;
      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(nw, nh));
      const cw = Math.max(10, Math.round(nw * scale));
      const ch = Math.max(10, Math.round(nh * scale));

      this._offscreenCanvas.width = cw;
      this._offscreenCanvas.height = ch;
      this._offscreenCtx.drawImage(imgEl, 0, 0, cw, ch);

      // 2. Downscale to small 80x80 buffer for fast dominant color clustering
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 80;
      thumbCanvas.height = 80;
      const tCtx = thumbCanvas.getContext('2d');
      tCtx.drawImage(this._offscreenCanvas, 0, 0, 80, 80);
      const imgData = tCtx.getImageData(0, 0, 80, 80).data;

      // 3. Cluster colors into buckets
      const buckets = new Map();
      const step = 4; // Sample every 4th pixel
      for (let i = 0; i < imgData.length; i += 4 * step) {
        const a = imgData[i + 3];
        if (a < 128) continue;
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];

        // Quantize to 5-bit color (32 levels per channel)
        const qr = (r >> 3) << 3;
        const qg = (g >> 3) << 3;
        const qb = (b >> 3) << 3;
        const key = `${qr},${qg},${qb}`;

        const existing = buckets.get(key);
        if (existing) {
          existing.count++;
          existing.rSum += r;
          existing.gSum += g;
          existing.bSum += b;
        } else {
          buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
        }
      }

      // 4. Sort clusters by frequency and pick distinct swatches
      const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
      const swatches = [];

      for (const item of sorted) {
        if (swatches.length >= 7) break;
        const r = Math.round(item.rSum / item.count);
        const g = Math.round(item.gSum / item.count);
        const b = Math.round(item.bSum / item.count);

        // Ensure new swatch is visibly distinct from previously accepted swatches
        const isTooClose = swatches.some(s => {
          const dr = s.r - r;
          const dg = s.g - g;
          const db = s.b - b;
          return Math.sqrt(dr * dr + dg * dg + db * db) < 38;
        });

        if (!isTooClose) {
          swatches.push(this.formatColor(r, g, b));
        }
      }

      // Sort dominant swatches by perceptual value lightness (from highlights to shadows)
      swatches.sort((a, b) => b.val - a.val);
      this.dominantColors = swatches;
      this.renderDominantSwatches();

      if (swatches.length > 0 && !this.activeColor) {
        this.setActiveColor(swatches[0]);
      }
    } catch (e) {
      console.warn('Dominant palette extraction failed:', e);
    }
  },

  formatColor(r, g, b) {
    const hex = '#' + [r, g, b].map(x => {
      const h = Math.max(0, Math.min(255, Math.round(x))).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('').toUpperCase();

    // Perceptual value luminance: Y = 0.299R + 0.587G + 0.114B
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const val = Math.round((lum / 255) * 100);

    // HSB
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const delta = max - min;

    let h = 0;
    if (delta > 0) {
      if (max === rf) {
        h = ((gf - bf) / delta) % 6;
      } else if (max === gf) {
        h = (bf - rf) / delta + 2;
      } else {
        h = (rf - gf) / delta + 4;
      }
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }

    const s = max === 0 ? 0 : Math.round((delta / max) * 100);
    const bri = Math.round(max * 100);

    // Temperature: warm (red/orange/yellow/magenta), cool (cyan/blue/green), neutral if sat < 12%
    let temp = 'Neutral';
    if (s >= 12) {
      if (h <= 75 || h >= 325) {
        temp = 'Warm';
      } else {
        temp = 'Cool';
      }
    }

    return { hex, r, g, b, h, s, bri, val, temp, rgbStr: `rgb(${r}, ${g}, ${b})` };
  },

  renderDominantSwatches() {
    const container = document.getElementById('palette-dominant-swatches');
    if (!container) return;

    if (this.dominantColors.length === 0) {
      container.innerHTML = '<span class="palette-empty-sampled-hint">Analyzing image lighting...</span>';
      return;
    }

    container.innerHTML = this.dominantColors.map((color, idx) => `
      <div class="palette-swatch-chip" style="background-color: ${color.hex}" data-idx="${idx}" title="${UI._esc(`${color.hex} • Value ${color.val}% • ${color.temp}`)}">
        <span class="swatch-value-tag">${color.val}%</span>
      </div>
    `).join('');

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

    const prevBox = document.getElementById('inspector-preview-color');
    const badge = document.getElementById('inspector-temp-badge');
    const hex = document.getElementById('inspector-hex');
    const val = document.getElementById('inspector-val-lightness');
    const hue = document.getElementById('inspector-val-hue');
    const sat = document.getElementById('inspector-val-sat');
    const bri = document.getElementById('inspector-val-bri');
    const rgb = document.getElementById('inspector-val-rgb');

    if (prevBox) prevBox.style.backgroundColor = color.hex;
    if (badge) {
      badge.textContent = color.temp;
      badge.className = `inspector-temp-badge ${color.temp.toLowerCase()}`;
    }
    if (hex) hex.textContent = color.hex;
    if (val) val.textContent = `${color.val}%`;
    if (hue) hue.textContent = `${color.h}°`;
    if (sat) sat.textContent = `${color.s}%`;
    if (bri) bri.textContent = `${color.bri}%`;
    if (rgb) rgb.textContent = color.rgbStr;
  },

  getPixelUnderCursor(clientX, clientY) {
    const stage = document.getElementById('image-stage');
    const frame = document.getElementById('image-frame');
    const img = document.getElementById('session-image');
    if (!stage || !frame || !img || !img.naturalWidth || !this._offscreenCanvas.width) return null;

    const stageRect = stage.getBoundingClientRect();
    const cx = stageRect.left + stageRect.width / 2 + (ArtistToolbox.panX || 0);
    const cy = stageRect.top + stageRect.height / 2 + (ArtistToolbox.panY || 0);

    const dx = clientX - cx;
    const dy = clientY - cy;

    const zoom = ArtistToolbox.zoom || 1;
    const flipX = ArtistToolbox.flipX || 1;
    const rotateTotal = ArtistToolbox.rotateTotal || 0;

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
      const pixel = this._offscreenCtx.getImageData(sx_c, sy_c, 1, 1).data;
      return this.formatColor(pixel[0], pixel[1], pixel[2]);
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
    lx = Math.max(8, Math.min(stageRect.width - 150, lx));
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

    if (circle) circle.style.backgroundColor = color.hex;
    if (badge) {
      badge.textContent = color.temp;
      badge.className = `loupe-temp-badge ${color.temp.toLowerCase()}`;
    }
    if (hex) hex.textContent = color.hex;
    if (val) val.textContent = `${color.val}%`;
    if (hue) hue.textContent = `${color.h}°`;
    if (sat) sat.textContent = `${color.s}%`;
    if (bri) bri.textContent = `${color.bri}%`;

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
    SoundFX.click();
  },

  renderSampledSwatches() {
    const container = document.getElementById('palette-sampled-swatches');
    const clearBtn = document.getElementById('btn-clear-sampled-colors');
    if (!container) return;

    if (this.sampledColors.length === 0) {
      container.innerHTML = '<span class="palette-empty-sampled-hint">Turn on Live Eyedropper & click reference to sample custom swatches</span>';
      if (clearBtn) clearBtn.classList.add('hidden');
      return;
    }

    if (clearBtn) clearBtn.classList.remove('hidden');

    container.innerHTML = this.sampledColors.map((color, idx) => `
      <div class="sampled-chip" style="background-color: ${color.hex}" data-idx="${idx}" title="${UI._esc(`${color.hex} • Value ${color.val}% (${color.temp})`)}">
        <span class="sampled-val">${color.val}%</span>
      </div>
    `).join('');

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
    SoundFX.click();
  },

  copyActiveHex() {
    if (!this.activeColor || !this.activeColor.hex) return;
    const hex = this.activeColor.hex;
    navigator.clipboard.writeText(hex).then(() => {
      const btn = document.getElementById('btn-copy-inspector-hex');
      if (btn) {
        const oldHtml = btn.innerHTML;
        btn.innerHTML = `${UI.getIconSvg('check', 12)} Copied!`;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = oldHtml;
          btn.classList.remove('copied');
        }, 1200);
      }
      SoundFX.click();
    }).catch(() => { });
  }
};

if (typeof window !== "undefined") {
  window.ColorPaletteManager = ColorPaletteManager;
}
if (typeof globalThis !== "undefined") {
  globalThis.ColorPaletteManager = ColorPaletteManager;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ColorPaletteManager;
}
