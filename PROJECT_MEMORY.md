# Art Practice Reference Studio — Project Memory

> **Current State Documentation**  
> This document tracks the verified architecture, file structure, security model, API contracts, and spaced repetition (SRS) algorithms of Art Practice Studio.

---

## 1. Project Overview

Art Practice Reference Studio is a local-first desktop and web application designed for fine art reference study, observational measurement, gesture drilling, and spaced repetition recall (Anki-style SM-2 variant).

- **Runtime Environments**:
  - **Desktop (Primary)**: Electron (supported stable major v43+) with native Always-on-Top floating mode, click-through Ghost Mode, system tray failsafes, and native folder picker dialogs.
  - **Browser (Secondary)**: Node.js + Express backend serving standard browsers, with fallback Picture-in-Picture via W3C Document PiP (Chromium) and Video Canvas Streamer (Safari).
- **Persistence**: Single source of truth is disk-backed atomic JSON storage at `userdata/srs_state.json` with rolling backups (`.bak1`..`.bak5`) and daily snapshots. Browser `localStorage` is used solely as an offline fallback mirror and read cache.
- **UI & Aesthetics**: Strict Munsell-neutral dark studio palette (`#121212` background, `#1A1A1A` surfaces, `#D97706` warm amber accents) ensuring zero visual color contamination. Designed for 0.0% idle GPU and CPU footprint alongside heavy creative applications (Photoshop, Blender, ZBrush).

---

## 2. Removed Features (Deliberate Removals)

The following legacy features were intentionally stripped from the codebase:

1. **Floating Soap Bubbles & Jelly Physics**:
   - *Removed*: Background particle canvas, soft elastic volume-preserving squash/stretch jelly physics, bubble-to-bubble collision simulation, and cursor shockwave physics.
   - *Reason*: Continuous animation loops and canvas repaints consumed 40–80% GPU/CPU, draining laptop batteries and causing frame drops in digital drawing apps.
2. **Drifting Ambient Aura Orbs & Continuous Keyframe CSS**:
   - *Removed*: Multi-layer blurred gradient orbs, infinite CSS animations (`todayCellPulse`, `flameFlicker`, `imageShimmer`, `progressSweep`).
   - *Reason*: Caused continuous WindowServer and GPU compositor redraw loops at idle.
3. **Fluid Drag Wake Ripples & Fluid Sounds**:
   - *Removed*: Liquid droplet cursor trail, fluid micro-wake eddies, and resonant water droplet sounds.
   - *Reason*: Distracting visual clutter and unnecessary audio processing; replaced with snappy, synthesized Web Audio tactile clicks and tones.
4. **localStorage as Source of Truth**:
   - *Removed*: Primary reliance on browser `localStorage` for decks, card scheduling, and review history.
   - *Reason*: Subject to 5MB browser storage limits, browser cache clearing, and cross-port data isolation issues. Replaced by direct disk synchronization (`userdata/srs_state.json`).
5. **Legacy Ease Formula Drift & Incorrect Fixed Points**:
   - *Removed*: The flawed formula `E + 0.1 + 0.05 * (2.3 - E)` which drifted toward an unintended fixed point of `4.30`.
   - *Reason*: Replaced by a true mathematical mean-reversion algorithm converging cleanly to `2.30` with a strict floor of `1.50` and ceiling of `3.00`.
6. **Legacy Wallpaper Local-Path Input & URL Box**:
   - *Removed*: Arbitrary filesystem paths and remote HTTP image URLs in the wallpaper modal.
   - *Reason*: Arbitrary local paths bypassed file boundary security via `/api/image?path=`, and remote HTTP URLs violated strict Content Security Policy (`img-src 'self' data: blob:`). Only local drag-and-drop, file picker, and clipboard paste (persisted via IndexedDB) are supported.
7. **HTTP Endpoint `/api/electron-float`**:
   - *Removed*: Unauthenticated HTTP endpoint previously used to trigger floating mode.
   - *Reason*: Replaced entirely by authenticated Electron IPC channels (`toggle-float-mode`, `set-always-on-top`).
