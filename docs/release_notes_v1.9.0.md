# Scrutinizer v1.9.0 Release Notes

**Release Date:** March 2026

## Overview: Headless Scoring + Saliency vs Congestion

Two additions. **scrutinizer-audit** breaks the analysis engine out of Electron so it can run headless — as a CLI for scoring pages at scale, and as an MCP server for AI-assisted design review. **Saliency vs Congestion** adds a split-screen comparison mode that renders both heatmaps side by side with labeled palettes, making the distinction between "what pops out" and "how cluttered" immediately visible.

---

## scrutinizer-audit — CLI + MCP Server

### What It Does

Crawls web pages with headless Chromium (Playwright), captures screenshots, and runs the exact same Feature Congestion + edge density pipeline as the ComplexityHUD. Returns a 0–100 composite score per page.

```bash
# Score a page
node cli/scrutinizer-audit.js https://apple.com
# → Score: 46 (Medium)

# Multi-page, multi-viewport
node cli/scrutinizer-audit.js https://apple.com https://persci.mit.edu --viewport desktop,mobile

# CI gate
node cli/scrutinizer-audit.js --sitemap https://example.com/sitemap.xml --fail-above 60
# → exit 1 if any page exceeds threshold
```

### Shared Scoring Foundation

The scoring formula, rating thresholds, and edge density computation were extracted from `congestion-worker.js` and `complexity-hud.js` into `congestion-core.js` as shared functions:

| Function | Source | Now In |
|----------|--------|--------|
| `computeEdgeDensity()` | `congestion-worker.js:147–169` | `congestion-core.js` |
| `computeCompositeScore()` | `complexity-hud.js:361` | `congestion-core.js` |
| `RATINGS` | `complexity-hud.js:16–21` | `congestion-core.js` |

The ComplexityHUD, congestion worker, `extract-congestion.js`, and the CLI all call the same functions. Scores match exactly.

### CLI Features

| Feature | Flag |
|---------|------|
| Positional URLs | `scrutinizer-audit https://a.com https://b.com` |
| Sitemap parsing | `--sitemap https://example.com/sitemap.xml` |
| URL list from file | `--file urls.txt` |
| Desktop + mobile viewports | `--viewport desktop,mobile` |
| Scroll positions | `--scroll above-fold,first-scroll` |
| JSON to stdout | `--json` |
| HTML report | `--output report.html` |
| Congestion heatmap PNGs | `--heatmaps` |
| Raw screenshots | `--screenshots` |
| CI threshold gate | `--fail-above 60` (exit 1 if exceeded) |
| Before/after comparison | `--compare before.json after.json` |
| Analysis resolution | `--max-dim 1024` (default) |

### MCP Server

Three tools exposed via stdio transport for Claude Code integration:

| Tool | Purpose |
|------|---------|
| `analyze_url` | Score a single page |
| `analyze_urls` | Batch scoring with summary stats |
| `compare_pages` | Side-by-side delta between two URLs |

Setup:
```bash
claude mcp add scrutinizer-audit -- node cli/mcp/server.js
```

### Architecture

```
cli/
  scrutinizer-audit.js        # Entry point
  lib/
    analyzer.js               # PNG → metrics (wraps congestion-core.js)
    crawler.js                # Playwright capture orchestrator
    reporter.js               # JSON / HTML / console output
    sitemap-parser.js         # XML sitemap → URL[]
    url-resolver.js           # Input consolidation
    viewport-profiles.js      # Desktop (1440×900) + Mobile (390×844)
    scroll-strategy.js        # above-fold, first-scroll
  mcp/
    server.js                 # @modelcontextprotocol/sdk stdio server
  package.json                # playwright, @modelcontextprotocol/sdk, pngjs
```

No Electron dependency. No native binaries. Runs on CI runners.

### Reference Scores

Captured with `scrutinizer-audit`, desktop viewport (1440×900), above-fold:

| Page | Score | Rating | Congestion p90 | Edge p90 |
|------|-------|--------|----------------|----------|
| example.com (near-empty) | 0 | Low | 0.000 | 0.000 |
| wikipedia.org | 31 | Medium | 0.084 | 0.116 |
| persci.mit.edu/gallery | 38 | Medium | 0.173 | 0.070 |
| apple.com | 46 | Medium | 0.262 | 0.082 |
| persci.mit.edu | 53 | High | 0.252 | 0.359 |
| persci.mit.edu/people/rosenholtz | 53 | High | 0.274 | 0.305 |
| apple.com (mobile 390×844) | 54 | High | 0.311 | 0.238 |

Rosenholtz's own page at MIT's Perceptual Science Group scores 53. The gallery page fares better (38) because image grids have more uniform local neighborhoods than text-heavy layouts.

