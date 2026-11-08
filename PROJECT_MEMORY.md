# Art Practice Reference App — Project Memory

> This file is for agents and future development. It tracks the project's goals, current state, known bugs, and planned features.

---

## Project Overview

A local-only web app for art reference practice with Anki-style spaced repetition. Built with Node.js + Express backend and vanilla JS/CSS frontend. All data persists in the browser's localStorage.

**Stack**: Node.js, Express, Vanilla JS, CSS  
**Run**: `node server.js` → `http://localhost:3000`  
**Data**: localStorage (keys: `artpractice_decks`, `artpractice_cards`)

---

## File Structure

```
practiceWeb/
├── server.js              — Express server: serves static files + API endpoints
│                            • GET /api/browse?path=   — lists subdirectories at path
│                            • GET /api/images?folder= — recursively scans folder for images
│                            • GET /api/deck-meta?folder= — total image count + 3 random covers (60s cache)
│                            • GET /api/image?path=    — serves a single image file
├── package.json           — dependencies (express only)
├── public/
│   ├── index.html         — SPA with 3 views (deck list, deck detail, session) + 3 modals
│   ├── style.css          — dark theme, functional layout
│   └── app.js             — all frontend logic, organized into modules:
│                            • Storage      — localStorage read/write
│                            • DeckManager  — CRUD for decks
│                            • CardManager  — SRS scheduling (Anki-style intervals)
│                            • TimerManager — countdown timer with audio beep
│                            • SessionManager — study/review session queue logic
│                            • UI           — view rendering, events, folder browser
└── PROJECT_MEMORY.md      — this file
```

---

## Current Features (Implemented)

- [x] **Deck system**: create/edit/delete decks, each with a name + folder path
- [x] **Folder browser**: navigate filesystem visually to choose a folder (Browse button)
- [x] **Image display**: loads images from folder recursively, shows randomly
- [x] **Study mode**: random images from full deck (loops infinitely)
- [x] **Review mode**: only shows images due today (SRS schedule)
- [x] **Timer**: configurable countdown (30s/1m/2m/5m/10m/custom), pause/resume
- [x] **Timer blur**: when timer ends, image gets blurred — must rate to proceed
- [x] **Difficulty rating**: Hard/Medium/Easy with dynamic interval preview
- [x] **Spaced repetition**: Anki-style interval scheduling
- [x] **Review history heatmap**: GitHub-style calendar heatmap per deck
- [x] **Activity stats**: daily average, days learned %, longest streak, current streak
- [x] **Today's Reviewed button**: shows list of cards reviewed today with difficulty + next review date
- [x] **Daily Limits (Anki-style)**: configure Max New Cards/Day and Max Reviews/Day per deck
- [x] **Content-Hash Card IDs (File-Move Resilience)**: Cards keyed by fast SHA-1 content hash (`file size + first 64KB`) so SRS intervals, ease factors, and sub-deck tags follow the image even when renamed, reorganized, or moved between subfolders.
- [x] **Onion-Skin Sketch Overlay (Self-Critique Tool)**: Paste (<kbd>Cmd+V</kbd>) or drag-and-drop finished sketches directly onto the reference with live Opacity Slider, Difference Blend Mode (`mix-blend-mode: difference`), Normal, and Multiply modes, plus <kbd>K</kbd> flicker test for pinpoint eye accuracy.
- [x] **Sketch Comparison & Visual History**: Side-by-side comparison of your sketch directly next to the unblurred reference on the rating screen (<kbd>Cmd+V</kbd> or drag-and-drop). Automatically saves sketches to `userdata/sketches/` on rating, building a visual history of past attempts on future review days (<kbd>Y</kbd>) to turn subjective ratings into concrete progress tracking.
- [x] **Zero-Load GPU & Battery Optimization**: Eliminated continuous CSS repaint loops (`todayCellPulse`, `flameFlicker`, `imageShimmer`, `timerBarShimmer`, `floatBounce`, `progressSweep`) that pinned Firefox GPU Helper at 83.3% GPU and WindowServer at 46.9% CPU. Replaced infinite pulsing on heatmap today cell with a static outline (`outline: 2px solid var(--accent)`), removed full-screen redundant blur on `.wallpaper-overlay` and stripped `will-change: transform, filter, opacity` from `.wallpaper-bg`, removed heavy `backdrop-filter: blur(...)` across 30+ UI elements, and throttled 3D card tilt to `requestAnimationFrame` with cached bounding rects. Idle GPU and CPU redraw drops to 0.0%.
- [x] **Safe Git baseline**: original code committed safely to git
- [x] **Munsell-Neutral Studio Palette & Pro Micro-UI Refresh**: Replaced generic "AI dashboard" neon/purple glassmorphic color palette and bubbly 14px-20px rounded corners with a strict Munsell-neutral studio palette (inspired by PureRef, Blender, and DaVinci Resolve) so background colors never contaminate the artist's color and value perception:
  • Canvas/Stage background: `#121212` (dead-neutral dark charcoal, zero blue/purple tint).
  • Surfaces: `#1a1a1a` panel surface, `#242424` elevated card surface, `#2e2e2e` hover, hairline `#303030` borders.
  • Primary Accent: `#d97706` (Warm Atelier Amber) and `#f59e0b` hover.
  • Tightened Radii: `3px` / `4px` for buttons, inputs, tags, and `6px` for cards, modals, and docks.
  • Typography: `'JetBrains Mono', 'SF Mono', monospace` with tabular numbers (`tnum`) for all stats, countdowns, intervals, and hotkeys.
  • Rating Buttons: uniform matte `#242424` with 1px border and semantic accents (`#ef4444` Again, `#f97316` Hard, `#10b981` Good, `#3b82f6` Easy) applied strictly to the 2px bottom border and keybind badge.
  • Study Auto-Dimming: custom wallpapers automatically dim to `background: rgba(18, 18, 18, 0.96)` and `opacity: 0.12` during active sessions (`#view-session.active`, `body.in-session`, `body.zen-active`) preventing visual color skew.
  • Maintained 3D mouse card tilting (`applyCardTilt`) and scaled down UI icons for a clean, distraction-free aesthetic.
- [x] **Core Philosophy**: documented in memory.md and PROJECT_MEMORY.md

---

