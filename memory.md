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
- [x] Spaced repetition scheduler (SM-2 variant: Hard / Medium / Easy)
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
  - Proportion Grid Overlay (`O`)
  - Color Inversion for silhouette & negative space check (`I`)
  - Smooth Zoom & Drag-to-Pan (Mouse wheel + mouse drag)
  - Horizontal Flip / Mirroring (`M`)
  - 90° Image Rotation (`R`)
  - Distraction-Free Zen Fullscreen Mode (`F`)
  - Keyboard shortcuts cheat sheet modal (`?`)
  - Quick deck search and sort bar
  - Session complete celebration & summary modal
  - JSON Data Export / Import backup
- [x] **Living Atmosphere & Tactile Interactions**:
  - Multi-layer drifting ambient aura orbs with soft radial gradients
  - Interactive stardust / studio dust motes on Canvas with subtle mouse parallax
  - Tactile spark micro-bursts on element clicks and hotkey presses
  - Confetti & celebration fireworks shower on session completion and Easy ratings
  - Dynamic 3D card tilt with specular spotlight mouse glare
  - Synthesized Web Audio API sound FX (soft button clicks, card hover ticks, melodic rating tones, timer warnings, singing bowl gong, celebration fanfare)
  - Dedicated sound toggle (`U` hotkey, header buttons) with persistent mute state
  - Living breathing streak flame animation (`🔥`)
  - Dynamic timer pulse (warning amber glow <= 10s, pulsing crimson danger <= 5s with audio ticks)
  - Physical button depression and on-screen hotkey active state feedback

---

*Last updated: 2026-09-30*
