#!/usr/bin/env python3
"""
Gabor test-card generator for characterizing Scrutinizer's eccentricity
degradation across modes.

A 1280×768 background with 8 Gabor patches at each of 9 concentric rings
around viewport center. Patches are identical in size, contrast, and spatial
frequency; the *only* thing that varies is the patch's eccentricity from
fixation. So if a foveation mode produces graded peripheral degradation,
sampling Laplacian magnitude at each known patch location should yield a
monotonic decay vs eccentricity. If the curve is flat, the mode isn't
graded.

Outputs:
  tmp/gabor-card/card.png       — the test image
  tmp/gabor-card/card.html      — a minimal HTML wrapper (so the renderer
                                  can load it via file:// just like an MHTML)
  tmp/gabor-card/positions.json — known patch (x, y, eccentricity_deg) list
                                  for the analyzer to sample at
"""
from __future__ import annotations
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "tmp/gabor-card"
VIEWPORT_W, VIEWPORT_H = 1280, 768
PX_PER_DEG = 29.0
CX, CY = VIEWPORT_W // 2, VIEWPORT_H // 2  # fixation = center

# 9 rings × 8 azimuths.  Ring 0 (center) gets a single patch.
RING_ECCENTRICITIES_DEG = [0, 2, 5, 8, 11, 14, 17, 20, 24]
N_AZIMUTHS = 8
PATCH_SIZE = 64           # 64×64 patch (≈ 2.2° at 29 px/deg)
GABOR_FREQ = 0.18         # cycles/pixel — fine enough that pooling will crush it
GABOR_SIGMA = 14.0        # Gaussian envelope sigma in pixels
BG_GREY = 128             # mid-grey background (so high-pass filters see only patches)


def make_gabor(size: int, sigma: float, freq: float, theta_rad: float) -> np.ndarray:
    """Return a (size, size) float32 Gabor in [-1, 1]."""
    half = size // 2
    y, x = np.mgrid[-half:half, -half:half].astype(np.float32)
    envelope = np.exp(-(x ** 2 + y ** 2) / (2 * sigma ** 2))
    carrier = np.cos(2 * math.pi * freq * (x * math.cos(theta_rad) + y * math.sin(theta_rad)))
    return (envelope * carrier).astype(np.float32)


def paste_gabor(canvas: np.ndarray, gabor: np.ndarray, cx: int, cy: int) -> None:
    h, w = canvas.shape[:2]
    sh, sw = gabor.shape
    x0, y0 = cx - sw // 2, cy - sh // 2
    x1, y1 = x0 + sw, y0 + sh
    if x0 < 0 or y0 < 0 or x1 > w or y1 > h:
        return  # off-canvas, skip
    # Map [-1, 1] → [BG−127, BG+127], then clip.
    contribution = (gabor * 127).astype(np.int32) + canvas[y0:y1, x0:x1, 0].astype(np.int32)
    contribution = np.clip(contribution, 0, 255).astype(np.uint8)
    for ch in range(3):
        canvas[y0:y1, x0:x1, ch] = contribution


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    canvas = np.full((VIEWPORT_H, VIEWPORT_W, 3), BG_GREY, dtype=np.uint8)
    positions = []
    # All Gabors share orientation (vertical) so the only varying property
    # across rings is eccentricity.
    gabor = make_gabor(PATCH_SIZE, GABOR_SIGMA, GABOR_FREQ, theta_rad=math.pi / 2)

    half = PATCH_SIZE // 2
    for ring_idx, ecc_deg in enumerate(RING_ECCENTRICITIES_DEG):
        radius_px = ecc_deg * PX_PER_DEG
        n = 1 if ecc_deg == 0 else N_AZIMUTHS
        for i in range(n):
            theta = 2 * math.pi * i / n if n > 1 else 0.0
            gx = int(round(CX + radius_px * math.cos(theta)))
            gy = int(round(CY + radius_px * math.sin(theta)))
            # Skip Gabors whose patch would land off-canvas. With viewport
            # 1280×768 and centre fixation, vertical reach is only ~12°
            # while horizontal reach goes to ~21°. Per-azimuth filtering
            # keeps the equator at high eccentricities while dropping
            # vertical patches that don't fit.
            if (gx - half < 0 or gy - half < 0
                    or gx + half > VIEWPORT_W or gy + half > VIEWPORT_H):
                continue
            paste_gabor(canvas, gabor, gx, gy)
            positions.append({
                "ring_idx": ring_idx,
                "ecc_deg": ecc_deg,
                "azimuth_idx": i,
                "x": gx, "y": gy,
                "patch_size": PATCH_SIZE,
            })

    img = Image.fromarray(canvas, mode="RGB")
    img.save(OUT_DIR / "card.png")

    # Minimal HTML so the renderer can load via file:// like any other URL.
    # The image is positioned at (0,0) and sized to viewport dimensions; no CSS
    # margin/padding so the captured pixels match canvas pixels 1:1.
    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>gabor card</title>
<style>html,body{{margin:0;padding:0;background:#808080;}}
img{{display:block;width:{VIEWPORT_W}px;height:{VIEWPORT_H}px;}}</style>
</head><body><img src="card.png"></body></html>"""
    (OUT_DIR / "card.html").write_text(html)

    (OUT_DIR / "positions.json").write_text(json.dumps({
        "viewport": {"w": VIEWPORT_W, "h": VIEWPORT_H},
        "fixation": {"x": CX, "y": CY},
        "px_per_deg": PX_PER_DEG,
        "patch_size": PATCH_SIZE,
        "gabor": {"freq_cyc_per_px": GABOR_FREQ, "sigma_px": GABOR_SIGMA, "orientation_rad": math.pi / 2},
        "positions": positions,
    }, indent=2) + "\n")
    print(f"  card:      {OUT_DIR / 'card.png'}  ({VIEWPORT_W}×{VIEWPORT_H})")
    print(f"  html:      {OUT_DIR / 'card.html'}")
    print(f"  positions: {OUT_DIR / 'positions.json'}  ({len(positions)} patches)")


if __name__ == "__main__":
    main()