## Completed Upgrades: Living Atmosphere, Custom Wallpaper System & Artist QoL
- [x] **Philosophy Alignment**: artist flow state, visual immersion, zero-friction shortcuts
- [x] **Living Atmosphere & Rich Aesthetics**:
  - Ethereal, lite, and transparent soap bubbles (11-30px) with delicate iridescent rims and curved specular glints
  - Bouncy & soft elastic jelly physics: bubbles squish into volume-preserving ellipses upon cursor approach, collisions, or shockwaves, bouncing and wobbling softly back into shape
  - Soft bubble-to-bubble elastic collision & bouncing
  - Fluid cursor mechanics: aerodynamic liquid droplet following the mouse with viscous fluid drag, plus expanding fluid micro-wake ripples (eddies) shed as the cursor travels through water
  - Radial physical shockwaves that displace and softly deform bubbles on click
  - Highlighting click bursts with 4-point rotating diamond sparkle stars (`✦`) and fluid droplet trails
  - Tactile fluid ripple animation (`.fluid-ripple`) on buttons, cards, and interactive controls
  - Robust Web Audio API fluid click sound: resonant water droplet bloop + crystal glass ping + warm tactile sub-body with async AudioContext unlocking and global background click playback
  - Silky fluid water droplet hover sound for buttons, cards, and toolbars
  - Multi-layer drifting ambient aura orbs with soft radial gradients
  - Glowing glassmorphic cards with 3D tilt & dynamic specular mouse glare
  - Synthesized Web Audio API tactile feedback (clicks, hovers, rating chords, timer warnings, singing bowl chime, celebration fanfare)
  - Living breathing streak flame (`🔥`) and danger/warning timer pulse
  - Smooth view transitions and staggered animations
  - Toast HUD notifications for all hotkey actions
- [x] **User-Custom Background Wallpaper System**:
  - Set personal wallpaper from local machine (file picker or drag-and-drop) or image URL
  - Real-time live blur slider (0px - 30px) and dark overlay dimming slider (10% - 90%)
  - Persistent in IndexedDB (zero image file size limits)
  - Reset to default dark studio slate option
- [x] **Artist Quality of Life (QoL)**:
  - Grayscale / Value Check mode (`G`)
  - Notan 2-Value Harmonic Study mode (`N`)
  - Silhouette Mode (`L` / `H`): thresholding subject against background to test gesture clarity, line of action, and negative space with dynamic threshold slider (5–95%) and dark/light silhouette inversion
  - Posterize Mode (`P`): quantizes tonal values into 3 to 4 classical tonal steps (Light, Halftone, Core Shadow, Occlusion) via hardware-accelerated SVG `feComponentTransfer` discrete filters with slider (2–6 steps), quick 3/4-step presets, and live tonal chips
  - Proportion grid overlay (`O`)
  - Smooth drag-to-pan & mouse-wheel zoom
  - Invert color mode (`I`)
  - Horizontal flip / mirror (`M`)
  - 90° image rotation (`R`)
  - Vertical side toolbar dock: moves artist controls into the empty side space vertically with grouped dividers and compact zoom row, preventing tools from overlapping the top of reference artwork
  - Always-on-Top Floating PiP Mode (`V`):
    • Chromium (Chrome, Edge, Arc, Brave): Uses W3C Document Picture-in-Picture API (`window.documentPictureInPicture`) for native OS floating window (`NSFloatingWindowLevel`) containing interactive HTML controls, vertical toolbar, and rating buttons.
    • Safari & macOS: Apple Safari does not support Document PiP and normal popup windows are sent behind other apps on macOS. Solved via Native macOS Video Picture-in-Picture (`PiPCanvasStreamer`) streaming offscreen canvas to `<video>.requestPictureInPicture()`. macOS WindowServer locks this native PiP window permanently on top of all desktop apps (Photoshop, Blender, VS Code) without getting hidden. Includes live timer countdown, full pixel manipulation filters (Grayscale, Notan, Silhouette, Posterize, Invert), MediaSession controls (`nexttrack` / `play` / `pause`), and 1-click switcher to detachable popup mode.
    • Transparent DOM lookup proxy (`PiPState`): intercepts `getElementById`, `querySelector`, and `querySelectorAll` to resolve inside floating PiP window when detached.
    • Responsive floating dock: auto-dims to 0.22 opacity when idle, absolute overlay consuming 0px stage height, smoothly collapses down to circular badges for ultra-compact narrow viewports.
  - Bubble Toggle & Zero-GPU Eco Mode (`B` / header buttons):
    • Instantly disables particle canvas, stops all animation loops / timers, clears context, pauses background aura CSS animations, and drops GPU/CPU utilization to 0.0% (ideal for high-load drawing in Photoshop, Blender, or 3D sculpting). Persists in `localStorage`.
  - Frame Rate Limiter (FPS Limiter):
    • Multi-tier frame rate throttling: 30 FPS (Eco Mode • ultra-low GPU), 60 FPS (Balanced Smooth default), 120 FPS (High Refresh), and 144 FPS (Max).
    • Uses precision timestamp delta throttling within `requestAnimationFrame` instead of battery-draining `setInterval` loops. Persists in `localStorage`.
  - Distraction-free zen fullscreen (`F`)
  - Keyboard shortcuts cheat sheet modal (`?`)
  - Session complete celebration & summary modal
  - Backup & restore (Export/Import JSON)

---

## Visual Refresh & Session Fixes (2026-10-07)
- [x] **True fullscreen** (`F` / header button / HUD ⛶): `UI.setZenMode()` adds `body.zen-active` and requests native fullscreen on `<html>`. `fullscreenchange` keeps state in sync when the browser handles Esc. Reference fills the screen; header, toolbar and rating dock auto-hide after ~2.4s of idle (`body.hud-idle`) and stay up while a rating is required (`body.rating-required`).
- [x] **Proportion grid fixed**: overlay is an SVG *inside* `#image-frame`, so it sits exactly on the picture and follows zoom/pan/flip/rotate. `O` cycles 3×3 → 4×4 → 8×8 → axes+diagonals → off (`ArtistToolbox.GRID_MODES`).
- [x] **Image fitting**: `ArtistToolbox.fitImage()` sizes the frame to "contain" in the stage (aware of 90° rotation) on load, resize (ResizeObserver) and rotate. Zoom is cursor-anchored, pan is clamped, double-click toggles 2.5×/fit, rotation never spins backwards (`rotateTotal`).
- [x] **Session layout**: `#view-session` is a viewport-height flex column; stage takes all remaining space, rating dock is a single row.
- [x] **Home screen**: daily overview strip (due / practiced / streak / decks), deck cards with cover mosaic + study-progress bar, glass tool dock.
- Gotcha: `.view.active` animation must end with `transform: none` — a leftover `translateY(0)` traps `position: fixed` children (broke fullscreen overlays).
- Gotcha: avoid `will-change: transform` on the image frame — Chrome keeps the old raster scale and zoomed detail turns blurry.
- Gotcha: PiP cross-window DOM resolution requires a standalone `PiPState` proxy and direct delegated capture event listeners on `pipDoc`, as `const UI` does not attach to `window` and browsers drop/isolate cross-realm node listeners when adopted across windows.
- Gotcha: `#session-workspace` must be properly closed before `#session-pip-placeholder` in `index.html` so the placeholder card stays in the main tab and is not appended into the floating PiP window.
- Gotcha: Global `@media (max-width: 600px)` rules (`.btn-rate { width: 100% }`) must be scoped with `body:not(.pip-mode)` so floating windows do not inflate button widths when shrunk.
- Server restart required after pulling these changes (`/api/deck-meta` is new).

