/* ============================================
   Art Practice Reference — App Logic
   Modules: Storage, WallpaperManager,
            DeckManager, CardManager, ReviewHistory,
            TimerManager, SessionManager, ArtistToolbox,
            UI
   ============================================ */

// Document Picture-in-Picture (PiP) Transparent DOM Resolution
const PiPState = {
  isActive: false,
  window: null,

  getElementById(id) {
    if (this.isActive && this.window && !this.window.closed) {
      try {
        const el = this.window.document.getElementById(id);
        if (el) return el;
      } catch (e) { }
    }
    return null;
  },

  querySelector(selector) {
    if (this.isActive && this.window && !this.window.closed) {
      try {
        const el = this.window.document.querySelector(selector);
        if (el) return el;
      } catch (e) { }
    }
    return null;
  },

  querySelectorAll(selector) {
    if (this.isActive && this.window && !this.window.closed) {
      try {
        const list = this.window.document.querySelectorAll(selector);
        if (list && list.length > 0) return list;
      } catch (e) { }
    }
    return null;
  }
};

const _origGetElementById = document.getElementById.bind(document);
document.getElementById = function (id) {
  return PiPState.getElementById(id) || _origGetElementById(id);
};

const _origQuerySelector = document.querySelector.bind(document);
document.querySelector = function (selector) {
  return PiPState.querySelector(selector) || _origQuerySelector(selector);
};

const _origQuerySelectorAll = document.querySelectorAll.bind(document);
document.querySelectorAll = function (selector) {
  return PiPState.querySelectorAll(selector) || _origQuerySelectorAll(selector);
};

