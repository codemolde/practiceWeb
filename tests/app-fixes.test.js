const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appJsCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function setupTestEnvironment() {
  const elements = new Map();

  function makeElement(id, tagName = 'div') {
    const classList = new Set();
    const listeners = {};
    const dataset = {};
    const style = {};
    const attributes = {};
    const children = [];
    let textContent = '';
    let innerHTML = '';

    const el = {
      id,
      tagName: tagName.toUpperCase(),
      dataset,
      style,
      title: '',
      setAttribute(k, v) { attributes[k] = String(v); },
      getAttribute(k) { return attributes[k] !== undefined ? attributes[k] : null; },
      get textContent() { return textContent; },
      set textContent(v) { textContent = String(v); },
      get innerHTML() { return innerHTML; },
      set innerHTML(v) { innerHTML = String(v); },
      classList: {
        add(...cls) { cls.forEach(c => classList.add(c)); },
        remove(...cls) { cls.forEach(c => classList.delete(c)); },
        contains(c) { return classList.has(c); },
        toggle(c, force) {
          if (force !== undefined) {
            if (force) classList.add(c);
            else classList.delete(c);
            return force;
          }
          if (classList.has(c)) {
            classList.delete(c);
            return false;
          } else {
            classList.add(c);
            return true;
          }
        }
      },
      addEventListener(event, fn) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
      },
      removeEventListener(event, fn) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(f => f !== fn);
      },
      dispatchEvent(event) {
        if (listeners[event.type]) {
          listeners[event.type].forEach(fn => fn(event));
        }
      },
      querySelector(sel) {
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          return children.find(ch => ch.classList && ch.classList.contains(cls)) || null;
        }
        return null;
      },
      querySelectorAll() { return []; },
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
      },
      appendChild(c) { children.push(c); return c; },
      removeChild(c) {
        const idx = children.indexOf(c);
        if (idx !== -1) children.splice(idx, 1);
        return c;
      }
    };
    elements.set(id, el);
    return el;
  }

  // Prepopulate standard elements used by app.js
  const docElements = [
    'today-due', 'today-practiced', 'today-streak', 'today-decks', 'today-strip',
    'deck-list', 'empty-state', 'view-session', 'modal-shortcuts', 'opacity-hud',
    'heatmap-grid', 'heatmap-months', 'session-rating-area', 'session-workspace',
    'session-pip-placeholder', 'btn-session-pip', 'svg-filters', 'crop-label-input',
    'session-focal-pill', 'session-image', 'timer-text', 'session-progress',
    'floating-heatmap-tooltip', 'todays-reviewed-count', 'todays-reviewed-summary',
    'stat-total', 'stat-due', 'stat-reviewed', 'stat-new', 'btn-new-count', 'btn-review-count',
    'btn-study-new', 'btn-review', 'btn-free-study',
    'image-blur-overlay', 'btn-skip', 'btn-rating-toggle'
  ];
  docElements.forEach(id => makeElement(id));

  const btnRatingToggle = elements.get('btn-rating-toggle');
  if (btnRatingToggle) {
    const labelSpan = makeElement('rating-toggle-label-span', 'span');
    labelSpan.classList.add('rating-toggle-label');
    labelSpan.textContent = 'Rate';
    btnRatingToggle.appendChild(labelSpan);
  }

  const context = {
    window: {},
    document: {
      activeElement: null,
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector(sel) {
        if (sel.startsWith('#')) return elements.get(sel.slice(1)) || null;
        return null;
      },
      querySelectorAll() { return []; },
      createElement(tag) { return makeElement('dynamic_' + Math.random().toString(36).slice(2), tag); },
      addEventListener() { },
      removeEventListener() { },
      body: makeElement('body', 'body')
    },
    navigator: { userAgent: 'test-agent' },
    location: { search: '' },
    console,
    setTimeout,
    clearTimeout,
    Date: global.Date,
    AudioContext: class {
      constructor() { this.state = 'suspended'; this.destination = {}; }
      createOscillator() { return { type: 'sine', frequency: { setValueAtTime() { }, exponentialRampToValueAtTime() { } }, connect() { }, start() { }, stop() { } }; }
      createGain() { return { gain: { setValueAtTime() { }, exponentialRampToValueAtTime() { } }, connect() { } }; }
      resume() { this.state = 'running'; return Promise.resolve(); }
    }
  };

  context.window.document = context.document;
  context.window.location = context.location;
  context.window.navigator = context.navigator;
  context.window.AudioContext = context.AudioContext;

  vm.createContext(context);
  const exported = vm.runInContext(
    appJsCode + '\n;({ UI, PiPCanvasStreamer, TimerManager, CardManager, DeckManager, ReviewHistory, ArtistToolbox, SoundFX, SmartCropManager, localDateStr })',
    context
  );

  return { context, elements, ...exported };
}