---

## Architecture Notes

### 4-Button Grading System & Spaced Repetition (SM-2)
The spaced repetition uses a full 4-button SM-2 variant matching standard Anki learning steps:
- **Again (<10m)** [<kbd>1</kbd>]: Immediate reset. Card remains due today (`interval = 0`, `dueDate = todayStr`), ease factor penalized by -0.20, and lapse counter incremented. In active study sessions, the card is automatically re-queued 3–4 cards ahead so the artist can re-test recall before the session ends.
- **Hard (1 day)** [<kbd>2</kbd>]: Straining recall. Interval drops by 50% or advances by 1 day (`easeFactor -= 0.15`).
- **Good / Medium** [<kbd>3</kbd>]: Successful recall. Interval advances by $prevInterval \times prevEase$.
- **Easy (7+ days)** [<kbd>4</kbd>]: Effortless recall. Interval leaps forward ($prevInterval \times prevEase \times 1.3$) and ease factor receives a bonus (`+0.15`).
- Data Model:
```
Card: {
  imageId, imageName, difficulty, interval, easeFactor, dueDate,
  reviewCount, lapses, lastReviewDate, firstReviewDate,
  isChild, parentImageId, parentPath, parentHash, crop,
  tags: ['hands', 'foreshortening', ...],
  attempts: [{ date, rating, sketchUrl }]
}
```

### 3-Value & Dynamic Posterization (Watts Atelier Value Studies)
- **SVG `<filter id="filter-posterize-3">`**: Hardware-accelerated discrete tonal mapping using `<feComponentTransfer in="grey">` with `<feFuncR|G|B type="discrete" tableValues="0 0.5 1"/>` dropping clean 3-value breakdowns (Light, Halftone, Shadow).
- **Dynamic `<filter id="filter-posterize">`**: Dynamic 2–6 step discrete filter responding to live slider, default initialized to 3 steps with instant presets for classical atelier studies.

### Sub-Deck Tagging & Focus Filters
- Pressing `T` in active study opens the non-intrusive Quick Tagging Dock.
- Presets: `1` Hands, `2` Foreshortening, `3` Lighting, `4` Anatomy, `5` Gesture, `6` Leech (or type custom tags with Enter).
- Pressing `1`–`6` while the dock is open toggles tags instantly without disturbing artist flow.
- Deck Detail View features `#deck-focus-section` allowing one-click filtering of study/review/free queues to any sub-deck tag without moving files on disk.

### Always-on-Top Floating Mode
- Uses Document Picture-in-Picture (`window.documentPictureInPicture`) or dual HTML5 Canvas video stream fallback for Safari / WebKit.
- Includes tactile rating dock, timer bar, zoom/pan/rotate, artist tool filters, and MediaSession global hotkeys.

### Disk-Backed State System (`userdata/srs_state.json`)
- Replaced fragile 5MB browser `localStorage` quota and port-switching vulnerability with direct atomic disk persistence to `userdata/srs_state.json`.
- `POST /api/sync`: Express endpoint with 50MB payload capacity; performs atomic write via temporary file rename to prevent file corruption.
- `GET /api/sync`: Express endpoint returning existing database state on startup.
- Automatically syncs after every practice session (`UI.endSession()`, `UI.openSessionSummaryModal()`), on ratings/tagging, on deck changes, and on page unload (`visibilitychange` / `beforeunload`).
- Automatic migration: if `userdata/srs_state.json` does not exist yet, existing browser `localStorage` cards and decks are migrated to disk on startup.

### Content-Hash Card IDs (File-Move Resilience)
- **Problem**: Keying cards by absolute file path (`/Users/.../pose/img1.png`) meant moving images to subfolders, renaming files, or reorganizing reference folders wiped out review history.
- **Fast Content Hashing**: `server.js` computes a fast content hash (`ch_` + SHA-1 of `file size + first 64KB`). Benchmarked at ~0.02ms per file, with in-memory caching keyed by `filePath`, `mtimeMs`, and `size`.
- **API Mapping**:
  - `GET /api/images` returns `{ id: hash, hash: hash, path: filePath, name: relativePath, folder: ... }`.
  - `GET /api/image` accepts both `?path=` and `?hash=`, resolving content hashes to disk paths using `hashToPathMap`.
- **Automatic Migration**: `CardManager.migrateLegacyPathCards(deckId, images)` seamlessly transforms existing path-keyed cards to content hashes upon loading deck details or starting a session. If a file was renamed, its SRS review history and tags are preserved while its display name is updated to the new relative path.

