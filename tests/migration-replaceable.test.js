const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isDestinationFileValid, migrateLegacyRepoUserdata } = require('../electron-main.js');

test('Migration: Replaceable empty destination state & pre-migration backup', async (t) => {
  const tmpDir = path.join(os.tmpdir(), 'migration_replaceable_test_' + Date.now());
  const legacyDir = path.join(tmpDir, 'legacy_userdata');
  const targetDir = path.join(tmpDir, 'electron_userdata');

  fs.mkdirSync(legacyDir, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const legacyStateFile = path.join(legacyDir, 'srs_state.json');
  const targetStateFile = path.join(targetDir, 'srs_state.json');
  const backupStateFile = path.join(targetDir, 'srs_state.json.pre-migration');

  // Populate legacy state with 2 decks and cards
  const legacyData = {
    version: 1,
    decks: [
      { id: 'deck_anatomy', name: 'Figure Anatomy', folderPath: '/ref/anatomy' },
      { id: 'deck_gestures', name: 'Gesture Studies', folderPath: '/ref/gestures' }
    ],
    cards: {
      deck_anatomy: {
        c1: { id: 'c1', interval: 5, easeFactor: 2.3, difficulty: 'medium' }
      }
    },
    history: {}
  };
  fs.writeFileSync(legacyStateFile, JSON.stringify(legacyData, null, 2), 'utf8');
  const legacyStat = fs.statSync(legacyStateFile);

  // Populate target state with empty state (0 decks and 0 cards)
  const emptyTargetData = {
    version: 1,
    decks: [],
    cards: {},
    history: {}
  };
  fs.writeFileSync(targetStateFile, JSON.stringify(emptyTargetData, null, 2), 'utf8');

  await t.test('1. isDestinationFileValid treats 0-deck 0-card destination as REPLACEABLE (returns false) when legacy has data', () => {
    const isValid = isDestinationFileValid(targetStateFile, legacyStat, legacyStateFile);
    assert.equal(isValid, false, 'Expected 0-deck 0-card destination to be marked invalid/replaceable');
  });

  await t.test('2. isDestinationFileValid treats destination as VALID (returns true) when destination has real data', () => {
    const populatedTargetFile = path.join(tmpDir, 'populated_dest.json');
    fs.writeFileSync(populatedTargetFile, JSON.stringify({
      decks: [{ id: 'existing_dest_deck', name: 'Dest Deck' }],
      cards: {}
    }), 'utf8');

    const isValid = isDestinationFileValid(populatedTargetFile, legacyStat, legacyStateFile);
    assert.equal(isValid, true, 'Destination with existing decks should not be replaced');
  });

  await t.test('3. isDestinationFileValid treats destination as VALID when both source and destination are empty', () => {
    const emptySourceFile = path.join(tmpDir, 'empty_source.json');
    fs.writeFileSync(emptySourceFile, JSON.stringify({ decks: [], cards: {} }), 'utf8');
    const emptySourceStat = fs.statSync(emptySourceFile);

    const isValid = isDestinationFileValid(targetStateFile, emptySourceStat, emptySourceFile);
    assert.equal(isValid, true, 'Destination should not be replaced if source also has 0 decks and 0 cards');
  });

  await t.test('4. migrateLegacyRepoUserdata replaces empty destination, creates srs_state.json.pre-migration, and copies legacy data', () => {
    assert.ok(fs.existsSync(targetStateFile), 'Target state file exists before migration');
    assert.ok(!fs.existsSync(backupStateFile), 'Pre-migration backup does not exist initially');

    const result = migrateLegacyRepoUserdata({
      legacyDir,
      targetDir,
      logger: {
        log: () => {},
        warn: () => {},
        error: () => {}
      }
    });

    assert.equal(result.success, true, 'Migration completed successfully');
    assert.ok(fs.existsSync(backupStateFile), 'srs_state.json.pre-migration was created');

    // Verify backup contains the replaced empty state
    const backupContent = JSON.parse(fs.readFileSync(backupStateFile, 'utf8'));
    assert.deepEqual(backupContent.decks, [], 'Backup has 0 decks');
    assert.deepEqual(backupContent.cards, {}, 'Backup has 0 cards');

    // Verify destination now contains the legacy data
    const migratedContent = JSON.parse(fs.readFileSync(targetStateFile, 'utf8'));
    assert.equal(migratedContent.decks.length, 2, 'Migrated state has 2 decks');
    assert.equal(migratedContent.decks[0].name, 'Figure Anatomy');
    assert.ok(migratedContent.cards.deck_anatomy.c1, 'Migrated state has cards');
  });

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });
});