// ==================== STORAGE (DISK-BACKED WITH LOCALSTORAGE MIGRATION) ====================
const Storage = {
  DECKS_KEY: 'artpractice_decks',
  CARDS_KEY: 'artpractice_cards',
  HISTORY_KEY: 'artpractice_history',
  WALLPAPER_SETTINGS_KEY: 'artpractice_wallpaper_settings',

  // In-memory state cache (loaded directly from userdata/srs_state.json on disk)
  _decks: null,
  _cards: null,
  _history: null,
  _wallpaperSettings: null,
  _syncTimeout: null,
  _isSyncing: false,
  _lastSyncedTime: null,
  _isDiskLoaded: false,

  /**
   * Initializes storage on app boot.
   * Loads userdata/srs_state.json from disk via GET /api/sync.
   * If disk state does not exist yet or is empty, migrates existing localStorage data to disk!
   */
  async init() {
    // 1. Read existing localStorage in case we need to merge or migrate
    this._loadFromLocalStorage();

    try {
      const res = await fetch('/api/sync');
      if (res.ok) {
        const json = await res.json();
        if (json.exists && json.data) {
          const d = json.data;

          const diskHasDecks = Array.isArray(d.decks) && d.decks.length > 0;
          const diskHasCards = d.cards && Object.keys(d.cards).length > 0;
          const localHasDecks = this._decks && this._decks.length > 0;
          const localHasCards = this._cards && Object.keys(this._cards).length > 0;

          // If disk has data (or both are empty), disk is the source of truth
          if (diskHasDecks || diskHasCards || (!localHasDecks && !localHasCards)) {
            this._decks = Array.isArray(d.decks) ? d.decks : [];
            this._cards = d.cards && typeof d.cards === 'object' ? d.cards : {};
            this._history = d.history && typeof d.history === 'object' ? d.history : {};
            this._wallpaperSettings = d.wallpaperSettings || this._wallpaperSettings;
            this._lastSyncedTime = json.lastSaved;
            this._isDiskLoaded = true;

            // Mirror to localStorage in background (safely inside try/catch)
            this._mirrorToLocalStorage();
            console.log('[Storage] Loaded SRS database directly from disk (userdata/srs_state.json):', {
              decks: this._decks.length,
              cards: Object.keys(this._cards).length
            });

            this._bindUnloadListeners();
            return;
          }
        }
      }
    } catch (err) {
      console.warn('[Storage] Could not reach /api/sync on startup, falling back to localStorage:', err.message);
    }

    // Disk file doesn't exist yet or is empty while localStorage has data:
    // Migrate localStorage to disk immediately!
    const hasData = (this._decks && this._decks.length > 0) || (this._cards && Object.keys(this._cards).length > 0);
    if (hasData) {
      console.log('[Storage] Migrating existing localStorage data to userdata/srs_state.json on disk...');
      this.syncToDisk(false).catch(() => { });
    }

    this._bindUnloadListeners();
  },

  _bindUnloadListeners() {
    // Flush pending changes to disk when leaving or hiding the tab
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.syncToDisk(false).catch(() => { });
      }
    });
    window.addEventListener('beforeunload', () => {
      this.syncToDisk(false).catch(() => { });
    });
  },

  _loadFromLocalStorage() {
    try {
      const rawDecks = localStorage.getItem(this.DECKS_KEY);
      this._decks = rawDecks ? JSON.parse(rawDecks) : [];
    } catch (e) { this._decks = []; }

    try {
      const rawCards = localStorage.getItem(this.CARDS_KEY);
      this._cards = rawCards ? JSON.parse(rawCards) : {};
    } catch (e) { this._cards = {}; }

    try {
      const rawHistory = localStorage.getItem(this.HISTORY_KEY);
      this._history = rawHistory ? JSON.parse(rawHistory) : {};
    } catch (e) { this._history = {}; }

    try {
      const rawWall = localStorage.getItem(this.WALLPAPER_SETTINGS_KEY);
      this._wallpaperSettings = rawWall ? JSON.parse(rawWall) : { blur: 8, dim: 50, hasCustom: false };
    } catch (e) { this._wallpaperSettings = { blur: 8, dim: 50, hasCustom: false }; }
  },

  _mirrorToLocalStorage() {
    try {
      if (this._decks) localStorage.setItem(this.DECKS_KEY, JSON.stringify(this._decks));
    } catch (e) { }
    try {
      if (this._cards) localStorage.setItem(this.CARDS_KEY, JSON.stringify(this._cards));
    } catch (e) { }
    try {
      if (this._history) localStorage.setItem(this.HISTORY_KEY, JSON.stringify(this._history));
    } catch (e) { }
    try {
      if (this._wallpaperSettings) localStorage.setItem(this.WALLPAPER_SETTINGS_KEY, JSON.stringify(this._wallpaperSettings));
    } catch (e) { }
  },

  getDecks() {
    if (this._decks === null) this._loadFromLocalStorage();
    return this._decks || [];
  },

  saveDecks(decks) {
    this._decks = decks;
    try {
      localStorage.setItem(this.DECKS_KEY, JSON.stringify(decks));
    } catch (e) {
      console.warn('[Storage] localStorage quota reached or unavailable; relying on disk sync.');
    }
    this.scheduleDiskSync();
  },

  getCards() {
    if (this._cards === null) this._loadFromLocalStorage();
    return this._cards || {};
  },

  saveCards(cards) {
    this._cards = cards;
    try {
      localStorage.setItem(this.CARDS_KEY, JSON.stringify(cards));
    } catch (e) {
      console.warn('[Storage] localStorage quota reached or unavailable; relying on disk sync.');
    }
    this.scheduleDiskSync();
  },

  getHistory() {
    if (this._history === null) this._loadFromLocalStorage();
    return this._history || {};
  },

  saveHistory(history) {
    this._history = history;
    try {
      localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('[Storage] localStorage quota reached or unavailable; relying on disk sync.');
    }
    this.scheduleDiskSync();
  },

  getWallpaperSettings() {
    if (this._wallpaperSettings === null) this._loadFromLocalStorage();
    return this._wallpaperSettings || { blur: 8, dim: 50, hasCustom: false };
  },

  saveWallpaperSettings(settings) {
    this._wallpaperSettings = settings;
    try {
      localStorage.setItem(this.WALLPAPER_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { }
    this.scheduleDiskSync();
  },

  /**
   * Debounced sync scheduler (batches frequent rating / tagging updates)
   */
  scheduleDiskSync(delayMs = 1500) {
    clearTimeout(this._syncTimeout);
    this._syncTimeout = setTimeout(() => {
      this.syncToDisk(false).catch(() => { });
    }, delayMs);
  },

  /**
   * Writes the entire SRS database directly to userdata/srs_state.json on disk.
   * Can be awaited immediately after every practice session!
   */
  async syncToDisk(showToastNotice = false) {
    clearTimeout(this._syncTimeout);
    const payload = {
      decks: this._decks || this.getDecks(),
      cards: this._cards || this.getCards(),
      history: this._history || this.getHistory(),
      wallpaperSettings: this._wallpaperSettings || this.getWallpaperSettings(),
      clientTimestamp: new Date().toISOString()
    };

    try {
      this._isSyncing = true;
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      this._lastSyncedTime = result.lastSaved;
      this._isDiskLoaded = true;

      if (showToastNotice && typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Session synced to disk (userdata/srs_state.json)', 'save');
      }

      return result;
    } catch (err) {
      console.error('[Storage] Error syncing to disk:', err);
      if (showToastNotice && typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast(`Disk sync issue: ${err.message}`, 'alert');
      }
      throw err;
    } finally {
      this._isSyncing = false;
    }
  },

  async syncToServer(showToastNotice = false) {
    return this.syncToDisk(showToastNotice);
  }
};

// ==================== TACTILE SOUND FX (Web Audio API) ====================
// ==================== TACTILE SOUND FX (Web Audio API) ====================
const SoundFX = {
  ctx: null,
  enabled: true,

  init() {
    const saved = localStorage.getItem('artpractice_sound_enabled');
    this.enabled = saved !== null ? saved === 'true' : true;
    this.updateUI();

    // Aggressively unlock Web Audio context on any user touch/click/key
    const unlockAudio = () => {
      const ctx = this._getCtx();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
    };
    ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'].forEach(ev => {
      window.addEventListener(ev, unlockAudio, { passive: true });
    });
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

  _play(fn) {
    if (!this.enabled) return;
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          try { fn(ctx, ctx.currentTime); } catch (e) { }
        }).catch(() => { });
      } else {
        fn(ctx, ctx.currentTime);
      }
    } catch (e) { }
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
    const text = this.enabled ? 'Sound' : 'Muted';
    const soundIconEl = document.getElementById('sound-icon');
    const soundTextEl = document.getElementById('sound-text');
    const iconSvg = typeof UI !== 'undefined' && UI.getIconSvg ? UI.getIconSvg(this.enabled ? 'volume' : 'volume-x', 14) : '';
    if (soundIconEl && iconSvg) soundIconEl.innerHTML = iconSvg;
    if (soundTextEl) soundTextEl.textContent = text;

    const detailIconEl = document.getElementById('detail-sound-icon');
    if (detailIconEl && iconSvg) detailIconEl.innerHTML = iconSvg;

    const sessionIconEl = document.getElementById('session-sound-icon');
    if (sessionIconEl && iconSvg) sessionIconEl.innerHTML = iconSvg;

    const btn1 = document.getElementById('btn-toggle-sound');
    if (btn1) btn1.classList.toggle('btn-muted', !this.enabled);
    const btn2 = document.getElementById('btn-detail-sound');
    if (btn2) btn2.classList.toggle('btn-muted', !this.enabled);
    const btn3 = document.getElementById('btn-session-sound');
    if (btn3) btn3.classList.toggle('btn-muted', !this.enabled);
  },

  // Highlighting & Fluid Tactile Click (water droplet pop + crystal snap + tactile thump)
  click() {
    this._play((ctx, t) => {
      // Micro-pitch variance (±5%) for rich organic, non-fatiguing fluidity
      const pitch = 1 + (Math.random() - 0.5) * 0.1;

      // Master output gain node
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.38, t);
      master.connect(ctx.destination);

      // --- Layer 1: Resonant Water Droplet "Bloop" Swoop ---
      const dropOsc = ctx.createOscillator();
      const dropGain = ctx.createGain();
      const dropFilter = ctx.createBiquadFilter();

      dropOsc.type = 'sine';
      // Classic water droplet pop: starts at resonant high and sweeps down with body
      dropOsc.frequency.setValueAtTime(640 * pitch, t);
      dropOsc.frequency.exponentialRampToValueAtTime(240 * pitch, t + 0.08);

      // Peaking formant filter gives unmistakable fluid droplet resonance
      dropFilter.type = 'peaking';
      dropFilter.frequency.setValueAtTime(720 * pitch, t);
      dropFilter.Q.setValueAtTime(4.2, t);
      dropFilter.gain.setValueAtTime(6, t);

      dropGain.gain.setValueAtTime(0.001, t);
      dropGain.gain.linearRampToValueAtTime(0.85, t + 0.004);
      dropGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

      dropOsc.connect(dropFilter);
      dropFilter.connect(dropGain);
      dropGain.connect(master);
      dropOsc.start(t);
      dropOsc.stop(t + 0.12);

      // --- Layer 2: Highlighting Crystalline Glass Ping ---
      const glassOsc = ctx.createOscillator();
      const glassGain = ctx.createGain();
      const glassFilter = ctx.createBiquadFilter();

      glassOsc.type = 'triangle';
      glassOsc.frequency.setValueAtTime(2200 * pitch, t);
      glassOsc.frequency.exponentialRampToValueAtTime(1400 * pitch, t + 0.07);

      glassFilter.type = 'highpass';
      glassFilter.frequency.setValueAtTime(1100, t);

      glassGain.gain.setValueAtTime(0.001, t);
      glassGain.gain.linearRampToValueAtTime(0.35, t + 0.002);
      glassGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

      glassOsc.connect(glassFilter);
      glassFilter.connect(glassGain);
      glassGain.connect(master);
      glassOsc.start(t);
      glassOsc.stop(t + 0.085);

      // --- Layer 3: Warm Tactile Sub Body ---
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(130 * pitch, t);
      subOsc.frequency.exponentialRampToValueAtTime(55 * pitch, t + 0.05);

      subGain.gain.setValueAtTime(0.001, t);
      subGain.gain.linearRampToValueAtTime(0.5, t + 0.003);
      subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

      subOsc.connect(subGain);
      subGain.connect(master);
      subOsc.start(t);
      subOsc.stop(t + 0.065);
    });
  },

  // Silky fluid droplet hover
  hover() {
    this._play((ctx, t) => {
      const pitch = 1 + (Math.random() - 0.5) * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750 * pitch, t);
      filter.Q.setValueAtTime(3.0, t);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(820 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(540 * pitch, t + 0.035);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.045);
    });
  },

  // Card rating sounds (Again, Hard, Medium, Easy)
  rate(diff) {
    this._play((ctx, t) => {
      if (diff === 'again') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, t);
        osc.frequency.exponentialRampToValueAtTime(75, t + 0.22);

        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.25);
      } else if (diff === 'hard') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(120, t + 0.2);

        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.23);
      } else if (diff === 'medium') {
        [440, 554.37].forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const start = t + idx * 0.05;
          osc.frequency.setValueAtTime(f, start);

          gain.gain.setValueAtTime(0.001, t);
          gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.38);
        });
      } else if (diff === 'easy') {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const start = t + idx * 0.06;
          osc.frequency.setValueAtTime(f, start);

          gain.gain.setValueAtTime(0.001, t);
          gain.gain.exponentialRampToValueAtTime(0.22, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.58);
        });
      }
    });
  },

  // Soft organic tick when timer <= 5s
  timerTick() {
    this._play((ctx, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(580, t + 0.03);

      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.04);
    });
  },

  // Zen singing bowl when timer runs out
  timerAlert() {
    this._play((ctx, t) => {
      [528, 660, 792].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = t + idx * 0.07;
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 1.5);
      });
    });
  },

  // Session complete victory fanfare
  sessionComplete() {
    this._play((ctx, t) => {
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99]; // C4, E4, G4, C5, E5, G5
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx >= 3 ? 'sine' : 'triangle';
        const start = t + idx * 0.08;
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 1.2);
      });
    });
  },

  // Snappy pop for toolbar items
  toolToggle() {
    this._play((ctx, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(940, t + 0.035);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.045);
    });
  },

  // Chirp when unmuting
  chirp() {
    this._play((ctx, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(820, t + 0.07);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    });
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

    // Check fast localStorage cache first for zero-flicker immediate render
    try {
      const cached = localStorage.getItem('artpractice_wallpaper_data');
      if (cached) {
        this.currentWallpaperDataUrl = cached;
        this.applyStyles();
      }
    } catch (e) { }

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

    // Save to localStorage cache if under 2.5MB
    try {
      if (dataUrl.length < 2500000) {
        localStorage.setItem('artpractice_wallpaper_data', dataUrl);
      } else {
        localStorage.removeItem('artpractice_wallpaper_data');
      }
    } catch (e) { }

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
    UI.showToast('Custom wallpaper applied', 'palette');
  },

  async removeWallpaper() {
    this.currentWallpaperDataUrl = null;
    this.settings.hasCustom = false;
    Storage.saveWallpaperSettings(this.settings);
    try {
      localStorage.removeItem('artpractice_wallpaper_data');
    } catch (e) { }

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
    UI.showToast('Wallpaper reset to default', 'broom');
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

    const hasCustom = Boolean(this.currentWallpaperDataUrl && this.settings.hasCustom);
    document.body.classList.toggle('has-wallpaper', hasCustom);

    if (hasCustom) {
      bgEl.style.backgroundImage = `url("${this.currentWallpaperDataUrl.replace(/"/g, '\\"')}")`;
      bgEl.style.opacity = '1';
      overlayEl.style.opacity = '1';
    } else {
      bgEl.style.backgroundImage = 'none';
      bgEl.style.opacity = '0';
      overlayEl.style.opacity = '0';
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
    const deck = this.decks.find(d => d.id === id);
    if (deck) {
      if (!deck.folder && deck.folderPath) deck.folder = deck.folderPath;
      if (!deck.folderPath && deck.folder) deck.folderPath = deck.folder;
    }
    return deck;
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

  /** Rate an image card (SM-2 variant with Mean Reversion & Timer-Weighted scaling) */
  rateCard(deckId, imageId, imageName, difficulty, studyDuration = null) {
    if (!this.cards[deckId]) {
      this.cards[deckId] = {};
    }

    if (studyDuration === null) {
      studyDuration = (typeof UI !== 'undefined' && UI.getTimerDuration)
        ? UI.getTimerDuration()
        : (typeof TimerManager !== 'undefined' ? TimerManager.duration : 0);
    }

    const existing = this.cards[deckId][imageId];
    const now = new Date();
    const todayStr = this._dateStr(now);
    const isNewCard = !existing || !existing.difficulty;
    const prevReviews = existing ? (existing.reviewCount || 0) : 0;
    const prevEase = Math.max(1.5, Math.min(3.0, existing ? (existing.easeFactor || 1.5) : 1.5));
    const prevConsecutive = existing
      ? (existing.consecutiveSuccesses || (existing.difficulty === 'medium' || existing.difficulty === 'easy' ? 1 : 0))
      : 0;

    const targetEase = 2.3;
    const minEase = 1.5;
    const maxEase = 3.0;

    let interval, easeFactor, consecutiveSuccesses = 0;

    if (difficulty === 'again') {
      // Again (<10m reset button): resets interval, increases lapses, remains due today for immediate recall
      interval = 0;
      // Capped at minimum 1.5 ease (prevents Ease Hell)
      easeFactor = Math.max(minEase, Math.min(maxEase, Math.round((prevEase - 0.2) * 100) / 100));
      consecutiveSuccesses = 0;
    } else if (isNewCard) {
      switch (difficulty) {
        case 'hard':
          interval = 1;
          easeFactor = 1.5; // Capped at min 1.5
          consecutiveSuccesses = 0;
          break;
        case 'medium':
          interval = 3;
          easeFactor = 1.8;
          consecutiveSuccesses = 1;
          break;
        case 'easy':
          interval = 7;
          // Timer-weighted scaling: short gesture drill (<= 45s) caps Easy jump to max 4 days
          if (studyDuration > 0 && studyDuration <= 45) {
            interval = Math.min(interval, 4);
          }
          easeFactor = 2.0;
          consecutiveSuccesses = 1;
          break;
      }
    } else {
      const prevInterval = existing.interval || 1;

      switch (difficulty) {
        case 'hard':
          interval = Math.max(1, Math.round(prevInterval * 0.5));
          // Minimum ease capped at 1.5 (prevents permanent SM-2 Ease Hell)
          easeFactor = Math.max(minEase, Math.min(maxEase, Math.round((prevEase - 0.15) * 100) / 100));
          consecutiveSuccesses = 0;
          break;
        case 'medium':
          interval = Math.max(prevInterval + 1, Math.round(prevInterval * prevEase));
          // Soft mean-reversion toward 2.3 on consecutive successes with NO constant offset shift
          if (prevConsecutive >= 1) {
            const diff = targetEase - prevEase;
            if (Math.abs(diff) < 0.005) {
              easeFactor = targetEase;
            } else {
              const step = Math.round(0.10 * diff * 100) / 100;
              if (step === 0) {
                easeFactor = diff > 0 ? Math.min(targetEase, prevEase + 0.01) : Math.max(targetEase, prevEase - 0.01);
              } else {
                easeFactor = prevEase + step;
              }
            }
            consecutiveSuccesses = prevConsecutive + 1;
          } else {
            easeFactor = prevEase;
            consecutiveSuccesses = 1;
          }
          easeFactor = Math.max(minEase, Math.min(maxEase, Math.round(easeFactor * 100) / 100));
          break;
        case 'easy':
          interval = Math.max(prevInterval + 2, Math.round(prevInterval * prevEase * 1.3));
          // Timer-weighted scaling: if studied with very short timer (<= 45s) on first 2 reviews, cap to max 4 days
          if (prevReviews < 2 && studyDuration > 0 && studyDuration <= 45) {
            interval = Math.min(interval, 4);
          }
          // Easy awards an explicit ease reward (+0.10), capped at maxEase 3.0
          easeFactor = prevEase + 0.10;
          consecutiveSuccesses = prevConsecutive + 1;
          easeFactor = Math.max(minEase, Math.min(maxEase, Math.round(easeFactor * 100) / 100));
          break;
      }
    }

    const dueDate = new Date(now);
    if (interval > 0) {
      dueDate.setDate(dueDate.getDate() + interval);
    }

    const lapses = ((existing && existing.lapses) || 0) + (difficulty === 'again' ? 1 : 0);

    this.cards[deckId][imageId] = {
      imageId,
      imageName: (existing && existing.imageName) || imageName,
      isChild: Boolean(existing && existing.isChild),
      parentImageId: (existing && existing.parentImageId) || null,
      parentPath: (existing && existing.parentPath) || '',
      parentHash: (existing && existing.parentHash) || '',
      crop: (existing && existing.crop) || null,
      difficulty,
      interval,
      easeFactor,
      consecutiveSuccesses,
      lastStudyDuration: studyDuration || 0,
      dueDate: interval === 0 ? todayStr : this._dateStr(dueDate),
      lapses,
      reviewCount: prevReviews + 1,
      lastReviewDate: todayStr,
      firstReviewDate: existing ? (existing.firstReviewDate || todayStr) : todayStr,
      tags: existing && Array.isArray(existing.tags) ? existing.tags : [],
      attempts: existing && Array.isArray(existing.attempts) ? existing.attempts : []
    };

    this.save();
    ReviewHistory.record(deckId, isNewCard);

    return this.cards[deckId][imageId];
  },

  getProjectedInterval(deckId, imageId, difficulty, studyDuration = null) {
    if (difficulty === 'again') {
      return '<10m';
    }

    if (studyDuration === null) {
      studyDuration = (typeof UI !== 'undefined' && UI.getTimerDuration)
        ? UI.getTimerDuration()
        : (typeof TimerManager !== 'undefined' ? TimerManager.duration : 0);
    }

    const existing = this.getCard(deckId, imageId);
    const isNew = !existing || !existing.difficulty;
    const prevReviews = existing ? (existing.reviewCount || 0) : 0;

    let projected = 1;
    if (isNew) {
      switch (difficulty) {
        case 'hard': projected = 1; break;
        case 'medium': projected = 3; break;
        case 'easy': projected = 7; break;
      }
    } else {
      const prevInterval = existing.interval || 1;
      const prevEase = Math.max(1.5, Math.min(3.0, existing.easeFactor || 1.5));

      switch (difficulty) {
        case 'hard':
          projected = Math.max(1, Math.round(prevInterval * 0.5));
          break;
        case 'medium':
          projected = Math.max(prevInterval + 1, Math.round(prevInterval * prevEase));
          break;
        case 'easy':
          projected = Math.max(prevInterval + 2, Math.round(prevInterval * prevEase * 1.3));
          break;
      }
    }

    // Timer-weighted scaling: short gesture drill (<= 45s) on first 2 reviews caps Easy jump to max 4 days
    if (difficulty === 'easy' && prevReviews < 2 && studyDuration > 0 && studyDuration <= 45) {
      projected = Math.min(projected, 4);
    }

    return projected;
  },

  getAttempts(deckId, imageId) {
    const card = this.getCard(deckId, imageId);
    return card && Array.isArray(card.attempts) ? [...card.attempts] : [];
  },

  async addAttempt(deckId, imageId, attempt) {
    if (!deckId || !imageId || !attempt) return [];
    if (!this.cards[deckId]) this.cards[deckId] = {};
    if (!this.cards[deckId][imageId]) {
      this.cards[deckId][imageId] = {
        imageId,
        imageName: imageId.split('/').pop(),
        reviewCount: 0,
        attempts: []
      };
    }
    const card = this.cards[deckId][imageId];
    if (!Array.isArray(card.attempts)) card.attempts = [];

    let sketchUrl = attempt.sketchUrl || attempt.dataUrl || '';
    if (typeof sketchUrl === 'string' && sketchUrl.startsWith('data:image/')) {
      try {
        const res = await fetch('/api/sketch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: card.imageId, dataUrl: sketchUrl })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.sketchUrl) {
            sketchUrl = data.sketchUrl;
          }
        }
      } catch (err) {
        console.warn('[CardManager] Failed to upload sketch to /api/sketch:', err);
      }
    }

    const attemptObj = {
      date: attempt.date || CardManager._dateStr(new Date()),
      rating: attempt.rating || 'medium',
      sketchUrl: sketchUrl
    };
    if (attempt.id) attemptObj.id = attempt.id;
    if (attempt.filename) attemptObj.filename = attempt.filename;
    if (attempt.timestamp) attemptObj.timestamp = attempt.timestamp;

    card.attempts.push(attemptObj);
    if (card.attempts.length > 15) {
      card.attempts.shift();
    }
    this.save();

    if (typeof Storage !== 'undefined') {
      if (typeof Storage.syncToServer === 'function') {
        Storage.syncToServer(false).catch(() => { });
      } else if (typeof Storage.syncToDisk === 'function') {
        Storage.syncToDisk(false).catch(() => { });
      }
    }

    return card.attempts;
  },

  getTagsForCard(deckId, imageId) {
    const card = this.getCard(deckId, imageId);
    return card && Array.isArray(card.tags) ? [...card.tags] : [];
  },

  addTagToCard(deckId, imageId, imageName, tag) {
    if (!deckId || !imageId) return [];
    const clean = (tag || '').trim().toLowerCase().replace(/^#/, '');
    if (!clean) return this.getTagsForCard(deckId, imageId);

    if (!this.cards[deckId]) {
      this.cards[deckId] = {};
    }

    if (!this.cards[deckId][imageId]) {
      this.cards[deckId][imageId] = {
        imageId,
        imageName: imageName || imageId.split('/').pop(),
        tags: [clean],
        reviewCount: 0
      };
    } else {
      const card = this.cards[deckId][imageId];
      if (!Array.isArray(card.tags)) card.tags = [];
      if (!card.tags.includes(clean)) {
        card.tags.push(clean);
      }
    }

    this.save();
    return [...this.cards[deckId][imageId].tags];
  },

  removeTagFromCard(deckId, imageId, tag) {
    if (!deckId || !imageId || !this.cards[deckId] || !this.cards[deckId][imageId]) return [];
    const clean = (tag || '').trim().toLowerCase().replace(/^#/, '');
    const card = this.cards[deckId][imageId];
    if (Array.isArray(card.tags)) {
      card.tags = card.tags.filter(t => t !== clean);
      this.save();
      return [...card.tags];
    }
    return [];
  },

  toggleTagForCard(deckId, imageId, imageName, tag) {
    const clean = (tag || '').trim().toLowerCase().replace(/^#/, '');
    if (!clean) return { tags: [], added: false };
    const currentTags = this.getTagsForCard(deckId, imageId);
    if (currentTags.includes(clean)) {
      const remaining = this.removeTagFromCard(deckId, imageId, clean);
      return { tags: remaining, added: false, tag: clean };
    } else {
      const updated = this.addTagToCard(deckId, imageId, imageName, clean);
      return { tags: updated, added: true, tag: clean };
    }
  },

  getAllTagsForDeck(deckId) {
    const deckCards = this.cards[deckId] || {};
    const tagCounts = {};
    Object.values(deckCards).forEach(card => {
      if (Array.isArray(card.tags)) {
        card.tags.forEach(t => {
          const clean = t.trim().toLowerCase();
          if (clean) tagCounts[clean] = (tagCounts[clean] || 0) + 1;
        });
      }
    });
    return tagCounts;
  },

  getCardsByTag(deckId, tag) {
    const deckCards = this.cards[deckId] || {};
    const clean = (tag || '').trim().toLowerCase().replace(/^#/, '');
    return Object.values(deckCards).filter(c => Array.isArray(c.tags) && c.tags.includes(clean));
  },

  getChildCards(deckId) {
    const deckCards = this.cards[deckId] || {};
    return Object.values(deckCards).filter(c => c && c.isChild);
  },

  createChildCard(deckId, parentImage, crop, label, tags = []) {
    if (!deckId || !parentImage || !crop) return null;
    if (!this.cards[deckId]) this.cards[deckId] = {};

    const cleanLabel = (label || '').trim();
    const parentId = parentImage.id || parentImage.hash || parentImage.path;
    const safeHash = String(parentImage.hash || parentId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(-16);
    const childId = `crop_${safeHash}_${Date.now().toString(36)}`;
    const todayStr = this._dateStr(new Date());

    const cleanTags = Array.isArray(tags)
      ? tags.map(t => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean)
      : [];

    const childCard = {
      imageId: childId,
      parentImageId: parentId,
      parentPath: parentImage.path || '',
      parentHash: parentImage.hash || '',
      imageName: cleanLabel ? `[${cleanLabel}] ${parentImage.name || 'reference'}` : `[Focal Crop] ${parentImage.name || 'reference'}`,
      isChild: true,
      crop: {
        x: Math.max(0, Math.min(1, crop.x)),
        y: Math.max(0, Math.min(1, crop.y)),
        w: Math.max(0.01, Math.min(1, crop.w)),
        h: Math.max(0.01, Math.min(1, crop.h))
      },
      tags: cleanTags,
      difficulty: null,
      interval: 1,
      easeFactor: 1.5,
      dueDate: todayStr,
      reviewCount: 0,
      firstReviewDate: todayStr,
      attempts: []
    };

    this.cards[deckId][childId] = childCard;
    this.save();
    return childCard;
  },

  deleteChildCard(deckId, childId) {
    if (!deckId || !childId || !this.cards[deckId]) return false;
    if (this.cards[deckId][childId] && this.cards[deckId][childId].isChild) {
      delete this.cards[deckId][childId];
      this.save();
      return true;
    }
    return false;
  },

  /** Calculate overdue lapse and difficulty priority score (higher = needs review first) */
  getCardPriority(card) {
    if (!card) return 0;
    const now = new Date();
    const todayStr = this._dateStr(now);

    let overdueDays = 0;
    if (card.dueDate && card.dueDate < todayStr) {
      const dueTime = new Date(card.dueDate + 'T00:00:00').getTime();
      const todayTime = new Date(todayStr + 'T00:00:00').getTime();
      overdueDays = Math.max(0, Math.round((todayTime - dueTime) / 86400000));
    }

    const lapseNorm = 1 - Math.exp(-(card.lapses || 0) / 3);
    const overdueNorm = 1 - Math.exp(-Math.max(0, overdueDays) / 14);
    const easeNorm = Math.max(0, Math.min(1, (3.0 - (card.easeFactor || 2.5)) / 1.5));

    return (lapseNorm * 40) + (overdueNorm * 35) + (easeNorm * 25);
  },

  getDueCards(deckId, tagFilter = null, sortByPriority = true) {
    const deckCards = this.cards[deckId];
    if (!deckCards) return [];

    const todayStr = this._dateStr(new Date());
    let list = Object.values(deckCards).filter(c => c && c.difficulty && c.dueDate <= todayStr);
    if (tagFilter) {
      const clean = tagFilter.trim().toLowerCase().replace(/^#/, '');
      list = list.filter(c => Array.isArray(c.tags) && c.tags.includes(clean));
    }

    if (sortByPriority) {
      list.sort((a, b) => this.getCardPriority(b) - this.getCardPriority(a));
    }

    return list;
  },

  /**
   * Overdue Backlog Load-Balancer:
   * Keeps the top `reviewLimit` highest-priority cards due today, and spreads excess
   * overdue cards evenly across the next 5 days (+1 to +5 days) with one click.
   */
  reflowOverdueBacklog(deckId) {
    if (!this.cards[deckId]) {
      return { reflowedCount: 0, retainedToday: 0, totalDue: 0, limit: 0, message: 'No cards in deck.' };
    }

    const deck = DeckManager.getById(deckId);
    const todayStr = this._dateStr(new Date());

    if (deck && deck.lastReflowDate === todayStr) {
      const currentDue = this.getDueCards(deckId, null, false).length;
      const reviewLimit = (deck && deck.reviewLimit && deck.reviewLimit > 0) ? deck.reviewLimit : 200;
      return {
        reflowedCount: 0,
        retainedToday: currentDue,
        totalDue: currentDue,
        limit: reviewLimit,
        message: 'Backlog reflow has already been run today for this deck.'
      };
    }

    const reviewLimit = (deck && deck.reviewLimit && deck.reviewLimit > 0) ? deck.reviewLimit : 200;

    // Get all due cards sorted by priority (highest lapse/difficulty priority first)
    const dueCards = this.getDueCards(deckId, null, true);
    const totalDue = dueCards.length;

    if (totalDue <= reviewLimit) {
      return {
        reflowedCount: 0,
        retainedToday: totalDue,
        totalDue,
        limit: reviewLimit,
        message: `Due queue (${totalDue}) is already within your daily limit (${reviewLimit}). No reflow needed.`
      };
    }

    // Keep the top `reviewLimit` highest-priority cards due today
    const retainedToday = reviewLimit;
    const excessCards = dueCards.slice(reviewLimit);
    const reflowedCount = excessCards.length;

    const now = new Date();
    // Spread excess cards evenly across the next 5 days (+1 to +5 days)
    excessCards.forEach((card, idx) => {
      const dayOffset = (idx % 5) + 1; // 1, 2, 3, 4, 5, 1, 2, 3...
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      card.dueDate = this._dateStr(targetDate);
      card.lastReflowDate = todayStr;
    });

    if (deck) {
      deck.lastReflowDate = todayStr;
      if (typeof DeckManager !== 'undefined' && typeof DeckManager.save === 'function') {
        DeckManager.save();
      }
    }

    this.save();
    if (typeof Storage !== 'undefined' && Storage.syncToDisk) {
      Storage.syncToDisk(false).catch(() => { });
    }

    return {
      reflowedCount,
      retainedToday,
      totalDue,
      limit: reviewLimit,
      message: `Reflowed ${reflowedCount} excess overdue cards across the next 5 days (keeping top ${retainedToday} today).`
    };
  },

  getStats(deckId, totalImages, tagFilter = null) {
    const deckCards = this.cards[deckId] || {};
    const todayStr = this._dateStr(new Date());

    if (!tagFilter) {
      const childCount = Object.values(deckCards).filter(c => c && c.isChild).length;
      const effectiveTotal = totalImages + childCount;
      const reviewed = Object.values(deckCards).filter(c => c && c.difficulty).length;
      const due = Object.values(deckCards).filter(c => c && c.difficulty && c.dueDate <= todayStr).length;
      return {
        total: effectiveTotal,
        reviewed,
        newCards: Math.max(0, effectiveTotal - reviewed),
        due
      };
    }

    const clean = tagFilter.trim().toLowerCase().replace(/^#/, '');
    const taggedCards = Object.values(deckCards).filter(c => Array.isArray(c.tags) && c.tags.includes(clean));
    const reviewed = taggedCards.filter(c => c && c.difficulty).length;
    const due = taggedCards.filter(c => c && c.difficulty && c.dueDate <= todayStr).length;
    const totalTagged = taggedCards.length;

    return {
      total: totalTagged,
      reviewed,
      newCards: Math.max(0, totalTagged - reviewed),
      due
    };
  },

  deleteForDeck(deckId) {
    delete this.cards[deckId];
    this.save();
  },

  /**
   * Migrate existing path-keyed cards to content-hash IDs when folder images are loaded.
   * Ensures review history follows the image even if it's renamed or moved!
   */
  migrateLegacyPathCards(deckId, images) {
    if (!this.cards[deckId] || !Array.isArray(images) || images.length === 0) return 0;

    const deckCards = this.cards[deckId];
    let migratedCount = 0;

    images.forEach(img => {
      if (img.path && img.id && img.path !== img.id) {
        // Case 1: Card was stored under absolute file path -> migrate to content hash ID
        if (deckCards[img.path]) {
          const oldCard = deckCards[img.path];
          if (!deckCards[img.id]) {
            deckCards[img.id] = {
              ...oldCard,
              imageId: img.id,
              previousPath: img.path,
              imageName: img.name || oldCard.imageName
            };
          } else {
            // Both exist: preserve highest review count, newest stats, and merge tags
            const target = deckCards[img.id];
            const oldTags = Array.isArray(oldCard.tags) ? oldCard.tags : [];
            const newTags = Array.isArray(target.tags) ? target.tags : [];
            target.tags = Array.from(new Set([...oldTags, ...newTags]));
            const oldAttempts = Array.isArray(oldCard.attempts) ? oldCard.attempts : [];
            const newAttempts = Array.isArray(target.attempts) ? target.attempts : [];
            target.attempts = [...oldAttempts, ...newAttempts].slice(-15);
            if ((oldCard.reviewCount || 0) > (target.reviewCount || 0)) {
              target.difficulty = oldCard.difficulty || target.difficulty;
              target.interval = oldCard.interval || target.interval;
              target.easeFactor = oldCard.easeFactor || target.easeFactor;
              target.dueDate = oldCard.dueDate || target.dueDate;
              target.reviewCount = Math.max(target.reviewCount || 0, oldCard.reviewCount || 0);
            }
          }
          delete deckCards[img.path];
          migratedCount++;
        } else if (deckCards[img.id] && img.name && deckCards[img.id].imageName !== img.name) {
          // File was renamed or moved: keep review history, update relative display name!
          deckCards[img.id].imageName = img.name;
          migratedCount++;
        }
      }
    });

    if (migratedCount > 0) {
      this.save();
      console.log(`[CardManager] Migrated/updated ${migratedCount} cards to content-hash IDs in deck "${deckId}"`);
    }

    return migratedCount;
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

// ==================== TAG PRESETS ====================
const TAG_PRESETS = [
  { id: 'hands', label: 'Hands', icon: 'hand', key: '1' },
  { id: 'foreshortening', label: 'Foreshortening', icon: 'perspective', key: '2' },
  { id: 'lighting', label: 'Lighting', icon: 'lightbulb', key: '3' },
  { id: 'anatomy', label: 'Anatomy', icon: 'bone', key: '4' },
  { id: 'gesture', label: 'Gesture', icon: 'gesture', key: '5' },
  { id: 'leech', label: 'Leech', icon: 'leech', key: '6' }
];

// ==================== SESSION MANAGER ====================
const SessionManager = {
  deckId: null,
  mode: null,          // 'new', 'review', or 'free'
  tagFilter: null,     // Active sub-deck tag filter (e.g. 'hands', 'foreshortening')
  images: [],          // Images currently in rotation (filtered if tagFilter active)
  allDeckImages: [],   // Unfiltered images in deck folder
  queue: [],           // Queue of image IDs
  currentImage: null,  // Current image object
  imagesShown: 0,
  sessionStats: { again: 0, hard: 0, medium: 0, easy: 0, total: 0 },

  async loadImages(folderPath) {
    const res = await fetch(`/api/images?folder=${encodeURIComponent(folderPath)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load images');
    }
    this.allDeckImages = await res.json();
    this.images = this.allDeckImages;
    return this.images;
  },

  startSession(deckId, mode, images, newLimit, reviewLimit, tagFilter = null) {
    this.deckId = deckId;
    this.mode = mode;
    this.tagFilter = tagFilter ? tagFilter.trim().toLowerCase().replace(/^#/, '') : null;
    this.imagesShown = 0;
    this.sessionStats = { again: 0, hard: 0, medium: 0, easy: 0, total: 0 };

    const deckCards = CardManager.getCardsForDeck(deckId);

    // Merge child focal cards from CardManager into image pool without duplicating files on disk
    const childCards = CardManager.getChildCards(deckId);
    const childImages = childCards.map(c => ({
      id: c.imageId,
      path: c.parentPath,
      hash: c.parentHash,
      name: c.imageName,
      isChild: true,
      crop: c.crop,
      parentImageId: c.parentImageId
    }));

    const basePool = [...(Array.isArray(images) ? images : []), ...childImages];
    this.allDeckImages = basePool;

    // If tagFilter is active, filter image pool exclusively to tagged cards
    let pool = this.allDeckImages;
    if (this.tagFilter) {
      pool = this.allDeckImages.filter(img => {
        const card = deckCards[img.id] || (!img.isChild && img.path && deckCards[img.path]);
        return card && Array.isArray(card.tags) && card.tags.includes(this.tagFilter);
      });
    }
    this.images = pool;

    if (mode === 'free') {
      this.queue = this._shuffle(pool.map(img => img.id));
    } else if (mode === 'new') {
      const unseenIds = pool
        .map(img => img.id)
        .filter(id => {
          const imgObj = pool.find(i => i.id === id);
          const card = deckCards[id] || (!imgObj?.isChild && imgObj?.path && deckCards[imgObj.path]);
          return !card || !card.difficulty;
        });
      this.queue = this._shuffle(unseenIds).slice(0, newLimit);
    } else if (mode === 'review') {
      // Automatic daily queue sorting: orders overdue cards by highest lapse/difficulty priority first
      const dueCards = CardManager.getDueCards(deckId, this.tagFilter, true);
      const dueCardMap = new Map();
      dueCards.forEach(c => dueCardMap.set(c.imageId, c));

      // Filter pool images that are due
      const eligiblePoolImages = pool.filter(img => dueCardMap.has(img.id) || (!img.isChild && img.path && dueCardMap.has(img.path)));

      // Sort pool images in descending order of card priority score
      eligiblePoolImages.sort((a, b) => {
        const cardA = dueCardMap.get(a.id) || dueCardMap.get(a.path);
        const cardB = dueCardMap.get(b.id) || dueCardMap.get(b.path);
        return CardManager.getCardPriority(cardB) - CardManager.getCardPriority(cardA);
      });

      const selected = eligiblePoolImages.slice(0, reviewLimit);
      // SessionManager.nextImage() pops from the end of this.queue.
      // Reversing the priority-sorted array guarantees that the highest priority card is popped FIRST.
      this.queue = selected.map(img => img.id).reverse();
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
    this.currentImage = this.images.find(img => img.id === imageId) || this.allDeckImages.find(img => img.id === imageId);
    this.imagesShown++;
    return this.currentImage;
  },

  requeueCard(imageId) {
    if (!imageId) return;
    if (this.queue.length > 3) {
      const insertIdx = Math.max(0, this.queue.length - 3);
      this.queue.splice(insertIdx, 0, imageId);
    } else {
      this.queue.unshift(imageId);
    }
  },

  getImageUrl(imageOrId) {
    if (!imageOrId) return '';
    if (typeof imageOrId === 'object') {
      const target = imageOrId.path || imageOrId.id;
      return `/api/image?path=${encodeURIComponent(target)}`;
    }
    const found = (this.images || []).find(img => img.id === imageOrId || img.hash === imageOrId || img.path === imageOrId)
      || (this.allDeckImages || []).find(img => img.id === imageOrId || img.hash === imageOrId || img.path === imageOrId);
    const target = found ? (found.path || found.id) : imageOrId;
    return `/api/image?path=${encodeURIComponent(target)}`;
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
  notan: false,
  silhouette: false,
  silhouetteThreshold: 0.50, // 0.05 to 0.95 (default 50%)
  silhouetteInverted: false,
  posterize: false,
  posterizeSteps: 3,          // 2 to 6, default 3 (light, halftone, shadow — atelier foundation)
  posterizeMonochrome: true,
  squint: false,
  squintRadius: 6,            // 1 to 24px, default 6px
  gridMode: -1,        // index into GRID_MODES, -1 = grid off
  invert: false,
  flipX: 1,
  rotate: 0,           // logical rotation (0 / 90 / 180 / 270)
  rotateTotal: 0,      // cumulative rotation so the spin animation never reverses
  zoom: 1,
  panX: 0,
  panY: 0,
  fitScale: 1,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  MIN_ZOOM: 0.3,
  MAX_ZOOM: 8,

  // Proportion grid presets — cycled with [O] / the Grid button
  GRID_MODES: [
    { id: 'thirds', label: '3×3', name: 'Rule of Thirds (3×3)', cols: 3, rows: 3 },
    { id: 'quarters', label: '4×4', name: 'Quarters (4×4)', cols: 4, rows: 4 },
    { id: 'fine', label: '8×8', name: 'Fine Measure Grid (8×8)', cols: 8, rows: 8 },
    { id: 'diagonals', label: 'Diag', name: 'Axes & Diagonals', cols: 2, rows: 2, diagonals: true }
  ],

  get grid() {
    return this.gridMode >= 0;
  },

  _getElement(id) {
    if (typeof UI !== 'undefined' && UI.pipWindow && !UI.pipWindow.closed) {
      const el = UI.pipWindow.document.getElementById(id);
      if (el) return el;
    }
    return document.getElementById(id);
  },

  reset() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.rotate = 0;
    this.rotateTotal = 0;
    this.flipX = 1;
    this.grayscale = false;
    this.notan = false;
    this.silhouette = false;
    this.posterize = false;
    this.squint = false;
    this.squintRadius = 6;
    this.invert = false;
    this.updateSquintFilter();
    this._syncVisualFilters();
    this.fitImage(false);
  },

  _syncVisualFilters() {
    const container = this._getElement('session-image-container');
    if (!container) return;
    container.classList.toggle('filter-grayscale', this.grayscale);
    container.classList.toggle('filter-notan', this.notan);
    container.classList.toggle('filter-silhouette', this.silhouette);
    container.classList.toggle('filter-posterize', this.posterize);
    container.classList.toggle('filter-squint', this.squint);
    container.classList.toggle('filter-invert', this.invert);

    const gBtn = this._getElement('btn-art-grayscale');
    if (gBtn) gBtn.classList.toggle('active', this.grayscale);
    const nBtn = this._getElement('btn-art-notan');
    if (nBtn) nBtn.classList.toggle('active', this.notan);
    const sBtn = this._getElement('btn-art-silhouette');
    if (sBtn) sBtn.classList.toggle('active', this.silhouette);
    const pBtn = this._getElement('btn-art-posterize');
    if (pBtn) pBtn.classList.toggle('active', this.posterize);
    const sqBtn = this._getElement('btn-art-squint');
    if (sqBtn) sqBtn.classList.toggle('active', this.squint);
    const iBtn = this._getElement('btn-art-invert');
    if (iBtn) iBtn.classList.toggle('active', this.invert);

    this._syncFilterPanels();
    if (typeof UI !== 'undefined' && UI.updateCategoryIndicators) {
      UI.updateCategoryIndicators();
    }
  },

  _syncFilterPanels() {
    const dock = this._getElement('filter-controls-dock');
    const silPanel = this._getElement('panel-silhouette-controls');
    const postPanel = this._getElement('panel-posterize-controls');
    const squintPanel = this._getElement('panel-squint-controls');
    if (!dock) return;

    const hasAnyPanel = this.silhouette || this.posterize || this.squint;
    dock.classList.toggle('hidden', !hasAnyPanel);

    if (silPanel) {
      silPanel.classList.toggle('hidden', !this.silhouette);
      if (this.silhouette) {
        const silSlider = this._getElement('slider-silhouette-threshold');
        if (silSlider) silSlider.value = Math.round(this.silhouetteThreshold * 100);
        const silVal = this._getElement('val-silhouette-thresh');
        if (silVal) silVal.textContent = `${Math.round(this.silhouetteThreshold * 100)}%`;
        const silInvertBtn = this._getElement('btn-silhouette-invert');
        if (silInvertBtn) silInvertBtn.classList.toggle('active', this.silhouetteInverted);
      }
    }

    if (postPanel) {
      postPanel.classList.toggle('hidden', !this.posterize);
      if (this.posterize) {
        const postSlider = this._getElement('slider-posterize-steps');
        if (postSlider) postSlider.value = this.posterizeSteps;
        const postVal = this._getElement('val-posterize-steps');
        if (postVal) postVal.textContent = this.posterizeSteps;

        const p3 = this._getElement('btn-posterize-preset-3');
        const p4 = this._getElement('btn-posterize-preset-4');
        if (p3) p3.classList.toggle('active', this.posterizeSteps === 3);
        if (p4) p4.classList.toggle('active', this.posterizeSteps === 4);

        this.renderTonalChips(this.posterizeSteps);
      }
    }

    if (squintPanel) {
      squintPanel.classList.toggle('hidden', !this.squint);
      if (this.squint) {
        const sqSlider = this._getElement('slider-squint-radius');
        if (sqSlider) sqSlider.value = this.squintRadius;
        const sqVal = this._getElement('val-squint-radius');
        if (sqVal) sqVal.textContent = `${this.squintRadius}px`;

        const pLight = this._getElement('btn-squint-preset-light');
        const pMed = this._getElement('btn-squint-preset-medium');
        const pHeavy = this._getElement('btn-squint-preset-heavy');
        if (pLight) pLight.classList.toggle('active', this.squintRadius === 3);
        if (pMed) pMed.classList.toggle('active', this.squintRadius === 8);
        if (pHeavy) pHeavy.classList.toggle('active', this.squintRadius === 16);
      }
    }
  },

  renderTonalChips(steps) {
    const container = document.getElementById('posterize-tonal-chips');
    if (!container) return;

    let html = '';
    if (steps === 4) {
      html = `
        <span class="tonal-chip chip-light" title="Direct form light and specular highlights"><span class="tonal-dot dot-light"></span> Light</span>
        <span class="tonal-chip chip-halftone" title="Midtones & turning plane receiving grazing light"><span class="tonal-dot dot-halftone"></span> Halftone</span>
        <span class="tonal-chip chip-core" title="Form shadow core & terminator line"><span class="tonal-dot dot-core"></span> Core Shadow</span>
        <span class="tonal-chip chip-occlusion" title="Ambient occlusion, crevices & deepest darks"><span class="tonal-dot dot-occlusion"></span> Occlusion</span>
      `;
    } else if (steps === 3) {
      html = `
        <span class="tonal-chip chip-light" title="Direct form light and illuminated planes"><span class="tonal-dot dot-light"></span> Light</span>
        <span class="tonal-chip chip-halftone" title="Midtones & transitional values"><span class="tonal-dot dot-halftone"></span> Halftone</span>
        <span class="tonal-chip chip-shadow" title="Shadow family (core shadow, reflected light, occlusion)"><span class="tonal-dot dot-shadow"></span> Shadow</span>
      `;
    } else if (steps === 2) {
      html = `
        <span class="tonal-chip chip-light" title="Light family"><span class="tonal-dot dot-light"></span> Light</span>
        <span class="tonal-chip chip-shadow" title="Shadow family"><span class="tonal-dot dot-shadow"></span> Shadow (Notan)</span>
      `;
    } else if (steps === 5) {
      html = `
        <span class="tonal-chip chip-highlight" title="Specular highlights"><span class="tonal-dot dot-highlight"></span> Highlight</span>
        <span class="tonal-chip chip-light" title="Direct form light"><span class="tonal-dot dot-light"></span> Light</span>
        <span class="tonal-chip chip-halftone" title="Midtones"><span class="tonal-dot dot-halftone"></span> Halftone</span>
        <span class="tonal-chip chip-core" title="Core shadow"><span class="tonal-dot dot-core"></span> Core Shadow</span>
        <span class="tonal-chip chip-occlusion" title="Ambient occlusion"><span class="tonal-dot dot-occlusion"></span> Occlusion</span>
      `;
    } else {
      html = `
        <span class="tonal-chip chip-highlight"><span class="tonal-dot dot-highlight"></span> Highlight</span>
        <span class="tonal-chip chip-light"><span class="tonal-dot dot-light"></span> Light</span>
        <span class="tonal-chip chip-halftone"><span class="tonal-dot dot-halftone"></span> High Halftone</span>
        <span class="tonal-chip chip-halftone"><span class="tonal-dot dot-halftone"></span> Low Halftone</span>
        <span class="tonal-chip chip-core"><span class="tonal-dot dot-core"></span> Core Shadow</span>
        <span class="tonal-chip chip-occlusion"><span class="tonal-dot dot-occlusion"></span> Occlusion</span>
      `;
    }
    container.innerHTML = html;
  },

  updateSilhouetteFilter() {
    const r = document.getElementById('fe-silhouette-r');
    const g = document.getElementById('fe-silhouette-g');
    const b = document.getElementById('fe-silhouette-b');
    if (!r || !g || !b) return;

    const S = 280;
    const slope = this.silhouetteInverted ? -S : S;
    const intercept = this.silhouetteInverted ? (S * this.silhouetteThreshold) : (-S * this.silhouetteThreshold);

    [r, g, b].forEach(el => {
      el.setAttribute('type', 'linear');
      el.setAttribute('slope', slope.toFixed(2));
      el.setAttribute('intercept', intercept.toFixed(2));
    });

    this._refreshImageFilter();
  },

  setSilhouetteThreshold(val) {
    const parsed = Math.max(5, Math.min(95, parseInt(val, 10) || 50));
    this.silhouetteThreshold = parsed / 100;
    this.updateSilhouetteFilter();
    const silVal = document.getElementById('val-silhouette-thresh');
    if (silVal) silVal.textContent = `${parsed}%`;
  },

  adjustSilhouetteThreshold(delta) {
    SoundFX.toolToggle();
    const current = Math.round(this.silhouetteThreshold * 100);
    const next = Math.max(5, Math.min(95, current + Math.round(delta * 100)));
    this.setSilhouetteThreshold(next);
    const silSlider = document.getElementById('slider-silhouette-threshold');
    if (silSlider) silSlider.value = next;
  },

  toggleSilhouetteInvert() {
    SoundFX.toolToggle();
    this.silhouetteInverted = !this.silhouetteInverted;
    this.updateSilhouetteFilter();
    const btn = document.getElementById('btn-silhouette-invert');
    if (btn) btn.classList.toggle('active', this.silhouetteInverted);
  },

  resetSilhouetteThreshold() {
    SoundFX.toolToggle();
    this.silhouetteThreshold = 0.50;
    this.silhouetteInverted = false;
    this.updateSilhouetteFilter();
    const silSlider = document.getElementById('slider-silhouette-threshold');
    if (silSlider) silSlider.value = 50;
    const silVal = document.getElementById('val-silhouette-thresh');
    if (silVal) silVal.textContent = '50%';
    const btn = document.getElementById('btn-silhouette-invert');
    if (btn) btn.classList.remove('active');
  },

  updatePosterizeFilter() {
    const r = document.getElementById('fe-posterize-r');
    const g = document.getElementById('fe-posterize-g');
    const b = document.getElementById('fe-posterize-b');
    if (!r || !g || !b) return;

    const steps = Math.max(2, Math.min(6, this.posterizeSteps));
    const values = [];
    for (let i = 0; i < steps; i++) {
      values.push((i / (steps - 1)).toFixed(3));
    }
    const tableStr = values.join(' ');

    [r, g, b].forEach(el => {
      el.setAttribute('type', 'discrete');
      el.setAttribute('tableValues', tableStr);
    });

    this._refreshImageFilter();
  },

  setPosterizeSteps(steps) {
    const parsed = Math.max(2, Math.min(6, parseInt(steps, 10) || 4));
    this.posterizeSteps = parsed;
    this.updatePosterizeFilter();

    const postSlider = document.getElementById('slider-posterize-steps');
    if (postSlider) postSlider.value = parsed;
    const postVal = document.getElementById('val-posterize-steps');
    if (postVal) postVal.textContent = parsed;

    const p3 = document.getElementById('btn-posterize-preset-3');
    const p4 = document.getElementById('btn-posterize-preset-4');
    if (p3) p3.classList.toggle('active', parsed === 3);
    if (p4) p4.classList.toggle('active', parsed === 4);

    this.renderTonalChips(parsed);
  },

  adjustPosterizeSteps(delta) {
    SoundFX.toolToggle();
    const next = Math.max(2, Math.min(6, this.posterizeSteps + delta));
    this.setPosterizeSteps(next);
  },

  _refreshImageFilter() {
    const img = document.getElementById('session-image');
    if (img) {
      img.style.transform = img.style.transform;
    }
  },

  toggleGrayscale() {
    SoundFX.toolToggle();
    this.grayscale = !this.grayscale;
    if (this.grayscale) {
      this.notan = false;
      this.silhouette = false;
      this.posterize = false;
    }
    this._syncVisualFilters();
    this._hudPop('btn-art-grayscale');
  },

  toggleNotan() {
    SoundFX.toolToggle();
    this.notan = !this.notan;
    if (this.notan) {
      this.grayscale = false;
      this.silhouette = false;
      this.posterize = false;
    }
    this._syncVisualFilters();
    this._hudPop('btn-art-notan');
  },

  toggleSilhouette() {
    SoundFX.toolToggle();
    this.silhouette = !this.silhouette;
    if (this.silhouette) {
      this.grayscale = false;
      this.notan = false;
      this.posterize = false;
      this.updateSilhouetteFilter();
      if (typeof UI !== 'undefined' && UI.toggleToolDock) UI.toggleToolDock(true);
    }
    this._syncVisualFilters();
    this._hudPop('btn-art-silhouette');
  },

  togglePosterize() {
    SoundFX.toolToggle();
    this.posterize = !this.posterize;
    if (this.posterize) {
      this.grayscale = false;
      this.notan = false;
      this.silhouette = false;
      this.updatePosterizeFilter();
      if (typeof UI !== 'undefined' && UI.toggleToolDock) UI.toggleToolDock(true);
    }
    this._syncVisualFilters();
    this._hudPop('btn-art-posterize');
  },

  toggleSquint() {
    SoundFX.toolToggle();
    this.squint = !this.squint;
    this.updateSquintFilter();
    if (this.squint && typeof UI !== 'undefined' && UI.toggleToolDock) UI.toggleToolDock(true);
    this._syncVisualFilters();
    this._hudPop('btn-art-squint');
  },

  updateSquintFilter() {
    const radius = this.squint ? this.squintRadius : 0;
    const targets = [];
    const mainFe = document.getElementById('fe-squint-blur');
    if (mainFe) targets.push(mainFe);
    if (typeof UI !== 'undefined' && UI.pipWindow && !UI.pipWindow.closed) {
      try {
        const pipFe = UI.pipWindow.document.getElementById('fe-squint-blur');
        if (pipFe) targets.push(pipFe);
      } catch (e) { }
    }

    targets.forEach(el => {
      el.setAttribute('stdDeviation', String(radius));
    });

    this._refreshImageFilter();

    if (typeof UI !== 'undefined' && UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  setSquintRadius(val) {
    const parsed = Math.max(1, Math.min(24, parseInt(val, 10) || 6));
    this.squintRadius = parsed;
    if (this.squint) {
      this.updateSquintFilter();
    }
    const sqVal = this._getElement('val-squint-radius');
    if (sqVal) sqVal.textContent = `${parsed}px`;
    const sqSlider = this._getElement('slider-squint-radius');
    if (sqSlider) sqSlider.value = parsed;

    const pLight = this._getElement('btn-squint-preset-light');
    const pMed = this._getElement('btn-squint-preset-medium');
    const pHeavy = this._getElement('btn-squint-preset-heavy');
    if (pLight) pLight.classList.toggle('active', parsed === 3);
    if (pMed) pMed.classList.toggle('active', parsed === 8);
    if (pHeavy) pHeavy.classList.toggle('active', parsed === 16);
  },

  adjustSquintRadius(delta) {
    SoundFX.toolToggle();
    const next = Math.max(1, Math.min(24, this.squintRadius + delta));
    this.setSquintRadius(next);
  },

  /**
   * Software HTML5 Canvas processor fallback for silhouette & posterize
   */
  processImageOnCanvas(imgEl, mode, options = {}) {
    const canvas = document.createElement('canvas');
    const width = imgEl.naturalWidth || imgEl.width || 800;
    const height = imgEl.naturalHeight || imgEl.height || 600;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, width, height);

    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      const len = data.length;

      if (mode === 'silhouette') {
        const threshold = (options.threshold ?? this.silhouetteThreshold) * 255;
        const inverted = options.inverted ?? this.silhouetteInverted;
        for (let i = 0; i < len; i += 4) {
          const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          const val = inverted ? (lum < threshold ? 255 : 0) : (lum < threshold ? 0 : 255);
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
        }
      } else if (mode === 'posterize') {
        const steps = Math.max(2, Math.min(8, options.steps ?? this.posterizeSteps));
        for (let i = 0; i < len; i += 4) {
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          const stepIdx = Math.min(steps - 1, Math.floor(lum * steps));
          const val = Math.round((stepIdx / (steps - 1)) * 255);
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } catch (e) {
      console.warn('Canvas pixel processing skipped (CORS/taint):', e);
    }
    return canvas;
  },

  _hudPop(btnId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.classList.remove('just-toggled');
    void btn.offsetWidth; // reflow to restart animation
    btn.classList.add('just-toggled');
    setTimeout(() => btn.classList.remove('just-toggled'), 350);
  },

  // Cycles: 3×3 → 4×4 → 8×8 → axes & diagonals → off
  toggleGrid() {
    SoundFX.toolToggle();
    this.gridMode++;
    if (this.gridMode >= this.GRID_MODES.length) this.gridMode = -1;
    this._syncGrid();
  },

  _syncGrid() {
    const overlay = document.getElementById('image-grid-overlay');
    const btn = document.getElementById('btn-art-grid');
    const label = document.getElementById('grid-mode-label');
    const mode = this.GRID_MODES[this.gridMode];

    if (!overlay) return;
    if (!mode) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      if (btn) btn.classList.remove('active');
      if (label) label.classList.add('hidden');
      return;
    }

    const lines = [];
    for (let i = 1; i < mode.cols; i++) {
      const p = ((i / mode.cols) * 100).toFixed(3);
      lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="100"/>`);
    }
    for (let i = 1; i < mode.rows; i++) {
      const p = ((i / mode.rows) * 100).toFixed(3);
      lines.push(`<line x1="0" y1="${p}" x2="100" y2="${p}"/>`);
    }
    if (mode.diagonals) {
      lines.push('<line x1="0" y1="0" x2="100" y2="100"/>');
      lines.push('<line x1="100" y1="0" x2="0" y2="100"/>');
    }

    // Each line is drawn twice (dark underlay + light stroke) so it stays readable on any photo.
    // vector-effect keeps strokes 1px crisp at every zoom level.
    overlay.innerHTML =
      `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
      `<g class="grid-shadow">${lines.join('')}</g>` +
      `<g class="grid-main">${lines.join('')}</g>` +
      `<rect class="grid-edge" x="0" y="0" width="100" height="100"/>` +
      `</svg>`;
    overlay.classList.remove('hidden');
    if (btn) btn.classList.add('active');
    if (label) {
      label.textContent = mode.label;
      label.classList.remove('hidden');
    }
  },

  toggleInvert() {
    SoundFX.toolToggle();
    this.invert = !this.invert;
    this._syncVisualFilters();
    const btn = document.getElementById('btn-art-invert');
    if (btn) btn.classList.toggle('active', this.invert);
    this._hudPop('btn-art-invert');
  },

  flipHorizontal() {
    SoundFX.toolToggle();
    this.flipX *= -1;
    this.applyTransform();
  },

  rotate90() {
    SoundFX.toolToggle();
    this.rotateTotal += 90;
    this.rotate = ((this.rotateTotal % 360) + 360) % 360;
    // Re-fit so a rotated landscape photo never spills out of the stage
    this.fitImage(true);
  },

  /**
   * Zoom around a point (screen coordinates) so the detail under the cursor stays put.
   * With no point given, zooms around the center of the stage.
   */
  zoomTo(newZoom, clientX = null, clientY = null, snap = false) {
    newZoom = Math.min(this.MAX_ZOOM, Math.max(this.MIN_ZOOM, newZoom));
    if (snap && Math.abs(newZoom - 1) < 0.04) newZoom = 1;

    const stage = document.getElementById('image-stage');
    let px = 0;
    let py = 0;
    if (stage && clientX !== null && clientY !== null) {
      const r = stage.getBoundingClientRect();
      px = clientX - (r.left + r.width / 2);
      py = clientY - (r.top + r.height / 2);
    }

    const ratio = newZoom / this.zoom;
    this.panX = px - (px - this.panX) * ratio;
    this.panY = py - (py - this.panY) * ratio;
    this.zoom = newZoom;

    if (this.zoom === 1) {
      this.panX = 0;
      this.panY = 0;
    }
    this.clampPan();
    this.applyTransform();
  },

  // Used by the +/- buttons and hotkeys (delta sign picks direction)
  adjustZoom(delta) {
    this.zoomTo(this.zoom * (delta > 0 ? 1.25 : 1 / 1.25), null, null, true);
  },

  resetZoomPan() {
    SoundFX.toolToggle();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  },

  // Never let the picture be dragged completely out of view
  clampPan() {
    const stage = document.getElementById('image-stage');
    const frame = document.getElementById('image-frame');
    if (!stage || !frame) return;

    const quarter = this.rotate % 180 === 90;
    const vw = (quarter ? frame.offsetHeight : frame.offsetWidth) * this.zoom;
    const vh = (quarter ? frame.offsetWidth : frame.offsetHeight) * this.zoom;
    const keep = 80;
    const limX = Math.max(0, vw / 2 + stage.clientWidth / 2 - keep);
    const limY = Math.max(0, vh / 2 + stage.clientHeight / 2 - keep);

    this.panX = Math.min(limX, Math.max(-limX, this.panX));
    this.panY = Math.min(limY, Math.max(-limY, this.panY));
  },

  /**
   * Size the image frame to "contain" inside the stage (accounting for 90° rotation),
   * then re-apply the transform. Runs on image load, window/fullscreen resize and rotate.
   */
  fitImage(animate = false) {
    const stage = document.getElementById('image-stage');
    const frame = document.getElementById('image-frame');
    const img = document.getElementById('session-image');

    if (!stage || !frame || !img || !img.naturalWidth) {
      this.applyTransform();
      return;
    }

    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (sw < 10 || sh < 10) return; // stage hidden (e.g. empty-state)

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const quarter = this.rotate % 180 === 90;
    const ew = quarter ? nh : nw;
    const eh = quarter ? nw : nh;

    this.fitScale = Math.min(sw / ew, sh / eh, 3);

    if (animate) {
      frame.classList.remove('no-anim');
    } else {
      frame.classList.add('no-anim');
    }

    frame.style.width = `${Math.round(nw * this.fitScale)}px`;
    frame.style.height = `${Math.round(nh * this.fitScale)}px`;
    this.clampPan();
    this.applyTransform();

    if (!animate) {
      void frame.offsetWidth; // commit the un-animated size before re-enabling transitions
      requestAnimationFrame(() => frame.classList.remove('no-anim'));
    }
  },

  applyTransform() {
    const frame = document.getElementById('image-frame');
    if (frame) {
      frame.style.transform =
        `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom}) scaleX(${this.flipX}) rotate(${this.rotateTotal}deg)`;
      frame.classList.toggle('is-zoomed', this.zoom > 1.001);
    }
    const zoomBtn = document.getElementById('btn-img-zoom-reset');
    if (zoomBtn) zoomBtn.textContent = `${Math.round(this.zoom * 100)}%`;
  },

  setupDragAndWheel(customStage, customFrame) {
    const stage = customStage || document.getElementById('image-stage');
    const frame = customFrame || document.getElementById('image-frame');
    if (!stage || !frame) return;
    if (stage._hasDragAndWheel) return;
    stage._hasDragAndWheel = true;

    // Pointer-drag to pan (mouse, pen and touch)
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (typeof SmartCropManager !== 'undefined' && SmartCropManager.isCropping) return;
      if (typeof ColorPaletteManager !== 'undefined' && ColorPaletteManager.eyedropperActive) return;

      // When Plumb Tool is active or Shift key is held, measure anatomical tilt & drop-lines
      if (typeof PlumbTool !== 'undefined' && (e.shiftKey || PlumbTool.isActive)) {
        if (PlumbTool.startDrag(e)) {
          try { stage.setPointerCapture(e.pointerId); } catch (err) { }
          return;
        }
      }

      // When Sketch Alignment Mode is active, pan ONLY the sketch overlay
      if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active && SketchOverlay.isAlignMode) {
        SketchOverlay.isDragging = true;
        SketchOverlay.lastPointerX = e.clientX;
        SketchOverlay.lastPointerY = e.clientY;
        try { stage.setPointerCapture(e.pointerId); } catch (err) { }
        return;
      }

      this.isDragging = true;
      this.dragStartX = e.clientX - this.panX;
      this.dragStartY = e.clientY - this.panY;
      frame.classList.add('dragging');
      try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    });

    stage.addEventListener('pointermove', (e) => {
      // Plumb-line angle measurement drag
      if (typeof PlumbTool !== 'undefined' && PlumbTool.isMeasuring) {
        PlumbTool.updateDrag(e);
        if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
          PiPCanvasStreamer.render();
        }
        return;
      }

      // Pan ONLY the sketch overlay during Align Mode
      if (typeof SketchOverlay !== 'undefined' && SketchOverlay.isDragging) {
        const dx = e.clientX - SketchOverlay.lastPointerX;
        const dy = e.clientY - SketchOverlay.lastPointerY;
        SketchOverlay.lastPointerX = e.clientX;
        SketchOverlay.lastPointerY = e.clientY;

        const zoom = ArtistToolbox.zoom || 1;
        const flipX = ArtistToolbox.flipX || 1;
        const rotRad = -((ArtistToolbox.rotateTotal || 0) * Math.PI) / 180;

        const unrotX = (dx * Math.cos(rotRad) - dy * Math.sin(rotRad)) / zoom * flipX;
        const unrotY = (dx * Math.sin(rotRad) + dy * Math.cos(rotRad)) / zoom;

        SketchOverlay.sketchOffsetX += unrotX;
        SketchOverlay.sketchOffsetY += unrotY;
        SketchOverlay.applyStyles();
        SketchOverlay.syncUI();

        if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
          PiPCanvasStreamer.render();
        }
        return;
      }

      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStartX;
      this.panY = e.clientY - this.dragStartY;
      this.clampPan();
      this.applyTransform();
    });

    const endDrag = (e) => {
      if (typeof PlumbTool !== 'undefined' && PlumbTool.isMeasuring) {
        PlumbTool.endDrag(e);
        try { stage.releasePointerCapture(e.pointerId); } catch (err) { }
        if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
          PiPCanvasStreamer.render();
        }
        return;
      }

      if (typeof SketchOverlay !== 'undefined' && SketchOverlay.isDragging) {
        SketchOverlay.isDragging = false;
        try { stage.releasePointerCapture(e.pointerId); } catch (err) { }
        return;
      }
      if (!this.isDragging) return;
      this.isDragging = false;
      frame.classList.remove('dragging');
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { }
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    // Wheel / trackpad-pinch zoom, anchored to the cursor
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();

      // Scale or Rotate ONLY the sketch overlay during Align Mode
      if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active && SketchOverlay.isAlignMode) {
        if (e.shiftKey) {
          // Holding Shift + Scroll: rotate in 0.5deg steps
          const dir = e.deltaY > 0 ? 0.5 : -0.5;
          SketchOverlay.adjustRotate(dir);
        } else {
          // Scrolling wheel: scale in 1% increments (0.01)
          const dir = e.deltaY < 0 ? 0.01 : -0.01;
          SketchOverlay.adjustScale(dir);
        }
        return;
      }

      let dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      dy = Math.max(-150, Math.min(150, dy));
      const sensitivity = e.ctrlKey ? 0.012 : 0.0022; // pinch gestures arrive with ctrlKey
      this.zoomTo(this.zoom * Math.exp(-dy * sensitivity), e.clientX, e.clientY);
    }, { passive: false });

    // Double-click: in Align mode, reset alignment; otherwise jump to 2.5× at cursor or fit
    stage.addEventListener('dblclick', (e) => {
      if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active && SketchOverlay.isAlignMode) {
        SketchOverlay.resetAlign();
        return;
      }
      if (this.zoom !== 1 || this.panX !== 0 || this.panY !== 0) {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
      } else {
        this.zoomTo(2.5, e.clientX, e.clientY);
      }
    });

    // Keep the picture perfectly fitted when the window / fullscreen layout changes
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.fitImage(false)).observe(stage);
    } else {
      window.addEventListener('resize', () => this.fitImage(false));
    }
  }
};

// ==================== FLOATING MOVABLE WINDOW CONTROLLER ====================
const FloatingWindowManager = {
  activeZIndex: 520,

  bringToFront(el) {
    if (!el) return;
    this.activeZIndex += 2;
    el.style.zIndex = this.activeZIndex;
  },

  makeDraggable(panel, header, options = {}) {
    if (!panel || !header) return;
    if (panel._hasDraggable) return;
    panel._hasDraggable = true;

    const getContainer = () => options.getContainer?.() || document.getElementById('session-image-container') || panel.parentElement;

    let isDragging = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let startLeft = 0;
    let startTop = 0;
    let currentPointerId = null;

    panel.addEventListener('pointerdown', () => {
      this.bringToFront(panel);
    });

    header.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      // Do not drag if clicked directly on an interactive button, input, or control
      if (e.target.closest('button, input, textarea, select, a, .btn, .btn-hud, .btn-hud-mini, .btn-dock-close, .btn-sketch-vis, .btn-blend-mode, .palette-swatch-chip, .btn-copy-hex, .btn-clear-text, [data-no-drag]')) {
        return;
      }

      const container = getContainer();
      if (!container) return;

      const panelRect = panel.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Convert current rendered layout to explicit left/top px relative to container
      const curLeft = panelRect.left - containerRect.left;
      const curTop = panelRect.top - containerRect.top;

      panel.classList.add('is-positioned');
      panel.style.transform = 'none';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.margin = '0';
      panel.style.left = `${Math.round(curLeft)}px`;
      panel.style.top = `${Math.round(curTop)}px`;

      isDragging = true;
      currentPointerId = e.pointerId;
      startPointerX = e.clientX;
      startPointerY = e.clientY;
      startLeft = curLeft;
      startTop = curTop;

      panel.classList.add('is-dragging');
      document.body.classList.add('window-dragging-active');
      this.bringToFront(panel);

      try {
        header.setPointerCapture(e.pointerId);
      } catch (_) { }

      e.preventDefault();
    });

    header.addEventListener('pointermove', (e) => {
      if (!isDragging || e.pointerId !== currentPointerId) return;

      const container = getContainer();
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      const dx = e.clientX - startPointerX;
      const dy = e.clientY - startPointerY;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      const pad = 6;
      const maxLeft = Math.max(pad, containerRect.width - panelRect.width - pad);
      const maxTop = Math.max(pad, containerRect.height - panelRect.height - pad);

      newLeft = Math.max(pad, Math.min(maxLeft, newLeft));
      newTop = Math.max(pad, Math.min(maxTop, newTop));

      panel.style.left = `${Math.round(newLeft)}px`;
      panel.style.top = `${Math.round(newTop)}px`;

      if (typeof options.onMove === 'function') {
        options.onMove({ left: newLeft, top: newTop });
      }
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      if (currentPointerId !== null && e.pointerId !== undefined && e.pointerId !== currentPointerId) return;

      isDragging = false;
      currentPointerId = null;
      panel.classList.remove('is-dragging');
      document.body.classList.remove('window-dragging-active');

      try {
        header.releasePointerCapture(e.pointerId);
      } catch (_) { }

      const pos = {
        left: parseFloat(panel.style.left) || 0,
        top: parseFloat(panel.style.top) || 0
      };
      if (typeof options.onEnd === 'function') {
        options.onEnd(pos);
      }
    };

    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    // Keep clamped when the studio window or image container resizes
    window.addEventListener('resize', () => {
      if (panel.classList.contains('hidden') || !panel.classList.contains('is-positioned')) return;
      const container = getContainer();
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (containerRect.width <= 0 || containerRect.height <= 0) return;

      const curLeft = parseFloat(panel.style.left);
      const curTop = parseFloat(panel.style.top);
      if (isNaN(curLeft) || isNaN(curTop)) return;

      const pad = 6;
      const maxLeft = Math.max(pad, containerRect.width - panelRect.width - pad);
      const maxTop = Math.max(pad, containerRect.height - panelRect.height - pad);

      const clampedLeft = Math.max(pad, Math.min(maxLeft, curLeft));
      const clampedTop = Math.max(pad, Math.min(maxTop, curTop));

      if (clampedLeft !== curLeft) panel.style.left = `${Math.round(clampedLeft)}px`;
      if (clampedTop !== curTop) panel.style.top = `${Math.round(clampedTop)}px`;
    });
  }
};

// ==================== ONION-SKIN SKETCH OVERLAY (SELF-CRITIQUE TOOL) ====================
const SketchOverlay = {
  active: false,
  visible: true,
  dockVisible: true,
  isMinimized: false,
  dockPos: null,
  imageSrc: null,
  imgEl: null,
  blendMode: 'difference', // 'difference' | 'normal' | 'multiply'
  opacity: 1.0,
  fitMode: 'fill', // 'fill' | 'contain'
  sketchOffsetX: 0,
  sketchOffsetY: 0,
  sketchScale: 1.0,
  sketchRotate: 0,
  isAlignMode: false,
  isDragging: false,
  lastPointerX: 0,
  lastPointerY: 0,

  init() {
    this.imgEl = document.getElementById('sketch-overlay-img');
    this.setupDraggable();
    this.bindEvents();
  },

  setupDraggable() {
    const dock = document.getElementById('sketch-critique-dock');
    if (!dock) return;
    const header = dock.querySelector('.sketch-dock-header') || dock.querySelector('.sketch-dock-row');
    if (!header) return;

    FloatingWindowManager.makeDraggable(dock, header, {
      onEnd: (pos) => {
        this.dockPos = pos;
      }
    });
  },

  toggleDock(forceState = null) {
    if (!this.active) {
      this.promptPasteOrUpload();
      return;
    }
    const next = forceState !== null ? forceState : !this.dockVisible;
    this.dockVisible = next;
    this.syncUI();
    SoundFX.click();
    if (this.dockVisible) {
      const dock = document.getElementById('sketch-critique-dock');
      if (dock) FloatingWindowManager.bringToFront(dock);
    }
  },

  toggleMinimize(forceState = null) {
    const next = forceState !== null ? forceState : !this.isMinimized;
    this.isMinimized = next;
    const dock = document.getElementById('sketch-critique-dock');
    const btnMin = document.getElementById('btn-sketch-min-dock');
    if (dock) dock.classList.toggle('minimized', this.isMinimized);
    if (btnMin) {
      btnMin.title = this.isMinimized ? 'Expand Controls' : 'Minimize Controls';
      btnMin.innerHTML = this.isMinimized
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    }
    SoundFX.click();
  },

  loadFromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      UI.showToast('Please provide an image file (PNG, JPG, WebP)', 'alert');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      this.loadFromDataUrl(e.target.result);
    };
    reader.readAsDataURL(file);
  },

  loadFromDataUrl(dataUrl) {
    this.imageSrc = dataUrl;
    this.active = true;
    this.visible = true;
    this.dockVisible = true;

    // Default to Difference mode on new import as requested
    this.blendMode = 'difference';
    this.opacity = 1.0;
    this.isAlignMode = false;
    this.sketchOffsetX = 0;
    this.sketchOffsetY = 0;
    this.sketchScale = 1.0;
    this.sketchRotate = 0;

    const img = document.getElementById('sketch-overlay-img');
    if (img) {
      this.imgEl = img;
      img.src = dataUrl;
    }

    const wrap = document.getElementById('sketch-overlay-wrap');
    if (wrap) wrap.classList.remove('hidden');

    const dock = document.getElementById('sketch-critique-dock');
    if (dock) {
      dock.classList.remove('hidden');
      FloatingWindowManager.bringToFront(dock);
    }

    // If timer ended and blur overlay is active, unblur so artist can critique proportions!
    if (UI.imageBlurred) {
      UI.clearBlurOverlay();
    }

    this.applyStyles();
    this.syncUI();

    if (typeof SketchComparison !== 'undefined') {
      SketchComparison.currentSketchDataUrl = dataUrl;
      SketchComparison.selectedAttemptIndex = -1;
      SketchComparison.syncUI();
    }

    SoundFX.click();

    if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  setBlendMode(mode) {
    this.blendMode = mode;
    // Set intuitive default opacity per mode
    if (mode === 'difference') {
      this.opacity = 1.0;
    } else if (mode === 'normal') {
      this.opacity = 0.65;
    } else if (mode === 'multiply') {
      this.opacity = 0.90;
    }
    this.applyStyles();
    this.syncUI();
    SoundFX.click();

    if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  setOpacity(val) {
    this.opacity = Math.max(0, Math.min(1, val));
    this.applyStyles();
    const valBadge = document.getElementById('sketch-opacity-val');
    if (valBadge) valBadge.textContent = `${Math.round(this.opacity * 100)}%`;

    if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  toggleVisibility() {
    if (!this.active) {
      this.promptPasteOrUpload();
      return;
    }
    this.visible = !this.visible;
    const wrap = document.getElementById('sketch-overlay-wrap');
    if (wrap) wrap.style.display = this.visible ? 'flex' : 'none';

    const icon = document.getElementById('sketch-vis-icon');
    if (icon) icon.innerHTML = UI.getIconSvg(this.visible ? 'eye' : 'eye-off', 14);

    SoundFX.hover();

    if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  toggleFitMode() {
    this.fitMode = this.fitMode === 'fill' ? 'contain' : 'fill';
    this.applyStyles();
    this.syncUI();
  },

  toggleAlignMode(forceState) {
    if (!this.active) {
      this.promptPasteOrUpload();
      return;
    }
    this.isAlignMode = typeof forceState === 'boolean' ? forceState : !this.isAlignMode;
    this.syncUI();
    SoundFX.hover();
  },

  adjustScale(delta) {
    this.sketchScale = Math.max(0.1, Math.min(5.0, +(this.sketchScale + delta).toFixed(4)));
    this.applyStyles();
    this.syncUI();
    if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  adjustRotate(delta) {
    this.sketchRotate = +((this.sketchRotate + delta) % 360).toFixed(1);
    this.applyStyles();
    this.syncUI();
    if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  resetAlign() {
    this.sketchOffsetX = 0;
    this.sketchOffsetY = 0;
    this.sketchScale = 1.0;
    this.sketchRotate = 0;
    this.applyStyles();
    this.syncUI();
    SoundFX.click();

    if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  clear() {
    this.active = false;
    this.visible = false;
    this.dockVisible = false;
    this.isAlignMode = false;
    this.sketchOffsetX = 0;
    this.sketchOffsetY = 0;
    this.sketchScale = 1.0;
    this.sketchRotate = 0;
    this.imageSrc = null;

    const stage = document.getElementById('image-stage');
    if (stage) stage.classList.remove('sketch-align-active');

    const img = document.getElementById('sketch-overlay-img');
    if (img) img.src = '';

    const wrap = document.getElementById('sketch-overlay-wrap');
    if (wrap) wrap.classList.add('hidden');

    const dock = document.getElementById('sketch-critique-dock');
    if (dock) dock.classList.add('hidden');

    const toolbarBtn = document.getElementById('btn-art-sketch');
    if (toolbarBtn) toolbarBtn.classList.remove('active');

    SoundFX.click();
    UI.showToast('Sketch overlay removed', 'info');

    if (UI.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
  },

  applyStyles() {
    const wrap = document.getElementById('sketch-overlay-wrap');
    const img = document.getElementById('sketch-overlay-img');
    if (!wrap || !img) return;

    img.style.mixBlendMode = this.blendMode;
    img.style.objectFit = this.fitMode;
    img.style.transform = `translate(${this.sketchOffsetX}px, ${this.sketchOffsetY}px) rotate(${this.sketchRotate}deg) scale(${this.sketchScale})`;
    img.style.transformOrigin = 'center center';
    wrap.style.opacity = this.opacity;
    wrap.style.display = this.visible ? 'flex' : 'none';
  },

  syncUI() {
    const dock = document.getElementById('sketch-critique-dock');
    if (!dock) return;

    dock.classList.toggle('hidden', !this.active || !this.dockVisible);
    dock.classList.toggle('minimized', this.isMinimized);

    const toolbarBtn = document.getElementById('btn-art-sketch');
    if (toolbarBtn) toolbarBtn.classList.toggle('active', this.active);

    if (this.dockPos && this.active && this.dockVisible) {
      dock.classList.add('is-positioned');
      dock.style.left = `${this.dockPos.left}px`;
      dock.style.top = `${this.dockPos.top}px`;
      dock.style.transform = 'none';
    }

    // Update blend mode pills
    dock.querySelectorAll('.btn-blend-mode').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.blend === this.blendMode);
    });

    // Update slider and badge
    const slider = document.getElementById('slider-sketch-opacity');
    const valBadge = document.getElementById('sketch-opacity-val');
    if (slider) slider.value = Math.round(this.opacity * 100);
    if (valBadge) valBadge.textContent = `${Math.round(this.opacity * 100)}%`;

    // Update fit button
    const fitBtn = document.getElementById('btn-sketch-fit-toggle');
    if (fitBtn) {
      fitBtn.textContent = this.fitMode === 'fill' ? 'Fill 1:1' : 'Contain';
    }

    // Update align button & metrics
    const alignBtn = document.getElementById('btn-sketch-align-toggle');
    const alignLabel = document.getElementById('sketch-align-label');
    const alignMetrics = document.getElementById('sketch-align-metrics');
    const stage = document.getElementById('image-stage');

    if (alignBtn) {
      alignBtn.classList.toggle('active', this.isAlignMode);
    }
    if (alignLabel) {
      alignLabel.textContent = this.isAlignMode ? 'Aligning [A]' : 'Align [A]';
    }
    if (stage) {
      stage.classList.toggle('sketch-align-active', this.isAlignMode && this.active);
    }
    if (alignMetrics) {
      const hasTransform = this.sketchOffsetX !== 0 || this.sketchOffsetY !== 0 || this.sketchScale !== 1 || this.sketchRotate !== 0;
      if (this.isAlignMode || hasTransform) {
        alignMetrics.classList.remove('hidden');
        const ox = Math.round(this.sketchOffsetX);
        const oy = Math.round(this.sketchOffsetY);
        const sc = Math.round(this.sketchScale * 100);
        const rot = this.sketchRotate.toFixed(1);
        alignMetrics.textContent = `${ox > 0 ? '+' : ''}${ox},${oy > 0 ? '+' : ''}${oy}px · ${sc}% · ${rot}°`;
      } else {
        alignMetrics.classList.add('hidden');
      }
    }

    // Update eye icon
    const icon = document.getElementById('sketch-vis-icon');
    if (icon) icon.innerHTML = UI.getIconSvg(this.visible ? 'eye' : 'eye-off', 14);
  },

  bindEvents() {
    // Window-level Paste listener (Cmd+V / Ctrl+V)
    window.addEventListener('paste', (e) => {
      const activeEl = document.activeElement;
      if (activeEl && ['INPUT', 'TEXTAREA'].includes(activeEl.tagName) && activeEl.id !== 'sketch-file-input') {
        return;
      }
      const sessionView = document.getElementById('view-session');
      if (!sessionView || !sessionView.classList.contains('active')) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            this.loadFromFile(file);
            return;
          }
        }
      }
    });

    // Drag and Drop listeners
    const stage = document.getElementById('image-stage');
    if (stage) {
      const dropTarget = document.getElementById('sketch-drop-target');

      ['dragenter', 'dragover'].forEach(ev => {
        stage.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dropTarget) dropTarget.classList.remove('hidden');
        });
      });

      ['dragleave', 'drop'].forEach(ev => {
        stage.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dropTarget && (e.type === 'drop' || e.relatedTarget === null || !stage.contains(e.relatedTarget))) {
            dropTarget.classList.add('hidden');
          }
        });
      });

      stage.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dropTarget) dropTarget.classList.add('hidden');

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          for (let i = 0; i < files.length; i++) {
            if (files[i].type && files[i].type.startsWith('image/')) {
              this.loadFromFile(files[i]);
              return;
            }
          }
        }
      });
    }

    // Blend mode button clicks
    const dock = document.getElementById('sketch-critique-dock');
    if (dock) {
      dock.querySelectorAll('.btn-blend-mode').forEach(btn => {
        btn.addEventListener('click', () => {
          this.setBlendMode(btn.dataset.blend);
        });
      });
    }

    // Opacity slider
    const slider = document.getElementById('slider-sketch-opacity');
    if (slider) {
      slider.addEventListener('input', (e) => {
        this.setOpacity(parseInt(e.target.value, 10) / 100);
      });
    }

    // Visibility toggle (eye button)
    const visBtn = document.getElementById('btn-sketch-toggle-vis');
    if (visBtn) {
      visBtn.addEventListener('click', () => this.toggleVisibility());
    }

    // Fit toggle button
    const fitBtn = document.getElementById('btn-sketch-fit-toggle');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => this.toggleFitMode());
    }

    // Align toggle button
    const alignToggleBtn = document.getElementById('btn-sketch-align-toggle');
    if (alignToggleBtn) {
      alignToggleBtn.addEventListener('click', () => this.toggleAlignMode());
    }

    // Align reset button
    const alignResetBtn = document.getElementById('btn-sketch-align-reset');
    if (alignResetBtn) {
      alignResetBtn.addEventListener('click', () => this.resetAlign());
    }

    // Hide dock button (hides floating dock window, keeps sketch attempt active)
    const hideDockBtn = document.getElementById('btn-sketch-hide-dock');
    if (hideDockBtn) {
      hideDockBtn.addEventListener('click', () => this.toggleDock(false));
    }

    // Minimize dock button
    const minDockBtn = document.getElementById('btn-sketch-min-dock');
    if (minDockBtn) {
      minDockBtn.addEventListener('click', () => this.toggleMinimize());
    }

    // Clear button (removes sketch overlay)
    const clearBtn = document.getElementById('btn-sketch-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clear());
    }

    // Paste button in dock
    const pasteBtn = document.getElementById('btn-sketch-paste-new');
    if (pasteBtn) {
      pasteBtn.addEventListener('click', () => this.promptPasteOrUpload());
    }

    // Hidden file input change
    const fileInput = document.getElementById('sketch-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.loadFromFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // Side toolbar Overlay button
    const artBtn = document.getElementById('btn-art-sketch');
    if (artBtn) {
      artBtn.addEventListener('click', () => {
        if (this.active) {
          if (!this.dockVisible) {
            this.toggleDock(true);
          } else {
            this.toggleVisibility();
          }
        } else {
          this.promptPasteOrUpload();
        }
      });
    }

    // Blur overlay "Paste Finished Sketch" button
    const blurPasteBtn = document.getElementById('btn-blur-paste-sketch');
    if (blurPasteBtn) {
      blurPasteBtn.addEventListener('click', () => this.promptPasteOrUpload());
    }

    // Blur overlay "Unblur Reference" button
    const blurUnblurBtn = document.getElementById('btn-blur-unblur-peek');
    if (blurUnblurBtn) {
      blurUnblurBtn.addEventListener('click', () => {
        UI.clearBlurOverlay();
      });
    }
  },

  async promptPasteOrUpload() {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            this.loadFromFile(blob);
            return;
          }
        }
      }
    } catch (err) { }

    // Fallback: trigger file picker
    const fileInput = document.getElementById('sketch-file-input');
    if (fileInput) fileInput.click();
  }
};

// ==================== SKETCH COMPARISON & VISUAL HISTORY CONTROLLER ====================
const SketchComparison = {
  currentSketchDataUrl: null,
  activeMode: 'single', // 'single' | 'split' | 'overlay'
  selectedAttemptIndex: -1, // -1 means today's sketch; >= 0 means past attempt index

  init() {
    this.bindEvents();
  },

  // Called whenever a new card is loaded into the session
  onCardLoaded(deckId, imageId) {
    this.currentSketchDataUrl = null;
    this.selectedAttemptIndex = -1;
    this.activeMode = 'single';
    this.syncUI();
    this.updateHistoryBadge(deckId, imageId);
  },

  updateHistoryBadge(deckId, imageId) {
    const attempts = CardManager.getAttempts(deckId, imageId);
    const count = attempts.length;

    const toolbarBadge = document.getElementById('history-attempts-badge');
    if (toolbarBadge) {
      toolbarBadge.textContent = count;
      toolbarBadge.classList.toggle('hidden', count === 0);
    }

    const pill = document.getElementById('session-history-pill');
    const pillText = document.getElementById('history-pill-text');
    if (pill && pillText) {
      if (count > 0) {
        pillText.textContent = `${count} Past Attempt${count === 1 ? '' : 's'}`;
        pill.classList.remove('hidden');
      } else {
        pill.classList.add('hidden');
      }
    }
  },

  // Loads a sketch file (from clipboard paste, drag & drop, or file input)
  async loadSketch(fileOrDataUrl) {
    if (typeof fileOrDataUrl === 'string') {
      this._setSketch(fileOrDataUrl);
      return;
    }

    if (!fileOrDataUrl || !fileOrDataUrl.type.startsWith('image/')) {
      UI.showToast('Please provide an image file (PNG, JPG, WebP)', 'alert');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this._setSketch(e.target.result);
    };
    reader.readAsDataURL(fileOrDataUrl);
  },

  _setSketch(dataUrl) {
    this.currentSketchDataUrl = dataUrl;
    this.selectedAttemptIndex = -1; // Viewing today's sketch

    // Also mirror to SketchOverlay for onion-skin difference blend mode
    if (typeof SketchOverlay !== 'undefined') {
      SketchOverlay.loadFromDataUrl(dataUrl);
    }

    // Always unblur reference so artist can see both side-by-side
    if (UI.imageBlurred) {
      UI.clearBlurOverlay();
    }

    // Switch to Side-by-Side comparison mode automatically
    this.setMode('split');
    this.syncUI();

    SoundFX.click();
  },

  removeCurrentSketch() {
    this.currentSketchDataUrl = null;
    this.selectedAttemptIndex = -1;
    if (typeof SketchOverlay !== 'undefined') {
      SketchOverlay.clear();
    }
    this.setMode('single');
    this.syncUI();
    SoundFX.click();
  },

  setMode(mode) {
    this.activeMode = mode;
    const stage = document.getElementById('image-stage');
    const splitView = document.getElementById('sketch-split-view');

    if (mode === 'split') {
      if (stage) stage.classList.add('hidden');
      if (splitView) splitView.classList.remove('hidden');
      this.renderSplitView();
    } else {
      if (stage) stage.classList.remove('hidden');
      if (splitView) splitView.classList.add('hidden');
      ArtistToolbox.fitImage(false);
    }

    this.syncUI();
  },

  toggleSplitView() {
    if (this.activeMode === 'split') {
      this.setMode('single');
    } else {
      this.setMode('split');
    }
  },

  renderSplitView() {
    const splitRefImg = document.getElementById('split-ref-image');
    const splitSketchImg = document.getElementById('split-sketch-image');
    const splitSketchEmpty = document.getElementById('split-sketch-empty');
    const splitRefName = document.getElementById('split-ref-name');
    const splitDateBadge = document.getElementById('split-sketch-date');
    const splitTag = document.getElementById('split-sketch-tag');
    const tabsContainer = document.getElementById('split-history-tabs');

    if (!SessionManager.currentImage) return;

    // 1. Render Reference Photo
    if (splitRefImg) {
      splitRefImg.src = SessionManager.getImageUrl(SessionManager.currentImage);
    }
    if (splitRefName) {
      splitRefName.textContent = SessionManager.currentImage.name || 'Reference';
    }

    const deckId = SessionManager.deckId;
    const imageId = SessionManager.currentImage.id;
    const attempts = CardManager.getAttempts(deckId, imageId);

    // 2. Build History Tabs
    if (tabsContainer) {
      let tabsHtml = '';
      if (attempts.length > 0) {
        attempts.forEach((att, idx) => {
          const isSelected = this.selectedAttemptIndex === idx;
          const ratingDot = `<span class="rating-dot dot-${att.rating || 'medium'}"></span>`;
          tabsHtml += `
            <button type="button" class="btn-history-tab ${isSelected ? 'active' : ''}" data-idx="${idx}" title="${att.date} • ${att.rating}">
              ${ratingDot} #${idx + 1} (${att.rating})
            </button>
          `;
        });
      }

      const isTodaySelected = this.selectedAttemptIndex === -1;
      const starIcon = UI.getIconSvg ? UI.getIconSvg('star', 12, 'history-tab-star') : '';
      tabsHtml += `
        <button type="button" class="btn-history-tab ${isTodaySelected ? 'active' : ''}" data-idx="-1" title="Today's Sketch">
          ${starIcon} Today
        </button>
      `;

      tabsContainer.innerHTML = tabsHtml;

      tabsContainer.querySelectorAll('.btn-history-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          this.selectedAttemptIndex = parseInt(btn.dataset.idx, 10);
          this.renderSplitView();
          SoundFX.click();
        });
      });
    }

    // 3. Render Right Sketch Pane
    if (this.selectedAttemptIndex >= 0 && attempts[this.selectedAttemptIndex]) {
      // Viewing past attempt
      const att = attempts[this.selectedAttemptIndex];
      if (splitSketchImg) {
        splitSketchImg.src = att.sketchUrl;
        splitSketchImg.classList.remove('hidden');
      }
      if (splitSketchEmpty) splitSketchEmpty.classList.add('hidden');
      if (splitTag) splitTag.textContent = `Attempt #${this.selectedAttemptIndex + 1}`;
      if (splitDateBadge) splitDateBadge.textContent = `${att.date} • ${att.rating.toUpperCase()}`;
    } else if (this.currentSketchDataUrl) {
      // Viewing today's sketch
      if (splitSketchImg) {
        splitSketchImg.src = this.currentSketchDataUrl;
        splitSketchImg.classList.remove('hidden');
      }
      if (splitSketchEmpty) splitSketchEmpty.classList.add('hidden');
      if (splitTag) splitTag.innerHTML = `${UI.getIconSvg('pencil', 12)} Your Sketch`;
      if (splitDateBadge) splitDateBadge.textContent = 'Today (Rating...)';
    } else {
      // No sketch attached yet for today
      if (splitSketchImg) {
        splitSketchImg.src = '';
        splitSketchImg.classList.add('hidden');
      }
      if (splitSketchEmpty) splitSketchEmpty.classList.remove('hidden');
      if (splitTag) splitTag.innerHTML = `${UI.getIconSvg('pencil', 12)} Your Sketch`;
      if (splitDateBadge) splitDateBadge.textContent = 'Awaiting Sketch';
    }
  },

  syncUI() {
    const hasSketch = !!this.currentSketchDataUrl;
    const emptyBar = document.getElementById('rating-sketch-empty');
    const activeBar = document.getElementById('rating-sketch-active');
    const thumb = document.getElementById('rating-sketch-thumb');
    const splitBtn = document.getElementById('btn-toggle-split-view');
    const overlayBtn = document.getElementById('btn-toggle-overlay-view');
    const historyBtn = document.getElementById('btn-art-history');

    if (emptyBar && activeBar) {
      emptyBar.classList.toggle('hidden', hasSketch);
      activeBar.classList.toggle('hidden', !hasSketch);
    }

    if (thumb && hasSketch) {
      thumb.src = this.currentSketchDataUrl;
    }

    if (splitBtn) splitBtn.classList.toggle('active', this.activeMode === 'split');
    if (overlayBtn) overlayBtn.classList.toggle('active', this.activeMode === 'overlay');
    if (historyBtn) historyBtn.classList.toggle('active', this.activeMode === 'split');
  },

  async saveAttempt(deckId, imageId, imageName, rating, dataUrl) {
    if (!dataUrl || !imageId) return null;
    try {
      const card = CardManager.getCard(deckId, imageId) || { imageId };
      let sketchUrl = dataUrl;
      if (typeof sketchUrl === 'string' && sketchUrl.startsWith('data:image/')) {
        try {
          const res = await fetch('/api/sketch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageId: card.imageId, dataUrl: sketchUrl })
          });
          if (res.ok) {
            const json = await res.json();
            if (json && json.sketchUrl) {
              sketchUrl = json.sketchUrl;
            }
          }
        } catch (err) {
          console.warn('[SketchComparison] Could not upload sketch to /api/sketch:', err.message);
        }
      }

      const attempt = {
        id: 'att_' + Date.now(),
        date: CardManager._dateStr(new Date()),
        rating,
        sketchUrl,
        timestamp: Date.now()
      };
      await CardManager.addAttempt(deckId, imageId, attempt);
      console.log(`[SketchComparison] Saved visual attempt to disk for ${imageId}:`, sketchUrl);
      return attempt;
    } catch (err) {
      console.warn('[SketchComparison] Could not save sketch to disk:', err.message);
    }
    return null;
  },

  bindEvents() {
    // Rating bar drop/paste handlers
    const ratingBar = document.getElementById('rating-sketch-bar');
    if (ratingBar) {
      ['dragenter', 'dragover'].forEach(ev => {
        ratingBar.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          ratingBar.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(ev => {
        ratingBar.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          ratingBar.classList.remove('dragover');
        });
      });
      ratingBar.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ratingBar.classList.remove('dragover');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          for (let i = 0; i < files.length; i++) {
            if (files[i].type.startsWith('image/')) {
              this.loadSketch(files[i]);
              return;
            }
          }
        }
      });
    }

    // Attach sketch buttons (trigger file picker)
    const attachBtn = document.getElementById('btn-rating-attach-sketch');
    const splitUploadBtn = document.getElementById('btn-split-upload-sketch');
    const fileInput = document.getElementById('sketch-file-input');
    const triggerFile = () => { if (fileInput) fileInput.click(); };
    if (attachBtn) attachBtn.addEventListener('click', triggerFile);
    if (splitUploadBtn) splitUploadBtn.addEventListener('click', triggerFile);

    // Remove sketch button
    const removeBtn = document.getElementById('btn-remove-rating-sketch');
    if (removeBtn) removeBtn.addEventListener('click', () => this.removeCurrentSketch());

    // Mode toggles
    const toggleSplitBtn = document.getElementById('btn-toggle-split-view');
    if (toggleSplitBtn) toggleSplitBtn.addEventListener('click', () => this.setMode('split'));

    const toggleOverlayBtn = document.getElementById('btn-toggle-overlay-view');
    if (toggleOverlayBtn) toggleOverlayBtn.addEventListener('click', () => {
      this.setMode('single');
      if (typeof SketchOverlay !== 'undefined' && this.currentSketchDataUrl) {
        SketchOverlay.loadFromDataUrl(this.currentSketchDataUrl);
      }
    });

    const closeSplitBtn = document.getElementById('btn-close-split-view');
    if (closeSplitBtn) closeSplitBtn.addEventListener('click', () => this.setMode('single'));

    // History button in toolbar and session history pill
    const historyToolbarBtn = document.getElementById('btn-art-history');
    if (historyToolbarBtn) historyToolbarBtn.addEventListener('click', () => this.toggleSplitView());

    const historyPill = document.getElementById('session-history-pill');
    if (historyPill) historyPill.addEventListener('click', () => this.setMode('split'));
  }
};

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
      <div class="palette-swatch-chip" style="background-color: ${color.hex}" data-idx="${idx}" title="${color.hex} • Value ${color.val}% • ${color.temp}">
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
      <div class="sampled-chip" style="background-color: ${color.hex}" data-idx="${idx}" title="${color.hex} • Value ${color.val}% (${color.temp})">
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

// ==================== SMART CROP / FOCAL POINT ZOOM CARDS ====================
const SmartCropManager = {
  isCropping: false,
  isFocalMode: false,
  cropState: {
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isDragging: false,
    box: { left: 0, top: 0, width: 0, height: 0 }
  },
  selectedTags: ['hands'],

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Toolbar button
    const btnCrop = document.getElementById('btn-art-crop');
    if (btnCrop) {
      btnCrop.addEventListener('click', () => this.startCrop());
    }

    // Cancel buttons
    const btnCancel = document.getElementById('btn-cancel-crop');
    const btnCancelPop = document.getElementById('btn-cancel-crop-popover');
    if (btnCancel) btnCancel.addEventListener('click', () => this.cancelCrop());
    if (btnCancelPop) btnCancelPop.addEventListener('click', () => this.cancelCrop());

    // Confirm button
    const btnConfirm = document.getElementById('btn-confirm-crop');
    if (btnConfirm) btnConfirm.addEventListener('click', () => this.confirmCrop());

    // Focal pill context toggle (Shift+C / click)
    const focalPill = document.getElementById('session-focal-pill');
    if (focalPill) {
      focalPill.addEventListener('click', () => this.toggleFocalContext());
    }

    // Topic tag preset pills inside popover
    const tagBtns = document.querySelectorAll('.btn-crop-tag');
    tagBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        this.selectedTags = Array.from(document.querySelectorAll('.btn-crop-tag.active')).map(b => b.dataset.tag);
      });
    });

    // Enter key inside crop label input
    const input = document.getElementById('crop-label-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.confirmCrop();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.cancelCrop();
        }
      });
    }

    // Interactive Drag Selection on Overlay Backdrop
    const overlay = document.getElementById('smart-crop-overlay');
    if (overlay) {
      overlay.addEventListener('pointerdown', (e) => this.onOverlayPointerDown(e));
      window.addEventListener('pointermove', (e) => this.onOverlayPointerMove(e));
      window.addEventListener('pointerup', (e) => this.onOverlayPointerUp(e));
    }
  },

  startCrop() {
    const sessionView = document.getElementById('view-session');
    if (!sessionView || !sessionView.classList.contains('active') || !SessionManager.currentImage) {
      UI.showToast('Start a study session to create crop cards', 'info');
      return;
    }

    if (this.isCropping) {
      this.cancelCrop();
      return;
    }

    this.isCropping = true;
    SoundFX.toolToggle();

    // Reset zoom and pan so artist can frame from the full image
    ArtistToolbox.resetZoomPan();

    const overlay = document.getElementById('smart-crop-overlay');
    const cropBox = document.getElementById('crop-box');
    const popover = document.getElementById('crop-popover');
    const btn = document.getElementById('btn-art-crop');

    if (overlay) overlay.classList.remove('hidden');
    if (btn) btn.classList.add('active');

    // Default crop box in center of stage
    const stage = document.getElementById('image-stage');
    if (stage && cropBox) {
      const rect = stage.getBoundingClientRect();
      const defaultW = Math.min(rect.width * 0.45, 260);
      const defaultH = Math.min(rect.height * 0.45, 260);
      const defaultL = (rect.width - defaultW) / 2;
      const defaultT = (rect.height - defaultH) / 2;

      this.cropState.box = { left: defaultL, top: defaultT, width: defaultW, height: defaultH };
      this.updateCropBoxDOM();
      cropBox.classList.remove('hidden');
      if (popover) popover.classList.remove('hidden');

      const input = document.getElementById('crop-label-input');
      if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 80);
      }
    }
  },

  cancelCrop() {
    this.isCropping = false;
    this.cropState.isDragging = false;
    const overlay = document.getElementById('smart-crop-overlay');
    const btn = document.getElementById('btn-art-crop');
    if (overlay) overlay.classList.add('hidden');
    if (btn) btn.classList.remove('active');
  },

  onOverlayPointerDown(e) {
    if (!this.isCropping) return;
    if (e.target.closest('#crop-popover')) return;

    e.preventDefault();
    const stage = document.getElementById('image-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();

    this.cropState.isDragging = true;
    this.cropState.startX = e.clientX - rect.left;
    this.cropState.startY = e.clientY - rect.top;
    this.cropState.currentX = this.cropState.startX;
    this.cropState.currentY = this.cropState.startY;

    const popover = document.getElementById('crop-popover');
    if (popover) popover.classList.add('hidden');

    this.updateCropFromDrag();
  },

  onOverlayPointerMove(e) {
    if (!this.isCropping || !this.cropState.isDragging) return;

    const stage = document.getElementById('image-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();

    this.cropState.currentX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    this.cropState.currentY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    this.updateCropFromDrag();
  },

  onOverlayPointerUp() {
    if (!this.isCropping || !this.cropState.isDragging) return;
    this.cropState.isDragging = false;

    // Minimum size check: if drawn too small, ensure at least 60x60
    if (this.cropState.box.width < 35 || this.cropState.box.height < 35) {
      this.cropState.box.width = Math.max(120, this.cropState.box.width);
      this.cropState.box.height = Math.max(120, this.cropState.box.height);
      this.updateCropBoxDOM();
    }

    const popover = document.getElementById('crop-popover');
    if (popover) popover.classList.remove('hidden');

    const input = document.getElementById('crop-label-input');
    if (input) input.focus();
  },

  updateCropFromDrag() {
    const left = Math.min(this.cropState.startX, this.cropState.currentX);
    const top = Math.min(this.cropState.startY, this.cropState.currentY);
    const width = Math.max(10, Math.abs(this.cropState.currentX - this.cropState.startX));
    const height = Math.max(10, Math.abs(this.cropState.currentY - this.cropState.startY));

    this.cropState.box = { left, top, width, height };
    this.updateCropBoxDOM();
  },

  updateCropBoxDOM() {
    const cropBox = document.getElementById('crop-box');
    if (!cropBox) return;

    const { left, top, width, height } = this.cropState.box;
    cropBox.style.left = `${left}px`;
    cropBox.style.top = `${top}px`;
    cropBox.style.width = `${width}px`;
    cropBox.style.height = `${height}px`;
    cropBox.classList.remove('hidden');
  },

  confirmCrop() {
    if (!SessionManager.currentImage || !UI.currentDeckId) return;

    const img = document.getElementById('session-image');
    const stage = document.getElementById('image-stage');
    if (!img || !stage || !img.naturalWidth || !img.naturalHeight) return;

    const imgRect = img.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();

    // Box coordinates relative to viewport
    const boxScreenLeft = stageRect.left + this.cropState.box.left;
    const boxScreenTop = stageRect.top + this.cropState.box.top;
    const boxScreenRight = boxScreenLeft + this.cropState.box.width;
    const boxScreenBottom = boxScreenTop + this.cropState.box.height;

    // Normalize relative to image element bounds
    const normX = Math.max(0, Math.min(1, (boxScreenLeft - imgRect.left) / imgRect.width));
    const normY = Math.max(0, Math.min(1, (boxScreenTop - imgRect.top) / imgRect.height));
    const normW = Math.max(0.02, Math.min(1, (boxScreenRight - boxScreenLeft) / imgRect.width));
    const normH = Math.max(0.02, Math.min(1, (boxScreenBottom - boxScreenTop) / imgRect.height));

    const input = document.getElementById('crop-label-input');
    const label = input ? input.value.trim() : '';

    const selectedTags = Array.from(document.querySelectorAll('.btn-crop-tag.active')).map(b => b.dataset.tag);
    if (selectedTags.length === 0) selectedTags.push('crop');

    const cropObj = {
      x: parseFloat(normX.toFixed(4)),
      y: parseFloat(normY.toFixed(4)),
      w: parseFloat(normW.toFixed(4)),
      h: parseFloat(normH.toFixed(4))
    };

    const childCard = CardManager.createChildCard(
      UI.currentDeckId,
      SessionManager.currentImage,
      cropObj,
      label,
      selectedTags
    );

    if (childCard) {
      SoundFX.cardAdd();
      UI.showToast(`Created Focal Card: ${childCard.imageName}`, 'scissors');
      Storage.syncToDisk(false).catch(() => { });
    }

    this.cancelCrop();
  },

  onImageLoaded(image) {
    const focalPill = document.getElementById('session-focal-pill');
    if (!image || !image.isChild || !image.crop) {
      if (focalPill) focalPill.classList.add('hidden');
      this.isFocalMode = false;
      return;
    }

    this.isFocalMode = true;
    if (focalPill) {
      focalPill.classList.remove('hidden');
      this.updateFocalPillUI(image);
    }

    // Auto-frame focal crop
    this.applyFocalCrop(image.crop);
  },

  applyFocalCrop(crop) {
    if (!crop) return;
    const stage = document.getElementById('image-stage');
    const img = document.getElementById('session-image');
    if (!stage || !img || !img.naturalWidth) return;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const fitScale = ArtistToolbox.fitScale || 1;

    // Center of crop in normalized coordinates (0 to 1)
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;

    // Offset from image center (0.5, 0.5)
    const dx = cx - 0.5;
    const dy = cy - 0.5;

    // Zoom level required to fill frame with the cropped box
    const maxSpan = Math.max(crop.w, crop.h);
    const targetZoom = Math.min(ArtistToolbox.MAX_ZOOM, Math.max(1.15, (0.88 / maxSpan)));

    // Calculate required pan in pixels
    const frameW = nw * fitScale;
    const frameH = nh * fitScale;
    const panX = - (dx * frameW) * targetZoom;
    const panY = - (dy * frameH) * targetZoom;

    ArtistToolbox.zoom = targetZoom;
    ArtistToolbox.panX = panX;
    ArtistToolbox.panY = panY;
    ArtistToolbox.applyTransform();
  },

  toggleFocalContext() {
    if (!SessionManager.currentImage || !SessionManager.currentImage.isChild || !SessionManager.currentImage.crop) return;

    this.isFocalMode = !this.isFocalMode;
    SoundFX.toolToggle();

    if (this.isFocalMode) {
      this.applyFocalCrop(SessionManager.currentImage.crop);
    } else {
      ArtistToolbox.resetZoomPan();
    }

    this.updateFocalPillUI(SessionManager.currentImage);
  },

  updateFocalPillUI(image) {
    const focalPill = document.getElementById('session-focal-pill');
    if (!focalPill) return;

    const modeText = this.isFocalMode ? 'Focal View' : 'Full Reference';
    const toggleHint = this.isFocalMode ? 'Shift+C: Full Ref' : 'Shift+C: Focal';
    focalPill.innerHTML = `<span>${UI.getIconSvg('scissors', 12)}</span> <strong>${modeText}</strong> <span class="focal-pill-toggle">${toggleHint}</span>`;
    focalPill.classList.toggle('active', this.isFocalMode);
  }
};

// ==================== PLUMB-LINE & ANGLE MEASUREMENT TOOL ====================
const PlumbTool = {
  isActive: false,       // Measure mode [U] toggle state
  isMeasuring: false,    // Currently dragging a measurement line
  lines: [],             // Up to 3 active measurement lines
  currentLine: null,     // Active line being drawn
  svgEl: null,

  // Atelier studio palette: 1 = Amber, 2 = Sky Cyan, 3 = Coral Rose
  palette: [
    { main: '#f59e0b', faint: 'rgba(245, 158, 11, 0.45)', text: '#fbbf24' },
    { main: '#38bdf8', faint: 'rgba(56, 189, 248, 0.45)', text: '#7dd3fc' },
    { main: '#f43f5e', faint: 'rgba(244, 63, 94, 0.45)', text: '#fda4af' }
  ],

  init() {
    this.svgEl = document.getElementById('plumb-overlay');
    this.bindEvents();
  },

  onImageLoaded(imgEl) {
    if (imgEl && imgEl.naturalWidth && imgEl.naturalHeight) {
      this.svgEl = document.getElementById('plumb-overlay');
      if (this.svgEl) {
        this.svgEl.setAttribute('viewBox', `0 0 ${imgEl.naturalWidth} ${imgEl.naturalHeight}`);
      }
    }
    this.clearLines();
  },

  bindEvents() {
    const btn = document.getElementById('btn-art-plumb');
    if (btn) {
      btn.addEventListener('click', () => {
        this.handleHotkey();
      });
    }
  },

  handleHotkey() {
    // If lines exist on screen, clear them; otherwise toggle Measure Mode
    if (this.lines.length > 0) {
      this.clearLines();
      SoundFX.click();
    } else {
      this.toggleMode();
    }
  },

  toggleMode(forceState = null) {
    this.isActive = forceState !== null ? forceState : !this.isActive;
    this.syncUI();
    SoundFX.toolToggle();
  },

  clearLines() {
    this.lines = [];
    this.currentLine = null;
    this.render();
    this.syncUI();
  },

  getPoint(e) {
    const svg = this.svgEl || document.getElementById('plumb-overlay');
    const img = document.getElementById('session-image');
    if (!svg || !img || !img.naturalWidth || !img.naturalHeight) return null;

    // Ensure viewBox is synced with current image natural dimensions
    if (svg.getAttribute('viewBox') !== `0 0 ${img.naturalWidth} ${img.naturalHeight}`) {
      svg.setAttribute('viewBox', `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
    }

    try {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const local = pt.matrixTransform(ctm.inverse());
      return {
        x: Math.max(0, Math.min(img.naturalWidth, local.x)),
        y: Math.max(0, Math.min(img.naturalHeight, local.y))
      };
    } catch (err) {
      return null;
    }
  },

  startDrag(e) {
    const pt = this.getPoint(e);
    if (!pt) return false;

    this.isMeasuring = true;
    const colorIdx = this.lines.length % this.palette.length;
    this.currentLine = {
      x1: pt.x,
      y1: pt.y,
      x2: pt.x,
      y2: pt.y,
      colorIndex: colorIdx
    };

    this.render();
    return true;
  },

  updateDrag(e) {
    if (!this.isMeasuring || !this.currentLine) return;
    const pt = this.getPoint(e);
    if (!pt) return;

    this.currentLine.x2 = pt.x;
    this.currentLine.y2 = pt.y;
    this.render();
  },

  endDrag(e) {
    if (!this.isMeasuring || !this.currentLine) return;
    this.isMeasuring = false;

    const img = document.getElementById('session-image');
    const nh = img && img.naturalHeight ? img.naturalHeight : 1000;

    const dx = this.currentLine.x2 - this.currentLine.x1;
    const dy = this.currentLine.y2 - this.currentLine.y1;
    const dist = Math.hypot(dx, dy);

    // Filter out accidental clicks (minimum 6px drag)
    if (dist > 6) {
      const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
      const lenPct = Math.round((dist / nh) * 100);
      this.currentLine.angle = angle;
      this.currentLine.lenPct = lenPct;

      if (this.lines.length >= 3) {
        this.lines.shift(); // Keep up to 3 lines
      }
      this.lines.push(this.currentLine);
      SoundFX.click();
    }

    this.currentLine = null;
    this.render();
    this.syncUI();
  },

  render() {
    const svg = this.svgEl || document.getElementById('plumb-overlay');
    if (!svg) return;

    const allLines = [...this.lines];
    if (this.currentLine) {
      allLines.push(this.currentLine);
    }

    if (allLines.length === 0) {
      svg.innerHTML = '';
      svg.classList.add('hidden');
      return;
    }

    svg.classList.remove('hidden');

    const img = document.getElementById('session-image');
    const nw = img && img.naturalWidth ? img.naturalWidth : 1000;
    const nh = img && img.naturalHeight ? img.naturalHeight : 1000;
    const flipX = (typeof ArtistToolbox !== 'undefined' && ArtistToolbox.flipX) || 1;
    const rotate = (typeof ArtistToolbox !== 'undefined' && ArtistToolbox.rotateTotal) || 0;

    let html = '';

    allLines.forEach((line) => {
      const dx = line.x2 - line.x1;
      const dy = line.y2 - line.y1;
      const dist = Math.hypot(dx, dy);
      const angle = line.angle !== undefined ? line.angle : Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
      const lenPct = line.lenPct !== undefined ? line.lenPct : Math.round((dist / nh) * 100);
      const col = this.palette[line.colorIndex % this.palette.length];
      const mx = (line.x1 + line.x2) / 2;
      const my = (line.y1 + line.y2) / 2;

      // 1. Faint dashed vertical and horizontal plumb crosshairs spanning the image bounds
      // Start crosshair
      html += `<line x1="${line.x1}" y1="0" x2="${line.x1}" y2="${nh}" stroke="${col.faint}" stroke-width="1.2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />`;
      html += `<line x1="0" y1="${line.y1}" x2="${nw}" y2="${line.y1}" stroke="${col.faint}" stroke-width="1.2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />`;

      // End crosshair
      html += `<line x1="${line.x2}" y1="0" x2="${line.x2}" y2="${nh}" stroke="${col.faint}" stroke-width="1.2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />`;
      html += `<line x1="0" y1="${line.y2}" x2="${nw}" y2="${line.y2}" stroke="${col.faint}" stroke-width="1.2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />`;

      // 2. High-contrast underlay drop-shadow and crisp vector measurement line
      html += `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="#000000" stroke-width="3.5" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity="0.65" />`;
      html += `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${col.main}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" />`;

      // 3. Anchor points (dots)
      html += `<circle cx="${line.x1}" cy="${line.y1}" r="4" fill="${col.main}" stroke="#121212" stroke-width="1.5" vector-effect="non-scaling-stroke" />`;
      html += `<circle cx="${line.x2}" cy="${line.y2}" r="4" fill="${col.main}" stroke="#121212" stroke-width="1.5" vector-effect="non-scaling-stroke" />`;

      // 4. Midpoint pill badge showing exact angle and relative length (% of image height)
      if (dist > 12) {
        // Counter-transform so badge text always remains upright and readable
        const badgeWidth = 92;
        const badgeHeight = 22;
        html += `
          <g transform="translate(${mx}, ${my}) rotate(${-rotate}) scale(${flipX}, 1)">
            <rect x="${-badgeWidth / 2}" y="${-badgeHeight / 2}" width="${badgeWidth}" height="${badgeHeight}" rx="4" ry="4" fill="rgba(18, 18, 18, 0.94)" stroke="${col.main}" stroke-width="1" vector-effect="non-scaling-stroke" />
            <text x="0" y="3.5" text-anchor="middle" fill="${col.text}" font-family="'JetBrains Mono', 'SF Mono', monospace" font-size="10.5" font-weight="700">
              ${angle.toFixed(1)}° · ${lenPct}%
            </text>
          </g>
        `;
      }
    });

    svg.innerHTML = html;
  },

  syncUI() {
    const btn = document.getElementById('btn-art-plumb');
    const badge = document.getElementById('plumb-count-badge');
    const stage = document.getElementById('image-stage');

    const hasLines = this.lines.length > 0;
    if (btn) {
      btn.classList.toggle('active', this.isActive || hasLines);
      btn.title = hasLines
        ? `Plumb-Line & Angle Measurement [U] (${this.lines.length}/3 active — click or press U to clear)`
        : 'Plumb-Line & Angle Measurement [U] (or Shift+Drag on stage)';
    }

    if (badge) {
      if (hasLines) {
        badge.textContent = this.lines.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    if (stage) {
      stage.classList.toggle('plumb-active', this.isActive);
    }
  },

  renderToCanvas(ctx, nw, nh, drawW, drawH) {
    const allLines = [...this.lines];
    if (this.currentLine) allLines.push(this.currentLine);
    if (allLines.length === 0) return;

    allLines.forEach(line => {
      const col = this.palette[line.colorIndex % this.palette.length];
      const sx1 = -drawW / 2 + (line.x1 / nw) * drawW;
      const sy1 = -drawH / 2 + (line.y1 / nh) * drawH;
      const sx2 = -drawW / 2 + (line.x2 / nw) * drawW;
      const sy2 = -drawH / 2 + (line.y2 / nh) * drawH;
      const dx = line.x2 - line.x1;
      const dy = line.y2 - line.y1;
      const dist = Math.hypot(dx, dy);
      const angle = line.angle !== undefined ? line.angle : Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
      const lenPct = line.lenPct !== undefined ? line.lenPct : Math.round((dist / nh) * 100);

      ctx.save();
      // Crosshairs
      ctx.strokeStyle = col.faint;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      // Start crosshair
      ctx.beginPath();
      ctx.moveTo(sx1, -drawH / 2);
      ctx.lineTo(sx1, drawH / 2);
      ctx.moveTo(-drawW / 2, sy1);
      ctx.lineTo(drawW / 2, sy1);
      // End crosshair
      ctx.moveTo(sx2, -drawH / 2);
      ctx.lineTo(sx2, drawH / 2);
      ctx.moveTo(-drawW / 2, sy2);
      ctx.lineTo(drawW / 2, sy2);
      ctx.stroke();

      // Main line
      ctx.setLineDash([]);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();

      ctx.strokeStyle = col.main;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();

      // Dots
      ctx.fillStyle = col.main;
      ctx.beginPath();
      ctx.arc(sx1, sy1, 4, 0, Math.PI * 2);
      ctx.arc(sx2, sy2, 4, 0, Math.PI * 2);
      ctx.fill();

      // Badge
      if (dist > 12) {
        const smx = (sx1 + sx2) / 2;
        const smy = (sy1 + sy2) / 2;
        const bw = 92;
        const bh = 22;
        ctx.fillStyle = 'rgba(18, 18, 18, 0.94)';
        ctx.strokeStyle = col.main;
        ctx.lineWidth = 1;
        ctx.fillRect(smx - bw / 2, smy - bh / 2, bw, bh);
        ctx.strokeRect(smx - bw / 2, smy - bh / 2, bw, bh);
        ctx.fillStyle = col.text;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${angle.toFixed(1)}° · ${lenPct}%`, smx, smy);
      }
      ctx.restore();
    });
  }
};

// ==================== NATIVE CANVAS PIP STREAMER (SAFARI / MACOS) ====================
const PiPCanvasStreamer = {
  canvas: null,
  ctx: null,
  video: null,
  isActive: false,
  _animId: null,

  init() {
    this.canvas = document.getElementById('safari-pip-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    this.video = document.getElementById('safari-pip-video');
  },

  async start() {
    this.init();
    if (!this.canvas || !this.video) return false;

    this.isActive = true;
    this.render();

    // Start render loop so WebKit's captureStream gets continuous frames
    const loop = () => {
      if (!this.isActive) return;
      this.render();
      this._animId = requestAnimationFrame(loop);
    };
    this._animId = requestAnimationFrame(loop);

    try {
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.defaultMuted = true;

      const stream = this.canvas.captureStream ? this.canvas.captureStream(30) : null;
      if (!stream) {
        throw new Error('captureStream is not supported on this browser');
      }
      this.video.srcObject = stream;
      await this.video.play();

      if (document.pictureInPictureEnabled && this.video !== document.pictureInPictureElement) {
        await this.video.requestPictureInPicture();
      }

      this.video.addEventListener('leavepictureinpicture', () => {
        this.stop();
        UI.closePiP(false);
      }, { once: true });

      // MediaSession controls on macOS native floating PiP window
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: SessionManager.currentImage ? SessionManager.currentImage.name : 'Drawing Reference',
          artist: 'Art Practice • macOS Always-on-Top PiP',
          album: 'ArtPractice Spaced Repetition'
        });
        try {
          navigator.mediaSession.setActionHandler('nexttrack', () => UI.showNextImage());
          navigator.mediaSession.setActionHandler('play', () => UI.toggleTimerPause());
          navigator.mediaSession.setActionHandler('pause', () => UI.toggleTimerPause());
        } catch (e) { }
      }

      return true;
    } catch (err) {
      console.error('Failed to start Video Picture-in-Picture:', err);
      this.stop();
      return false;
    }
  },

  stop() {
    this.isActive = false;
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
    if (document.pictureInPictureElement && document.exitPictureInPicture) {
      try { document.exitPictureInPicture().catch(() => { }); } catch (e) { }
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  },

  render() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Dark atelier background
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, w, h);

    const img = document.getElementById('session-image');
    if (img && img.naturalWidth > 0 && img.complete) {
      const topMargin = 38;
      const bottomMargin = 42;
      const stageW = w - 16;
      const stageH = h - topMargin - bottomMargin;
      const stageX = 8;
      const stageY = topMargin;

      ctx.save();
      ctx.beginPath();
      ctx.rect(stageX, stageY, stageW, stageH);
      ctx.clip();

      ctx.fillStyle = '#0f1420';
      ctx.fillRect(stageX, stageY, stageW, stageH);

      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const quarter = ArtistToolbox.rotate % 180 === 90;
      const ew = quarter ? nh : nw;
      const eh = quarter ? nw : nh;
      const scale = Math.min(stageW / ew, stageH / eh) * ArtistToolbox.zoom;

      const cx = stageX + stageW / 2 + ArtistToolbox.panX;
      const cy = stageY + stageH / 2 + ArtistToolbox.panY;

      ctx.translate(cx, cy);
      ctx.scale(ArtistToolbox.flipX, 1);
      ctx.rotate((ArtistToolbox.rotateTotal * Math.PI) / 180);

      const drawW = nw * scale;
      const drawH = nh * scale;
      if (ArtistToolbox.squint) {
        try { ctx.filter = `blur(${ArtistToolbox.squintRadius}px)`; } catch (e) { }
      } else {
        try { ctx.filter = 'none'; } catch (e) { }
      }
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      try { ctx.filter = 'none'; } catch (e) { }

      // Render Sketch Overlay on canvas stream if active
      if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active && SketchOverlay.visible && SketchOverlay.imgEl && SketchOverlay.imgEl.complete && SketchOverlay.imgEl.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = SketchOverlay.opacity;
        if (SketchOverlay.blendMode === 'difference') {
          ctx.globalCompositeOperation = 'difference';
        } else if (SketchOverlay.blendMode === 'multiply') {
          ctx.globalCompositeOperation = 'multiply';
        } else {
          ctx.globalCompositeOperation = 'source-over';
        }

        // Apply independent Pan, Rotate, and Scale alignment
        ctx.translate(SketchOverlay.sketchOffsetX || 0, SketchOverlay.sketchOffsetY || 0);
        if (SketchOverlay.sketchRotate) {
          ctx.rotate((SketchOverlay.sketchRotate * Math.PI) / 180);
        }
        if (SketchOverlay.sketchScale && SketchOverlay.sketchScale !== 1) {
          ctx.scale(SketchOverlay.sketchScale, SketchOverlay.sketchScale);
        }

        ctx.drawImage(SketchOverlay.imgEl, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }

      // Render Plumb-Line & Angle Measurement Overlay on canvas stream if active
      if (typeof PlumbTool !== 'undefined' && (PlumbTool.lines.length > 0 || PlumbTool.currentLine)) {
        PlumbTool.renderToCanvas(ctx, nw, nh, drawW, drawH);
      }

      ctx.restore();

      // Apply pixel filter if needed (grayscale, invert, notan, silhouette, posterize)
      if (ArtistToolbox.grayscale || ArtistToolbox.invert || ArtistToolbox.notan || ArtistToolbox.silhouette || ArtistToolbox.posterize) {
        try {
          const imgData = ctx.getImageData(stageX, stageY, stageW, stageH);
          const d = imgData.data;
          const isNotan = ArtistToolbox.notan;
          const isSil = ArtistToolbox.silhouette;
          const isPost = ArtistToolbox.posterize;
          const postSteps = Math.max(2, Math.min(6, ArtistToolbox.posterizeSteps || 4));
          const thresh = isSil ? (ArtistToolbox.silhouetteThreshold * 255) : 128;
          const silInvert = ArtistToolbox.silhouetteInverted;
          const isInvert = ArtistToolbox.invert;
          const isGray = ArtistToolbox.grayscale;

          for (let i = 0; i < d.length; i += 4) {
            let r = d[i], g = d[i + 1], b = d[i + 2];
            let lum = 0.299 * r + 0.587 * g + 0.114 * b;

            if (isNotan || isSil) {
              let v = lum > thresh ? 255 : 0;
              if (silInvert) v = 255 - v;
              d[i] = v; d[i + 1] = v; d[i + 2] = v;
            } else if (isPost) {
              const stepIdx = Math.round((lum / 255) * (postSteps - 1));
              const v = Math.round((stepIdx / (postSteps - 1)) * 255);
              d[i] = v; d[i + 1] = v; d[i + 2] = v;
            } else if (isGray) {
              d[i] = lum; d[i + 1] = lum; d[i + 2] = lum;
            }

            if (isInvert) {
              d[i] = 255 - d[i];
              d[i + 1] = 255 - d[i + 1];
              d[i + 2] = 255 - d[i + 2];
            }
          }
          ctx.putImageData(imgData, stageX, stageY);
        } catch (e) { }
      }

      // Draw Proportion Grid
      if (ArtistToolbox.grid) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        const mode = ArtistToolbox.GRID_MODES[ArtistToolbox.gridMode] || ArtistToolbox.GRID_MODES[0];
        const cols = mode.cols || 3;
        const rows = mode.rows || 3;

        for (let c = 1; c < cols; c++) {
          const gx = stageX + (stageW * c) / cols;
          ctx.beginPath();
          ctx.moveTo(gx, stageY);
          ctx.lineTo(gx, stageY + stageH);
          ctx.stroke();
        }
        for (let r = 1; r < rows; r++) {
          const gy = stageY + (stageH * r) / rows;
          ctx.beginPath();
          ctx.moveTo(stageX, gy);
          ctx.lineTo(stageX + stageW, gy);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Top Header: Timer Bar & Time Display
    const timerDuration = UI.getTimerDuration ? UI.getTimerDuration() : 0;
    if (timerDuration > 0 && TimerManager.isRunning) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(8, 12, w - 16, 5);

      const progress = Math.max(0, Math.min(1, TimerManager.remaining / timerDuration));
      ctx.fillStyle = progress <= 0.15 ? '#ef4444' : '#58a6ff';
      ctx.fillRect(8, 12, (w - 16) * progress, 5);
    }

    const timerTextEl = document.getElementById('timer-text');
    const timerStr = timerTextEl ? timerTextEl.textContent : '0:00';
    ctx.fillStyle = 'rgba(15, 20, 30, 0.85)';
    ctx.beginPath();
    ctx.rect(w - 78, 6, 70, 22);
    ctx.fill();

    ctx.fillStyle = '#f0f6fc';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timerStr, w - 43, 17);

    // Left title badge: Deck progress
    const progressEl = document.getElementById('session-progress');
    const progText = progressEl ? progressEl.textContent : '#1';
    ctx.fillStyle = '#8b949e';
    ctx.font = '600 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(progText, 12, 17);

    // Active filter badge if any filter is active
    let filterTag = '';
    if (ArtistToolbox.silhouette) filterTag = `SIL ${Math.round(ArtistToolbox.silhouetteThreshold * 100)}%`;
    else if (ArtistToolbox.posterize) filterTag = `POST ${ArtistToolbox.posterizeSteps}`;
    else if (ArtistToolbox.notan) filterTag = 'NOTAN';
    else if (ArtistToolbox.grayscale) filterTag = 'VALUE';
    if (filterTag) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(48, 6, 72, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 10.5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(filterTag, 84, 17);
    }

    // Active card tags (e.g. #hands #foreshortening)
    if (SessionManager.currentImage && UI.currentDeckId) {
      const cardTags = CardManager.getTagsForCard(UI.currentDeckId, SessionManager.currentImage.id);
      if (cardTags && cardTags.length > 0) {
        const tagText = cardTags.map(t => `#${t}`).join(' ');
        const startX = filterTag ? 128 : 52;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, startX, 17);
      }
    }

    // Bottom Dock: Spaced Repetition Hotkey Guide Pill
    const pillY = h - 34;
    const pillH = 26;
    const pillW = 320;
    const pillX = (w - pillW) / 2;

    ctx.fillStyle = 'rgba(12, 16, 25, 0.92)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(pillX, pillY, pillW, pillH);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 11.5px monospace, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('1 Hard', pillX + 16, pillY + pillH / 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('2 Med', pillX + 88, pillY + pillH / 2);
    ctx.fillStyle = '#10b981';
    ctx.fillText('3 Easy', pillX + 160, pillY + pillH / 2);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('S Skip', pillX + 242, pillY + pillH / 2);
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
  isPiPActive: false,
  isSafariVideoPiP: false,
  isElectron: /Electron/i.test(navigator.userAgent) || window.location.search.includes('electron=1'),
  isMac: /Macintosh|Mac OS X/i.test(navigator.userAgent),
  isElectronFloating: false,
  pipWindow: null,
  deckMeta: {},
  _hudTimer: null,
  _overHud: false,
  _wasNativeFs: false,
  autoAdvance: false,
  _autoAdvanceTimer: null,
  selectedTagFilter: null,
  isTagDockOpen: false,

  async init() {
    if (this.isElectron) {
      document.body.classList.add('is-electron');
      if (this.isMac) document.body.classList.add('is-mac');
      this.checkElectronFloatStatus();
    }

    if (window.electronAPI && typeof window.electronAPI.onGlobalShortcut === 'function') {
      try {
        window.electronAPI.onGlobalShortcut((action, data) => {
          if (action === 'toggle-ghost-mode') {
            this.toggleGhostMode();
          } else if (action === 'ghost-mode-enabled') {
            this.setGhostModeState(true);
          } else if (action === 'ghost-mode-disabled') {
            this.setGhostModeState(false);
          } else if (action === 'opacity-changed' && data && typeof data.opacity === 'number') {
            this.showOpacityHUD(data.opacity, data.isGhostMode);
          }
        });
      } catch (err) {
        console.warn('Failed to register global shortcut listener:', err);
      }
    }

    await Storage.init();
    SoundFX.init();
    DeckManager.init();
    CardManager.init();
    ReviewHistory.init();
    await WallpaperManager.init();
    SketchOverlay.init();
    SketchComparison.init();
    ColorPaletteManager.init();
    SmartCropManager.init();
    PlumbTool.init();
    ArtistToolbox.setupDragAndWheel();

    this.initDueIcons();
    this.bindEvents();
    this.showDeckList();
  },

  getIconSvg(name, size = 14, className = '') {
    const EMOJI_MAP = {
      '💾': 'save',
      '⚠️': 'alert',
      '🔊': 'volume',
      '🔇': 'volume-x',
      '🎨': 'palette',
      '🧹': 'broom',
      '✋': 'hand',
      '📐': 'perspective',
      '💡': 'lightbulb',
      '🦴': 'bone',
      '🏃': 'gesture',
      '🩸': 'leech',
      '👁️': 'eye',
      '🕶️': 'eye-off',
      '✏️': 'pencil',
      '✓': 'check',
      '✂️': 'scissors',
      '⚖️': 'scale',
      '❌': 'x-circle',
      '⛶': 'fullscreen',
      '✕': 'close',
      '📁': 'folder',
      '🏷️': 'tag',
      '🗑️': 'trash',
      '✨': 'sparkles',
      'ℹ️': 'info',
      '★': 'star',
      '⇄': 'refresh',
      '⏱': 'timer',
      '👻': 'ghost'
    };
    const key = EMOJI_MAP[name] || name;
    const cls = className ? ` class="${className}"` : '';

    const ICONS = {
      'ghost': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/></svg>`,
      'volume': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
      'volume-x': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>`,
      'save': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
      'alert': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      'palette': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"/></svg>`,
      'broom': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 10 5.5-5.5a1.5 1.5 0 0 1 2.1 2.1L16 12"/><path d="M14 10 9 15"/><path d="m3 21 3.5-3.5a2 2 0 0 1 2.8 0L11 19l4-4-5-5-1.5 1.5a2 2 0 0 1-2.8 0L3 21Z"/></svg>`,
      'hand': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0v4"/><path d="M14 10V4a2 2 0 0 0-4 0v7"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,
      'perspective': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 22 8-8"/><path d="m22 22-8-8"/><path d="M10 14h4"/><path d="m2 2 8 8"/><path d="m22 2-8 8"/><path d="M10 10h4"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
      'lightbulb': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>`,
      'bone': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 10c.7-.7 1.69-1 2.5-1a2.5 2.5 0 1 1 0 5c-.81 0-1.8-.3-2.5-1L7 17c-.7.7-1 1.69-1 2.5a2.5 2.5 0 1 1-5 0c0-.81.3-1.8 1-2.5l10-10c.7-.7 1-1.69 1-2.5a2.5 2.5 0 1 1 5 0c0 .81-.3 1.8-1 2.5Z"/></svg>`,
      'gesture': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="17" cy="4" r="2"/><path d="m15 8-4 4-3-2-5 3"/><path d="m13 13 2 4 4 1"/><path d="m9 16-2 5"/></svg>`,
      'leech': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`,
      'tag': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`,
      'folder': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 8 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
      'eye': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg>`,
      'eye-off': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
      'pencil': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
      'check': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
      'scissors': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`,
      'crop': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>`,
      'info': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
      'scale': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>`,
      'x-circle': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      'fullscreen': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
      'fullscreen-exit': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`,
      'close': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      'trash': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
      'sparkles': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`,
      'star': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
      'refresh': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`,
      'timer': `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="14" r="8"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="2" x2="12" y2="6"/></svg>`
    };

    return ICONS[key] || ICONS['sparkles'];
  },

  getFlameSvgHTML(width = 16, height = 20) {
    return `<svg class="atelier-flame-icon" viewBox="0 0 100 125" width="${width}" height="${height}" aria-hidden="true" style="vertical-align: middle; flex-shrink: 0;"><path d="M26 98 C10 80 12 52 32 28 C28 18 28 10 29 4 C36 14 42 25 44 36 C30 55 22 76 26 98 Z" fill="#27272A"/><path d="M24 96 C15 72 28 42 62 2 C58 28 64 46 74 60 C55 82 40 96 24 96 Z" fill="url(#flame-core-grad)"/><path d="M24 96 C18 76 24 54 38 34 C34 52 34 66 36 78 C46 58 60 46 76 38 C82 28 84 18 83 8 C92 26 94 50 86 72 C72 88 48 102 24 96 Z" fill="#3F3F46"/><circle cx="48" cy="70" r="26" fill="url(#flame-inner-glow)" style="mix-blend-mode: screen;"/><path d="M32 104 C20 94 22 76 30 68 C29 78 36 86 46 84 C58 82 60 66 54 52 C68 62 76 80 68 98 C60 112 44 112 32 104 Z" fill="#F4F4F0"/></svg>`;
  },

  getDueSvgHTML(size = 12) {
    return `<svg class="stat-svg stat-svg-due atelier-due-icon" viewBox="48 72 48 140" width="${size}" height="${size}" fill="none" aria-hidden="true" style="vertical-align: middle; flex-shrink: 0;"><g><path style="fill:#ff0000;fill-opacity:1;stroke-width:0.281001" d="m 69.879012,182.04874 c -4.030391,-6.8687 -12.77236,-22.76319 -16.405374,-31.84578 -3.633015,-9.08259 -2.157124,-11.35319 2.497769,-16.12161 4.654894,-4.76842 12.488453,-12.03433 12.545142,-22.25236 0.05669,-10.21802 -7.663339,-23.387477 -11.693732,-30.199408 -4.030393,-6.81193 -4.370983,-7.26605 3.406125,-0.964888 7.777109,6.301163 23.671288,19.357096 27.815133,30.029196 4.143844,10.6721 -3.462655,18.95978 -9.309598,25.60145 -5.846943,6.64168 -9.934021,11.637 -10.671952,19.41405 -0.737931,7.77706 1.873254,18.33533 3.519476,24.69315 1.646222,6.35782 2.327401,8.51489 -1.702989,1.6462 z" transform="rotate(4.9450556,70.333789,142.50045)"></path><path style="fill:#1a1a1a;fill-opacity:1;stroke-width:0.281001" d="m 69.879012,182.04874 c -4.030391,-6.8687 -12.77236,-22.76319 -16.405374,-31.84578 -3.633015,-9.08259 -2.157124,-11.35319 2.497769,-16.12161 4.654894,-4.76842 12.488453,-12.03433 12.545142,-22.25236 0.05669,-10.21802 -7.663339,-23.387477 -11.693732,-30.199408 -4.030393,-6.81193 -4.370983,-7.26605 3.406125,-0.964888 7.777109,6.301163 23.671288,19.357096 27.815133,30.029196 4.143844,10.6721 -3.462655,18.95978 -9.309598,25.60145 -5.846943,6.64168 -9.934021,11.637 -10.671952,19.41405 -0.737931,7.77706 1.873254,18.33533 3.519476,24.69315 1.646222,6.35782 2.327401,8.51489 -1.702989,1.6462 z" transform="matrix(0.63709831,0.0551233,-0.07473089,0.86371681,34.212727,13.611625)"></path><ellipse style="fill:#ff0000;fill-opacity:1;stroke-width:0.281001" cx="85.079712" cy="193.16653" rx="8.6852064" ry="9.0258026" transform="rotate(4.9450556)"></ellipse><ellipse style="fill:#1a1a1a;fill-opacity:1;stroke-width:0.197259" cx="84.133904" cy="194.31033" rx="6.3010321" ry="6.130734" transform="rotate(4.9450556)"></ellipse></g></svg>`;
  },

  formatShortPath(p) {
    if (!p) return '';
    const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length > 3) {
      return '~/' + parts.slice(-3).join('/');
    }
    return p;
  },

  initDueIcons() {
    const dueSvgMarkup = `<svg class="stat-svg stat-svg-due atelier-due-icon" viewBox="48 72 48 140" width="14" height="14" fill="none" aria-hidden="true"><g id="layer1"><path style="fill:#ff0000;fill-opacity:1;stroke-width:0.281001" d="m 69.879012,182.04874 c -4.030391,-6.8687 -12.77236,-22.76319 -16.405374,-31.84578 -3.633015,-9.08259 -2.157124,-11.35319 2.497769,-16.12161 4.654894,-4.76842 12.488453,-12.03433 12.545142,-22.25236 0.05669,-10.21802 -7.663339,-23.387477 -11.693732,-30.199408 -4.030393,-6.81193 -4.370983,-7.26605 3.406125,-0.964888 7.777109,6.301163 23.671288,19.357096 27.815133,30.029196 4.143844,10.6721 -3.462655,18.95978 -9.309598,25.60145 -5.846943,6.64168 -9.934021,11.637 -10.671952,19.41405 -0.737931,7.77706 1.873254,18.33533 3.519476,24.69315 1.646222,6.35782 2.327401,8.51489 -1.702989,1.6462 z" id="path1" transform="rotate(4.9450556,70.333789,142.50045)"></path><path style="fill:#1a1a1a;fill-opacity:1;stroke-width:0.281001" d="m 69.879012,182.04874 c -4.030391,-6.8687 -12.77236,-22.76319 -16.405374,-31.84578 -3.633015,-9.08259 -2.157124,-11.35319 2.497769,-16.12161 4.654894,-4.76842 12.488453,-12.03433 12.545142,-22.25236 0.05669,-10.21802 -7.663339,-23.387477 -11.693732,-30.199408 -4.030393,-6.81193 -4.370983,-7.26605 3.406125,-0.964888 7.777109,6.301163 23.671288,19.357096 27.815133,30.029196 4.143844,10.6721 -3.462655,18.95978 -9.309598,25.60145 -5.846943,6.64168 -9.934021,11.637 -10.671952,19.41405 -0.737931,7.77706 1.873254,18.33533 3.519476,24.69315 1.646222,6.35782 2.327401,8.51489 -1.702989,1.6462 z" id="path1-1" transform="matrix(0.63709831,0.0551233,-0.07473089,0.86371681,34.212727,13.611625)"></path><ellipse style="fill:#ff0000;fill-opacity:1;stroke-width:0.281001" id="path2" cx="85.079712" cy="193.16653" rx="8.6852064" ry="9.0258026" transform="rotate(4.9450556)"></ellipse><ellipse style="fill:#1a1a1a;fill-opacity:1;stroke-width:0.197259" id="path2-0" cx="84.133904" cy="194.31033" rx="6.3010321" ry="6.130734" transform="rotate(4.9450556)"></ellipse></g></svg>`;
    document.querySelectorAll('.stat-svg-due').forEach(el => {
      if (!el.querySelector('#layer1')) {
        el.outerHTML = dueSvgMarkup;
      }
    });
  },

  // ---- Toast HUD ----
  showToast(message, icon = 'sparkles') {
    // When inside active study session, float mode, or zen mode, never pop notifications over artwork
    const inSession = document.body.classList.contains('in-session') ||
      document.body.classList.contains('pip-mode') ||
      document.body.classList.contains('zen-active') ||
      this.isPiPActive ||
      (document.getElementById('view-session')?.classList.contains('active'));
    if (inSession) {
      return;
    }

    const container = document.getElementById('toast-container');
    if (!container) return;

    // Immediately clear any existing toasts so they never stack into a pile
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconSvg = this.getIconSvg ? this.getIconSvg(icon, 16, 'toast-svg') : '';
    toast.innerHTML = `<span class="toast-icon">${iconSvg}</span> <span>${this._esc(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 250);
    }, 1800);
  },

  // ---- Event Binding ----
  bindEvents() {
    // Sound Toggles
    const toggleSoundHandler = () => {
      SoundFX.toggle();
    };
    const btnSound1 = document.getElementById('btn-toggle-sound');
    if (btnSound1) btnSound1.addEventListener('click', toggleSoundHandler);
    const btnSound2 = document.getElementById('btn-detail-sound');
    if (btnSound2) btnSound2.addEventListener('click', toggleSoundHandler);
    const btnSound3 = document.getElementById('btn-session-sound');
    if (btnSound3) btnSound3.addEventListener('click', toggleSoundHandler);

    // Global tactile click sound on interactive elements & background
    document.addEventListener('click', (e) => {
      const interactiveEl = e.target.closest('button, .btn, .folder-item, .btn-rate, .deck-card, .tool-btn, .badge, .tab-btn, a, .stat-pill, .control-btn, .shortcut-row');
      if (interactiveEl) {
        SoundFX.click();
      } else if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        SoundFX.click();
      }
    });

    // Soft fluid droplet hover sound on interactive elements
    document.addEventListener('mouseover', (e) => {
      const interactive = e.target.closest('button, .btn, .folder-item, .btn-rate, .tool-btn, .tab-btn');
      if (interactive && !interactive.dataset.hovered) {
        interactive.dataset.hovered = '1';
        SoundFX.hover();
      }
    });
    document.addEventListener('mouseout', (e) => {
      const interactive = e.target.closest('button, .btn, .folder-item, .btn-rate, .tool-btn, .tab-btn');
      if (interactive) {
        delete interactive.dataset.hovered;
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
    const clearFilterBtn = document.getElementById('btn-clear-tag-filter');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', () => {
        SoundFX.click();
        this.selectedTagFilter = null;
        this.renderDeckStats();
        this.renderDeckFocusTags();
      });
    }

    // Web / Pinterest Clipper
    const btnClip = document.getElementById('btn-clip-url');
    const inputClip = document.getElementById('input-clip-url');
    if (btnClip && inputClip) {
      const handleClip = async () => {
        const currentDeck = DeckManager.getById(this.currentDeckId);
        if (!currentDeck) return;
        if (!currentDeck.folder && currentDeck.folderPath) currentDeck.folder = currentDeck.folderPath;

        const url = (inputClip.value || '').trim();
        const statusEl = document.getElementById('clip-status-msg');
        if (!url) return;

        const originalBtnText = btnClip.textContent;
        btnClip.textContent = 'Downloading...';
        btnClip.disabled = true;

        try {
          const res = await fetch('/api/download-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: currentDeck.folder, url })
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed to download image');
          }

          inputClip.value = '';
          if (statusEl) {
            statusEl.textContent = '✓ Saved to folder';
            statusEl.className = 'status-success';
            setTimeout(() => {
              if (statusEl.textContent === '✓ Saved to folder') {
                statusEl.textContent = '';
                statusEl.className = '';
              }
            }, 3000);
          }

          // Refresh current Deck Detail stats so Total Images and Unseen increment immediately
          if (this.deckMeta) {
            delete this.deckMeta[currentDeck.folder];
            delete this.deckMeta[currentDeck.folderPath];
          }
          this.cachedImages = await SessionManager.loadImages(currentDeck.folder || currentDeck.folderPath);
          CardManager.migrateLegacyPathCards(this.currentDeckId, this.cachedImages);
          this.renderDeckStats();
          this.renderDeckFocusTags();
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = err.message || 'Download error';
            statusEl.className = 'status-error';
            setTimeout(() => {
              if (statusEl.textContent === (err.message || 'Download error')) {
                statusEl.textContent = '';
                statusEl.className = '';
              }
            }, 3000);
          }
        } finally {
          btnClip.textContent = originalBtnText;
          btnClip.disabled = false;
        }
      };

      btnClip.addEventListener('click', handleClip);
      inputClip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleClip();
        }
      });
    }

    // Overdue Backlog Load-Balancer Button
    const btnReflow = document.getElementById('btn-reflow-backlog');
    if (btnReflow) {
      btnReflow.addEventListener('click', () => {
        if (!this.currentDeckId) return;
        const result = CardManager.reflowOverdueBacklog(this.currentDeckId);
        SoundFX.click();

        const originalHtml = `<span class="btn-icon">${this.getIconSvg('scale', 14)}</span> <span>Reflow Overdue Backlog</span> <span id="reflow-badge" class="reflow-badge hidden">0</span>`;
        if (result.reflowedCount > 0) {
          btnReflow.innerHTML = `<span><span class="btn-icon">${this.getIconSvg('check', 14)}</span> <span>Reflowed ${result.reflowedCount} cards across 5 days!</span></span>`;
          btnReflow.classList.add('reflow-success');
        } else {
          btnReflow.innerHTML = `<span><span class="btn-icon">${this.getIconSvg('check', 14)}</span> <span>Queue within daily limit (${result.totalDue}/${result.limit})</span></span>`;
        }

        this.renderDeckStats();
        this.renderHeatmap();
        this.renderTodayStrip();

        setTimeout(() => {
          btnReflow.innerHTML = originalHtml;
          btnReflow.classList.remove('reflow-success');
          this.renderDeckStats();
        }, 3200);
      });
    }

    // Quick Tagging Dock
    const btnArtTag = document.getElementById('btn-art-tag');
    if (btnArtTag) btnArtTag.addEventListener('click', () => this.toggleTagDock());
    const btnCloseTagDock = document.getElementById('btn-close-tag-dock');
    if (btnCloseTagDock) btnCloseTagDock.addEventListener('click', () => this.toggleTagDock(false));

    const btnSubmitTag = document.getElementById('btn-submit-tag');
    const inputCustomTag = document.getElementById('input-custom-tag');
    if (btnSubmitTag && inputCustomTag) {
      const submitCustom = () => {
        const val = inputCustomTag.value.trim();
        if (val) {
          this.toggleCardTag(val);
          inputCustomTag.value = '';
        }
      };
      btnSubmitTag.addEventListener('click', submitCustom);
      inputCustomTag.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitCustom();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.toggleTagDock(false);
        }
      });
    }

    // Session View & Rating
    document.getElementById('btn-end-session').addEventListener('click', () => this.endSession());
    document.getElementById('btn-session-zen').addEventListener('click', () => this.toggleZenMode());
    document.getElementById('btn-session-pip').addEventListener('click', () => this.togglePiP());
    const btnElectronUnfloat = document.getElementById('btn-electron-unfloat');
    if (btnElectronUnfloat) {
      btnElectronUnfloat.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.exitElectronFloat();
      });
    }
    const btnElectronGhost = document.getElementById('btn-electron-ghost');
    if (btnElectronGhost) {
      btnElectronGhost.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleGhostMode();
      });
    }
    const btnExitGhost = document.getElementById('btn-exit-ghost-mode');
    if (btnExitGhost) {
      btnExitGhost.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleGhostMode(false);
      });
    }
    const ghostInteractiveElements = [
      document.getElementById('ghost-mode-banner'),
      document.getElementById('electron-float-bar'),
      btnExitGhost,
      btnElectronGhost
    ].filter(Boolean);
    ghostInteractiveElements.forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (this.isGhostMode && window.electronAPI && typeof window.electronAPI.setIgnoreMouseEvents === 'function') {
          window.electronAPI.setIgnoreMouseEvents(false);
        }
      });
      el.addEventListener('mouseleave', () => {
        if (this.isGhostMode && window.electronAPI && typeof window.electronAPI.setIgnoreMouseEvents === 'function') {
          window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
        }
      });
    });
    const returnFromPiPBtn = document.getElementById('btn-return-from-pip');
    if (returnFromPiPBtn) returnFromPiPBtn.addEventListener('click', () => this.closePiP(true));
    const pipSwitchBtn = document.getElementById('btn-pip-mode-switch');
    if (pipSwitchBtn) {
      pipSwitchBtn.addEventListener('click', async () => {
        if (this.isSafariVideoPiP) {
          this.closePiP(false);
          await this.openPiP('popup');
        } else {
          this.closePiP(true);
          await this.openPiP('video');
        }
      });
    }
    const pipEndBtn = document.getElementById('btn-pip-end-session');
    if (pipEndBtn) pipEndBtn.addEventListener('click', () => { this.closePiP(true); this.endSession(); });
    window.addEventListener('beforeunload', () => { if (this.pipWindow) this.pipWindow.close(); });
    const btnAgain = document.getElementById('btn-rate-again');
    if (btnAgain) btnAgain.addEventListener('click', () => this.rateCurrentImage('again'));
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
    document.getElementById('btn-art-notan').addEventListener('click', () => ArtistToolbox.toggleNotan());
    document.getElementById('btn-art-silhouette').addEventListener('click', () => ArtistToolbox.toggleSilhouette());
    document.getElementById('btn-art-posterize').addEventListener('click', () => ArtistToolbox.togglePosterize());
    const squintBtn = document.getElementById('btn-art-squint');
    if (squintBtn) squintBtn.addEventListener('click', () => ArtistToolbox.toggleSquint());
    document.getElementById('btn-art-grid').addEventListener('click', () => ArtistToolbox.toggleGrid());
    document.getElementById('btn-art-invert').addEventListener('click', () => ArtistToolbox.toggleInvert());
    document.getElementById('btn-img-flip').addEventListener('click', () => ArtistToolbox.flipHorizontal());
    document.getElementById('btn-img-rotate').addEventListener('click', () => ArtistToolbox.rotate90());
    document.getElementById('btn-img-zoom-in').addEventListener('click', () => ArtistToolbox.adjustZoom(0.25));
    document.getElementById('btn-img-zoom-out').addEventListener('click', () => ArtistToolbox.adjustZoom(-0.25));
    document.getElementById('btn-img-zoom-reset').addEventListener('click', () => ArtistToolbox.resetZoomPan());

    // Silhouette & Posterize HUD subpanel controls
    const silSlider = document.getElementById('slider-silhouette-threshold');
    if (silSlider) {
      silSlider.addEventListener('input', (e) => ArtistToolbox.setSilhouetteThreshold(e.target.value));
    }
    const silInvertBtn = document.getElementById('btn-silhouette-invert');
    if (silInvertBtn) {
      silInvertBtn.addEventListener('click', () => ArtistToolbox.toggleSilhouetteInvert());
    }
    const silResetBtn = document.getElementById('btn-silhouette-reset');
    if (silResetBtn) {
      silResetBtn.addEventListener('click', () => ArtistToolbox.resetSilhouetteThreshold());
    }

    const postSlider = document.getElementById('slider-posterize-steps');
    if (postSlider) {
      postSlider.addEventListener('input', (e) => ArtistToolbox.setPosterizeSteps(e.target.value));
    }
    const post3Btn = document.getElementById('btn-posterize-preset-3');
    if (post3Btn) {
      post3Btn.addEventListener('click', () => {
        if (!ArtistToolbox.posterize) ArtistToolbox.togglePosterize();
        ArtistToolbox.setPosterizeSteps(3);
      });
    }
    const post4Btn = document.getElementById('btn-posterize-preset-4');
    if (post4Btn) {
      post4Btn.addEventListener('click', () => {
        if (!ArtistToolbox.posterize) ArtistToolbox.togglePosterize();
        ArtistToolbox.setPosterizeSteps(4);
      });
    }

    // Squint Blur HUD subpanel controls
    const squintSlider = document.getElementById('slider-squint-radius');
    if (squintSlider) {
      squintSlider.addEventListener('input', (e) => ArtistToolbox.setSquintRadius(e.target.value));
    }
    const squintLightBtn = document.getElementById('btn-squint-preset-light');
    if (squintLightBtn) {
      squintLightBtn.addEventListener('click', () => {
        if (!ArtistToolbox.squint) ArtistToolbox.toggleSquint();
        ArtistToolbox.setSquintRadius(3);
      });
    }
    const squintMedBtn = document.getElementById('btn-squint-preset-medium');
    if (squintMedBtn) {
      squintMedBtn.addEventListener('click', () => {
        if (!ArtistToolbox.squint) ArtistToolbox.toggleSquint();
        ArtistToolbox.setSquintRadius(8);
      });
    }
    const squintHeavyBtn = document.getElementById('btn-squint-preset-heavy');
    if (squintHeavyBtn) {
      squintHeavyBtn.addEventListener('click', () => {
        if (!ArtistToolbox.squint) ArtistToolbox.toggleSquint();
        ArtistToolbox.setSquintRadius(16);
      });
    }
    const squintResetBtn = document.getElementById('btn-squint-reset');
    if (squintResetBtn) {
      squintResetBtn.addEventListener('click', () => {
        if (!ArtistToolbox.squint) ArtistToolbox.toggleSquint();
        ArtistToolbox.setSquintRadius(6);
      });
    }

    // Auto-advance toggle
    const autoAdvanceChk = document.getElementById('chk-auto-advance');
    if (autoAdvanceChk) {
      // Restore from localStorage
      const saved = localStorage.getItem('artpractice_auto_advance');
      if (saved === 'true') { autoAdvanceChk.checked = true; this.autoAdvance = true; }
      autoAdvanceChk.addEventListener('change', () => {
        this.autoAdvance = autoAdvanceChk.checked;
        localStorage.setItem('artpractice_auto_advance', String(this.autoAdvance));
      });
    }

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

    // Setup Electron Global Shortcut IPC listener (cleanup existing if re-initialized)
    this.setupGlobalShortcuts();

    // True fullscreen sync + auto-hiding session HUD
    this.bindFullscreenEvents();

    // Side tool dock auto-hide proximity (Mac dock behavior)
    this.bindSideDockEdgeAutoReveal(document);
  },

  _globalShortcutUnsubscribe: null,

  setupGlobalShortcuts() {
    if (this._globalShortcutUnsubscribe) {
      try {
        this._globalShortcutUnsubscribe();
      } catch (err) {
        console.warn('[UI] Error cleaning up previous global shortcut subscription:', err);
      }
      this._globalShortcutUnsubscribe = null;
    }

    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.onGlobalShortcut === 'function') {
      try {
        this._globalShortcutUnsubscribe = window.electronAPI.onGlobalShortcut((action, data) => {
          this.handleGlobalShortcutAction(action, data);
        });
      } catch (err) {
        console.warn('[UI] Failed to register global shortcut listener:', err);
      }
    }
  },

  handleGlobalShortcutAction(action, data) {
    if (!action) return;
    if (action === 'opacity-changed' && data && typeof data.opacity === 'number') {
      this.showOpacityHUD(data.opacity, data.isGhostMode);
      return;
    }
    if (typeof action === 'string') {
      const lower = action.toLowerCase();
      if (lower.length === 1 || ['space', 'escape', '+', '-', '=', '_', '[', ']'].includes(lower)) {
        const key = lower === 'space' ? ' ' : lower;
        this.handleKeyboard({ key, preventDefault() { }, stopPropagation() { } });
        return;
      }
      switch (lower) {
        case 'pause':
        case 'toggle-pause':
        case 'timer-pause':
          this.triggerHotkeyFeedback('btn-timer-pause');
          this.toggleTimerPause();
          break;
        case 'next':
        case 'skip':
          this.triggerHotkeyFeedback('btn-skip');
          this.showNextImage();
          break;
        case 'rate-again':
          this.triggerHotkeyFeedback('btn-rate-again');
          this.rateCurrentImage('again');
          break;
        case 'rate-hard':
          if (!this.isPiPActive) {
            this.triggerHotkeyFeedback('btn-rate-hard');
            this.rateCurrentImage('hard');
          }
          break;
        case 'rate-medium':
          if (!this.isPiPActive) {
            this.triggerHotkeyFeedback('btn-rate-medium');
            this.rateCurrentImage('medium');
          }
          break;
        case 'rate-easy':
          if (!this.isPiPActive) {
            this.triggerHotkeyFeedback('btn-rate-easy');
            this.rateCurrentImage('easy');
          }
          break;
        case 'toggle-float':
        case 'toggle-pip':
          this.triggerHotkeyFeedback('btn-session-pip');
          this.togglePiP();
          break;
        case 'toggle-zen':
          this.triggerHotkeyFeedback('btn-session-zen');
          this.toggleZenMode();
          break;
        case 'grayscale':
          this.triggerHotkeyFeedback('btn-art-grayscale');
          ArtistToolbox.toggleGrayscale();
          break;
        case 'notan':
          this.triggerHotkeyFeedback('btn-art-notan');
          ArtistToolbox.toggleNotan();
          break;
        case 'flip':
          this.triggerHotkeyFeedback('btn-img-flip');
          ArtistToolbox.flipHorizontal();
          break;
        case 'rotate':
          this.triggerHotkeyFeedback('btn-img-rotate');
          ArtistToolbox.rotate90();
          break;
        default:
          this.handleKeyboard({ key: action, preventDefault() { }, stopPropagation() { } });
          break;
      }
    } else if (typeof action === 'object' && action.key) {
      this.handleKeyboard({
        key: action.key,
        shiftKey: !!action.shiftKey,
        ctrlKey: !!action.ctrlKey,
        metaKey: !!action.metaKey,
        preventDefault() { },
        stopPropagation() { }
      });
    }
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

    // Choose file button
    const browseFileBtn = document.getElementById('btn-browse-wallpaper-file');
    if (browseFileBtn) {
      browseFileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
      });
    }

    dropzone.addEventListener('click', (e) => {
      if (e.target !== fileInput) {
        fileInput.click();
      }
    });

    // Paste image or URL from clipboard
    modal.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) {
              this.handleWallpaperFileUpload(file);
              return;
            }
          }
        }
      }
      const text = e.clipboardData?.getData('text')?.trim();
      if (text && (text.startsWith('http') || text.startsWith('/') || text.startsWith('file://'))) {
        urlInput.value = text;
        applyUrlBtn.click();
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleWallpaperFileUpload(e.target.files[0]);
      }
    });

    // URL or Local File Path input
    applyUrlBtn.addEventListener('click', () => {
      const raw = urlInput.value.trim();
      if (raw) {
        let finalUrl = raw;
        if (raw.startsWith('file://')) {
          finalUrl = `/api/image?path=${encodeURIComponent(raw.replace(/^file:\/\//, ''))}`;
        } else if (raw.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(raw)) {
          finalUrl = `/api/image?path=${encodeURIComponent(raw)}`;
        }
        WallpaperManager.setCustomWallpaper(finalUrl);
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
    if (!file) return;
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i.test(file.name);
    if (!isImage) {
      this.showToast('Please select an image file (PNG, JPG, WEBP, etc.)', 'alert');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      WallpaperManager.setCustomWallpaper(e.target.result);
    };
    reader.onerror = () => {
      this.showToast('Failed to load image file', 'x-circle');
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
          Storage.syncToDisk(false).catch(() => { });

          DeckManager.init();
          CardManager.init();
          ReviewHistory.init();

          statusEl.textContent = 'Progress restored successfully!';
          this.showToast('Data restored successfully', 'save');
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
  },

  // ---- Keyboard Shortcuts ----
  handleKeyboard(e) {
    // If typing in an input/textarea, ignore hotkeys
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      return;
    }

    // Session view check for context-sensitive hotkeys
    const sessionView = document.getElementById('view-session');
    const inSession = sessionView && sessionView.classList.contains('active');

    // Plumb Tool hotkey (U) during session; Sound toggle (U) outside session
    if (e.key.toLowerCase() === 'u') {
      if (inSession) {
        if (typeof PlumbTool !== 'undefined') {
          this.triggerHotkeyFeedback('btn-art-plumb');
          PlumbTool.handleHotkey();
          return;
        }
      } else {
        SoundFX.toggle();
        return;
      }
    }

    // Help modal toggle (?)
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      const modal = document.getElementById('modal-shortcuts');
      modal.classList.toggle('hidden');
      return;
    }

    // Escape closes open modals first, otherwise crop overlay, plumb lines, sketch align mode, palette hud, tag dock, fullscreen zen or PiP
    if (e.key === 'Escape') {
      const opacityHud = document.getElementById('opacity-hud');
      if (opacityHud && !opacityHud.classList.contains('hidden')) {
        this.hideOpacityHUD();
        return;
      }
      if (typeof SmartCropManager !== 'undefined' && SmartCropManager.isCropping) {
        SmartCropManager.cancelCrop();
        return;
      }
      if (typeof PlumbTool !== 'undefined' && (PlumbTool.isActive || PlumbTool.lines.length > 0)) {
        PlumbTool.clearLines();
        PlumbTool.toggleMode(false);
        return;
      }
      if (typeof SketchOverlay !== 'undefined' && SketchOverlay.isAlignMode) {
        SketchOverlay.toggleAlignMode(false);
        return;
      }
      if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active && SketchOverlay.dockVisible) {
        SketchOverlay.toggleDock(false);
        return;
      }
      if (typeof ColorPaletteManager !== 'undefined' && ColorPaletteManager.hudOpen) {
        ColorPaletteManager.toggleHUD(false);
        return;
      }
      if (this.isTagDockOpen) {
        this.toggleTagDock(false);
        return;
      }
      const openModals = document.querySelectorAll('.modal-overlay:not(.hidden)');
      if (openModals.length > 0) {
        openModals.forEach(m => m.classList.add('hidden'));
        return;
      }
      if (this.isPiPActive) {
        this.closePiP(true);
        return;
      }
      if (this.isZenMode) this.toggleZenMode(false);
      return;
    }

    // Hotkeys active inside session view
    if (!inSession) return;

    // Quick Tagging Mode: when dock is open, 1-6 toggle presets, T closes dock
    if (this.isTagDockOpen) {
      if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault();
        const preset = TAG_PRESETS.find(p => p.key === e.key);
        if (preset) {
          this.toggleCardTag(preset.id);
        }
        return;
      }
      if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        this.toggleTagDock(false);
        return;
      }
    }

    // Hotkey T: open Tag Dock
    if (e.key.toLowerCase() === 't') {
      e.preventDefault();
      this.toggleTagDock(true);
      return;
    }

    switch (e.key.toLowerCase()) {
      case '1':
        this.triggerHotkeyFeedback('btn-rate-again');
        this.rateCurrentImage('again');
        break;
      case '2':
        if (this.isPiPActive) break;
        this.triggerHotkeyFeedback('btn-rate-hard');
        this.rateCurrentImage('hard');
        break;
      case '3':
        if (this.isPiPActive) break;
        this.triggerHotkeyFeedback('btn-rate-medium');
        this.rateCurrentImage('medium');
        break;
      case '4':
        if (this.isPiPActive) break;
        this.triggerHotkeyFeedback('btn-rate-easy');
        this.rateCurrentImage('easy');
        break;
      case 's':
        if (e.shiftKey || this.imageBlurred) {
          this.triggerHotkeyFeedback('btn-skip');
          this.showNextImage();
        } else {
          this.triggerHotkeyFeedback('btn-art-squint');
          ArtistToolbox.toggleSquint();
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
      case 'n':
        this.triggerHotkeyFeedback('btn-art-notan');
        ArtistToolbox.toggleNotan();
        break;
      case 'l':
      case 'h':
        this.triggerHotkeyFeedback('btn-art-silhouette');
        ArtistToolbox.toggleSilhouette();
        break;
      case 'p':
        this.triggerHotkeyFeedback('btn-art-posterize');
        ArtistToolbox.togglePosterize();
        break;
      case '[':
        if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active && SketchOverlay.isAlignMode) {
          SketchOverlay.adjustRotate(-0.5);
        } else if (ArtistToolbox.squint) {
          ArtistToolbox.adjustSquintRadius(-1);
        } else if (ArtistToolbox.silhouette) {
          ArtistToolbox.adjustSilhouetteThreshold(-0.05);
        } else if (ArtistToolbox.posterize) {
          ArtistToolbox.adjustPosterizeSteps(-1);
        }
        break;
      case ']':
        if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active && SketchOverlay.isAlignMode) {
          SketchOverlay.adjustRotate(0.5);
        } else if (ArtistToolbox.squint) {
          ArtistToolbox.adjustSquintRadius(1);
        } else if (ArtistToolbox.silhouette) {
          ArtistToolbox.adjustSilhouetteThreshold(0.05);
        } else if (ArtistToolbox.posterize) {
          ArtistToolbox.adjustPosterizeSteps(1);
        }
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
      case 'v':
      case 'w':
        this.triggerHotkeyFeedback('btn-session-pip');
        this.togglePiP();
        break;
      case 'u':
        if (typeof PlumbTool !== 'undefined') {
          this.triggerHotkeyFeedback('btn-art-plumb');
          PlumbTool.handleHotkey();
        }
        break;
      case 'a':
        if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active) {
          this.triggerHotkeyFeedback('btn-sketch-align-toggle');
          SketchOverlay.toggleAlignMode();
        }
        break;
      case 'k':
        if (typeof SketchOverlay !== 'undefined') {
          this.triggerHotkeyFeedback('btn-art-sketch');
          if (e.shiftKey) {
            SketchOverlay.toggleDock();
          } else if (SketchOverlay.active) {
            SketchOverlay.toggleVisibility();
          } else {
            SketchOverlay.promptPasteOrUpload();
          }
        }
        break;
      case 'y':
        if (typeof SketchComparison !== 'undefined') {
          this.triggerHotkeyFeedback('btn-art-history');
          SketchComparison.toggleSplitView();
        }
        break;
      case 'e':
        if (typeof ColorPaletteManager !== 'undefined') {
          this.triggerHotkeyFeedback('btn-art-palette');
          if (e.shiftKey) {
            ColorPaletteManager.toggleMinimize();
          } else {
            ColorPaletteManager.toggleHUD();
          }
        }
        break;
      case 'c':
        if (e.shiftKey) {
          if (typeof SmartCropManager !== 'undefined') {
            SmartCropManager.toggleFocalContext();
          }
        } else {
          if (typeof SmartCropManager !== 'undefined') {
            this.triggerHotkeyFeedback('btn-art-crop');
            SmartCropManager.startCrop();
          }
        }
        break;
    }
  },

  // ---- Zen / True Fullscreen Mode ----
  // Zen = edge-to-edge reference with controls that fade away while you draw.
  // Where the browser allows it we also request real fullscreen so the OS chrome disappears too.
  toggleZenMode(forceState = null) {
    const next = forceState !== null ? forceState : !this.isZenMode;
    if (next === this.isZenMode) return;
    this.setZenMode(next);
  },

  setZenMode(on, fromBrowser = false) {
    this.isZenMode = on;
    document.body.classList.toggle('zen-active', on);
    document.body.classList.remove('hud-idle');

    const zenIcon = document.getElementById('session-zen-icon');
    const zenText = document.getElementById('session-zen-text');
    const hudIcon = document.getElementById('hud-fs-icon');
    if (zenIcon) zenIcon.innerHTML = this.getIconSvg(on ? 'fullscreen-exit' : 'fullscreen', 14);
    if (zenText) zenText.textContent = on ? 'Exit' : 'Fullscreen';
    if (hudIcon) hudIcon.innerHTML = this.getIconSvg(on ? 'fullscreen-exit' : 'fullscreen', 14);

    if (!fromBrowser) {
      if (on) this._enterNativeFullscreen();
      else this._exitNativeFullscreen();
    }

    this.wakeHud();

    // The stage just changed size — refit now and again once the browser finishes resizing
    ArtistToolbox.fitImage(false);
    requestAnimationFrame(() => ArtistToolbox.fitImage(false));
  },

  _enterNativeFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return; // unsupported: the CSS zen layout still gives an edge-to-edge view
    try {
      const p = req.call(el);
      if (p && typeof p.catch === 'function') p.catch(() => { });
    } catch (err) { }
  },

  _exitNativeFullscreen() {
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit) return;
    try {
      const p = exit.call(document);
      if (p && typeof p.catch === 'function') p.catch(() => { });
    } catch (err) { }
  },

  bindFullscreenEvents() {
    // Esc (or the browser UI) can leave fullscreen without our keydown handler ever firing
    const onFullscreenChange = () => {
      const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!inFs && this.isZenMode && this._wasNativeFs) {
        this.setZenMode(false, true);
      }
      this._wasNativeFs = inFs;
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // Controls reappear on any movement/keypress and fade after a short idle
    document.addEventListener('mousemove', (e) => {
      this._overHud = !!(e.target.closest && e.target.closest('.session-header, .rating-area, .image-toolbar, .timer-controls, .image-hud-dock, .filter-controls-dock'));
      if (this.isZenMode) this.wakeHud();
    }, { passive: true });
    document.addEventListener('keydown', () => {
      if (this.isZenMode) this.wakeHud();
    });
  },

  wakeHud() {
    document.body.classList.remove('hud-idle');
    clearTimeout(this._hudTimer);
    if (!this.isZenMode) return;
    this._hudTimer = setTimeout(() => this._maybeHideHud(), 2400);
  },

  _maybeHideHud() {
    if (!this.isZenMode) return;
    const modalOpen = document.querySelector('.modal-overlay:not(.hidden)');
    if (this._overHud || modalOpen) {
      this._hudTimer = setTimeout(() => this._maybeHideHud(), 1200);
      return;
    }
    document.body.classList.add('hud-idle');
  },

  toggleToolDock(force) {
    const docs = [document];
    if (this.pipWindow && !this.pipWindow.closed && this.pipWindow.document) {
      docs.push(this.pipWindow.document);
    }

    docs.forEach(d => {
      const dock = d.getElementById('image-hud-dock');
      const toggleBtn = d.getElementById('btn-dock-toggle');
      if (!dock) return;

      const isOpen = typeof force === 'boolean' ? force : !dock.classList.contains('dock-open');
      dock.classList.toggle('dock-open', isOpen);
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
        toggleBtn.title = isOpen ? 'Hide Artist Tools' : 'Open Artist Tools';
      }
    });
  },

  toggleRatingDock(force) {
    if (this.isElectronFloating || this.isPiPActive || document.body.classList.contains('pip-mode') || document.body.classList.contains('electron-float-active')) {
      return;
    }
    const docs = [document];
    if (this.pipWindow && !this.pipWindow.closed && this.pipWindow.document) {
      docs.push(this.pipWindow.document);
    }

    docs.forEach(d => {
      const ratingArea = d.getElementById('session-rating-area');
      const toggleBtn = d.getElementById('btn-rating-toggle');
      if (!ratingArea) return;

      const isOpen = typeof force === 'boolean' ? force : !ratingArea.classList.contains('rating-open');
      ratingArea.classList.toggle('rating-open', isOpen);
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
        const label = toggleBtn.querySelector('.rating-toggle-label');
        if (label) label.textContent = isOpen ? 'Hide' : 'Rate';
      }
    });
  },

  setToolCategory(cat) {
    if (!cat) return;
    const docs = [document];
    if (this.pipWindow && !this.pipWindow.closed && this.pipWindow.document) {
      docs.push(this.pipWindow.document);
    }

    docs.forEach(d => {
      const toolbar = d.getElementById('session-image-toolbar');
      if (toolbar) {
        toolbar.dataset.activeCat = cat;
      }
      d.querySelectorAll('.dock-cat-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.cat === cat);
      });
    });

    try {
      localStorage.setItem('art_practice_tool_cat', cat);
    } catch (e) { }

    this.updateCategoryIndicators();
  },

  updateCategoryIndicators() {
    const tonalActive = Boolean(
      (window.ArtistToolbox && (ArtistToolbox.grayscale || ArtistToolbox.notan || ArtistToolbox.silhouette || ArtistToolbox.posterize || ArtistToolbox.squint || ArtistToolbox.invert))
    );
    const critiqueActive = Boolean(
      (window.SketchOverlay && SketchOverlay.active) ||
      (window.SmartCropManager && SmartCropManager.isCropping) ||
      (window.ColorPaletteManager && ColorPaletteManager.isOpen)
    );
    const canvasActive = Boolean(
      (window.ArtistToolbox && (ArtistToolbox.grid || ArtistToolbox.flipX !== 1 || ArtistToolbox.rotate !== 0 || ArtistToolbox.zoom !== 1)) ||
      (window.PlumbTool && PlumbTool.isActive)
    );

    const docs = [document];
    if (this.pipWindow && !this.pipWindow.closed && this.pipWindow.document) {
      docs.push(this.pipWindow.document);
    }

    docs.forEach(d => {
      const tonalTab = d.querySelector('.dock-cat-tab[data-cat="tonal"] .cat-indicator-dot');
      if (tonalTab) tonalTab.classList.toggle('hidden', !tonalActive);

      const critiqueTab = d.querySelector('.dock-cat-tab[data-cat="critique"] .cat-indicator-dot');
      if (critiqueTab) critiqueTab.classList.toggle('hidden', !critiqueActive);

      const canvasTab = d.querySelector('.dock-cat-tab[data-cat="canvas"] .cat-indicator-dot');
      if (canvasTab) canvasTab.classList.toggle('hidden', !canvasActive);
    });
  },

  // macOS Studio Dock: click arrow tab to bring up tools/rating; click outside or toggle tab to close
  bindSideDockEdgeAutoReveal(doc = document) {
    const dock = doc.getElementById('image-hud-dock');
    const toggleBtn = doc.getElementById('btn-dock-toggle');
    const ratingToggleBtn = doc.getElementById('btn-rating-toggle');

    // Tool Dock Arrow toggle tab click
    if (toggleBtn && !toggleBtn._hasDockClickListener) {
      toggleBtn._hasDockClickListener = true;
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleToolDock();
      });
    }

    // Rating Dock Arrow toggle tab click
    if (ratingToggleBtn && !ratingToggleBtn._hasRatingClickListener) {
      ratingToggleBtn._hasRatingClickListener = true;
      ratingToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleRatingDock();
      });
    }

    // Category switcher tabs click
    doc.querySelectorAll('.dock-cat-tab').forEach(tab => {
      if (!tab._hasCatClickListener) {
        tab._hasCatClickListener = true;
        tab.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.setToolCategory(tab.dataset.cat);
        });
      }
    });

    // Restore saved category preference
    try {
      const savedCat = localStorage.getItem('art_practice_tool_cat') || 'all';
      this.setToolCategory(savedCat);
    } catch (e) { }

    // Click outside to collapse tool dock or rating dock if open
    doc.addEventListener('click', (e) => {
      // 1. Tool dock outside click
      const currentDock = doc.getElementById('image-hud-dock');
      if (currentDock && currentDock.classList.contains('dock-open')) {
        if (!currentDock.contains(e.target) &&
          !e.target.closest('.modal-overlay') &&
          !e.target.closest('.session-header') &&
          !e.target.closest('.crop-popover') &&
          !(window.ArtistToolbox && ArtistToolbox.isDragging)) {
          this.toggleToolDock(false);
        }
      }

      // 2. Rating dock outside click
      const currentRating = doc.getElementById('session-rating-area');
      if (currentRating && currentRating.classList.contains('rating-open')) {
        if (!currentRating.contains(e.target) &&
          !e.target.closest('.modal-overlay') &&
          !e.target.closest('.session-header') &&
          !document.body.classList.contains('rating-required')) {
          this.toggleRatingDock(false);
        }
      }
    });

    // Close on Escape if dock or rating area is open and no modal is active
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modalOpen = doc.querySelector('.modal-overlay:not(.hidden)');
        if (!modalOpen) {
          const currentDock = doc.getElementById('image-hud-dock');
          if (currentDock && currentDock.classList.contains('dock-open')) {
            this.toggleToolDock(false);
          }
          const currentRating = doc.getElementById('session-rating-area');
          if (currentRating && currentRating.classList.contains('rating-open') && !document.body.classList.contains('rating-required')) {
            this.toggleRatingDock(false);
          }
        }
      }
    });
  },

  // ---- Always-on-Top Document Picture-in-Picture (PiP), Ghost Mode & Native Electron Float Mode ----
  isAlwaysOnTop: false,
  isGhostMode: false,

  setGhostModeState(active) {
    this.isGhostMode = !!active;
    document.body.classList.toggle('ghost-mode-active', this.isGhostMode);

    const banner = document.getElementById('ghost-mode-banner');
    if (banner) {
      banner.classList.toggle('hidden', !this.isGhostMode);
    }

    const ghostBtn = document.getElementById('btn-electron-ghost');
    if (ghostBtn) {
      ghostBtn.classList.toggle('active', this.isGhostMode);
    }

    if (this.isGhostMode) {
      this.showToast('Ghost Mode Active (Click-Through) [Cmd+Shift+G]', 'ghost');
    } else {
      this.showToast('Normal Interaction Restored', 'check');
    }
  },

  opacityHUDTimer: null,

  showOpacityHUD(opacity, isGhostMode) {
    const docs = [document];
    if (this.pipWindow && !this.pipWindow.closed && this.pipWindow.document) {
      docs.push(this.pipWindow.document);
    }

    const pct = Math.round((opacity || 1.0) * 100);

    docs.forEach(doc => {
      const hud = doc.getElementById('opacity-hud');
      const percentEl = doc.getElementById('opacity-hud-percent');
      const fillEl = doc.getElementById('opacity-hud-fill');
      if (!hud) return;

      if (percentEl) percentEl.textContent = `${pct}%`;
      if (fillEl) fillEl.style.width = `${pct}%`;

      hud.classList.remove('hidden', 'hud-fadeout');
    });

    if (this.opacityHUDTimer) {
      clearTimeout(this.opacityHUDTimer);
    }

    // Auto-hides after 1.2 seconds with no persistent buttons
    this.opacityHUDTimer = setTimeout(() => {
      this.hideOpacityHUD();
    }, 1200);
  },

  hideOpacityHUD() {
    if (this.opacityHUDTimer) {
      clearTimeout(this.opacityHUDTimer);
      this.opacityHUDTimer = null;
    }
    const docs = [document];
    if (this.pipWindow && !this.pipWindow.closed && this.pipWindow.document) {
      docs.push(this.pipWindow.document);
    }
    docs.forEach(doc => {
      const hud = doc.getElementById('opacity-hud');
      if (!hud || hud.classList.contains('hidden')) return;
      hud.classList.add('hud-fadeout');
      setTimeout(() => {
        if (hud.classList.contains('hud-fadeout')) {
          hud.classList.add('hidden');
          hud.classList.remove('hud-fadeout');
        }
      }, 220);
    });
  },

  async toggleGhostMode(targetState) {
    if (window.electronAPI && typeof window.electronAPI.toggleGhostMode === 'function') {
      try {
        const flag = typeof targetState === 'boolean' ? targetState : !this.isGhostMode;
        const res = await window.electronAPI.toggleGhostMode(flag);
        if (res && typeof res.isGhostMode === 'boolean') {
          this.setGhostModeState(res.isGhostMode);
        } else {
          this.setGhostModeState(flag);
        }
        return res;
      } catch (err) {
        console.warn('Failed to toggle ghost mode via electronAPI:', err);
      }
    } else if (this.isElectron) {
      try {
        const flag = typeof targetState === 'boolean' ? targetState : !this.isGhostMode;
        const res = await fetch('/api/electron-float', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ghostMode: flag })
        });
        const data = await res.json();
        if (data && typeof data.isGhostMode === 'boolean') {
          this.setGhostModeState(data.isGhostMode);
        }
        return data;
      } catch (err) {
        console.warn('Failed to toggle ghost mode via /api/electron-float:', err);
      }
    }
  },

  setAlwaysOnTopState(active) {
    this.isAlwaysOnTop = !!active;
    const aotBtn = document.getElementById('btn-session-always-on-top');
    if (aotBtn) {
      aotBtn.classList.toggle('active', this.isAlwaysOnTop);
      aotBtn.title = this.isAlwaysOnTop ? 'Disable Always-on-Top' : 'Enable Always-on-Top';
    }
  },

  async toggleAlwaysOnTop(targetState) {
    if (window.electronAPI && typeof window.electronAPI.setAlwaysOnTop === 'function') {
      try {
        const flag = typeof targetState === 'boolean' ? targetState : !this.isAlwaysOnTop;
        const res = await window.electronAPI.setAlwaysOnTop(flag);
        if (res && typeof res.isAlwaysOnTop === 'boolean') {
          this.setAlwaysOnTopState(res.isAlwaysOnTop);
        } else {
          this.setAlwaysOnTopState(flag);
        }
        return res;
      } catch (err) {
        console.warn('Failed to toggle always-on-top via electronAPI:', err);
      }
    } else if (this.isElectron) {
      try {
        const flag = typeof targetState === 'boolean' ? targetState : !this.isAlwaysOnTop;
        const res = await fetch('/api/electron-float', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alwaysOnTop: flag })
        });
        const data = await res.json();
        if (data && typeof data.isAlwaysOnTop === 'boolean') {
          this.setAlwaysOnTopState(data.isAlwaysOnTop);
        }
        return data;
      } catch (err) {
        console.warn('Failed to toggle always-on-top via /api/electron-float:', err);
      }
    }
  },

  async checkElectronFloatStatus() {
    try {
      const res = await fetch('/api/electron-float');
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.isElectron) {
        this.isElectron = true;
        document.body.classList.add('is-electron');
        if (this.isMac) document.body.classList.add('is-mac');
        if (data.floating) {
          this.setElectronFloatState(true);
        }
        if (typeof data.isAlwaysOnTop === 'boolean') {
          this.setAlwaysOnTopState(data.isAlwaysOnTop);
        }
        if (typeof data.isGhostMode === 'boolean') {
          this.setGhostModeState(data.isGhostMode);
        }
      }
    } catch (e) { }

    if (window.electronAPI && typeof window.electronAPI.isAlwaysOnTop === 'function') {
      try {
        const aot = await window.electronAPI.isAlwaysOnTop();
        if (typeof aot === 'boolean') {
          this.setAlwaysOnTopState(aot);
        }
      } catch (e) { }
    }
  },

  async enterElectronFloat() {
    if (window.electronAPI && typeof window.electronAPI.toggleFloatMode === 'function') {
      try {
        const res = await window.electronAPI.toggleFloatMode(true);
        this.setElectronFloatState(res.floating);
        if (res.floating) {
          this.showToast('Always-on-Top Float Mode Active', 'pin');
        }
        return;
      } catch (err) {
        console.warn('Failed to enter float mode via electronAPI, falling back to fetch:', err);
      }
    }
    try {
      const res = await fetch('/api/electron-float', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: true })
      });
      const data = await res.json();
      this.setElectronFloatState(data.floating);
      if (data.floating) {
        this.showToast('Always-on-Top Float Mode Active', 'pin');
      }
    } catch (err) {
      console.error('Failed to enter Electron float mode:', err);
      this.showToast('Could not activate Always-on-Top float mode', 'alert');
    }
  },

  async exitElectronFloat() {
    if (window.electronAPI && typeof window.electronAPI.toggleFloatMode === 'function') {
      try {
        const res = await window.electronAPI.toggleFloatMode(false);
        this.setElectronFloatState(res.floating || false);
        return;
      } catch (err) {
        console.warn('Failed to exit float mode via electronAPI, falling back to fetch:', err);
      }
    }
    try {
      const res = await fetch('/api/electron-float', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: false })
      });
      const data = await res.json();
      this.setElectronFloatState(data.floating || false);
    } catch (err) {
      console.warn('Failed to exit Electron float mode:', err);
      this.setElectronFloatState(false);
    }
  },

  setElectronFloatState(active) {
    this.isElectronFloating = !!active;
    this.isPiPActive = !!active;

    const pipBtn = document.getElementById('btn-session-pip');
    const pipText = document.getElementById('session-pip-text');

    if (active) {
      document.body.classList.add('pip-mode', 'electron-float-active');
      const ratingArea = document.getElementById('session-rating-area');
      if (ratingArea) ratingArea.classList.remove('rating-open');
      if (pipBtn) {
        pipBtn.classList.add('active');
        pipBtn.title = 'Restore Full Studio Window [V]';
      }
      if (pipText) pipText.textContent = 'Full Window';

      setTimeout(() => {
        ArtistToolbox.fitImage(false);
      }, 100);
    } else {
      document.body.classList.remove('pip-mode', 'electron-float-active');
      if (pipBtn) {
        pipBtn.classList.remove('active');
        pipBtn.title = 'Always-on-Top Floating PiP Window (Draw over Photoshop / Blender) [V]';
      }
      if (pipText) pipText.textContent = 'Float PiP';

      setTimeout(() => {
        ArtistToolbox.fitImage(false);
      }, 100);
    }
  },

  async togglePiP() {
    if (this.isElectron) {
      if (this.isElectronFloating) {
        await this.exitElectronFloat();
      } else {
        await this.enterElectronFloat();
      }
      return;
    }

    if (this.isPiPActive) {
      this.closePiP(true);
    } else {
      await this.openPiP('auto');
    }
  },

  async openPiP(preferMode = 'auto') {
    const sessionView = document.getElementById('view-session');
    if (!sessionView || !sessionView.classList.contains('active')) {
      this.showToast('PiP mode is only available during an active study session', 'lightbulb');
      return;
    }

    if (this.isElectron) {
      await this.enterElectronFloat();
      return;
    }

    if (this.isPiPActive) return;

    // Feature detection: Document Picture-in-Picture API (Chromium browsers)
    const hasDocPiP = 'documentPictureInPicture' in window && typeof window.documentPictureInPicture.requestWindow === 'function';

    if (hasDocPiP && preferMode !== 'video' && preferMode !== 'popup') {
      // Chromium: Chrome / Edge / Arc / Brave (true OS floating + interactive DOM)
      await this._openDocumentPiP();
    } else if (preferMode === 'popup') {
      // User explicitly requested detachable popup window
      await this._openPopupPiP();
    } else {
      // Apple Safari / Firefox / default on non-DocPiP:
      // Use Native macOS Video PiP for 100% True Always-on-Top!
      const started = await PiPCanvasStreamer.start();
      if (started) {
        this.isPiPActive = true;
        this.isSafariVideoPiP = true;

        const workspace = document.getElementById('session-workspace');
        if (workspace) workspace.classList.add('hidden');
        const placeholder = document.getElementById('session-pip-placeholder');
        if (placeholder) placeholder.classList.remove('hidden');

        this._updatePiPPlaceholder('video');

        const pipBtn = document.getElementById('btn-session-pip');
        if (pipBtn) pipBtn.classList.add('active');
      } else {
        // Fallback to popup window if video PiP was denied or unavailable
        await this._openPopupPiP();
      }
    }
  },

  async _openDocumentPiP() {
    try {
      const initialWidth = 540;
      const initialHeight = 640;
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: initialWidth,
        height: initialHeight
      });

      this._setupPiPWindow(pipWin, 'document');
      this._updatePiPPlaceholder('document');
    } catch (err) {
      console.error('Failed to open Document Picture-in-Picture:', err);
      // Fallback to video PiP or popup
      const started = await PiPCanvasStreamer.start();
      if (started) {
        this.isPiPActive = true;
        this.isSafariVideoPiP = true;
        const workspace = document.getElementById('session-workspace');
        if (workspace) workspace.classList.add('hidden');
        const placeholder = document.getElementById('session-pip-placeholder');
        if (placeholder) placeholder.classList.remove('hidden');
        this._updatePiPPlaceholder('video');
        const pipBtn = document.getElementById('btn-session-pip');
        if (pipBtn) pipBtn.classList.add('active');
      } else {
        await this._openPopupPiP();
      }
    }
  },

  async _openPopupPiP() {
    try {
      const initialWidth = 540;
      const initialHeight = 640;
      const left = Math.max(0, window.screen.availWidth - initialWidth - 30);
      const top = 60;
      const pipWin = window.open('', 'ArtistPracticePiP', `width=${initialWidth},height=${initialHeight},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`);
      if (!pipWin) {
        this.showToast('Popup blocked. Please allow popups for localhost.', 'alert');
        return;
      }

      this._setupPiPWindow(pipWin, 'popup');
      this._updatePiPPlaceholder('popup');
    } catch (err) {
      console.error('Failed to open popup window:', err);
      this.showToast('Could not open floating window', 'alert');
    }
  },

  _updatePiPPlaceholder(mode) {
    const title = document.getElementById('pip-placeholder-title');
    const desc = document.getElementById('pip-placeholder-desc');
    const switchBtn = document.getElementById('btn-pip-mode-switch');
    const tip = document.getElementById('pip-browser-tip');

    if (mode === 'video') {
      if (title) title.textContent = 'macOS Always-on-Top PiP Active';
      if (desc) desc.textContent = 'Your reference is pinned at the macOS system level — guaranteed to stay on top of Photoshop, Blender, and all apps.';
      if (switchBtn) {
        switchBtn.classList.remove('hidden');
        switchBtn.innerHTML = `<span>${this.getIconSvg('refresh', 13)}</span> Switch to Detached Window (Clickable Buttons)`;
      }
      if (tip) {
        tip.classList.remove('hidden');
        tip.innerHTML = `${this.getIconSvg('lightbulb', 14)} <strong>Pro Tip:</strong> For clickable buttons directly inside the floating window while staying always-on-top, open this in <strong>Google Chrome</strong>, <strong>Microsoft Edge</strong>, or <strong>Arc</strong> (which support Document PiP).`;
      }
    } else if (mode === 'document') {
      if (title) title.textContent = 'Interactive Always-on-Top PiP Active';
      if (desc) desc.textContent = 'Reference and tools are floating above your drawing canvas / Blender viewport.';
      if (switchBtn) switchBtn.classList.add('hidden');
      if (tip) {
        tip.classList.add('hidden');
        tip.textContent = '';
      }
    } else { // popup
      if (title) title.textContent = 'Detached Practice Window Active';
      if (desc) desc.textContent = 'Reference window is detached. (Note: standard Safari popup windows can be covered by other apps).';
      if (switchBtn) {
        switchBtn.classList.remove('hidden');
        switchBtn.innerHTML = `<span>${this.getIconSvg('refresh', 13)}</span> Switch to macOS Always-on-Top PiP`;
      }
      if (tip) {
        tip.classList.remove('hidden');
        tip.innerHTML = `${this.getIconSvg('sparkles', 14)} Click above to switch to <strong>macOS Always-on-Top PiP</strong> to keep the reference floating above Photoshop/Blender.`;
      }
    }
  },

  _setupPiPWindow(pipWin, mode) {
    this.pipWindow = pipWin;
    const pipDoc = pipWin.document;
    pipDoc.title = 'Floating Reference • ArtPractice';

    // Copy all stylesheets and style elements to the PiP window head
    try {
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
          const style = document.createElement('style');
          style.textContent = cssRules;
          pipDoc.head.appendChild(style);
        } catch (e) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.type = styleSheet.type || 'text/css';
          link.media = styleSheet.media?.mediaText || 'all';
          link.href = styleSheet.href;
          pipDoc.head.appendChild(link);
        }
      });
    } catch (err) {
      // Fallback clone all link/style nodes directly
      document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => {
        pipDoc.head.appendChild(node.cloneNode(true));
      });
    }

    // Copy SVG filters so that GPU Notan, Silhouette, Posterize, and Tonal filters work
    const svgFilters = document.getElementById('svg-filters');
    if (svgFilters) {
      pipDoc.body.appendChild(svgFilters.cloneNode(true));
    }

    // Add pip-mode class to body
    pipDoc.body.classList.add('pip-mode');

    const ratingArea = pipDoc.getElementById('session-rating-area');
    if (ratingArea) ratingArea.classList.remove('rating-open');

    // Get workspace BEFORE setting isPiPActive = true
    const workspace = document.getElementById('session-workspace');
    if (workspace) {
      pipDoc.body.appendChild(workspace);
    }

    // Activate PiP state
    PiPState.isActive = true;
    PiPState.window = pipWin;
    this.isPiPActive = true;

    // Show placeholder in the main session view
    const placeholder = document.getElementById('session-pip-placeholder');
    if (placeholder) {
      placeholder.classList.remove('hidden');
    }

    // Update button state in main header
    const pipBtn = document.getElementById('btn-session-pip');
    if (pipBtn) pipBtn.classList.add('active');

    // Re-fit image when PiP window is resized
    pipWin.addEventListener('resize', () => {
      ArtistToolbox.fitImage(false);
    });

    // Side tool dock auto-hide proximity (Mac dock behavior) inside PiP window
    this.bindSideDockEdgeAutoReveal(pipDoc);

    // Keyboard event forwarding inside the PiP window
    pipDoc.addEventListener('keydown', (e) => {
      this.handleKeyboard(e);
    });

    // AudioContext unlock on interaction inside PiP window
    ['pointerdown', 'mousedown', 'keydown', 'click'].forEach(ev => {
      pipWin.addEventListener(ev, () => {
        const ctx = SoundFX._getCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume();
      }, { passive: true });
    });

    // Delegated Capture Click Handler for all PiP toolbar & rating actions
    pipDoc.addEventListener('click', (e) => {
      const btn = e.target.closest('button, .btn, .btn-hud, .btn-rate');
      if (!btn) return;
      const id = btn.id;

      switch (id) {
        case 'btn-rate-again':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-rate-again');
          this.rateCurrentImage('again');
          break;
        case 'btn-rate-hard':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-rate-hard');
          this.rateCurrentImage('hard');
          break;
        case 'btn-rate-medium':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-rate-medium');
          this.rateCurrentImage('medium');
          break;
        case 'btn-rate-easy':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-rate-easy');
          this.rateCurrentImage('easy');
          break;
        case 'btn-skip':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-skip');
          this.showNextImage();
          break;
        case 'btn-timer-pause':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-timer-pause');
          this.toggleTimerPause();
          break;
        case 'btn-timer-reset':
          e.preventDefault();
          e.stopPropagation();
          this.resetTimer();
          break;
        case 'btn-art-grayscale':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-art-grayscale');
          ArtistToolbox.toggleGrayscale();
          break;
        case 'btn-art-notan':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-art-notan');
          ArtistToolbox.toggleNotan();
          break;
        case 'btn-art-silhouette':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-art-silhouette');
          ArtistToolbox.toggleSilhouette();
          break;
        case 'btn-art-posterize':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-art-posterize');
          ArtistToolbox.togglePosterize();
          break;
        case 'btn-art-squint':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-art-squint');
          ArtistToolbox.toggleSquint();
          break;
        case 'btn-art-grid':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-art-grid');
          ArtistToolbox.toggleGrid();
          break;
        case 'btn-art-invert':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-art-invert');
          ArtistToolbox.toggleInvert();
          break;
        case 'btn-img-flip':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-img-flip');
          ArtistToolbox.flipHorizontal();
          break;
        case 'btn-img-rotate':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-img-rotate');
          ArtistToolbox.rotate90();
          break;
        case 'btn-img-zoom-in':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-img-zoom-in');
          ArtistToolbox.adjustZoom(0.25);
          break;
        case 'btn-img-zoom-out':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-img-zoom-out');
          ArtistToolbox.adjustZoom(-0.25);
          break;
        case 'btn-img-zoom-reset':
          e.preventDefault();
          e.stopPropagation();
          this.triggerHotkeyFeedback('btn-img-zoom-reset');
          ArtistToolbox.resetZoomPan();
          break;
        case 'btn-silhouette-invert':
          e.preventDefault();
          e.stopPropagation();
          ArtistToolbox.toggleSilhouetteInvert();
          break;
        case 'btn-silhouette-reset':
          e.preventDefault();
          e.stopPropagation();
          ArtistToolbox.resetSilhouetteThreshold();
          break;
        case 'btn-posterize-preset-3':
          e.preventDefault();
          e.stopPropagation();
          if (!ArtistToolbox.posterize) ArtistToolbox.togglePosterize();
          ArtistToolbox.setPosterizeSteps(3);
          break;
        case 'btn-posterize-preset-4':
          e.preventDefault();
          e.stopPropagation();
          if (!ArtistToolbox.posterize) ArtistToolbox.togglePosterize();
          ArtistToolbox.setPosterizeSteps(4);
          break;
        case 'btn-squint-preset-light':
          e.preventDefault();
          e.stopPropagation();
          if (!ArtistToolbox.squint) ArtistToolbox.toggleSquint();
          ArtistToolbox.setSquintRadius(3);
          break;
        case 'btn-squint-preset-medium':
          e.preventDefault();
          e.stopPropagation();
          if (!ArtistToolbox.squint) ArtistToolbox.toggleSquint();
          ArtistToolbox.setSquintRadius(8);
          break;
        case 'btn-squint-preset-heavy':
          e.preventDefault();
          e.stopPropagation();
          if (!ArtistToolbox.squint) ArtistToolbox.toggleSquint();
          ArtistToolbox.setSquintRadius(16);
          break;
        case 'btn-squint-reset':
          e.preventDefault();
          e.stopPropagation();
          if (!ArtistToolbox.squint) ArtistToolbox.toggleSquint();
          ArtistToolbox.setSquintRadius(6);
          break;
        case 'btn-art-sketch':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') {
            if (SketchOverlay.active) {
              if (!SketchOverlay.dockVisible) {
                SketchOverlay.toggleDock(true);
              } else {
                SketchOverlay.toggleVisibility();
              }
            } else {
              SketchOverlay.promptPasteOrUpload();
            }
          }
          break;
        case 'btn-sketch-hide-dock':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') SketchOverlay.toggleDock(false);
          break;
        case 'btn-sketch-min-dock':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') SketchOverlay.toggleMinimize();
          break;
        case 'btn-sketch-toggle-vis':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') SketchOverlay.toggleVisibility();
          break;
        case 'btn-sketch-clear':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') SketchOverlay.clear();
          break;
        case 'btn-sketch-fit-toggle':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') SketchOverlay.toggleFitMode();
          break;
        case 'btn-sketch-align-toggle':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') SketchOverlay.toggleAlignMode();
          break;
        case 'btn-sketch-align-reset':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') SketchOverlay.resetAlign();
          break;
        case 'btn-sketch-paste-new':
        case 'btn-blur-paste-sketch':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchOverlay !== 'undefined') SketchOverlay.promptPasteOrUpload();
          break;
        case 'btn-blur-unblur-peek':
          e.preventDefault();
          e.stopPropagation();
          this.clearBlurOverlay();
          break;
        case 'btn-art-history':
        case 'session-history-pill':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchComparison !== 'undefined') SketchComparison.toggleSplitView();
          break;
        case 'btn-toggle-split-view':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchComparison !== 'undefined') SketchComparison.setMode('split');
          break;
        case 'btn-toggle-overlay-view':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchComparison !== 'undefined') {
            SketchComparison.setMode('single');
            if (typeof SketchOverlay !== 'undefined' && SketchComparison.currentSketchDataUrl) {
              SketchOverlay.loadFromDataUrl(SketchComparison.currentSketchDataUrl);
            }
          }
          break;
        case 'btn-remove-rating-sketch':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchComparison !== 'undefined') SketchComparison.removeCurrentSketch();
          break;
        case 'btn-close-split-view':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SketchComparison !== 'undefined') SketchComparison.setMode('single');
          break;
        case 'btn-rating-attach-sketch':
        case 'btn-split-upload-sketch':
          e.preventDefault();
          e.stopPropagation();
          const fi = document.getElementById('sketch-file-input');
          if (fi) fi.click();
          break;
        case 'btn-art-palette':
          e.preventDefault();
          e.stopPropagation();
          if (typeof ColorPaletteManager !== 'undefined') ColorPaletteManager.toggleHUD();
          break;
        case 'btn-close-palette-hud':
          e.preventDefault();
          e.stopPropagation();
          if (typeof ColorPaletteManager !== 'undefined') ColorPaletteManager.toggleHUD(false);
          break;
        case 'btn-min-palette-hud':
          e.preventDefault();
          e.stopPropagation();
          if (typeof ColorPaletteManager !== 'undefined') ColorPaletteManager.toggleMinimize();
          break;
        case 'btn-toggle-eyedropper':
          e.preventDefault();
          e.stopPropagation();
          if (typeof ColorPaletteManager !== 'undefined') ColorPaletteManager.toggleEyedropper();
          break;
        case 'btn-copy-inspector-hex':
          e.preventDefault();
          e.stopPropagation();
          if (typeof ColorPaletteManager !== 'undefined') ColorPaletteManager.copyActiveHex();
          break;
        case 'btn-clear-sampled-colors':
          e.preventDefault();
          e.stopPropagation();
          if (typeof ColorPaletteManager !== 'undefined') ColorPaletteManager.clearSampled();
          break;
        case 'btn-art-crop':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SmartCropManager !== 'undefined') SmartCropManager.startCrop();
          break;
        case 'btn-art-plumb':
          e.preventDefault();
          e.stopPropagation();
          if (typeof PlumbTool !== 'undefined') PlumbTool.handleHotkey();
          break;
        case 'btn-cancel-crop':
        case 'btn-cancel-crop-popover':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SmartCropManager !== 'undefined') SmartCropManager.cancelCrop();
          break;
        case 'btn-confirm-crop':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SmartCropManager !== 'undefined') SmartCropManager.confirmCrop();
          break;
        case 'session-focal-pill':
        case 'btn-toggle-crop-context':
          e.preventDefault();
          e.stopPropagation();
          if (typeof SmartCropManager !== 'undefined') SmartCropManager.toggleFocalContext();
          break;
      }

      if (btn.classList.contains('btn-blend-mode') && btn.dataset.blend) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof SketchOverlay !== 'undefined') SketchOverlay.setBlendMode(btn.dataset.blend);
      }
    }, true);

    // Slider input events inside PiP window
    pipDoc.addEventListener('input', (e) => {
      if (!e.target) return;
      if (e.target.id === 'slider-silhouette-threshold') {
        ArtistToolbox.setSilhouetteThreshold(e.target.value);
      } else if (e.target.id === 'slider-posterize-steps') {
        ArtistToolbox.setPosterizeSteps(e.target.value);
      } else if (e.target.id === 'slider-squint-radius') {
        ArtistToolbox.setSquintRadius(e.target.value);
      } else if (e.target.id === 'slider-sketch-opacity') {
        if (typeof SketchOverlay !== 'undefined') SketchOverlay.setOpacity(parseInt(e.target.value, 10) / 100);
      }
    }, true);

    // Paste event forwarding inside PiP window
    pipWin.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file && typeof SketchOverlay !== 'undefined') {
            SketchOverlay.loadFromFile(file);
            return;
          }
        }
      }
    });

    // Setup Drag and Wheel inside PiP stage
    const pipStage = pipDoc.getElementById('image-stage');
    const pipFrame = pipDoc.getElementById('image-frame');
    if (pipStage) {
      pipStage._hasDragAndWheel = false;
      ArtistToolbox.setupDragAndWheel(pipStage, pipFrame);
    }

    // Handle close event when user closes the PiP window via native OS window controls
    pipWin.addEventListener('pagehide', () => {
      this.closePiP(false);
    });
    pipWin.addEventListener('unload', () => {
      this.closePiP(false);
    });

    // Refit image inside PiP stage once DOM settles
    setTimeout(() => {
      ArtistToolbox.fitImage(false);
    }, 60);
  },

  closePiP(closeWindow = true) {
    if (this.isElectronFloating) {
      this.exitElectronFloat();
      return;
    }

    if (!this.isPiPActive) return;

    // Handle macOS Video PiP
    if (this.isSafariVideoPiP) {
      this.isSafariVideoPiP = false;
      PiPCanvasStreamer.stop();
      const ws = document.getElementById('session-workspace');
      if (ws) ws.classList.remove('hidden');
      const placeholder = document.getElementById('session-pip-placeholder');
      if (placeholder) placeholder.classList.add('hidden');
      const pipBtn = document.getElementById('btn-session-pip');
      if (pipBtn) pipBtn.classList.remove('active');
      this.isPiPActive = false;
      return;
    }

    // Handle Document PiP or Popup PiP
    PiPState.isActive = false;
    PiPState.window = null;
    this.isPiPActive = false;

    const mainSessionView = document.getElementById('view-session');
    const placeholder = document.getElementById('session-pip-placeholder');
    const pipWin = this.pipWindow;

    if (pipWin) {
      try {
        const workspace = pipWin.document.getElementById('session-workspace');
        if (workspace && mainSessionView) {
          if (placeholder && placeholder.parentNode === mainSessionView) {
            mainSessionView.insertBefore(workspace, placeholder);
          } else {
            mainSessionView.appendChild(workspace);
          }
        }
      } catch (err) {
        console.warn('Error returning session workspace from PiP:', err);
      }
    }

    if (placeholder) {
      placeholder.classList.add('hidden');
    }

    const pipBtn = document.getElementById('btn-session-pip');
    if (pipBtn) pipBtn.classList.remove('active');

    if (closeWindow && pipWin && !pipWin.closed) {
      try {
        pipWin.close();
      } catch (e) { }
    }
    this.pipWindow = null;

    // Refit image in main container
    setTimeout(() => {
      ArtistToolbox.fitImage(false);
    }, 60);
  },

  // ---- View Switching ----
  showView(viewId) {
    if (viewId !== 'view-session' && this.isPiPActive) {
      this.closePiP(true);
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
    document.body.classList.toggle('in-session', viewId === 'view-session');
  },

  // ---- Deck List View ----
  showDeckList() {
    this.showView('view-deck-list');
    this.renderDeckList();
  },

  // ---- Home screen: daily overview strip ----
  _currentStreak() {
    const history = ReviewHistory.getGlobalHistory();
    let streak = 0;
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const ds = this._dateToStr(checkDate);
      if (history[ds] && history[ds] > 0) streak++;
      else if (i !== 0) break;
      checkDate.setDate(checkDate.getDate() - 1);
    }
    return streak;
  },

  renderTodayStrip() {
    const allDecks = DeckManager.getAll();
    const todayStr = CardManager._dateStr(new Date());
    let totalDue = 0;
    allDecks.forEach(d => {
      const cards = CardManager.getCardsForDeck(d.id);
      totalDue += Object.values(cards).filter(c => c.dueDate <= todayStr).length;
    });
    const practiced = ReviewHistory.getGlobalHistory()[todayStr] || 0;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('today-due', totalDue);
    set('today-practiced', practiced);
    set('today-streak', this._currentStreak());
    set('today-decks', allDecks.length);

    const strip = document.getElementById('today-strip');
    if (strip) strip.classList.toggle('hidden', allDecks.length === 0);
  },

  // ---- Home screen: deck cover art & progress ----
  _deckCoverHTML(meta) {
    if (!meta || meta.loading) {
      return '<div class="deck-cover-empty shimmer"></div>';
    }
    if (meta.error || !meta.covers || meta.covers.length === 0) {
      return `<div class="deck-cover-empty"><span>${this.getIconSvg('palette', 28)}</span></div>`;
    }
    const imgs = meta.covers.map(id =>
      `<img src="${this._esc(`/api/image?path=${encodeURIComponent(id)}`)}" alt="" loading="lazy" decoding="async" draggable="false">`
    ).join('');
    return `<div class="cover-mosaic count-${meta.covers.length}">${imgs}</div>` +
      `<span class="deck-cover-chip">${meta.total} ${meta.total === 1 ? 'reference' : 'references'}</span>`;
  },

  _deckProgressHTML(reviewed, meta) {
    if (!meta || meta.loading || meta.error) {
      return `<div class="deck-progress-bar${meta && meta.error ? '' : ' loading'}"><span></span></div>` +
        `<div class="deck-progress-label"><span>${reviewed} studied</span></div>`;
    }
    const pct = meta.total > 0 ? Math.min(100, (reviewed / meta.total) * 100) : 0;
    return `<div class="deck-progress-bar"><span style="width:${pct.toFixed(1)}%"></span></div>` +
      `<div class="deck-progress-label"><span>${reviewed} / ${meta.total} studied</span><span>${Math.round(pct)}%</span></div>`;
  },

  _patchDeckCard(deck) {
    const card = document.querySelector(`.deck-card[data-deck-id="${deck.id}"]`);
    if (!card) return;
    const meta = this.deckMeta[deck.folderPath];
    const reviewed = Object.keys(CardManager.getCardsForDeck(deck.id)).length;
    const cover = card.querySelector('.deck-cover');
    const progress = card.querySelector('.deck-progress');
    if (cover) cover.innerHTML = this._deckCoverHTML(meta);
    if (progress) progress.innerHTML = this._deckProgressHTML(reviewed, meta);
  },

  async _loadDeckMeta(decks) {
    const pending = decks.filter(d => !this.deckMeta[d.folderPath]);
    await Promise.all(pending.map(async (d) => {
      this.deckMeta[d.folderPath] = { loading: true };
      try {
        const res = await fetch(`/api/deck-meta?folder=${encodeURIComponent(d.folderPath)}`);
        if (!res.ok) throw new Error('meta unavailable');
        this.deckMeta[d.folderPath] = await res.json();
      } catch (err) {
        this.deckMeta[d.folderPath] = { error: true };
      }
      this._patchDeckCard(d);
    }));
  },

  renderDeckList() {
    this.renderTodayStrip();
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
      const meta = this.deckMeta[deck.folderPath];

      return `
        <div class="deck-card${due > 0 ? ' has-due' : ''}" data-deck-id="${deck.id}">
          <div class="deck-cover">${this._deckCoverHTML(meta)}</div>
          <div class="deck-card-body">
            <div class="deck-card-name">${this._esc(deck.name)}</div>
            <div class="deck-card-path deck-path" title="${this._esc(deck.folderPath)}">${this._esc(this.formatShortPath(deck.folderPath))}</div>
            <div class="deck-progress">${this._deckProgressHTML(reviewed, meta)}</div>
            <div class="deck-card-stats">
              <span class="stat-pill reviewed-badge">${reviewed} mastered</span>
              ${due > 0 ? `<span class="stat-pill due-badge">${this.getDueSvgHTML(12)} ${due} due</span>` : '<span class="stat-pill">0 due</span>'}
            </div>
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

    // Fetch cover art + totals for any deck we haven't seen yet (cached afterwards)
    this._loadDeckMeta(decks);
  },

  applyCardTilt(card) {
    let ticking = false;
    let rect = null;
    let mouseX = 0;
    let mouseY = 0;

    card.addEventListener('mouseenter', () => {
      SoundFX.hover();
      rect = card.getBoundingClientRect();
      card.style.transition = 'transform 0.1s ease-out, box-shadow 0.2s ease, border-color 0.2s ease';
    });

    card.addEventListener('mousemove', (e) => {
      if (!rect) rect = card.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;

      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          if (!rect) { ticking = false; return; }
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const rotateX = ((mouseY - centerY) / centerY) * -6.5;
          const rotateY = ((mouseX - centerX) / centerX) * 6.5;

          card.style.transform = `perspective(800px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px) scale3d(1.02, 1.02, 1.02)`;
          card.style.setProperty('--mouse-x', `${mouseX}px`);
          card.style.setProperty('--mouse-y', `${mouseY}px`);
          ticking = false;
        });
      }
    });

    card.addEventListener('mouseleave', () => {
      rect = null;
      card.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease, border-color 0.3s ease';
      card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0) scale3d(1, 1, 1)';
    });
  },

  // ---- Deck Detail View ----
  async openDeckDetail(deckId) {
    this.currentDeckId = deckId;
    this.selectedTagFilter = null; // Reset focus filter to All Cards
    const deck = DeckManager.getById(deckId);
    if (!deck) return;

    document.getElementById('deck-detail-name').textContent = deck.name;
    const clipInput = document.getElementById('input-clip-url');
    if (clipInput) clipInput.value = '';
    const clipStatus = document.getElementById('clip-status-msg');
    if (clipStatus) clipStatus.textContent = '';
    const detailPath = document.getElementById('deck-detail-path');
    if (detailPath) {
      detailPath.textContent = this.formatShortPath(deck.folderPath);
      detailPath.title = deck.folderPath;
    }
    const detailFolder = document.getElementById('deck-detail-folder');
    if (detailFolder) {
      detailFolder.textContent = this.formatShortPath(deck.folderPath);
      detailFolder.title = deck.folderPath;
    }

    this.showView('view-deck-detail');

    // Load folder images
    try {
      this.cachedImages = await SessionManager.loadImages(deck.folderPath);
      // Automatically migrate legacy path cards to content-hash IDs
      CardManager.migrateLegacyPathCards(deckId, this.cachedImages);
    } catch (err) {
      this.cachedImages = [];
      this.showToast(`Folder load issue: ${err.message}`, 'alert');
    }

    this.renderDeckStats();
    this.renderDeckFocusTags();
    this.renderHeatmap();
    this.renderActivityStats();
    this.renderTodaysReviewedCount();
  },

  renderDeckStats() {
    const totalImages = this.cachedImages ? this.cachedImages.length : 0;
    const stats = CardManager.getStats(this.currentDeckId, totalImages, this.selectedTagFilter);

    const deck = DeckManager.getById(this.currentDeckId);
    const newLimit = deck.newLimit || 20;
    const reviewLimit = deck.reviewLimit || 200;

    const todayStr = CardManager._dateStr(new Date());
    const historyCounts = ReviewHistory.getCounts(this.currentDeckId, todayStr);

    const remainingNew = Math.max(0, newLimit - historyCounts.new);
    const remainingReview = Math.max(0, reviewLimit - historyCounts.review);

    const availableNew = Math.min(stats.newCards, remainingNew);
    const availableReview = Math.min(stats.due, remainingReview);

    const updateStat = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        if (el.textContent !== String(val)) {
          el.textContent = val;
          el.classList.remove('animating');
          void el.offsetWidth; // trigger reflow
          el.classList.add('animating');
        }
      }
    };

    updateStat('stat-total', stats.total);
    updateStat('stat-due', stats.due);
    updateStat('stat-reviewed', stats.reviewed);
    updateStat('stat-new', stats.newCards);

    document.getElementById('btn-new-count').textContent = availableNew;
    document.getElementById('btn-review-count').textContent = availableReview;

    // Sub-Deck label feedback on study buttons
    const btnStudyNew = document.getElementById('btn-study-new');
    const btnReview = document.getElementById('btn-review');
    const btnFree = document.getElementById('btn-free-study');

    const studyTitle = btnStudyNew ? btnStudyNew.querySelector('.action-title') : null;
    const reviewTitle = btnReview ? btnReview.querySelector('.action-title') : null;
    const freeCount = btnFree ? btnFree.querySelector('.action-count') : null;

    if (this.selectedTagFilter) {
      if (studyTitle) studyTitle.textContent = `Study New (#${this.selectedTagFilter})`;
      if (reviewTitle) reviewTitle.textContent = `Review Due (#${this.selectedTagFilter})`;
      if (freeCount) freeCount.textContent = `(#${this.selectedTagFilter} only: ${stats.total})`;
    } else {
      if (studyTitle) studyTitle.textContent = 'Study New';
      if (reviewTitle) reviewTitle.textContent = 'Review Due';
      if (freeCount) freeCount.textContent = '(Endless shuffle)';
    }

    const duePill = document.getElementById('deck-detail-due-pill');
    if (stats.due > 0) {
      duePill.textContent = `${stats.due} Due Today${this.selectedTagFilter ? ` (#${this.selectedTagFilter})` : ''}`;
      duePill.classList.remove('hidden');
    } else {
      duePill.classList.add('hidden');
    }

    // Overdue Backlog Load-Balancer Button State
    const btnReflow = document.getElementById('btn-reflow-backlog');
    const reflowBadge = document.getElementById('reflow-badge');
    if (btnReflow) {
      const excess = Math.max(0, stats.due - reviewLimit);
      if (excess > 0) {
        btnReflow.classList.add('can-reflow');
        btnReflow.title = `Due queue exceeds daily limit by ${excess} cards. Click to spread excess evenly across the next 5 days.`;
        if (reflowBadge) {
          reflowBadge.textContent = `+${excess} excess`;
          reflowBadge.classList.remove('hidden');
        }
      } else {
        btnReflow.classList.remove('can-reflow');
        btnReflow.title = stats.due > 0
          ? `Queue (${stats.due}) is within your daily limit (${reviewLimit}). Click to balance backlog if desired.`
          : 'No cards currently due';
        if (reflowBadge) {
          reflowBadge.classList.add('hidden');
        }
      }
    }

    if (btnStudyNew) btnStudyNew.disabled = availableNew === 0;
    if (btnReview) btnReview.disabled = availableReview === 0;
    if (btnFree) btnFree.disabled = stats.total === 0;
  },

  renderDeckFocusTags() {
    const bar = document.getElementById('deck-focus-tags-bar');
    const clearBtn = document.getElementById('btn-clear-tag-filter');
    if (!bar) return;

    if (clearBtn) {
      if (this.selectedTagFilter) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
    }

    const tagCounts = CardManager.getAllTagsForDeck(this.currentDeckId);
    const totalCount = this.cachedImages ? this.cachedImages.length : 0;
    const isAllActive = !this.selectedTagFilter;

    let html = `
      <button type="button" class="btn-focus-tag ${isAllActive ? 'active' : ''}" data-tag="">
        <span>${this.getIconSvg('folder', 13, 'tag-icon-svg')} All Cards</span>
        <span class="focus-count">${totalCount}</span>
      </button>
    `;

    const tagEntries = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    if (tagEntries.length === 0) {
      html += `
        <span class="focus-empty-hint">
          No sub-deck tags yet. Press <kbd>T</kbd> during a session to tag references (e.g. <em>hands</em>, <em>foreshortening</em>, <em>lighting</em>, <em>leech</em>).
        </span>
      `;
    } else {
      tagEntries.forEach(([tag, count]) => {
        const isActive = this.selectedTagFilter === tag;
        const preset = TAG_PRESETS.find(p => p.id === tag);
        const iconName = preset ? (preset.icon || preset.id) : 'tag';
        const iconSvg = this.getIconSvg(iconName, 13, 'tag-icon-svg');
        html += `
          <button type="button" class="btn-focus-tag ${isActive ? 'active' : ''}" data-tag="${this._esc(tag)}">
            <span>${iconSvg} #${this._esc(tag)}</span>
            <span class="focus-count">${count}</span>
          </button>
        `;
      });
    }

    bar.innerHTML = html;

    bar.querySelectorAll('.btn-focus-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        SoundFX.click();
        const tag = btn.dataset.tag || null;
        this.selectedTagFilter = tag;
        this.renderDeckStats();
        this.renderDeckFocusTags();
      });
    });
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

    // Floating Unclipped Heatmap Tooltip (escapes overflow boundaries so top rows are never clipped)
    let tooltip = document.getElementById('floating-heatmap-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'floating-heatmap-tooltip';
      tooltip.className = 'floating-heatmap-tooltip';
      document.body.appendChild(tooltip);
    }

    if (!gridEl._hasTooltipListeners) {
      gridEl._hasTooltipListeners = true;

      const positionTooltip = (cell) => {
        const text = cell.getAttribute('data-tooltip');
        if (!text) {
          tooltip.classList.remove('visible');
          return;
        }
        tooltip.textContent = text;
        const rect = cell.getBoundingClientRect();
        // Flip below if cell is too close to top of viewport or container header
        const shouldFlip = rect.top < 70;
        if (shouldFlip) {
          tooltip.classList.add('flipped');
          tooltip.style.top = (rect.bottom + 8) + 'px';
        } else {
          tooltip.classList.remove('flipped');
          tooltip.style.top = (rect.top - 8) + 'px';
        }
        const left = Math.max(75, Math.min(window.innerWidth - 75, rect.left + rect.width / 2));
        tooltip.style.left = left + 'px';
        tooltip.classList.add('visible');
      };

      gridEl.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.heatmap-cell');
        if (cell) positionTooltip(cell);
      });

      gridEl.addEventListener('mouseout', (e) => {
        const cell = e.target.closest('.heatmap-cell');
        if (cell) tooltip.classList.remove('visible');
      });
    }

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
    if (scrollEl && !scrollEl._hasTooltipScrollListener) {
      scrollEl._hasTooltipScrollListener = true;
      scrollEl.addEventListener('scroll', () => {
        if (tooltip) tooltip.classList.remove('visible');
      }, { passive: true });
    }

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
    document.getElementById('stat-current-streak').innerHTML = `${currentStreak} days ${this.getFlameSvgHTML(14, 18)}`;
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
      listEl.innerHTML = todaysCards.map(card => {
        const lastAttempt = (Array.isArray(card.attempts) && card.attempts.length > 0) ? card.attempts[card.attempts.length - 1] : null;
        const thumbHtml = lastAttempt ? `<img src="${lastAttempt.sketchUrl}" class="due-card-thumb" alt="Sketch">` : '';
        return `
        <div class="due-card-item">
          ${thumbHtml}
          <span class="card-name" title="${this._esc(card.imageName)}">${this._esc(card.imageName)}</span>
          <span class="card-difficulty ${card.difficulty}">${card.difficulty}</span>
          <span class="card-due-date">Next: ${this._formatFutureDate(card.dueDate)}</span>
        </div>
        `;
      }).join('');
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

    // Ensure legacy cards are migrated to content-hash IDs before building session queue
    CardManager.migrateLegacyPathCards(this.currentDeckId, this.cachedImages);

    const newLimit = deck.newLimit || 20;
    const reviewLimit = deck.reviewLimit || 200;
    const todayStr = CardManager._dateStr(new Date());
    const historyCounts = ReviewHistory.getCounts(this.currentDeckId, todayStr);
    const remainingNew = Math.max(0, newLimit - historyCounts.new);
    const remainingReview = Math.max(0, reviewLimit - historyCounts.review);

    SessionManager.startSession(this.currentDeckId, mode, this.cachedImages, remainingNew, remainingReview, this.selectedTagFilter);

    if (SessionManager.queue.length === 0) {
      const filterMsg = this.selectedTagFilter ? `tagged with #${this.selectedTagFilter}` : 'for this study queue';
      this.showToast(`No cards found ${filterMsg}`, 'info');
      return;
    }

    const tagBadge = this.selectedTagFilter ? ` • #${this.selectedTagFilter}` : '';
    document.getElementById('session-deck-name').textContent = deck.name + tagBadge;
    const modeBadge = document.getElementById('session-mode-label');
    const tagSuffix = this.selectedTagFilter ? ` (#${this.selectedTagFilter})` : '';
    if (mode === 'new') { modeBadge.textContent = 'Study New' + tagSuffix; modeBadge.dataset.mode = 'new'; }
    else if (mode === 'review') { modeBadge.textContent = 'Review Due' + tagSuffix; modeBadge.dataset.mode = 'review'; }
    else { modeBadge.textContent = 'Free Study' + tagSuffix; modeBadge.dataset.mode = 'free'; }

    modeBadge.className = 'session-mode-badge' + (mode === 'review' ? ' review' : '');

    this.showView('view-session');
    document.getElementById('review-empty').classList.add('hidden');
    this.showSessionContent(true);

    ArtistToolbox.reset();
    this.startTimerIfNeeded();
    this.showNextImage();
  },

  showNextImage() {
    const now = Date.now();
    if (this._lastNextTime && now - this._lastNextTime < 200) return;
    this._lastNextTime = now;

    const image = SessionManager.nextImage();

    if (!image) {
      if (this.isPiPActive) this.closePiP(true);
      this.showSessionContent(false);
      TimerManager.stop();

      // Automatically sync SRS database directly to disk when session completes
      Storage.syncToDisk(true).catch(() => { });

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

    // Reset sketch overlay when advancing to new reference
    if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active) {
      SketchOverlay.clear();
    }
    if (typeof SmartCropManager !== 'undefined' && SmartCropManager.isCropping) {
      SmartCropManager.cancelCrop();
    }

    const frame = document.getElementById('image-frame');
    const imgEl = document.getElementById('session-image');

    // Crossfade: briefly hide old image content then fade in new
    if (frame) {
      frame.classList.remove('is-loaded', 'image-entering', 'is-loading');
      frame.classList.add('is-loading');
    }

    imgEl.onload = () => {
      ArtistToolbox.fitImage(false);
      if (frame) {
        frame.classList.remove('is-loading');
        frame.classList.add('is-loaded', 'image-entering');
        setTimeout(() => frame.classList.remove('image-entering'), 420);
      }

      // Extract Dominant Palette Swatches & update inspector
      if (typeof ColorPaletteManager !== 'undefined') {
        ColorPaletteManager.onImageLoaded(imgEl);
      }

      // Auto-frame focal crop if studying a child card
      if (typeof SmartCropManager !== 'undefined') {
        SmartCropManager.onImageLoaded(image);
      }

      // Reset & prepare plumb measurement overlay for new image
      if (typeof PlumbTool !== 'undefined') {
        PlumbTool.onImageLoaded(imgEl);
      }
    };
    imgEl.onerror = () => {
      if (frame) frame.classList.remove('is-loading');
      this.showToast('Could not load this reference — press S to skip', 'alert');
    };
    imgEl.src = SessionManager.getImageUrl(image);
    if (imgEl.complete && imgEl.naturalWidth > 0) imgEl.onload();

    // Notify SketchComparison of newly loaded reference (syncs history badges and resets current sketch)
    if (typeof SketchComparison !== 'undefined') {
      SketchComparison.onCardLoaded(SessionManager.deckId, image.id);
    }

    // Animate image name
    const nameEl = document.getElementById('session-image-name');
    if (nameEl) {
      nameEl.textContent = image.name;
      nameEl.classList.remove('img-name-new');
      void nameEl.offsetWidth;
      nameEl.classList.add('img-name-new');
    }

    document.getElementById('session-progress').textContent = `#${SessionManager.imagesShown}`;

    // Update MediaSession for native macOS Always-on-Top PiP
    if ('mediaSession' in navigator && image) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: image.name || `Reference #${SessionManager.imagesShown}`,
          artist: `Art Practice • #${SessionManager.imagesShown} shown`,
          album: 'ArtPractice Spaced Repetition'
        });
      } catch (e) { }
    }

    this.updateRatingIntervals();
    this.renderSessionCardTags();
    if (this.isTagDockOpen) {
      this.renderTagDock();
    }


    document.getElementById('btn-timer-pause').textContent = 'Pause';
    if (this.getTimerDuration() > 0 && TimerManager.isRunning()) {
      TimerManager.reset();
    } else if (this.getTimerDuration() > 0) {
      this.startTimerIfNeeded();
    }
  },

  openSessionSummaryModal() {
    // Automatically flush state to disk
    Storage.syncToDisk(true).catch(() => { });

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

    document.getElementById('summary-streak-val').innerHTML = `${currentStreak} days ${this.getFlameSvgHTML(14, 18)}`;

    document.getElementById('summary-breakdown').innerHTML = `
      <span style="color: var(--again-color)">Again: ${stats.again || 0}</span>
      <span style="color: var(--hard-color)">Hard: ${stats.hard}</span>
      <span style="color: var(--medium-color)">Good: ${stats.medium}</span>
      <span style="color: var(--easy-color)">Easy: ${stats.easy}</span>
    `;

    document.getElementById('modal-session-summary').classList.remove('hidden');
    SoundFX.sessionComplete();
  },

  showBlurOverlay() {
    this.imageBlurred = true;
    document.getElementById('image-blur-overlay').classList.remove('hidden');
    document.getElementById('btn-skip').classList.add('hidden');
    document.body.classList.add('rating-required');
    this.toggleRatingDock(true);
    this.wakeHud();
  },

  clearBlurOverlay() {
    this.imageBlurred = false;
    document.getElementById('image-blur-overlay').classList.add('hidden');
    document.getElementById('btn-skip').classList.remove('hidden');
    document.body.classList.remove('rating-required');
    this.toggleRatingDock(false);
  },

  updateRatingIntervals() {
    if (!SessionManager.currentImage) return;

    const imageId = SessionManager.currentImage.id;
    const deckId = SessionManager.deckId;
    const duration = this.getTimerDuration ? this.getTimerDuration() : (TimerManager.duration || 0);

    ['again', 'hard', 'medium', 'easy'].forEach(diff => {
      const el = document.querySelector(`#btn-rate-${diff} .rate-interval`);
      if (!el) return;
      if (diff === 'again') {
        el.textContent = '<10m';
      } else {
        const days = CardManager.getProjectedInterval(deckId, imageId, diff, duration);
        el.textContent = days === 1 ? '1 day' : `${days} days`;
      }
    });
  },

  rateCurrentImage(difficulty) {
    if (!SessionManager.currentImage) return;
    const now = Date.now();
    if (this._lastRateTime && now - this._lastRateTime < 250) return;
    this._lastRateTime = now;

    SoundFX.rate(difficulty);
    const btn = document.getElementById(`btn-rate-${difficulty}`);

    const image = SessionManager.currentImage;

    // Asynchronously save visual sketch attempt to disk if one was attached
    const sketchToSave = (typeof SketchComparison !== 'undefined' && SketchComparison.currentSketchDataUrl)
      || (typeof SketchOverlay !== 'undefined' ? SketchOverlay.imageSrc : null);
    if (sketchToSave && typeof SketchComparison !== 'undefined') {
      SketchComparison.saveAttempt(
        SessionManager.deckId,
        image.id,
        image.name,
        difficulty,
        sketchToSave
      );
    }

    const duration = this.getTimerDuration ? this.getTimerDuration() : (TimerManager.duration || 0);

    CardManager.rateCard(
      SessionManager.deckId,
      image.id,
      image.name,
      difficulty,
      duration
    );

    SessionManager.sessionStats[difficulty] = (SessionManager.sessionStats[difficulty] || 0) + 1;
    SessionManager.sessionStats.total++;

    if (difficulty === 'again' && SessionManager.mode !== 'free') {
      SessionManager.requeueCard(image.id);
    }

    this.clearBlurOverlay();

    // Auto-advance: show progress bar then auto-proceed
    if (this.autoAdvance) {
      this._showAutoAdvanceIndicator(() => this.showNextImage());
    } else {
      this.showNextImage();
    }
  },

  _showAutoAdvanceIndicator(callback) {
    // Remove any existing indicator
    const existing = document.getElementById('auto-advance-indicator');
    if (existing) existing.remove();
    clearTimeout(this._autoAdvanceTimer);

    const duration = 600; // ms
    const indicator = document.createElement('div');
    indicator.id = 'auto-advance-indicator';
    indicator.className = 'auto-advance-indicator';
    indicator.innerHTML = `
      <span>Next</span>
      <div class="advance-bar">
        <div class="advance-bar-fill" style="--advance-duration: ${duration}ms"></div>
      </div>
    `;
    document.body.appendChild(indicator);

    this._autoAdvanceTimer = setTimeout(() => {
      indicator.remove();
      callback();
    }, duration);
  },

  async endSession() {
    this.toggleTagDock(false);
    if (typeof SketchOverlay !== 'undefined' && SketchOverlay.active) {
      SketchOverlay.clear();
    }
    if (typeof SketchComparison !== 'undefined') {
      SketchComparison.setMode('single');
      SketchComparison.currentSketchDataUrl = null;
    }
    if (typeof ColorPaletteManager !== 'undefined') {
      ColorPaletteManager.toggleHUD(false);
    }
    if (typeof SmartCropManager !== 'undefined') {
      SmartCropManager.cancelCrop();
    }
    if (this.isPiPActive) this.closePiP(true);
    TimerManager.stop();
    if (this.isZenMode) this.toggleZenMode(false);

    // Automatically sync SRS database directly to userdata/srs_state.json on disk after every session!
    await Storage.syncToDisk(true).catch(() => { });

    this.openDeckDetail(this.currentDeckId);
  },

  // ---- In-Session Quick Tagging & Sub-Deck Management ----
  toggleTagDock(force) {
    const dock = document.getElementById('session-tag-dock');
    if (!dock) return;
    const shouldOpen = typeof force === 'boolean' ? force : dock.classList.contains('hidden');
    this.isTagDockOpen = shouldOpen;

    if (shouldOpen) {
      dock.classList.remove('hidden');
      this.renderTagDock();
      const input = document.getElementById('input-custom-tag');
      if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 50);
      }
    } else {
      dock.classList.add('hidden');
      const input = document.getElementById('input-custom-tag');
      if (input) input.blur();
    }
  },

  renderTagDock() {
    const dock = document.getElementById('session-tag-dock');
    if (!dock || !SessionManager.currentImage || !this.currentDeckId) return;

    const activeContainer = document.getElementById('tag-dock-active-tags');
    const presetsGrid = document.getElementById('tag-presets-grid');
    const activeTags = CardManager.getTagsForCard(this.currentDeckId, SessionManager.currentImage.id);

    // Active tags chips
    if (activeContainer) {
      if (activeTags.length === 0) {
        activeContainer.innerHTML = '<span class="tag-empty-note">No tags yet — click a preset below or type a tag</span>';
      } else {
        activeContainer.innerHTML = activeTags.map(tag => {
          const isLeech = tag === 'leech';
          return `
            <span class="tag-chip-active ${isLeech ? 'tag-leech' : ''}">
              <span>#${this._esc(tag)}</span>
              <button type="button" class="btn-remove-tag" data-tag="${this._esc(tag)}" title="Remove tag">${this.getIconSvg('close', 10)}</button>
            </span>
          `;
        }).join('');

        activeContainer.querySelectorAll('.btn-remove-tag').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCardTag(btn.dataset.tag);
          });
        });
      }
    }

    // Presets [1-6]
    if (presetsGrid) {
      presetsGrid.innerHTML = TAG_PRESETS.map(preset => {
        const isTagged = activeTags.includes(preset.id);
        const iconSvg = this.getIconSvg(preset.icon || preset.id, 14, 'preset-icon-svg');
        const checkSvg = this.getIconSvg('check', 12);
        return `
          <button type="button" class="btn-tag-preset ${isTagged ? 'active' : ''} ${preset.id === 'leech' ? 'preset-leech' : ''}" data-tag="${preset.id}">
            <span class="preset-key">${preset.key}</span>
            <span class="preset-icon">${iconSvg}</span>
            <span class="preset-label">${preset.label}</span>
            <span class="preset-check">${isTagged ? checkSvg : '+'}</span>
          </button>
        `;
      }).join('');

      presetsGrid.querySelectorAll('.btn-tag-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          this.toggleCardTag(btn.dataset.tag);
        });
      });
    }
  },

  renderSessionCardTags() {
    const container = document.getElementById('session-card-tags');
    if (!container || !SessionManager.currentImage || !this.currentDeckId) {
      if (container) container.innerHTML = '';
      return;
    }

    const tags = CardManager.getTagsForCard(this.currentDeckId, SessionManager.currentImage.id);
    if (!tags || tags.length === 0) {
      container.innerHTML = '';
      container.classList.add('empty');
      return;
    }

    container.classList.remove('empty');
    container.innerHTML = tags.map(tag => {
      const isLeech = tag === 'leech';
      const preset = TAG_PRESETS.find(p => p.id === tag);
      const iconName = preset ? (preset.icon || preset.id) : 'tag';
      const iconSvg = this.getIconSvg(iconName, 12, 'card-tag-svg');
      return `<span class="card-tag-pill ${isLeech ? 'tag-leech' : ''}" data-tag="${this._esc(tag)}" title="Click to remove tag">${iconSvg} #${this._esc(tag)}</span>`;
    }).join('');

    container.querySelectorAll('.card-tag-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        this.toggleCardTag(pill.dataset.tag);
      });
    });
  },

  toggleCardTag(tag) {
    if (!SessionManager.currentImage || !this.currentDeckId) return;
    const result = CardManager.toggleTagForCard(
      this.currentDeckId,
      SessionManager.currentImage.id,
      SessionManager.currentImage.name,
      tag
    );

    SoundFX.click();
    this.renderSessionCardTags();
    if (this.isTagDockOpen) {
      this.renderTagDock();
    }

    const cleanTag = (tag || '').trim().toLowerCase().replace(/^#/, '');
    const preset = TAG_PRESETS.find(p => p.id === cleanTag);

    if (this.isSafariVideoPiP && typeof PiPCanvasStreamer !== 'undefined') {
      PiPCanvasStreamer.render();
    }
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
  },

  resetTimer() {
    TimerManager.reset();
    document.getElementById('btn-timer-pause').textContent = 'Pause';
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
      this.showToast('Deck updated', 'pencil');
    } else {
      DeckManager.create(name, folder, newLimit, reviewLimit);
      this.showToast('Deck created', 'sparkles');
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
    const folderInput = document.getElementById('input-deck-folder');
    if (window.electronAPI && typeof window.electronAPI.pickDirectory === 'function') {
      try {
        const res = await window.electronAPI.pickDirectory();
        if (!res.canceled && res.path) {
          folderInput.value = res.path;
        }
        return;
      } catch (err) {
        console.warn('Native folder picker failed, falling back to web modal:', err);
      }
    }
    const currentVal = folderInput.value.trim();
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
          ${this.getIconSvg('folder', 14, 'folder-item-icon')} <span>${this._esc(dir)}</span>
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
    this.showToast('Deck deleted', 'trash');
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

// Expose modules globally for cross-window PiP resolution
window.UI = UI;
window.ArtistToolbox = ArtistToolbox;
window.SketchOverlay = SketchOverlay;
window.SketchComparison = SketchComparison;
window.TimerManager = TimerManager;
window.SessionManager = SessionManager;
window.CardManager = CardManager;
window.SoundFX = SoundFX;
window.PiPState = PiPState;
window.ColorPaletteManager = ColorPaletteManager;
window.SmartCropManager = SmartCropManager;
window.PlumbTool = PlumbTool;
window.FloatingWindowManager = FloatingWindowManager;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
});