// ==================== TEST B: KEYBOARD MODIFIER SHORTCUTS ====================
test('UI.handleKeyboard returns early when metaKey, ctrlKey, or altKey is pressed (Cmd+V does not trigger V) (MOCKED)', () => {
  const env = setupTestEnvironment();
  const { UI, context } = env;

  let triggeredHotkey = null;
  UI.triggerHotkeyFeedback = function (btnId) {
    triggeredHotkey = btnId;
  };

  // Ensure session view is active
  const sessionView = context.document.getElementById('view-session');
  sessionView.classList.add('active');

  let rated = null;
  UI.rateCurrentImage = function (rating) {
    rated = rating;
  };

  // Normal press '1' triggers rating 'again'
  UI.handleKeyboard({ key: '1', preventDefault() { }, stopPropagation() { } });
  assert.equal(rated, 'again');
  assert.equal(triggeredHotkey, 'btn-rate-again');

  // Reset
  rated = null;
  triggeredHotkey = null;

  // Press '1' with metaKey (Cmd+1) -> MUST RETURN EARLY
  UI.handleKeyboard({ key: '1', metaKey: true, preventDefault() { }, stopPropagation() { } });
  assert.equal(rated, null, 'Cmd+1 must not trigger rating');
  assert.equal(triggeredHotkey, null, 'Cmd+1 must not trigger hotkey feedback');

  // Press '1' with ctrlKey (Ctrl+1) -> MUST RETURN EARLY
  UI.handleKeyboard({ key: '1', ctrlKey: true, preventDefault() { }, stopPropagation() { } });
  assert.equal(rated, null, 'Ctrl+1 must not trigger rating');

  // Press '1' with altKey (Alt+1) -> MUST RETURN EARLY
  UI.handleKeyboard({ key: '1', altKey: true, preventDefault() { }, stopPropagation() { } });
  assert.equal(rated, null, 'Alt+1 must not trigger rating');

  // Test hotkey 'v' with metaKey (Cmd+V paste) -> MUST RETURN EARLY
  let flipCalled = false;
  env.ArtistToolbox.flipHorizontal = function () {
    flipCalled = true;
  };
  UI.handleKeyboard({ key: 'v', metaKey: true, preventDefault() { }, stopPropagation() { } });
  assert.equal(flipCalled, false, 'Cmd+V must return early and not trigger any action');

  UI.handleKeyboard({ key: 'v', ctrlKey: true, preventDefault() { }, stopPropagation() { } });
  assert.equal(flipCalled, false, 'Ctrl+V must return early and not trigger any action');

  // Hotkey 'u' (plumb or sound toggle) with metaKey -> MUST RETURN EARLY
  let soundToggleCalled = false;
  env.SoundFX.toggle = function () { soundToggleCalled = true; };
  sessionView.classList.remove('active');
  UI.handleKeyboard({ key: 'u', metaKey: true, preventDefault() { }, stopPropagation() { } });
  assert.equal(soundToggleCalled, false, 'Cmd+U outside session must return early');
});

