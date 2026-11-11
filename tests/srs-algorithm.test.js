const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appJsCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function setupSrsEnvironment() {
  const mockStorageData = {
    decks: [{ id: 'deck_srs', name: 'SRS Testing Deck', folderPath: '/test/srs' }],
    cards: { deck_srs: {} },
    history: {}
  };

  const context = {
    window: {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    navigator: { userAgent: 'test-srs' },
    location: { search: '' },
    console,
    setTimeout,
    clearTimeout,
    Date: global.Date
  };

  context.window.document = context.document;
  context.window.location = context.location;
  context.window.navigator = context.navigator;

  vm.createContext(context);
  const exported = vm.runInContext(
    appJsCode + '\n;({ localDateStr, ReviewHistory, CardManager, DeckManager, Storage })',
    context
  );

  exported.Storage.getDecks = () => mockStorageData.decks;
  exported.Storage.saveDecks = (d) => { mockStorageData.decks = d; };
  exported.Storage.getCards = () => mockStorageData.cards;
  exported.Storage.saveCards = (c) => { mockStorageData.cards = c; };
  exported.Storage.getHistory = () => mockStorageData.history;
  exported.Storage.saveHistory = (h) => { mockStorageData.history = h; };
  exported.Storage.syncToDisk = async () => ({ success: true });

  exported.DeckManager.decks = mockStorageData.decks;
  exported.CardManager.cards = mockStorageData.cards;
  exported.ReviewHistory.history = mockStorageData.history;

  return {
    ...exported,
    mockStorageData
  };
}

test('Spaced Repetition (SRS) Algorithm & Interval Verification', async (t) => {
  await t.test('1. rateCard across again / hard / medium / easy for new cards', () => {
    const { CardManager } = setupSrsEnvironment();

    // New card: Again
    const cardAgain = CardManager.rateCard('deck_srs', 'img_new_again', 'img_new_again.png', 'again', 60);
    assert.equal(cardAgain.interval, 0, 'New card again resets interval to 0');
    assert.equal(cardAgain.lapses, 1, 'New card again records 1 lapse');
    assert.equal(cardAgain.consecutiveSuccesses, 0);
    assert.equal(cardAgain.reviewCount, 1);

    // New card: Hard
    const cardHard = CardManager.rateCard('deck_srs', 'img_new_hard', 'img_new_hard.png', 'hard', 60);
    assert.equal(cardHard.interval, 1, 'New card hard sets interval to 1');
    assert.equal(cardHard.easeFactor, 1.5, 'New card hard sets initial ease to 1.5');
    assert.equal(cardHard.consecutiveSuccesses, 0);
    assert.equal(cardHard.reviewCount, 1);

    // New card: Medium (Good)
    const cardMed = CardManager.rateCard('deck_srs', 'img_new_med', 'img_new_med.png', 'medium', 60);
    assert.equal(cardMed.interval, 3, 'New card medium sets interval to 3');
    assert.equal(cardMed.easeFactor, 1.8, 'New card medium sets initial ease to 1.8');
    assert.equal(cardMed.consecutiveSuccesses, 1);
    assert.equal(cardMed.reviewCount, 1);

    // New card: Easy (standard timer > 45s)
    const cardEasy = CardManager.rateCard('deck_srs', 'img_new_easy', 'img_new_easy.png', 'easy', 60);
    assert.equal(cardEasy.interval, 7, 'New card easy with 60s sets interval to 7');
    assert.equal(cardEasy.easeFactor, 2.0, 'New card easy sets initial ease to 2.0');
    assert.equal(cardEasy.consecutiveSuccesses, 1);
    assert.equal(cardEasy.reviewCount, 1);
  });

  await t.test('2. rateCard across again / hard / medium / easy for review cards', () => {
    const { CardManager } = setupSrsEnvironment();

    // Seed existing review card with interval 10 and ease 2.2
    CardManager.cards['deck_srs']['img_rev'] = {
      imageId: 'img_rev',
      imageName: 'img_rev.png',
      difficulty: 'medium',
      interval: 10,
      easeFactor: 2.2,
      consecutiveSuccesses: 3,
      reviewCount: 3,
      lapses: 0
    };

    // Review card: Hard -> halves previous interval (Math.round(10 * 0.5) = 5)
    const hardResult = CardManager.rateCard('deck_srs', 'img_rev', 'img_rev.png', 'hard', 60);
    assert.equal(hardResult.interval, 5, 'Hard halves interval from 10 to 5');
    assert.equal(hardResult.easeFactor, 2.05, 'Hard drops ease by 0.15 (2.2 - 0.15 = 2.05)');
    assert.equal(hardResult.consecutiveSuccesses, 0, 'Hard resets consecutive successes to 0');
    assert.equal(hardResult.reviewCount, 4);

    // Hard on interval 5 -> Math.round(5 * 0.5) = 3
    const hardResult2 = CardManager.rateCard('deck_srs', 'img_rev', 'img_rev.png', 'hard', 60);
    assert.equal(hardResult2.interval, 3, 'Hard halves interval from 5 to 3');

    // Hard on interval 1 -> Math.max(1, Math.round(1 * 0.5)) = 1
    hardResult2.interval = 1;
    const hardResult3 = CardManager.rateCard('deck_srs', 'img_rev', 'img_rev.png', 'hard', 60);
    assert.equal(hardResult3.interval, 1, 'Hard never drops interval below 1');

    // Review card: Medium -> expands interval by easeFactor
    CardManager.cards['deck_srs']['img_rev2'] = {
      imageId: 'img_rev2',
      imageName: 'img_rev2.png',
      difficulty: 'medium',
      interval: 6,
      easeFactor: 2.0,
      consecutiveSuccesses: 1,
      reviewCount: 2
    };
    const medResult = CardManager.rateCard('deck_srs', 'img_rev2', 'img_rev2.png', 'medium', 60);
    assert.equal(medResult.interval, 12, 'Medium scales interval: Math.round(6 * 2.0) = 12');
    assert.equal(medResult.consecutiveSuccesses, 2);

    // Review card: Again -> resets interval to 0, increments lapses
    const againResult = CardManager.rateCard('deck_srs', 'img_rev2', 'img_rev2.png', 'again', 60);
    assert.equal(againResult.interval, 0, 'Again resets interval to 0');
    assert.equal(againResult.lapses, 1, 'Again increments lapses');
    assert.equal(againResult.consecutiveSuccesses, 0, 'Again resets consecutive successes');

    // Review card: Easy -> scales interval by easeFactor * 1.3
    CardManager.cards['deck_srs']['img_rev3'] = {
      imageId: 'img_rev3',
      imageName: 'img_rev3.png',
      difficulty: 'medium',
      interval: 10,
      easeFactor: 2.0,
      consecutiveSuccesses: 2,
      reviewCount: 3
    };
    const easyResult = CardManager.rateCard('deck_srs', 'img_rev3', 'img_rev3.png', 'easy', 60);
    // 10 * 2.0 * 1.3 = 26
    assert.equal(easyResult.interval, 26, 'Easy scales interval by prevEase * 1.3');
    assert.equal(easyResult.easeFactor, 2.1, 'Easy adds 0.10 to easeFactor');
  });

  await t.test('3. Repeated Good (medium) converges toward 2.3 target ease from below and from above', () => {
    const { CardManager } = setupSrsEnvironment();

    // A. Start from low ease 1.5: verify it converges up to 2.3
    CardManager.cards['deck_srs']['card_low'] = {
      imageId: 'card_low',
      imageName: 'card_low.png',
      difficulty: 'medium',
      interval: 2,
      easeFactor: 1.5,
      consecutiveSuccesses: 1,
      reviewCount: 2
    };

    let prevEase = 1.5;
    for (let i = 0; i < 40; i++) {
      const res = CardManager.rateCard('deck_srs', 'card_low', 'card_low.png', 'medium', 60);
      assert.ok(res.easeFactor >= prevEase, `Ease factor should monotonically increase (was ${prevEase}, now ${res.easeFactor})`);
      assert.ok(res.easeFactor <= 2.3, `Ease factor should not overshoot 2.3 (now ${res.easeFactor})`);
      prevEase = res.easeFactor;
    }
    assert.equal(prevEase, 2.3, 'Repeated Good starting from 1.5 successfully converged to 2.3');

    // B. Start from high ease 3.0: verify it converges down to 2.3
    CardManager.cards['deck_srs']['card_high'] = {
      imageId: 'card_high',
      imageName: 'card_high.png',
      difficulty: 'medium',
      interval: 2,
      easeFactor: 3.0,
      consecutiveSuccesses: 1,
      reviewCount: 2
    };

    prevEase = 3.0;
    for (let i = 0; i < 40; i++) {
      const res = CardManager.rateCard('deck_srs', 'card_high', 'card_high.png', 'medium', 60);
      assert.ok(res.easeFactor <= prevEase, `Ease factor should monotonically decrease (was ${prevEase}, now ${res.easeFactor})`);
      assert.ok(res.easeFactor >= 2.3, `Ease factor should not undershoot 2.3 (now ${res.easeFactor})`);
      prevEase = res.easeFactor;
    }
    assert.equal(prevEase, 2.3, 'Repeated Good starting from 3.0 successfully converged to 2.3');
  });

  await t.test('4. Floor 1.5 and Ceiling 3.0 strict bounds', () => {
    const { CardManager } = setupSrsEnvironment();

    // Repeated Again ratings cannot drive ease below 1.5
    CardManager.cards['deck_srs']['card_floor'] = {
      imageId: 'card_floor',
      imageName: 'card_floor.png',
      difficulty: 'again',
      interval: 1,
      easeFactor: 1.6,
      consecutiveSuccesses: 0,
      reviewCount: 2
    };

    for (let i = 0; i < 10; i++) {
      const res = CardManager.rateCard('deck_srs', 'card_floor', 'card_floor.png', 'again', 60);
      assert.ok(res.easeFactor >= 1.5, `Ease factor ${res.easeFactor} must not drop below 1.5 floor`);
    }
    assert.equal(CardManager.cards['deck_srs']['card_floor'].easeFactor, 1.5, 'Capped exactly at 1.5 floor');

    // Repeated Hard ratings also cannot drive ease below 1.5
    for (let i = 0; i < 5; i++) {
      const res = CardManager.rateCard('deck_srs', 'card_floor', 'card_floor.png', 'hard', 60);
      assert.equal(res.easeFactor, 1.5, 'Hard also respects 1.5 floor');
    }

    // Repeated Easy ratings cannot push ease above 3.0
    CardManager.cards['deck_srs']['card_ceiling'] = {
      imageId: 'card_ceiling',
      imageName: 'card_ceiling.png',
      difficulty: 'easy',
      interval: 10,
      easeFactor: 2.85,
      consecutiveSuccesses: 2,
      reviewCount: 5
    };

    for (let i = 0; i < 10; i++) {
      const res = CardManager.rateCard('deck_srs', 'card_ceiling', 'card_ceiling.png', 'easy', 60);
      assert.ok(res.easeFactor <= 3.0, `Ease factor ${res.easeFactor} must not exceed 3.0 ceiling`);
    }
    assert.equal(CardManager.cards['deck_srs']['card_ceiling'].easeFactor, 3.0, 'Capped exactly at 3.0 ceiling');
  });

  await t.test('5. First-two-review Easy cap at <= 45s (timer-weighted gesture scaling)', () => {
    const { CardManager } = setupSrsEnvironment();

    // A. Review 0 (new card): Easy with studyDuration <= 45s caps interval at 4 days (normally 7)
    const newShortEasy = CardManager.rateCard('deck_srs', 'new_short_card', 'new_short_card.png', 'easy', 30);
    assert.equal(newShortEasy.interval, 4, 'New card with 30s timer is capped at 4 days instead of 7');

    const newLongEasy = CardManager.rateCard('deck_srs', 'new_long_card', 'new_long_card.png', 'easy', 60);
    assert.equal(newLongEasy.interval, 7, 'New card with 60s timer gets normal 7 day interval');

    // B. Review 1 (prevReviews = 1 < 2): Easy with studyDuration <= 45s caps interval at <= 4 days
    CardManager.cards['deck_srs']['rev1_card'] = {
      imageId: 'rev1_card',
      imageName: 'rev1_card.png',
      difficulty: 'medium',
      interval: 3,
      easeFactor: 2.0,
      consecutiveSuccesses: 1,
      reviewCount: 1 // prevReviews = 1
    };
    // Math.max(3+2, Math.round(3 * 2.0 * 1.3)) = Math.round(7.8) = 8, but studyDuration <= 45 caps at 4
    const rev1Short = CardManager.rateCard('deck_srs', 'rev1_card', 'rev1_card.png', 'easy', 45);
    assert.equal(rev1Short.interval, 4, 'Review 1 with 45s timer capped at 4 days');

    // C. Review 2 (prevReviews = 2): NOT capped at 4 even if studyDuration <= 45s
    CardManager.cards['deck_srs']['rev2_card'] = {
      imageId: 'rev2_card',
      imageName: 'rev2_card.png',
      difficulty: 'medium',
      interval: 3,
      easeFactor: 2.0,
      consecutiveSuccesses: 2,
      reviewCount: 2 // prevReviews = 2
    };
    const rev2Short = CardManager.rateCard('deck_srs', 'rev2_card', 'rev2_card.png', 'easy', 30);
    assert.ok(rev2Short.interval > 4, `Review 2 with 30s timer is NOT capped at 4 (was ${rev2Short.interval})`);
    assert.equal(rev2Short.interval, 8, 'Review 2 receives full calculated interval (8)');
  });
});
