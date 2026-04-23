#!/usr/bin/env python3
"""
Mind2Web Step 5 — dev-run aggregation (Arm-0 distinctiveness vs distance-only).

Reads every per-action JSON in data/mind2web-cache-<hash>/, computes per-trial
ROC AUC for two scoring rules:

    arm0_score(c)     = ||vector_center(c) - vector_surround(c)||_2
    distance_score(c) = -eccentricity_px(c)            # closer = higher

then forms the per-trial delta (AUC_arm0 - AUC_distance), and aggregates by
the cell defined in arm-0-config.json:

    primitive ∈ {button, link, form_input}  ×  eccentricity_bin ∈ {0–5°, 5–20°, 20–30°}

For each cell, reports mean per-trial delta and paired-bootstrap CI at the
Bonferroni-adjusted level (1 − α/n_primary).

The bin is assigned by the *target's* eccentricity_deg.

Usage:
  uv run --python 3.12 --with numpy --with scikit-learn python3 \\
    scripts/mind2web-step5-aggregate.py
"""

from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = REPO_ROOT / "tests/validation/mind2web/arm-0-config.json"


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text())


def find_cache_dir(hash_prefix: str) -> Path:
    p = REPO_ROOT / f"data/mind2web-cache-{hash_prefix}"
    if not p.exists():
        raise SystemExit(f"cache dir not found: {p}")
    return p


def per_trial_auc(scores: np.ndarray, labels: np.ndarray) -> float | None:
    """ROC AUC where labels=1 is target, labels=0 is distractor. Requires
    exactly one positive and at least one negative; returns None otherwise."""
    pos = labels.sum()
    if pos != 1 or len(labels) - pos < 1:
        return None
    return float(roc_auc_score(labels, scores))


def assign_bin(ecc_deg: float, bins: list[dict]) -> str | None:
    for b in bins:
        if b["low"] <= ecc_deg < b["high"]:
            return b["name"]
    return None


def trials_from_cache(cache_dir: Path, cap_deg: float, bins: list[dict]) -> list[dict]:
    """One trial per per-action JSON file. Trial drops out if target's
    eccentricity exceeds the cap or if its bin is undefined."""
    trials = []
    for jpath in sorted(cache_dir.glob("*/*-v3.json")):
        d = json.loads(jpath.read_text())
        cands = [c for c in d.get("candidates", []) if c.get("visible")]
        if not cands:
            continue
        target = next((c for c in cands if c.get("is_target")), None)
        if target is None:
            continue
        if target["eccentricity_deg"] > cap_deg:
            continue
        bin_name = assign_bin(target["eccentricity_deg"], bins)
        if bin_name is None:
            continue
        scores_arm0, scores_dist, labels, ecc = [], [], [], []
        for c in cands:
            vc = np.array(c["vector_center"], dtype=float)
            vs = np.array(c["vector_surround"], dtype=float)
            scores_arm0.append(float(np.linalg.norm(vc - vs)))
            scores_dist.append(-float(c["eccentricity_px"]))
            labels.append(1 if c.get("is_target") else 0)
            ecc.append(c["eccentricity_deg"])
        scores_arm0 = np.array(scores_arm0)
        scores_dist = np.array(scores_dist)
        labels = np.array(labels)
        auc_arm0 = per_trial_auc(scores_arm0, labels)
        auc_dist = per_trial_auc(scores_dist, labels)
        if auc_arm0 is None or auc_dist is None:
            continue
        trials.append({
            "annotation_id": d["annotation_id"],
            "action_idx": d["action_idx"],
            "website": d["website"],
            "primitive": target["primitive"],
            "target_ecc_deg": target["eccentricity_deg"],
            "bin": bin_name,
            "n_distractors": int(len(labels) - 1),
            "auc_arm0": auc_arm0,
            "auc_dist": auc_dist,
            "delta": auc_arm0 - auc_dist,
        })
    return trials


def paired_bootstrap_mean(deltas: np.ndarray, n_resamples: int,
                          ci_level: float, rng: np.random.Generator):
    if len(deltas) == 0:
        return None, None, None
    n = len(deltas)
    means = np.empty(n_resamples)
    for i in range(n_resamples):
        idx = rng.integers(0, n, size=n)
        means[i] = deltas[idx].mean()
    alpha = 1 - ci_level
    lo = float(np.quantile(means, alpha / 2))
    hi = float(np.quantile(means, 1 - alpha / 2))
    return float(deltas.mean()), lo, hi


