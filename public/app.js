/* ============================================
   Art Practice Reference — App Logic
   Modules: Storage, WallpaperManager,
            DeckManager, CardManager, ReviewHistory,
            TimerManager, SessionManager, ArtistToolbox,
            UI
   ============================================ */

// ==================== STORAGE ====================
const Storage = {
  DECKS_KEY: 'artpractice_decks',
  CARDS_KEY: 'artpractice_cards',
  HISTORY_KEY: 'artpractice_history',
  WALLPAPER_SETTINGS_KEY: 'artpractice_wallpaper_settings',

  getDecks() {
    const raw = localStorage.getItem(this.DECKS_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  saveDecks(decks) {
    localStorage.setItem(this.DECKS_KEY, JSON.stringify(decks));
  },

  getCards() {
    const raw = localStorage.getItem(this.CARDS_KEY);
    return raw ? JSON.parse(raw) : {};
  },

  saveCards(cards) {
    localStorage.setItem(this.CARDS_KEY, JSON.stringify(cards));
  },

  getHistory() {
    const raw = localStorage.getItem(this.HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  },

  saveHistory(history) {
    localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
  },

  getWallpaperSettings() {
    const raw = localStorage.getItem(this.WALLPAPER_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { blur: 8, dim: 50, hasCustom: false };
  },

  saveWallpaperSettings(settings) {
    localStorage.setItem(this.WALLPAPER_SETTINGS_KEY, JSON.stringify(settings));
  }
};

// ==================== TACTILE SOUND FX (Web Audio API) ====================
const SoundFX = {
  ctx: null,
  enabled: true,

  init() {
    const saved = localStorage.getItem('artpractice_sound_enabled');
    this.enabled = saved !== null ? saved === 'true' : true;
    this.updateUI();

    // Unlock Web Audio context on first user interaction
    const unlockAudio = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
  },

  _getCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('artpractice_sound_enabled', String(this.enabled));
    this.updateUI();
    if (this.enabled) {
      this.chirp();
    }
    return this.enabled;
  },

  updateUI() {
    const icon = this.enabled ? '🔊' : '🔇';
    const text = this.enabled ? 'Sound' : 'Muted';
    const soundIconEl = document.getElementById('sound-icon');
    const soundTextEl = document.getElementById('sound-text');
    if (soundIconEl) soundIconEl.textContent = icon;
    if (soundTextEl) soundTextEl.textContent = text;

    const detailIconEl = document.getElementById('detail-sound-icon');
    if (detailIconEl) detailIconEl.textContent = icon;

    const sessionIconEl = document.getElementById('session-sound-icon');
    if (sessionIconEl) sessionIconEl.textContent = icon;

    const btn1 = document.getElementById('btn-toggle-sound');
    if (btn1) btn1.classList.toggle('btn-muted', !this.enabled);
    const btn2 = document.getElementById('btn-detail-sound');
    if (btn2) btn2.classList.toggle('btn-muted', !this.enabled);
    const btn3 = document.getElementById('btn-session-sound');
    if (btn3) btn3.classList.toggle('btn-muted', !this.enabled);
  },

  // Soft tactile click for buttons
  click() {
    if (!this.enabled) return;
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, ctx.currentTime);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.035);

      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.04);
    } catch (e) {}
  },

  // Subtle tick on hovering cards
  hover() {
    if (!this.enabled) return;
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(380, ctx.currentTime + 0.012);

      gain.gain.setValueAtTime(0.015, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.012);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.015);
    } catch (e) {}
  },

  // Card rating sounds (Hard, Medium, Easy)
  rate(diff) {
    if (!this.enabled) return;
    try {
      const ctx = this._getCtx();
      if (!ctx) return;

      if (diff === 'hard') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.2);

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.23);
      } else if (diff === 'medium') {
        [440, 554.37].forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const t = ctx.currentTime + idx * 0.05;
          osc.frequency.setValueAtTime(f, t);

          gain.gain.setValueAtTime(0.001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.38);
        });
      } else if (diff === 'easy') {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const t = ctx.currentTime + idx * 0.06;
          osc.frequency.setValueAtTime(f, t);

          gain.gain.setValueAtTime(0.001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.58);
        });
      }
    } catch (e) {}
  },

  // Soft organic tick when timer <= 5s
  timerTick() {
    if (!this.enabled) return;
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(580, ctx.currentTime + 0.03);

      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } catch (e) {}
  },

  // Zen singing bowl when timer runs out
  timerAlert() {
    if (!this.enabled) return;
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      [528, 660, 792].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = ctx.currentTime + idx * 0.07;
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 1.5);
      });
    } catch (e) {}
  },

  // Session complete victory fanfare
  sessionComplete() {
    if (!this.enabled) return;
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99]; // C4, E4, G4, C5, E5, G5
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx >= 3 ? 'sine' : 'triangle';
        const start = ctx.currentTime + idx * 0.08;
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 1.2);
      });
    } catch (e) {}
  },

  // Snappy pop for toolbar items
  toolToggle() {
    if (!this.enabled) return;
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(940, ctx.currentTime + 0.035);

      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.045);
    } catch (e) {}
  },

  // Chirp when unmuting
  chirp() {
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(780, ctx.currentTime + 0.06);

      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {}
  }
};

