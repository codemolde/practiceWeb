# Manual Verification Checklist (MANUAL-NOT-RUN)

This file documents end-to-end user-interaction scenarios in the real Electron desktop application that cannot be fully exercised headlessly without native OS display and window server interaction.

Status: **MANUAL-NOT-RUN** (Do not mark as passed until manually verified by the user in the packaged/running application).

---

### Check 1: Create Deck and Open It
- **Steps**:
  1. Launch the app (`npm run electron`).
  2. Click **Create Deck** / **+**.
  3. Select a local folder containing reference images using the native OS directory picker.
  4. Name the deck and save it.
  5. Open the newly created deck and verify the grid of reference images renders without errors or 403 Forbidden responses.
- **Expected**: Native file picker opens, deck is saved to `userdata/srs_state.json`, and image thumbnails load with proper CSP/MIME headers.

---

### Check 2: Clip a Pinterest Image
- **Steps**:
  1. Open a deck in the application.
  2. Copy a direct Pinterest image URL (or drag an image from Pinterest into the web clipper / download input).
  3. Trigger the image clip / download.
- **Expected**: The backend validates the destination folder (must be inside registered deck path), enforces SSRF protections (ports 80/443 only), strips the Referer header to bypass hotlink blocking, downloads the image, and immediately displays it in the deck.

---

### Check 3: Rate then Quit then Relaunch (Persistence Check)
- **Steps**:
  1. Start a practice/study session in any deck.
  2. Study an image and rate it using one of the SRS buttons (**Again**, **Hard**, **Good/Medium**, or **Easy**).
  3. Quit the app completely using **Cmd+Q** (macOS) or **Alt+F4** / File -> Quit.
  4. Relaunch the app (`npm run electron`).
  5. Check the deck overview and today's review counts.
- **Expected**: The rated card retains its updated interval, ease factor, lapses, and due date. No progress is lost. Daily snapshot and backup files in `userdata/` remain intact and uncorrupted.

---

### Check 4: Float / Always-on-Top / Ghost On then Relaunch (Window State Persistence)
- **Steps**:
  1. Open a reference image.
  2. Enable **Always-on-Top** (or Float Mode). Verify window stays above all other desktop applications.
  3. Enable **Ghost Mode** (`Cmd+Shift+G` on macOS). Verify translucency / click-through activates.
  4. Use the system Tray icon or hotkey to exit Ghost Mode or test the 60-second failsafe.
  5. Quit the app while in float mode and relaunch.
- **Expected**: Window reopens cleanly with valid coordinates (no zero-size or off-screen positioning), menu state reflects current window only, and Ghost click-through is never stuck active across restarts.

---

### Check 5: Wallpaper Drag-and-Drop
- **Steps**:
  1. Drag an image file (PNG, JPG, WebP) from the native file manager (Finder / File Explorer) onto the app canvas / background.
  2. Drop the file.
- **Expected**: The application accepts the dropped file, saves it to the custom wallpaper store, updates the background immediately, and displays a confirmation toast (`Custom wallpaper applied`).

---

### Check 6: Backup Import Confirmation Dialog
- **Steps**:
  1. Click the **Backup & Restore** button in settings/header.
  2. Export a backup JSON file.
  3. Attempt to import a backup file.
- **Expected**: A confirmation modal displays the incoming and existing deck & card counts (`"Importing this backup will replace current progress..."`). Confirming restores data cleanly; cancelling leaves existing data untouched. A malformed backup or payload containing unsafe URLs (e.g. `javascript:`) is rejected with a visible alert toast.

---

### Check 7: Whole-Display Native Fullscreen
- **Steps**:
  1. Start a practice/study session in any deck.
  2. Click the **Fullscreen** button in the header (or press **F**).
  3. Verify the Electron window expands to take over the entire display (hiding macOS traffic lights, top menu bar, and desktop dock/wallpaper).
  4. Move the mouse to verify controls wake up and auto-hide on idle.
  5. Press **Esc** or click the **Exit** button (or press **F**).
- **Expected**: The app enters OS-level fullscreen space filling 100% of the display. Exiting restores the window cleanly to its previous dimensions and coordinates.

