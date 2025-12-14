# Golden Captures

Release-based screenshots for visual regression testing and documentation.

## Directory Structure

```
golden-captures/
├── v1.4.1/
│   ├── dashboard_mode0.png
│   ├── article_mode0.png
│   └── ecommerce_mode0.png
├── v1.5.0/
│   └── ...
└── latest -> v1.5.0/
```

## Capture Workflow

### Manual Capture

1. **Start app with reference page:**
   ```bash
   npm start -- "file://$(pwd)/tests/reference-pages/dashboard.html"
   ```

2. **Configure simulation:**
   - Enable foveal mode (Cmd+Shift+F)
   - Set to Mode 0 (High-Key Ghosting) via Simulation > Behavior > Aesthetic Mode

3. **Capture screenshot:**
   - Use Cmd+Shift+4 (macOS) or the system screenshot tool
   - Save to `tests/golden-captures/v{VERSION}/`

### Automated Capture

```bash
# Capture all reference pages for current version
npm run capture-golden
```

## Naming Convention

| Pattern | Description |
|---------|-------------|
| `{page}_mode0.png` | Default High-Key mode |
| `{page}_mode3.png` | Wireframe mode |
| `{page}_mode4.png` | Cyberpunk mode |
| `{page}_memory.png` | Visual Memory enabled |

## When to Update

| Release | Update? |
|---------|---------|
| Major (1.x.0) | ✅ Always - full capture |
| Minor (1.x.y) | ⚡ If shader/rendering changed |
| Patch | ❌ Rarely - only critical visual fixes |

## Reference Pages

Located in `tests/reference-pages/`:

- **dashboard.html** - Sidebar, toolbar, stats cards, data table
- **article.html** - Blog layout, hero image, comments
- **ecommerce.html** - Product grid, filters, cart

## Comparison

To compare releases, view images side-by-side or use an image diff tool:

```bash
# Quick visual diff (macOS)
open tests/golden-captures/v1.4.1/dashboard_mode0.png tests/golden-captures/v1.5.0/dashboard_mode0.png
```

---

## Future: Volunteer Experiment Infrastructure

A long-term goal is enabling **online volunteer experiments** to validate simulation predictions against real user behavior.

### Proposed Workflow

1. **Prediction Capture**: Record what the simulation predicts users will see/miss at specific gaze points
2. **Task Design**: Present volunteers with tasks (e.g., "Find the price") on reference pages
3. **Data Collection**: Capture mouse trajectories, fixation sequences, task completion times
4. **Validation**: Compare predicted attention flow against actual user behavior

### Required Infrastructure (TODO)

| Component | Status | Description |
|-----------|--------|-------------|
| **Prediction Export** | ❌ Planned | Export simulation state at each fixation as JSON |
| **A/B Comparison Tool** | ❌ Planned | Side-by-side predicted vs actual gaze paths |
| **Data Format Spec** | ❌ Planned | Standardized format for research data exchange |
| **IRB-Ready Consent Flow** | ❌ Planned | Informed consent UI for research studies |

### Research Applications

- Validate Linguistic Pre-Attentive Layer predictions (see `docs/Linguistic Pre-Attentive Layer.md`)
- Compare simulation accuracy across different aesthetic modes
- Calibrate parameters (e.g., `lgn_ramp_end_mult`) against empirical data