### Onion-Skin Sketch Overlay (Self-Critique Tool)
- **Problem**: In fast gesture drilling and anatomy recall, training eye accuracy requires immediate, objective feedback comparing the artist's drawn proportions against the reference model photo.
- **Workflow**:
  - **Paste (<kbd>Cmd+V</kbd> / <kbd>Ctrl+V</kbd>)**: Artists copy their canvas/layer in Photoshop, Procreate, Clip Studio Paint, or Krita and paste directly onto the stage.
  - **Drag & Drop**: Drop any sketch file directly over `#image-stage` with visual animated drop zone.
  - **Time's Up Integration**: When the study timer ends, the blur overlay features a direct "Paste Sketch (<kbd>Cmd+V</kbd>)" action and "Unblur Reference" toggle. Pasting automatically clears/unblurs so the artist can critique before rating.
  - **Blend Modes**:
    • `Difference` (`mix-blend-mode: difference`): Exact matches turn dark/black; anatomical discrepancies and proportion shifts highlight brightly in high contrast.
    • `Normal` (`mix-blend-mode: normal`): Classic semi-transparent onion skinning with 0-100% opacity slider.
    • `Multiply` (`mix-blend-mode: multiply`): Perfect for sketches on white backgrounds (lines overlay directly over reference photo).
  - **Flicker Test (<kbd>K</kbd>)**: Rapidly toggles sketch visibility on/off to let the artist's eye catch structural deviations through 2D animation-style persistence of vision.
  - **Synchronized Transforms & PiP Support**: Overlay sits inside `#image-frame`, automatically following all zoom, pan, rotate, and horizontal flip transforms, and renders in both Document PiP and Safari Canvas Video PiP.

### Sketch Comparison & Visual History
- **Problem**: Subjective self-ratings (Hard, Medium, Easy) become biased over time without visual records of past attempts.
- **Workflow**:
  - Dropping or pasting (<kbd>Cmd+V</kbd>) a sketch attaches it to the current card's attempt history.
  - On rating, the sketch is archived into `CardManager.cards[deckId][imageId].attempts` with timestamp and rating.
  - Side-by-side comparison (<kbd>Y</kbd>) displays unblurred reference photo and sketches side-by-side, complete with historical attempt tabs to track growth across study sessions.

### Color & Palette Extraction HUD (<kbd>E</kbd>)
- **Purpose**: Master studies, lighting drills, and shadow temperature verification.
- **Dominant Lighting & Shadow Harmony**:
  - Fast offscreen canvas quantization samples image pixels into 5-bit color buckets and clusters into 6-7 harmonized dominant swatches.
  - Automatically sorted by perceptual value lightness ($Y = 0.299R + 0.587G + 0.114B$) from highlights to core shadows.
  - Each chip displays its Munsell-style Value % tag, hex, and Warm/Cool classification.
- **Live HSB/Value Eyedropper on Hover**:
  - Exact inverse transform math accounts for zoom, pan, rotation, and horizontal flipping.
  - Hovering over `#image-stage` displays `#eyedropper-loupe` near cursor with live circular color preview, temperature badge, HEX, and HSB metrics ($H^\circ, S\%, B\%$).
  - Clicking on the reference saves the sampled color to the Sampled Study Colors bar (up to 12 custom swatches) and copies HEX to clipboard.
- **Floating Movable & Hideable Controls**:
  - Free drag-and-drop repositioning across `#session-image-container` via header bar or drag grip with cursor bounds clamping.
  - Minimize / Collapse button (<kbd>Shift+E</kbd>) collapses swatches & inspector down to a slim 34px floating header bar.
  - Hide / Close button (`X` or <kbd>E</kbd> or <kbd>Esc</kbd>) closes the window while preserving sampled and dominant swatches.

### Onion-Skin Overlay & Critique Dock (<kbd>K</kbd> / <kbd>Shift+K</kbd>)
- **Floating Movable Dock**:
  - Draggable anywhere on the canvas via header bar or drag grip with clamp bounds, preventing it from obscuring the top of references.
- **Hideable Dock**:
  - Dedicated Hide Dock button (`X`, <kbd>Shift+K</kbd>, or <kbd>Esc</kbd>) closes the dock panel while keeping the sketch overlay active on the canvas.
  - Re-open at any time via the sidebar "Overlay" button (`#btn-art-sketch`) or <kbd>Shift+K</kbd>.
  - Minimize button collapses controls row down to a sleek single row (title, eye flicker test, blend mode switcher, paste, actions).
  - Explicit Remove / Delete button (trash icon 🗑️) prevents accidental sketch deletion when closing the dock.

### Smart Crop / Focal Point Zoom Cards (<kbd>C</kbd>)
- **Purpose**: Practice tricky sub-regions (hands, facial features, drapery folds, dramatic lighting) from full-body references without duplicating image files on disk.
- **Zero-Disk Duplication**:
  - Pressing <kbd>C</kbd> during active session opens `#smart-crop-overlay`.
  - Artists drag an interactive selection box over the focal area and choose topic tags (`#hands`, `#face`, `#drapery`, `#lighting`, `#feet`, `#foreshortening`).
  - Stores normalized bounds `{ x, y, w, h }` (0.0 to 1.0) on child cards referencing parent `imageId`/hash and path.
- **Independent SRS Schedule**:
  - Child cards have their own interval, ease factor, repetition count, and due dates.
  - Included in Study New, Review Due, and Free Study queues, plus Sub-Deck tag filters.
- **Auto-Framing & Context Toggle (<kbd>Shift+C</kbd>)**:
  - When reviewing a focal card, `SmartCropManager` auto-zooms and pans directly to the cropped region.
  - Shows `#session-focal-pill`; pressing <kbd>Shift+C</kbd> flips seamlessly between zoomed focal crop and full reference context.

### Studio Status Bar & Compact Topbar
- **Compact Studio Status Bar (`40px` Ribbon)**:
  - Replaced oversized 4-card stat grids on Home view (`#today-strip`) and Deck Detail view (`#deck-stats-row`) with a compact single-row horizontal flex ribbon (`background: #1A1A1A; border: 1px solid #2E2E2E; border-radius: 6px; height: 40px; padding: 0 16px; gap: 24px;`).
  - Stat items are separated by `1px solid #2E2E2E` vertical dividers.
  - Numbers and labels sit inline with lightweight vector SVGs: `[SVG] 82 Due Today | [SVG] 0 Practiced | [SVG] 0d Streak | [SVG] 2 Decks`.
  - Monospace typography with tabular figures (`tnum`) for numeric values.
  - Sits reference decks and study workspace significantly higher on the screen without unnecessary vertical scrolling.
- **Compact Topbar (`44px` Height)**:
  - `.app-header` and `.deck-header` compacted to `44px` height with `padding: 0 16px` and `28px`-tall utility buttons (`Sound`, `Wallpaper`, `Data`, `Hotkeys`, `+ New Deck`).