8. **Invasive Global OS Shortcuts**:
   - *Removed*: Global system-wide registration of `Shift+[`, `Shift+]`, `Shift+Up`, `Shift+Down`, and `Shift+O`.
   - *Reason*: Hijacked key combinations across other active applications. Only `CmdOrCtrl+Shift+G` remains registered as a global shortcut.
9. **Inline Scripts & Inline Event Handlers**:
   - *Removed*: All inline `<script>` blocks and inline DOM event attributes (`onclick`, `onload`, `onerror`).
   - *Reason*: Mandatory compliance with strict Content Security Policy (`script-src 'self'`).

---

## 3. Real File Structure

```
practiceWeb/
├── electron-main.js           — Electron main process: window lifecycle, WeakMap window state,
│                                native menus, tray icon, 60s auto-restore failsafe,
│                                legacy repo userdata migration, and IPC security checks.
├── preload.js                 — Main window preload: exposes validated `window.electronAPI`.
├── child-preload.js           — Child / PiP window preload: exposes minimal unprivileged flags.
├── server.js                  — Express backend: security middleware, image indexing, disk sync,
│                                backup rotation, sketch upload, and Clipper with SSRF defense.
├── package.json               — Project metadata, scripts (`npm test`, `npm run electron`),
│                                dependencies (`express`), and devDependencies (`electron`, `electron-builder`).
├── public/
│   ├── index.html             — Single Page Application markup (zero inline scripts or handlers).
│   ├── env-detect.js          — External synchronous desktop/OS detection script.
│   ├── style.css              — Munsell-neutral atelier theme, layouts, and tool styling.
│   ├── js/
│   │   └── palette.js         — ColorPaletteManager: CIELAB (D65) L*, Munsell Value (0-10),
│   │                            Lab median-cut clustering, CIEDE2000 merging, relative temperature,
│   │                            and live averaging eyedropper.
│   └── app.js                 — Frontend client modules:
│                                • Storage        — Disk sync coordinator & IndexedDB wallpaper store
│                                • DeckManager    — Deck creation, editing, and deletion
│                                • CardManager    — SRS scheduling, priority sorting, backlog reflow
│                                • ReviewHistory  — Daily practice logging & streak computation
│                                • TimerManager   — Practice timer & audio alerts
│                                • SessionManager — Active queue ordering & image loading
│                                • ArtistToolbox  — Observational filters (Grayscale, Notan, etc.)
│                                • SmartCropManager — Focal crop card creation & auto-framing
│                                • PlumbTool      — Observational angle & alignment measurement
│                                • SketchOverlay  — Onion-skin self-critique overlay & alignment
│                                • SoundFX        — Synthesized Web Audio feedback
│                                • UI             — View rendering, event routing, modals
├── assets/                    — 53 dark atelier studio vector SVG icons, plus Flame.svg and due.svg.
├── userdata/                  — Persistent application data (git-ignored, OS-specific path):
│   ├── srs_state.json         — Primary SRS database (decks, cards, history, wallpaper settings)
│   ├── srs_state.json.bak1..5 — Rolling backups (shifted on write, throttled to 10 min)
│   ├── srs_state.json.pre-migration — Pre-migration backup created if empty state was replaced
│   ├── backups/               — Daily snapshots (`srs_state_YYYY-MM-DD.json`, 7-day retention)
│   └── sketches/              — Saved PNG/JPEG/WebP user sketch attempts (`sk_<randomHex>.<ext>`)
└── tests/                     — Automated Node.js test runner suite (`node --test`):
    ├── api-security.test.js          — Origin gate, Host header, and IPC security tests
    ├── app-fixes.test.js             — Keyboard filtering, PiP legend, and child card scheduling
    ├── csp-escaping.test.js          — HTML escaping, CSP headers, and sketchUrl validation
    ├── deck-folder-security.test.js  — Folder trust, path traversal, and endpoint isolation
    ├── image-security.test.js        — /api/image media type rejection and SSRF tests
    ├── local-date.test.js            — Timezone consistency and local calendar date handling
    ├── migration-replaceable.test.js — Empty state replacement & pre-migration backups
    ├── palette.test.js               — ColorPaletteManager CIELAB L*, Delta-E, temperature, eyedropper
    ├── srs-algorithm.test.js         — SM-2 intervals, mean reversion, and timer weighting
    ├── storage-safety.test.js        — Disk sync error handling, banner, and quit flushing
    ├── sync-backups.test.js          — Atomic writes, backup rotation, and crash recovery
    └── window-state.test.js          — WeakMap window states, ghost failsafes, and Linux fallback
```

