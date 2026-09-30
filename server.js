const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Supported image extensions
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.tif'
]);

/**
 * Recursively scan a directory for image files.
 * Returns an array of absolute file paths.
 */
function scanForImages(dirPath, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden directories
      if (!entry.name.startsWith('.')) {
        scanForImages(fullPath, results);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * GET /api/browse?path=<absolute_path>
 * Lists subdirectories and image count at a given path.
 * Defaults to user's home directory if no path given.
 */
app.get('/api/browse', (req, res) => {
  const os = require('os');
  const requestedPath = req.query.path || os.homedir();
  const resolved = path.resolve(requestedPath);

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: `Path not found: ${resolved}` });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `Not a directory: ${resolved}` });
  }

  let entries;
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (err) {
    return res.status(403).json({ error: `Cannot read directory: ${err.message}` });
  }

  const dirs = [];
  let imageCount = 0;

  for (const entry of entries) {
    // Skip hidden files/dirs
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      dirs.push(entry.name);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        imageCount++;
      }
    }
  }

  dirs.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  res.json({
    current: resolved,
    parent: path.dirname(resolved),
    dirs,
    imageCount
  });
});

/**
 * GET /api/images?folder=<absolute_path>
 * Returns JSON array of image file paths found in the given folder (recursive).
 */
app.get('/api/images', (req, res) => {
  const folderPath = req.query.folder;

  if (!folderPath) {
    return res.status(400).json({ error: 'Missing "folder" query parameter' });
  }

  // Resolve to absolute path
  const resolved = path.resolve(folderPath);

  // Check if the directory exists
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: `Folder not found: ${resolved}` });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `Not a directory: ${resolved}` });
  }

  const images = scanForImages(resolved);

  // Return relative display names along with a unique ID (the full path)
  const result = images.map(imgPath => ({
    id: imgPath,
    name: path.relative(resolved, imgPath),
    folder: resolved
  }));

  res.json(result);
});

/**
 * GET /api/image?path=<absolute_path>
 * Serves a single image file from disk.
 */
app.get('/api/image', (req, res) => {
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'Missing "path" query parameter' });
  }

  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: `File not found: ${resolved}` });
  }

  // Determine MIME type
  const ext = path.extname(resolved).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.sendFile(resolved);
});

app.listen(PORT, () => {
  console.log(`\n  Art Practice Reference App running at:`);
  console.log(`  → http://localhost:${PORT}\n`);
});
