/* ============================================
   Art Practice Reference — App Logic
   Modules: Storage, DeckManager, CardManager,
            ReviewHistory, TimerManager,
            SessionManager, UI
   ============================================ */

// ==================== STORAGE ====================
const Storage = {
  DECKS_KEY: 'artpractice_decks',
  CARDS_KEY: 'artpractice_cards',
  HISTORY_KEY: 'artpractice_history',

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
    // Also delete associated cards and history
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
  // Cards stored as: { [deckId]: { [imageId]: cardData } }
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

  /**
   * Rate an image card. Creates or updates the card's SRS data.
   * Returns the updated card.
   */
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
      // New card — first review
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
      // Existing card — subsequent review
      const prevInterval = existing.interval || 1;
      const prevEase = existing.easeFactor || 1.5;

      switch (difficulty) {
        case 'hard':
          // Reduce interval, lower ease factor (Acts like Anki's Hard/Again)
          interval = Math.max(1, Math.round(prevInterval * 0.5));
          easeFactor = Math.max(1.3, prevEase - 0.2);
          break;
        case 'medium':
          // Normal growth (Anki's Good)
          interval = Math.max(prevInterval + 1, Math.round(prevInterval * prevEase));
          easeFactor = prevEase;
          break;
        case 'easy':
          // Bonus growth (Anki's Easy)
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

    // Record in review history
    ReviewHistory.record(deckId, isNewCard);

    return this.cards[deckId][imageId];
  },

  /**
   * Get the projected interval for a card given a difficulty rating.
   */
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

  /**
   * Get all cards due for review today (or overdue).
   */
  getDueCards(deckId) {
    const deckCards = this.cards[deckId];
    if (!deckCards) return [];

    const todayStr = this._dateStr(new Date());
    return Object.values(deckCards).filter(c => c.dueDate <= todayStr);
  },

  /**
   * Get all reviewed cards for a deck (with upcoming reviews).
   */
  getUpcomingReviews(deckId) {
    const deckCards = this.cards[deckId];
    if (!deckCards) return [];

    return Object.values(deckCards)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  },

  /**
   * Get stats for a deck.
   */
  getStats(deckId, totalImages) {
    const deckCards = this.cards[deckId] || {};
    const reviewed = Object.keys(deckCards).length;
    const todayStr = this._dateStr(new Date());
    const due = Object.values(deckCards).filter(c => c.dueDate <= todayStr).length;

    return {
      total: totalImages,
      reviewed,
      newCards: totalImages - reviewed,
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
  duration: 0,        // Total duration in seconds
  remaining: 0,       // Remaining seconds
  intervalId: null,
  isPaused: false,
  autoAdvance: false,
  onTick: null,       // callback(remaining, total)
  onEnd: null,        // callback()

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
        if (this.onTick) this.onTick(this.remaining, this.duration);

        if (this.remaining <= 0) {
          this.stop();
          // Play beep
          this._beep();
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

  _beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      // Second beep
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1000;
        gain2.gain.value = 0.3;
        osc2.start();
        osc2.stop(ctx.currentTime + 0.3);
      }, 350);
    } catch (e) {
      // Audio not available
    }
  }
};

