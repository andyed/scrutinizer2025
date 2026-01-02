# Golden Visual Comparisons

Storage and workflow for browser ↔ Figma visual parity checks.

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

## Outputs
- docs/golden/summary-<version>.json : per-file metrics and pass/fail
- Console summary with counts of passes, fails, missing pairs
