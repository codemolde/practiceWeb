const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const appJsCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// ============================================================================
// CHILD PROCESS WORKER CODE (Executed when CHILD_TZ_WORKER is set in spawn env)
// ============================================================================
if (process.env.CHILD_TZ_WORKER) {
  const server = require('../server.js');

  function setupAppEnvironment(mockNow) {
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(mockNow.getTime());
        else super(...args);
      }
      static now() {
        return mockNow.getTime();
      }
    }

    const mockStorageData = {
      decks: [{ id: 'deck1', name: 'Gesture Deck', newLimit: 20, reviewLimit: 1 }],
      cards: { deck1: {} },
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
      navigator: { userAgent: 'test' },
      location: { search: '' },
      console,
      setTimeout,
      clearTimeout,
      Date: MockDate
    };

    context.window.document = context.document;
    context.window.location = context.location;
    context.window.navigator = context.navigator;

    vm.createContext(context);
    const exported = vm.runInContext(
      appJsCode + '\n;({ localDateStr, ReviewHistory, CardManager, DeckManager, UI, Storage })',
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
      MockDate,
      mockStorageData
    };
  }

  // Verifies the 5 operations required by the test suite
  function verifyScenario({
    label,
    targetDate,
    expectedLocalDate,
    prevLocalDate,
    nextLocalDate,
    reflowOffsets
  }) {
    const env = setupAppEnvironment(targetDate);
    const { localDateStr, ReviewHistory, CardManager, DeckManager, UI } = env;

    // 1. localDateStr formats to local calendar day
    const localStr = localDateStr();
    assert.equal(
      localStr,
      expectedLocalDate,
      `[${label}] localDateStr must return local calendar day ${expectedLocalDate}`
    );

    // 2. A review lands on one history key
    ReviewHistory.history = {};
    CardManager.cards = { deck1: { c1: { id: 'c1', difficulty: 'good' } } };
    ReviewHistory.record('deck1', false);

    const historyDeckKeys = Object.keys(ReviewHistory.history.deck1 || {});
    assert.equal(
      historyDeckKeys.length,
      1,
      `[${label}] Review must land on exactly ONE history key, got: ${historyDeckKeys.join(', ')}`
    );
    assert.equal(
      historyDeckKeys[0],
      expectedLocalDate,
      `[${label}] Review history key must match local date ${expectedLocalDate}`
    );
    assert.equal(
      ReviewHistory.getCounts('deck1', expectedLocalDate).total,
      1,
      `[${label}] Total review count for ${expectedLocalDate} must be 1`
    );

    // 3. Streak continues across midnight
    // If user reviewed yesterday at prevLocalDate and has not reviewed today yet:
    ReviewHistory.history = {
      deck1: {
        [prevLocalDate]: { new: 0, review: 1, total: 1 }
      }
    };
    assert.equal(
      UI._currentStreak(),
      1,
      `[${label}] Streak continues across midnight before today's review (streak=1 from ${prevLocalDate})`
    );

    // Reviewing on today (expectedLocalDate) advances streak to 2
    ReviewHistory.record('deck1', false);
    assert.equal(
      UI._currentStreak(),
      2,
      `[${label}] Streak increments to 2 after review on ${expectedLocalDate}`
    );

    // 4. Due-today comparison correct
    CardManager.cards = {
      deck1: {
        dueToday: {
          id: 'dueToday',
          imageName: 'pose1.jpg',
          difficulty: 'medium',
          dueDate: expectedLocalDate
        },
        dueTomorrow: {
          id: 'dueTomorrow',
          imageName: 'pose2.jpg',
          difficulty: 'medium',
          dueDate: nextLocalDate
        }
      }
    };

    const dueCards = CardManager.getDueCards('deck1', null, false);
    assert.equal(
      dueCards.length,
      1,
      `[${label}] Only cards due on or before local today (${expectedLocalDate}) are due`
    );
    assert.equal(dueCards[0].id, 'dueToday', `[${label}] dueToday card is due`);

    // Rating 'again' (interval = 0) stays due on expectedLocalDate
    CardManager.rateCard('deck1', 'dueToday', 'pose1.jpg', 'again', 30);
    assert.equal(
      CardManager.getCard('deck1', 'dueToday').dueDate,
      expectedLocalDate,
      `[${label}] 'again' rating card remains due on local today`
    );
    assert.equal(
      CardManager.getCard('deck1', 'dueToday').lastReviewDate,
      expectedLocalDate,
      `[${label}] lastReviewDate is local date`
    );

    // Rating 'hard' on new card (interval = 1) is due on nextLocalDate
    CardManager.rateCard('deck1', 'newCard', 'pose3.jpg', 'hard', 30);
    assert.equal(
      CardManager.getCard('deck1', 'newCard').dueDate,
      nextLocalDate,
      `[${label}] 'hard' rating on new card is due on next local day (${nextLocalDate})`
    );
    assert.equal(
      CardManager.getCard('deck1', 'newCard').lastReviewDate,
      expectedLocalDate,
      `[${label}] lastReviewDate is local date`
    );

    // 5. Reflow due dates correct
    // Deck reviewLimit = 1; populate with 3 due cards so 2 excess cards get reflowed
    CardManager.cards = {
      deck1: {
        cardA: { id: 'cardA', imageName: 'pA.jpg', difficulty: 'good', dueDate: expectedLocalDate },
        cardB: { id: 'cardB', imageName: 'pB.jpg', difficulty: 'good', dueDate: expectedLocalDate },
        cardC: { id: 'cardC', imageName: 'pC.jpg', difficulty: 'good', dueDate: expectedLocalDate }
      }
    };
    DeckManager.decks[0].reviewLimit = 1;
    DeckManager.decks[0].lastReflowDate = null;

    const reflowResult = CardManager.reflowOverdueBacklog('deck1');
    assert.equal(reflowResult.reflowedCount, 2, `[${label}] Reflowed 2 excess overdue cards`);
    assert.equal(reflowResult.retainedToday, 1, `[${label}] Retained 1 card today`);

    // Retained card remains due on expectedLocalDate
    assert.equal(
      CardManager.getCard('deck1', 'cardA').dueDate,
      expectedLocalDate,
      `[${label}] Retained card remains due today (${expectedLocalDate})`
    );

    // Excess cards spread to +1 day and +2 days
    const cardBDue = CardManager.getCard('deck1', 'cardB').dueDate;
    const cardCDue = CardManager.getCard('deck1', 'cardC').dueDate;
    assert.equal(
      cardBDue,
      reflowOffsets[0],
      `[${label}] Excess card B is reflowed to ${reflowOffsets[0]}`
    );
    assert.equal(
      cardCDue,
      reflowOffsets[1],
      `[${label}] Excess card C is reflowed to ${reflowOffsets[1]}`
    );

    // 6. Backup filename date correct
    const backupDate = server.getLocalDateString(targetDate);
    assert.equal(
      backupDate,
      expectedLocalDate,
      `[${label}] Backup filename date must match local calendar date ${expectedLocalDate}`
    );
    assert.equal(
      `srs_state_${backupDate}.json`,
      `srs_state_${expectedLocalDate}.json`,
      `[${label}] Daily snapshot filename is srs_state_${expectedLocalDate}.json`
    );
  }

  const workerMode = process.env.CHILD_TZ_WORKER;
  if (workerMode === 'la') {
    const intlTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.equal(intlTz, 'America/Los_Angeles', 'Child process runtime has TZ=America/Los_Angeles');

    // Scenario 1: Oct 31, 2026 at 23:30 PDT (Before DST ends, offset = 420 min / UTC-7)
    // UTC is Nov 01, 2026 06:30.
    verifyScenario({
      label: 'LA 2026-10-31 23:30 PDT',
      targetDate: new Date(2026, 9, 31, 23, 30, 0),
      expectedLocalDate: '2026-10-31',
      prevLocalDate: '2026-10-30',
      nextLocalDate: '2026-11-01',
      reflowOffsets: ['2026-11-01', '2026-11-02']
    });

    // Scenario 2: Nov 01, 2026 at 00:30 PDT (DST transition day morning, offset = 420 min)
    // UTC is Nov 01, 2026 07:30.
    verifyScenario({
      label: 'LA 2026-11-01 00:30 PDT (DST morning)',
      targetDate: new Date(2026, 10, 1, 0, 30, 0),
      expectedLocalDate: '2026-11-01',
      prevLocalDate: '2026-10-31',
      nextLocalDate: '2026-11-02',
      reflowOffsets: ['2026-11-02', '2026-11-03']
    });

    // Scenario 3: Nov 01, 2026 at 23:30 PST (DST transition day night, offset = 480 min / UTC-8)
    // Note: DST ended at 2:00 AM on Nov 1. Clock fell back from 2:00 AM PDT to 1:00 AM PST.
    // UTC is Nov 02, 2026 07:30.
    verifyScenario({
      label: 'LA 2026-11-01 23:30 PST (Post-DST fallback night)',
      targetDate: new Date(2026, 10, 1, 23, 30, 0),
      expectedLocalDate: '2026-11-01',
      prevLocalDate: '2026-10-31',
      nextLocalDate: '2026-11-02',
      reflowOffsets: ['2026-11-02', '2026-11-03']
    });

    // Scenario 4: Nov 02, 2026 at 00:30 PST (Standard time morning)
    // UTC is Nov 02, 2026 08:30.
    verifyScenario({
      label: 'LA 2026-11-02 00:30 PST',
      targetDate: new Date(2026, 10, 2, 0, 30, 0),
      expectedLocalDate: '2026-11-02',
      prevLocalDate: '2026-11-01',
      nextLocalDate: '2026-11-03',
      reflowOffsets: ['2026-11-03', '2026-11-04']
    });

    // Scenario 5: May 10, 2026 at 23:30 PDT (Summer non-DST boundary)
    verifyScenario({
      label: 'LA 2026-05-10 23:30 PDT',
      targetDate: new Date(2026, 4, 10, 23, 30, 0),
      expectedLocalDate: '2026-05-10',
      prevLocalDate: '2026-05-09',
      nextLocalDate: '2026-05-11',
      reflowOffsets: ['2026-05-11', '2026-05-12']
    });

    // Scenario 6: May 11, 2026 at 00:30 PDT (Summer non-DST boundary)
    verifyScenario({
      label: 'LA 2026-05-11 00:30 PDT',
      targetDate: new Date(2026, 4, 11, 0, 30, 0),
      expectedLocalDate: '2026-05-11',
      prevLocalDate: '2026-05-10',
      nextLocalDate: '2026-05-12',
      reflowOffsets: ['2026-05-12', '2026-05-13']
    });

    process.exit(0);
  } else if (workerMode === 'kolkata') {
    const intlTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.ok(
      intlTz === 'Asia/Kolkata' || intlTz === 'Asia/Calcutta',
      `Child process runtime has TZ=Asia/Kolkata (got ${intlTz})`
    );

    // Scenario 1: May 10, 2026 at 23:30 IST (UTC is May 10 18:00)
    verifyScenario({
      label: 'Kolkata 2026-05-10 23:30 IST',
      targetDate: new Date(2026, 4, 10, 23, 30, 0),
      expectedLocalDate: '2026-05-10',
      prevLocalDate: '2026-05-09',
      nextLocalDate: '2026-05-11',
      reflowOffsets: ['2026-05-11', '2026-05-12']
    });

    // Scenario 2: May 11, 2026 at 00:30 IST (UTC is May 10 19:00 - previous UTC day!)
    verifyScenario({
      label: 'Kolkata 2026-05-11 00:30 IST',
      targetDate: new Date(2026, 4, 11, 0, 30, 0),
      expectedLocalDate: '2026-05-11',
      prevLocalDate: '2026-05-10',
      nextLocalDate: '2026-05-12',
      reflowOffsets: ['2026-05-12', '2026-05-13']
    });

    // Scenario 3: Nov 01, 2026 at 23:30 IST (UTC is Nov 01 18:00)
    verifyScenario({
      label: 'Kolkata 2026-11-01 23:30 IST',
      targetDate: new Date(2026, 10, 1, 23, 30, 0),
      expectedLocalDate: '2026-11-01',
      prevLocalDate: '2026-10-31',
      nextLocalDate: '2026-11-02',
      reflowOffsets: ['2026-11-02', '2026-11-03']
    });

    // Scenario 4: Nov 02, 2026 at 00:30 IST (UTC is Nov 01 19:00 - previous UTC day!)
    verifyScenario({
      label: 'Kolkata 2026-11-02 00:30 IST',
      targetDate: new Date(2026, 10, 2, 0, 30, 0),
      expectedLocalDate: '2026-11-02',
      prevLocalDate: '2026-11-01',
      nextLocalDate: '2026-11-03',
      reflowOffsets: ['2026-11-03', '2026-11-04']
    });

    process.exit(0);
  }
}

