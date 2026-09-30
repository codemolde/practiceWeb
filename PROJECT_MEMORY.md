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
  - Hard: 1d initial, subsequent = interval × 0.5 (min 1d), ease − 0.2
  - Medium: 3d initial, subsequent = max(interval + 1d, interval × ease)
  - Easy: 7d initial, subsequent = max(interval + 2d, interval × ease × 1.3), ease + 0.15
- [x] **Review history heatmap**: GitHub-style calendar heatmap per deck
  - Green gradient: past days colored by review count
  - Grey gradient: future days colored by scheduled review count
  - Tooltip on hover showing date + count
  - Auto-scrolls to today
- [x] **Activity stats**: daily average, days learned %, longest streak, current streak
- [x] **Today's Reviewed button**: shows list of cards reviewed today with difficulty + next review date
- [x] **Daily Limits (Anki-style)**: configure Max New Cards/Day and Max Reviews/Day per deck
  - UI shows how many new/review cards are left for today based on these limits
  - Separate "Study New", "Review Due", and "Free Study" buttons
- [x] **Keyboard shortcuts**: 1/2/3 = rate, S = skip, Space = pause timer
- [x] **Audio beep**: plays when timer ends
- [x] **Data persistence**: localStorage survives refreshes
- [x] **Review history tracking**: `ReviewHistory` module tracks daily new/review counts per deck in `artpractice_history`

---

## Known Bugs

- **FIXED**: Timer pause button showing "Resume" after rating — now resets to "Pause" on each new image

---

## Planned Features / Ideas

- [ ] **Export/Import data**: backup/restore decks + card history as JSON
- [ ] **Session statistics**: show session summary after ending (cards rated, time spent)
- [ ] **Image zoom**: click to enlarge/zoom into the reference image
- [ ] **Deck sorting**: sort decks by name, due count, or date created
- [ ] **Tag system**: tag images within a deck for sub-categories
- [ ] **Fullscreen mode**: distraction-free practice mode
- [ ] **Custom SRS intervals**: let user configure base intervals per deck (multiplier/ease bounds)
- [ ] **Dark/light theme toggle**: currently dark-only

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
