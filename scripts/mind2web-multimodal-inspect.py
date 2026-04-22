#!/usr/bin/env python3
"""
Inspect a Multimodal-Mind2Web parquet file.

Usage:
  uv run --python 3.12 --with pyarrow --with pillow \\
    python3 scripts/mind2web-multimodal-inspect.py \\
      --parquet data/mind2web-multimodal/train-00000.parquet \\
      [--annotation-id <uuid> --action-uid <uuid> --extract-png out.png]

Without --annotation-id: reports schema + N rows + first few annotation_ids.
With --annotation-id (and optionally --action-uid): looks up the row and writes
the screenshot to --extract-png.
"""

from __future__ import annotations
import argparse
import io
import sys
from pathlib import Path

import pyarrow.parquet as pq
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", required=True)
    ap.add_argument("--annotation-id")
    ap.add_argument("--action-uid")
    ap.add_argument("--extract-png")
    ap.add_argument("--list-ids", type=int, default=0,
                    help="Print first N annotation_ids then exit")
    args = ap.parse_args()

    pf = pq.ParquetFile(args.parquet)
    schema = pf.schema
    print(f"=== {args.parquet} ===")
    print(f"rows: {pf.metadata.num_rows}  row_groups: {pf.metadata.num_row_groups}")
    print(f"columns:")
    for i, field in enumerate(schema):
        print(f"  {i:2d} {field.name:<30} {field.physical_type}")
    print()

    if args.list_ids:
        cols = [c for c in ["annotation_id", "action_uid", "website", "domain",
                            "target_action_index", "target_action_reprs", "path"]
                if c in schema.names]
        table = pf.read(columns=cols)
        print(f"First {args.list_ids} rows (cols: {cols}):")
        for i in range(min(args.list_ids, len(table))):
            row = {c: table[c][i].as_py() for c in cols}
            # truncate long values
            for k, v in row.items():
                if isinstance(v, str) and len(v) > 80:
                    row[k] = v[:80] + "..."
            print(f"  {row}")
        return

    if args.annotation_id:
        # Stream to find matching rows (parquet doesn't support row-level filter
        # without loading, so we scan column-by-column efficiently).
        cols = ["annotation_id", "action_uid"]
        # Screenshot column name TBD — inspect schema first, then try common names.
        screenshot_col = None
        for candidate in ["screenshot", "image", "image_bytes", "screenshots"]:
            if candidate in schema.names:
                screenshot_col = candidate
                break
        if screenshot_col is None:
            print("No screenshot column found. Schema columns:",
                  schema.names, file=sys.stderr)
            sys.exit(1)
        print(f"screenshot column: {screenshot_col}")

        cols.append(screenshot_col)
        table = pf.read(columns=cols)
        # Find matching row
        for i in range(len(table)):
            aid = table["annotation_id"][i].as_py()
            auid = table["action_uid"][i].as_py() if "action_uid" in table.column_names else None
            if aid != args.annotation_id:
                continue
            if args.action_uid and auid != args.action_uid:
                continue
            shot = table[screenshot_col][i].as_py()
            if isinstance(shot, dict):
                # struct with {'bytes': ..., 'path': ...}
                data = shot.get("bytes")
            elif isinstance(shot, (bytes, bytearray)):
                data = bytes(shot)
            else:
                print(f"Unexpected screenshot type: {type(shot)}", file=sys.stderr)
                sys.exit(1)
            img = Image.open(io.BytesIO(data))
            print(f"Found row {i}: annotation_id={aid} action_uid={auid}")
            print(f"  image: {img.size[0]}x{img.size[1]} {img.format}")
            if args.extract_png:
                out = Path(args.extract_png)
                out.parent.mkdir(parents=True, exist_ok=True)
                img.save(out)
                print(f"  wrote {out}")
            return
        print(f"Not found: annotation_id={args.annotation_id}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