// ==================== LIVING AMBIENT CANVAS & PARTICLES ====================
const ParticleFX = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  particles: [],
  bursts: [],
  mouseX: 0,
  mouseY: 0,
  targetMouseX: 0,
  targetMouseY: 0,
  animId: null,
  isPaused: false,

  init() {
    this.canvas = document.getElementById('particle-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => {
      this.targetMouseX = (e.clientX / (this.width || 1) - 0.5) * 50;
      this.targetMouseY = (e.clientY / (this.height || 1) - 0.5) * 50;
    });

    // 40 ambient drifting stardust / light motes
    const count = Math.min(45, Math.floor(window.innerWidth / 35));
    for (let i = 0; i < count; i++) {
      this.particles.push(this._createMote());
    }

    // Page-wide click micro-bursts (tactile spark response)
    document.addEventListener('click', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      this.burst(e.clientX, e.clientY, 8);
    });

    document.addEventListener('visibilitychange', () => {
      this.isPaused = document.hidden;
      if (!this.isPaused && !this.animId) {
        this.loop();
      }
    });

    this.loop();
  },

  resize() {
    if (!this.canvas) return;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * (window.devicePixelRatio || 1);
    this.canvas.height = this.height * (window.devicePixelRatio || 1);
    this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  },

  _createMote() {
    const colors = [
      'rgba(88, 166, 255, ',   // blue
      'rgba(163, 113, 247, ',  // purple
      'rgba(240, 136, 62, ',   // amber
      'rgba(57, 211, 83, ',    // green
      'rgba(255, 255, 255, '   // white
    ];
    return {
      x: Math.random() * (this.width || 800),
      y: Math.random() * (this.height || 600),
      radius: Math.random() * 2.2 + 0.8,
      colorPrefix: colors[Math.floor(Math.random() * colors.length)],
      alpha: Math.random() * 0.32 + 0.12,
      baseAlpha: Math.random() * 0.32 + 0.12,
      vx: (Math.random() - 0.5) * 0.35,
      vy: -Math.random() * 0.45 - 0.12,
      sineOffset: Math.random() * Math.PI * 2,
      sineSpeed: Math.random() * 0.02 + 0.01,
      depth: Math.random() * 0.8 + 0.4
    };
  },

  burst(x, y, count = 10, customColors = null) {
    const palette = customColors || [
      '#58a6ff', '#a371f7', '#f0883e', '#39d353', '#ffd166', '#ffffff'
    ];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 3.6 + 1.2;
      this.bursts.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: palette[Math.floor(Math.random() * palette.length)],
        radius: Math.random() * 2.4 + 1.2,
        life: 1.0,
        decay: Math.random() * 0.035 + 0.025,
        gravity: 0.06
      });
    }
  },

  celebrate(originX = null, originY = null) {
    const x = originX !== null ? originX : (this.width || 800) / 2;
    const y = originY !== null ? originY : (this.height || 600) * 0.42;
    const palette = ['#388bfd', '#a371f7', '#39d353', '#f0883e', '#e3b341', '#f85149', '#ffffff'];

    for (let i = 0; i < 75; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 7.5 + 2.5;
      this.bursts.push({
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        color: palette[Math.floor(Math.random() * palette.length)],
        radius: Math.random() * 3.4 + 1.5,
        life: 1.0,
        decay: Math.random() * 0.018 + 0.012,
        gravity: 0.16,
        isConfetti: Math.random() > 0.4,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.2
      });
    }
  },

  loop() {
    if (this.isPaused) {
      this.animId = null;
      return;
    }

    this.mouseX += (this.targetMouseX - this.mouseX) * 0.05;
    this.mouseY += (this.targetMouseY - this.mouseY) * 0.05;

    this.ctx.clearRect(0, 0, this.width, this.height);

    // 1. Ambient floating particles
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.sineOffset += p.sineSpeed;
      p.x += p.vx + Math.sin(p.sineOffset) * 0.25;
      p.y += p.vy;

      if (p.y < -10) {
        p.y = this.height + 10;
        p.x = Math.random() * this.width;
      }
      if (p.x < -10) p.x = this.width + 10;
      if (p.x > this.width + 10) p.x = -10;

      const currentAlpha = p.baseAlpha + Math.sin(p.sineOffset) * 0.08;
      const posX = p.x + this.mouseX * p.depth;
      const posY = p.y + this.mouseY * p.depth;

      this.ctx.beginPath();
      this.ctx.arc(posX, posY, p.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = `${p.colorPrefix}${Math.max(0.04, currentAlpha)})`;
      this.ctx.fill();
    }

    // 2. Click micro-bursts / celebration sparks
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.x += b.vx;
      b.y += b.vy;
      b.vy += b.gravity;
      b.vx *= 0.98;
      b.life -= b.decay;

      if (b.life <= 0) {
        this.bursts.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, b.life);
      this.ctx.fillStyle = b.color;

      if (b.isConfetti) {
        b.rotation += b.rotSpeed;
        this.ctx.translate(b.x, b.y);
        this.ctx.rotate(b.rotation);
        this.ctx.fillRect(-b.radius, -b.radius * 0.6, b.radius * 2, b.radius * 1.2);
      } else {
        this.ctx.beginPath();
        this.ctx.arc(b.x, b.y, b.radius * b.life, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    this.animId = requestAnimationFrame(() => this.loop());
  }
};

// ==================== WALLPAPER MANAGER (IndexedDB) ====================
// Uses IndexedDB for large custom wallpaper images so users can set 4K/high-res images without 5MB localStorage limits
const WallpaperManager = {
  db: null,
  currentWallpaperDataUrl: null,
  settings: { blur: 8, dim: 50, hasCustom: false },

  async init() {
    this.settings = Storage.getWallpaperSettings();
    await this._initDB();
    await this.loadSavedWallpaper();
    this.applyStyles();
  },

  _initDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('ArtPracticeWallpaperDB', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('wallpapers')) {
            db.createObjectStore('wallpapers');
          }
        };
        req.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };
        req.onerror = () => {
          console.warn('IndexedDB unavailable for wallpapers, fallback to session');
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  },

  async loadSavedWallpaper() {
    if (!this.settings.hasCustom) return;
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['wallpapers'], 'readonly');
        const store = tx.objectStore('wallpapers');
        const req = store.get('user_wallpaper');
        req.onsuccess = () => {
          if (req.result) {
            this.currentWallpaperDataUrl = req.result;
            this.applyStyles();
          }
          resolve();
        };
        req.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  },

  async setCustomWallpaper(dataUrl) {
    this.currentWallpaperDataUrl = dataUrl;
    this.settings.hasCustom = true;
    Storage.saveWallpaperSettings(this.settings);

    if (this.db) {
      try {
        const tx = this.db.transaction(['wallpapers'], 'readwrite');
        const store = tx.objectStore('wallpapers');
        store.put(dataUrl, 'user_wallpaper');
      } catch (e) {
        console.error('Error storing wallpaper in IndexedDB', e);
      }
    }

    this.applyStyles();
    UI.updateWallpaperModalUI();
    UI.showToast('Custom wallpaper applied', '🎨');
  },

  async removeWallpaper() {
    this.currentWallpaperDataUrl = null;
    this.settings.hasCustom = false;
    Storage.saveWallpaperSettings(this.settings);

    if (this.db) {
      try {
        const tx = this.db.transaction(['wallpapers'], 'readwrite');
        const store = tx.objectStore('wallpapers');
        store.delete('user_wallpaper');
      } catch (e) {
        console.error('Error removing wallpaper from IndexedDB', e);
      }
    }

    this.applyStyles();
    UI.updateWallpaperModalUI();
    UI.showToast('Wallpaper reset to default', '🧹');
  },

  setBlur(val) {
    this.settings.blur = parseInt(val, 10) || 0;
    Storage.saveWallpaperSettings(this.settings);
    this.applyStyles();
  },

  setDim(val) {
    this.settings.dim = parseInt(val, 10) || 50;
    Storage.saveWallpaperSettings(this.settings);
    this.applyStyles();
  },

  applyStyles() {
    const bgEl = document.getElementById('wallpaper-bg');
    const overlayEl = document.getElementById('wallpaper-overlay');
    if (!bgEl || !overlayEl) return;

    if (this.currentWallpaperDataUrl && this.settings.hasCustom) {
      bgEl.style.backgroundImage = `url("${this.currentWallpaperDataUrl}")`;
      bgEl.style.opacity = '1';
    } else {
      bgEl.style.backgroundImage = 'none';
      bgEl.style.opacity = '0';
    }

    document.documentElement.style.setProperty('--wallpaper-blur', `${this.settings.blur}px`);
    const dimAlpha = (this.settings.dim / 100).toFixed(2);
    document.documentElement.style.setProperty('--wallpaper-overlay-dim', `rgba(13, 17, 23, ${dimAlpha})`);
  }
};

// ==================== REVIEW HISTORY ====================
// Tracks daily review counts per deck: { [deckId]: { [dateStr]: count } }
const ReviewHistory = {
  history: {},

  init() {
    this.history = Storage.getHistory();
  },

  save() {
    Storage.saveHistory(this.history);
  },

  /** Record one review for a deck on today's date */
  record(deckId, isNewCard) {
    if (!this.history[deckId]) {
      this.history[deckId] = {};
    }
    const todayStr = this._dateStr(new Date());

    // Migrate old flat number format to object if necessary
    if (typeof this.history[deckId][todayStr] === 'number') {
      const val = this.history[deckId][todayStr];
      this.history[deckId][todayStr] = { new: 0, review: val, total: val };
    }

    if (!this.history[deckId][todayStr]) {
      this.history[deckId][todayStr] = { new: 0, review: 0, total: 0 };
    }

    const entry = this.history[deckId][todayStr];
    if (isNewCard) entry.new++;
    else entry.review++;
    entry.total++;

    this.save();
  },

  /** Get review counts for a specific deck on a specific date */
  getCounts(deckId, dateStr) {
    if (!this.history[deckId] || !this.history[deckId][dateStr]) {
      return { new: 0, review: 0, total: 0 };
    }
    const val = this.history[deckId][dateStr];
    if (typeof val === 'number') return { new: 0, review: val, total: val };
    return val;
  },

  /** Get all daily total counts across ALL decks as { dateStr: totalCount } */
  getGlobalHistory() {
    const result = {};
    for (const deckId in this.history) {
      const data = this.history[deckId] || {};
      for (const [date, val] of Object.entries(data)) {
        const count = typeof val === 'number' ? val : val.total;
        if (result[date]) {
          result[date] += count;
        } else {
          result[date] = count;
        }
      }
    }
    return result;
  },

  /** Delete history for a deck */
  deleteForDeck(deckId) {
    delete this.history[deckId];
    this.save();
  },

  _dateStr(date) {
    return date.toISOString().split('T')[0];
  }
};

// ==================== DECK MANAGER ====================
const DeckManager = {
  decks: [],

  init() {
    this.decks = Storage.getDecks();
  },

  save() {
    Storage.saveDecks(this.decks);
  },

  create(name, folderPath, newLimit, reviewLimit) {
    const deck = {
      id: 'deck_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: name.trim(),
      folderPath: folderPath.trim(),
      newLimit: parseInt(newLimit, 10) || 20,
      reviewLimit: parseInt(reviewLimit, 10) || 200,
      createdAt: new Date().toISOString()
    };
    this.decks.push(deck);
    this.save();
    return deck;
  },

  update(id, name, folderPath, newLimit, reviewLimit) {
    const deck = this.getById(id);
    if (deck) {
      deck.name = name.trim();
      deck.folderPath = folderPath.trim();
      deck.newLimit = parseInt(newLimit, 10) || 20;
      deck.reviewLimit = parseInt(reviewLimit, 10) || 200;
      this.save();
    }
    return deck;
  },

  delete(id) {
    this.decks = this.decks.filter(d => d.id !== id);
    this.save();
    CardManager.deleteForDeck(id);
    ReviewHistory.deleteForDeck(id);
  },

  getById(id) {
    return this.decks.find(d => d.id === id);
  },

  getAll() {
    return this.decks;
  }
};

