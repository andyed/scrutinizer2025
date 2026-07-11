#!/usr/bin/env bash
#
# Download the pinned Tesseract English model used by the peripheral-OCR gate
# (scripts/validate-peripheral-ocr.js). eng.traineddata is .gitignore'd
# (*.traineddata), so a clean clone has no model and `npm run validate:ocr`
# cannot run until this fetches one. See docs/sprucing/phase-1-robustness-floor.md P1-4.
#
# Pinned model: tesseract.js v7 canonical "4.0.0_best" English LSTM model.
# The download is sha256-verified so the model is reproducible across machines.
#
# NOTE ON THE CURRENT BASELINE: tests/validation/ocr-baseline.json was frozen
# with a DIFFERENT, non-standard 5.2MB model whose upstream could not be
# identified (it matches none of tessdata_best / tessdata / tessdata_fast /
# legacy-3.04). Until the baseline is re-frozen against this pinned model on an
# Electron OCR run, validate:ocr may report numbers that differ from the
# committed baseline — that mismatch is surfaced (not hidden) by a sha check in
# validate-peripheral-ocr.js. Re-freezing the baseline with this model is the
# tracked follow-up.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/eng.traineddata"

# Pinned canonical model (verified 2026-07-11).
URL="https://tessdata.projectnaptha.com/4.0.0_best/eng.traineddata.gz"
EXPECTED_SHA256="8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba"
EXPECTED_BYTES="15400601"

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

if [ -f "$DEST" ]; then
  actual="$(sha256_of "$DEST")"
  if [ "$actual" = "$EXPECTED_SHA256" ]; then
    echo "[tessdata] eng.traineddata already present and matches the pinned model. Nothing to do."
    exit 0
  fi
  echo "[tessdata] eng.traineddata present but sha $actual != pinned $EXPECTED_SHA256."
  echo "[tessdata] (This is expected if it is the legacy non-standard baseline model.) Re-fetching the pinned model..."
fi

tmp="$(mktemp)"
echo "[tessdata] Downloading pinned model: $URL"
curl -fsSL -o "$tmp.gz" "$URL"
gunzip -f "$tmp.gz"   # -> $tmp

actual="$(sha256_of "$tmp")"
bytes="$(wc -c < "$tmp" | tr -d ' ')"
if [ "$actual" != "$EXPECTED_SHA256" ] || [ "$bytes" != "$EXPECTED_BYTES" ]; then
  echo "[tessdata] ERROR: downloaded model failed verification."
  echo "  expected sha256 $EXPECTED_SHA256 ($EXPECTED_BYTES bytes)"
  echo "  got      sha256 $actual ($bytes bytes)"
  rm -f "$tmp"
  exit 1
fi

mv "$tmp" "$DEST"
echo "[tessdata] Installed verified model to $DEST ($bytes bytes)."
echo "[tessdata] NOTE: the committed ocr-baseline.json was frozen with a different model — re-freeze it on an Electron OCR run so baseline and model are paired."