### Floating PureRef HUD & Side Tool Auto-Hide (Mac Dock Behavior)
- **macOS Dock-Style Auto-Hiding Side Tools (Both Window & Float Mode)**:
  - When drawing / studying, `.image-hud-dock` auto-retracts flush against the right edge of the screen (`translateX(calc(100% - 5px))` with `opacity: 0.35`), leaving only a discreet 5px rounded peek handle.
  - 99% of the reference stage is 100% crystal clear and unobstructed.
  - Moving the cursor near the right edge (within 50px) or hovering the edge trigger zone smoothly slides the dock out into full view (`translateX(0)` with `cubic-bezier(0.16, 1, 0.3, 1)`).
  - Moving cursor away smoothly slides the dock back into the edge.
  - Active subpanels (like `#filter-controls-dock` for Silhouette or Posterize threshold adjustment) automatically keep the dock pinned open while tweaking sliders.
- **Responsive 2-Column Grid Alignment on Window Shrink**:
  - When the window height shrinks (height $\le$ 580px, or $\le$ 600px in float mode, or width $\le$ 700px), `.image-toolbar` dynamically changes alignment from a single tall 555px vertical stack into a compact 2-column tactile grid.
  - Drops total toolbar height from 555px down to ~240px.
  - The zoom row spans horizontally across both columns (`[－] [100%] [＋]`).
  - Constrained with `max-height: calc(100vh - 20px); overflow-y: auto;` so tools never vanish or clip under the bottom of the window, even on extreme small viewports.
- **Float Mode Rating Cleanliness**:
  - Removed sketch dropzone and Hard/Medium/Easy buttons in float mode; only `Again [1]` and `Skip [S]` remain.
  - Keys <kbd>2</kbd>, <kbd>3</kbd>, <kbd>4</kbd> are ignored in float mode.

### Onion-Skin Sketch Alignment (Self-Critique Proportional Overlay)
- **Independent Pan, Scale, and Rotate Alignment (`A`)**:
  - Artists whose freehand digital sketch isn't drawn at the exact same canvas offset or scale can align landmarks directly over the reference photo before using Difference blend mode or the `K` flicker test.
  - State tracked inside `SketchOverlay`: `sketchOffsetX`, `sketchOffsetY`, `sketchScale`, `sketchRotate`, `isAlignMode`.
  - Nested inside `#image-frame` with `transform-origin: center center`, so global zoom/pan/flip moves both reference and sketch together by default.
  - When Align Mode is active (`A` toggle):
    - Dragging on `#image-stage` pans ONLY `#sketch-overlay` with 1:1 screen mapping (compensating for global zoom, flip, and reference rotation).
    - Mouse wheel scrolling scales ONLY `#sketch-overlay` in 1% increments (`0.1×` to `5.0×`).
    - Holding `Shift + Scroll` (or hotkeys `[` and `]`) rotates ONLY `#sketch-overlay` in `0.5°` steps.
    - Double-clicking stage or clicking `↺ Reset` resets offset to `0,0`, scale to `1.0`, and rotate to `0°`.
    - Real-time studio metrics badge displays current offset, scale, and rotation (e.g. `+14,-8px · 104% · 1.5°`).
    - Stage displays `grab` / `grabbing` cursor during align mode.
  - Full Safari & Canvas PiP synchronization: `PiPCanvasStreamer.render()` accurately applies `sketchOffsetX/Y`, `sketchRotate`, and `sketchScale` to canvas video stream.

### Studio Distraction Elimination (Notification & HUD Streamlining)
- **Eliminated In-Session Toast Notifications & Stacking**:
  - Removed all spammy toast popups during drawing drills and flicker tests (`K` Sketch Visible/Hidden, blend mode changes, fit mode, grayscale/notan/silhouette/posterize filters, horizontal flip, rotation, timer pause/reset, sound toggle, eyedropper/palette sampling, and PiP mode transitions).
  - Rapid key presses (like pressing <kbd>K</kbd> repeatedly for the flicker test) now toggle layers silently and instantly without spawning stacked columns of toast pills over the reference artwork.
  - `#toast-container` is strictly disabled during active study sessions, float mode, and zen mode via CSS `display: none !important;` and early returns in `UI.showToast()`.
  - Outside session view (e.g. deck creation / settings), `container.innerHTML = ''` guarantees only one toast ever exists at a time (zero stacking).
  - Repositioned `.toast-container` to bottom-center (`bottom: 28px`), preventing collision with top control docks and app headers.

### Floating Reference & macOS Dock Auto-Hide Polish
- **Float Mode Bottom Bar & Paste Removal**:
  - Removed Easy, Medium, Hard rating buttons and the sketch paste/drop section (`#rating-sketch-bar`) completely from float mode (`body.pip-mode`).
  - During active drawing drills, the floating rating dock is 100% invisible (`opacity: 0; pointer-events: none;`) so zero UI covers the artwork. It smoothly fades in only when the artist hovers near the bottom edge or when the timer expires (`rating-required`), presenting a minimal `[ Again ]` and `[ Skip ]` pill.
- **Side Tool Dock macOS Auto-Hide**:
  - Both in window mode and float mode, the vertical side tool dock hides completely off-screen (`translateX(calc(100% + 12px)); opacity: 0; pointer-events: none;`).
  - Approaching the right edge (within 36px) or hovering `.dock-edge-trigger` smoothly slides the dock into view (`translateX(0); opacity: 1; pointer-events: auto;`).
  - Moving the cursor away from the edge smoothly slides the dock out of sight. Resolved button focus lock by blurring active buttons on pointer exit.
- **Adaptive Shrunk Window Tool Alignment**:
  - When the window height or width shrinks (`height <= 720px` or `width <= 720px`), the side toolbar dynamically transitions from a tall vertical single-column strip into an ultra-compact **2-column grid** (`grid-template-columns: repeat(2, 32px)`).
  - Tools remain fully visible and comfortable to click without vanishing or cropping under the window, backed by slim-scrollbar overflow scrolling.

