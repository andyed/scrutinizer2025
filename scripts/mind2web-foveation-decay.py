#!/usr/bin/env python3
"""
Mind2Web foveation-decay characterization (intrinsic).

For every foveated render in data/mind2web-cache-<hash>/, sample patches at
concentric eccentricity rings around the trial's fixation. For each patch,
compute local luminance variance (a content-density proxy). Aggregate across
trials to produce mean + IQR of patch variance per ring.

This is a CHARACTERIZATION of the one foveated image, not a comparison to a
non-foveated baseline. Eccentricity exists only relative to the fixation
point; comparing foveated-at-ecc-X to a no-fixation-image-at-ecc-X is a
category error. The question is: does the foveated render's local
information density actually decay as a function of eccentricity from the
fixation, the way the rendering is supposed to make it?

Predictions:
  - If foveation works: mean variance is highest at eccentricity 0 and
    monotonically decreases with eccentricity.
  - If foveation is doing nothing: mean variance is flat across rings
    (because the population of off-fovea patches happens to span the same
    content distribution as on-fovea patches).
  - If foveation INVERTS (the visualization is dominated by peripheral
    noise): mean variance INCREASES with eccentricity.

Usage:
  uv run --python 3.12 --with numpy --with pillow --with matplotlib python3 \\
    scripts/mind2web-foveation-decay.py
"""

from __future__ import annotations
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

REPO_ROOT = Path(__file__).resolve().parents[1]

# Rings at this many degrees out from fixation. 0 = center single point.
ECC_RINGS_DEG = [0, 2, 4, 6, 8, 10, 12, 15, 18, 21, 24, 27, 30]
SAMPLES_PER_RING = 16     # angular samples at each radius (1 used at radius 0)
PATCH_HALF = 8            # 17×17 patch (PATCH_HALF on each side of center pixel)


