# Length-tuning A/B captures (Mode 17 vs Mode 14)

These are the A/B captures backing the Mode 17 (V1 length-tuning / end-stopping)
feature. The directory is `.gitignore`d as part of `tests/golden-captures/`, so
the two source captures and this manifest are **force-added** (`git add -f`) to
keep the feature's evidence reproducible from a clone (fixes TODO.md **M4** /
`docs/sprucing/phase-0-science-verification.md` **P0-4**).

## Files (tracked)

| File | Mode | Meaning |
|------|------|---------|
| `border_mode14_baseline.png` | 14 | Pyramid Mongrel baseline (length-tuning OFF) |
| `border_mode17_lengthtuned.png` | 17 | Same, length-tuning ON |
| `.capture-manifest.json` | — | Machine-readable spec: URL, fixation, radius, dimensions, mode, specHash per shot |

The intermediate `diff_*.png` files are derived working artifacts and remain
untracked; regenerate them from the two source captures if needed.

## Regeneration

Both captures come from the committed reference page
`tests/reference-pages/border-suppression.html` at 1920×1080, center fixation
(0.5, 0.5), radius 45, mobile off. See `.capture-manifest.json` for the exact
spec and `specHash` of each shot.

`scripts/capture-golden.js` takes no per-shot flags (it accepts only
`v=<version>`, `--force`, `--all-modes` and `--require-tier=N`). To regenerate,
pass the two `spec` objects from `.capture-manifest.json` to `run()` in
`scripts/lib/capture-runner.js` with `outputDir` set to this directory and
`force: true`. Each spec's `url` and `outputDir` are absolute paths on the
machine that made the captures, so rewrite them for your checkout. Captures are
display-DPR-dependent until the deterministic DPR pin lands, P2-4.

## Status

Mode 17's quantitative bio claim (Cavanaugh-Bair-Movshon 2002 length-tuning
curve) is **NOT yet validated**. The CBM-2002 harness does not exist (see
P0-3). These captures demonstrate the *qualitative* A/B effect (long structural
edges suppressed, short edges preserved) on one reference page. They are not a
quantitative validation. Empirical notes on the effect (contrast-gating of the
edge probe, 1-px light borders bypassing it) are in
`docs/specs/length_tuned_edge_suppression.md`.
