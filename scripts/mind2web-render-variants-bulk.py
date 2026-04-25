#!/usr/bin/env python3
"""
Bulk variant-grid renderer for the replay study tool.

Picks N website-diverse dev trials (same logic as Step 4 smoke), then for
each one shells out to mind2web-render-variants.js to render through the
mode × radius grid. Output goes under data/mind2web-replay/.
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path

import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent))
from mind2web_extract_multimodal import (  # noqa: E402
    extract_action,
    meets_v3_constraints,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SPLIT_PATH = REPO_ROOT / "data/mind2web-split.json"
SUMMARIES_PATH = REPO_ROOT / "data/mind2web-summaries.json"
MHTML_ROOT = REPO_ROOT / "data/mind2web-mhtml"
REPLAY_ROOT = REPO_ROOT / "data/mind2web-replay"


def load_dev_aids() -> set[str]:
    split = json.loads(SPLIT_PATH.read_text())
    dev_sites = set(split["dev_websites"])
    sums = json.loads(SUMMARIES_PATH.read_text())["summaries"]
    return {s["annotation_id"] for s in sums if s["website"] in dev_sites}


def find_mhtml(annotation_id: str, action_uid: str) -> Path | None:
    p = MHTML_ROOT / annotation_id / f"{action_uid}_before.mhtml"
    return p if p.exists() else None


def collect_candidates(parquet_paths: list[Path], dev_aids: set[str]):
    picks = []
    seen = set()
    for parquet_path in parquet_paths:
        table = pq.ParquetFile(parquet_path).read()
        for i in range(len(table)):
            aid = table["annotation_id"][i].as_py()
            if aid not in dev_aids or aid in seen:
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
            seen.add(aid)
    return picks


def diversify(candidates, n: int):
    by_site = {}
    for rec, mhtml in candidates:
        by_site.setdefault(rec["website"], []).append((rec, mhtml))
    iters = {s: iter(items) for s, items in by_site.items()}
    sites = sorted(by_site.keys())
    picks = []
    while len(picks) < n and iters:
        for s in list(sites):
            if s not in iters:
                continue
            try:
                picks.append(next(iters[s]))
                if len(picks) >= n:
                    return picks
            except StopIteration:
                del iters[s]
    return picks


def run_variants(rec: dict, mhtml: Path, modes: str, radii: str) -> bool:
    action_dir = REPO_ROOT / "tmp/variants-actions"
    action_dir.mkdir(parents=True, exist_ok=True)
    action_path = action_dir / f"{rec['annotation_id']}-{rec['action_idx']}.json"
    action_path.write_text(json.dumps(rec, indent=2) + "\n")
    proc = subprocess.run(
        ["node", str(REPO_ROOT / "scripts/mind2web-render-variants.js"),
         "--action", str(action_path),
         "--mhtml", str(mhtml),
         "--modes", modes,
         "--radii", radii],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if proc.returncode != 0:
        print(f"  FAILED rc={proc.returncode}")
        print(proc.stderr[-400:], file=sys.stderr)
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-trials", type=int, default=24)
    ap.add_argument("--modes", default="0,4,6,15",
                    help="Mode IDs comma-separated. Default = High-Key,Minecraft,"
                         "Log-Polar MIP,Tier3 Synthesis")
    ap.add_argument("--radii", default="60,90,120",
                    help="Foveal radii in pixels.")
    args = ap.parse_args()

    dev_aids = load_dev_aids()
    parquets = sorted((REPO_ROOT / "data/mind2web-multimodal").glob("train-*.parquet"))
    print(f"parquets: {len(parquets)}  dev aids: {len(dev_aids)}")

    candidates = collect_candidates(parquets, dev_aids)
    print(f"eligible candidates: {len(candidates)}")
    picks = diversify(candidates, args.n_trials)
    sites = sorted({rec['website'] for rec, _ in picks})
    print(f"picked {len(picks)} trials across {len(sites)} sites: {sites}")
    print(f"variants per trial: {len(args.modes.split(','))} modes × "
          f"{len(args.radii.split(','))} radii = "
          f"{len(args.modes.split(',')) * len(args.radii.split(','))}")
    print()

    REPLAY_ROOT.mkdir(parents=True, exist_ok=True)
    okay = 0
    for i, (rec, mhtml) in enumerate(picks, 1):
        print(f"[{i}/{len(picks)}] {rec['website']}/{rec['annotation_id'][:8]}/{rec['action_idx']}")
        if run_variants(rec, mhtml, args.modes, args.radii):
            okay += 1

    # Write top-level index for the replay-build step.
    (REPLAY_ROOT / "trials.json").write_text(json.dumps({
        "modes": [int(m) for m in args.modes.split(",")],
        "radii": [int(r) for r in args.radii.split(",")],
        "trials": [{"annotation_id": rec["annotation_id"],
                    "action_idx": rec["action_idx"],
                    "website": rec["website"]}
                   for rec, _ in picks[:okay]],
    }, indent=2) + "\n")
    print(f"\n  {okay}/{len(picks)} trials rendered  →  {REPLAY_ROOT}/")
    return 0 if okay == len(picks) else 1


if __name__ == "__main__":
    sys.exit(main())
