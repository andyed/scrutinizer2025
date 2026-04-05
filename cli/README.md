# Scrutinizer — CLI & Automation

Scrutinizer is a foveated vision simulator — it renders web pages the way the human visual system actually processes them, with high detail at the fixation point and increasing degradation toward the periphery. This CLI and scripting layer lets you use that pipeline without touching the desktop app.

Three automation surfaces:

- **`cli/scrutinizer-audit`** — Standalone visual complexity scorer. No GPU, no Electron. Crawls pages with Playwright, computes a 0–100 clutter score.
- **`cli/mcp/`** — MCP server wrapping the auditor for AI coding agents (Claude Code, etc.).
- **`scripts/`** — 75+ Node.js scripts that drive the full Electron pipeline headlessly: capture screenshots through the foveated shader, replay eye-tracking data, export saliency maps, run validation experiments.

---

## "I want to…"

| Goal | Command | Output |
| --- | --- | --- |
| Score a page's visual complexity | `cd cli && node scrutinizer-audit.js <url>` | Score 0–100 + rating |
| Score a page from Claude Code | MCP tool `analyze_url` | JSON with score, rating, congestion, edge density |
| Capture a page through the foveated pipeline | `node scripts/capture-raw-pages.js` | PNG screenshots |
| Compare modes side-by-side | `node scripts/capture-mode-comparison.js` | PNGs in `docs/golden/mode-comparison/` |
| Replay eye-tracking fixations | `node scripts/replay-scanpath.js --data-dir ./data --trial T01` | Foveated accumulation image |
| Export saliency values at fixation coordinates | `node scripts/export-saliency.js --input img.png --coordinates coords.json` | JSON with per-coordinate metrics |
| Run a quick sanity check before shader changes | `npm run capture-smoke` | 5 screenshots in `tests/smoke-captures/` |
| Run the full golden capture suite | `npm run capture-golden` | Versioned PNGs in `tests/golden-captures/` |
| Validate the congestion pipeline end-to-end | `npm run validate-congestion` | Comparison report |
| Build a signed macOS release | `npm run build` | `.dmg` in `dist/` |

---

## scrutinizer-audit (standalone)

Visual complexity scorer. Uses Rosenholtz Feature Congestion — local variance across luminance, red-green, and blue-yellow channels in Oklab color space — plus Sobel edge density.

### Install & Run

```bash
cd cli
npm install                # pulls Playwright + Chromium
node scrutinizer-audit.js https://example.com
```

### All Flags

| Flag | Default | Description |
| --- | --- | --- |
| `<url> [urls...]` | — | URLs to audit (positional) |
| `--sitemap <url>` | — | Parse XML sitemap for URLs |
| `--file <path>` | — | Read URLs from text file, one per line |
| `--viewport <list>` | `desktop` | Comma-separated: `desktop`, `mobile` |
| `--scroll <list>` | `above-fold` | Comma-separated: `above-fold`, `first-scroll` |
| `--output <path>` | — | Write `.json` or `.html` report |
| `--heatmaps` | off | Save congestion + edge density heatmap PNGs |
| `--screenshots` | off | Save raw page screenshots |
| `--json` | off | JSON to stdout |
| `--quiet` | off | Suppress progress output |
| `--max-dim <n>` | `1024` | Analysis resolution in pixels |
| `--fail-above <n>` | — | Exit code 1 if any page exceeds this score |
| `--compare <a> <b>` | — | Delta report between two JSON outputs |

### JSON Output Schema (`--json`)

```jsonc
{
  "generator": "scrutinizer-audit",
  "version": "1.0.0",
  "timestamp": "2026-04-05T...",
  "summary": {
    "pagesAnalyzed": 3,
    "avgScore": 42,
    "maxScore": 67,
    "minScore": 18,
    "threshold": null,   // or the --fail-above value
    "pass": true         // true if all pages below threshold (or no threshold set)
  },
  "pages": [
    {
      "url": "https://example.com",
      "captures": [
        {
          "viewport": { "name": "desktop", "width": 1440, "height": 900 },
          "scrollPosition": 0,
          "score": 42,           // 0-100 composite
          "rating": "Medium",    // Low (0-25) | Medium (26-50) | High (51-75) | Extreme (76-100)
          "congestion": { "p90": 0.0834 },
          "edgeDensity": { "p90": 0.1247 },
          "computeTimeMs": 312
        }
      ]
    }
  ]
}
```

### Score Ranges

| Score | Rating | Typical content |
| --- | --- | --- |
| 0–25 | Low | Minimal complexity, clean layouts |
| 26–50 | Medium | Typical content pages |
| 51–75 | High | Dense dashboards, media-heavy |
| 76–100 | Extreme | Visually overwhelming |

---

## MCP Server

Wraps the visual complexity auditor for MCP clients (Claude Code, Cursor, etc.).

