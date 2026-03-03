#!/usr/bin/env python3
"""
validate-congestion.py — Python reference Feature Congestion computation

Uses the visual-clutter package (kargaranamir/visual-clutter), a faithful port
of Rosenholtz et al. (2007) MATLAB toolbox, as ground truth.

Usage:
    uv run scripts/validate-congestion.py --download   # Fetch Rosenholtz benchmark maps
    uv run scripts/validate-congestion.py              # Compute FC on all images

Outputs:
    tests/validation/results/python_results.json
    tests/validation/results/python_maps/*.png
"""

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

# visual-clutter uses PIL.Image.ANTIALIAS which was removed in Pillow 10.
# Monkey-patch the alias so the library works with modern Pillow.
if not hasattr(Image, "ANTIALIAS"):
    Image.ANTIALIAS = Image.LANCZOS

ROOT = Path(__file__).resolve().parent.parent
ROSENHOLTZ_DIR = ROOT / "tests" / "validation" / "rosenholtz-maps"
SCREENSHOT_DIR = ROOT / "tests" / "reference-pages" / "screenshots"
OUTPUT_DIR = ROOT / "tests" / "validation" / "results"
MAP_DIR = OUTPUT_DIR / "python_maps"


# ── Rosenholtz benchmark image download ──────────────────────────────────
# The 25 benchmark scenes from Rosenholtz, Li & Nakano (2007).
# These are the images used in the subjective clutter rating experiment
# (Spearman r=0.83 between FC scalar and human judgments).
#
# Source: visual-clutter repo test images and MIT DSpace supplementary materials.
# If these URLs become stale, the script skips gracefully and works with
# whatever images are already present in the rosenholtz-maps directory.

BENCHMARK_URLS = {
    # visual-clutter repo test image (known-good baseline)
    "test.jpg": "https://raw.githubusercontent.com/kargaranamir/visual-clutter/main/tests/test.jpg",
}


def download_benchmarks():
    """Download Rosenholtz benchmark images."""
    ROSENHOLTZ_DIR.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    skipped = 0
    for name, url in BENCHMARK_URLS.items():
        dest = ROSENHOLTZ_DIR / name
        if dest.exists():
            skipped += 1
            continue
        print(f"  Downloading {name} ... ", end="", flush=True)
        try:
            urllib.request.urlretrieve(url, dest)
            print("OK")
            downloaded += 1
        except Exception as e:
            print(f"FAILED: {e}")

    # Convert JPGs to PNG for Node.js pngjs compatibility
    for jpg in ROSENHOLTZ_DIR.glob("*.jpg"):
        png_path = jpg.with_suffix(".png")
        if not png_path.exists():
            print(f"  Converting {jpg.name} → {png_path.name}")
            Image.open(jpg).save(png_path)

    print(f"\nDownloaded: {downloaded}, Skipped (exists): {skipped}")
    total = len(list(ROSENHOLTZ_DIR.glob("*.png")))
    print(f"Total PNGs available: {total}")


# ── Feature Congestion computation ───────────────────────────────────────

def compute_fc(image_path: Path) -> dict:
    """Run visual-clutter Feature Congestion on a single image.

    Returns dict with scalar FC value, stats, and the per-pixel clutter map.
    """
    from visual_clutter import Vlc

    # visual-clutter expects a string path
    clt = Vlc(
        str(image_path),
        numlevels=3,
        contrast_filt_sigma=1,
        contrast_pool_sigma=3,
        color_pool_sigma=3,
    )

    scalar, clutter_map = clt.getClutter_FC(p=1, pix=1)

    # Compute stats matching Scrutinizer computeStats output
    flat = clutter_map.flatten()
    sorted_vals = np.sort(flat)
    n = len(sorted_vals)

    h, w = clutter_map.shape[:2]
    qw, qh = w // 2, h // 2

    # Quadrant means
    tl = clutter_map[:qh, :qw].mean() if qh > 0 and qw > 0 else 0.0
    tr = clutter_map[:qh, qw:].mean() if qh > 0 else 0.0
    bl = clutter_map[qh:, :qw].mean() if qw > 0 else 0.0
    br = clutter_map[qh:, qw:].mean()

    return {
        "scalar": float(scalar),
        "mean": float(flat.mean()),
        "p90": float(sorted_vals[int(n * 0.9)]),
        "p10": float(sorted_vals[int(n * 0.1)]),
        "max": float(sorted_vals[-1]),
        "width": w,
        "height": h,
        "quadrants": {
            "topLeft": float(tl),
            "topRight": float(tr),
            "bottomLeft": float(bl),
            "bottomRight": float(br),
        },
        "map": clutter_map,
    }