// ==================== CARD MANAGER ====================
const CardManager = {
  cards: {},

  init() {
    this.cards = Storage.getCards();
  },

  save() {
    Storage.saveCards(this.cards);
  },

  getCard(deckId, imageId) {
    if (!this.cards[deckId]) return null;
    return this.cards[deckId][imageId] || null;
  },

  getCardsForDeck(deckId) {
    return this.cards[deckId] || {};
  },

  /** Rate an image card (SM-2 variant spaced repetition) */
  rateCard(deckId, imageId, imageName, difficulty) {
    if (!this.cards[deckId]) {
      this.cards[deckId] = {};
    }

    const existing = this.cards[deckId][imageId];
    const now = new Date();
    const todayStr = this._dateStr(now);
    const isNewCard = !existing;

    let interval, easeFactor;

    if (!existing) {
      switch (difficulty) {
        case 'hard':
          interval = 1;
          easeFactor = 1.2;
          break;
        case 'medium':
          interval = 3;
          easeFactor = 1.5;
          break;
        case 'easy':
          interval = 7;
          easeFactor = 2.0;
          break;
      }
    } else {
      const prevInterval = existing.interval || 1;
      const prevEase = existing.easeFactor || 1.5;

      switch (difficulty) {
        case 'hard':
          interval = Math.max(1, Math.round(prevInterval * 0.5));
          easeFactor = Math.max(1.3, prevEase - 0.2);
          break;
        case 'medium':
          interval = Math.max(prevInterval + 1, Math.round(prevInterval * prevEase));
          easeFactor = prevEase;
          break;
        case 'easy':
          interval = Math.max(prevInterval + 2, Math.round(prevInterval * prevEase * 1.3));
          easeFactor = prevEase + 0.15;
          break;
      }
    }

    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + interval);

    this.cards[deckId][imageId] = {
      imageId,
      imageName,
      difficulty,
      interval,
      easeFactor,
      dueDate: this._dateStr(dueDate),
      reviewCount: (existing ? existing.reviewCount : 0) + 1,
      lastReviewDate: todayStr,
      firstReviewDate: existing ? existing.firstReviewDate : todayStr
    };

    this.save();
    ReviewHistory.record(deckId, isNewCard);

    return this.cards[deckId][imageId];
  },

  getProjectedInterval(deckId, imageId, difficulty) {
    const existing = this.getCard(deckId, imageId);

    if (!existing) {
      switch (difficulty) {
        case 'hard': return 1;
        case 'medium': return 3;
        case 'easy': return 7;
      }
    }

    const prevInterval = existing.interval || 1;
    const prevEase = existing.easeFactor || 1.5;

    switch (difficulty) {
      case 'hard':
        return Math.max(1, Math.round(prevInterval * 0.5));
      case 'medium':
        return Math.max(prevInterval + 1, Math.round(prevInterval * prevEase));
      case 'easy':
        return Math.max(prevInterval + 2, Math.round(prevInterval * prevEase * 1.3));
    }
  },

  getDueCards(deckId) {
    const deckCards = this.cards[deckId];
    if (!deckCards) return [];

    const todayStr = this._dateStr(new Date());
    return Object.values(deckCards).filter(c => c.dueDate <= todayStr);
  },

  getStats(deckId, totalImages) {
    const deckCards = this.cards[deckId] || {};
    const reviewed = Object.keys(deckCards).length;
    const todayStr = this._dateStr(new Date());
    const due = Object.values(deckCards).filter(c => c.dueDate <= todayStr).length;

    return {
      total: totalImages,
      reviewed,
      newCards: Math.max(0, totalImages - reviewed),
      due
    };
  },

  deleteForDeck(deckId) {
    delete this.cards[deckId];
    this.save();
  },

  _dateStr(date) {
    return date.toISOString().split('T')[0];
  }
};

// ==================== TIMER MANAGER ====================
const TimerManager = {
  duration: 0,
  remaining: 0,
  intervalId: null,
  isPaused: false,
  autoAdvance: false,
  onTick: null,
  onEnd: null,

  start(durationSec, autoAdvance, onTick, onEnd) {
    this.stop();
    this.duration = durationSec;
    this.remaining = durationSec;
    this.isPaused = false;
    this.autoAdvance = autoAdvance;
    this.onTick = onTick;
    this.onEnd = onEnd;

    if (this.onTick) this.onTick(this.remaining, this.duration);

    this.intervalId = setInterval(() => {
      if (!this.isPaused) {
        this.remaining--;
        if (this.remaining <= 5 && this.remaining > 0) {
          SoundFX.timerTick();
        }
        if (this.onTick) this.onTick(this.remaining, this.duration);

        if (this.remaining <= 0) {
          this.stop();
          SoundFX.timerAlert();
          if (this.onEnd) this.onEnd();
        }
      }
    }, 1000);
  },

  pause() {
    this.isPaused = true;
  },

  resume() {
    this.isPaused = false;
  },

  togglePause() {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.isPaused;
  },

  reset() {
    this.remaining = this.duration;
    this.isPaused = false;
    if (this.onTick) this.onTick(this.remaining, this.duration);
  },

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPaused = false;
  },

  isRunning() {
    return this.intervalId !== null;
  },

  /** Gentle singing chime using Web Audio API */
  _playSingingChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      const freqs = [528, 660, 792]; // Harmonious pentatonic frequencies
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);

        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.08 + 1.2);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 1.3);
      });
    } catch (e) {
      // Audio not supported or blocked by browser autoplay
    }
  }
};

// ==================== SESSION MANAGER ====================
const SessionManager = {
  deckId: null,
  mode: null,          // 'new', 'review', or 'free'
  images: [],          // All images from folder
  queue: [],           // Queue of image IDs
  currentImage: null,  // Current image object
  imagesShown: 0,
  sessionStats: { hard: 0, medium: 0, easy: 0, total: 0 },

  async loadImages(folderPath) {
    const res = await fetch(`/api/images?folder=${encodeURIComponent(folderPath)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load images');
    }
    this.images = await res.json();
    return this.images;
  },

  startSession(deckId, mode, images, newLimit, reviewLimit) {
    this.deckId = deckId;
    this.mode = mode;
    this.images = images;
    this.imagesShown = 0;
    this.sessionStats = { hard: 0, medium: 0, easy: 0, total: 0 };

    const deckCards = CardManager.getCardsForDeck(deckId);

    if (mode === 'free') {
      this.queue = this._shuffle(images.map(img => img.id));
    } else if (mode === 'new') {
      const unseenIds = images
        .map(img => img.id)
        .filter(id => !deckCards[id]);
      this.queue = this._shuffle(unseenIds).slice(0, newLimit);
    } else if (mode === 'review') {
      const dueCards = CardManager.getDueCards(deckId);
      const dueIds = dueCards.map(c => c.imageId);
      this.queue = this._shuffle(
        images.filter(img => dueIds.includes(img.id)).map(img => img.id)
      ).slice(0, reviewLimit);
    }
  },

  nextImage() {
    if (this.queue.length === 0) {
      if (this.mode === 'free') {
        this.queue = this._shuffle(this.images.map(img => img.id));
      } else {
        this.currentImage = null;
        return null;
      }
    }

    const imageId = this.queue.pop();
    this.currentImage = this.images.find(img => img.id === imageId);
    this.imagesShown++;
    return this.currentImage;
  },

  getImageUrl(imageId) {
    return `/api/image?path=${encodeURIComponent(imageId)}`;
  },

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
};

// ==================== ARTIST TOOLBOX ====================
const ArtistToolbox = {
  grayscale: false,
  grid: false,
  invert: false,
  flipX: 1,
  rotate: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,

  reset() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.rotate = 0;
    this.flipX = 1;
    this.applyTransform();
  },

  toggleGrayscale() {
    SoundFX.toolToggle();
    this.grayscale = !this.grayscale;
    const container = document.getElementById('session-image-container');
    const btn = document.getElementById('btn-art-grayscale');
    if (this.grayscale) {
      container.classList.add('filter-grayscale');
      btn.classList.add('active');
      UI.showToast('Value Check (Grayscale) On', '◐');
    } else {
      container.classList.remove('filter-grayscale');
      btn.classList.remove('active');
      UI.showToast('Color Restored', '🎨');
    }
  },

  toggleGrid() {
    SoundFX.toolToggle();
    this.grid = !this.grid;
    const overlay = document.getElementById('image-grid-overlay');
    const btn = document.getElementById('btn-art-grid');
    if (this.grid) {
      overlay.classList.remove('hidden');
      btn.classList.add('active');
      UI.showToast('Proportion Grid On', '⌗');
    } else {
      overlay.classList.add('hidden');
      btn.classList.remove('active');
      UI.showToast('Proportion Grid Off', '⌗');
    }
  },

  toggleInvert() {
    SoundFX.toolToggle();
    this.invert = !this.invert;
    const container = document.getElementById('session-image-container');
    const btn = document.getElementById('btn-art-invert');
    if (this.invert) {
      container.classList.add('filter-invert');
      btn.classList.add('active');
      UI.showToast('Silhouette Invert On', '☯');
    } else {
      container.classList.remove('filter-invert');
      btn.classList.remove('active');
      UI.showToast('Invert Off', '☯');
    }
  },

  flipHorizontal() {
    SoundFX.toolToggle();
    this.flipX *= -1;
    this.applyTransform();
    UI.showToast(this.flipX === -1 ? 'Flipped Horizontal' : 'Normal Orientation', '⇄');
  },

  rotate90() {
    SoundFX.toolToggle();
    this.rotate = (this.rotate + 90) % 360;
    this.applyTransform();
    UI.showToast(`Rotated ${this.rotate}°`, '⟳');
  },

  adjustZoom(delta) {
    this.zoom += delta;
    if (this.zoom < 0.3) this.zoom = 0.3;
    if (this.zoom > 5) this.zoom = 5;
    if (this.zoom === 1) {
      this.panX = 0;
      this.panY = 0;
    }
    this.applyTransform();
  },

  resetZoomPan() {
    SoundFX.toolToggle();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
    UI.showToast('Zoom Reset (1:1)', '🔍');
  },

  applyTransform() {
    const imgEl = document.getElementById('session-image');
    if (imgEl) {
      imgEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom}) scaleX(${this.flipX}) rotate(${this.rotate}deg)`;
    }
  },

  setupDragAndWheel() {
    const container = document.getElementById('image-stage');
    const img = document.getElementById('session-image');
    if (!container || !img) return;

    // Mouse drag to pan when zoomed
    container.addEventListener('mousedown', (e) => {
      if (this.zoom <= 1) return;
      this.isDragging = true;
      this.dragStartX = e.clientX - this.panX;
      this.dragStartY = e.clientY - this.panY;
      img.style.transition = 'none'; // Instant response during drag
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStartX;
      this.panY = e.clientY - this.dragStartY;
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        img.style.transition = 'transform 0.15s ease-out, filter 0.25s ease';
      }
    });

    // Mouse wheel zoom
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      this.adjustZoom(delta);
    }, { passive: false });
  }
};