```bash
claude mcp add scrutinizer-audit -- node cli/mcp/server.js
```

### Tools

**`analyze_url`** — Score one page.

Input: `{ url, viewport?, scroll? }`

```jsonc
// Response
{
  "url": "https://example.com",
  "viewport": "desktop",
  "scroll": "above-fold",
  "score": 42,
  "rating": "Medium",
  "congestion": { "mean": 0.0412, "p90": 0.0834 },
  "edgeDensity": { "mean": 0.0891, "p90": 0.1247 },
  "computeTimeMs": 312
}
```

**`analyze_urls`** — Score multiple pages with summary.

Input: `{ urls[], viewport?, scroll? }`

Returns `{ summary: { pagesAnalyzed, avgScore, maxScore, minScore }, pages: [...] }`

**`compare_pages`** — Side-by-side delta between two URLs.

Input: `{ urlA, urlB, viewport?, scroll? }`

Returns `{ a: {...}, b: {...}, delta: { score, congestion_p90, edgeDensity_p90 }, summary: "..." }`

---

## Capture Scripts (`scripts/`)

These scripts drive the Electron app headlessly. They launch Electron with `TEST_MODE=true` and configure behavior through environment variables — no GUI interaction required.

**All scripts run from the project root**, not from `scripts/`.

### How Headless Capture Works

The Electron app reads `TEST_*` environment variables at startup. The capture scripts set these, spawn Electron, wait for the render, and grab the screenshot. Key variables:

| Variable | What it controls |
| --- | --- |
| `TEST_MODE` | Activates headless capture mode (hides toolbar, disables interactive UI) |
| `TEST_URL` | Page to load |
| `TEST_WIDTH` / `TEST_HEIGHT` | Viewport dimensions |
| `TEST_MODES` | Comma-separated mode IDs (e.g., `"0,5,10"`) |
| `TEST_FIXATION_X` / `TEST_FIXATION_Y` | Where to fixate (normalized 0–1 or pixels) |
| `TEST_SELECTOR` | CSS selector to fixate on (alternative to coordinates) |
| `TEST_RADIUS` | Foveal blur radius in pixels |
| `TEST_SCANPATH` | Path to JSON fixation sequence for replay |
| `TEST_VISUAL_MEMORY` | Buffer lifetime in frames (-1 = infinite accumulation) |
| `TEST_BATCH_FILE` | JSON file with batch capture specifications |
| `TEST_OVERLAY` | Show SVG debug overlay (fovea boundaries) |
| `TEST_SCROLL_Y` | Initial scroll offset in pixels |
| `TEST_LOAD_TIMEOUT` | Max page load wait in ms (default: 15000) |
| `TEST_OUTPUT_FILENAME` | Override output PNG filename |
| `TEST_INJECT_CSS` | Path to CSS file injected for deterministic rendering |
| `TEST_CHROMATIC_POOLING` | Override chromatic pooling on/off |
| `TEST_READING_SPAN` | Enable Rayner reading span (asymmetric foveal extent) |
| `TEST_DEBUG_LEVEL` | 0=off, 1=basic, 2=detailed, 3=verbose |

### Batch Capture Spec Format

For `TEST_BATCH_FILE`, provide a JSON array:

```jsonc
[
  {
    "filename": "homepage_mode0.png",
    "url": "https://example.com",
    "mode": 0,
    "fixationX": 0.5,
    "fixationY": 0.3,
    "width": 1440,
    "height": 900
    // Optional: selector, overlay, radius, mobile, chromaticPooling, outputDir
  }
]
```

### Quick Reference

```bash
# Smoke test (5 shots, fast)
npm run capture-smoke

# Golden captures (manifest-cached, --force to recapture all)
npm run capture-golden

# Pixel-diff against previous golden set
npm run golden-compare

# Mode comparison grid
node scripts/capture-mode-comparison.js

# Raw (unfiltered) page screenshots
node scripts/capture-raw-pages.js

# Full-page tiled capture with gaze overlay
node scripts/capture-fullpage-gazeplot.js \
  --data-dir ./data --trial T01 --url https://example.com \
  --anchors anchors.json --resolved resolved.json --reading-span
```

---

## Saliency & Congestion Export

Extracts per-coordinate metrics from images. Runs in pure Node.js — no Electron, no GPU. Uses the same `congestion-core.js` (Oklab DoG + local variance) as the desktop app.

```bash
node scripts/export-saliency.js \
  --input screenshot.png \
  --coordinates fixations.json \
  --output results.json \
  --radius 60
```

### Input: coordinates JSON

```jsonc
[
  { "id": "fix_001", "x": 720, "y": 450 },
  { "id": "fix_002", "x": 200, "y": 300 }
]
```

### Output JSON