### Plumb-Line & Angle Measurement Tool (`U` / `Shift+Drag`)
- **Interactive Anatomical Tilt & Alignment Drops**:
  - Lets artists measure observational drawing angles (e.g. shoulder vs. pelvis tilt, head angle, limb axes) and vertical/horizontal alignment drop-lines directly against the reference image.
  - Rendered inside `#image-frame` as an `<svg id="plumb-overlay" class="plumb-overlay">`, automatically tracking all zoom, pan, horizontal mirror flip, and 90° rotations.
  - Activated by clicking the side toolbar button `#btn-art-plumb`, pressing hotkey <kbd>U</kbd> in session, or holding <kbd>Shift</kbd> and dragging on `#image-frame`. Normal drag-to-pan behavior remains completely unaffected.
  - **Drop-line Crosshairs**: At `startPoint` and `currentPoint`, renders faint dashed horizontal and vertical crosshairs (`stroke-dasharray="4 4"`) spanning the full height and width of the reference photo.
  - **Tilt Metric Badge**: Midpoint displays a compact monospace pill badge with the exact angle in degrees (`0.0°` to `90.0°` relative to nearest axis) and relative length (`% of image height`), mathematically counter-rotated and counter-flipped so text remains upright and legible in any orientation.
  - **Multi-Line Tilt Comparisons**: Retains up to 3 distinct active measurement lines simultaneously using atelier studio palette colors (Amber `#f59e0b`, Sky Cyan `#38bdf8`, Rose Coral `#f43f5e`) to compare multiple axes (e.g. shoulders, ribcage, pelvis).
  - Pressing <kbd>U</kbd> or clicking `#btn-art-plumb` clears all active lines; pressing <kbd>Esc</kbd> clears lines and exits Measure Mode.
  - Full Canvas / Video PiP synchronization via `PlumbTool.renderToCanvas()`.

### Spaced Repetition Scheduling Upgrades (CardManager)
- **Ease Hell Prevention & Strict Mean Reversion**:
  - Eliminated permanent SM-2 "Ease Hell" trap by enforcing a strict minimum `easeFactor` floor of `1.5` (raised from legacy `1.2` / `1.3`) and a ceiling of `3.0`.
  - Audited and corrected the ease-factor formula to ensure a strict mathematical fixed point at `2.30`:
    • Previous buggy formula `E + 0.1 + 0.05 * (2.3 - E)` had an unintended fixed point of `4.30` because the `+0.1` constant shifted the equilibrium.
    • Corrected to clean discrete mean-reversion without constant drift: `diff = 2.3 - prevEase; step = round(0.10 * diff);` with resolution preservation preventing sub-cent discretization stalls.
    • Cards flagged difficult smoothly recover toward baseline `2.30` on Good (`medium`) streaks ($1.50 \to 1.58 \to 1.65 \to \dots \to 2.30$) and remain strictly locked at `2.30`.
    • Easy (`easy`) ratings award a dedicated $+0.10$ multiplier boost capped at `3.00`.
    • All ease calculations rounded to 2 decimal places (`Math.round(ef * 100) / 100`), eliminating IEEE 754 precision noise (`1.4999999999999998`).
- **Timer-Weighted Interval Scaling**:
  - Rapid gesture drills (`<= 45s` timer) on a card's first 2 reviews cap the Easy (`4`) interval jump to a maximum of `4 days` (down from standard 7+ days).
  - Prevents 30-second quick gesture sketches from pushing anatomically complex or unfamiliar references weeks into the future before a thorough structural or tonal study is performed.
- **Overdue Backlog Load-Balancer & Priority Sorting**:
  - **Dynamic Priority Scoring**: Overdue cards are automatically sorted using `CardManager.getCardPriority(card)` which weights:
    `priority = (lapses * 15) + difficultyWeight + ((2.5 - ease) * 10) + (overdueDays * 2)`
    Ensures daily review sessions tackle high-lapse leech cards, failed recalls, and difficult references before easy ones.
  - **Reflow Overdue Backlog Button**: Added `#btn-reflow-backlog` in Deck Detail (`.session-options-bar`). If a user's due queue exceeds their configured daily review limit, clicking this button retains the top daily limit of highest-priority cards for today, and smoothly spreads the excess cards evenly across the next 5 days (`+1` to `+5` days).
  - 100% backward compatible with existing card structures in `userdata/srs_state.json`.

### Squint Blur Tool (`S` / `[` / `]`)
- **High-Frequency Detail Stripping for Big Form & Mass Checks**:
  - Implements an observational squint check using an SVG Gaussian blur filter (`<filter id="filter-squint">`) with `edgeMode="duplicate"`, completely preventing dark background/transparent edge bleed around reference photos.
  - Allows artists to soften fine surface textures, micro-edges, and high-frequency noise to evaluate dominant silhouette forms, big value masses, and light vs. shadow group relationships without harsh posterization or binarization.
  - Activated via toolbar button `#btn-art-squint`, hotkey <kbd>S</kbd> in active session (with <kbd>Shift+S</kbd> disambiguated for skip), or in Document and Safari Video PiP floating modes.
  - **Adjustable Radius Subpanel**: `#panel-squint-controls` slides out in the filter dock with presets (`3px` subtle edge softening, `8px` form mass check, `16px` macro-value silhouette block-in, `↺ 6px` default reset) and a continuous slider (`1px` to `24px`). Hotkeys <kbd>[</kbd> and <kbd>]</kbd> step the blur radius down/up by 1px while squint mode is active.
  - **Multi-Filter Stacking**: Stacks cleanly with Grayscale, Invert, Silhouette, Posterize, and Notan modes via comprehensive compound CSS rules.
  - Synchronized across both main window and floating Picture-in-Picture window (Document PiP SVG clone + Safari Video PiP Canvas 2D blur filter).

### Desktop Atelier Selection Controls
- **Zero Accidental Blue Highlights on UI Chrome**:
  - `html, body` and all UI chrome (buttons, side tool docks, timer bars, stats ribbon, rating buttons, modals, badges, stage frame, and reference image) are set to `user-select: none !important;` to emulate native creative desktop app behavior (PureRef, Blender, DaVinci Resolve).
  - Rapid double-clicking, scrubbing sliders, holding Shift+Drag for plumb lines, or dragging to pan references will never trigger unwanted browser text selection highlights.
- **Copyable Text Zones**:
  - **Color Palette & Eyedropper HUD**: Swatches, color inspector cards, and eyedropper loupe (`.palette-hud-card`, `.palette-color-inspector`, `.eyedropper-loupe`) remain fully copyable.
  - **1-Click Select All**: `#inspector-hex`, `.inspector-hex`, `.metric-val` (RGB, lightness, hue, sat, bri), and `#loupe-hex` use `user-select: all !important;` and `cursor: text;` for effortless single-click selection and clipboard copying into Photoshop, Krita, and Blender. Clicking `#inspector-hex` or `#btn-copy-inspector-hex` also triggers a copy with a green "✓ Copied!" feedback state.
  - **Editable Fields, Paths & Code**: All text inputs (`<input>`, `<textarea>`, `[contenteditable]`), folder paths (`#deck-detail-folder`, `.folder-path`), and `<code>` blocks remain cleanly selectable.
  - Custom atelier amber `::selection` highlight (`rgba(217, 119, 6, 0.45)`).

