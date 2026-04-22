#!/usr/bin/env python3
"""
Mind2Web corpus → per-task summary JSON.

Walks ~/Documents/dev/Mind2Web/data/data/train/train_*.json (13GB total, each
file up to ~600MB, which blows Node's max string length) and produces a
compact summary-per-task at data/mind2web-summaries.json (~1MB).

Fields per task: website, annotation_id, domain, n_actions, per_primitive
counts. Discards raw_html and candidate attributes — those are re-read per
action by the cache-build step, not needed for the split.

The primitive taxonomy must match scripts/mind2web-split.js exactly so the
split's per-primitive stats align with downstream gating.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

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


def map_tag_to_primitive(tag: str) -> str:
    return PRIMITIVE_MAP.get(tag, "other")


def parse_action_repr(repr_str: str) -> str | None:
    m = re.match(r"^\[([^\]]+)\]", repr_str)
    return m.group(1) if m else None


def summarize_task(task: dict) -> dict:
    per_prim: dict[str, int] = defaultdict(int)
    for ar in task.get("action_reprs", []):
        tag = parse_action_repr(ar)
        if tag is None:
            continue
        per_prim[map_tag_to_primitive(tag)] += 1
    return {
        "website": task.get("website", ""),
        "annotation_id": task.get("annotation_id", ""),
        "domain": task.get("domain", ""),
        "n_actions": len(task.get("action_reprs", [])),
        "per_primitive": dict(per_prim),
    }


def walk_corpus(corpus_dir: Path):
    files = sorted(f for f in os.listdir(corpus_dir)
                   if re.match(r"^train_\d+\.json$", f))
    for fname in files:
        fpath = corpus_dir / fname
        with open(fpath) as fh:
            tasks = json.load(fh)
        for t in tasks:
            yield summarize_task(t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=str(Path.home() / "Documents/dev/Mind2Web/data/data/train"),
                    help="Directory containing Mind2Web train_*.json files")
    ap.add_argument("--out", required=True, help="Output summaries JSON path")
    args = ap.parse_args()

    corpus_dir = Path(args.corpus)
    if not corpus_dir.is_dir():
        print(f"Corpus not found: {corpus_dir}", file=sys.stderr)
        sys.exit(1)

    summaries = list(walk_corpus(corpus_dir))
    # Sort by annotation_id for deterministic output.
    summaries.sort(key=lambda s: s["annotation_id"])

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "source": "HKUDS/Mind2Web train split (osunlp/Mind2Web on HuggingFace)",
        "n_tasks": len(summaries),
        "summaries": summaries,
    }
    with open(out_path, "w") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"Wrote {out_path} ({len(summaries)} tasks)")


if __name__ == "__main__":
    main()