```jsonc
{
  "image": "screenshot.png",
  "image_width": 1024,
  "image_height": 768,
  "saliency_resolution": "1024x768",
  "foveal_radius": 60,
  "complexity_score": 47,
  "complexity_rating": "Medium",
  "coordinates": [
    {
      "id": "fix_001",
      "x": 720,
      "y": 450,
      "saliency_mean": 0.3412,    // mean within foveal radius
      "saliency_max": 0.7821,     // peak within radius
      "congestion_mean": 0.0523,  // Rosenholtz Feature Congestion
      "congestion_max": 0.1247,
      "edge_density_mean": 0.0891,
      "edge_density_max": 0.2134
    }
  ]
}
```

### Batch Mode

```bash
node scripts/export-saliency.js \
  --input-dir serp-renders/ \
  --coordinates-dir fixation-coords/ \
  --output-dir saliency/
```

~100ms per image at 256px resolution.

---

## Gaze Replay

Replay eye-tracking fixation sequences through the foveated pipeline. Produces "what the participant could have resolved" accumulation images.

```bash
# Replay a single trial
node scripts/replay-scanpath.js --data-dir ./data --trial T01

# AdSERP search dataset
node scripts/replay-adserp.js --trial T01

# Batch all prototypical trials
node scripts/batch-adserp-gazeplots.js
node scripts/batch-fullpage-gazeplots.js

# Generate static scanpath diagram (SVG overlay)
node scripts/generate-scanpath-diagram.js --trial T01

# Generate interactive HTML viewer
node scripts/generate-interactive-scanpath.js --trial T01

# Reading span captures (Rayner asymmetric foveal extent)
node scripts/capture-reading-span.js
```

---

## Validation Waves

Each wave captures controlled stimuli through the pipeline, then runs analysis scripts to produce quantitative reports against known ground truth.

| Wave | What it validates | Run with |
| --- | --- | --- |
| Spatial acuity | Grating contrast falloff vs eccentricity | `capture-spatial-acuity.js` → `analyze-spatial-acuity.js` → `report-spatial-acuity.js` |
| Crowding | Letter identification in clutter | `capture-crowding.js` → `analyze-crowding.js` → `report-crowding.js` |
| Color search | Chromatic pooling accuracy | `capture-color-search.js` → `analyze-color-search.js` → `report-color-search.js` |
| Saliency | Attention modulation of foveal detail | `capture-saliency.js` → `analyze-saliency.js` |
| Halverson | Mixed-density page rendering | `capture-halverson.js` → `analyze-halverson.js` |
| COCO-Periph | Natural image peripheral degradation | `npm run wave6` (end-to-end) |
| Tier 3 | Pyramid statistics + crowding | `npm run wave7` (end-to-end) |
| Congestion | Feature Congestion vs Python reference | `npm run validate-congestion` (end-to-end) |

---

## Build & Release

```bash
npm run build           # Signed macOS .dmg
npm run build:unsigned  # Unsigned (local testing)
npm run build:win       # Windows
```

Notarization: `node scripts/notarize.js` then `node scripts/check-notarization-status.js`.

---

## File Map

```
cli/
├── scrutinizer-audit.js      Standalone complexity CLI (no Electron)
├── package.json              Own dependencies: Playwright, pngjs, MCP SDK
├── mcp/
│   └── server.js             MCP server (stdio transport, 3 tools)
├── lib/
│   ├── analyzer.js           Oklab DoG + Feature Congestion + edge density
│   ├── crawler.js            Playwright page capture
│   ├── reporter.js           Table / JSON / HTML report builder
│   ├── scroll-strategy.js    Scroll position definitions
│   ├── sitemap-parser.js     XML sitemap parser
│   ├── url-resolver.js       URL input resolution (positional, file, sitemap)
│   └── viewport-profiles.js  Named viewport dimensions
└── templates/                Report templates

scripts/
├── capture-*.js              Headless Electron capture (set TEST_* env vars, spawn, screenshot)
├── analyze-*.js              Post-capture pixel analysis
├── validate-*.js             Quantitative validation against ground truth
├── report-*.js               Human-readable validation reports
├── replay-*.js               Eye-tracking fixation replay
├── batch-*.js                Bulk processing orchestrators
├── generate-*.js             Diagram / gallery generators
├── export-saliency.js        Headless saliency extraction (no Electron)
├── compare-*.js              Before/after and cross-mode diffs
├── golden-compare.js         Pixel-diff golden captures
└── lib/
    ├── capture-manifest.js   Skip-if-unchanged caching for golden captures
    └── capture-runner.js     Batch capture orchestrator
```

## Requirements

- **cli/ (scrutinizer-audit)**: Node.js 18+, Playwright (`npx playwright install chromium`)
- **scripts/ (capture pipeline)**: Node.js 18+, Electron (installed at project root via `npm install`)
- **Python validation**: uv + Python 3.12 (`uv run --python 3.12`)
