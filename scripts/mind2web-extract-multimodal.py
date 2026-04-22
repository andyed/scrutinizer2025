#!/usr/bin/env python3
"""
Multimodal-Mind2Web single-action extractor (Step 3 v2).

Replaces scripts/mind2web-extract-action.py for the v2 pipeline. Reads one
action from a Multimodal-Mind2Web parquet (which bundles raw_html + bbox
attrs + the authoritative screenshot PNG), extracts the metadata we need,
and optionally writes the screenshot to a side file.

The raw_html + bboxes are still the source of candidate coordinates; we just
now sample pixels against the bundled screenshot instead of against a naked-
DOM re-render.

Usage:
  uv run --python 3.12 --with pyarrow --with pillow \\
    python3 scripts/mind2web-extract-multimodal.py \\
      --parquet data/mind2web-multimodal/train-00000.parquet \\
      --pick-first-valid \\
      --out tmp/action-v2.json \\
      --screenshot-out tmp/action-v2-screenshot.png
"""

from __future__ import annotations
import argparse
import io
import json
import re
import sys
from pathlib import Path

import pyarrow.parquet as pq
from PIL import Image

# Same primitive taxonomy as scripts/mind2web-split.js. Must match.
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


def candidate_to_record(cand):
    """Multimodal parquet stores each candidate as a JSON-stringified object
    (same shape as the text-only corpus)."""
    if isinstance(cand, str):
        try:
            cand = json.loads(cand)
        except json.JSONDecodeError:
            return None
    if not isinstance(cand, dict):
        return None
    attrs = cand.get("attributes")
    if isinstance(attrs, str):
        try:
            attrs = json.loads(attrs)
        except json.JSONDecodeError:
            return None
    elif attrs is None:
        attrs = {}
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


def _maybe_parse_json(c):
    if isinstance(c, str):
        try:
            return json.loads(c)
        except json.JSONDecodeError:
            return None
    return c


def pick_target(action_row):
    pos = action_row.get("pos_candidates") or []
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


def bbox_in_first_viewport(bbox):
    return (
        bbox["x"] >= 0 and bbox["x"] + bbox["w"] <= VIEWPORT_W + 1
        and bbox["y"] >= 0 and bbox["y"] + bbox["h"] <= VIEWPORT_H + 1
    )


def extract_action(table, idx: int):
    """Extract action at row `idx`. Each parquet row is already one action."""
    action_uid = table["action_uid"][idx].as_py()
    annotation_id = table["annotation_id"][idx].as_py()
    website = table["website"][idx].as_py()
    domain = table["domain"][idx].as_py()
    confirmed_task = table["confirmed_task"][idx].as_py()
    target_action_index = int(table["target_action_index"][idx].as_py())
    target_repr = table["target_action_reprs"][idx].as_py()
    action_reprs = table["action_reprs"][idx].as_py()
    pos_cands = table["pos_candidates"][idx].as_py() or []
    neg_cands = table["neg_candidates"][idx].as_py() or []

    # Target from pos_candidates (of the row itself = the target action)
    target = None
    for c in pos_cands:
        d = _maybe_parse_json(c) if isinstance(c, str) else c
        if isinstance(d, dict) and d.get("is_original_target"):
            target = candidate_to_record(c)
            break
    if target is None and pos_cands:
        target = candidate_to_record(pos_cands[0])
    if target is None:
        raise ValueError(f"no valid target in row {idx}")

    same_type_distractors = []
    for c in neg_cands:
        rec = candidate_to_record(c)
        if rec is None:
            continue
        if rec["primitive"] == target["primitive"]:
            same_type_distractors.append(rec)

    # Prior-action target bbox: find the previous row with the same annotation_id
    # and target_action_index - 1.
    prior_target_bbox = None
    if target_action_index > 0:
        for j in range(len(table)):
            if (table["annotation_id"][j].as_py() == annotation_id
                and int(table["target_action_index"][j].as_py()) == target_action_index - 1):
                prior_pos = table["pos_candidates"][j].as_py() or []
                for c in prior_pos:
                    d = _maybe_parse_json(c) if isinstance(c, str) else c
                    if isinstance(d, dict) and d.get("is_original_target"):
                        rec = candidate_to_record(c)
                        if rec:
                            prior_target_bbox = rec["bbox"]
                            break
                if prior_target_bbox is None and prior_pos:
                    rec = candidate_to_record(prior_pos[0])
                    if rec:
                        prior_target_bbox = rec["bbox"]
                break

    return {
        "annotation_id": annotation_id,
        "action_uid": action_uid,
        "action_idx": target_action_index,
        "website": website,
        "domain": domain,
        "confirmed_task": confirmed_task,
        "action_repr": target_repr,
        "n_actions_in_task": len(action_reprs),
        "prior_target_bbox": prior_target_bbox,
        "target": target,
        "same_type_distractors": same_type_distractors,
        "row_idx": idx,
    }


