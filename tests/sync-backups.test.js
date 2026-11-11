const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const {
  app,
  startServer,
  STATE_FILE,
  USERDATA_DIR,
  BACKUPS_DIR,
  writeStateFile,
  ROTATION_WINDOW_MS,
  setRotationClock,
  resetRotationState,
  getLocalDateString,
  pruneDailySnapshots
} = require('../server.js');

function makeSyncRequest(port, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const dataStr = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/sync',
      method,
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(dataStr),
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          raw
        });
      });
    });

    req.on('error', reject);
    if (dataStr) req.write(dataStr);
    req.end();
  });
}

function cleanAllStateAndBackups() {
  resetRotationState();
  const filesToDelete = [
    STATE_FILE,
    `${STATE_FILE}.bak`,
    `${STATE_FILE}.bak1`,
    `${STATE_FILE}.bak2`,
    `${STATE_FILE}.bak3`,
    `${STATE_FILE}.bak4`,
    `${STATE_FILE}.bak5`,
    `${STATE_FILE}.bak6`
  ];
  for (const f of filesToDelete) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
  }
  if (fs.existsSync(BACKUPS_DIR)) {
    try {
      const items = fs.readdirSync(BACKUPS_DIR);
      for (const item of items) {
        try { fs.unlinkSync(path.join(BACKUPS_DIR, item)); } catch (e) {}
      }
    } catch (e) {}
  }
}

