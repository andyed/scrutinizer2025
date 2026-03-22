#!/usr/bin/env python3
"""
Generate reference Laplacian pyramid decompositions for validating WGSL implementation.

Produces per-subband float32 binary files + metadata JSON for comparison against
the WebGPU compute pyramid-decompose shader.

Test images:
  1. Solid gray (identity check: all energy in residual)
  2. Horizontal grating (frequency selectivity: energy in band matching grating freq)
  3. Vertical grating
  4. Checkerboard (energy across multiple bands)
  5. Natural image crop (general fidelity)

Usage:
  uv run --python 3.12 scripts/generate-pyramid-reference.py
  uv run --python 3.12 scripts/generate-pyramid-reference.py --output-dir tests/validation/pyramid-reference
"""

import argparse
import json
import os
import struct
import sys

import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DEFAULT_OUTPUT = os.path.join(PROJECT_ROOT, 'tests', 'validation', 'pyramid-reference')

# Match the planned WGSL implementation: 4 scales + residual
PYRAMID_LEVELS = 4
IMAGE_SIZE = 256  # Square test images for simplicity


def gaussian_blur_2d(img, sigma=1.0):
    """Separable Gaussian blur matching the WGSL implementation's shared-memory approach."""
    # Kernel radius: ceil(3*sigma)
    radius = int(np.ceil(3 * sigma))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-x**2 / (2 * sigma**2))
    kernel /= kernel.sum()

    # Separable: horizontal then vertical
    from scipy.ndimage import convolve1d
    blurred = convolve1d(img, kernel, axis=1, mode='reflect')
    blurred = convolve1d(blurred, kernel, axis=0, mode='reflect')
    return blurred


def downsample_2x(img):
    """Box downsample 2x — average each 2x2 block."""
    h, w = img.shape
    h2, w2 = h // 2, w // 2
    return img[:h2*2, :w2*2].reshape(h2, 2, w2, 2).mean(axis=(1, 3))


def upsample_2x(img, target_h, target_w):
    """Nearest-neighbor upsample to target size, then Gaussian smooth."""
    h, w = img.shape
    up = np.repeat(np.repeat(img, 2, axis=0), 2, axis=1)
    # Crop to target size (handles odd dimensions)
    up = up[:target_h, :target_w]
    return up


def build_laplacian_pyramid(img, levels=PYRAMID_LEVELS):
    """
    Build a Laplacian pyramid: band[k] = level[k] - upsample(level[k+1]).
    Bands are stored at their native resolution (band_k is same size as level k).
    Residual is stored at original resolution (upsampled) for easy reconstruction.
    """
    bands = []
    gaussian_levels = [img.astype(np.float64)]
    current = img.astype(np.float64)

    # Build Gaussian pyramid (successively blurred + downsampled)
    for k in range(levels):
        blurred = gaussian_blur_2d(current, sigma=1.0)
        down = downsample_2x(blurred)
        gaussian_levels.append(down)
        current = down

    # Build Laplacian bands: each band = gaussian[k] - upsample(gaussian[k+1])
    # Store at ORIGINAL resolution (upsample the band difference back up)
    # so reconstruction is simply sum(all bands).
    # Also store native-res data for WGSL comparison.
    orig_h, orig_w = img.shape
    for k in range(levels):
        up = upsample_2x(gaussian_levels[k + 1],
                         gaussian_levels[k].shape[0],
                         gaussian_levels[k].shape[1])
        band_native = gaussian_levels[k] - up  # at level-k resolution

        # Upsample to original resolution for reconstruction
        band_full = band_native
        for j in range(k - 1, -1, -1):
            band_full = upsample_2x(band_full,
                                    gaussian_levels[j].shape[0],
                                    gaussian_levels[j].shape[1])

        bands.append({
            'data': band_full,           # original resolution (for reconstruction)
            'data_native': band_native,  # native resolution (for WGSL comparison)
            'width': band_native.shape[1],
            'height': band_native.shape[0],
            'full_width': orig_w,
            'full_height': orig_h,
            'level': k,
            'label': f'band_{k}',
        })

    # Residual: lowest Gaussian level, upsampled to original size
    residual = gaussian_levels[levels]
    for k in range(levels - 1, -1, -1):
        residual = upsample_2x(residual,
                               gaussian_levels[k].shape[0],
                               gaussian_levels[k].shape[1])

    bands.append({
        'data': residual,
        'data_native': gaussian_levels[levels],  # at lowest resolution
        'width': gaussian_levels[levels].shape[1],
        'height': gaussian_levels[levels].shape[0],
        'full_width': orig_w,
        'full_height': orig_h,
        'level': levels,
        'label': 'residual',
    })

    return bands