def aggregate(trials: list[dict], cfg: dict) -> dict:
    primaries = cfg["primary_primitives"]
    bins = cfg["eccentricity_bins_deg"]
    n_resamples = int(cfg["bootstrap"]["n_resamples"])
    ci_level = float(cfg["bootstrap"]["bonferroni_adjusted_ci_level"])
    rng = np.random.default_rng(int(cfg["split"]["seed"]))
    results = []
    for prim in primaries:
        for b in bins:
            cell_trials = [t for t in trials
                           if t["primitive"] == prim and t["bin"] == b["name"]]
            deltas = np.array([t["delta"] for t in cell_trials])
            mean, lo, hi = paired_bootstrap_mean(deltas, n_resamples, ci_level, rng)
            sig = "—"
            if mean is not None:
                sig = "*" if (lo > 0 or hi < 0) else " "
            # n < 5 makes any bootstrap CI either degenerate (n=1) or
            # essentially uninformative (n=2..4). Suppress significance flag
            # in those cells; mean is still reported as descriptive.
            sig_flag = sig.strip() == "*" and len(cell_trials) >= 5
            results.append({
                "primitive": prim,
                "bin": b["name"],
                "ecc_low": b["low"],
                "ecc_high": b["high"],
                "n_trials": len(cell_trials),
                "mean_delta": mean,
                "ci_low": lo,
                "ci_high": hi,
                "significant_at_bonferroni": sig_flag,
                "underpowered": len(cell_trials) < 5,
            })
    return {"cells": results, "ci_level": ci_level, "n_resamples": n_resamples,
            "bootstrap_seed": int(cfg["split"]["seed"])}


def print_table(agg: dict, total_trials: int) -> None:
    print()
    print(f"━━━ Step 5 dev-run aggregate (Arm-0 vs distance-only, ΔAUC) ━━━")
    print(f"  total trials:   {total_trials}")
    print(f"  bootstrap:      {agg['n_resamples']} resamples, {agg['ci_level']*100:.2f}% CI (Bonferroni-adjusted)")
    print()
    hdr = f"{'primitive':<11} {'bin':<19} {'n':>4} {'mean Δ':>8} {'CI low':>8} {'CI high':>8} {'sig':>4}"
    print(hdr)
    print("-" * len(hdr))
    for c in agg["cells"]:
        bin_label = f"{c['bin']} [{c['ecc_low']}-{c['ecc_high']}°]"
        if c["mean_delta"] is None:
            print(f"{c['primitive']:<11} {bin_label:<19} {c['n_trials']:>4} "
                  f"{'—':>8} {'—':>8} {'—':>8} {'—':>4}")
            continue
        if c["underpowered"]:
            sig = "~"  # descriptive-only; n < 5
        else:
            sig = "*" if c["significant_at_bonferroni"] else " "
        print(f"{c['primitive']:<11} {bin_label:<19} {c['n_trials']:>4} "
              f"{c['mean_delta']:>+8.3f} {c['ci_low']:>+8.3f} {c['ci_high']:>+8.3f} "
              f"{sig:>4}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path,
                    default=REPO_ROOT / "tmp/step5-dev-aggregate.json")
    ap.add_argument("--trials-out", type=Path,
                    default=REPO_ROOT / "tmp/step5-dev-trials.json")
    args = ap.parse_args()

    cfg = load_config()
    # The JS hasher (scripts/mind2web-config-hash.js) is canonical. Don't
    # re-implement; just shell out so we can't drift.
    import subprocess
    proc = subprocess.run(
        ["node", "-e",
         "const h=require('./scripts/mind2web-config-hash.js');"
         "const cfg=h.loadConfig('tests/validation/mind2web/arm-0-config.json');"
         "process.stdout.write(h.hashPrefix(cfg));"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    )
    hash_prefix = proc.stdout.strip()
    cache_dir = find_cache_dir(hash_prefix)

    trials = trials_from_cache(cache_dir, cfg["eccentricity_cap_deg"],
                               cfg["eccentricity_bins_deg"])
    print(f"loaded {len(trials)} trials from {cache_dir.relative_to(REPO_ROOT)}")
    if not trials:
        print("ERROR: no usable trials.", file=sys.stderr)
        return 1

    agg = aggregate(trials, cfg)
    print_table(agg, len(trials))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "config_hash_prefix": hash_prefix,
        "n_trials": len(trials),
        **agg,
    }, indent=2) + "\n")
    args.trials_out.write_text(json.dumps(trials, indent=2) + "\n")
    print(f"\n  aggregate: {args.out}")
    print(f"  trials:    {args.trials_out}")
    print()
    print("  Reminder: this is the DEV run. Treat anything significant as a")
    print("  hypothesis to be locked in eval, not a published result.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
