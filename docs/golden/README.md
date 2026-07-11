# Golden Visual Comparisons

Storage and workflow for browser ↔ Figma visual parity checks.

> **Current status (2026-07-11):** parity is run **manually** via the steps
> below — it is **not** computed in CI, and there is no summary for the current
> HEAD. The only real metrics on disk are `summary-1.4.3.json` (11 pairs);
> `summary-2.6.0.json` has empty `results`. A phantom `summary-2.8.0.json`
> (`results:[]`, `maxPixelDiff:255` — a no-op gate that could never fail) and an
> empty `figma/v2.8.0/` were removed (P0-5); a unit guard now fails the build if
> a no-op summary reappears (`tests/unit/release-version-tag-sync.test.js`). Do
> not treat a golden summary as a passing parity check unless it has non-empty
> `results` and a real `maxPixelDiff` threshold (< 255).

## Structure
- browser/<version>/ : captures from Electron/browser build
- figma/<version>/ : captures exported from the Figma plugin with matching filenames
- summary-<version>.json : metrics (SSIM/PSNR/MSE) for matching pairs

## Running (browser capture + compare)
1) Build/capture browser goldens:
   - `npm run golden-compare -- --version=1.4.3`
   - Outputs under tests/golden-captures/v1.4.3 and copies to docs/golden/browser/v1.4.3
2) Provide Figma captures:
   - Export plugin canvas PNGs with the **same filenames** as browser captures
   - Place them in docs/golden/figma/v1.4.3 (or matching version)
3) Re-run compare to compute metrics:
   - `npm run golden-compare -- --version=1.4.3 --skip-browser-capture`

## Flags
- `--version=1.4.3` (or `v=1.4.3`): override package version
- `--skip-browser-capture`: skip rerunning capture-golden
- `--browser-only`: copy browser outputs but skip comparisons
- `--figma-only`: only read existing captures and compare
- `--threshold-ssim=0.98` and `--threshold-psnr=35`: adjust pass gates

## Pass Criteria (defaults)
- SSIM ≥ 0.98 and PSNR ≥ 35 dB between matching browser/figma PNGs
- Missing pairs are reported but do not fail the run

## Chromatic Pooling A/B Captures

v1.9+ captures include chromatic pooling on/off comparisons for color-spectrum and dashboard pages. The capture script passes `TEST_CHROMATIC_POOLING=true|false` to override the mode default, producing paired images:

- `color-spectrum_center_mode0_chromatic_on.png` — per-channel RG/YV chromatic pooling (castleCSF + suprathreshold correction)
- `color-spectrum_center_mode0_chromatic_off.png` — legacy uniform chrominance reduction

Key visual differences to verify:
- Red-green opponent signal attenuates faster than blue-yellow with chromatic pooling ON
- Blue elements persist further into periphery (YV pathway tracks near-achromatic)
- Small colored elements lose chromatic identity faster than large colored regions (spatial-frequency-dependent pooling)
- Large colored regions retain mean chromaticity well into periphery (Rosenholtz TTM: color is pooled, not lost)

## Outputs
- docs/golden/summary-<version>.json : per-file metrics and pass/fail
- Console summary with counts of passes, fails, missing pairs
