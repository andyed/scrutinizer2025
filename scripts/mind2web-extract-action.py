#!/usr/bin/env python3
"""
Mind2Web single-action extractor.

Pulls one (task, action_idx) out of the 13GB corpus and writes a compact JSON
with the raw_html, prior-action target bbox (the gaze anchor), the target
candidate, and the same-type distractors — everything the render driver needs
to produce a pooled-stat cache entry.

Designed so the render driver never touches the 13GB corpus itself.

Usage:
    python3 scripts/mind2web-extract-action.py \\
        --task-id <annotation_id> \\
        --action-idx <n>  \\
        --out tmp/action.json \\
        [--corpus ~/Documents/dev/Mind2Web/data/data/train]

Alternative: pick the first action meeting Step 3 v0 constraints (action_idx>=1,
prior-action target in viewport, same-type distractors present):

    python3 scripts/mind2web-extract-action.py --pick-first-valid --out tmp/action.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# Same primitive taxonomy as scripts/mind2web-split.js and
# scripts/mind2web-summarize.py. Must match.
PRIMITIVE_MAP = {
    "button": "button",
    "a": "link", "link": "link",
    "textbox": "form_input", "combobox": "form_input", "checkbox": "form_input",
    "searchbox": "form_input", "input": "form_input", "select": "form_input",
    "option": "form_input", "radio": "form_input",
    "img": "icon_image", "svg": "icon_image", "path": "icon_image", "icon": "icon_image",
    "tab": "nav_item", "menuitem": "nav_item", "nav": "nav_item",
    "heading": "heading",
    "h1": "heading", "h2": "heading", "h3": "heading",
    "h4": "heading", "h5": "heading", "h6": "heading",
}

VIEWPORT_W = 1280
VIEWPORT_H = 768


def map_tag_to_primitive(tag: str) -> str:
    return PRIMITIVE_MAP.get(tag, "other")


def parse_bbox(rect_str: str):
    if not rect_str:
        return None
    parts = rect_str.split(",")
    if len(parts) != 4:
        return None
    try:
        x, y, w, h = [float(p) for p in parts]
    except ValueError:
        return None
    if w <= 0 or h <= 0:
        return None
    return {"x": x, "y": y, "w": w, "h": h}


def candidate_to_record(cand: dict):
    """Flatten a pos/neg_candidate dict into the cache-friendly shape."""
    attrs_str = cand.get("attributes", "{}")
    try:
        attrs = json.loads(attrs_str)
    except json.JSONDecodeError:
        return None
    bbox = parse_bbox(attrs.get("bounding_box_rect", ""))
    if bbox is None:
        return None
    tag = cand.get("tag", "")
    return {
        "backend_node_id": cand.get("backend_node_id", ""),
        "tag": tag,
        "primitive": map_tag_to_primitive(tag),
        "bbox": bbox,
        "is_original_target": bool(cand.get("is_original_target", False)),
    }


def pick_target(action: dict):
    """Pick the is_original_target candidate if present, else pos_candidates[0]."""
    pos = action.get("pos_candidates") or []
    for c in pos:
        if c.get("is_original_target"):
            rec = candidate_to_record(c)
            if rec:
                return rec
    for c in pos:
        rec = candidate_to_record(c)
        if rec:
            return rec
    return None


def extract_action(task: dict, action_idx: int):
    actions = task.get("actions") or []
    if action_idx < 0 or action_idx >= len(actions):
        raise ValueError(f"action_idx {action_idx} out of range [0, {len(actions)})")
    action = actions[action_idx]

    target = pick_target(action)
    if target is None:
        raise ValueError(f"no valid target in action {action_idx}")

    prior_target = None
    if action_idx > 0:
        prior_target = pick_target(actions[action_idx - 1])

    same_type_distractors = []
    if target is not None:
        target_primitive = target["primitive"]
        for c in action.get("neg_candidates") or []:
            rec = candidate_to_record(c)
            if rec is None:
                continue
            if rec["primitive"] == target_primitive:
                same_type_distractors.append(rec)

    return {
        "task_id": task.get("annotation_id", ""),
        "website": task.get("website", ""),
        "domain": task.get("domain", ""),
        "action_idx": action_idx,
        "n_actions_in_task": len(actions),
        "operation": action.get("operation", {}),
        "action_repr": (task.get("action_reprs") or [""] * len(actions))[action_idx],
        "raw_html": action.get("raw_html", ""),
        "prior_target_bbox": prior_target["bbox"] if prior_target else None,
        "target": target,
        "same_type_distractors": same_type_distractors,
    }


def iter_corpus(corpus_dir: Path):
    files = sorted(f for f in os.listdir(corpus_dir) if re.match(r"^train_\d+\.json$", f))
    for fname in files:
        with open(corpus_dir / fname) as fh:
            for task in json.load(fh):
                yield task


def bbox_in_first_viewport(bbox):
    return (
        bbox["x"] >= 0 and bbox["x"] + bbox["w"] <= VIEWPORT_W + 1
        and bbox["y"] >= 0 and bbox["y"] + bbox["h"] <= VIEWPORT_H + 1
    )


def meets_v0_constraints(extracted: dict) -> bool:
    """Step 3 v0: scroll=0 shows everything needed for a clean end-to-end run.
    Prior target + target + >=4 same-type distractors all fit within the first
    1280x768 viewport. Target primitive is one of the primary three."""
    if extracted["prior_target_bbox"] is None or extracted["target"] is None:
        return False
    if extracted["target"]["primitive"] not in {"button", "link", "form_input"}:
        return False
    if not bbox_in_first_viewport(extracted["prior_target_bbox"]):
        return False
    if not bbox_in_first_viewport(extracted["target"]["bbox"]):
        return False
    visible_distractors = [d for d in extracted["same_type_distractors"]
                           if bbox_in_first_viewport(d["bbox"])]
    if len(visible_distractors) < 4:
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=str(Path.home() / "Documents/dev/Mind2Web/data/data/train"))
    ap.add_argument("--task-id", help="annotation_id to extract")
    ap.add_argument("--action-idx", type=int, help="0-based action index within the task")
    ap.add_argument("--pick-first-valid", action="store_true",
                    help="Ignore --task-id/--action-idx; find the first action that meets v0 constraints")
    ap.add_argument("--domain", default=None,
                    help="Restrict --pick-first-valid to tasks with this domain (e.g. Shopping)")
    ap.add_argument("--primitive", default=None,
                    help="Restrict --pick-first-valid to target primitive (button|link|form_input)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    corpus_dir = Path(args.corpus)
    if not corpus_dir.is_dir():
        print(f"Corpus not found: {corpus_dir}", file=sys.stderr)
        sys.exit(1)

    if args.pick_first_valid:
        for task in iter_corpus(corpus_dir):
            if args.domain and task.get("domain") != args.domain:
                continue
            for idx in range(1, len(task.get("actions") or [])):
                try:
                    rec = extract_action(task, idx)
                except ValueError:
                    continue
                if args.primitive and rec["target"]["primitive"] != args.primitive:
                    continue
                if meets_v0_constraints(rec):
                    write_out(rec, args.out)
                    print(f"Picked: task={rec['task_id']} action={idx} "
                          f"website={rec['website']} domain={rec['domain']} "
                          f"primitive={rec['target']['primitive']} "
                          f"distractors={len(rec['same_type_distractors'])}")
                    return
        print("No action meets constraints.", file=sys.stderr)
        sys.exit(1)

    if not args.task_id or args.action_idx is None:
        print("--task-id and --action-idx required unless --pick-first-valid", file=sys.stderr)
        sys.exit(2)

    for task in iter_corpus(corpus_dir):
        if task.get("annotation_id") == args.task_id:
            rec = extract_action(task, args.action_idx)
            write_out(rec, args.out)
            print(f"Wrote {args.out}")
            return
    print(f"task_id {args.task_id} not found", file=sys.stderr)
    sys.exit(1)


def write_out(rec: dict, out_path: str):
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as fh:
        json.dump(rec, fh, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main()