// ==================== UI CONTROLLER ====================
const UI = {
  currentDeckId: null,
  cachedImages: null,
  imageBlurred: false,
  folderBrowserCurrentPath: null,
  deckSearchQuery: '',
  deckSortOrder: 'due-desc',
  isZenMode: false,

  async init() {
    SoundFX.init();
    ParticleFX.init();
    DeckManager.init();
    CardManager.init();
    ReviewHistory.init();
    await WallpaperManager.init();
    ArtistToolbox.setupDragAndWheel();

    this.bindEvents();
    this.showDeckList();
  },

  // ---- Toast HUD ----
  showToast(message, icon = '✨') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span> <span>${this._esc(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 250);
    }, 2200);
  },

  // ---- Event Binding ----
  bindEvents() {
    // Sound Toggles
    const toggleSoundHandler = () => {
      const enabled = SoundFX.toggle();
      this.showToast(enabled ? 'Tactile Sound On' : 'Sound Muted', enabled ? '🔊' : '🔇');
    };
    const btnSound1 = document.getElementById('btn-toggle-sound');
    if (btnSound1) btnSound1.addEventListener('click', toggleSoundHandler);
    const btnSound2 = document.getElementById('btn-detail-sound');
    if (btnSound2) btnSound2.addEventListener('click', toggleSoundHandler);
    const btnSound3 = document.getElementById('btn-session-sound');
    if (btnSound3) btnSound3.addEventListener('click', toggleSoundHandler);

    // Global tactile click sound on interactive elements
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button, .btn, .folder-item, .btn-rate');
      if (btn) {
        SoundFX.click();
      }
    });

    // Header & Deck List
    document.getElementById('btn-new-deck').addEventListener('click', () => this.openDeckModal());
    document.getElementById('btn-empty-new-deck').addEventListener('click', () => this.openDeckModal());
    document.getElementById('btn-open-wallpaper').addEventListener('click', () => this.openWallpaperModal());
    document.getElementById('btn-detail-wallpaper').addEventListener('click', () => this.openWallpaperModal());
    document.getElementById('btn-open-shortcuts').addEventListener('click', () => this.openShortcutsModal());
    document.getElementById('btn-open-backup').addEventListener('click', () => this.openBackupModal());

    // Search and Sort
    const searchInput = document.getElementById('deck-search-input');
    const clearSearchBtn = document.getElementById('btn-clear-search');
    const sortSelect = document.getElementById('deck-sort-select');

    searchInput.addEventListener('input', (e) => {
      this.deckSearchQuery = e.target.value.toLowerCase().trim();
      clearSearchBtn.classList.toggle('hidden', !this.deckSearchQuery);
      this.renderDeckList();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      this.deckSearchQuery = '';
      clearSearchBtn.classList.add('hidden');
      this.renderDeckList();
      searchInput.focus();
    });

    sortSelect.addEventListener('change', (e) => {
      this.deckSortOrder = e.target.value;
      this.renderDeckList();
    });

    // Deck Detail View
    document.getElementById('btn-back-to-list').addEventListener('click', () => this.showDeckList());
    document.getElementById('btn-edit-deck').addEventListener('click', () => this.openDeckModal(this.currentDeckId));
    document.getElementById('btn-delete-deck').addEventListener('click', () => this.openDeleteModal());
    document.getElementById('btn-study-new').addEventListener('click', () => this.startSession('new'));
    document.getElementById('btn-review').addEventListener('click', () => this.startSession('review'));
    document.getElementById('btn-free-study').addEventListener('click', () => this.startSession('free'));
    document.getElementById('btn-todays-reviewed').addEventListener('click', () => this.openTodaysReviewedModal());
    document.getElementById('btn-close-todays').addEventListener('click', () => this.closeTodaysReviewedModal());

    // Session View & Rating
    document.getElementById('btn-end-session').addEventListener('click', () => this.endSession());
    document.getElementById('btn-session-zen').addEventListener('click', () => this.toggleZenMode());
    document.getElementById('btn-rate-hard').addEventListener('click', () => this.rateCurrentImage('hard'));
    document.getElementById('btn-rate-medium').addEventListener('click', () => this.rateCurrentImage('medium'));
    document.getElementById('btn-rate-easy').addEventListener('click', () => this.rateCurrentImage('easy'));
    document.getElementById('btn-skip').addEventListener('click', () => this.showNextImage());
    document.getElementById('btn-review-done').addEventListener('click', () => this.endSession());
    document.getElementById('btn-summary-done').addEventListener('click', () => {
      document.getElementById('modal-session-summary').classList.add('hidden');
      this.endSession();
    });

    // Timer Controls
    document.getElementById('btn-timer-pause').addEventListener('click', () => this.toggleTimerPause());
    document.getElementById('btn-timer-reset').addEventListener('click', () => this.resetTimer());

    // Artist Toolbox HUD
    document.getElementById('btn-art-grayscale').addEventListener('click', () => ArtistToolbox.toggleGrayscale());
    document.getElementById('btn-art-grid').addEventListener('click', () => ArtistToolbox.toggleGrid());
    document.getElementById('btn-art-invert').addEventListener('click', () => ArtistToolbox.toggleInvert());
    document.getElementById('btn-img-flip').addEventListener('click', () => ArtistToolbox.flipHorizontal());
    document.getElementById('btn-img-rotate').addEventListener('click', () => ArtistToolbox.rotate90());
    document.getElementById('btn-img-zoom-in').addEventListener('click', () => ArtistToolbox.adjustZoom(0.25));
    document.getElementById('btn-img-zoom-out').addEventListener('click', () => ArtistToolbox.adjustZoom(-0.25));
    document.getElementById('btn-img-zoom-reset').addEventListener('click', () => ArtistToolbox.resetZoomPan());
    document.getElementById('btn-img-fullscreen').addEventListener('click', () => this.toggleZenMode());

    // Wallpaper Modal Events
    this.bindWallpaperEvents();

    // Backup & Restore Events
    this.bindBackupEvents();

    // Shortcuts Modal
    document.getElementById('btn-close-shortcuts').addEventListener('click', () => this.closeShortcutsModal());
    document.getElementById('btn-close-shortcuts-x').addEventListener('click', () => this.closeShortcutsModal());

    // Deck Modal
    document.getElementById('form-deck').addEventListener('submit', (e) => this.handleDeckSubmit(e));
    document.getElementById('btn-cancel-deck').addEventListener('click', () => this.closeDeckModal());

    // Folder Browser
    document.getElementById('btn-browse-folder').addEventListener('click', () => this.openFolderBrowser());
    document.getElementById('btn-cancel-browse').addEventListener('click', () => this.closeFolderBrowser());
    document.getElementById('btn-select-folder').addEventListener('click', () => this.selectBrowsedFolder());
    document.getElementById('folder-browser-up').addEventListener('click', () => this.browseFolderUp());

    // Delete Modal
    document.getElementById('btn-cancel-delete').addEventListener('click', () => this.closeDeleteModal());
    document.getElementById('btn-confirm-delete').addEventListener('click', () => this.confirmDelete());

    // Overlay click to close modals
    const modalIds = [
      'modal-deck', 'modal-delete', 'modal-folder-browser',
      'modal-todays-reviewed', 'modal-wallpaper', 'modal-shortcuts',
      'modal-backup', 'modal-session-summary'
    ];
    modalIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', (e) => {
          if (e.target === el) el.classList.add('hidden');
        });
      }
    });

    // Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
  },

  // ---- Wallpaper Modal Events ----
  bindWallpaperEvents() {
    const modal = document.getElementById('modal-wallpaper');
    const dropzone = document.getElementById('wallpaper-dropzone');
    const fileInput = document.getElementById('wallpaper-file-input');
    const blurSlider = document.getElementById('wallpaper-blur-slider');
    const dimSlider = document.getElementById('wallpaper-dim-slider');
    const blurVal = document.getElementById('wallpaper-blur-val');
    const dimVal = document.getElementById('wallpaper-dim-val');
    const removeBtn = document.getElementById('btn-remove-wallpaper');
    const urlInput = document.getElementById('wallpaper-url-input');
    const applyUrlBtn = document.getElementById('btn-apply-wallpaper-url');

    document.getElementById('btn-close-wallpaper').addEventListener('click', () => modal.classList.add('hidden'));
    document.getElementById('btn-close-wallpaper-x').addEventListener('click', () => modal.classList.add('hidden'));

    // File Drag and Drop
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        this.handleWallpaperFileUpload(files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleWallpaperFileUpload(e.target.files[0]);
      }
    });

    // URL input
    applyUrlBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (url) {
        WallpaperManager.setCustomWallpaper(url);
        urlInput.value = '';
      }
    });

    // Sliders
    blurSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      blurVal.textContent = `${val}px`;
      WallpaperManager.setBlur(val);
    });

    dimSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      dimVal.textContent = `${val}%`;
      WallpaperManager.setDim(val);
    });

    removeBtn.addEventListener('click', () => {
      WallpaperManager.removeWallpaper();
    });
  },

  handleWallpaperFileUpload(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, WEBP, etc.)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      WallpaperManager.setCustomWallpaper(e.target.result);
    };
    reader.readAsDataURL(file);
  },

  openWallpaperModal() {
    this.updateWallpaperModalUI();
    document.getElementById('modal-wallpaper').classList.remove('hidden');
  },

  updateWallpaperModalUI() {
    const settings = WallpaperManager.settings;
    const blurSlider = document.getElementById('wallpaper-blur-slider');
    const dimSlider = document.getElementById('wallpaper-dim-slider');
    const blurVal = document.getElementById('wallpaper-blur-val');
    const dimVal = document.getElementById('wallpaper-dim-val');
    const statusText = document.getElementById('wallpaper-status-text');
    const thumb = document.getElementById('wallpaper-preview-thumb');
    const removeBtn = document.getElementById('btn-remove-wallpaper');

    blurSlider.value = settings.blur;
    blurVal.textContent = `${settings.blur}px`;
    dimSlider.value = settings.dim;
    dimVal.textContent = `${settings.dim}%`;

    if (WallpaperManager.currentWallpaperDataUrl && settings.hasCustom) {
      statusText.textContent = 'Custom Wallpaper Active';
      thumb.style.backgroundImage = `url("${WallpaperManager.currentWallpaperDataUrl}")`;
      removeBtn.classList.remove('hidden');
    } else {
      statusText.textContent = 'No custom wallpaper set (Default Studio Dark)';
      thumb.style.backgroundImage = 'none';
      removeBtn.classList.add('hidden');
    }
  },

  // ---- Backup & Restore ----
  bindBackupEvents() {
    const modal = document.getElementById('modal-backup');
    const exportBtn = document.getElementById('btn-export-data');
    const importBtn = document.getElementById('btn-import-data');
    const fileInput = document.getElementById('backup-file-input');
    const statusEl = document.getElementById('backup-status');

    document.getElementById('btn-close-backup').addEventListener('click', () => modal.classList.add('hidden'));
    document.getElementById('btn-close-backup-x').addEventListener('click', () => modal.classList.add('hidden'));

    exportBtn.addEventListener('click', () => {
      const backupData = {
        version: 1,
        timestamp: new Date().toISOString(),
        decks: DeckManager.getAll(),
        cards: CardManager.cards,
        history: ReviewHistory.history,
        wallpaperSettings: Storage.getWallpaperSettings()
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `art-practice-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      statusEl.textContent = 'Backup file downloaded successfully!';
    });

    importBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          if (data.decks) Storage.saveDecks(data.decks);
          if (data.cards) Storage.saveCards(data.cards);
          if (data.history) Storage.saveHistory(data.history);
          if (data.wallpaperSettings) Storage.saveWallpaperSettings(data.wallpaperSettings);

          DeckManager.init();
          CardManager.init();
          ReviewHistory.init();

          statusEl.textContent = 'Progress restored successfully!';
          this.showToast('Data restored successfully', '💾');
          setTimeout(() => {
            modal.classList.add('hidden');
            this.showDeckList();
          }, 1000);
        } catch (err) {
          statusEl.textContent = `Error restoring file: ${err.message}`;
        }
      };
      reader.readAsText(file);
    });
  },

  openBackupModal() {
    document.getElementById('backup-status').textContent = '';
    document.getElementById('modal-backup').classList.remove('hidden');
  },

  // ---- Shortcuts Modal ----
  openShortcutsModal() {
    document.getElementById('modal-shortcuts').classList.remove('hidden');
  },

  closeShortcutsModal() {
    document.getElementById('modal-shortcuts').classList.add('hidden');
  },

  triggerHotkeyFeedback(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.add('btn-hotkey-press');
    setTimeout(() => el.classList.remove('btn-hotkey-press'), 180);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      ParticleFX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 6);
    }
  },

  // ---- Keyboard Shortcuts ----
  handleKeyboard(e) {
    // If typing in an input/textarea, ignore hotkeys
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      return;
    }

    // Sound toggle shortcut (U)
    if (e.key.toLowerCase() === 'u') {
      const enabled = SoundFX.toggle();
      this.showToast(enabled ? 'Tactile Sound On' : 'Sound Muted', enabled ? '🔊' : '🔇');
      return;
    }

    // Help modal toggle (?)
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      const modal = document.getElementById('modal-shortcuts');
      modal.classList.toggle('hidden');
      return;
    }

    // Escape closes modals or exits zen mode
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
      if (this.isZenMode) this.toggleZenMode(false);
      return;
    }

    // Hotkeys active inside session view
    const sessionView = document.getElementById('view-session');
    if (!sessionView.classList.contains('active')) return;

    switch (e.key.toLowerCase()) {
      case '1':
        this.triggerHotkeyFeedback('btn-rate-hard');
        this.rateCurrentImage('hard');
        break;
      case '2':
        this.triggerHotkeyFeedback('btn-rate-medium');
        this.rateCurrentImage('medium');
        break;
      case '3':
        this.triggerHotkeyFeedback('btn-rate-easy');
        this.rateCurrentImage('easy');
        break;
      case 's':
        if (!this.imageBlurred) {
          this.triggerHotkeyFeedback('btn-skip');
          this.showNextImage();
        }
        break;
      case ' ':
        e.preventDefault();
        this.triggerHotkeyFeedback('btn-timer-pause');
        this.toggleTimerPause();
        break;
      case 'g':
        this.triggerHotkeyFeedback('btn-art-grayscale');
        ArtistToolbox.toggleGrayscale();
        break;
      case 'o':
        this.triggerHotkeyFeedback('btn-art-grid');
        ArtistToolbox.toggleGrid();
        break;
      case 'i':
        this.triggerHotkeyFeedback('btn-art-invert');
        ArtistToolbox.toggleInvert();
        break;
      case 'm':
        this.triggerHotkeyFeedback('btn-img-flip');
        ArtistToolbox.flipHorizontal();
        break;
      case 'r':
        this.triggerHotkeyFeedback('btn-img-rotate');
        ArtistToolbox.rotate90();
        break;
      case '+':
      case '=':
        this.triggerHotkeyFeedback('btn-img-zoom-in');
        ArtistToolbox.adjustZoom(0.25);
        break;
      case '-':
      case '_':
        this.triggerHotkeyFeedback('btn-img-zoom-out');
        ArtistToolbox.adjustZoom(-0.25);
        break;
      case '0':
        this.triggerHotkeyFeedback('btn-img-zoom-reset');
        ArtistToolbox.resetZoomPan();
        break;
      case 'f':
        this.triggerHotkeyFeedback('btn-session-zen');
        this.toggleZenMode();
        break;
    }
  },

  // ---- Zen Distraction-Free Mode ----
  toggleZenMode(forceState = null) {
    if (forceState !== null) {
      this.isZenMode = forceState;
    } else {
      this.isZenMode = !this.isZenMode;
    }

    document.body.classList.toggle('zen-active', this.isZenMode);
    this.showToast(this.isZenMode ? 'Zen Mode Enabled [F]' : 'Zen Mode Disabled', '⛶');
  },

  // ---- View Switching ----
  showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
  },

  // ---- Deck List View ----
  showDeckList() {
    this.showView('view-deck-list');
    this.renderDeckList();
  },

  renderDeckList() {
    let decks = DeckManager.getAll();
    const listEl = document.getElementById('deck-list');
    const emptyEl = document.getElementById('empty-state');

    // Filter by search query
    if (this.deckSearchQuery) {
      decks = decks.filter(d =>
        d.name.toLowerCase().includes(this.deckSearchQuery) ||
        d.folderPath.toLowerCase().includes(this.deckSearchQuery)
      );
    }

    // Sort decks
    const todayStr = CardManager._dateStr(new Date());
    decks.sort((a, b) => {
      const cardsA = CardManager.getCardsForDeck(a.id);
      const cardsB = CardManager.getCardsForDeck(b.id);
      const dueA = Object.values(cardsA).filter(c => c.dueDate <= todayStr).length;
      const dueB = Object.values(cardsB).filter(c => c.dueDate <= todayStr).length;

      switch (this.deckSortOrder) {
        case 'due-desc':
          return dueB - dueA;
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'total-desc':
          return Object.keys(cardsB).length - Object.keys(cardsA).length;
        case 'newest':
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        default:
          return 0;
      }
    });

    if (decks.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    listEl.innerHTML = decks.map(deck => {
      const deckCards = CardManager.getCardsForDeck(deck.id);
      const reviewed = Object.keys(deckCards).length;
      const due = Object.values(deckCards).filter(c => c.dueDate <= todayStr).length;

      return `
        <div class="deck-card" data-deck-id="${deck.id}">
          <div class="deck-card-name">${this._esc(deck.name)}</div>
          <div class="deck-card-path">${this._esc(deck.folderPath)}</div>
          <div class="deck-card-stats">
            <span class="stat-pill reviewed-badge">${reviewed} mastered</span>
            ${due > 0 ? `<span class="stat-pill due-badge">⚡ ${due} due</span>` : '<span class="stat-pill">0 due</span>'}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.deck-card').forEach(card => {
      this.applyCardTilt(card);
      card.addEventListener('click', () => {
        this.openDeckDetail(card.dataset.deckId);
      });
    });
  },

  applyCardTilt(card) {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -6.5;
      const rotateY = ((x - centerX) / centerX) * 6.5;

      card.style.transform = `perspective(800px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px) scale3d(1.02, 1.02, 1.02)`;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });

    card.addEventListener('mouseenter', () => {
      SoundFX.hover();
      card.style.transition = 'transform 0.1s ease-out, box-shadow 0.2s ease, border-color 0.2s ease';
    });

    card.addEventListener('mouseleave', () => {
      card.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease, border-color 0.3s ease';
      card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0) scale3d(1, 1, 1)';
    });
  },

  // ---- Deck Detail View ----
  async openDeckDetail(deckId) {
    this.currentDeckId = deckId;
    const deck = DeckManager.getById(deckId);
    if (!deck) return;

    document.getElementById('deck-detail-name').textContent = deck.name;
    document.getElementById('deck-detail-path').textContent = deck.folderPath;

    this.showView('view-deck-detail');

    // Load folder images
    try {
      this.cachedImages = await SessionManager.loadImages(deck.folderPath);
    } catch (err) {
      this.cachedImages = [];
      this.showToast(`Folder load issue: ${err.message}`, '⚠️');
    }

    this.renderDeckStats();
    this.renderHeatmap();
    this.renderActivityStats();
    this.renderTodaysReviewedCount();
  },

  renderDeckStats() {
    const totalImages = this.cachedImages ? this.cachedImages.length : 0;
    const stats = CardManager.getStats(this.currentDeckId, totalImages);

    const deck = DeckManager.getById(this.currentDeckId);
    const newLimit = deck.newLimit || 20;
    const reviewLimit = deck.reviewLimit || 200;

    const todayStr = CardManager._dateStr(new Date());
    const historyCounts = ReviewHistory.getCounts(this.currentDeckId, todayStr);

    const remainingNew = Math.max(0, newLimit - historyCounts.new);
    const remainingReview = Math.max(0, reviewLimit - historyCounts.review);

    const availableNew = Math.min(stats.newCards, remainingNew);
    const availableReview = Math.min(stats.due, remainingReview);

    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-due').textContent = stats.due;
    document.getElementById('stat-reviewed').textContent = stats.reviewed;
    document.getElementById('stat-new').textContent = stats.newCards;

    document.getElementById('btn-new-count').textContent = availableNew;
    document.getElementById('btn-review-count').textContent = availableReview;

    const duePill = document.getElementById('deck-detail-due-pill');
    if (stats.due > 0) {
      duePill.textContent = `${stats.due} Due Today`;
      duePill.classList.remove('hidden');
    } else {
      duePill.classList.add('hidden');
    }

    document.getElementById('btn-study-new').disabled = availableNew === 0;
    document.getElementById('btn-review').disabled = availableReview === 0;
  },

  // ---- Heatmap ----
  renderHeatmap() {
    const gridEl = document.getElementById('heatmap-grid');
    const monthsEl = document.getElementById('heatmap-months');
    const deckId = this.currentDeckId;

    const pastData = ReviewHistory.getGlobalHistory();
    const futureData = {};
    const deckCards = CardManager.getCardsForDeck(deckId);
    const todayStr = CardManager._dateStr(new Date());

    Object.values(deckCards).forEach(card => {
      if (card.dueDate > todayStr) {
        futureData[card.dueDate] = (futureData[card.dueDate] || 0) + 1;
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 330);
    const startDay = startDate.getDay();
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    startDate.setDate(startDate.getDate() + mondayOffset);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 60);
    const endDay = endDate.getDay();
    if (endDay !== 0) endDate.setDate(endDate.getDate() + (7 - endDay));

    let maxPast = 0;
    Object.values(pastData).forEach(v => { if (v > maxPast) maxPast = v; });
    let maxFuture = 0;
    Object.values(futureData).forEach(v => { if (v > maxFuture) maxFuture = v; });

    const cells = [];
    const monthLabels = [];
    let currentDate = new Date(startDate);
    let lastMonthLabel = -1;
    let weekIndex = 0;

    while (currentDate <= endDate) {
      const dateStr = this._dateToStr(currentDate);
      const dayOfWeek = currentDate.getDay();

      if (dayOfWeek === 1) {
        const month = currentDate.getMonth();
        if (month !== lastMonthLabel) {
          monthLabels.push({ weekIndex, label: currentDate.toLocaleString('default', { month: 'short' }) });
          lastMonthLabel = month;
        }
        weekIndex++;
      }

      const isToday = dateStr === todayStr;
      const isPast = dateStr <= todayStr;
      const pastCount = pastData[dateStr] || 0;
      const futureCount = futureData[dateStr] || 0;

      let colorClass = '';
      let tooltipText = '';

      if (isPast && pastCount > 0) {
        colorClass = this._greenLevel(pastCount, maxPast);
        tooltipText = `${dateStr}: ${pastCount} reviewed`;
      } else if (!isPast && futureCount > 0) {
        colorClass = this._greyLevel(futureCount, maxFuture);
        tooltipText = `${dateStr}: ${futureCount} scheduled`;
      } else {
        tooltipText = `${dateStr}: 0`;
      }

      cells.push(
        `<div class="heatmap-cell ${colorClass}${isToday ? ' today' : ''}" data-tooltip="${tooltipText}"></div>`
      );

      currentDate.setDate(currentDate.getDate() + 1);
    }

    gridEl.innerHTML = cells.join('');

    const totalWeeks = weekIndex;
    const cellSize = 16;
    monthsEl.innerHTML = '';
    monthLabels.forEach((m, i) => {
      const nextWeek = (i + 1 < monthLabels.length) ? monthLabels[i + 1].weekIndex : totalWeeks;
      const span = document.createElement('span');
      span.textContent = m.label;
      span.style.width = ((nextWeek - m.weekIndex) * cellSize) + 'px';
      monthsEl.appendChild(span);
    });

    const scrollEl = gridEl.parentElement;
    const todayCell = gridEl.querySelector('.today');
    if (todayCell && scrollEl) {
      const offset = todayCell.offsetLeft - scrollEl.clientWidth / 2;
      scrollEl.scrollLeft = Math.max(0, offset);
    }
  },

  _greenLevel(count, max) {
    if (max === 0) return '';
    const ratio = count / max;
    if (ratio <= 0.25) return 'g1';
    if (ratio <= 0.5) return 'g2';
    if (ratio <= 0.75) return 'g3';
    return 'g4';
  },

  _greyLevel(count, max) {
    if (max === 0) return '';
    const ratio = count / max;
    if (ratio <= 0.25) return 's1';
    if (ratio <= 0.5) return 's2';
    if (ratio <= 0.75) return 's3';
    return 's4';
  },

  _dateToStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  renderActivityStats() {
    const history = ReviewHistory.getGlobalHistory();
    const todayStr = CardManager._dateStr(new Date());

    const dates = Object.keys(history).filter(d => d <= todayStr).sort();
    const totalReviews = dates.reduce((sum, d) => sum + history[d], 0);
    const daysWithReviews = dates.length;

    const dailyAvg = daysWithReviews > 0 ? Math.round(totalReviews / daysWithReviews) : 0;
    document.getElementById('stat-daily-avg').textContent = `${dailyAvg} cards`;

    const last30 = new Set();
    const d30 = new Date();
    d30.setHours(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      const ds = this._dateToStr(d30);
      if (history[ds] && history[ds] > 0) last30.add(ds);
      d30.setDate(d30.getDate() - 1);
    }
    const pct = Math.round((last30.size / 30) * 100);
    document.getElementById('stat-days-learned').textContent = `${pct}%`;

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) {
      const ds = this._dateToStr(checkDate);
      if (history[ds] && history[ds] > 0) {
        currentStreak++;
      } else {
        if (i === 0) { /* today might not have reviews yet */ }
        else break;
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }

    if (dates.length > 0) {
      tempStreak = 1;
      longestStreak = 1;
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1] + 'T00:00:00');
        const curr = new Date(dates[i] + 'T00:00:00');
        const diff = (curr - prev) / (1000 * 60 * 60 * 24);
        if (diff === 1) {
          tempStreak++;
          if (tempStreak > longestStreak) longestStreak = tempStreak;
        } else {
          tempStreak = 1;
        }
      }
    }

    document.getElementById('stat-longest-streak').textContent = `${longestStreak} days`;
    document.getElementById('stat-current-streak').innerHTML = `${currentStreak} days <span class="streak-flame">🔥</span>`;
  },

  renderTodaysReviewedCount() {
    const todayStr = CardManager._dateStr(new Date());
    const counts = ReviewHistory.getCounts(this.currentDeckId, todayStr);
    document.getElementById('todays-reviewed-count').textContent = counts.total;
  },

  // ---- Today's Reviewed Modal ----
  openTodaysReviewedModal() {
    const todayStr = CardManager._dateStr(new Date());
    const deckCards = CardManager.getCardsForDeck(this.currentDeckId);
    const todaysCards = Object.values(deckCards).filter(c => c.lastReviewDate === todayStr);

    const count = todaysCards.length;
    document.getElementById('todays-reviewed-summary').textContent =
      `You reviewed ${count} card${count !== 1 ? 's' : ''} in this deck today.`;

    const listEl = document.getElementById('todays-reviewed-list');
    if (count === 0) {
      listEl.innerHTML = '<div class="folder-browser-empty">No reviews yet today. Start a practice session!</div>';
    } else {
      listEl.innerHTML = todaysCards.map(card => `
        <div class="due-card-item">
          <span class="card-name" title="${this._esc(card.imageName)}">${this._esc(card.imageName)}</span>
          <span class="card-difficulty ${card.difficulty}">${card.difficulty}</span>
          <span class="card-due-date">Next: ${this._formatFutureDate(card.dueDate)}</span>
        </div>
      `).join('');
    }

    document.getElementById('modal-todays-reviewed').classList.remove('hidden');
  },

  closeTodaysReviewedModal() {
    document.getElementById('modal-todays-reviewed').classList.add('hidden');
  },

  // ---- Practice Session ----
  async startSession(mode) {
    if (!this.cachedImages || this.cachedImages.length === 0) {
      alert('No images found in this deck folder.');
      return;
    }

    const deck = DeckManager.getById(this.currentDeckId);
    if (!deck) return;

    const newLimit = deck.newLimit || 20;
    const reviewLimit = deck.reviewLimit || 200;
    const todayStr = CardManager._dateStr(new Date());
    const historyCounts = ReviewHistory.getCounts(this.currentDeckId, todayStr);
    const remainingNew = Math.max(0, newLimit - historyCounts.new);
    const remainingReview = Math.max(0, reviewLimit - historyCounts.review);

    SessionManager.startSession(this.currentDeckId, mode, this.cachedImages, remainingNew, remainingReview);

    document.getElementById('session-deck-name').textContent = deck.name;
    const modeBadge = document.getElementById('session-mode-label');
    if (mode === 'new') modeBadge.textContent = 'Study New';
    else if (mode === 'review') modeBadge.textContent = 'Review Due';
    else modeBadge.textContent = 'Free Study';

    modeBadge.className = 'session-mode-badge' + (mode === 'review' ? ' review' : '');

    this.showView('view-session');
    document.getElementById('review-empty').classList.add('hidden');
    this.showSessionContent(true);

    ArtistToolbox.reset();
    this.startTimerIfNeeded();
    this.showNextImage();
  },

  showNextImage() {
    const image = SessionManager.nextImage();

    if (!image) {
      this.showSessionContent(false);
      TimerManager.stop();

      // Show celebratory summary modal if cards were rated in this session
      if (SessionManager.sessionStats.total > 0) {
        this.openSessionSummaryModal();
      } else {
        document.getElementById('review-empty').classList.remove('hidden');
      }
      return;
    }

    this.clearBlurOverlay();
    ArtistToolbox.reset();

    const imgEl = document.getElementById('session-image');
    imgEl.src = SessionManager.getImageUrl(image.id);
    document.getElementById('session-image-name').textContent = image.name;

    document.getElementById('session-progress').textContent = `#${SessionManager.imagesShown}`;

    this.updateRatingIntervals();

    document.getElementById('btn-timer-pause').textContent = 'Pause';
    if (this.getTimerDuration() > 0 && TimerManager.isRunning()) {
      TimerManager.reset();
    } else if (this.getTimerDuration() > 0) {
      this.startTimerIfNeeded();
    }
  },

  openSessionSummaryModal() {
    const stats = SessionManager.sessionStats;
    const deck = DeckManager.getById(this.currentDeckId);

    document.getElementById('summary-deck-title').textContent = deck ? deck.name : 'Practice Session';
    document.getElementById('summary-total-reviewed').textContent = stats.total;

    // Calculate current streak
    const history = ReviewHistory.getGlobalHistory();
    let currentStreak = 0;
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const ds = this._dateToStr(checkDate);
      if (history[ds] && history[ds] > 0) currentStreak++;
      else if (i !== 0) break;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    document.getElementById('summary-streak-val').innerHTML = `${currentStreak} days <span class="streak-flame">🔥</span>`;

    document.getElementById('summary-breakdown').innerHTML = `
      <span style="color: var(--easy-color)">Easy: ${stats.easy}</span>
      <span style="color: var(--medium-color)">Medium: ${stats.medium}</span>
      <span style="color: var(--hard-color)">Hard: ${stats.hard}</span>
    `;

    document.getElementById('modal-session-summary').classList.remove('hidden');
    SoundFX.sessionComplete();
    ParticleFX.celebrate();
  },

  showBlurOverlay() {
    this.imageBlurred = true;
    document.getElementById('image-blur-overlay').classList.remove('hidden');
    document.getElementById('btn-skip').classList.add('hidden');
  },

  clearBlurOverlay() {
    this.imageBlurred = false;
    document.getElementById('image-blur-overlay').classList.add('hidden');
    document.getElementById('btn-skip').classList.remove('hidden');
  },

  updateRatingIntervals() {
    if (!SessionManager.currentImage) return;

    const imageId = SessionManager.currentImage.id;
    const deckId = SessionManager.deckId;

    ['hard', 'medium', 'easy'].forEach(diff => {
      const days = CardManager.getProjectedInterval(deckId, imageId, diff);
      const label = days === 1 ? '1 day' : `${days} days`;
      document.querySelector(`#btn-rate-${diff} .rate-interval`).textContent = label;
    });
  },

  rateCurrentImage(difficulty) {
    if (!SessionManager.currentImage) return;

    SoundFX.rate(difficulty);
    const btn = document.getElementById(`btn-rate-${difficulty}`);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      if (difficulty === 'easy') {
        ParticleFX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 16, ['#39d353', '#56d364', '#ffffff', '#ffd166']);
      } else {
        ParticleFX.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 8);
      }
    }

    const image = SessionManager.currentImage;
    CardManager.rateCard(
      SessionManager.deckId,
      image.id,
      image.name,
      difficulty
    );

    // Track session stats
    SessionManager.sessionStats[difficulty]++;
    SessionManager.sessionStats.total++;

    this.clearBlurOverlay();
    this.showNextImage();
  },

  endSession() {
    TimerManager.stop();
    if (this.isZenMode) this.toggleZenMode(false);
    this.openDeckDetail(this.currentDeckId);
  },

  showSessionContent(show) {
    const elements = ['.image-container', '.rating-area', '#timer-display'];
    elements.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) {
        if (show) {
          if (sel === '#timer-display' && this.getTimerDuration() > 0) {
            el.classList.remove('hidden');
          } else if (sel !== '#timer-display') {
            el.classList.remove('hidden');
          }
        } else {
          el.classList.add('hidden');
        }
      }
    });
  },

  // ---- Timer Logic ----
  getTimerDuration() {
    const selected = document.querySelector('input[name="timer"]:checked');
    if (!selected) return 0;

    if (selected.value === 'custom') {
      const customVal = parseInt(document.getElementById('custom-timer-input').value, 10);
      return isNaN(customVal) ? 0 : customVal;
    }
    return parseInt(selected.value, 10);
  },

  startTimerIfNeeded() {
    const duration = this.getTimerDuration();
    const timerDisplay = document.getElementById('timer-display');

    if (duration <= 0) {
      timerDisplay.classList.add('hidden');
      return;
    }

    timerDisplay.classList.remove('hidden');

    TimerManager.start(
      duration,
      false,
      (remaining, total) => {
        const pct = (remaining / total) * 100;
        const bar = document.getElementById('timer-bar');
        const text = document.getElementById('timer-text');
        bar.style.width = pct + '%';
        bar.className = 'timer-bar';
        text.className = 'timer-text';

        if (remaining <= 5 || pct < 15) {
          bar.classList.add('danger');
          text.classList.add('danger');
        } else if (remaining <= 10 || pct < 35) {
          bar.classList.add('warning');
        }

        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        text.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      },
      () => {
        const text = document.getElementById('timer-text');
        text.className = 'timer-text';
        text.textContent = '0:00';
        document.getElementById('timer-bar').style.width = '0%';
        this.showBlurOverlay();
      }
    );
  },

  toggleTimerPause() {
    const paused = TimerManager.togglePause();
    document.getElementById('btn-timer-pause').textContent = paused ? 'Resume' : 'Pause';
    this.showToast(paused ? 'Timer Paused [Space]' : 'Timer Resumed', paused ? '⏸' : '▶');
  },

  resetTimer() {
    TimerManager.reset();
    document.getElementById('btn-timer-pause').textContent = 'Pause';
    this.showToast('Timer Reset', '⏱');
  },

  // ---- Deck Modal ----
  openDeckModal(editDeckId = null) {
    const modal = document.getElementById('modal-deck');
    const title = document.getElementById('modal-deck-title');
    const nameInput = document.getElementById('input-deck-name');
    const folderInput = document.getElementById('input-deck-folder');
    const newLimitInput = document.getElementById('input-deck-new-limit');
    const reviewLimitInput = document.getElementById('input-deck-review-limit');
    const errorEl = document.getElementById('folder-error');

    errorEl.classList.add('hidden');
    if (newLimitInput) newLimitInput.value = '20';
    if (reviewLimitInput) reviewLimitInput.value = '200';

    if (editDeckId) {
      const deck = DeckManager.getById(editDeckId);
      title.textContent = 'Edit Deck';
      nameInput.value = deck.name;
      folderInput.value = deck.folderPath;
      if (newLimitInput && deck.newLimit !== undefined) newLimitInput.value = deck.newLimit;
      if (reviewLimitInput && deck.reviewLimit !== undefined) reviewLimitInput.value = deck.reviewLimit;
      modal.dataset.editId = editDeckId;
    } else {
      title.textContent = 'New Deck';
      nameInput.value = '';
      folderInput.value = '';
      delete modal.dataset.editId;
    }

    modal.classList.remove('hidden');
    nameInput.focus();
  },

  closeDeckModal() {
    document.getElementById('modal-deck').classList.add('hidden');
  },

  async handleDeckSubmit(e) {
    e.preventDefault();
    const modal = document.getElementById('modal-deck');
    const name = document.getElementById('input-deck-name').value.trim();
    const folder = document.getElementById('input-deck-folder').value.trim();
    const newLimit = document.getElementById('input-deck-new-limit').value;
    const reviewLimit = document.getElementById('input-deck-review-limit').value;
    const errorEl = document.getElementById('folder-error');

    if (!name || !folder) return;

    try {
      errorEl.classList.add('hidden');
      const res = await fetch(`/api/images?folder=${encodeURIComponent(folder)}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
    } catch (err) {
      errorEl.textContent = `Folder error: ${err.message}`;
      errorEl.classList.remove('hidden');
      return;
    }

    const editId = modal.dataset.editId;
    if (editId) {
      DeckManager.update(editId, name, folder, newLimit, reviewLimit);
      this.showToast('Deck updated', '✏️');
    } else {
      DeckManager.create(name, folder, newLimit, reviewLimit);
      this.showToast('Deck created', '✨');
    }

    this.closeDeckModal();

    if (editId && this.currentDeckId === editId) {
      this.openDeckDetail(editId);
    } else {
      this.showDeckList();
    }
  },

  // ---- Folder Browser ----
  async openFolderBrowser() {
    const currentVal = document.getElementById('input-deck-folder').value.trim();
    await this.browseTo(currentVal || undefined);
    document.getElementById('modal-folder-browser').classList.remove('hidden');
  },

  closeFolderBrowser() {
    document.getElementById('modal-folder-browser').classList.add('hidden');
  },

  async browseTo(folderPath) {
    try {
      const url = folderPath
        ? `/api/browse?path=${encodeURIComponent(folderPath)}`
        : '/api/browse';
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const data = await res.json();
      this.folderBrowserCurrentPath = data.current;
      this.renderFolderBrowser(data);
    } catch (err) {
      if (folderPath) {
        await this.browseTo(undefined);
      }
    }
  },

  renderFolderBrowser(data) {
    document.getElementById('folder-browser-path').textContent = data.current;
    document.getElementById('folder-browser-img-count').textContent =
      data.imageCount > 0 ? `${data.imageCount} images here` : 'No images here';

    const upBtn = document.getElementById('folder-browser-up');
    if (data.current !== data.parent) {
      upBtn.classList.remove('hidden');
    } else {
      upBtn.classList.add('hidden');
    }

    const listEl = document.getElementById('folder-browser-list');
    const emptyEl = document.getElementById('folder-browser-empty');

    if (data.dirs.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
      listEl.innerHTML = data.dirs.map(dir => `
        <div class="folder-item" data-path="${this._esc(data.current + '/' + dir)}">
          📁 <span>${this._esc(dir)}</span>
        </div>
      `).join('');

      listEl.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', () => {
          this.browseTo(item.dataset.path);
        });
      });
    }
  },

  browseFolderUp() {
    if (!this.folderBrowserCurrentPath) return;
    const parts = this.folderBrowserCurrentPath.split('/');
    parts.pop();
    const parent = parts.join('/') || '/';
    this.browseTo(parent);
  },

  selectBrowsedFolder() {
    if (this.folderBrowserCurrentPath) {
      document.getElementById('input-deck-folder').value = this.folderBrowserCurrentPath;
    }
    this.closeFolderBrowser();
  },

  // ---- Delete Modal ----
  openDeleteModal() {
    const deck = DeckManager.getById(this.currentDeckId);
    document.getElementById('delete-deck-name').textContent = deck.name;
    document.getElementById('modal-delete').classList.remove('hidden');
  },

  closeDeleteModal() {
    document.getElementById('modal-delete').classList.add('hidden');
  },

  confirmDelete() {
    DeckManager.delete(this.currentDeckId);
    this.closeDeleteModal();
    this.showDeckList();
    this.showToast('Deck deleted', '🗑️');
  },

  // ---- Helpers ----
  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  _formatFutureDate(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays < 7) return `In ${diffDays} days`;
    return dateStr;
  }
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
});
