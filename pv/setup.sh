#!/usr/bin/env bash
# One-shot environment setup for the PV renderer. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
echo "[1/3] npm dependencies (three, katex, fonts, playwright-core)"
npm install --no-audit --no-fund
echo "[2/3] python dependencies (ffmpeg binary with x264+aac, numpy, pillow)"
pip install -q -r requirements.txt
echo "[3/3] checks"
python3 -c "import imageio_ffmpeg; print('ffmpeg:', imageio_ffmpeg.get_ffmpeg_exe())"
CHROME="${CHROME_PATH:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1 || true)}"
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "No Chromium found. Install one (e.g. 'npx playwright install chromium') and export CHROME_PATH=/path/to/chrome"; exit 1
fi
echo "chromium: $CHROME"
node tools/test-geom.mjs 2>/dev/null | grep -c PASS | xargs echo "geometry self-tests passed:"
echo "OK. Try:  node tools/shot.mjs --scene _kit --times 3 --sheet"
