#!/usr/bin/env python3
"""
Generate ground truth metamers using Brown et al.'s Portilla-Simoncelli pipeline.

Wraps the PooledStatisticsMetamers repo to produce gaze-centric metamers
from raw page screenshots, for comparison against Scrutinizer's real-time
approximation.

Usage (single image):
  uv run --python 3.12 scripts/generate-brown-metamers.py \
    --input tests/golden-captures/raw/dashboard_center_raw.png \
    --gaze 0.5,0.5 \
    --output tests/golden-captures/brown-metamers/dashboard_center_brown.png

Usage (batch from manifest):
  uv run --python 3.12 scripts/generate-brown-metamers.py --batch

Parameters match D3 spec in brown_dataflow_integration.md:
  scaling=0.75, pooling_size=96, iterations=300, gaze=center
"""

import argparse
import json
import os
import sys
import time

# Force non-interactive matplotlib backend BEFORE anything imports pyplot.
# Brown's metamerconfig.py calls plot_image() -> plt.show() which blocks
# in headless environments (no display server).
import matplotlib
matplotlib.use('Agg')

# Add Brown et al. repo to path — sibling directory to scrutinizer2025
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
BROWN_REPO = os.path.join(os.path.dirname(PROJECT_ROOT), 'PooledStatisticsMetamers', 'poolstatmetamer')

if not os.path.isdir(BROWN_REPO):
    print(f"ERROR: Brown et al. repo not found at {BROWN_REPO}")
    print("Clone it: cd scrutinizer-repo && git clone https://github.com/ProgramofComputerGraphics/PooledStatisticsMetamers.git")
    sys.exit(1)

sys.path.insert(0, BROWN_REPO)

from metamerconfig import MetamerConfig, generate_image_schedule
from poolingregions import NormalizedPoint
from image_utils import load_image_rgb, save_image

import torch


def parse_args():
    parser = argparse.ArgumentParser(description='Generate Brown et al. ground truth metamers')
    parser.add_argument('--input', type=str, help='Input PNG path')
    parser.add_argument('--gaze', type=str, default='0.5,0.5', help='Gaze point as x,y (normalized 0-1)')
    parser.add_argument('--output', type=str, help='Output PNG path')
    parser.add_argument('--iterations', type=int, default=300, help='Solver iterations (default: 300)')
    parser.add_argument('--scaling', type=float, default=0.75, help='Eccentricity scaling (default: 0.75, Bouma)')
    parser.add_argument('--pooling-size', type=int, default=96, help='Pooling region size (default: 96)')
    parser.add_argument('--scale', type=float, default=1.0,
                        help='Resize factor before synthesis (0.5 = half-res for fast iteration)')
    parser.add_argument('--batch', action='store_true',
                        help='Process all images from tests/golden-captures/raw/manifest.json')
    parser.add_argument('--output-dir', type=str,
                        default=os.path.join(PROJECT_ROOT, 'tests', 'golden-captures', 'brown-metamers'),
                        help='Output directory for batch mode')
    return parser.parse_args()


def resize_image_tensor(img_tensor, scale):
    """Resize image tensor by the given scale factor using bilinear interpolation.
    Handles both [C, H, W] and [1, C, H, W] shapes (Brown's load_image_rgb returns the latter)."""
    if scale == 1.0:
        return img_tensor
    import torch.nn.functional as F
    # F.interpolate expects [N, C, H, W]
    needs_batch = img_tensor.dim() == 3
    if needs_batch:
        img_tensor = img_tensor.unsqueeze(0)
    resized = F.interpolate(
        img_tensor,
        scale_factor=scale,
        mode='bilinear',
        align_corners=False
    )
    if needs_batch:
        resized = resized.squeeze(0)
    return resized