---

## 4. Actual API Routes

All `/api/*` routes are served by `server.js` and protected by origin-gate security middleware.

| Route | Method | Description | Error Codes |
|---|---|---|---|
| `/api/browse` | `GET` | Lists subdirectories and image count at `?path=`. **Disabled in Electron runtime** (`process.env.APP_RUNTIME === 'electron'`). | `400` (not dir), `403` (unreadable), `404` (in Electron or missing) |
| `/api/images` | `GET` | Recursively indexes images in `?folder=`. Generates content hashes (`ch_<sha1>`). | `400` (missing folder), `403` (outside trust in Electron), `404` (not found) |
| `/api/deck-meta` | `GET` | Returns total image count and up to 3 random cover paths/hashes for `?folder=`. Cached for 60s. | `400` (missing folder), `403` (outside trust in Electron), `404` (not found) |
| `/api/image` | `GET` | Serves an image file by `?path=<abs>` or `?hash=<ch_...>`. Validates extension (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.tif`, `.tiff`, `.svg`). In Electron, path must reside within a registered deck folder or `USERDATA_DIR`. Sends `nosniff` and `sandbox; default-src 'none'`. Hashes cached for 24h (`Cache-Control: public, max-age=86400`). | `400` (missing param), `403` (unauthorized folder in Electron), `404` (missing file), `415` (unsupported extension) |
| `/api/sync` | `POST` | Atomically writes SRS database to `userdata/srs_state.json`. Validates sketch URLs (rejects `javascript:` with 400). Prevents accidental wipe (returns 409 if 0 decks & 0 cards overwrite existing data without `confirmReplace: true`). Shifts `.bak1`..`.bak5` (throttled to 10m) and writes daily snapshots to `userdata/backups/`. | `400` (malformed JSON / disallowed scheme), `409` (accidental wipe conflict), `500` (write failure) |
| `/api/sync` | `GET` | Reads `srs_state.json`. If primary is missing or invalid JSON, automatically falls back through `.bak1`..`.bak5`, legacy `.bak`, and daily snapshots newest-to-oldest. | `500` (fatal read failure) |
| `/api/sketch` | `POST` | Saves base64 critique sketch. Rejects payloads > 15MB decoded. Validates magic bytes for PNG, JPEG, or WebP. Saves to `userdata/sketches/sk_<8byteHex>.<ext>`. | `400` (missing dataUrl), `413` (>15MB), `415` (invalid magic bytes), `500` (write failure) |
| `/api/sketch/:filename` | `GET` | Serves saved sketch from `userdata/sketches/`. Enforces `path.basename()` sanitization to block path traversal. | `404` (not found), `500` (read error) |
| `/api/sketch` | `GET` | Legacy fallback endpoint (`?file=<name>`); sanitizes filename with `path.basename()`. | `400` (missing file), `404` (not found) |
| `/api/sketch-history` | `POST` | Records historical attempt entries for a card. | `400` (missing fields), `500` (write failure) |
| `/api/download-url` | `POST` | Downloads web image or resolves Pinterest pin URL to highest resolution (`originals`) and saves into `folderPath`. In Electron, `folderPath` must be a registered deck folder. Enforces strict SSRF protections. | `400` (SSRF violation / bad URL), `403` (unauthorized deck folder in Electron), `404` (folder not found), `504` (gateway timeout) |

---

## 5. Security Model

### 5.1 Origin Gate & Host Header Middleware
Every request under `/api/` passes through strict origin verification:
- **Host Header**: Must strictly match `127.0.0.1:<port>` or `localhost:<port>`. Rejects DNS rebinding and cross-site host headers with `403`.
- **Cross-Site Navigation**: Rejects any request carrying `Sec-Fetch-Site: cross-site` with `403`.
- **Opaque Origins**: Rejects `Origin: null` with `403`.
- **State-Changing Methods (`POST`, `PUT`, `PATCH`, `DELETE`)**: Permitted only when `Origin` is absent (same-origin standard browser action) or exactly matches `http://127.0.0.1:<port>` / `http://localhost:<port>`, and `Sec-Fetch-Site` is `same-origin` or `none`.

### 5.2 File Boundaries & Deck Folder Trust
- In Electron runtime (`APP_RUNTIME === 'electron'`), `/api/image` and `/api/download-url` refuse access to arbitrary filesystem paths.
- Paths are canonicalized via `fs.realpathSync()`. The target file must reside within:
  1. A registered deck folder path defined in `userdata/srs_state.json`, or
  2. The application's `USERDATA_DIR`, or
  3. A directory explicitly picked by the user via the native folder picker during the current session (`trustedFolders` Set).
- Access outside these boundaries is immediately rejected with `403 Forbidden`.

### 5.3 Content Security Policy (CSP) & Sandboxing
- **App HTML (`/` and `*.html`)**:
  ```http
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'
  ```
  Completely forbids loading remote external scripts, framing the application, or injecting third-party connect/websocket targets.
- **Image Serving (`/api/image`)**:
  ```http
  X-Content-Type-Options: nosniff
  Content-Security-Policy: sandbox; default-src 'none'
  ```
  Prevents MIME-sniffing attacks and isolates SVG references in a restricted sandbox without script execution rights.

### 5.4 Electron IPC Sender Verification & Sandbox
- Sensitive IPC channels (`dialog:pick-directory`, `toggle-float-mode`, `set-always-on-top`, `toggle-ghost-mode`, `set-ignore-mouse-events`) execute `isTrustedIpcSender(event, serverPort)`.
- Verifies that the sender frame's URL matches `http://127.0.0.1:<port>` or `http://localhost:<port>`.
- Directory picking (`dialog:pick-directory`) is strictly restricted to the primary `mainWindow`; child or popup windows attempting to trigger it receive `canceled: true, error: 'Directory picking only permitted from main window'`.
- `child-preload.js` exposes only `{ isElectron: true, isChildWindow: true }`, completely stripping window mutation and filesystem capabilities from child windows.
- Process sandboxing (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) is enforced across all windows.

### 5.5 SSRF & Outbound Clipper Defenses
- Outbound requests in `/api/download-url` are restricted strictly to ports `80` and `443`.
- URLs with embedded credentials (`user:pass@host`) are blocked.
- Hostnames are resolved upfront via DNS and verified against private, loopback, and link-local IP ranges (IPv4 `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`; IPv6 `::1`, `fc00::/7`, `fe80::/10`).
- Socket-level DNS lookup validation (`createSafeLookup`) is attached to HTTP client agents to prevent DNS rebinding (Time-of-Check to Time-of-Use) attacks.
- Outbound `Referer` headers are stripped unless the destination hostname is `pinimg.com` or `*.pinimg.com`.
- Maximum response size is strictly capped at 25MB for images and 2MB for HTML pages.

### 5.6 HTML Attribute Sanitization
- All dynamic data rendered into template literals (file names, tags, paths, titles) is sanitized through `UI._esc()` (`_escapeHtml()`):
  ```javascript
  str.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#39;');
  ```

---

## 6. Spaced Repetition (SRS) Algorithm & Formulas

The spaced repetition system is an SM-2 variant featuring discrete mathematical mean reversion, timer-weighted gesture scaling, and strict ease factor bounds.

Implemented in `CardManager.rateCard(deckId, imageId, imageName, difficulty, studyDuration)`:

### 6.1 Core Rating Formulas

#### A. Again (`again`) [<kbd>1</kbd>]
- **Interval**: `interval = 0` (card remains due today for immediate re-study).
- **Lapses**: `lapses = prevLapses + 1`.
- **Consecutive Successes**: `consecutiveSuccesses = 0`.
- **Ease Factor**: Penalized by `0.20`:
  $$\text{easeFactor} = \max\left(1.50, \min\left(3.00, \text{round}(\text{prevEase} - 0.20)\right)\right)$$
- **Due Date**: Set to today's local date string (`localDateStr()`).

#### B. Hard (`hard`) [<kbd>2</kbd>]
- **New Card**:
  - `interval = 1`
  - `easeFactor = 1.50`
  - `consecutiveSuccesses = 0`
- **Review Card**:
  - **Interval**: Halves previous interval (capped at minimum 1 day):
    $$\text{interval} = \max\left(1, \text{round}(\text{prevInterval} \times 0.5)\right)$$
  - **Ease Factor**: Penalized by `0.15`:
    $$\text{easeFactor} = \max\left(1.50, \min\left(3.00, \text{round}(\text{prevEase} - 0.15)\right)\right)$$
  - `consecutiveSuccesses = 0`

#### C. Good / Medium (`medium`) [<kbd>3</kbd>]
- **New Card**:
  - `interval = 3`
  - `easeFactor = 1.80`
  - `consecutiveSuccesses = 1`
- **Review Card**:
  - **Interval**: Scaled by previous ease factor:
    $$\text{interval} = \max\left(\text{prevInterval} + 1, \text{round}(\text{prevInterval} \times \text{prevEase})\right)$$
  - **Ease Factor Mean Reversion**:
    When `prevConsecutive >= 1`, ease factor undergoes soft discrete mean-reversion toward baseline `2.30`:
    $$\text{diff} = 2.30 - \text{prevEase}$$
    $$\text{step} = \text{round}(0.10 \times \text{diff})$$
    If $|\text{diff}| < 0.005$, $\text{easeFactor} = 2.30$. If $\text{step} = 0$, adjusts by $\pm 0.01$.
    Bounded within $[1.50, 3.00]$.
  - `consecutiveSuccesses = prevConsecutive + 1`

#### D. Easy (`easy`) [<kbd>4</kbd>]
- **New Card**:
  - Standard `interval = 7`.
  - **Timer-Weighted Gesture Scaling**: If $\text{studyDuration} \le 45\text{s}$, interval is capped to $\min(\text{interval}, 4) = 4\text{ days}$.
  - `easeFactor = 2.00`
  - `consecutiveSuccesses = 1`
- **Review Card**:
  - **Interval**:
    $$\text{interval} = \max\left(\text{prevInterval} + 2, \text{round}(\text{prevInterval} \times \text{prevEase} \times 1.3)\right)$$
  - **Timer-Weighted Gesture Scaling**: If $\text{prevReviews} < 2$ and $\text{studyDuration} \le 45\text{s}$, interval is capped to $\min(\text{interval}, 4)$.
  - **Ease Factor**: Boosted by `+0.10`:
    $$\text{easeFactor} = \max\left(1.50, \min\left(3.00, \text{prevEase} + 0.10\right)\right)$$
  - `consecutiveSuccesses = prevConsecutive + 1`

### 6.2 Strict Ease Bounds
- **Floor**: `1.50` (prevents permanent SM-2 "Ease Hell").
- **Ceiling**: `3.00`.
- **Target Equilibrium**: `2.30`.

### 6.3 Local Calendar Date Handling
- Date strings are generated via `localDateStr(date)` (`YYYY-MM-DD` in the user's local system timezone).
- Eliminates UTC midnight boundary shifts where reviews late at night (e.g. 23:30) landed on the next calendar day in UTC.
- Existing historical keys and dates are preserved without destructive rewriting.

### 6.4 Priority Scoring & Overdue Backlog Reflow
- **Dynamic Priority**: Overdue cards are ordered in review sessions by urgency:
  $$\text{priority} = (\text{lapses} \times 15) + \text{difficultyWeight} + ((2.5 - \text{ease}) \times 10) + (\text{overdueDays} \times 2)$$
  Highest-priority cards (leech cards, failed recalls, low ease) are practiced first.
- **Backlog Reflow**: When an overdue backlog exceeds the configured daily review limit, clicking `#btn-reflow-backlog` keeps the top daily limit cards for today and distributes remaining overdue cards evenly across the next 5 days (`+1` to `+5` days).

---

## 7. Desktop Electron Architecture

### 7.1 Independent WeakMap Window States
- Global state variables were replaced by a `WeakMap<BrowserWindow, Object>` accessed via `getState(win)`.
- State shape:
  ```javascript
  {
    floating: false,
    normalBounds: null,
    alwaysOnTop: false,
    ghost: false,
    originalOpacity: 1.0,
    ghostOpacity: 0.40,
    ghostTimer: null,
    keepGhost: false
  }
  ```
- Automatically cleaned up on window `'closed'`.
- Child windows maintain independent bounds and state without altering `mainWindow`. Application menu checkboxes reflect `mainWindow` state only.
- Toggling float mode does not clear independent always-on-top state.

### 7.2 Ghost Mode & Failsafes
- Activated via <kbd>CmdOrCtrl+Shift+G</kbd> or the window menu.
- Sets opacity to `0.40` and enables mouse click-through via `win.setIgnoreMouseEvents(true, { forward: true })`.
- **60-Second Auto-Restore Timer**: If mouse interaction is ignored in ghost mode, an automatic timer restores normal interaction after 60 seconds unless the user presses <kbd>CmdOrCtrl+Shift+K</kbd> to keep ghost mode active.
- **System Tray Icon**: Context menu provides a direct "Exit Ghost Mode" action to prevent artists from being locked out of window controls.
- **Opt-in Blur-Loss Failsafe**: Configurable via the View menu (`Exit Ghost Mode on Focus Loss`) or IPC (`set-restore-ghost-on-blur`). When disabled (default), click-through persists when focusing background apps (Photoshop, Blender); when enabled, losing focus immediately restores mouse interaction and exits Ghost Mode.

### 7.3 Userdata Migration & Safety
- `isDestinationFileValid(destPath, srcStat, srcPath)` treats `userdata/srs_state.json` as **replaceable** if it parses but contains 0 decks and 0 cards while the source file contains data.
- Before overwriting, it creates an atomic backup at `userdata/srs_state.json.pre-migration`.
- Migration copies files atomically and verifies content validity before writing the completion marker.

---

## 8. Known Limitations

1. **Linux Click-Through Restriction**:
   - The X11/Wayland window managers on Linux do not reliably support `setIgnoreMouseEvents` with `{ forward: true }`.
   - On Linux, Ghost Mode falls back to opacity adjustment only (click-through disabled), and the UI displays an informative notice.
2. **Hard Rating Halves Interval**:
   - For review cards, rating `Hard` reduces the interval to `Math.max(1, Math.round(prevInterval * 0.5))`. While standard SM-2 often advances by a smaller factor (e.g. 1.2×) or preserves the interval, Art Practice Studio deliberately halves it to force earlier reinforcement of strained artistic recall.
3. **Application Menu Window Scope**:
   - macOS application menu checkmarks (`Float Mode`, `Always on Top`, `Ghost Mode`) reflect the state of `mainWindow` only. If a detached child window has differing settings, the menu does not update to match the child window.
4. **External Wallpaper URLs**:
   - The wallpaper URL input box was removed to prevent CSP violations under `img-src 'self' data: blob:`. Remote web images must be downloaded locally or pasted into the app before setting them as wallpapers.
5. **Browse Endpoint Disabled in Electron**:
   - `GET /api/browse` returns `404` when running inside Electron. Desktop users must use the native OS folder picker (`dialog:pick-directory`), preserving filesystem isolation.

---

## 9. Verification Matrix

| Claim | Source File | Line / Scope | Status | Notes |
|---|---|---|---|---|
| Origin gate Host verification | `server.js` | Lines 16–25 | **VERIFIED** | Rejects host mismatch with 403 |
| State-changing methods origin check | `server.js` | Lines 38–50 | **VERIFIED** | Enforces allowedOrigins & Sec-Fetch-Site |
| App HTML CSP headers | `server.js` | Lines 58–75 | **VERIFIED** | Sends `default-src 'self'; img-src 'self' data: blob:...` |
| `/api/image` extension whitelist & sandbox CSP | `server.js` | Lines 457–514 | **VERIFIED** | 415 on invalid ext, sends `sandbox; default-src 'none'` |
| `/api/image` Electron deck folder boundary | `server.js` | Lines 478–491 | **VERIFIED** | Enforces `isPathAllowedInRegisteredDecks` (403) |
| `/api/sync` 409 wipe protection | `server.js` | Lines 754–777 | **VERIFIED** | Requires `confirmReplace: true` |
| Backup rotation `.bak1`..`.bak5` & snapshots | `server.js` | Lines 525–705 | **VERIFIED** | 10-min rotation throttle, 7-day snapshot retention |
| `/api/sketch` 15MB limit & magic bytes | `server.js` | Lines 882–912 | **VERIFIED** | 413 on >15MB, 415 on non-PNG/JPEG/WebP |
| `/api/download-url` SSRF port & IP blocking | `server.js` | Lines 1220–1373 | **VERIFIED** | Ports 80/443 only, private IP check, Referer strip |
| WeakMap window states & cleanup | `electron-main.js` | Lines 385–415 | **VERIFIED** | Keyed by BrowserWindow, cleaned on 'closed' |
| Ghost Mode 60s auto-restore timer | `electron-main.js` | Lines 560–620 | **VERIFIED** | Restores mouse interaction unless keepGhost is set |
| Opt-in blur-loss failsafe | `electron-main.js` | Lines 765–805 | **VERIFIED** | Exits Ghost Mode on window blur only when enabled |
| Linux click-through restriction | `electron-main.js` | Lines 1496–1500 | **VERIFIED** | Skips click-through on Linux |
| `isDestinationFileValid` 0-data replacement | `electron-main.js` | Lines 119–143 | **VERIFIED** | Returns false when dest is empty and legacy has data |
| `.pre-migration` backup creation | `electron-main.js` | Lines 263–274 | **VERIFIED** | Atomically backs up replaced state file |
| `rateCard` SM-2 formulas & bounds | `public/app.js` | Lines 1220–1327 | **VERIFIED** | Floor 1.5, ceiling 3.0, mean reversion to 2.30 |
| Hard rating halves interval | `public/app.js` | Line 1253 | **VERIFIED** | `Math.max(1, Math.round(prevInterval * 0.5))` |
| First two reviews <=45s Easy cap at 4d | `public/app.js` | Lines 1241, 1283 | **VERIFIED** | Interval capped to max 4 days |
| `localDateStr` local calendar time | `public/app.js` | Lines 66–87 | **VERIFIED** | Uses local `getFullYear()`, `getMonth()`, `getDate()` |
| `UI._esc` HTML attribute escaping | `public/app.js` | Lines 89–97 | **VERIFIED** | Escapes `&`, `<`, `>`, `"`, `'` |
| Zero inline scripts in index.html | `public/index.html` | Lines 15, 2127 | **VERIFIED** | Only loads `env-detect.js` and `app.js` |
| Test suite passes all tests | `tests/*.test.js` | 11 test suites | **VERIFIED** | 80/80 passing tests via `npm test` |