def save_heatmap(clutter_map: np.ndarray, path: Path):
    """Save clutter map as grayscale PNG, normalized to [0, 255]."""
    # Normalize to 0-1 range
    vmin, vmax = clutter_map.min(), clutter_map.max()
    if vmax - vmin < 1e-6:
        normalized = np.zeros_like(clutter_map)
    else:
        normalized = (clutter_map - vmin) / (vmax - vmin)

    gray = (normalized * 255).clip(0, 255).astype(np.uint8)

    # Handle 2D or 3D array
    if gray.ndim == 3:
        gray = gray.mean(axis=2).astype(np.uint8)

    Image.fromarray(gray, mode="L").save(path)


# ── Main ─────────────────────────────────────────────────────────────────

def collect_images() -> list[dict]:
    """Gather all images to process."""
    images = []

    # Rosenholtz benchmark PNGs
    if ROSENHOLTZ_DIR.exists():
        for f in sorted(ROSENHOLTZ_DIR.glob("*.png")):
            images.append({"path": f, "name": f.name, "source": "rosenholtz"})

    # Reference page screenshots
    if SCREENSHOT_DIR.exists():
        for f in sorted(SCREENSHOT_DIR.glob("*.png")):
            images.append({"path": f, "name": f.name, "source": "reference-page"})

    return images


def main():
    parser = argparse.ArgumentParser(description="Validate Scrutinizer FC against Rosenholtz reference")
    parser.add_argument("--download", action="store_true", help="Download Rosenholtz benchmark maps")
    args = parser.parse_args()

    if args.download:
        print("Downloading Rosenholtz benchmark maps...")
        download_benchmarks()
        return

    images = collect_images()
    if not images:
        print("No images found. Run with --download first, or add screenshots to tests/reference-pages/screenshots/", file=sys.stderr)
        sys.exit(1)

    # Ensure output dirs exist
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MAP_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    print(f"Processing {len(images)} images with visual-clutter FC...")

    for img in images:
        name = img["name"]
        print(f"  {name} ... ", end="", flush=True)

        try:
            fc = compute_fc(img["path"])

            # Save heatmap
            map_name = name.replace(".png", "_fc.png")
            save_heatmap(fc["map"], MAP_DIR / map_name)

            results.append({
                "name": name,
                "source": img["source"],
                "scalar": fc["scalar"],
                "mean": fc["mean"],
                "p90": fc["p90"],
                "p10": fc["p10"],
                "max": fc["max"],
                "width": fc["width"],
                "height": fc["height"],
                "quadrants": fc["quadrants"],
                "mapFile": map_name,
            })

            print(f"scalar={fc['scalar']:.4f} mean={fc['mean']:.4f}")

        except Exception as e:
            print(f"ERROR: {e}")
            results.append({"name": name, "source": img["source"], "error": str(e)})

    # Write results
    output_path = OUTPUT_DIR / "python_results.json"
    output_path.write_text(json.dumps({
        "generator": "validate-congestion.py",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "params": {
            "numlevels": 3,
            "contrast_filt_sigma": 1,
            "contrast_pool_sigma": 3,
            "color_pool_sigma": 3,
            "colorSpace": "CIE L*a*b*",
        },
        "images": results,
    }, indent=2))

    print(f"\nResults written to {output_path}")
    print(f"Heatmaps written to {MAP_DIR}/")


if __name__ == "__main__":
    main()