test('POST /api/sync safety and backup rotation', async (t) => {
  let serverInstance;
  let port;

  t.before(async () => {
    cleanAllStateAndBackups();
    const s = await startServer(0);
    serverInstance = s.server;
    port = s.port;
  });

  t.after(async () => {
    cleanAllStateAndBackups();
    if (serverInstance && typeof serverInstance.close === 'function') {
      serverInstance.close();
    }
  });

  await t.test('1. Empty payload rejected with 409 when state has data; confirmReplace:true writes (AUTOMATED-RAN)', async () => {
    cleanAllStateAndBackups();

    // Seed existing file with 1 deck and 1 card
    const seededState = {
      version: 1,
      lastSaved: new Date().toISOString(),
      decks: [{ id: 'deck_1', name: 'Anatomy' }],
      cards: { deck_1: { card_1: { id: 'card_1', name: 'Pelvis' } } },
      history: {}
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(seededState, null, 2), 'utf8');

    // Attempt to sync empty state (0 decks and 0 cards) without confirmReplace
    const emptyPayload = { decks: [], cards: {} };
    const resConflict = await makeSyncRequest(port, 'POST', emptyPayload);

    assert.equal(resConflict.statusCode, 409, 'Responds with HTTP 409 Conflict');
    assert.match(resConflict.body.error, /Conflict/, 'Error message clarifies conflict');

    // Verify disk content was NOT overwritten
    const currentOnDisk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    assert.equal(currentOnDisk.decks.length, 1, 'Existing deck was not deleted');
    assert.ok(currentOnDisk.cards.deck_1.card_1, 'Existing card was not deleted');

    // Retry with confirmReplace: true
    const resAllowed = await makeSyncRequest(port, 'POST', {
      decks: [],
      cards: {},
      confirmReplace: true
    });

    assert.equal(resAllowed.statusCode, 200, 'Allowed when confirmReplace: true is passed');
    const updatedOnDisk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    assert.equal(updatedOnDisk.decks.length, 0, 'State was safely replaced after confirmation');
  });

  await t.test('2. 6 writes keep 5 backups (bak1..bak5, no bak6) and daily snapshot (AUTOMATED-RAN)', async () => {
    cleanAllStateAndBackups();

    // Perform 6 sequential writes with forceRotation: true
    for (let i = 1; i <= 6; i++) {
      const payload = {
        decks: [{ id: `deck_${i}`, name: `Iteration ${i}` }],
        cards: { [`deck_${i}`]: { [`card_${i}`]: { id: `card_${i}` } } },
        forceRotation: true
      };
      const res = await makeSyncRequest(port, 'POST', payload);
      assert.equal(res.statusCode, 200, `Write ${i} succeeded`);
    }

    // Verify bak1 through bak5 exist, but bak6 does not
    assert.ok(fs.existsSync(`${STATE_FILE}.bak1`), 'srs_state.json.bak1 exists');
    assert.ok(fs.existsSync(`${STATE_FILE}.bak2`), 'srs_state.json.bak2 exists');
    assert.ok(fs.existsSync(`${STATE_FILE}.bak3`), 'srs_state.json.bak3 exists');
    assert.ok(fs.existsSync(`${STATE_FILE}.bak4`), 'srs_state.json.bak4 exists');
    assert.ok(fs.existsSync(`${STATE_FILE}.bak5`), 'srs_state.json.bak5 exists');
    assert.equal(fs.existsSync(`${STATE_FILE}.bak6`), false, 'srs_state.json.bak6 does NOT exist');

    // Verify contents of shifted backups
    // Write 6 is in primary STATE_FILE
    // Write 5 is in bak1, Write 4 in bak2, Write 3 in bak3, Write 2 in bak4, Write 1 in bak5
    const primaryState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    assert.equal(primaryState.decks[0].name, 'Iteration 6');

    const bak1State = JSON.parse(fs.readFileSync(`${STATE_FILE}.bak1`, 'utf8'));
    assert.equal(bak1State.decks[0].name, 'Iteration 5');

    const bak5State = JSON.parse(fs.readFileSync(`${STATE_FILE}.bak5`, 'utf8'));
    assert.equal(bak5State.decks[0].name, 'Iteration 1');

    // Verify daily snapshot was created in userdata/backups/
    const todayStr = getLocalDateString(new Date());
    const dailySnapshotPath = path.join(BACKUPS_DIR, `srs_state_${todayStr}.json`);
    assert.ok(fs.existsSync(dailySnapshotPath), 'Daily snapshot exists in userdata/backups/');
  });

  await t.test('3. Corrupt primary recovers from newest valid backup via GET /api/sync (AUTOMATED-RAN)', async () => {
    // Current state has bak1 with 'Iteration 5'
    // Intentionally corrupt the primary STATE_FILE with invalid JSON
    fs.writeFileSync(STATE_FILE, '{ invalid-json: [broken]', 'utf8');

    const res = await makeSyncRequest(port, 'GET');
    assert.equal(res.statusCode, 200, 'GET /api/sync recovers with HTTP 200');
    assert.equal(res.body.exists, true, 'Reports state exists');
    assert.ok(res.body.data, 'Returns valid data object');
    assert.equal(res.body.data.decks[0].name, 'Iteration 5', 'Recovered newest valid backup (bak1)');
  });

  await t.test('4. Atomic write survives simulated crash (kill between temp write and rename) (MOCKED)', async () => {
    cleanAllStateAndBackups();

    // 1. Establish initial valid state
    const originalState = {
      version: 1,
      lastSaved: '2026-11-10T00:00:00.000Z',
      decks: [{ id: 'survivor_deck', name: 'Survivor' }],
      cards: {},
      history: {}
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(originalState, null, 2), 'utf8');

    // 2. Intercept rename to simulate crash / process kill
    const origRename = fs.promises.rename;
    fs.promises.rename = async () => {
      throw new Error('SimulatedCrash: Process terminated before rename operation');
    };

    let writeFailed = false;
    try {
      await writeStateFile({
        version: 1,
        lastSaved: new Date().toISOString(),
        decks: [{ id: 'doomed_deck', name: 'Doomed' }],
        cards: {},
        history: {}
      });
    } catch (err) {
      writeFailed = true;
      assert.match(err.message, /SimulatedCrash/);
    } finally {
      fs.promises.rename = origRename; // restore original rename
    }

    assert.ok(writeFailed, 'Simulated crash threw as expected');

    // 3. Confirm primary STATE_FILE is 100% intact and uncorrupted
    const primaryOnDisk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    assert.equal(primaryOnDisk.decks[0].id, 'survivor_deck', 'Original state preserved without corruption');

    // 4. Confirm GET /api/sync returns survivor data
    const getRes = await makeSyncRequest(port, 'GET');
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.data.decks[0].id, 'survivor_deck');
  });

  await t.test('5. 10-minute rotation throttle with mocked clock & production default check (MOCKED)', async () => {
    // 1. Confirm production default is 10 minutes (600,000 ms), not 0
    assert.equal(ROTATION_WINDOW_MS, 10 * 60 * 1000, 'Production default rotation window is 10 minutes (600000ms), not 0');
    console.log(`[Config] Production default is set in server.js:480 as const ROTATION_WINDOW_MS = 10 * 60 * 1000 (${ROTATION_WINDOW_MS} ms)`);

    cleanAllStateAndBackups();
    resetRotationState();

    // 2. Setup injectable / mocked clock
    let simulatedNow = new Date('2026-11-10T12:00:00.000Z').getTime();
    setRotationClock(() => simulatedNow);

    try {
      // First write: creates initial STATE_FILE
      await writeStateFile({ decks: [{ id: 'd1', name: 'Write 1' }], cards: {} });
      assert.ok(fs.existsSync(STATE_FILE), 'Primary STATE_FILE created');
      assert.equal(fs.existsSync(`${STATE_FILE}.bak1`), false, 'No rotation on initial file creation');

      // Second write: 1 minute later (12:01:00) -> first rotation occurs (lastRotationTime was 0)
      simulatedNow += 1 * 60 * 1000;
      await writeStateFile({ decks: [{ id: 'd2', name: 'Write 2' }], cards: {} });
      assert.ok(fs.existsSync(`${STATE_FILE}.bak1`), 'First rotation occurred; bak1 created');
      const bak1First = JSON.parse(fs.readFileSync(`${STATE_FILE}.bak1`, 'utf8'));
      assert.equal(bak1First.decks[0].name, 'Write 1', 'bak1 contains Write 1');
      assert.equal(fs.existsSync(`${STATE_FILE}.bak2`), false, 'bak2 does not exist yet');

      // Third write: 4 minutes later (12:05:00, within 10 minutes of 12:01:00) -> THROTTLED!
      simulatedNow += 4 * 60 * 1000;
      await writeStateFile({ decks: [{ id: 'd3', name: 'Write 3' }], cards: {} });
      // Assert rotation did NOT occur: bak1 still has Write 1, bak2 does not exist
      assert.equal(fs.existsSync(`${STATE_FILE}.bak2`), false, 'bak2 does not exist (rotation was throttled)');
      const bak1Second = JSON.parse(fs.readFileSync(`${STATE_FILE}.bak1`, 'utf8'));
      assert.equal(bak1Second.decks[0].name, 'Write 1', 'Two writes within 10 minutes rotated exactly once; bak1 preserved Write 1');
      const primaryAfterThird = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      assert.equal(primaryAfterThird.decks[0].name, 'Write 3', 'Primary file updated to Write 3');

      // Fourth write: 11 minutes later (12:16:00, >10 minutes after last rotation at 12:01:00) -> ROTATES AGAIN!
      simulatedNow += 11 * 60 * 1000;
      await writeStateFile({ decks: [{ id: 'd4', name: 'Write 4' }], cards: {} });
      assert.ok(fs.existsSync(`${STATE_FILE}.bak2`), 'Write after 10 minutes rotates again; bak2 now exists');
      const bak1Third = JSON.parse(fs.readFileSync(`${STATE_FILE}.bak1`, 'utf8'));
      assert.equal(bak1Third.decks[0].name, 'Write 3', 'bak1 now contains Write 3');
      const bak2Third = JSON.parse(fs.readFileSync(`${STATE_FILE}.bak2`, 'utf8'));
      assert.equal(bak2Third.decks[0].name, 'Write 1', 'bak2 shifted and contains Write 1');
      assert.equal(fs.existsSync(`${STATE_FILE}.bak3`), false, 'bak3 does not exist');
    } finally {
      setRotationClock(null);
    }
  });

  await t.test('6. Daily snapshot in userdata/backups/, new state, LOCAL date & 7-day pruning (AUTOMATED-RAN)', async () => {
    cleanAllStateAndBackups();
    resetRotationState();

    // 1. Write new state and verify snapshot creation
    const testState = {
      version: 1,
      lastSaved: new Date().toISOString(),
      decks: [{ id: 'deck_snap', name: 'New State Daily Snapshot Content' }],
      cards: { deck_snap: { c1: { id: 'c1', name: 'Snapshot Card' } } }
    };
    await writeStateFile(testState);

    // 2. Verify snapshot path in userdata/backups/ and print absolute path
    const localToday = getLocalDateString(new Date());
    const expectedSnapshotPath = path.resolve(BACKUPS_DIR, `srs_state_${localToday}.json`);
    console.log('Daily snapshot absolute path:', expectedSnapshotPath);

    assert.ok(fs.existsSync(expectedSnapshotPath), `Daily snapshot exists at ${expectedSnapshotPath}`);
    assert.equal(path.dirname(expectedSnapshotPath), path.resolve(BACKUPS_DIR), 'Snapshot is written inside userdata/backups/');

    // 3. Confirm snapshot is taken from the NEW state
    const snapshotContent = JSON.parse(fs.readFileSync(expectedSnapshotPath, 'utf8'));
    assert.equal(snapshotContent.decks[0].name, 'New State Daily Snapshot Content', 'Snapshot was taken from new state');
    assert.ok(snapshotContent.cards.deck_snap.c1, 'Card from new state exists in snapshot');

    // 4. Confirm uses LOCAL date
    const d = new Date();
    const expectedLocalDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(localToday, expectedLocalDate, 'Snapshot uses LOCAL date format YYYY-MM-DD');
    assert.equal(path.basename(expectedSnapshotPath), `srs_state_${expectedLocalDate}.json`, 'Filename contains exact local date');

    // 5. Test pruning to 7 days
    if (fs.existsSync(BACKUPS_DIR)) {
      for (const f of fs.readdirSync(BACKUPS_DIR)) {
        try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); } catch (e) {}
      }
    }

    // Create 10 sequential daily snapshots: 2026-11-01 through 2026-11-10
    for (let day = 1; day <= 10; day++) {
      const dayStr = String(day).padStart(2, '0');
      const filename = `srs_state_2026-11-${dayStr}.json`;
      fs.writeFileSync(path.join(BACKUPS_DIR, filename), JSON.stringify({ day }), 'utf8');
    }

    const beforePruning = fs.readdirSync(BACKUPS_DIR).filter(f => /^srs_state_\d{4}-\d{2}-\d{2}\.json$/.test(f));
    assert.equal(beforePruning.length, 10, '10 daily snapshots present before pruning');

    // Execute pruneDailySnapshots with 7-day limit
    pruneDailySnapshots(BACKUPS_DIR, 7);

    const afterPruning = fs.readdirSync(BACKUPS_DIR)
      .filter(f => /^srs_state_\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();

    assert.equal(afterPruning.length, 7, 'Pruned down to exactly 7 daily snapshots');
    assert.equal(afterPruning[0], 'srs_state_2026-11-04.json', 'Oldest retained snapshot is 2026-11-04');
    assert.equal(afterPruning[6], 'srs_state_2026-11-10.json', 'Newest retained snapshot is 2026-11-10');
    assert.equal(fs.existsSync(path.join(BACKUPS_DIR, 'srs_state_2026-11-01.json')), false, '2026-11-01 was deleted');
    assert.equal(fs.existsSync(path.join(BACKUPS_DIR, 'srs_state_2026-11-02.json')), false, '2026-11-02 was deleted');
    assert.equal(fs.existsSync(path.join(BACKUPS_DIR, 'srs_state_2026-11-03.json')), false, '2026-11-03 was deleted');
  });

  await t.test('7. GET /api/sync fallback order: bak1..bak5, legacy .bak, then snapshots newest to oldest (AUTOMATED-RAN)', async () => {
    cleanAllStateAndBackups();
    resetRotationState();

    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    // 1. Primary STATE_FILE: corrupted JSON
    fs.writeFileSync(STATE_FILE, '{ corrupted primary JSON', 'utf8');

    // 2. Populate bak1..bak5
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(`${STATE_FILE}.bak${i}`, JSON.stringify({
        version: 1,
        lastSaved: `2026-11-10T0${i}:00:00.000Z`,
        decks: [{ id: `deck_bak${i}`, name: `Backup Level ${i}` }],
        cards: {}
      }), 'utf8');
    }

    // 3. Legacy srs_state.json.bak
    fs.writeFileSync(`${STATE_FILE}.bak`, JSON.stringify({
      version: 1,
      lastSaved: '2026-11-09T00:00:00.000Z',
      decks: [{ id: 'deck_legacy', name: 'Legacy Bak' }],
      cards: {}
    }), 'utf8');

    // 4. Daily snapshots: older (2026-11-01) and newer (2026-11-05)
    const olderSnapPath = path.join(BACKUPS_DIR, 'srs_state_2026-11-01.json');
    const newerSnapPath = path.join(BACKUPS_DIR, 'srs_state_2026-11-05.json');

    fs.writeFileSync(olderSnapPath, JSON.stringify({
      version: 1,
      lastSaved: '2026-11-01T00:00:00.000Z',
      decks: [{ id: 'deck_snap_old', name: 'Snapshot Older 2026-11-01' }],
      cards: {}
    }), 'utf8');

    fs.writeFileSync(newerSnapPath, JSON.stringify({
      version: 1,
      lastSaved: '2026-11-05T00:00:00.000Z',
      decks: [{ id: 'deck_snap_new', name: 'Snapshot Newer 2026-11-05' }],
      cards: {}
    }), 'utf8');

    // Test fallback through bak1..bak5 in sequential order
    for (let i = 1; i <= 5; i++) {
      const res = await makeSyncRequest(port, 'GET');
      assert.equal(res.statusCode, 200, `Fallback ${i} returns HTTP 200`);
      assert.equal(res.body.data.decks[0].name, `Backup Level ${i}`, `Recovers from bak${i}`);
      assert.equal(res.body.recoveredFrom, `srs_state.json.bak${i}`);

      // Corrupt bak{i} so the next request cascades down to bak{i+1}
      fs.writeFileSync(`${STATE_FILE}.bak${i}`, '{ corrupted bak' + i, 'utf8');
    }

    // Test fallback to legacy .bak
    const resLegacy = await makeSyncRequest(port, 'GET');
    assert.equal(resLegacy.statusCode, 200, 'Fallback to legacy .bak returns HTTP 200');
    assert.equal(resLegacy.body.data.decks[0].name, 'Legacy Bak', 'Recovers from legacy .bak');
    assert.equal(resLegacy.body.recoveredFrom, 'srs_state.json.bak');

    // Corrupt legacy .bak
    fs.writeFileSync(`${STATE_FILE}.bak`, '{ corrupted legacy bak', 'utf8');

    // Test fallback to daily snapshots: newest first (2026-11-05)
    const resNewerSnap = await makeSyncRequest(port, 'GET');
    assert.equal(resNewerSnap.statusCode, 200, 'Fallback to newest snapshot returns HTTP 200');
    assert.equal(resNewerSnap.body.data.decks[0].name, 'Snapshot Newer 2026-11-05', 'Recovers newest snapshot 2026-11-05');
    assert.equal(resNewerSnap.body.recoveredFrom, 'srs_state_2026-11-05.json');

    // Corrupt newer snapshot
    fs.writeFileSync(newerSnapPath, '{ corrupted newer snapshot', 'utf8');

    // Test fallback to older daily snapshot (2026-11-01)
    const resOlderSnap = await makeSyncRequest(port, 'GET');
    assert.equal(resOlderSnap.statusCode, 200, 'Fallback to older snapshot returns HTTP 200');
    assert.equal(resOlderSnap.body.data.decks[0].name, 'Snapshot Older 2026-11-01', 'Recovers older snapshot 2026-11-01');
    assert.equal(resOlderSnap.body.recoveredFrom, 'srs_state_2026-11-01.json');

    // Corrupt older snapshot
    fs.writeFileSync(olderSnapPath, '{ corrupted older snapshot', 'utf8');

    // When primary and ALL backups are corrupted -> 500 Internal Server Error
    const resAllCorrupt = await makeSyncRequest(port, 'GET');
    assert.equal(resAllCorrupt.statusCode, 500, 'HTTP 500 when all candidates are corrupt');
    assert.match(resAllCorrupt.body.error, /corrupted or unreadable/);
  });
});