// ==================== SESSION MANAGER ====================
const SessionManager = {
  deckId: null,
  mode: null,          // 'study' or 'review'
  images: [],          // All images from the folder
  queue: [],           // Current queue of image IDs to show
  currentImage: null,  // Current image being displayed
  imagesShown: 0,

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
    this.mode = mode; // 'new', 'review', or 'free'
    this.images = images;
    this.imagesShown = 0;

    const deckCards = CardManager.getCardsForDeck(deckId);

    if (mode === 'free') {
      this.queue = this._shuffle(images.map(img => img.id));
    }
    else if (mode === 'new') {
      const unseenIds = images
        .map(img => img.id)
        .filter(id => !deckCards[id]);
      this.queue = this._shuffle(unseenIds).slice(0, newLimit);
    }
    else if (mode === 'review') {
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
        // Re-shuffle all images for continuous free study
        this.queue = this._shuffle(this.images.map(img => img.id));
      } else {
        // Limited session (new or review) complete
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

// ==================== UI ====================
const UI = {
  currentDeckId: null,
  cachedImages: null,    // Cache folder scan results per deck
  imageBlurred: false,   // Track whether image is blurred (timer ended)
  folderBrowserCurrentPath: null, // Current path in folder browser
  imageZoom: 1,
  imageRotate: 0,
  imageFlipX: 1,

  init() {
    DeckManager.init();
    CardManager.init();
    ReviewHistory.init();
    this.bindEvents();
    this.showDeckList();
  },

  // ---- Event Binding ----
  bindEvents() {
    // Deck list
    document.getElementById('btn-new-deck').addEventListener('click', () => this.openDeckModal());

    // Deck detail
    document.getElementById('btn-back-to-list').addEventListener('click', () => this.showDeckList());
    document.getElementById('btn-edit-deck').addEventListener('click', () => this.openDeckModal(this.currentDeckId));
    document.getElementById('btn-delete-deck').addEventListener('click', () => this.openDeleteModal());
    document.getElementById('btn-study-new').addEventListener('click', () => this.startSession('new'));
    document.getElementById('btn-review').addEventListener('click', () => this.startSession('review'));
    document.getElementById('btn-free-study').addEventListener('click', () => this.startSession('free'));
    document.getElementById('btn-todays-reviewed').addEventListener('click', () => this.openTodaysReviewedModal());
    document.getElementById('btn-close-todays').addEventListener('click', () => this.closeTodaysReviewedModal());
    document.getElementById('modal-todays-reviewed').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeTodaysReviewedModal();
    });

    // Session
    document.getElementById('btn-end-session').addEventListener('click', () => this.endSession());
    document.getElementById('btn-rate-hard').addEventListener('click', () => this.rateCurrentImage('hard'));
    document.getElementById('btn-rate-medium').addEventListener('click', () => this.rateCurrentImage('medium'));
    document.getElementById('btn-rate-easy').addEventListener('click', () => this.rateCurrentImage('easy'));
    document.getElementById('btn-skip').addEventListener('click', () => this.showNextImage());
    document.getElementById('btn-review-done').addEventListener('click', () => this.endSession());

    // Timer controls
    document.getElementById('btn-timer-pause').addEventListener('click', () => this.toggleTimerPause());
    document.getElementById('btn-timer-reset').addEventListener('click', () => this.resetTimer());

    // Image toolbar
    document.getElementById('btn-img-zoom-in').addEventListener('click', () => this.zoomImage(0.2));
    document.getElementById('btn-img-zoom-out').addEventListener('click', () => this.zoomImage(-0.2));
    document.getElementById('btn-img-flip').addEventListener('click', () => this.flipImage());
    document.getElementById('btn-img-rotate').addEventListener('click', () => this.rotateImage());
    document.getElementById('btn-img-fullscreen').addEventListener('click', () => this.toggleFullscreen());

    // Deck modal
    document.getElementById('form-deck').addEventListener('submit', (e) => this.handleDeckSubmit(e));
    document.getElementById('btn-cancel-deck').addEventListener('click', () => this.closeDeckModal());

    // Folder browser
    document.getElementById('btn-browse-folder').addEventListener('click', () => this.openFolderBrowser());
    document.getElementById('btn-cancel-browse').addEventListener('click', () => this.closeFolderBrowser());
    document.getElementById('btn-select-folder').addEventListener('click', () => this.selectBrowsedFolder());
    document.getElementById('folder-browser-up').addEventListener('click', () => this.browseFolderUp());

    // Delete modal
    document.getElementById('btn-cancel-delete').addEventListener('click', () => this.closeDeleteModal());
    document.getElementById('btn-confirm-delete').addEventListener('click', () => this.confirmDelete());

    // Close modals on overlay click
    document.getElementById('modal-deck').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeDeckModal();
    });
    document.getElementById('modal-delete').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeDeleteModal();
    });
    document.getElementById('modal-folder-browser').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeFolderBrowser();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
  },

  handleKeyboard(e) {
    // Only in session view
    const sessionView = document.getElementById('view-session');
    if (!sessionView.classList.contains('active')) return;

    switch (e.key) {
      case '1': this.rateCurrentImage('hard'); break;
      case '2': this.rateCurrentImage('medium'); break;
      case '3': this.rateCurrentImage('easy'); break;
      case 's':
        if (!this.imageBlurred) this.showNextImage();
        break;
      case ' ':
        e.preventDefault();
        this.toggleTimerPause();
        break;
    }
  },

  // ---- View Switching ----
  showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
  },

  // ---- Deck List ----
  showDeckList() {
    this.showView('view-deck-list');
    this.renderDeckList();
  },

  renderDeckList() {
    const decks = DeckManager.getAll();
    const listEl = document.getElementById('deck-list');
    const emptyEl = document.getElementById('empty-state');

    if (decks.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    listEl.innerHTML = decks.map(deck => {
      const deckCards = CardManager.getCardsForDeck(deck.id);
      const reviewed = Object.keys(deckCards).length;
      const todayStr = CardManager._dateStr(new Date());
      const due = Object.values(deckCards).filter(c => c.dueDate <= todayStr).length;

      return `
        <div class="deck-card" data-deck-id="${deck.id}">
          <div class="deck-card-name">${this._esc(deck.name)}</div>
          <div class="deck-card-path">${this._esc(deck.folderPath)}</div>
          <div class="deck-card-stats">
            <span>${reviewed} reviewed</span>
            ${due > 0 ? `<span class="due-badge">${due} due</span>` : '<span>0 due</span>'}
          </div>
        </div>
      `;
    }).join('');

    // Bind click events
    listEl.querySelectorAll('.deck-card').forEach(card => {
      card.addEventListener('click', () => {
        this.openDeckDetail(card.dataset.deckId);
      });
    });
  },

  // ---- Deck Detail ----
  async openDeckDetail(deckId) {
    this.currentDeckId = deckId;
    const deck = DeckManager.getById(deckId);
    if (!deck) return;

    document.getElementById('deck-detail-name').textContent = deck.name;
    document.getElementById('deck-detail-path').textContent = deck.folderPath;

    this.showView('view-deck-detail');

    // Load images from folder
    try {
      this.cachedImages = await SessionManager.loadImages(deck.folderPath);
    } catch (err) {
      this.cachedImages = [];
      alert(`Error loading folder: ${err.message}`);
    }

    this.renderDeckStats();
    this.renderHeatmap();
    this.renderActivityStats();
    this.renderTodaysReviewedCount();
  },

  renderDeckStats() {
    const totalImages = this.cachedImages ? this.cachedImages.length : 0;
    const stats = CardManager.getStats(this.currentDeckId, totalImages);
    
    // Calculate Anki-style limits
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
    
    // Disable buttons if limits reached
    document.getElementById('btn-study-new').disabled = availableNew === 0;
    document.getElementById('btn-review').disabled = availableReview === 0;
  },

  // ---- Heatmap ----
  renderHeatmap() {
    const gridEl = document.getElementById('heatmap-grid');
    const monthsEl = document.getElementById('heatmap-months');
    const deckId = this.currentDeckId;

    // Gather past review data from ReviewHistory (now global)
    const pastData = ReviewHistory.getGlobalHistory();

    // Gather future scheduled data from cards
    const futureData = {};
    const deckCards = CardManager.getCardsForDeck(deckId);
    const todayStr = CardManager._dateStr(new Date());
    Object.values(deckCards).forEach(card => {
      if (card.dueDate > todayStr) {
        futureData[card.dueDate] = (futureData[card.dueDate] || 0) + 1;
      }
    });

    // Date range: ~11 months back to ~2 months forward
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 330);
    // Adjust to start on Monday
    const startDay = startDate.getDay(); // 0=Sun
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    startDate.setDate(startDate.getDate() + mondayOffset);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 60);
    // Adjust to end on Sunday
    const endDay = endDate.getDay();
    if (endDay !== 0) endDate.setDate(endDate.getDate() + (7 - endDay));

    // Find max values for color scaling
    let maxPast = 0;
    Object.values(pastData).forEach(v => { if (v > maxPast) maxPast = v; });
    let maxFuture = 0;
    Object.values(futureData).forEach(v => { if (v > maxFuture) maxFuture = v; });

    // Build cells
    const cells = [];
    const monthLabels = [];
    let currentDate = new Date(startDate);
    let lastMonthLabel = -1;
    let weekIndex = 0;

    while (currentDate <= endDate) {
      const dateStr = this._dateToStr(currentDate);
      const dayOfWeek = currentDate.getDay(); // 0=Sun, 1=Mon...

      // Track month labels (on first Monday of each month column)
      if (dayOfWeek === 1) { // Monday = start of a new column
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

    // Render month labels
    const totalWeeks = weekIndex;
    const cellSize = 15; // 13px cell + 2px gap
    monthsEl.innerHTML = '';
    monthLabels.forEach((m, i) => {
      const nextWeek = (i + 1 < monthLabels.length) ? monthLabels[i + 1].weekIndex : totalWeeks;
      const span = document.createElement('span');
      span.textContent = m.label;
      span.style.width = ((nextWeek - m.weekIndex) * cellSize) + 'px';
      monthsEl.appendChild(span);
    });

    // Auto-scroll to show today
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
    const deckId = this.currentDeckId;
    const history = ReviewHistory.getGlobalHistory();
    const todayStr = CardManager._dateStr(new Date());

    const dates = Object.keys(history).filter(d => d <= todayStr).sort();
    const totalReviews = dates.reduce((sum, d) => sum + history[d], 0);
    const daysWithReviews = dates.length;

    // Daily average
    const dailyAvg = daysWithReviews > 0 ? Math.round(totalReviews / daysWithReviews) : 0;
    document.getElementById('stat-daily-avg').textContent = `${dailyAvg} cards`;

    // Days learned % (of last 30 days)
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

    // Streaks
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);

    // Current streak: count back from today
    for (let i = 0; i < 365; i++) {
      const ds = this._dateToStr(checkDate);
      if (history[ds] && history[ds] > 0) {
        currentStreak++;
      } else {
        if (i === 0) { /* today might not have reviews yet, skip */ }
        else break;
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // Longest streak
    const allDates = dates;
    if (allDates.length > 0) {
      tempStreak = 1;
      longestStreak = 1;
      for (let i = 1; i < allDates.length; i++) {
        const prev = new Date(allDates[i - 1] + 'T00:00:00');
        const curr = new Date(allDates[i] + 'T00:00:00');
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
    document.getElementById('stat-current-streak').textContent = `${currentStreak} days`;
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
      `You reviewed ${count} card${count !== 1 ? 's' : ''} today.`;

    const listEl = document.getElementById('todays-reviewed-list');
    if (count === 0) {
      listEl.innerHTML = '<div class="folder-browser-empty">No reviews yet today. Start a session!</div>';
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

  // ---- Session ----
  async startSession(mode) {
    if (!this.cachedImages || this.cachedImages.length === 0) {
      alert('No images found in the deck folder.');
      return;
    }

    const deck = DeckManager.getById(this.currentDeckId);
    if (!deck) return;

    // Calculate limits for the session manager
    const newLimit = deck.newLimit || 20;
    const reviewLimit = deck.reviewLimit || 200;
    const todayStr = CardManager._dateStr(new Date());
    const historyCounts = ReviewHistory.getCounts(this.currentDeckId, todayStr);
    const remainingNew = Math.max(0, newLimit - historyCounts.new);
    const remainingReview = Math.max(0, reviewLimit - historyCounts.review);

    SessionManager.startSession(this.currentDeckId, mode, this.cachedImages, remainingNew, remainingReview);

    // Update session header
    document.getElementById('session-deck-name').textContent = deck.name;
    const modeBadge = document.getElementById('session-mode-label');
    if (mode === 'new') modeBadge.textContent = 'Study New';
    else if (mode === 'review') modeBadge.textContent = 'Review';
    else modeBadge.textContent = 'Free Study';
    
    modeBadge.className = 'session-mode-badge' + (mode === 'review' ? ' review' : '');

    // Show session view
    this.showView('view-session');
    document.getElementById('review-empty').classList.add('hidden');
    this.showSessionContent(true);

    // Start timer if configured
    this.startTimerIfNeeded();

    // Show first image
    this.showNextImage();
  },

  showNextImage() {
    const image = SessionManager.nextImage();

    if (!image) {
      // Review mode complete
      this.showSessionContent(false);
      document.getElementById('review-empty').classList.remove('hidden');
      TimerManager.stop();
      return;
    }

    // Clear blur overlay
    this.clearBlurOverlay();

    // Reset image transform
    this.imageZoom = 1;
    this.imageRotate = 0;
    this.imageFlipX = 1;
    this.applyImageTransform();

    // Update image
    const imgEl = document.getElementById('session-image');
    imgEl.src = SessionManager.getImageUrl(image.id);
    document.getElementById('session-image-name').textContent = image.name;

    // Update progress
    document.getElementById('session-progress').textContent =
      `#${SessionManager.imagesShown}`;

    // Update rating button intervals
    this.updateRatingIntervals();

    // Reset timer for this image — always reset pause button text
    document.getElementById('btn-timer-pause').textContent = 'Pause';
    if (this.getTimerDuration() > 0 && TimerManager.isRunning()) {
      TimerManager.reset();
    } else if (this.getTimerDuration() > 0) {
      this.startTimerIfNeeded();
    }
  },

  // ---- Image Manipulation ----
  zoomImage(delta) {
    this.imageZoom += delta;
    if (this.imageZoom < 0.2) this.imageZoom = 0.2;
    if (this.imageZoom > 5) this.imageZoom = 5;
    this.applyImageTransform();
  },

  rotateImage() {
    this.imageRotate = (this.imageRotate + 90) % 360;
    this.applyImageTransform();
  },

  flipImage() {
    this.imageFlipX *= -1;
    this.applyImageTransform();
  },

  applyImageTransform() {
    const imgEl = document.getElementById('session-image');
    if (imgEl) {
      // Apply scale (zoom), then scaleX (flip), then rotate
      imgEl.style.transform = `scale(${this.imageZoom}) scaleX(${this.imageFlipX}) rotate(${this.imageRotate}deg)`;
    }
  },

  toggleFullscreen() {
    const container = document.getElementById('session-image-container');
    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      } else if (container.webkitRequestFullscreen) { /* Safari */
        container.webkitRequestFullscreen();
      } else if (container.msRequestFullscreen) { /* IE11 */
        container.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) { /* Safari */
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) { /* IE11 */
        document.msExitFullscreen();
      }
    }
  },

  showBlurOverlay() {
    this.imageBlurred = true;
    document.getElementById('image-blur-overlay').classList.remove('hidden');
    // Hide skip button when blurred — must rate
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

    const image = SessionManager.currentImage;
    CardManager.rateCard(
      SessionManager.deckId,
      image.id,
      image.name,
      difficulty
    );

    // Clear blur if it was active
    this.clearBlurOverlay();

    // In review mode, remove this card from the queue (already done by nextImage)
    this.showNextImage();
  },

  endSession() {
    TimerManager.stop();
    this.openDeckDetail(this.currentDeckId);
  },

  showSessionContent(show) {
    const elements = [
      '.image-container', '.rating-area', '#timer-display'
    ];
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

  // ---- Timer ----
  getTimerDuration() {
    const selected = document.querySelector('input[name="timer"]:checked');
    if (!selected) return 0;

    if (selected.value === 'custom') {
      const customVal = parseInt(document.getElementById('custom-timer-input').value);
      return isNaN(customVal) ? 0 : customVal;
    }
    return parseInt(selected.value);
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
      // onTick
      (remaining, total) => {
        const pct = (remaining / total) * 100;
        const bar = document.getElementById('timer-bar');
        bar.style.width = pct + '%';
        bar.className = 'timer-bar';
        if (pct < 20) bar.classList.add('danger');
        else if (pct < 40) bar.classList.add('warning');

        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        document.getElementById('timer-text').textContent =
          `${mins}:${secs.toString().padStart(2, '0')}`;
      },
      // onEnd — blur the image, user must rate to proceed
      () => {
        document.getElementById('timer-text').textContent = "0:00";
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
    if (newLimitInput) newLimitInput.value = "20";
    if (reviewLimitInput) reviewLimitInput.value = "200";

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

    // Validate folder exists by trying to load it
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
    } else {
      DeckManager.create(name, folder, newLimit, reviewLimit);
    }

    this.closeDeckModal();

    // Refresh current view
    if (editId && this.currentDeckId === editId) {
      this.openDeckDetail(editId);
    } else {
      this.showDeckList();
    }
  },

  // ---- Folder Browser ----
  async openFolderBrowser() {
    // Start from current folder input value, or home
    const currentVal = document.getElementById('input-deck-folder').value.trim();
    const startPath = currentVal || undefined; // undefined = server defaults to home
    await this.browseTo(startPath);
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
      // If path fails, fall back to home
      if (folderPath) {
        await this.browseTo(undefined);
      }
    }
  },

  renderFolderBrowser(data) {
    // Update breadcrumb
    document.getElementById('folder-browser-path').textContent = data.current;
    document.getElementById('folder-browser-img-count').textContent =
      data.imageCount > 0 ? `${data.imageCount} images here` : 'No images here';

    // Show/hide parent button
    const upBtn = document.getElementById('folder-browser-up');
    if (data.current !== data.parent) {
      upBtn.classList.remove('hidden');
    } else {
      upBtn.classList.add('hidden');
    }

    // Render directory list
    const listEl = document.getElementById('folder-browser-list');
    const emptyEl = document.getElementById('folder-browser-empty');

    if (data.dirs.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
      listEl.innerHTML = data.dirs.map(dir => `
        <div class="folder-item" data-path="${this._esc(data.current + '/' + dir)}">
          \uD83D\uDCC2 <span>${this._esc(dir)}</span>
        </div>
      `).join('');

      // Bind click to navigate into each folder
      listEl.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', () => {
          this.browseTo(item.dataset.path);
        });
      });
    }
  },

  browseFolderUp() {
    if (!this.folderBrowserCurrentPath) return;
    // Navigate to parent
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
  },

  // ---- Helpers ----
  _esc(str) {
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

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
});