PATHOLOGICAL_UI_MAX_VISIBLE_DISTRACTORS = 50  # mirrors arm-0-config.json


def meets_v3_constraints(rec):
    """v3 constraints. Prior + target + 4-50 visible same-type distractors in
    the first 768 doc-pixels. The 50-max is the pathological-UI filter
    (see memo §Pathological-UI exclusion) — excludes calendars and
    repetitive-UI cases where pixel-level discrimination isn't well-posed."""
    if rec["prior_target_bbox"] is None or rec["target"] is None:
        return False
    if rec["target"]["primitive"] not in {"button", "link", "form_input"}:
        return False
    if not bbox_in_first_viewport(rec["prior_target_bbox"]):
        return False
    if not bbox_in_first_viewport(rec["target"]["bbox"]):
        return False
    visible = [d for d in rec["same_type_distractors"]
               if bbox_in_first_viewport(d["bbox"])]
    if len(visible) < 4:
        return False
    if len(visible) > PATHOLOGICAL_UI_MAX_VISIBLE_DISTRACTORS:
        return False
    return True


# Alias retained for backward compatibility with earlier scripts.
meets_v2_constraints = meets_v3_constraints


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", required=True)
    ap.add_argument("--annotation-id")
    ap.add_argument("--action-idx", type=int)
    ap.add_argument("--pick-first-valid", action="store_true")
    ap.add_argument("--primitive", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--screenshot-out", required=True,
                    help="Where to write the extracted screenshot PNG.")
    args = ap.parse_args()

    pf = pq.ParquetFile(args.parquet)
    table = pf.read()

    def finish(rec, screenshot_bytes):
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w") as fh:
            json.dump(rec, fh, indent=2)
            fh.write("\n")
        shot_out = Path(args.screenshot_out)
        shot_out.parent.mkdir(parents=True, exist_ok=True)
        with open(shot_out, "wb") as fh:
            fh.write(screenshot_bytes)
        img = Image.open(io.BytesIO(screenshot_bytes))
        print(f"action: {rec['website']}/{rec['domain']} {rec['annotation_id']}")
        print(f"  row={rec['row_idx']}  action_idx={rec['action_idx']}/{rec['n_actions_in_task']-1}")
        print(f"  repr: {rec['action_repr']}")
        print(f"  screenshot: {img.size[0]}x{img.size[1]} → {shot_out}")
        print(f"  target: {rec['target']['primitive']}/{rec['target']['tag']}  bbox={rec['target']['bbox']}")
        print(f"  prior gaze: {rec['prior_target_bbox']}")
        print(f"  same_type_distractors total: {len(rec['same_type_distractors'])}")
        visible = sum(1 for d in rec['same_type_distractors'] if bbox_in_first_viewport(d['bbox']))
        print(f"  visible at scroll=0: {visible}")

    if args.pick_first_valid:
        for i in range(len(table)):
            try:
                rec = extract_action(table, i)
            except ValueError:
                continue
            if args.primitive and rec["target"]["primitive"] != args.primitive:
                continue
            if meets_v2_constraints(rec):
                ss = table["screenshot"][i].as_py()
                finish(rec, ss["bytes"])
                return
        print("No action meets v2 constraints in this parquet.", file=sys.stderr)
        sys.exit(1)

    if args.annotation_id is None or args.action_idx is None:
        print("--annotation-id and --action-idx required unless --pick-first-valid", file=sys.stderr)
        sys.exit(2)

    for i in range(len(table)):
        if (table["annotation_id"][i].as_py() == args.annotation_id
            and int(table["target_action_index"][i].as_py()) == args.action_idx):
            rec = extract_action(table, i)
            ss = table["screenshot"][i].as_py()
            finish(rec, ss["bytes"])
            return
    print(f"not found: annotation_id={args.annotation_id} action_idx={args.action_idx}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
