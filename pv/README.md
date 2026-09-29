# 微分几何 · Differential Geometry — promo film (PV)

An 84-second, 1920×1080, 30 fps cinematic promo rendered offline from a deterministic three.js engine
(HDR bloom, KaTeX formulas, real numerical differential geometry behind every image) plus a procedural score.

## Setup (the repo ships no binaries)
```bash
./setup.sh          # npm deps + python deps (ffmpeg with x264/aac, numpy, pillow) + sanity checks
```
Needs Node ≥ 20, Python 3 and a Chromium binary (`CHROME_PATH` or `/opt/pw-browsers/...`). Rendering uses SwiftShader (software WebGL2), no GPU required.

## Use
```bash
node tools/shot.mjs --scene s02_curvature --times 0,3,6,9 --sheet   # stills / contact sheet -> out/dev/
node tools/qa.mjs   --scene s02_curvature                            # pops, blown-out, black frames
node tools/audio.mjs                                                 # render score -> out/score.wav + analysis
node tools/render.mjs --workers 2 --audio out/score.wav --out out/pv.mp4   # final film
node tools/serve.mjs 8080                                            # live player at http://localhost:8080/index.html
```
Layout: `src/engine.js` (compositor) · `src/post.js` (HDR post) · `src/geom.js` (curvature, geodesics, parallel transport, Frenet) ·
`src/kit.js` (shared look) · `src/scenes/` (one module per chapter) · `src/audio/score.js` · `src/timeline.js` (single source of timing) · `docs/` (contract + storyboard).