def generate_single_metamer(input_path, output_path, gaze_xy, iterations, scaling, pooling_size, img_scale):
    """Run Brown et al. pipeline on a single image."""
    print(f"\n{'='*60}")
    print(f"Input:      {input_path}")
    print(f"Output:     {output_path}")
    print(f"Gaze:       ({gaze_xy[0]}, {gaze_xy[1]})")
    print(f"Iterations: {iterations}")
    print(f"Scaling:    {scaling}")
    print(f"Pooling:    {pooling_size}")
    print(f"Img scale:  {img_scale}")
    print(f"Device:     {'MPS' if torch.backends.mps.is_available() else 'CPU'}")
    print(f"{'='*60}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Set output directory for Brown's pipeline (it saves convergence graphs etc.)
    output_dir = os.path.dirname(output_path)
    MetamerConfig.set_default_output_dir(output_dir)

    # Load image
    target_image = load_image_rgb(input_path)
    if img_scale != 1.0:
        original_shape = target_image.shape
        target_image = resize_image_tensor(target_image, img_scale)
        print(f"  Resized: {list(original_shape)} -> {list(target_image.shape)}")

    gaze_point = NormalizedPoint(gaze_xy[0], gaze_xy[1])

    # Configure metamer generation matching D3 spec parameters:
    # - Freeman & Simoncelli gaze-centric pooling with wrap_x boundaries
    # - Steerable pyramid with extra levels for warp headroom
    # - Eccentricity scaling = 0.75 (Bouma's law, Brown et al. default)
    pooling_str = f'{pooling_size}:Kern=Trig:mesa=1/3:stride=2/3:Bound=wrap_x'
    pyramid_str = 'UBbbbbbL_8_:Ori=4:Bound=wrap_x'
    warp_str = f'warp={scaling}:anisotropy=2'

    output_filename = os.path.basename(output_path)

    config = MetamerConfig(
        '_brown',
        pooling=pooling_str,
        pyramid=pyramid_str,
        warping=warp_str,
        stats='fs_all',
        solver_modes={
            'print_num_statistics': True,
            'print_image_comparison': False,
            'print_convergence_graph': False,
            'save_convergence_graph': True,
            'use_gpu_if_available': True
        }
    )

    start = time.time()
    result = config.generate_image_metamer(
        target_image,
        max_iters=iterations,
        outfile=output_filename,
        outdir=output_dir,
        gaze_point=gaze_point
    )
    elapsed = time.time() - start

    print(f"\n  Completed in {elapsed:.1f}s")
    print(f"  Output: {output_path}")
    return result


def run_batch(args):
    """Process all images from raw manifest."""
    manifest_path = os.path.join(PROJECT_ROOT, 'tests', 'golden-captures', 'raw', 'manifest.json')
    if not os.path.exists(manifest_path):
        print(f"ERROR: Manifest not found at {manifest_path}")
        print("Run 'npm run capture-raw' first to generate raw screenshots.")
        sys.exit(1)

    with open(manifest_path) as f:
        manifest = json.load(f)

    raw_dir = os.path.dirname(manifest_path)
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    results = []
    for entry in manifest:
        input_path = os.path.join(raw_dir, entry['file'])
        if not os.path.exists(input_path):
            print(f"SKIP: {input_path} not found")
            continue

        output_filename = entry['file'].replace('_raw.png', '_brown.png')
        output_path = os.path.join(output_dir, output_filename)

        try:
            generate_single_metamer(
                input_path=input_path,
                output_path=output_path,
                gaze_xy=entry['gaze'],
                iterations=args.iterations,
                scaling=args.scaling,
                pooling_size=args.pooling_size,
                img_scale=args.scale
            )
            results.append({
                'page': entry['page'],
                'fixation': entry['fixation'],
                'gaze': entry['gaze'],
                'input': entry['file'],
                'output': output_filename,
                'status': 'ok'
            })
        except Exception as e:
            print(f"ERROR processing {entry['file']}: {e}")
            results.append({
                'page': entry['page'],
                'input': entry['file'],
                'status': 'error',
                'error': str(e)
            })

    # Write batch results
    results_path = os.path.join(output_dir, 'batch-results.json')
    with open(results_path, 'w') as f:
        json.dump({
            'parameters': {
                'scaling': args.scaling,
                'pooling_size': args.pooling_size,
                'iterations': args.iterations,
                'img_scale': args.scale
            },
            'results': results
        }, f, indent=2)
    print(f"\nBatch results: {results_path}")


def main():
    args = parse_args()

    if args.batch:
        run_batch(args)
    elif args.input and args.output:
        gaze_xy = [float(v) for v in args.gaze.split(',')]
        generate_single_metamer(
            input_path=args.input,
            output_path=args.output,
            gaze_xy=gaze_xy,
            iterations=args.iterations,
            scaling=args.scaling,
            pooling_size=args.pooling_size,
            img_scale=args.scale
        )
    else:
        print("ERROR: Provide --input and --output for single image, or --batch for batch mode.")
        sys.exit(1)


if __name__ == '__main__':
    main()
