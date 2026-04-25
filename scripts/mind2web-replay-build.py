#!/usr/bin/env python3
"""
Mind2Web replay manifest builder (variants edition).

Scans data/mind2web-replay/ — one dir per (annotation_id, action_idx),
each containing index.json + a grid of m{MODE}-r{RADIUS}.png renders —
and assembles tmp/replay/manifest.json for the study tool UI.

Run:
  python3 scripts/mind2web-replay-build.py
  python3 -m http.server 8000   # from repo root
  open http://localhost:8000/tmp/replay/
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
REPLAY_SRC = REPO_ROOT / "data/mind2web-replay"
REPLAY_DST = REPO_ROOT / "tmp/replay"
TEMPLATE_HTML = REPO_ROOT / "scripts/mind2web-replay-template.html"

# Mode-id → (short name, descriptor) for the UI dropdown.
MODE_INFO = {
    0:  ("High-Key",       "default — peripheral bandwidth filtering, rod-like desat"),
    1:  ("Biological",     "Purkinje shift, luminance-driven, V1 rod simulation"),
    4:  ("Minecraft",      "blocks sized to CMF MIP at each eccentricity"),
    6:  ("Log-Polar MIP",  "explicit cortical magnification (Blauch et al. 2026)"),
    14: ("Pyramid Mongrel","Laplacian pyramid metamer (silently → High-Key)"),
    15: ("Tier3 Synthesis","summary-statistic pooling, eccentricity-scaled sectors"),
    16: ("Text Baseline",  "frozen clone of High-Key for Arm-0 reference"),
    20: ("DOM-Aware Text", "DOM-conditioned compositor (silently → Tier3)"),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    args = ap.parse_args()

    if not REPLAY_SRC.exists():
        raise SystemExit(f"no source: {REPLAY_SRC}")

    REPLAY_DST.mkdir(parents=True, exist_ok=True)

    trials = []
    all_modes: set[int] = set()
    all_radii: set[int] = set()
    for action_dir in sorted(REPLAY_SRC.glob("*/*")):
        if not action_dir.is_dir():
            continue
        idx_path = action_dir / "index.json"
        if not idx_path.exists():
            continue
        idx = json.loads(idx_path.read_text())
        modes = idx.get("modes", [])
        radii = idx.get("radii", [])
        all_modes.update(modes); all_radii.update(radii)
        # Image base path served by http.server at repo root.
        base_url = f"/data/mind2web-replay/{idx['annotation_id']}/{idx['action_idx']}/"
        trials.append({
            "annotation_id":   idx["annotation_id"],
            "action_idx":      idx["action_idx"],
            "website":         idx["website"],
            "action_repr":     idx.get("action_repr"),
            "viewport":        idx["viewport"],
            "fovea_screen":    idx["fovea_screen"],
            "fixation_frac":   idx.get("fixation_frac"),
            "target_primitive": idx.get("target_primitive"),
            "target_tag":      idx.get("target_tag"),
            "target_bbox":     idx["target_bbox"],
            "prior_target_bbox": idx.get("prior_target_bbox"),
            "same_type_distractors": idx.get("same_type_distractors", []),
            "modes":           modes,
            "radii":           radii,
            "base_url":        base_url,
        })

    modes_sorted = sorted(all_modes)
    radii_sorted = sorted(all_radii)
    manifest = {
        "modes": [{"id": m,
                    "label": MODE_INFO.get(m, (f"mode {m}", ""))[0],
                    "desc":  MODE_INFO.get(m, (f"mode {m}", ""))[1]}
                   for m in modes_sorted],
        "radii": [{"px": r, "deg": round(r / 29.0, 2)} for r in radii_sorted],
        "n_trials": len(trials),
        "trials": sorted(trials, key=lambda t: (t["website"], t["action_idx"])),
    }
    (REPLAY_DST / "manifest.json").write_text(json.dumps(manifest) + "\n")
    # Always copy the latest HTML template alongside the manifest so the
    # served page never goes stale if the template evolves.
    if TEMPLATE_HTML.exists():
        (REPLAY_DST / "index.html").write_text(TEMPLATE_HTML.read_text())
    print(f"  trials: {len(trials)}")
    print(f"  modes:  {[m['label'] for m in manifest['modes']]}")
    radii_labels = [f"{r['px']}px (~{r['deg']}°)" for r in manifest['radii']]
    print(f"  radii:  {radii_labels}")
    print(f"  →       {REPLAY_DST / 'manifest.json'}")
    print(f"\n  python3 -m http.server 8000   # from {REPO_ROOT}")
    print(f"  open http://localhost:8000/tmp/replay/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
