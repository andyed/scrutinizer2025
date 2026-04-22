# Mind2Web × Scrutinizer: Predictive Attention Experiment

## Motivation

Scrutinizer's validation relies on 6 hand-crafted reference pages. Mind2Web provides 1,009 tasks across 73 real websites with full DOM snapshots and action sequences — orders of magnitude more content diversity. The dataset has everything needed to test whether peripheral rendering preserves enough visual information for task completion.

## The question

Given a task goal and a page, does Scrutinizer's peripheral rendering preserve the target element's visual salience at its eccentricity? If the simulation destroys the target's visibility, it's too aggressive. If it preserves it, it's calibrated correctly.

## Dataset

- **Source:** [OSU-NLP-Group/Mind2Web](https://github.com/OSU-NLP-Group/Mind2Web) (HuggingFace: osunlp/Mind2Web)
- **Local:** `~/Documents/dev/Mind2Web/data/data/train/` (11 JSON files, ~1,009 tasks)
- **Size:** ~13GB (includes raw HTML DOMs)
- **Format:** JSON per task with `raw_html`, `cleaned_html`, `operation`, `pos_candidates`, `neg_candidates`

## Per-task data available

```
confirmed_task: "Add Western Digital internal SSD with 1TB storage to the cart"
website: "newegg"
domain: "Shopping"
actions: [
  {
    raw_html: "<full DOM snapshot>",
    operation: { op: "CLICK", value: "" },
    pos_candidates: [{ tag: "link", text: "Western Digital WD_BLACK..." }],
    neg_candidates: [... 1120 other elements ...],
    action_uid: "..."
  },
  ...
]
action_reprs: ["[searchbox] Search Site -> CLICK", "[searchbox] -> TYPE: Western Digital...", ...]
```

## Experiment candidates (5 tasks)

Selected for layout diversity — different attention demands:

| Site | Domain | Actions | DOM | Candidates | Attention pattern |
|------|--------|---------|-----|------------|-------------------|
| ESPN | Entertainment | 6 | 415KB | 540 | Dense text/stats table — scanning numbers |
| Newegg | Shopping | 12 | 2.6MB | 1,120 | Product card grid — visual search across thumbnails |
| United | Travel | 12 | 149KB | 285 | Sequential form — fields, dropdowns, buttons |
| IMDb | Entertainment | 5 | 373KB | 789 | Media + text — posters competing with descriptions |
| MTA | Travel | 4 | 211KB | 252 | Sparse functional — hierarchy navigation |

## Pipeline

### Phase 1: DOM → Scrutinizer rendering

1. Load `raw_html` into Scrutinizer's BrowserView
2. Locate target element (`pos_candidates`) in rendered layout — get bounding box via DOM query
3. Set gaze to previous action's target (or center for first action) — simulates "where were you looking when you needed to find this"
4. Compute target eccentricity from gaze position
5. Capture through peripheral rendering pipeline

### Phase 2: Target visibility measurement

For each action step, measure whether the target element is visually distinguishable at its eccentricity:

- **Luminance contrast:** target region vs surrounding content in the rendered output
- **Edge coherence:** gradient magnitude within target's bounding box (structured edges = recognizable)
- **Color distinctiveness:** target's mean color vs sector mean in Oklab space
- **OCR (if text target):** can Tesseract read the target text through the simulation?

### Phase 3: Attention prediction

The dataset provides both what the user clicked (pos_candidates) and what they didn't (neg_candidates). For each action:

1. Compute visibility metrics for ALL candidates (pos + neg) through Scrutinizer
2. Rank candidates by predicted salience (visibility × information scent from task description)
3. Compare predicted rank of actual target vs baseline (random, center-biased)

If Scrutinizer's rendering preserves the target's salience relative to distractors, the attention prediction should outperform random. If it destroys the target equally with distractors, the simulation isn't capturing what peripheral vision actually preserves.

### Phase 4: Cross-mode comparison

Run Phase 2-3 for multiple Scrutinizer modes:
- Pyramid Mongrel (sectors + displacement) — current default
- TTM Synthesis (sectors only) — pure pooling
- Standard displacement (no sectors) — pre-TTM baseline
- Raw (no simulation) — upper bound

The mode that best predicts actual user attention is the most biologically accurate simulation.

## Implementation notes

- **DOM loading:** Scrutinizer's BrowserView can load raw HTML via `loadURL('data:text/html,...')` or write to temp file and `loadURL('file://...')`
- **Element location:** `document.querySelector` + `getBoundingClientRect()` via `executeJavaScript()` on the BrowserView
- **Scanpath construction:** Each task's action sequence → fixation points at target element centers. Import format matches existing `renderer/scanpath/scanpath-types.js`
- **Batch capture:** Existing `capture-runner.js` handles Electron batch capture — extend with per-action DOM loading

## Success criteria

1. Target elements have higher visibility scores than random distractors in the peripheral rendering (basic sanity)
2. Visibility ranking predicts actual click targets better than center-bias baseline
3. Sector-based modes (Pyramid Mongrel, TTM) predict better than non-sector modes — validates the sector geometry
4. Dense content pages (ESPN, Newegg) show larger differences between modes than sparse pages (MTA) — confirms sector pooling matters more when there's more to pool

## Dependencies

- Mind2Web dataset (cloned, 13GB)
- Scrutinizer Electron app (batch capture mode)
- Scanpath importer for Mind2Web action sequences (to build)
- Visibility metrics script (to build)