// ==================== TEST D: PIPCANVASSTREAMER TIMER CALL & LEGEND ====================
test('PiPCanvasStreamer.render calls TimerManager.isRunning() as a method and draws updated SRS legend (MOCKED)', () => {
  const env = setupTestEnvironment();
  const { PiPCanvasStreamer, TimerManager, UI } = env;

  const filledTexts = [];
  const fillRects = [];

  const mockCtx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect(x, y, w, h) {
      fillRects.push({ x, y, w, h, fillStyle: this.fillStyle });
    },
    beginPath() { },
    rect() { },
    fill() { },
    stroke() { },
    save() { },
    restore() { },
    clip() { },
    translate() { },
    scale() { },
    rotate() { },
    drawImage() { },
    setLineDash() { },
    moveTo() { },
    lineTo() { },
    fillText(text, x, y) {
      filledTexts.push({ text, x, y, fillStyle: this.fillStyle });
    }
  };

  PiPCanvasStreamer.canvas = { width: 400, height: 300 };
  PiPCanvasStreamer.ctx = mockCtx;

  UI.getTimerDuration = () => 60;
  TimerManager.remaining = 30;

  let isRunningCalledCount = 0;
  let runningValue = false;
  TimerManager.isRunning = function () {
    isRunningCalledCount++;
    return runningValue;
  };

  // Case 1: TimerManager.isRunning() returns false -> timer bar not drawn
  fillRects.length = 0;
  filledTexts.length = 0;
  runningValue = false;
  PiPCanvasStreamer.render();

  assert.equal(isRunningCalledCount, 1, 'TimerManager.isRunning() method was called');
  // Top timer bar is at y: 12 with height: 5
  const timerBarWhenStopped = fillRects.find(r => r.y === 12 && r.h === 5);
  assert.equal(timerBarWhenStopped, undefined, 'Timer bar must not be drawn when TimerManager.isRunning() is false');

  // Case 2: TimerManager.isRunning() returns true -> timer bar IS drawn
  fillRects.length = 0;
  filledTexts.length = 0;
  runningValue = true;
  PiPCanvasStreamer.render();

  assert.equal(isRunningCalledCount, 2, 'TimerManager.isRunning() method was called again');
  const timerBarWhenRunning = fillRects.find(r => r.y === 12 && r.h === 5 && r.fillStyle === '#58a6ff');
  assert.ok(timerBarWhenRunning, 'Timer bar should be drawn when running');

  // Check legend texts in filledTexts:
  // Must render: '1 Again', '2 Hard', '3 Good', '4 Easy'
  const textStrings = filledTexts.map(f => f.text);
  assert.ok(textStrings.includes('1 Again'), 'Legend must include 1 Again');
  assert.ok(textStrings.includes('2 Hard'), 'Legend must include 2 Hard');
  assert.ok(textStrings.includes('3 Good'), 'Legend must include 3 Good');
  assert.ok(textStrings.includes('4 Easy'), 'Legend must include 4 Easy');

  // Must NOT include legacy texts
  assert.ok(!textStrings.includes('1 Hard'), 'Legend must not include legacy 1 Hard');
  assert.ok(!textStrings.includes('2 Med'), 'Legend must not include legacy 2 Med');
  assert.ok(!textStrings.includes('3 Easy'), 'Legend must not include legacy 3 Easy');
  assert.ok(!textStrings.includes('S Skip'), 'Legend must not include legacy S Skip');
});

