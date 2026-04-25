#!/usr/bin/env python3
"""
Per-mode decay analyzer.

Sample known-Gabor patches in each mode's render of the Gabor test card.
Compute Laplacian magnitude per patch; aggregate per ring per mode; plot
all modes' info-vs-eccentricity curves overlaid.

If a mode produces graded eccentricity decay, its curve will be monotonic
non-increasing. If it's flat, the mode isn't doing graded foveation.

Usage:
  uv run --python 3.12 --with numpy --with pillow --with matplotlib python3 \\
    scripts/measure-mode-decay.py
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

REPO_ROOT = Path(__file__).resolve().parents[1]
CARD_DIR = REPO_ROOT / "tmp/gabor-card"
RENDERS_DIR = CARD_DIR / "renders"

# Mode-id → human name. Use names not numbers in the output.
MODE_NAMES = {
    0:  "High-Key (default)",
    1:  "Biological",
    2:  "Frosted",
    3:  "Blueprint",
    4:  "Minecraft",
    5:  "Drunken Reading",
    6:  "Log-Polar MIP",
    7:  "Legacy v1.6",
    8:  "Minecraft Eyeball",
    9:  "Congestion Pooling",
    10: "Compute Mongrel",
    12: "Fovi Isotropic",
    14: "Pyramid Mongrel",
    15: "Tier3 Synthesis",
    16: "Text Baseline (clone of Default)",
    20: "DOM-Aware Text",
}


def luminance(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def rms_contrast(patch: np.ndarray) -> float:
    """RMS contrast = std(luminance) within patch. A blurred Gabor has lower
    contrast than a sharp one (the sinusoid amplitude is preserved by
    Laplacian-like measures because the blur shifts frequency, not energy
    at each scale, but std drops). Better metric for Gabor visibility than
    Laplacian magnitude."""
    return float(patch.std())


def measure_one(png_path: Path, positions: list[dict], patch_size: int) -> list[dict]:
    img = np.asarray(Image.open(png_path).convert("RGB"))
    h, w = img.shape[:2]
    luma = luminance(img)
    half = patch_size // 2
    rows = []
    for pos in positions:
        x, y = pos["x"], pos["y"]
        if x - half < 0 or y - half < 0 or x + half > w or y + half > h:
            continue
        patch = luma[y - half: y + half, x - half: x + half]
        rows.append({
            "ring_idx": pos["ring_idx"],
            "ecc_deg": pos["ecc_deg"],
            "x": x, "y": y,
            "rms_contrast": rms_contrast(patch),
        })
    return rows


def aggregate(rows: list[dict]) -> dict[float, dict]:
    by_ecc: dict[float, list[float]] = {}
    for r in rows:
        by_ecc.setdefault(r["ecc_deg"], []).append(r["rms_contrast"])
    out = {}
    for ecc, vals in sorted(by_ecc.items()):
        a = np.array(vals)
        out[ecc] = {"n": len(a), "mean": float(a.mean()),
                    "median": float(np.median(a)),
                    "min": float(a.min()), "max": float(a.max())}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-json", type=Path,
                    default=REPO_ROOT / "tmp/gabor-card/decay.json")
    ap.add_argument("--out-plot", type=Path,
                    default=REPO_ROOT / "tmp/gabor-card/decay.png")
    args = ap.parse_args()

    pos_meta = json.loads((CARD_DIR / "positions.json").read_text())
    positions = pos_meta["positions"]
    patch_size = pos_meta["patch_size"]

    # Baseline = the raw test card, what the rendering should preserve at fovea.
    baseline_rows = measure_one(CARD_DIR / "card.png", positions, patch_size)
    baseline_agg = aggregate(baseline_rows)

    per_mode = {}
    for png in sorted(RENDERS_DIR.glob("mode*.png")):
        mode_id = int(png.stem.replace("mode", ""))
        name = MODE_NAMES.get(mode_id, f"mode {mode_id}")
        rows = measure_one(png, positions, patch_size)
        per_mode[mode_id] = {"name": name, "agg": aggregate(rows)}

    # Print table.
    eccs = sorted({pos["ecc_deg"] for pos in positions})
    print(f"\n━━━ Per-mode RMS contrast by eccentricity ━━━")
    print(f"  baseline = raw Gabor card (no rendering)\n")
    hdr = "  ecc°  | " + "  ".join(f"{e:>5.0f}°" for e in eccs)
    print(hdr)
    print("  " + "-" * (len(hdr) - 2))
    base_cells = "  ".join(f"{baseline_agg[e]['mean']:>6.3f}" if e in baseline_agg else "  ----" for e in eccs)
    print(f"  {'baseline':<20} {base_cells}")
    for mode_id, data in per_mode.items():
        agg = data["agg"]
        cells = "  ".join(f"{agg[e]['mean']:>6.3f}" if e in agg else "  ----" for e in eccs)
        print(f"  {data['name'][:20]:<20} {cells}")

    # Plot all modes overlaid.
    fig, ax = plt.subplots(figsize=(10, 6.5))
    # Baseline first, in black, for reference.
    base_eccs = sorted(baseline_agg)
    base_means = [baseline_agg[e]["mean"] for e in base_eccs]
    ax.plot(base_eccs, base_means, "k-", linewidth=2.5, marker="o",
            label="raw card (baseline)", zorder=10)

    cmap = plt.cm.viridis(np.linspace(0, 1, len(per_mode)))
    for color, (mode_id, data) in zip(cmap, per_mode.items()):
        agg = data["agg"]
        ee = sorted(agg)
        means = [agg[e]["mean"] for e in ee]
        ax.plot(ee, means, "o-", color=color, label=data["name"], alpha=0.85,
                linewidth=1.6, markersize=5)

    ax.set_xlabel("Eccentricity from fixation (degrees)", fontsize=12)
    ax.set_ylabel("Mean RMS contrast (sampled at known Gabor positions)",
                  fontsize=12)
    ax.set_title("Scrutinizer foveation by mode — Gabor test card, fixation at center",
                 fontsize=13)
    ax.set_xticks(eccs)
    ax.grid(alpha=0.25)
    ax.legend(loc="upper right", fontsize=9)
    ax.set_xlim(-1, max(eccs) + 1)
    plt.tight_layout()
    plt.savefig(args.out_plot, dpi=140)

    args.out_json.write_text(json.dumps({
        "baseline": baseline_agg,
        "modes": {str(mid): {"name": d["name"], "agg": d["agg"]}
                  for mid, d in per_mode.items()},
    }, indent=2) + "\n")
    print(f"\n  json: {args.out_json}")
    print(f"  plot: {args.out_plot}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