def find_cache_root() -> Path:
    import subprocess
    proc = subprocess.run(
        ["node", "-e",
         "const h=require('./scripts/mind2web-config-hash.js');"
         "const cfg=h.loadConfig('tests/validation/mind2web/arm-0-config.json');"
         "process.stdout.write(h.hashPrefix(cfg));"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    )
    p = REPO_ROOT / f"data/mind2web-cache-{proc.stdout.strip()}"
    if not p.exists():
        raise SystemExit(f"cache dir not found: {p}")
    return p


def luminance(rgb: np.ndarray) -> np.ndarray:
    """Rec. 709 luma from RGB uint8 → float32 [0,1]."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def sample_ring(cx: int, cy: int, radius_px: int, n: int) -> list[tuple[int, int]]:
    """Return n evenly-spaced (x, y) points on a circle of given radius."""
    if radius_px == 0:
        return [(cx, cy)]
    pts = []
    for i in range(n):
        theta = 2 * math.pi * i / n
        x = int(round(cx + radius_px * math.cos(theta)))
        y = int(round(cy + radius_px * math.sin(theta)))
        pts.append((x, y))
    return pts


def patch_in_bounds(x: int, y: int, w: int, h: int) -> bool:
    return (PATCH_HALF <= x < w - PATCH_HALF) and (PATCH_HALF <= y < h - PATCH_HALF)


def patch_variance(luma: np.ndarray, x: int, y: int) -> float:
    p = luma[y - PATCH_HALF: y + PATCH_HALF + 1, x - PATCH_HALF: x + PATCH_HALF + 1]
    return float(p.var())


# 3×3 Laplacian kernel — sums to zero, fires on edges. Pool-stats output
# (mean+variance preserving) crushes this; raw pixels keep it. Mean abs
# Laplacian over a patch = an "edge sharpness" proxy, not preserved by
# Rosenholtz pooling.
_LAPLACIAN_KERNEL = np.array([[0, -1, 0], [-1, 4, -1], [0, -1, 0]], dtype=np.float32)

def patch_laplacian_mag(luma: np.ndarray, x: int, y: int) -> float:
    p = luma[y - PATCH_HALF: y + PATCH_HALF + 1, x - PATCH_HALF: x + PATCH_HALF + 1]
    # Manual 3x3 conv on the patch interior; pad reflect to handle borders.
    ph, pw = p.shape
    out = np.zeros_like(p)
    out[1:-1, 1:-1] = (
        4 * p[1:-1, 1:-1]
        - p[:-2, 1:-1] - p[2:, 1:-1] - p[1:-1, :-2] - p[1:-1, 2:]
    )
    return float(np.abs(out[1:-1, 1:-1]).mean())


def collect_samples(cache_root: Path, px_per_deg: float, max_trials: int = 0):
    rows = []
    json_paths = sorted(cache_root.glob("*/*-v3.json"))
    if max_trials:
        json_paths = json_paths[:max_trials]
    for jp in json_paths:
        png_path = jp.with_suffix(".png")
        if not png_path.exists():
            continue
        d = json.loads(jp.read_text())
        fovea = d.get("fovea_screen")
        if not fovea:
            continue
        img = np.asarray(Image.open(png_path).convert("RGB"))
        h, w = img.shape[:2]
        luma = luminance(img)
        cx, cy = int(round(fovea["x"])), int(round(fovea["y"]))
        for ecc_deg in ECC_RINGS_DEG:
            radius_px = int(round(ecc_deg * px_per_deg))
            n_pts = 1 if ecc_deg == 0 else SAMPLES_PER_RING
            for px, py in sample_ring(cx, cy, radius_px, n_pts):
                if not patch_in_bounds(px, py, w, h):
                    continue
                p = luma[py - PATCH_HALF: py + PATCH_HALF + 1,
                         px - PATCH_HALF: px + PATCH_HALF + 1]
                rows.append({
                    "trial": jp.parent.name + "/" + jp.stem,
                    "ecc_deg": ecc_deg,
                    "radius_px": radius_px,
                    "x": px, "y": py,
                    "lum_var": patch_variance(luma, px, py),
                    "lap_mag": patch_laplacian_mag(luma, px, py),
                    "rms_contrast": float(p.std()),
                })
    return rows


def aggregate(rows: list[dict], key: str) -> dict[int, dict]:
    by_ring: dict[int, list[float]] = {}
    for r in rows:
        by_ring.setdefault(r["ecc_deg"], []).append(r[key])
    summary = {}
    for ecc, vals in sorted(by_ring.items()):
        a = np.array(vals)
        summary[ecc] = {
            "n": len(a),
            "mean": float(a.mean()),
            "median": float(np.median(a)),
            "p25": float(np.quantile(a, 0.25)),
            "p75": float(np.quantile(a, 0.75)),
            "std": float(a.std()),
        }
    return summary


def print_table(summary: dict[int, dict], label: str) -> None:
    print()
    print(f"━━━ {label} ━━━")
    hdr = f"{'ecc°':>5} {'n':>6} {'mean':>10} {'median':>10} {'p25':>10} {'p75':>10}"
    print(hdr)
    print("-" * len(hdr))
    for ecc, s in summary.items():
        print(f"{ecc:>5} {s['n']:>6} {s['mean']:>10.5f} {s['median']:>10.5f} "
              f"{s['p25']:>10.5f} {s['p75']:>10.5f}")
    means = [summary[e]["mean"] for e in sorted(summary)]
    monotonic = all(a >= b - 1e-6 for a, b in zip(means, means[1:]))
    print()
    print(f"  monotonic non-increasing mean? {monotonic}")
    if means and means[0] > 0:
        print(f"  outer/inner ratio: {means[-1]/means[0]:.3f}  (expect ≪ 1)")


def make_plot(summaries: dict[str, dict], rows: list[dict], out_path: Path) -> None:
    fig, axes = plt.subplots(1, len(summaries), figsize=(7 * len(summaries), 5.5),
                             squeeze=False)
    for ax, (label, summary) in zip(axes[0], summaries.items()):
        eccs = sorted(summary)
        means = [summary[e]["mean"] for e in eccs]
        medians = [summary[e]["median"] for e in eccs]
        p25 = [summary[e]["p25"] for e in eccs]
        p75 = [summary[e]["p75"] for e in eccs]
        if "rms" in label.lower():
            key = "rms_contrast"
        elif "variance" in label.lower():
            key = "lum_var"
        else:
            key = "lap_mag"
        ax.scatter([r["ecc_deg"] for r in rows], [r[key] for r in rows],
                   s=3, alpha=0.04, color="#999")
        ax.fill_between(eccs, p25, p75, alpha=0.18, color="#3b82f6",
                        label="IQR (25–75th pctl)")
        ax.plot(eccs, medians, "o-", color="#1d4ed8", linewidth=2, markersize=6,
                label="median")
        ax.plot(eccs, means, "s--", color="#dc2626", linewidth=1.5, markersize=5,
                alpha=0.7, label="mean")
        ax.set_xlabel("Eccentricity from fixation (degrees)", fontsize=12)
        ax.set_ylabel(label, fontsize=12)
        ax.set_xticks(ECC_RINGS_DEG)
        ax.grid(alpha=0.25)
        ax.legend(loc="upper right", fontsize=10)
        ax.set_xlim(-1, max(ECC_RINGS_DEG) + 1)
    fig.suptitle(f"Mind2Web Arm-0 foveation decay  ({len(rows)} patches × "
                 f"{len({r['trial'] for r in rows})} trials)", fontsize=13)
    plt.tight_layout()
    plt.savefig(out_path, dpi=140)
    plt.close(fig)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-trials", type=int, default=0)
    ap.add_argument("--out-json", type=Path,
                    default=REPO_ROOT / "tmp/foveation-decay.json")
    ap.add_argument("--out-plot", type=Path,
                    default=REPO_ROOT / "tmp/foveation-decay.png")
    args = ap.parse_args()

    cfg = json.loads((REPO_ROOT / "tests/validation/mind2web/arm-0-config.json").read_text())
    px_per_deg = float(cfg["viewing"]["px_per_deg"])
    cache_root = find_cache_root()
    print(f"cache:        {cache_root.relative_to(REPO_ROOT)}")
    print(f"px/deg:       {px_per_deg}")
    print(f"rings (°):    {ECC_RINGS_DEG}")
    print(f"samples/ring: {SAMPLES_PER_RING} (1 at center)")

    rows = collect_samples(cache_root, px_per_deg, max_trials=args.max_trials)
    print(f"sampled {len(rows)} patches across {len({r['trial'] for r in rows})} trials")
    if not rows:
        print("ERROR: no patches collected.", file=sys.stderr)
        return 1

    summary_var = aggregate(rows, "lum_var")
    summary_lap = aggregate(rows, "lap_mag")
    summary_rms = aggregate(rows, "rms_contrast")
    print_table(summary_rms, "RMS contrast (best foveation indicator — should decay)")
    print_table(summary_lap, "Laplacian magnitude (Gabor frequency dominates — flat-ish)")
    print_table(summary_var, "Luminance variance (preserved by pool stats — flat)")

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(
        {"px_per_deg": px_per_deg, "rings": ECC_RINGS_DEG,
         "summary_rms_contrast": summary_rms,
         "summary_lum_var": summary_var,
         "summary_lap_mag": summary_lap,
         "rows": rows}, indent=2) + "\n")
    make_plot({"RMS contrast (17×17 patch)": summary_rms,
               "Laplacian magnitude (17×17 patch)": summary_lap},
              rows, args.out_plot)
    print(f"\n  json: {args.out_json}")
    print(f"  plot: {args.out_plot}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