---

## Saliency vs Congestion Split View

### What It Does

Side-by-side rendering of both heatmaps in the overlay window. Left half: saliency (cool indigo-to-white palette). Right half: congestion (blue-yellow-red). Labels identify each side with the question it answers.

**Menu path:** Simulation → Utility → Congestion Report → Saliency vs Congestion

### Why Both Maps

These are complementary signals, not redundant ones:

- **Saliency** (center-surround DoG): "What pops out?" — items that differ from their surroundings
- **Congestion** (local feature variance): "How cluttered?" — areas with high simultaneous variation in color, lightness, and edges

A page with a clean hero and a dense product grid illustrates the difference. The saliency map lights up the hero headline (high contrast against a clean background). The congestion map lights up the product grid (high local variance regardless of contrast). Seeing them side by side makes this immediately clear.

### Implementation

| Component | Change |
|-----------|--------|
| `peripheral2.frag` | New `show_congestion == 2` branch: split-screen with separate palettes and divider line |
| `scrutinizer.js` | Congestion mode 3 → shader uniform 2. DOM labels overlay with "SALIENCY / What pops out?" and "CONGESTION / How cluttered?" |
| `menu-template.js` | New radio item in Congestion Report submenu |
| `webgl-renderer.js` | `show_congestion` uniform range extended to 0–2 |

The ComplexityHUD stays visible alongside the split view, so you can read the numerical score while visually comparing spatial distribution.

---

## `extract-congestion.js` Upgrade

The existing headless validation script now uses the shared `computeEdgeDensity()` and `computeCompositeScore()` from `congestion-core.js`. Output includes:

- Composite scores and ratings alongside raw congestion stats
- Edge density heatmap PNGs (in addition to congestion heatmaps)
- Updated JSON structure with nested `congestion` and `edgeDensity` objects

---

## Documentation

- **Developer Guide** (`docs/developers_guide.md`): New section covering scrutinizer-audit CLI reference, output schema, CI integration, MCP server setup, and extension points.
- **Congestion Brief** (`scrutinizer-www/src/blog/congestion-score.html`): Added "Scores in the Wild" table with live results, CLI & MCP section, and saliency vs congestion split-view description.

---

## Dependencies

### cli/ (new package)

| Package | Version | Purpose |
|---------|---------|---------|
| `playwright` | ^1.50.0 | Headless Chromium |
| `@modelcontextprotocol/sdk` | ^1.12.1 | MCP stdio server |
| `pngjs` | ^7.0.0 | PNG decode (same as parent) |

No new dependencies in the main Electron app.

---

## What's Next

### Rendering Pipeline
- **Per-channel chromatic pooling** — Red-green opponency collapses ~2.5× faster than blue-yellow with eccentricity, and peripheral color perception is strongly size-dependent (large color fields persist to 20°+). The DoG bands already separate content by spatial scale — applying differential RG/YV attenuation per band models both effects. Spec: `docs/specs/chromatic_pooling.md`. Key references: Mullen & Kingdom (2002), Abramov et al. (1991), castleCSF (Ashraf et al. 2024).
- **Oriented DoG bands (Oblique Effect)** — Cardinal edges persist ~50% further than oblique ones. Spec: `docs/specs/oriented_dog_bands.md`

### scrutinizer-audit
- **HTML report template** — Lighthouse-style visual report with per-page score cards
- **Watch mode** — `--watch http://localhost:3000` re-runs on dev server reload
- **Historical tracking** — `--output scores.jsonl --append` for longitudinal score tracking
- **GitHub Action** — Run in PR checks, post score table as PR comment
- **Full-fidelity mode** — `--full-fidelity` flag driving the full Electron pipeline (peripheral rendering + saliency) for research-grade captures

---

## Files Changed

| Area | Files |
|------|-------|
| **Shared Scoring** | `renderer/congestion-core.js` (+`computeEdgeDensity`, `computeCompositeScore`, `RATINGS`) |
| **CLI** | `cli/scrutinizer-audit.js`, `cli/lib/analyzer.js`, `cli/lib/crawler.js`, `cli/lib/reporter.js`, `cli/lib/sitemap-parser.js`, `cli/lib/url-resolver.js`, `cli/lib/viewport-profiles.js`, `cli/lib/scroll-strategy.js`, `cli/package.json` |
| **MCP Server** | `cli/mcp/server.js` |
| **Split View** | `renderer/shaders/peripheral2.frag`, `renderer/scrutinizer.js`, `renderer/webgl-renderer.js`, `menu-template.js` |
| **Validation** | `scripts/extract-congestion.js` (updated to use shared edge density + composite score) |
| **Documentation** | `docs/developers_guide.md`, `docs/release_notes_v1.9.0.md` |