// ============================================================================
// PARENT TEST RUNNER
// ============================================================================
test('Timezone Consistency & Local Date Handling in Child Processes', async (t) => {
  await t.test(
    '1. Child process with TZ=America/Los_Angeles: 23:30, 00:30 & DST change 2026-11-01 (AUTOMATED-RAN)',
    () => {
      const res = spawnSync(process.execPath, [__filename], {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          CHILD_TZ_WORKER: 'la',
          TZ: 'America/Los_Angeles'
        },
        encoding: 'utf8'
      });

      if (res.status !== 0) {
        console.error('Child STDOUT:\n', res.stdout);
        console.error('Child STDERR:\n', res.stderr);
      }
      assert.equal(res.status, 0, `Child process for America/Los_Angeles failed with exit code ${res.status}`);
    }
  );

  await t.test(
    '2. Child process with TZ=Asia/Kolkata: 23:30 and 00:30 local time (AUTOMATED-RAN)',
    () => {
      const res = spawnSync(process.execPath, [__filename], {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          CHILD_TZ_WORKER: 'kolkata',
          TZ: 'Asia/Kolkata'
        },
        encoding: 'utf8'
      });

      if (res.status !== 0) {
        console.error('Child STDOUT:\n', res.stdout);
        console.error('Child STDERR:\n', res.stderr);
      }
      assert.equal(res.status, 0, `Child process for Asia/Kolkata failed with exit code ${res.status}`);
    }
  );

  await t.test('3. Migration note check: existing stored keys remain untouched (MOCKED)', () => {
    const mockStorageData = {
      decks: [{ id: 'deck1', name: 'Gesture Deck', folderPath: '/gestures', newLimit: 20, reviewLimit: 200 }],
      cards: { deck1: {} },
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
      navigator: { userAgent: 'test' },
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
      appJsCode + '\n;({ localDateStr, ReviewHistory, CardManager, DeckManager, UI, Storage })',
      context
    );

    const { localDateStr, ReviewHistory, CardManager } = exported;

    // Existing historical data stored in YYYY-MM-DD
    ReviewHistory.history = {
      deck1: {
        '2025-01-15': { new: 5, review: 10, total: 15 }
      }
    };

    CardManager.cards = {
      deck1: {
        card_historical: {
          id: 'card_historical',
          imageName: 'old_pose.jpg',
          difficulty: 'medium',
          dueDate: '2025-01-20',
          lastReviewDate: '2025-01-15'
        }
      }
    };

    // Stored keys are preserved and can still be looked up
    assert.equal(ReviewHistory.getCounts('deck1', '2025-01-15').total, 15);
    const card = CardManager.getCard('deck1', 'card_historical');
    assert.equal(card.dueDate, '2025-01-20');
    assert.equal(card.lastReviewDate, '2025-01-15');

    // localDateStr parses and preserves YYYY-MM-DD input cleanly
    assert.equal(localDateStr('2025-01-20'), '2025-01-20');
  });
});
