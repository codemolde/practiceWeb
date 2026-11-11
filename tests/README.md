# Test Suite & Verification Matrix

Run the automated test suite using:
```bash
npm test
```
This runs `node --test --test-concurrency=1 tests/*.test.js` sequentially using Node.js's built-in test runner without requiring external test dependencies.

---

## File Classification Matrix

| File | Status | Description |
| :--- | :---: | :--- |
| **`api-security.test.js`** | **AUTOMATED-RAN (real code path)** | Spins up live Express server on a dynamic port; tests Host header rejection (403), cross-origin restrictions, same-origin responses without CORS headers, route lockdown, and IPC contracts. |
| **`app-fixes.test.js`** | **MOCKED** | Simulates DOM & Canvas environments in a Node VM to verify keyboard shortcut guards (Cmd+V), PiP canvas timer rendering, and child focal card difficulty isolation. |
| **`csp-escaping.test.js`** | **AUTOMATED-RAN (real code path)** | Live Express HTTP CSP header verification, AST/regex disk audit of `public/index.html` for zero inline `<script>` tags, alongside unit checks for HTML attribute escaping and sketch URL validation. |
| **`deck-folder-security.test.js`** | **AUTOMATED-RAN (real code path)** | Live Express server testing folder trust verification, unregistered directory rejection (403), SHA-256 hash validation, and persistent access across server restarts. |
| **`image-security.test.js`** | **AUTOMATED-RAN (real code path)** | Live Express server verifying MIME-type sniffing, SVG sandboxing with `nosniff`, directory traversal prevention, SSRF port blocks (80/443 only), and sketch upload security. |
| **`local-date.test.js`** | **AUTOMATED-RAN (real code path)** | Spawns real Node child processes with explicit timezone configurations (`TZ=America/Los_Angeles` and `TZ=Asia/Kolkata`) around midnight and daylight saving changes to verify date string consistency. |
| **`migration-replaceable.test.js`** | **AUTOMATED-RAN (real code path)** | Tests real `electron-main.js` migration logic and filesystem operations, verifying replacement of empty destination states and pre-migration backup creation. |
| **`srs-algorithm.test.js`** | **MOCKED** | Exercises CardManager's SM-2 spaced repetition calculation (Again, Hard, Medium, Easy, mean reversion to 2.3, 1.5–3.0 bounds, and gesture timer scaling) in a simulated VM context. |
| **`storage-safety.test.js`** | **AUTOMATED-RAN (real code path)** | Exercises real server restart and disk persistence round-trip; unit subtests verify blocking banner retry, unload keepalive, and confirmReplace handling. |
| **`sync-backups.test.js`** | **AUTOMATED-RAN (real code path)** | Live Express `/api/sync` testing atomic disk writes, 5-stage backup rotation (`.bak1`..`.bak5`), daily snapshots, multi-client conflicts (409), and corrupted primary recovery. |
| **`window-state.test.js`** | **MOCKED** | Simulates Electron `BrowserWindow`, `ipcMain`, `Tray`, and `globalShortcut` lifecycle with mocked Electron APIs. |
| **`manual-verification.md`** | **MANUAL-NOT-RUN** | Physical end-to-end verification checklist in the real Electron desktop application for OS-level and interactive features. |

---

## Running Individual Tests

Any test file can be run individually:
```bash
node --test tests/storage-safety.test.js
node --test tests/deck-folder-security.test.js
```