### Custom Atelier Flame Vector Streak Icon
- **Zero-GPU Flame Vectors with Core Glow**:
  - Replaced the streak flame icon in `#today-strip` (Home status bar) and the Deck Detail heatmap footer (`Current Streak`) with a multi-layered Atelier Flame SVG.
  - Built with 5 vector layers: Back-left dark wing (`#27272A`), Main central flame tongue (`url(#flame-core-grad)` from `#FEF08A` inner core to `#F59E0B` amber to `#EA580C` orange tip), Middle charcoal fold (`#3F3F46`), Inner pocket glow overlay (`url(#flame-inner-glow)` with `mix-blend-mode: screen`), and Bottom bone-white crescent (`#F4F4F0`).
  - Styled with `.atelier-flame-icon` (`vertical-align: middle; flex-shrink: 0; filter: drop-shadow(0 0 4px rgba(245, 158, 11, 0.28));`).
  - Suppressed emoji flame in `.streak-flame` via `display: none !important;` so JS streak updates preserve clean vector styling.
  - 0.0% continuous GPU usage (zero continuous `@keyframes` animations).

### Atelier Studio Vector Icon System & Zero-Emoji Overhaul
- **53 Standalone Studio Icons**: Generated and saved in `assets/` and mirrored to `public/assets/`, matching the atelier dark studio theme.
- **Strict Preservations**: Original `assets/Flame.svg` and `assets/due.svg` remain 100% untouched.
- **Complete Elimination of System Emojis**: Removed all emojis across `public/index.html`, `public/app.js`, `public/style.css`, and `server.js` (verified 0 emojis across the entire project).
- **Centralized Vector Generation**: Implemented `UI.getIconSvg(nameOrEmoji, size, className)` and `UI.getFlameSvgHTML(width, height)` in `public/app.js` with automatic legacy emoji fallback mapping.
- **Styling**: Added `.tonal-dot` (6 tonal swatch classes), `.rating-dot` (easy/medium/hard classes), and studio vector icon classes in `public/style.css`.

### Web & Pinterest Reference Clipper
- **Direct Web & Pin Import (`POST /api/download-url`)**:
  - Resolves both direct image URLs and Pinterest URLs (`pinterest.com/pin/...`, `pin.it/...`, `i.pinimg.com`).
  - Fetches pin HTML with a desktop User-Agent, parses `<meta property="og:image">`, and upgrades thumbnail resolutions (`236x`, `474x`, `564x`, `736x`) to `originals` with automatic fallback.
  - Downloads binary image buffer, detects file extension (`.jpg`, `.png`, `.webp`), saves directly into the target deck's directory on disk (`pin_${Date.now()}.${ext}`).
  - Computes `ch_` content hash, registers it in `hashToPathMap`, invalidates folder metadata cache, and returns `{ success: true, image }`.
- **Deck Detail Clipper Bar (`#web-clipper-bar`)**:
  - Compact flex row with `#input-clip-url`, `#btn-clip-url` ("＋ Save to Deck"), and live status container `#clip-status-msg`.
  - Styled with `#1A1A1A` Munsell neutral surface, `1px solid #2E2E2E` hairline border, `4px` radius, and `#D97706` amber focus ring.
  - Automatically reloads deck images, migrates content-hash cards, updates deck stats, and provides tactile audio feedback (`SoundFX.chirp()`).

### Fast Content-Hashed Image Caching
- **Browser Cache-Control Header**:
  - In `GET /api/image`, when an image is requested via content hash (`?hash=`), sets `Cache-Control: public, max-age=86400` (24-hour immutable cache) for lightning-fast reference rendering.

### Sketch Storage Optimization & Startup Migration
- **Zero-Base64 SRS Database**:
  - Startup migration helper `migrateBase64SketchesOnStartup()` in `server.js` scans `userdata/srs_state.json` once on boot.
  - Any legacy inline `data:image/...` strings inside `attempt.sketchUrl` are written to disk as PNGs in `userdata/sketches/` and replaced with lightweight `/api/sketch/<filename>` references, keeping the SRS database compact.

### Clean Folder Path Presentation
- **Short Path Formatter (`UI.formatShortPath`)**:
  - Long absolute paths (e.g., `/Users/username/Desktop2/Art/references/pose`) are displayed cleanly as `~/Art/references/pose` across deck cards and headers while retaining the full path in the `title` tooltip.

### Performance & GPU Optimization
- All background bubbles, continuous particle canvas rendering, ambient aura blur orbs, and click DOM ripples completely removed.
- Near 0% idle GPU and CPU footprint for seamless background execution alongside heavy creative tools (Photoshop, Blender, ZBrush).

### macOS Window Chrome & Draggable Titlebars
- **Zero-Overlap Traffic Light Inset**:
  - `electron-main.js` aligns macOS native window controls at `trafficLightPosition: { x: 16, y: 14 }`, centering them vertically within the 44px topbar.
  - Headers (`.app-header`, `.deck-header`, `.session-header`) apply `padding-left: 84px !important;` on macOS Electron, providing a clean 16px buffer before the "Art Practice" logo and "← Back to Decks" / "← End Session" buttons.
  - Full-bleed titlebar styling with `-webkit-app-region: drag` enables dragging the Electron window by grabbing anywhere on the header background or titles, while all buttons and inputs retain `-webkit-app-region: no-drag` for crisp click responsiveness.

### Native Electron Always-on-Top Floating Mode (`/api/electron-float`)
- **Direct Window Transformation**:
  - Solved Electron's lack of standard W3C `documentPictureInPicture` support by transforming `mainWindow` itself into a compact (480×620), frameless Always-on-Top reference window over Blender/Photoshop via `setFloatingMode(mainWindow, true)`.
  - HTTP endpoint `POST /api/electron-float` in `server.js` triggers `toggleFloatMode(mainWindow)` in `electron-main.js`, hiding macOS traffic lights (`setWindowButtonVisibility(false)`) and caching window bounds for 1-click restore.
  - Features `#electron-float-bar` drag handle and instant "Restore" button (`#btn-electron-unfloat`), hotkey <kbd>V</kbd>, and menu shortcut <kbd>Cmd+Shift+A</kbd>.
  - Features Ghost Mode click-through overlay (<kbd>Cmd+Shift+G</kbd>) with 40% translucent opacity via `win.setOpacity(0.40)` and per-window opacity preservation/restoration via `windowGhostStates` WeakMap, custom vector SVG ghost iconography across `#ghost-mode-banner`, `#btn-electron-ghost`, and HUD toasts.
  - Seamless fallback to browser Document PiP and Safari canvas video streamer for web users.
