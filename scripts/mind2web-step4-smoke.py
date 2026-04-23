#!/usr/bin/env python3
"""
Mind2Web Step 4 — 5-task end-to-end smoke (v3 / MHTML pixel source).

Walks N dev-split tasks that have BOTH (a) per-action metadata in a local
Multimodal-Mind2Web parquet AND (b) an `_before.mhtml` already pulled from
Globus into data/mind2web-mhtml/. For each task picks the first action that
satisfies v3 constraints (target ∈ {button, link, form_input}, prior+target
in first viewport, 4-50 visible same-type distractors), then runs the
canonical v3 renderer against the matching MHTML.

Output:
  tmp/step4-smoke/
    selection.json                      # which tasks/actions were picked
    {annotation_id}/{action_idx}-action.json  # the action metadata blob
    contact-sheet.png                   # 5-up grid of rendered frames
  data/mind2web-cache-<hash>/{annotation_id}/{action_idx}-v3.{png,json}

The contact sheet is the visual-inspection gate Andy's diagnosis lesson
demands BEFORE any aggregate metric is trusted.

Usage:
  uv run --python 3.12 --with pyarrow --with pillow \\
    python3 scripts/mind2web-step4-smoke.py \\
      --parquet data/mind2web-multimodal/train-00000.parquet \\
      --n-tasks 5
"""

from __future__ import annotations
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pyarrow.parquet as pq
from PIL import Image, ImageDraw, ImageFont

