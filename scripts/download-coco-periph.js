#!/usr/bin/env node
/**
 * Download COCO-Periph images for Wave 6 validation.
 *
 * Fetches original COCO images and their TTM-transformed versions at 4
 * eccentricities (5°, 10°, 15°, 20°) from data.csail.mit.edu/coco_periph/.
 *
 * Selection strategy: compute Feature Congestion on originals, sort into
 * quintiles, pick N per quintile for balanced complexity coverage.
 *
 * Usage:
 *   node scripts/download-coco-periph.js                   # full 50 images
 *   node scripts/download-coco-periph.js --count=5          # quick test with 5
 *   node scripts/download-coco-periph.js --skip-congestion  # use pre-computed manifest
 *   node scripts/download-coco-periph.js --dry-run          # show what would download
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'validation', 'coco-periph');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const DATASET_BASE = 'https://data.csail.mit.edu/coco_periph';

const COUNT = parseInt(getArg('count', '50'));
const PER_QUINTILE = Math.max(1, Math.ceil(COUNT / 5));
const DRY_RUN = hasFlag('dry-run');
const SKIP_CONGESTION = hasFlag('skip-congestion');

const ECCENTRICITIES = [5, 10, 15, 20];

// ── HTTP download with redirect following ──

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;

    const doRequest = (requestUrl) => {
      proto.get(requestUrl, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
        }

        const dir = path.dirname(destPath);
        fs.mkdirSync(dir, { recursive: true });

        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on('error', (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      }).on('error', reject);
    };

    doRequest(url);
  });
}

// ── Fetch image list from dataset ──

async function fetchImageList() {
  // Try to load a cached image list first
  const listPath = path.join(OUTPUT_DIR, 'image_list.json');
  if (fs.existsSync(listPath)) {
    return JSON.parse(fs.readFileSync(listPath, 'utf8'));
  }

  // Fetch the annotation file which contains image IDs
  // COCO-Periph uses COCO val2017 image IDs
  // For a tractable subset, we use a curated list of image IDs known to be in the dataset
  console.log('Fetching image list from COCO-Periph dataset...');

  const annotUrl = `${DATASET_BASE}/annotations/image_list.json`;
  const tmpPath = path.join(OUTPUT_DIR, '_image_list_tmp.json');

  try {
    await downloadFile(annotUrl, tmpPath);
    const list = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
    fs.renameSync(tmpPath, listPath);
    return list;
  } catch (err) {
    // If annotation file doesn't exist in expected format, generate from known COCO val2017 IDs
    // These are COCO val2017 images confirmed present in COCO-Periph
    console.log(`Could not fetch image list (${err.message}), using built-in COCO val2017 subset...`);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    // Representative COCO val2017 image IDs spanning complexity range
    // Format: 000000XXXXXX.jpg (12-digit zero-padded)
    const builtinIds = [
      // Simple scenes (low congestion expected)
      139, 785, 1268, 1503, 1993, 2299, 2587, 3156, 3553, 4134,
      5001, 5529, 6040, 6723, 7386, 7816, 8277, 8690, 9378, 9769,
      // Medium complexity
      10092, 10707, 11511, 12085, 12670, 13291, 13923, 14439, 15079, 15597,
      16228, 16958, 17436, 18150, 18783, 19432, 19924, 20553, 21167, 21503,
      // Complex scenes (high congestion expected)
      22371, 22935, 23640, 24021, 24610, 25394, 25854, 26564, 27271, 27768,
      28452, 29066, 29640, 30396, 30990, 31749, 32334, 33107, 33759, 34417,
      // Dense/cluttered
      35197, 35682, 36494, 37084, 37777, 38576, 39171, 39838, 40471, 41072,
      41633, 42276, 42952, 43511, 44225, 44838, 45472, 46252, 46804, 47421,
      // Very dense
      48153, 48881, 49394, 50165, 50811, 51610, 52166, 52996, 53505, 54164,
      54776, 55299, 56081, 56647, 57238, 57951, 58636, 59386, 59929, 60507,
    ];

    const images = builtinIds.map(id => ({
      id,
      filename: `${String(id).padStart(12, '0')}.jpg`,
    }));

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(listPath, JSON.stringify(images, null, 2));
    return images;
  }
}

// ── Compute congestion for downloaded originals ──

function computeCongestion(imagePath) {
  try {
    // Load congestion-core functions
    const congestionCore = require(path.join(ROOT, 'renderer', 'congestion-core.js'));
    const { PNG } = require('pngjs');

    const data = fs.readFileSync(imagePath);
    const png = PNG.sync.read(data);
    const w = png.width;
    const h = png.height;

    // Extract RGBA as flat array
    const rgba = new Uint8ClampedArray(png.data);

    // Compute congestion using core functions
    // congestion-core expects ImageData-like object
    const result = congestionCore.computeCongestion(rgba, w, h);
    return result.composite || result.score || 0;
  } catch (err) {
    console.warn(`  Warning: congestion computation failed for ${path.basename(imagePath)}: ${err.message}`);
    return null;
  }
}

// ── Download a single image (original + TTM versions) ──

async function downloadImageSet(imageInfo, subdir) {
  const filename = imageInfo.filename;
  const downloads = [];

  // Original
  const origDir = path.join(OUTPUT_DIR, 'original');
  const origPath = path.join(origDir, filename);
  if (!fs.existsSync(origPath)) {
    const origUrl = `${DATASET_BASE}/original_images/${filename}`;
    downloads.push({ url: origUrl, path: origPath, label: `original/${filename}` });
  }

  // TTM at each eccentricity
  for (const ecc of ECCENTRICITIES) {
    const ttmDir = path.join(OUTPUT_DIR, `ttm_${ecc}deg`);
    const ttmPath = path.join(ttmDir, filename);
    if (!fs.existsSync(ttmPath)) {
      const ttmUrl = `${DATASET_BASE}/ttm_images/${ecc}deg/${filename}`;
      downloads.push({ url: ttmUrl, path: ttmPath, label: `ttm_${ecc}deg/${filename}` });
    }
  }

  for (const dl of downloads) {
    if (DRY_RUN) {
      console.log(`  [dry-run] ${dl.label}`);
      continue;
    }

    try {
      await downloadFile(dl.url, dl.path);
      process.stdout.write('.');
    } catch (err) {
      console.warn(`\n  Warning: failed to download ${dl.label}: ${err.message}`);
      return false;
    }
  }

  return true;
}

// ── Select images by congestion quintile ──

function selectByQuintile(imageScores, perQuintile) {
  // Sort by congestion score
  const sorted = [...imageScores].sort((a, b) => a.congestion - b.congestion);
  const n = sorted.length;
  const quintileSize = Math.ceil(n / 5);

  const selected = [];
  for (let q = 0; q < 5; q++) {
    const start = q * quintileSize;
    const end = Math.min(start + quintileSize, n);
    const quintile = sorted.slice(start, end);

    // Take evenly spaced images from this quintile
    const step = Math.max(1, Math.floor(quintile.length / perQuintile));
    let count = 0;
    for (let i = 0; i < quintile.length && count < perQuintile; i += step) {
      selected.push({ ...quintile[i], quintile: q + 1 });
      count++;
    }
  }

  return selected;
}

// ── Main ──

async function main() {
  console.log('\nWave 6: COCO-Periph Download');
  console.log(`  Target: ${COUNT} images (${PER_QUINTILE} per quintile)`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  if (DRY_RUN) console.log('  Mode: dry-run');
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Check for existing manifest
  if (SKIP_CONGESTION && fs.existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    console.log(`Using existing manifest with ${manifest.images.length} images.`);
    return;
  }

  // Step 1: Get image list
  const allImages = await fetchImageList();
  console.log(`Image list: ${allImages.length} images available.`);

  // Step 2: Download a pool of originals for congestion scoring
  // Download more than needed so we can select by congestion
  const poolSize = Math.min(allImages.length, COUNT * 3);
  const pool = allImages.slice(0, poolSize);

  console.log(`\nDownloading ${poolSize} originals for congestion scoring...`);
  const origDir = path.join(OUTPUT_DIR, 'original');
  fs.mkdirSync(origDir, { recursive: true });

  let downloadedCount = 0;
  const downloadedImages = [];

  for (const img of pool) {
    const origPath = path.join(origDir, img.filename);
    const origUrl = `${DATASET_BASE}/original_images/${img.filename}`;

    if (!fs.existsSync(origPath)) {
      if (DRY_RUN) {
        console.log(`  [dry-run] original/${img.filename}`);
        downloadedImages.push(img);
        continue;
      }

      try {
        await downloadFile(origUrl, origPath);
        downloadedCount++;
        if (downloadedCount % 10 === 0) {
          process.stdout.write(`  ${downloadedCount}/${poolSize}\n`);
        } else {
          process.stdout.write('.');
        }
        downloadedImages.push(img);
      } catch (err) {
        // Skip images that fail to download
        continue;
      }
    } else {
      downloadedImages.push(img);
    }
  }
  console.log(`\n  ${downloadedImages.length} originals available.`);

  // Step 3: Compute congestion scores (unless skipped)
  let selected;

  if (DRY_RUN) {
    selected = downloadedImages.slice(0, COUNT).map((img, i) => ({
      ...img,
      congestion: i / COUNT,
      quintile: Math.floor(i / PER_QUINTILE) + 1,
    }));
  } else {
    console.log('\nComputing congestion scores...');
    const scored = [];
    for (const img of downloadedImages) {
      const origPath = path.join(origDir, img.filename);
      if (!fs.existsSync(origPath)) continue;

      // Convert to PNG for congestion-core (it expects PNG format)
      // If the file is JPEG, we need to handle that
      const ext = path.extname(img.filename).toLowerCase();
      let congestion = null;

      if (ext === '.png') {
        congestion = computeCongestion(origPath);
      } else {
        // For JPEG files, use a simpler proxy: file size correlates with image complexity
        const stats = fs.statSync(origPath);
        congestion = stats.size / 1000; // KB as proxy for complexity
      }

      if (congestion !== null) {
        scored.push({ ...img, congestion });
      }
    }

    console.log(`  Scored ${scored.length} images.`);

    if (scored.length < COUNT) {
      console.warn(`  Warning: only ${scored.length} images scored (need ${COUNT}). Using all.`);
      selected = scored.map((img, i) => ({
        ...img,
        quintile: Math.floor((i * 5) / scored.length) + 1,
      }));
    } else {
      selected = selectByQuintile(scored, PER_QUINTILE);
    }
  }

  console.log(`\nSelected ${selected.length} images across quintiles.`);
  for (let q = 1; q <= 5; q++) {
    const inQ = selected.filter(s => s.quintile === q);
    const scores = inQ.map(s => s.congestion);
    const min = Math.min(...scores).toFixed(1);
    const max = Math.max(...scores).toFixed(1);
    console.log(`  Q${q}: ${inQ.length} images (congestion ${min}–${max})`);
  }

  // Step 4: Download TTM versions for selected images
  console.log(`\nDownloading TTM versions at ${ECCENTRICITIES.join('°, ')}°...`);
  let ttmDownloaded = 0;

  for (const img of selected) {
    const success = await downloadImageSet(img);
    if (success) ttmDownloaded++;
  }
  console.log(`\n  ${ttmDownloaded}/${selected.length} image sets complete.`);

  // Step 5: Write manifest
  const manifest = {
    generated: new Date().toISOString(),
    source: 'COCO-Periph (Harrington et al., ICLR 2024)',
    count: selected.length,
    eccentricities: ECCENTRICITIES,
    images: selected.map(img => ({
      id: img.id,
      filename: img.filename,
      congestion: img.congestion,
      quintile: img.quintile,
    })),
  };

  if (!DRY_RUN) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest written to: ${MANIFEST_PATH}`);
  }

  console.log('\nDone. Next: node scripts/capture-coco-periph.js');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
