#!/usr/bin/env bash
# Export the BeThere deck to a faithful, vector PDF using a headless
# Chromium-based browser (the same engine that renders index.html, so the
# PDF is pixel-identical: web fonts embedded, backgrounds printed, 16:9).
#
# Usage:  ./export-pdf.sh            # -> bethere-deck.pdf next to index.html
#         ./export-pdf.sh out.pdf    # custom output path
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="file://$DIR/index.html"
OUT="${1:-$DIR/bethere-reformat.pdf}"

# Find a Chromium-based browser (Chrome / Brave / Edge / Chromium).
CANDIDATES=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "$(command -v google-chrome || true)"
  "$(command -v chromium || true)"
  "$(command -v chromium-browser || true)"
)
CHROME=""
for c in "${CANDIDATES[@]}"; do
  [ -n "$c" ] && [ -x "$c" ] && { CHROME="$c"; break; }
done
if [ -z "$CHROME" ]; then
  echo "No Chromium-based browser found. Install Google Chrome, or open" >&2
  echo "index.html in Chrome and use File > Print > Save as PDF" >&2
  echo "(Background graphics ON, Margins None, paper size = the slide)." >&2
  exit 1
fi

echo "Browser: $CHROME"
echo "Source:  $SRC"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" \
  --virtual-time-budget=20000 \
  --run-all-compositor-stages-before-draw \
  "$SRC" 2>/dev/null

echo "Wrote:   $OUT"
command -v pdfinfo >/dev/null 2>&1 && pdfinfo "$OUT" | grep -E "Pages|Page size" || true
