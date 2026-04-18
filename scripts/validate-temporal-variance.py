#!/usr/bin/env python3
"""
Temporal variance analyzer for DOM-aware compositor motion sensitivity.

Reads the captures produced by scripts/capture-temporal-variance.js and
computes, per mode and per eccentricity band, the mean-across-pixels of
the temporal standard deviation. The ratio mode-20 / mode-16 in the
parafovea (1°-2°) and near-periphery (2°-5°) bands is the motion-artifact
gauge: a ratio > 1.3 suggests the DOM-aware compositor introduces enough
frame-to-frame variance to risk peripheral motion-onset attention capture
(Abrams & Christ 2003; Franconeri & Simons 2003).

Output: tests/temporal-variance/temporal-variance-report.json. The Jest
regression test at tests/unit/temporal-variance.test.js reads that file.

Usage:
    uv run --python 3.12 scripts/validate-temporal-variance.py
    uv run --python 3.12 scripts/validate-temporal-variance.py --ceiling=1.5
"""
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=1.26",
#     "pillow>=10.0",
# ]
# ///

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Eccentricity band edges in degrees. 100 is an upper cap for "extreme periphery".
BAND_BOUNDS_DEG = [0, 1, 2, 5, 10, 20, 100]
BAND_LABELS = ["fovea", "parafovea", "near_peri", "mid_peri", "far_peri", "extreme"]

# Parafovea + near-periphery are where peripheral motion-onset is most
# attention-capturing (magnocellular pathway coverage peaks there).
MOTION_SENSITIVE_BANDS = ("parafovea", "near_peri")

DEFAULT_BASELINE_MODE = "16"
DEFAULT_CEILING = 1.3


def load_frames(output_dir: Path, mode: str, meta: dict) -> np.ndarray:
    """Return (N, H, W, 3) float32 stack for one mode's frames in capture order."""
    frames = []
    for f in meta["frames"]:
        if f["mode"] != mode:
            continue
        path = output_dir / f["filename"]
        if not path.exists():
            raise FileNotFoundError(f"Missing capture: {path}")
        img = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
        frames.append(img)
    if not frames:
        raise RuntimeError(f"No frames loaded for mode {mode}")
    return np.stack(frames, axis=0)


def temporal_std_map(stack: np.ndarray) -> np.ndarray:
    """Mean across RGB of per-pixel std across frames. Returns (H, W)."""
    return stack.std(axis=0).mean(axis=2)


def band_masks(h: int, w: int, center_x: float, center_y: float, ppd: float):
    """Return {label: bool-mask (H, W)} for each eccentricity band."""
    yy, xx = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    ecc_px = np.sqrt((xx - center_x) ** 2 + (yy - center_y) ** 2)
    ecc_deg = ecc_px / ppd
    masks = {}
    for lo, hi, label in zip(BAND_BOUNDS_DEG[:-1], BAND_BOUNDS_DEG[1:], BAND_LABELS):
        masks[label] = (ecc_deg >= lo) & (ecc_deg < hi)
    return masks


def band_mean_std(std_map: np.ndarray, masks: dict) -> dict:
    out = {}
    for label, mask in masks.items():
        if mask.any():
            out[label] = float(std_map[mask].mean())
        else:
            out[label] = float("nan")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--output-dir",
        default="tests/temporal-variance",
        help="Directory produced by capture-temporal-variance.js",
    )
    ap.add_argument(
        "--baseline",
        default=DEFAULT_BASELINE_MODE,
        help="Mode id to use as the motion-ratio denominator (default: 16)",
    )
    ap.add_argument(
        "--ceiling",
        type=float,
        default=DEFAULT_CEILING,
        help="Max mode/baseline ratio allowed in parafovea/near-peri (default: 1.3)",
    )
    args = ap.parse_args()

    output_dir = Path(args.output_dir)
    meta_path = output_dir / "capture-metadata.json"
    if not meta_path.exists():
        print(f"ERROR: {meta_path} missing — run capture-temporal-variance.js first")
        sys.exit(2)

    meta = json.loads(meta_path.read_text())
    w, h = meta["viewport"]["width"], meta["viewport"]["height"]
    cx = meta["centerPx"]["x"]
    cy = meta["centerPx"]["y"]
    ppd = meta["ppd"]
    masks = band_masks(h, w, cx, cy, ppd)

    per_mode = {}
    for mode in meta["modes"]:
        stack = load_frames(output_dir, mode, meta)
        std_map = temporal_std_map(stack)
        band_means = band_mean_std(std_map, masks)
        per_mode[mode] = band_means
        print(f"Mode {mode}:")
        for label in BAND_LABELS:
            print(f"  {label:10s}: {band_means[label]:6.2f}")

    if args.baseline not in per_mode:
        print(f"ERROR: baseline mode {args.baseline} not captured")
        sys.exit(2)
    baseline = per_mode[args.baseline]

    ratios = {}
    failures = []
    for mode in meta["modes"]:
        if mode == args.baseline:
            continue
        mode_ratios = {}
        for label in BAND_LABELS:
            base = baseline[label]
            val = per_mode[mode][label]
            if base <= 0 or np.isnan(base) or np.isnan(val):
                ratio = float("nan")
            else:
                ratio = val / base
            mode_ratios[label] = ratio
            if label in MOTION_SENSITIVE_BANDS and not np.isnan(ratio) and ratio > args.ceiling:
                failures.append(
                    f"mode {mode} band {label}: ratio {ratio:.2f} exceeds ceiling {args.ceiling}"
                )
        ratios[mode] = mode_ratios

    print()
    print(f"Motion-ratio vs baseline mode {args.baseline}:")
    for mode, mode_ratios in ratios.items():
        print(f"  mode {mode}:")
        for label in BAND_LABELS:
            val = mode_ratios[label]
            marker = ""
            if label in MOTION_SENSITIVE_BANDS:
                if np.isnan(val):
                    marker = " (n/a)"
                elif val > args.ceiling:
                    marker = f"  ✗ > {args.ceiling}"
                else:
                    marker = f"  ✓ ≤ {args.ceiling}"
            display = "nan" if np.isnan(val) else f"{val:.2f}"
            print(f"    {label:10s}: {display}{marker}")

    report = {
        "per_mode":         per_mode,
        "ratios":           ratios,
        "baseline_mode":    args.baseline,
        "ceiling":          args.ceiling,
        "motion_sensitive_bands": list(MOTION_SENSITIVE_BANDS),
        "failures":         failures,
        "fixture":          meta.get("fixture"),
        "sweep":            meta.get("sweep"),
        "ppd":              ppd,
    }
    report_path = output_dir / "temporal-variance-report.json"
    report_path.write_text(json.dumps(report, indent=2))
    print(f"\nReport: {report_path}")

    if failures:
        print(f"FAIL: {len(failures)} band(s) over ceiling.")
        for f in failures:
            print(f"  {f}")
        sys.exit(1)
    print(f"PASS: all motion-sensitive bands within {args.ceiling}× baseline.")


if __name__ == "__main__":
    main()
