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
          try { fn(ctx, ctx.currentTime); } catch (e) {}
        }).catch(() => {});
      } else {
        fn(ctx, ctx.currentTime);
      }
    } catch (e) {}
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

  // Card rating sounds (Hard, Medium, Easy)
  rate(diff) {
    this._play((ctx, t) => {
      if (diff === 'hard') {
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

// ==================== LIVING AMBIENT CANVAS & PARTICLES ====================
// ==================== LIVING AMBIENT CANVAS & PARTICLES ====================
const ParticleFX = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  particles: [],
  bursts: [],
  shockwaves: [],
  fluidWakes: [],
  // Exact cursor coordinates
  cursorX: -9999,
  cursorY: -9999,
  cursorVx: 0,
  cursorVy: 0,
  // Viscous trailing fluid cursor (feels like liquid dragging)
  fluidCursorX: -9999,
  fluidCursorY: -9999,
  wakeDistance: 0,
  targetMouseX: 0,
  targetMouseY: 0,
  mouseX: 0,
  mouseY: 0,
  animId: null,
  isPaused: false,

  init() {
    this.canvas = document.getElementById('particle-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => {
      if (this.cursorX > -1000) {
        this.cursorVx = e.clientX - this.cursorX;
        this.cursorVy = e.clientY - this.cursorY;
        const d = Math.hypot(this.cursorVx, this.cursorVy);
        this.wakeDistance += d;
        // Every ~24px of travel, shed a gentle fluid ripple eddy into the water
        if (this.wakeDistance >= 24) {
          this.wakeDistance = 0;
          this.emitFluidWake(e.clientX, e.clientY);
        }
      } else {
        this.fluidCursorX = e.clientX;
        this.fluidCursorY = e.clientY;
      }
      this.cursorX = e.clientX;
      this.cursorY = e.clientY;
      this.targetMouseX = (e.clientX / (this.width || 1) - 0.5) * 45;
      this.targetMouseY = (e.clientY / (this.height || 1) - 0.5) * 45;
    });

    window.addEventListener('mouseleave', () => {
      this.cursorX = -9999;
      this.cursorY = -9999;
      this.cursorVx = 0;
      this.cursorVy = 0;
    });

    // Generate responsive set of lite, soft bouncy bubbles & stardust motes
    const count = Math.min(75, Math.max(50, Math.floor(window.innerWidth / 24)));
    for (let i = 0; i < count; i++) {
      const isBubble = i % 10 < 6;
      this.particles.push(this._createParticle(isBubble));
    }

    // Page-wide click shockwaves & fluid star sparkles
    document.addEventListener('click', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      this.burst(e.clientX, e.clientY, 14);
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

  _createParticle(isBubble = true) {
    const palette = [
      { r: 56, g: 189, b: 248 },  // Electric Cyan
      { r: 192, g: 132, b: 252 }, // Soft Lavender
      { r: 52, g: 211, b: 153 },  // Seafoam Mint
      { r: 251, g: 191, b: 36 },  // Warm Amber
      { r: 244, g: 114, b: 182 }, // Rose Petal
      { r: 45, g: 212, b: 191 }   // Opal Aqua
    ];
    const color = palette[Math.floor(Math.random() * palette.length)];

    if (isBubble) {
      // Lite, Transparent, Bouncy Soap Bubble: 11px to 30px
      const radius = Math.random() * 16 + 11;
      const baseVx = (Math.random() - 0.5) * 0.3;
      const baseVy = -Math.random() * 0.35 - 0.1; // Gentle weightless float
      return {
        isBubble: true,
        x: Math.random() * (this.width || 800),
        y: Math.random() * (this.height || 600),
        radius,
        color,
        // Soft Jelly elastic deformation physics
        wobbleAmp: 0,
        wobbleAngle: 0,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleFreq: Math.random() * 0.05 + 0.18,
        wobbleDamp: 0.93,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.015 + 0.01,
        vx: baseVx,
        vy: baseVy,
        baseVx,
        baseVy,
        depth: Math.random() * 0.6 + 0.4
      };
    } else {
      // Delicate Stardust Mote: 1.8px to 3.8px
      const radius = Math.random() * 2.0 + 1.8;
      const baseVx = (Math.random() - 0.5) * 0.35;
      const baseVy = -Math.random() * 0.42 - 0.08;
      return {
        isBubble: false,
        x: Math.random() * (this.width || 800),
        y: Math.random() * (this.height || 600),
        radius,
        color,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.03 + 0.015,
        vx: baseVx,
        vy: baseVy,
        baseVx,
        baseVy,
        depth: Math.random() * 0.8 + 0.4
      };
    }
  },

  // Shed a gentle expanding fluid ripple wake behind moving cursor
  emitFluidWake(x, y) {
    if (this.fluidWakes.length > 25) this.fluidWakes.shift();
    this.fluidWakes.push({
      x,
      y,
      r: 5,
      maxR: 38,
      speed: 1.4,
      alpha: 0.32
    });
  },

  // Radial physical shockwave pushing nearby bubbles outward with jelly squish
  triggerShockwave(x, y, maxR = 210, colorPrefix = 'rgba(56, 189, 248, ') {
    this.shockwaves.push({
      x,
      y,
      r: 6,
      maxR,
      speed: 7.2,
      colorPrefix,
      alpha: 0.85,
      decay: 0.024
    });

    // Physics impulse: push nearby bubbles softly away and induce bounce wobble
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const dx = p.x - x;
      const dy = p.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < maxR + 80 && dist > 1) {
        const force = Math.pow(1 - dist / (maxR + 80), 1.3) * 9.5;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
        if (p.isBubble) {
          p.wobbleAngle = Math.atan2(dy, dx);
          p.wobbleAmp = Math.min(0.48, p.wobbleAmp + 0.32);
        }
      }
    }
  },

  // Highlighting click burst with fluid droplet trails, diamond stars, and shockwaves
  burst(x, y, count = 14, customColors = null) {
    this.triggerShockwave(x, y, 190);

    const palette = customColors || [
      '#38bdf8', '#c084fc', '#facc15', '#34d399', '#ffffff', '#fb7185', '#60a5fa'
    ];

    // 1. Spawning 4-point diamond star sparkles
    const starCount = Math.min(5, Math.max(3, Math.floor(count * 0.35)));
    for (let i = 0; i < starCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4.2 + 2.0;
      this.bursts.push({
        isStar: true,
        x,
        y,
        prevX: x,
        prevY: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        color: palette[Math.floor(Math.random() * palette.length)],
        radius: Math.random() * 3.5 + 3.2,
        rot: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 0.28,
        life: 1.0,
        decay: Math.random() * 0.028 + 0.022,
        gravity: 0.04
      });
    }

    // 2. Spawning fluid droplet sparks with motion tails
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4.8 + 1.4;
      this.bursts.push({
        isDroplet: true,
        x,
        y,
        prevX: x,
        prevY: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: palette[Math.floor(Math.random() * palette.length)],
        radius: Math.random() * 2.8 + 1.4,
        life: 1.0,
        decay: Math.random() * 0.032 + 0.024,
        gravity: 0.07
      });
    }
  },

  celebrate(originX = null, originY = null) {
    const x = originX !== null ? originX : (this.width || 800) / 2;
    const y = originY !== null ? originY : (this.height || 600) * 0.42;
    this.triggerShockwave(x, y, 320, 'rgba(192, 132, 252, ');

    const palette = ['#38bdf8', '#c084fc', '#34d399', '#facc15', '#fb7185', '#60a5fa', '#ffffff'];

    for (let i = 0; i < 90; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 8.2 + 2.8;
      const isConfetti = Math.random() > 0.45;
      const isStar = !isConfetti && Math.random() > 0.5;

      this.bursts.push({
        x: x + (Math.random() - 0.5) * 45,
        y: y + (Math.random() - 0.5) * 25,
        prevX: x,
        prevY: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.8,
        color: palette[Math.floor(Math.random() * palette.length)],
        radius: Math.random() * 3.6 + 1.8,
        life: 1.0,
        decay: Math.random() * 0.016 + 0.012,
        gravity: 0.15,
        isConfetti,
        isStar,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.22
      });
    }
  },

  _drawSparkleStar(ctx, x, y, outerR, innerR, angle) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a1 = angle + (i * Math.PI) / 2;
      const a2 = a1 + Math.PI / 4;
      const ox = x + Math.cos(a1) * outerR;
      const oy = y + Math.sin(a1) * outerR;
      const ix = x + Math.cos(a2) * innerR;
      const iy = y + Math.sin(a2) * innerR;
      if (i === 0) ctx.moveTo(ox, oy);
      else ctx.lineTo(ox, oy);
      ctx.lineTo(ix, iy);
    }
    ctx.closePath();
    ctx.fill();
  },

  loop() {
    if (this.isPaused) {
      this.animId = null;
      return;
    }

    // Smooth cursor movement & velocity damping
    this.mouseX += (this.targetMouseX - this.mouseX) * 0.06;
    this.mouseY += (this.targetMouseY - this.mouseY) * 0.06;
    this.cursorVx *= 0.88;
    this.cursorVy *= 0.88;

    // Update trailing fluid cursor (viscous drag feel)
    if (this.cursorX > -1000) {
      this.fluidCursorX += (this.cursorX - this.fluidCursorX) * 0.22;
      this.fluidCursorY += (this.cursorY - this.fluidCursorY) * 0.22;
    }

    this.ctx.clearRect(0, 0, this.width, this.height);

    const hasCursor = this.cursorX > -1000 && this.cursorY > -1000;
    const mouseSpeed = Math.hypot(this.cursorVx, this.cursorVy);

    // 1. Render Expanding Fluid Wake Ripples shed by moving cursor
    for (let i = this.fluidWakes.length - 1; i >= 0; i--) {
      const w = this.fluidWakes[i];
      w.r += w.speed;
      w.alpha = (1 - w.r / w.maxR) * 0.32;
      if (w.r >= w.maxR || w.alpha <= 0.005) {
        this.fluidWakes.splice(i, 1);
        continue;
      }
      this.ctx.beginPath();
      this.ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      this.ctx.strokeStyle = `rgba(56, 189, 248, ${w.alpha.toFixed(3)})`;
      this.ctx.lineWidth = 1.0;
      this.ctx.stroke();
    }

    // 2. Viscous Liquid Cursor Aura & Streamline Droplet
    if (hasCursor) {
      const dragDx = this.cursorX - this.fluidCursorX;
      const dragDy = this.cursorY - this.fluidCursorY;
      const dragDist = Math.hypot(dragDx, dragDy);
      const dragAngle = Math.atan2(dragDy, dragDx);
      const stretch = Math.min(2.2, 1 + dragDist / 20);

      this.ctx.save();
      this.ctx.translate(this.fluidCursorX, this.fluidCursorY);
      this.ctx.rotate(dragAngle);
      this.ctx.scale(stretch, 1 / Math.sqrt(stretch));

      // Luminous fluid droplet halo
      const curGrad = this.ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
      curGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
      curGrad.addColorStop(0.35, 'rgba(56, 189, 248, 0.22)');
      curGrad.addColorStop(0.8, 'rgba(168, 85, 247, 0.08)');
      curGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');

      this.ctx.beginPath();
      this.ctx.arc(0, 0, 11, 0, Math.PI * 2);
      this.ctx.fillStyle = curGrad;
      this.ctx.fill();

      // Fluid glint core
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      this.ctx.fill();

      this.ctx.restore();
    }

    // 3. Soft Bubble-to-Bubble Collisions & Elastic Bouncing
    for (let i = 0; i < this.particles.length; i++) {
      const p1 = this.particles[i];
      if (!p1.isBubble) continue;
      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        if (!p2.isBubble) continue;
        const ddx = p2.x - p1.x;
        const ddy = p2.y - p1.y;
        const minD = p1.radius + p2.radius;
        const ddist = Math.hypot(ddx, ddy);
        if (ddist < minD && ddist > 1) {
          const overlap = minD - ddist;
          const nx = ddx / ddist;
          const ny = ddy / ddist;
          // Soft elastic spring bounce
          p1.vx -= nx * overlap * 0.035;
          p1.vy -= ny * overlap * 0.035;
          p2.vx += nx * overlap * 0.035;
          p2.vy += ny * overlap * 0.035;
          // Induce soft jelly wobble
          p1.wobbleAngle = Math.atan2(ny, nx);
          p2.wobbleAngle = Math.atan2(-ny, -nx);
          p1.wobbleAmp = Math.min(0.38, p1.wobbleAmp + 0.12);
          p2.wobbleAmp = Math.min(0.38, p2.wobbleAmp + 0.12);
        }
      }
    }

    // 4. Delicate Constellation Filaments between nearby bubbles
    for (let i = 0; i < this.particles.length; i += 2) {
      const p1 = this.particles[i];
      if (!p1.isBubble) continue;
      for (let j = i + 1; j < this.particles.length; j += 2) {
        const p2 = this.particles[j];
        if (!p2.isBubble) continue;
        const ddx = p1.x - p2.x;
        const ddy = p1.y - p2.y;
        const ddist = Math.hypot(ddx, ddy);
        if (ddist < 115) {
          const alpha = (1 - ddist / 115) * 0.18;
          this.ctx.beginPath();
          this.ctx.moveTo(p1.x, p1.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.strokeStyle = `rgba(${p1.color.r}, ${p1.color.g}, ${p1.color.b}, ${alpha.toFixed(3)})`;
          this.ctx.lineWidth = 0.7;
          this.ctx.stroke();
        }
      }
    }

    // 5. Living Ambient Floating Bubbles & Stardust
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Interactive mouse fluid physics: soft viscous spring + jelly deformation + wake suction
      if (hasCursor) {
        const dx = p.x - this.cursorX;
        const dy = p.y - this.cursorY;
        const dist = Math.hypot(dx, dy);
        const influenceR = p.isBubble ? 160 : 120;

        if (dist < influenceR && dist > 1) {
          const ratio = 1 - dist / influenceR;
          // Soft sinusoidal spring repulsion (viscous cushion rather than hard kick)
          const springForce = Math.sin(ratio * Math.PI / 2) * 3.4;
          p.vx += (dx / dist) * springForce;
          p.vy += (dy / dist) * springForce;

          if (p.isBubble) {
            // Soft jelly squish against cursor cushion
            p.wobbleAngle = Math.atan2(dy, dx);
            p.wobbleAmp = Math.min(0.44, p.wobbleAmp + ratio * 0.22);
          }

          // Hydrodynamic wake suction and swirl behind moving cursor
          if (mouseSpeed > 0.5) {
            const wakeRatio = ratio * 0.75;
            p.vx += this.cursorVx * 0.035 * wakeRatio;
            p.vy += this.cursorVy * 0.035 * wakeRatio;
            p.vx += (-dy / dist) * (this.cursorVx * 0.03) * wakeRatio;
            p.vy += (dx / dist) * (this.cursorVy * 0.03) * wakeRatio;
          }

          // Delicate bioluminescent attraction beam to cursor
          if (dist < 130) {
            this.ctx.beginPath();
            this.ctx.moveTo(p.x, p.y);
            this.ctx.lineTo(this.cursorX, this.cursorY);
            this.ctx.strokeStyle = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${(ratio * 0.24).toFixed(3)})`;
            this.ctx.lineWidth = 0.9;
            this.ctx.stroke();
          }
        }
      }

      // Physics damping & return to natural float current
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.vx += (p.baseVx - p.vx) * 0.025;
      p.vy += (p.baseVy - p.vy) * 0.025;

      p.pulsePhase += p.pulseSpeed;
      p.x += p.vx + Math.sin(p.pulsePhase) * 0.28;
      p.y += p.vy;

      // Screen boundary wrap
      if (p.y < -40) {
        p.y = this.height + 30;
        p.x = Math.random() * this.width;
      }
      if (p.x < -40) p.x = this.width + 30;
      if (p.x > this.width + 40) p.x = -30;

      const posX = p.x + this.mouseX * p.depth;
      const posY = p.y + this.mouseY * p.depth;

      if (p.isBubble) {
        // Soft Jelly Elastic Wobble & Lite Transparent Soap Bubble Rendering
        p.wobblePhase += p.wobbleFreq;
        p.wobbleAmp *= p.wobbleDamp;
        const squish = p.wobbleAmp * Math.sin(p.wobblePhase);
        const scaleMajor = Math.max(0.6, 1 + squish);
        const scaleMinor = Math.max(0.6, 1 - squish * 0.65); // Preserves bubble liquid volume

        this.ctx.save();
        this.ctx.translate(posX, posY);
        this.ctx.rotate(p.wobbleAngle);
        this.ctx.scale(scaleMajor, scaleMinor);

        const r = p.radius * (1 + 0.05 * Math.sin(p.pulsePhase));

        // 1. Transparent airy interior (barely there, ethereal liquid membrane)
        const grad = this.ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
        grad.addColorStop(0.35, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0.03)`);
        grad.addColorStop(0.75, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0.08)`);
        grad.addColorStop(1, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0.26)`);

        this.ctx.beginPath();
        this.ctx.arc(0, 0, r, 0, Math.PI * 2);
        this.ctx.fillStyle = grad;
        this.ctx.fill();

        // 2. Delicate iridescent glowing rim (fine 1.0px contour)
        this.ctx.lineWidth = 1.0;
        this.ctx.strokeStyle = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0.36)`;
        this.ctx.stroke();

        // 3. Ethereal curved specular crescent glint
        this.ctx.beginPath();
        this.ctx.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        this.ctx.fill();

        // 4. Secondary soft reflection dot
        this.ctx.beginPath();
        this.ctx.arc(r * 0.32, r * 0.32, r * 0.08, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
        this.ctx.fill();

        this.ctx.restore();
      } else {
        // Delicate Stardust Mote with Soft Halo
        const moteGrad = this.ctx.createRadialGradient(posX, posY, 0, posX, posY, p.radius * 2.2);
        moteGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
        moteGrad.addColorStop(0.4, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0.28)`);
        moteGrad.addColorStop(1, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0)`);

        this.ctx.beginPath();
        this.ctx.arc(posX, posY, p.radius * 2.2, 0, Math.PI * 2);
        this.ctx.fillStyle = moteGrad;
        this.ctx.fill();
      }
    }

    // 6. Shockwave Rings
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.r += sw.speed;
      sw.alpha = (1 - sw.r / sw.maxR) * 0.82;

      if (sw.r >= sw.maxR || sw.alpha <= 0.01) {
        this.shockwaves.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
      this.ctx.lineWidth = Math.max(1, (1 - sw.r / sw.maxR) * 2.5);
      this.ctx.strokeStyle = `${sw.colorPrefix}${sw.alpha.toFixed(2)})`;
      this.ctx.shadowColor = sw.colorPrefix + '0.6)';
      this.ctx.shadowBlur = 10;
      this.ctx.stroke();
      this.ctx.restore();
    }

    // 7. Click micro-bursts / sparkles / stars
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.prevX = b.x;
      b.prevY = b.y;
      b.x += b.vx;
      b.y += b.vy;
      b.vy += b.gravity;
      b.vx *= 0.97;
      b.life -= b.decay;

      if (b.life <= 0) {
        this.bursts.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, b.life);
      this.ctx.fillStyle = b.color;
      this.ctx.strokeStyle = b.color;

      if (b.isStar) {
        b.rot += b.rotSpeed;
        const outerR = b.radius * (0.4 + 0.6 * b.life);
        const innerR = outerR * 0.28;
        this._drawSparkleStar(this.ctx, b.x, b.y, outerR, innerR, b.rot);
      } else if (b.isConfetti) {
        b.rot += b.rotSpeed;
        this.ctx.translate(b.x, b.y);
        this.ctx.rotate(b.rot);
        this.ctx.fillRect(-b.radius, -b.radius * 0.6, b.radius * 2, b.radius * 1.2);
      } else if (b.isDroplet) {
        // Fluid droplet trail
        this.ctx.lineWidth = b.radius * b.life;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(b.prevX, b.prevY);
        this.ctx.lineTo(b.x, b.y);
        this.ctx.stroke();
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

    // Check fast localStorage cache first for zero-flicker immediate render
    try {
      const cached = localStorage.getItem('artpractice_wallpaper_data');
      if (cached) {
        this.currentWallpaperDataUrl = cached;
        this.applyStyles();
      }
    } catch (e) {}

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
    } catch (e) {}

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
    try {
      localStorage.removeItem('artpractice_wallpaper_data');
    } catch (e) {}

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

  // ---- Fluid Ripple Effect on Clicks ----
  createFluidRipple(e, target) {
    if (!target) return;
    try {
      const rect = target.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'fluid-ripple';

      const diameter = Math.max(rect.width, rect.height) * 1.6;
      ripple.style.width = `${diameter}px`;
      ripple.style.height = `${diameter}px`;

      const x = e && typeof e.clientX === 'number' ? e.clientX - rect.left : rect.width / 2;
      const y = e && typeof e.clientY === 'number' ? e.clientY - rect.top : rect.height / 2;

      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;

      const computedPos = window.getComputedStyle(target).position;
      if (computedPos === 'static') {
        target.style.position = 'relative';
      }

      target.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
      setTimeout(() => ripple.remove(), 650);
    } catch (err) {}
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

    // Global tactile click sound and fluid ripple on interactive elements & background
    document.addEventListener('click', (e) => {
      const interactiveEl = e.target.closest('button, .btn, .folder-item, .btn-rate, .deck-card, .tool-btn, .badge, .tab-btn, a, .stat-pill, .control-btn, .shortcut-row');
      if (interactiveEl) {
        SoundFX.click();
        this.createFluidRipple(e, interactiveEl);
      } else if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        // Also play fluid tactile click on background/canvas clicks
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
      this.showToast('Please select an image file (PNG, JPG, WEBP, etc.)', '⚠️');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      WallpaperManager.setCustomWallpaper(e.target.result);
    };
    reader.onerror = () => {
      this.showToast('Failed to load image file', '❌');
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
