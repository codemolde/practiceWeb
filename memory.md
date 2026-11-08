# Art Practice Reference App — Memory & Architecture

> **Purpose**: This file tracks the philosophy, state, design principles, and roadmap of the Art Practice Reference App. Keep this file updated during all development and architectural iterations.

---

## 🎨 Website Philosophy & Core Design Principles

1. **Unbroken Artist Flow State**:
   - Art practice—gesture sketching, anatomy drilling, speed painting, and master studies—relies on high-focus flow.
   - UI elements must never intrude or delay drawing. Transitions should be silky smooth, feedback immediate, and controls accessible via single-key hotkeys (e.g., Space to pause, 1/2/3 to rate, G for grayscale, M for mirror/flip, # for grid, F for fullscreen).

2. **Visual Immersion & Studio Atmosphere**:
   - Artists are hyper-sensitive to lighting, contrast, and visual environment.
   - The interface features a dark, glassmorphic studio aesthetic with a **User-Custom Background Wallpaper System**:
     - Allows artists to upload/choose any wallpaper image directly from their local machine or via image URL.
     - Stored reliably in browser storage (IndexedDB) with zero size constraints.
     - Live customizable controls: Blur slider (0-30px) and Dark Dimming/Overlay slider (10-90%) so background art never clashes with or distracts from the reference image being studied.
     - Reset/Remove option to return to clean default dark studio slate.
   - Micro-animations, glowing accents, and subtle tactile cues give the app a premium, inspiring physical feel without causing visual clutter.

3. **SRS (Spaced Repetition) for Visual Memory**:
   - Building a "visual library" (memory of anatomy, forms, dynamic angles, drapery, lighting) requires active recall and spaced intervals.
   - The app combines timed reference drills with an Anki-inspired SM-2 spaced repetition engine, heatmap tracking, and daily limits to keep habits sustainable and prevent artist burnout.

4. **Dedicated Artist Quality-of-Life (QoL) Tools**:
   - **Value Check / Grayscale**: Desaturates reference instantly to diagnose tonal contrast and light/shadow hierarchy.
   - **Proportion Grid Overlay**: Toggleable 3x3 or multi-grid rule lines to check angles, alignments, and negative space.
   - **Mirror / Flip**: Rapid horizontal mirroring to expose anatomical distortion and drawing blind spots.
   - **Smooth Zoom & Pan**: Fluid zoom and drag-to-pan to study intricate details (eyes, hands, folds).
   - **Distraction-Free Zen Fullscreen**: Clean, edge-to-edge view where only the reference and subtle HUD remain visible.
   - **Local-First Vector Studio Icon System**:
     - 53 bespoke stroke-based vector icons matching the dark Atelier palette stored in `assets/` and `public/assets/`.
     - Complete removal of system emojis across the entire project (HTML, JS, CSS, backend) for a consistent, professional desktop studio experience.
     - Preserved the multi-layered `assets/Flame.svg` and `assets/due.svg`.
     - Centralized SVG generator `UI.getIconSvg(name, size, className)` and `UI.getFlameSvgHTML()`.
   - **Session Summary & Celebrations**: Rewarding feedback when practice sessions wrap up, reinforcing daily drawing habits.

5. **Local-First, Privacy & Speed**:
   - All references stay on local disk. No slow uploads, no accounts, zero cloud dependencies.
   - Instant folder scanning and lightweight client-side state in `localStorage` with JSON export/import backup capabilities.

---

## 🏗️ Architecture & Tech Stack

- **Backend**: Node.js + Express (`server.js`)
  - Endpoints:
    - `GET /api/browse?path=` — Interactive folder browser listing subdirectories and image counts
    - `GET /api/images?folder=` — Recursive image scanner returning structured paths
    - `GET /api/image?path=` — High-performance image streaming with proper MIME types
- **Frontend**: Vanilla HTML5, CSS3, Modern JavaScript (ES6+ modular design)
  - `public/index.html` — SPA structure with Deck List, Deck Detail, and Practice Session views + Modals
  - `public/style.css` — Modern design system: CSS variables, glassmorphism, fluid typography, smooth keyframe animations, responsive grid
  - `public/app.js` — Modular controllers:
    - `Storage`: LocalStorage persistence + JSON backup/restore
    - `DeckManager`: Deck CRUD, folder linkage, and daily goal limits
    - `CardManager`: SRS scheduling algorithm (Hard, Medium, Easy with adaptive ease)
    - `ReviewHistory`: Heatmap analytics, daily activity, and streak tracking
    - `TimerManager`: Countdown with audio feedback, warning states, and blur timeout
    - `SessionManager`: Session queues (Study New, Review Due, Free Study)
    - `ThemeManager`: Dynamic background wallpapers (presets, custom images, blur/dim sliders)
    - `ArtistToolbox`: Grayscale filter, proportion grid, flip, rotate, zoom & pan, fullscreen
    - `UI`: View management, animations, keyboard events, and modal dialogs

---

## 📋 Feature Tracking & Roadmap

### Features Implemented
- [x] Git baseline repository initialized
- [x] Dedicated `memory.md` preserving philosophy and system architecture
- [x] Deck creation, editing, deletion with interactive folder browser
- [x] 4-Button Spaced Repetition Grading (SM-2: Again <10m / Hard / Good / Easy with in-session re-queue)
- [x] GitHub-style activity heatmap & streak stats
- [x] Daily limits (New cards / Review cards)
- [x] Basic timer with blur timeout
- [x] **User-Custom Background Wallpaper System**:
  - Add personal wallpaper images directly from local computer (file upload or drag & drop)
  - Image URL loading support
  - Real-time live Blur slider (0px to 30px) for non-distracting visual depth
  - Real-time live Dimming / Overlay opacity slider (10% to 90%)
  - Remove / Reset to default dark studio slate
  - Persistent in IndexedDB for fast, reliable local storage without size limits
- [x] **Artist Quality of Life (QoL) Suite**:
  - Grayscale / Value Check mode (`G`)
  - Notan Mode (2-Value harmonic black & white study) (`N`)
  - Silhouette Mode (`L` / `H`): thresholding subject against background to test gesture clarity, line of action, and negative space with dynamic threshold slider (5–95%) and dark/light silhouette inversion
  - 3-Value & Dynamic Posterize Mode (`P`): hardware-accelerated SVG `feComponentTransfer` discrete filter (`0 0.5 1`) for foundational 3-value light/halftone/shadow atelier studies, plus dynamic 2–6 step discrete slider and live tonal chips
  - Proportion Grid Overlay (`O`)
  - Color Inversion for silhouette & negative space check (`I`)
  - Smooth Zoom & Drag-to-Pan (Mouse wheel + mouse drag)
  - Horizontal Flip / Mirroring (`M`)
  - 90° Image Rotation (`R`)
  - Vertical side toolbar dock: moves artist controls into the empty side space vertically with grouped dividers and compact zoom row, preventing tools from overlapping the top of reference artwork
  - Always-on-Top Floating PiP Mode (`V`):
    - In Chromium (Chrome, Edge, Arc, Brave): Document Picture-in-Picture API (`window.documentPictureInPicture`) creates an OS-level floating window (`NSFloatingWindowLevel`) that sits permanently on top of all desktop apps with interactive HTML controls, vertical toolbar, and rating buttons.
    - In Apple Safari & macOS: Apple does not support Document PiP, causing standard popups to hide behind background apps. Solved via Native macOS Video Picture-in-Picture (`PiPCanvasStreamer`) streaming a 720×840 canvas to `<video>.requestPictureInPicture()`. macOS WindowServer locks this native PiP window permanently on top of Photoshop, Blender, and VS Code. Features live countdown timer bar, pixel-manipulation filters (Grayscale, Notan, Silhouette, Posterize, Invert), proportion grid, MediaSession controls, and a 1-click switcher to detachable popup mode.
    - Transparent DOM Proxy (`PiPState`): routes all DOM queries to the detached window when active.
    - Responsive rating overlay: floating pill dock with auto-dimming and multi-tier collapse down to circular badges for ultra-compact narrow viewports.
  - Bubble Toggle & Zero-GPU Eco Mode (`B` / header buttons):
    - Dedicated toggle in all views + hotkey [B] to turn particle canvas off completely.
    - Shuts down render loops and pauses aura animations, reducing CPU and GPU usage to 0.0%. Persists in localStorage.
  - Frame Rate Limiter (FPS Limiter):
    - Selectable frame rate limits: 30 FPS (Eco), 60 FPS (Balanced default), 120 FPS (High), 144 FPS (Max).
    - Precision timestamp-throttled requestAnimationFrame replaces battery-draining intervals.
  - Distraction-Free Zen Fullscreen Mode (`F`)
  - Keyboard shortcuts cheat sheet modal (`?`)
  - Quick deck search and sort bar
  - Session complete celebration & summary modal
  - JSON Data Export / Import backup
- [x] **Living Atmosphere & Tactile Interactions**:
  - Multi-layer drifting ambient aura orbs with soft radial gradients and glowing neon teal/cyan accents
  - **Lite & Transparent Soap Bubbles**: 11-30px floating glassy membranes with crystal transparency (0.03-0.12 center alpha), delicate 1.0px iridescent rims, and specular crescent glints
  - **Soft Jelly & Bouncy Elastic Deformation**: Bubbles squish into volume-preserving ellipses upon cursor proximity, mutual bubble collisions, or shockwaves, softly bouncing and wobbling back into shape
  - **Fluid Cursor Mechanics**: Aerodynamic liquid droplet following mouse with viscous fluid drag, shedding delicate expanding fluid micro-wake ripples (eddies) as the cursor travels through water
  - **Hydrodynamic Wake & Soft Repulsion**: Smooth sinusoidal spring cushion push and wake suction trailing the cursor
  - **Bioluminescent Constellation Web**: Connecting filaments between nearby bubbles and attraction beams to cursor
  - **Shockwave Blasts on Click**: Expanding luminous shockwave rings that physically scatter and softly deform nearby bubbles outward
  - **Highlighting Click Sparkle Bursts**: 4-point rotating diamond star sparkles (`✦`) and fluid droplet trails on click
  - **Fluid Expanding Button Ripples**: `.fluid-ripple` expanding glowing wave centered at click coordinates
  - **Robust Synthesized Fluid Click Audio**: Resonant water droplet bloop + crystal glass ping + warm tactile sub-body with async AudioContext unlocking, clear volume, and global background click playback
  - **Silky Fluid Hover Audio**: Feather-light water drop blips on buttons, cards, and toolbars
  - Confetti & celebration fireworks shower on session completion and Easy ratings
  - Dynamic 3D card tilt with specular spotlight mouse glare
  - Synthesized Web Audio API sound FX (fluid button clicks, card hover ticks, melodic rating tones, timer warnings, singing bowl gong, celebration fanfare)
  - Dedicated sound toggle (`U` hotkey, header buttons) with persistent mute state
  - Living breathing streak flame animation (`🔥`)
  - Dynamic timer pulse (warning amber glow <= 10s, pulsing crimson danger <= 5s with audio ticks)
  - Physical button depression and on-screen hotkey active state feedback
- [x] **Sub-Deck Tagging & Focus Filters**:
  - In-session quick tagging dock opened via hotkey <kbd>T</kbd> or side toolbar tag button (`#btn-art-tag`)
  - Direct 1-key preset toggles (`1` hands, `2` foreshortening, `3` lighting, `4` anatomy, `5` gesture, `6` leech) and custom tag input with <kbd>Enter</kbd>
  - Active tags rendered under reference image as clickable tag pills (`#session-card-tags`)
  - Sub-Decks & Focus Filters section on Deck Detail view (`#deck-focus-section`) with tag pill buttons and card count badges
  - One-click study session filtering: `Study New`, `Review Due`, and `Free Study` queue dynamically filtered to matching cards without moving files on disk
  - Active sub-deck tag displayed in session header and mode badges
- [x] **Lightweight Performance & Zero GPU Overhead**:
  - Removed all background bubbles, continuous particle canvas rendering, shockwaves, click sparks, and fluid wake
  - Removed continuous ambient aura blur animations (`#ambient-aura` / `.aura-orb`)
  - Removed DOM click ripples (`.fluid-ripple`)
  - Clean, minimal GPU & CPU consumption ideal for running smoothly alongside Photoshop, Blender, or heavy 3D apps
- [x] **Disk-Backed State Persistence (`userdata/srs_state.json`)**:
  - Replaced browser 5MB `localStorage` limit with persistent disk storage in `userdata/srs_state.json`
  - `POST /api/sync` and `GET /api/sync` endpoints in [server.js](file:///Users/dakshbeniwal/Desktop2/practiceWeb/server.js) with 50MB payload support and atomic writes
  - Automatic background sync after every practice session (`UI.endSession()`, `UI.openSessionSummaryModal()`), card rating, and on page unload
  - Seamless auto-migration of existing `localStorage` data on startup so existing decks and review logs are never lost
- [x] **Content-Hash Card IDs (File-Move Resilience)**:
  - Cards are keyed by content hash (`ch_` + SHA-1 of `file size + first 64KB`) instead of absolute file paths
  - Survives moving files between subfolders, renaming files, or reorganizing reference libraries without losing review history, ease factors, intervals, or sub-deck tags
  - In-memory `fileHashCache` in [server.js](file:///Users/dakshbeniwal/Desktop2/practiceWeb/server.js) ensures ultra-fast ~0.02ms hashing per file
  - `GET /api/image` supports both `?path=` and `?hash=` lookups seamlessly via `hashToPathMap`
  - Automatic on-the-fly migration in [public/app.js](file:///Users/dakshbeniwal/Desktop2/practiceWeb/public/app.js) (`CardManager.migrateLegacyPathCards`) upgrades existing path-based cards on view or study start
- [x] **Always-on-Top Floating Mode**:
  - Document Picture-in-Picture (`window.documentPictureInPicture`) + dual HTML5 Canvas video stream fallback for Safari / macOS
  - Compact tactile floating rating dock and MediaSession global hotkey integration
- [x] **Onion-Skin Sketch Overlay (Self-Critique Tool)**:
  - Instant paste (<kbd>Cmd+V</kbd> / <kbd>Ctrl+V</kbd>) and drag-and-drop ingestion of finished digital sketches
  - Integrated into Time's Up blur card with single-click "Paste Sketch" and "Unblur Reference" actions
  - Difference Blend Mode (`mix-blend-mode: difference`): Identical proportions cancel into black; anatomical/silhouette errors illuminate in vibrant contrast
  - Normal (onion-skin opacity) and Multiply modes (clean overlay for sketches on white canvas)
  - Live Opacity Slider (0% - 100%) and Aspect Fit toggle (Fill 1:1 vs Contain)
  - Single-key flicker test (<kbd>K</kbd>) to rapidly toggle sketch visibility and reveal subtle proportion drift
  - Full transform synchronization (zoom, pan, rotation, mirror) and dual PiP compatibility (Document PiP + Canvas Streamer)
- [x] **Sketch Comparison & Visual History**:
  - Side-by-side comparison of your sketch directly next to the unblurred reference on the rating screen (<kbd>Cmd+V</kbd> or drag-and-drop)
  - Automatically saves sketches to disk in `userdata/sketches/` on rating via `POST /api/sketch-history` without bloating JSON or localStorage
  - Visual history tabs (`#1 (Hard)`, `#2 (Medium)`, `★ Today`) accessible on future review days via hotkey <kbd>Y</kbd> to track drawing progress over time
- [x] **Color & Palette Extraction HUD (<kbd>E</kbd>)**:
  - Dominant Light & Shadow Harmony: fast 5-bit color clustering extracts 6-7 harmonized dominant swatches from active reference photo via offscreen canvas pixel analysis
  - Swatches automatically sorted by perceptual value lightness ($Y = 0.299R + 0.587G + 0.114B$) from highlights to core shadows with Munsell-style Value % tag, HEX, and Warm/Cool classification
  - Live HSB/Value Eyedropper on hover: exact inverse transform math accounts for zoom, pan, rotation, and horizontal flip; updates floating `#eyedropper-loupe` near cursor with live preview circle, temp badge, HEX, and HSB metrics ($H^\circ, S\%, B\%$)
  - Clicking stage saves sampled colors to Sampled Study Colors bar (up to 12 custom swatches) and copies HEX to clipboard
- [x] **Smart Crop / Focal Point Zoom Cards (<kbd>C</kbd>)**:
  - Drag an interactive selection box over hands, face, drapery, or lighting to spawn focal child cards with topic tags (`#hands`, `#face`, `#drapery`, `#lighting`, `#feet`, `#foreshortening`)
  - Zero-disk duplication: references parent `imageId`/hash and path while storing normalized crop coordinates `{ x, y, w, h }` (0.0 to 1.0)
  - Independent SRS schedule: child cards have their own interval, ease factor, repetition count, and due dates, integrated into Study New, Review Due, and Free queues
  - Auto-framing & context toggle (<kbd>Shift+C</kbd>): auto-zooms and pans directly to focal crop during review; pressing <kbd>Shift+C</kbd> flips seamlessly between zoomed focal crop and full reference context
- [x] **Zero-Load GPU & Battery Optimization**:
  - Eliminated continuous CSS repaint loops (`todayCellPulse`, `flameFlicker`, `imageShimmer`, `timerBarShimmer`, `floatBounce`, `progressSweep`) that pinned Firefox GPU Helper at 83.3% GPU and WindowServer at 46.9% CPU while idle
  - Replaced infinite pulsing on heatmap today cell with a crisp, static outline (`outline: 2px solid var(--accent)`), reducing idle redraws to 0 FPS
  - Removed full-screen redundant blur on `.wallpaper-overlay` and stripped `will-change: transform, filter, opacity` from `.wallpaper-bg`, allowing Firefox WebRender to cache the blurred background texture in VRAM
  - Removed heavy `backdrop-filter: blur(...)` across 30+ UI elements, adopting crisp, professional dark atelier backgrounds (`rgba(22, 27, 34, 0.92)`)
  - Optimized 3D card tilt with cached bounding rects and `requestAnimationFrame` throttling to eliminate layout thrashing during mouse movement
- [x] **Web & Pinterest Reference Clipper**:
  - `POST /api/download-url` in `server.js` resolves Pinterest pin URLs (`pinterest.com/pin/...`, `pin.it/...`) and direct web image URLs.
  - Automatically fetches og:image metadata, upgrades thumbnails to `originals`, downloads binaries to the deck folder on disk, and computes `ch_` content hashes.
  - Styled studio clipper bar (`#web-clipper-bar`) in deck detail view with Enter-key submit, tactile audio feedback, automatic deck stats refresh, and content-hash migration.
- [x] **Content-Hash Browser Caching & Zero-Base64 Disk Migration**:
  - `GET /api/image?hash=...` sets `Cache-Control: public, max-age=86400` for instant local caching of reference images.
  - Startup migration helper `migrateBase64SketchesOnStartup()` converts legacy inline `data:image/...` strings in `srs_state.json` to `.png` files in `userdata/sketches/`, keeping SRS state lightweight.
- [x] **Atelier Studio Vector Icons & Zero-Emoji Standard**:
  - 53 custom studio vector icons in `assets/` and inline SVG renderers (`UI.getIconSvg`, `UI.getFlameSvgHTML`, `UI.getDueSvgHTML`).
  - Total 0 system emojis across all project files (`index.html`, `app.js`, `style.css`, `server.js`).
- [x] **macOS Electron Window Chrome & Draggable Headers**:
  - Shifted traffic lights to `{ x: 16, y: 14 }` with `84px` left padding on `.app-header`, `.deck-header`, and `.session-header`, completely eliminating button and logo overlap.
  - Full-width draggable window headers (`-webkit-app-region: drag`) with interactive controls set to `no-drag`.
- [x] **Native Electron Always-on-Top Floating Mode (`/api/electron-float`)**:
  - Express endpoint `/api/electron-float` connected to Electron main process `toggleFloatMode()`.
  - Turns `mainWindow` itself into a compact (480×620), frameless Always-on-Top reference window over Blender/Photoshop with 1-click restore.
- [x] **Categorized Studio Tools Dock & Freely Hideable Overlay**:
  - Grouped all 16 artist tools into 3 semantic categories (`Tonal`, `Critique`, `Canvas`) plus `All` with a 2×2 segmented switcher (`#dock-category-bar`), eliminating label overlap and text truncation.
  - Removed CSS forced-reveal selectors (`:has(.filter-controls-dock:not(.hidden))`), allowing artists to freely slide the tools dock completely off-screen via arrow toggle or canvas click even while filters (Silhouette, Posterize, Squint) are actively rendering.
  - Dock and toolbar clamped strictly to stage boundaries (`max-height: calc(100% - 16px); overflow-y: auto`), eliminating toolbar overflow in both window and float modes.
- [x] **Auto-Hiding Bottom Rating Dock (`#session-rating-area`)**:
  - Rating controls (Again, Hard, Good, Easy, Skip) retracted below the screen edge by default (`translateY(100%)`) with a sleek `[ ▲ Rate ]` toggle tab at the bottom edge.
  - Gives the reference artwork **100% full screen height** during active study.
  - Clicking the tab slides the tray smoothly up (`translateY(0)`); when the timer expires, the tray automatically reveals for instant rating and slides back down upon advancing cards.

---

*Last updated: 2026-11-08*
