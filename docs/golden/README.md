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

## Chromatic Pooling A/B Captures

v1.9+ captures include chromatic pooling on/off comparisons for color-spectrum and dashboard pages. The capture script passes `TEST_CHROMATIC_POOLING=true|false` to override the mode default, producing paired images:

- `color-spectrum_center_mode0_chromatic_on.png` — castleCSF per-channel RG/YV decay
- `color-spectrum_center_mode0_chromatic_off.png` — legacy uniform desaturation

Key visual differences to verify:
- Red elements desaturate faster with chromatic pooling ON (RG k_e=0.059)
- Blue elements persist further into periphery (YV k_e=0.004)
- Small colored text loses color faster than large colored regions (DoG band frequency dependence)

## Outputs
- docs/golden/summary-<version>.json : per-file metrics and pass/fail
- Console summary with counts of passes, fails, missing pairs