- **Per-Window Floating State & Window Isolation (`windowStates` WeakMap)**:
  - Eliminated global state variables (`isWindowFloating`, `normalWindowBounds`, `isWindowAlwaysOnTop`, `isWindowGhostMode`).
  - Implemented independent per-window state using a `WeakMap<BrowserWindow, Object>` keyed by `BrowserWindow` instance.
  - Each window maintains its own independent floating state, previous normal bounds, and always-on-top level.
  - Child windows never share or overwrite the main window's saved bounds or toggle its state.
  - State is automatically collected on window close/destruction via `cleanupWindowState(win)`.
  - Application menu checkboxes (`menu-float-mode`, `menu-always-on-top`, `menu-ghost-mode`) strictly reflect the primary `mainWindow` state.

### Categorized Studio Tools Dock & Compact Window Ergonomics
- **Categorized Dock Organization (`#dock-category-bar`)**:
  - Grouped all 16 artist tools into 3 semantic categories plus an all-tools view:
    • `Tonal`: Value Check (`G`), Notan (`N`), Gesture Silhouette (`L`), Tonal Posterize (`P`), Squint Blur (`S`), Invert Colors (`I`).
    • `Critique`: Onion-Skin Overlay (`K`), Visual History (`Y`), Dominant Palette Swatches (`E`), Focal Crop (`C`), Quick Tag (`T`).
    • `Canvas`: Plumb & Angle Measurement (`U`), Proportion Grid (`O`), Flip Horizontal (`M`), Rotate 90° (`R`), Zoom controls (`－`, `100%`, `＋`).
  - 2×2 segmented grid switcher: Row 1 (`All`, `Tonal`), Row 2 (`Critique`, `Canvas`) on a 182px dock eliminates label overlapping and prevents button label truncation.
  - Active tool indicators (`.cat-indicator-dot`): amber notification dots light up next to category tabs when active tools run in background tabs.
- **Freely Hideable Tools Dock Even With Active Filters**:
  - Removed `.image-hud-dock:has(.filter-controls-dock:not(.hidden))` so active subpanels (Silhouette threshold, Posterize steps, Squint blur radius) never lock the dock open.
  - Clicking the arrow tab (`#btn-dock-toggle`), clicking the stage canvas, or pressing <kbd>Esc</kbd> smoothly slides the tools dock completely off-screen while keeping all active filters rendering on the artwork.
- **Auto-Hiding Bottom Rating Dock (`#session-rating-area`)**:
  - The rating area (Again, Hard, Good, Easy, Skip, and sketch dropzone) now behaves like the side dock: retracted down below the screen edge by default (`translateY(100%)`).
  - Sleek `[ ▲ Rate ]` arrow tab (`#btn-rating-toggle`) rests at the bottom edge. Clicking it slides the rating tray smoothly up (`translateY(0)`) and flips the arrow to `[ ▼ Hide ]`.
  - When the timer expires, the rating tray automatically slides up into view; rating advances to the next card and automatically slides the tray back down into hiding.
  - Gives the reference artwork **100% full screen height** throughout the entire study session with zero visual obstruction.
  - In Floating Mode / Document PiP, `#btn-rating-toggle` (`.rating-toggle-tab`) is completely hidden, preventing the `^ Rate` tab from protruding over the reference or floating pill. The rating pill reveals smoothly on hover or timer expiry.
  - The `[1]` keybind badge on the Again button is reset from absolute to static flex flow (`position: static`), eliminating badge-over-text collision.

### Hardened Electron Popup & Child Window Security
- **Strict Origin Verification (`isTrustedAppUrl`)**:
  - Validates all internal navigations and popups against the exact active Express port (`http://localhost:${port}` or `http://127.0.0.1:${port}`).
  - Rejects arbitrary localhost ports (e.g. 8080, 5000), deceptive domains (`localhost.evil.com`), and non-HTTP schemes.
- **Preload Least-Privilege & Child Window Sandbox (`child-preload.js`)**:
  - Child / PiP windows are stripped of privileged host APIs (`pickDirectory`, window mutation). Only minimal unprivileged metadata (`isElectron: true, isChildWindow: true`) is exposed.
  - Enabled Chromium process sandbox (`sandbox: true`) across both `mainWindow` and child windows alongside `contextIsolation: true` and `nodeIntegration: false`.
- **Safe External Link Protocol Whitelist (`safeOpenExternal`)**:
  - Replaced unvalidated `shell.openExternal(url)` calls with strict protocol validation: only `http:` and `https:` schemes are permitted. Dangerous schemes (`file:`, `javascript:`, `data:`, `shell:`, `applescript:`) are blocked and logged.
- **Navigation & Redirect Lock (`will-navigate` & `will-redirect`)**:
  - Both main and child window webContents register `will-navigate` and `will-redirect` guards preventing renderer frames from ever navigating away to untrusted external origins. Unexpected external navigations/redirects are cancelled and safely delegated to the OS default browser.
- **Zero-Trust Permission Handlers (`setPermissionRequestHandler` & `setPermissionCheckHandler`)**:
  - Registered on `session.defaultSession` to automatically deny all device, sensor, camera, microphone, notification, and hardware access requests across all windows.
- **IPC Sender Validation (`isTrustedIpcSender`)**:
  - All sensitive IPC handlers (`dialog:pick-directory`, `toggle-float-mode`, `set-always-on-top`) validate the sender's frame origin and verify that directory picker dialogs can only ever be requested by the primary `mainWindow`.

---

## Development Guide

1. Multi-file modular architecture permitted: Frontend code can be organized across modular files (e.g. `public/js/` or feature-specific modules) instead of being restricted to a single monolithic `app.js`.
2. Views are toggled via `.active` class on `.view` divs
3. Modals use `.hidden` class toggle on `.modal-overlay` divs
4. To add a new feature, typically: add HTML element → add CSS → add JS handler in respective module
5. Server restart needed only when changing `server.js` or `electron-main.js` (frontend changes are live-reload via browser refresh)

---

*Last updated: 2026-11-08*