# Reuse extraction logic so the v3 constraint definition stays single-source.
sys.path.insert(0, str(Path(__file__).parent))
from mind2web_extract_multimodal import (  # noqa: E402  -- module path import
    extract_action,
    meets_v3_constraints,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SPLIT_PATH = REPO_ROOT / "data/mind2web-split.json"
SUMMARIES_PATH = REPO_ROOT / "data/mind2web-summaries.json"
MHTML_ROOT = REPO_ROOT / "data/mind2web-mhtml"
SMOKE_OUT = REPO_ROOT / "tmp/step4-smoke"


def load_dev_aids() -> set[str]:
    split = json.loads(SPLIT_PATH.read_text())
    dev_sites = set(split["dev_websites"])
    sums = json.loads(SUMMARIES_PATH.read_text())["summaries"]
    return {s["annotation_id"] for s in sums if s["website"] in dev_sites}


def find_mhtml(annotation_id: str, action_uid: str) -> Path | None:
    p = MHTML_ROOT / annotation_id / f"{action_uid}_before.mhtml"
    return p if p.exists() else None


def collect_candidates(parquet_paths: list[Path], dev_aids: set[str]):
    """Walk all parquets, return list of (rec, mhtml_path) for every valid
    distinct annotation_id that has a local MHTML. Used downstream to diversify
    by website before N-picking."""
    picks = []
    seen_aids: set[str] = set()
    for parquet_path in parquet_paths:
        table = pq.ParquetFile(parquet_path).read()
        for i in range(len(table)):
            aid = table["annotation_id"][i].as_py()
            if aid not in dev_aids or aid in seen_aids:
                continue
            try:
                rec = extract_action(table, i)
            except ValueError:
                continue
            if not meets_v3_constraints(rec):
                continue
            mhtml = find_mhtml(aid, rec["action_uid"])
            if mhtml is None:
                continue
            picks.append((rec, mhtml))
            seen_aids.add(aid)
    return picks


def pick_website_diverse(candidates, n: int):
    """Round-robin across websites to avoid over-sampling one site."""
    by_site: dict[str, list] = {}
    for rec, mhtml in candidates:
        by_site.setdefault(rec["website"], []).append((rec, mhtml))
    picks = []
    site_iters = {s: iter(items) for s, items in by_site.items()}
    sites_order = sorted(by_site.keys())
    while len(picks) < n and site_iters:
        made_progress = False
        for s in list(sites_order):
            if s not in site_iters:
                continue
            try:
                picks.append(next(site_iters[s]))
                made_progress = True
                if len(picks) >= n:
                    return picks
            except StopIteration:
                del site_iters[s]
        if not made_progress:
            break
    return picks


def write_action_json(rec: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{rec['action_idx']}-action.json"
    p.write_text(json.dumps(rec, indent=2) + "\n")
    return p


def run_render(action_json: Path, mhtml: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "node",
            str(REPO_ROOT / "scripts/mind2web-render-mhtml.js"),
            "--action", str(action_json),
            "--mhtml", str(mhtml),
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def cache_dir_for(rec: dict, hash_prefix: str) -> Path:
    return REPO_ROOT / f"data/mind2web-cache-{hash_prefix}" / rec["annotation_id"]


def build_contact_sheet(rendered: list[dict], out_path: Path) -> None:
    """5-up grid (1 row × N cols) so Andy can eyeball CSS fidelity in one glance."""
    if not rendered:
        return
    thumbs = []
    label_h = 44
    for r in rendered:
        img = Image.open(r["png"]).convert("RGB")
        # Half-scale to keep the sheet manageable; original is 1280×768.
        w, h = img.size
        thumb = img.resize((w // 2, h // 2), Image.LANCZOS)
        thumb_w, thumb_h = thumb.size
        canvas = Image.new("RGB", (thumb_w, thumb_h + label_h), (16, 16, 16))
        canvas.paste(thumb, (0, label_h))
        draw = ImageDraw.Draw(canvas)
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 14)
        except OSError:
            font = ImageFont.load_default()
        label = (
            f"{r['website']} / {r['action_idx']}  "
            f"{r['target_primitive']}  n_distractors={r['n_distractors']}"
        )
        draw.text((8, 12), label, fill=(255, 255, 255), font=font)
        thumbs.append(canvas)
    cell_w, cell_h = thumbs[0].size
    sheet = Image.new("RGB", (cell_w * len(thumbs), cell_h), (0, 0, 0))
    for i, t in enumerate(thumbs):
        sheet.paste(t, (i * cell_w, 0))
    sheet.save(out_path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", action="append", type=Path,
                    help="Multimodal parquet(s); may repeat. Default: all "
                         "train-*.parquet under data/mind2web-multimodal/.")
    ap.add_argument("--n-tasks", type=int, default=5)
    args = ap.parse_args()

    parquets = args.parquet or sorted(
        (REPO_ROOT / "data/mind2web-multimodal").glob("train-*.parquet"))
    if not parquets:
        print("ERROR: no parquets found.", file=sys.stderr)
        return 1

    if SMOKE_OUT.exists():
        shutil.rmtree(SMOKE_OUT)
    SMOKE_OUT.mkdir(parents=True)

    dev_aids = load_dev_aids()
    print(f"dev annotation_ids in split: {len(dev_aids)}")
    print(f"parquets: {len(parquets)}")

    candidates = collect_candidates(parquets, dev_aids)
    print(f"eligible dev-split candidates (v3 pass + MHTML on disk): {len(candidates)}")
    websites = sorted({rec['website'] for rec, _ in candidates})
    print(f"websites available: {len(websites)} — {websites}")
    picks = pick_website_diverse(candidates, args.n_tasks)
    print(f"picked {len(picks)} tasks (of {args.n_tasks} requested, "
          f"website-diverse)")
    if not picks:
        print("ERROR: no dev-split actions in this parquet have a local MHTML.",
              file=sys.stderr)
        return 1

    selection = []
    rendered = []
    for rec, mhtml in picks:
        action_dir = SMOKE_OUT / rec["annotation_id"]
        action_json = write_action_json(rec, action_dir)
        print(f"\n→ {rec['website']} / {rec['annotation_id'][:8]}  "
              f"action={rec['action_idx']}  target={rec['target']['primitive']}")
        result = run_render(action_json, mhtml)
        if result.returncode != 0:
            print(f"  RENDER FAILED rc={result.returncode}")
            print(result.stderr[-800:], file=sys.stderr)
            selection.append({
                "annotation_id": rec["annotation_id"],
                "action_idx": rec["action_idx"],
                "rendered": False,
                "stderr_tail": result.stderr[-400:],
            })
            continue
        # The render writes into data/mind2web-cache-<hash>/<aid>/<idx>-v3.{png,json}.
        # Find the hash via the JSON output — it's emitted on stdout.
        # Fallback: scan cache dirs.
        cache_glob = list((REPO_ROOT / "data").glob(
            f"mind2web-cache-*/{rec['annotation_id']}/{rec['action_idx']}-v3.png"))
        if not cache_glob:
            print("  RENDER produced no cache PNG")
            continue
        png_path = cache_glob[0]
        json_path = png_path.with_suffix(".json")
        n_distractors = sum(
            1 for d in rec["same_type_distractors"]
            if 0 <= d["bbox"]["x"] <= 1280 and 0 <= d["bbox"]["y"] <= 768
        )
        rendered.append({
            "png": png_path,
            "json": json_path,
            "website": rec["website"],
            "action_idx": rec["action_idx"],
            "target_primitive": rec["target"]["primitive"],
            "n_distractors": n_distractors,
        })
        selection.append({
            "annotation_id": rec["annotation_id"],
            "action_idx": rec["action_idx"],
            "website": rec["website"],
            "domain": rec["domain"],
            "target_primitive": rec["target"]["primitive"],
            "n_same_type_distractors_visible": n_distractors,
            "rendered": True,
            "png": str(png_path.relative_to(REPO_ROOT)),
            "json": str(json_path.relative_to(REPO_ROOT)),
        })

    (SMOKE_OUT / "selection.json").write_text(json.dumps(selection, indent=2) + "\n")
    sheet_path = SMOKE_OUT / "contact-sheet.png"
    build_contact_sheet(rendered, sheet_path)
    print(f"\n━━━ Step 4 smoke complete ━━━")
    print(f"  rendered: {len(rendered)}/{len(picks)}")
    print(f"  selection:     {SMOKE_OUT / 'selection.json'}")
    print(f"  contact sheet: {sheet_path}")
    print(f"\n  EYEBALL THE CONTACT SHEET BEFORE TRUSTING ANY AGGREGATE METRIC.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