// ==================== TEST E: CHILD CARDS WITHOUT DIFFICULTY NOT COUNTED AS DUE ====================
test('Child cards created by createChildCard (difficulty: null) are not counted as due or reviewed (MOCKED)', () => {
  const env = setupTestEnvironment();
  const { CardManager, DeckManager, UI, localDateStr, context } = env;

  // Initialize fresh managers
  DeckManager.init();
  CardManager.init();

  const deck = DeckManager.create('Gesture Deck', '/gestures', 20, 200);
  const deckId = deck.id;

  const parentImage = {
    id: 'parent_img_1',
    hash: 'hash_abc123',
    name: 'gesture_pose_1.jpg',
    path: '/gestures/gesture_pose_1.jpg'
  };

  // Create child card using createChildCard
  const child = CardManager.createChildCard(
    deckId,
    parentImage,
    { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    'Torso Focus',
    ['anatomy']
  );

  assert.ok(child, 'Child card was created');
  assert.equal(child.difficulty, null, 'Child card initial difficulty is null');
  assert.equal(child.dueDate, localDateStr(), 'Child card dueDate is today');

  // 1. renderTodayStrip check
  UI.renderTodayStrip();
  const todayDueEl = context.document.getElementById('today-due');
  assert.equal(todayDueEl.textContent, '0', 'renderTodayStrip must count 0 due cards when cards have difficulty: null');

  // 2. renderDeckList check
  UI.renderDeckList();
  const deckListEl = context.document.getElementById('deck-list');
  assert.ok(deckListEl.innerHTML.includes('0 due'), 'renderDeckList must render "0 due" for child cards without difficulty');
  assert.ok(deckListEl.innerHTML.includes('0 mastered') || deckListEl.innerHTML.includes('0 studied'),
    'renderDeckList must count 0 mastered/studied, not Object.keys(deckCards).length');

  // 3. renderHeatmap check
  UI.currentDeckId = deckId;
  // Even if child card's dueDate is set to future date, without difficulty it must not count in futureData
  child.dueDate = '2099-01-01';
  UI.renderHeatmap();
  const gridEl = context.document.getElementById('heatmap-grid');
  // None of the future cells should have "1 scheduled" from this card
  assert.ok(!gridEl.innerHTML.includes('2099-01-01: 1 scheduled'), 'renderHeatmap must not count cards without difficulty');

  // 4. Now add a studied parent card with a real difficulty
  CardManager.cards[deckId]['card_studied_1'] = {
    imageId: 'card_studied_1',
    dueDate: localDateStr(),
    difficulty: 'good',
    interval: 3,
    easeFactor: 2.5
  };

  UI.renderTodayStrip();
  assert.equal(todayDueEl.textContent, '1', 'renderTodayStrip counts 1 due card after adding studied card');

  UI.renderDeckList();
  assert.ok(deckListEl.innerHTML.includes('1 due'), 'renderDeckList reports 1 due');
  assert.ok(deckListEl.innerHTML.includes('1 mastered'), 'renderDeckList reports 1 mastered');
});

// ==================== TEST E: RATING DOCK HIDE/SHOW TOGGLE AFTER TIMER ENDS ====================
test('UI.showBlurOverlay opens rating dock with Hide label, and toggleRatingDock toggles collapsed/open state even when rating-required is active (MOCKED)', () => {
  const env = setupTestEnvironment();
  const { UI, context, elements } = env;

  const ratingArea = elements.get('session-rating-area');
  const toggleBtn = elements.get('btn-rating-toggle');
  const labelSpan = toggleBtn.querySelector('.rating-toggle-label');
  const body = context.document.body;

  // Initially closed
  assert.equal(ratingArea.classList.contains('rating-open'), false);
  assert.equal(body.classList.contains('rating-required'), false);

  // 1. Timer completes: showBlurOverlay is called
  UI.showBlurOverlay();
  assert.equal(body.classList.contains('rating-required'), true, 'rating-required added to body');
  assert.equal(ratingArea.classList.contains('rating-open'), true, 'rating dock receives rating-open class');
  assert.equal(labelSpan.textContent, 'Hide', 'Toggle label shows Hide');
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true');

  // 2. User clicks "Hide" tab while rating-required is active
  UI.toggleRatingDock();
  assert.equal(body.classList.contains('rating-required'), true, 'body still has rating-required');
  assert.equal(ratingArea.classList.contains('rating-open'), false, 'rating dock can be collapsed (rating-open removed)');
  assert.equal(labelSpan.textContent, 'Rate', 'Toggle label changes to Rate');
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false');

  // 3. User clicks "Rate" tab to expand the dock again
  UI.toggleRatingDock();
  assert.equal(ratingArea.classList.contains('rating-open'), true, 'rating dock re-opens');
  assert.equal(labelSpan.textContent, 'Hide', 'Toggle label changes back to Hide');

  // 4. Rating completed: clearBlurOverlay is called
  UI.clearBlurOverlay();
  assert.equal(body.classList.contains('rating-required'), false, 'rating-required removed');
  assert.equal(ratingArea.classList.contains('rating-open'), false, 'rating dock closed after clearBlurOverlay');
  assert.equal(labelSpan.textContent, 'Rate');

  // 5. Verify CSS rules in public/style.css: ensure body.rating-required does NOT unconditionally lock the dock open in studio mode
  const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
  assert.ok(
    !css.includes(':not(.electron-float-active).rating-required .rating-area') &&
    !css.includes('body.rating-required .rating-area .rating-arrow-icon'),
    'style.css must not contain unconditional body:not(...).rating-required .rating-area rule locking translateY(0)'
  );
  assert.ok(
    css.includes('.rating-area.rating-open') &&
    css.includes('.rating-area.rating-open .rating-arrow-icon'),
    'style.css must scope open rating dock transform and arrow icon rotation to .rating-open'
  );
});
