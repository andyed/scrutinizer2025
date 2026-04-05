# Spec: Saliency Export CLI

## Motivation

The attentional-foraging project needs per-coordinate saliency and congestion values from Scrutinizer's existing vision pipeline to test whether survey-phase saccades preferentially target high-saliency SERP regions. Scrutinizer already computes Rosenholtz congestion and saliency maps internally; this spec adds a CLI interface to export that data without rendering a full gazeplot.

## Interface

```bash
node scripts/export-saliency.js \
  --input <serp-html-or-png> \
  --coordinates <json-file> \
  --output <json-file> \
  [--metrics saliency,congestion] \
  [--radius 60]
```

### Input

**`--input`**: Path to a SERP screenshot (PNG) or HTML file. If HTML, render at 1280px width via Playwright first (same pipeline as `build-gh-pages.js`).

**`--coordinates`**: JSON file with an array of query points:

```json
[
  {"id": "fix_1", "x": 450, "y": 320},
  {"id": "fix_2", "x": 680, "y": 520},
  ...
]
```

Coordinates are in the same pixel space as the input image (1280px width, full document height).

**`--radius`** (default 60): The foveal radius in pixels around each coordinate to sample. Matches Scrutinizer's foveal ring size.

### Output

JSON file with per-coordinate saliency and congestion values:

```json
[
  {
    "id": "fix_1",
    "x": 450,
    "y": 320,
    "saliency_mean": 0.342,
    "saliency_max": 0.891,
    "congestion_mean": 2.14,
    "congestion_max": 5.67
  },
  ...
]
```

- **`saliency_mean`**: Mean saliency within the foveal radius (from Scrutinizer's existing saliency map computation)
- **`saliency_max`**: Peak saliency within the radius
- **`congestion_mean`**: Mean Rosenholtz congestion within the radius
- **`congestion_max`**: Peak congestion within the radius

### Batch mode

For processing all AdSERP trials:

```bash
node scripts/export-saliency.js \
  --input-dir ../attentional-foraging/site/serp-renders/ \
  --coordinates-dir ../attentional-foraging/AdSERP/data/fixation-coords/ \
  --output-dir ../attentional-foraging/AdSERP/data/saliency/
```

Where `fixation-coords/` contains one JSON per trial (generated from fixation CSVs by a preprocessing script in attentional-foraging).

## Implementation notes

### What already exists in Scrutinizer

- Saliency map computation: runs in the WebGL/WebGPU pipeline as part of the LGN/V1 pathway
- Rosenholtz congestion: computed as a post-processing step
- Both are computed per-frame and available in the GPU texture pipeline
- The gazeplot capture scripts (`capture-fullpage-gazeplot.js`) already load images and run the pipeline

### What needs to be added

1. **Headless saliency-only mode**: Run the pipeline without the foveation overlay — just compute saliency and congestion maps and read them back from the GPU
2. **Coordinate sampling**: For each query point, sample the saliency/congestion textures at (x, y) with the given radius
3. **JSON output**: Write the sampled values

### Constraints

- No interactive window needed — headless Electron is fine
- The saliency map should be computed at full document height (same issue as gazeplot tiling, but for this use case a single full-height render is acceptable since we're just reading textures, not producing a screenshot)
- If full-height exceeds WebGL max texture size, tile and stitch (existing approach)

## Use case in attentional-foraging

```python
# In a notebook:
# 1. Export fixation coordinates per trial
# 2. Run Scrutinizer CLI to get saliency at each coordinate
# 3. Compare: saliency at survey fixations vs evaluate fixations
#    Hypothesis: survey targets higher-saliency regions (visual pop-out guides gist sampling)
```

## Priority

Low — the survey characterization analysis (saccade direction, click prediction, spatial spread) works without saliency data. This would add the visual feature angle.
