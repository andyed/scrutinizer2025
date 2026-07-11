# Contributing to Scrutinizer

Scrutinizer is a biologically-motivated foveated vision simulator for web interfaces. Contributions are welcome — whether you're fixing a bug, improving the simulation, or extending the architecture for your own research.

## Quick Start

```bash
git clone <repo-url>
cd scrutinizer2025
npm install
npm start
```

Requires Node.js 18+ and Electron 30.5+. macOS is the primary development platform; Windows/Linux support is untested.

## Architecture

Scrutinizer's pipeline maps to the biological visual pathway. Each module is independently swappable:

```
scrutinizer.js (Pipeline Orchestrator)
  ├── gaze-model.js        → Oculomotor system (mouse proxy)
  ├── visual-memory.js     → Visuospatial working memory
  ├── content-analysis.js  → Pre-cortical feature extraction (LGN)
  └── webgl-renderer.js    → V1/V4 shader pipeline
        └── peripheral.frag (888-line GLSL fragment shader)
```

See [`docs/developers_guide.md`](docs/developers_guide.md) for the full module dependency graph, coordinate system docs, and the hybrid CommonJS/Window module pattern.

## Extensibility Branch Points

These are the designed-for places to plug in your own work:

| Branch Point | Interface | What to swap |
|---|---|---|
| **Gaze input** | `update(x,y)` → position, velocity, fixation | Mouse proxy → Tobii SDK, WebGazer.js, scanpath replay |
| **Saliency algorithm** | Frame bitmap → heatmap texture | Current Oklab DoG → Itti-Koch, DeepGaze II, ONNX model |
| **Crowding model** | Integer uniform `u_v1_distortion_type` | Add Portilla-Simoncelli synthesis, oriented DoG filtering |
| **Structure analysis** | DOM blocks → RGBA texture | Gestalt grouping → CV segmentation, semantic embedding |
| **Pipeline config** | `shared/modes.json` | New rendering profiles with zero code changes |

## Research Projects

See [`docs/research-opportunities.md`](docs/research-opportunities.md) — 17 open directions across vision science, HCI, accessibility, and systems, with research questions, deliverables, and publication venues.

## How to Contribute

### Bug fixes and small improvements

1. Fork the repo and create a branch (`fix/description` or `improve/description`)
2. Make your changes, keeping commits focused
3. Run existing tests: `npm test`
4. Open a pull request with a description of what changed and why

### New features or pipeline extensions

1. Read [`docs/developers_guide.md`](docs/developers_guide.md) and [`docs/foveated-vision-model.md`](docs/foveated-vision-model.md)
2. Check if your idea maps to an existing branch point (table above)
3. Open an issue first to discuss the approach
4. Implement behind a feature gate where possible (uniform toggle, `modes.json` flag)
5. Add tests for pure-function modules (see `tests/unit/` for patterns)

### Documentation and science

The biological grounding matters. If you're adding or modifying a pipeline stage:

- Cite the relevant neuroscience in shader comments (see existing patterns in `peripheral.frag`)
- Update [`docs/foveated-vision-model.md`](docs/foveated-vision-model.md) with the biology → computation mapping
- Use the "compute demand management" framing — the system selectively allocates bandwidth, it doesn't degrade-then-restore

## Key Files

| File | What it does |
|---|---|
| `renderer/shaders/peripheral.frag` | Main fragment shader (LGN → V1 → V4 pipeline) |
| `renderer/webgl-renderer.js` | WebGL 2.0 context, uniform management, texture uploads |
| `renderer/scrutinizer.js` | Pipeline orchestrator, render loop |
| `shared/modes.json` | Declarative pipeline configuration per aesthetic mode |
| `renderer/config.js` | Default parameter values |
| `renderer/saliency-worker.js` | Web Worker for async saliency computation |

## Testing

```bash
npm run test:unit     # Headless Jest suite (also what CI runs) — no display needed
npm test              # Full suite: unit + visual + memory + integration (launches the app)
npm start             # Visual verification — check golden captures in tests/golden-captures/
```

Golden captures provide visual regression testing. After shader changes, compare against `tests/golden-captures/` screenshots.

The peripheral-OCR gate (`npm run validate:ocr`) needs the Tesseract English model, which is `.gitignore`d. On a fresh clone, install a pinned, sha-verified model first:

```bash
bash scripts/download-tessdata.sh   # installs eng.traineddata at the repo root
```

Model provenance is recorded in `tests/validation/ocr-baseline.json` (`model` block); the gate warns if the installed model differs from the one the baseline was scored with.

## Code Style

- Extensive inline comments explaining "why," not "what"
- Defensive: `isFinite()` checks, NaN guards in shader math
- Biological terminology in module/variable names where it aids clarity
- No unnecessary bundlers — direct ES6 modules via Electron

## License

MIT. The Figma plugin (`scrutinizer-figma/`) is excluded from the open-source release.

## AI Disclosure

Scrutinizer's architecture, documentation, scientific literature review, and grad student project backlog were developed through collaboration with Claude (Anthropic) via Claude Code. Human direction covers architectural decisions, conceptual framing, and perceptual validation. See the [arxiv system paper](docs/arxiv-paper/) for details on the AI-assisted development process.
