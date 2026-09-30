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
- [x] **Safe Git baseline**: original code committed safely to git
- [x] **Core Philosophy**: documented in memory.md and PROJECT_MEMORY.md

---

## Completed Upgrades: Living Atmosphere, Custom Wallpaper System & Artist QoL
- [x] **Philosophy Alignment**: artist flow state, visual immersion, zero-friction shortcuts
- [x] **Living Atmosphere & Rich Aesthetics**:
  - Interactive stardust / dust mote particle canvas with mouse parallax
  - Tactile spark micro-bursts on element clicks and hotkey presses
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
  - Proportion grid overlay (`O`)
  - Smooth drag-to-pan & mouse-wheel zoom
  - Invert color mode (`I`)
  - Horizontal flip / mirror (`M`)
  - 90° image rotation (`R`)
  - Distraction-free zen fullscreen (`F`)
  - Quick deck search & sorting
  - Keyboard shortcuts cheat sheet modal (`?`)
  - Session complete celebration & summary modal
  - Backup & restore (Export/Import JSON)


---

## Architecture Notes

### SRS Algorithm
The spaced repetition uses a simplified SM-2 variant:
- Each card stores: `interval` (days), `easeFactor` (multiplier), `dueDate`, `reviewCount`
- On rating, the new interval = f(previousInterval, easeFactor, difficulty)
- Ease factor is bounded [1.1, 3.0]
- Minimum interval is always 1 day

### Data Model
```
Deck: { id, name, folderPath, createdAt }
Card: { imageId, imageName, difficulty, interval, easeFactor, dueDate, reviewCount, lastReviewDate, firstReviewDate }
```

### API Design
- Server is stateless — all state lives in localStorage on the client
- Server only provides file system access (read directories, serve images)
- No authentication (local-only app)

---

## Development Guide

1. All frontend code is in a single `app.js` file with clearly labeled modules
2. Views are toggled via `.active` class on `.view` divs
3. Modals use `.hidden` class toggle on `.modal-overlay` divs
4. To add a new feature, typically: add HTML element → add CSS → add JS handler in UI module
5. Server restart needed only when changing `server.js` (frontend changes are live-reload via browser refresh)

---

*Last updated: 2026-09-22*