def reconstruction_error(img, bands):
    """Sum all bands + residual (all stored at original resolution) and compute MSE."""
    orig_h, orig_w = img.shape
    recon = np.zeros((orig_h, orig_w), dtype=np.float64)
    for b in bands:
        recon += b['data']  # 'data' is always at original resolution
    mse = np.mean((img.astype(np.float64) - recon) ** 2)
    return mse, recon


def generate_test_images():
    """Generate the test image suite."""
    images = {}
    N = IMAGE_SIZE

    # 1. Solid gray (0.5)
    images['solid_gray'] = np.full((N, N), 0.5, dtype=np.float64)

    # 2. Horizontal grating — low frequency (4 cycles across image)
    y = np.linspace(0, 1, N)
    grating_h = 0.5 + 0.5 * np.sin(2 * np.pi * 4 * y)
    images['grating_horizontal_4cpx'] = np.tile(grating_h[:, None], (1, N))

    # 3. Horizontal grating — high frequency (32 cycles)
    grating_hf = 0.5 + 0.5 * np.sin(2 * np.pi * 32 * y)
    images['grating_horizontal_32cpx'] = np.tile(grating_hf[:, None], (1, N))

    # 4. Vertical grating (8 cycles)
    x = np.linspace(0, 1, N)
    grating_v = 0.5 + 0.5 * np.sin(2 * np.pi * 8 * x)
    images['grating_vertical_8cpx'] = np.tile(grating_v[None, :], (N, 1))

    # 5. Checkerboard (16x16 blocks)
    block = N // 16
    checker = np.zeros((N, N), dtype=np.float64)
    for i in range(N):
        for j in range(N):
            if ((i // block) + (j // block)) % 2 == 0:
                checker[i, j] = 0.8
            else:
                checker[i, j] = 0.2
    images['checkerboard_16'] = checker

    # 6. White noise (seeded for reproducibility)
    rng = np.random.default_rng(42)
    images['white_noise'] = rng.uniform(0, 1, (N, N))

    return images


def compute_band_statistics(band_data):
    """Compute summary statistics for a single band — used for cross-validation."""
    flat = band_data.ravel()
    return {
        'mean': float(np.mean(flat)),
        'std': float(np.std(flat)),
        'abs_mean': float(np.mean(np.abs(flat))),
        'energy': float(np.sum(flat ** 2)),
        'min': float(np.min(flat)),
        'max': float(np.max(flat)),
        'skewness': float(skewness(flat)),
    }


def skewness(x):
    """Fisher skewness."""
    m = np.mean(x)
    s = np.std(x)
    if s < 1e-12:
        return 0.0
    return float(np.mean(((x - m) / s) ** 3))


def cross_scale_correlation(band_k_native, band_k1_native):
    """
    Pearson correlation between |band_k| and |band_{k+1}| magnitudes.
    Both at native resolution — upsample k+1 to match k.
    This is THE key statistic for Tier 3 TTM synthesis.
    """
    # Upsample band_k1 to match band_k dimensions
    up = upsample_2x(np.abs(band_k1_native), band_k_native.shape[0], band_k_native.shape[1])
    a = np.abs(band_k_native).ravel()
    b = up.ravel()

    # Pearson correlation
    a_centered = a - a.mean()
    b_centered = b - b.mean()
    denom = np.sqrt(np.sum(a_centered**2) * np.sum(b_centered**2))
    if denom < 1e-12:
        return 0.0
    return float(np.sum(a_centered * b_centered) / denom)


def save_band_binary(band_data, filepath):
    """Save float64 array as float32 binary for JS/WGSL comparison."""
    data32 = band_data.astype(np.float32)
    with open(filepath, 'wb') as f:
        f.write(data32.tobytes())


def main():
    parser = argparse.ArgumentParser(description='Generate pyramid reference data')
    parser.add_argument('--output-dir', default=DEFAULT_OUTPUT, help='Output directory')
    args = parser.parse_args()

    out_dir = args.output_dir
    os.makedirs(out_dir, exist_ok=True)

    images = generate_test_images()
    all_results = {}

    for name, img in images.items():
        print(f'\n=== {name} ({img.shape[1]}x{img.shape[0]}) ===')

        # Build pyramid
        bands = build_laplacian_pyramid(img)

        # Reconstruction error
        mse, recon = reconstruction_error(img, bands)
        print(f'  Reconstruction MSE: {mse:.8f}')

        # Per-band statistics (computed on native-resolution data)
        band_stats = []
        for b in bands:
            stats = compute_band_statistics(b['data_native'])
            print(f"  {b['label']} ({b['width']}x{b['height']}): "
                  f"mean={stats['mean']:.6f}, abs_mean={stats['abs_mean']:.6f}, "
                  f"energy={stats['energy']:.4f}, skew={stats['skewness']:.4f}")
            band_stats.append({
                'level': b['level'],
                'label': b['label'],
                'width': b['width'],
                'height': b['height'],
                'stats': stats,
            })

        # Cross-scale magnitude correlations (native resolution)
        cross_corrs = []
        for k in range(PYRAMID_LEVELS - 1):
            corr = cross_scale_correlation(
                bands[k]['data_native'], bands[k + 1]['data_native'])
            cross_corrs.append({
                'parent': k,
                'child': k + 1,
                'correlation': corr,
            })
            print(f'  Cross-scale corr(band_{k}, band_{k+1}): {corr:.6f}')

        # Total energy conservation (using full-res data for apples-to-apples)
        total_image_energy = float(np.sum(img.astype(np.float64) ** 2))
        total_band_energy = sum(float(np.sum(b['data'] ** 2)) for b in bands)
        energy_ratio = total_band_energy / total_image_energy if total_image_energy > 0 else 0
        print(f'  Energy conservation: image={total_image_energy:.4f}, '
              f'bands={total_band_energy:.4f}, ratio={energy_ratio:.6f}')

        # Save binary band data (both native and full resolution)
        img_dir = os.path.join(out_dir, name)
        os.makedirs(img_dir, exist_ok=True)

        for b in bands:
            # Native resolution (what WGSL produces)
            save_band_binary(b['data_native'],
                             os.path.join(img_dir, f"{b['label']}_native.f32"))
            # Full resolution (for reconstruction check)
            save_band_binary(b['data'],
                             os.path.join(img_dir, f"{b['label']}_full.f32"))

        # Save source image
        save_band_binary(img, os.path.join(img_dir, 'source.f32'))

        # Save reconstruction
        save_band_binary(recon, os.path.join(img_dir, 'reconstruction.f32'))

        all_results[name] = {
            'source': {
                'width': img.shape[1],
                'height': img.shape[0],
                'energy': total_image_energy,
            },
            'pyramid_levels': PYRAMID_LEVELS,
            'bands': band_stats,
            'cross_scale_correlations': cross_corrs,
            'reconstruction_mse': mse,
            'energy_conservation_ratio': energy_ratio,
        }

    # Write metadata
    meta_path = os.path.join(out_dir, 'pyramid-reference.json')
    with open(meta_path, 'w') as f:
        json.dump({
            'generated_by': 'generate-pyramid-reference.py',
            'pyramid_levels': PYRAMID_LEVELS,
            'image_size': IMAGE_SIZE,
            'gaussian_sigma': 1.0,
            'downsample': 'box_2x2',
            'upsample': 'nearest_neighbor_2x',
            'images': all_results,
        }, f, indent=2)

    print(f'\nReference data written to {out_dir}')
    print(f'Metadata: {meta_path}')


if __name__ == '__main__':
    main()
