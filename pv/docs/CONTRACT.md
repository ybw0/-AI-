# PV Engine Contract — read this fully before writing any code

We are making an **84-second, 1920×1080, 30 fps cinematic promo film for "微分几何 / Differential Geometry"** — in Chinese with
English secondary text. It is rendered offline from a deterministic three.js engine (`/home/user/-AI-/pv`). The target feeling is
*awe*: a premium sci-fi title sequence meets a mathematics documentary. Think Interstellar / Kurzgesagt-in-the-dark / Apple keynote
typography, with **exact real mathematics** behind every image.

Working directory: `/home/user/-AI-/pv`. Story, per-scene briefs, script lines: `docs/STORYBOARD.md`. Timing: `src/timeline.js`.

## 1. What exists (do NOT modify shared files — see §9)

| file | purpose |
|---|---|
| `src/engine.js` | renderer + timeline compositor. Renders scene(s) to HDR targets, transitions, bloom, grade. Calls your `init` / `update`. |
| `src/post.js` | HDR bloom, anamorphic streak, ACES grade, chromatic aberration, vignette, grain, dither, 6 transitions |
| `src/util.js` | `seg ease pulse clamp lerp smoothstep rng noise3 fbm3 palette curvatureColor GLSL{hash,noise,curvatureColor,...} orbitCamera glowTexture` |
| `src/geom.js` | **numerical differential geometry** (validated by `node tools/test-geom.mjs`): `frame(f,u,v)` → E,F,G,L,M,N,K,H,k1,k2,e1,e2,n; `parametricGeometry(f,{nu,nv,u0,u1,v0,v1}, existingGeom?)` (per-vertex curvature attributes; pass the geom back in to animate); `christoffel geodesic uvVelocity parallelTransport frenet curves surfaces` (sphere, torus, catenoidHelicoid(θ), enneper, mobius, klein, saddle, monkeySaddle, pseudosphere, revolution) |
| `src/kit.js` | **shared look**: `backdrop` (nebula), `starfield`, `surfaceMaterial` (hero curvature-coloured glowing surface shader), `arrow`, `chapterTitle`, `caption`, `formula`, `readout` |
| `src/ui.js` | overlay: text / KaTeX / SVG HUD (immediate mode, see §4) |
| `src/scenes/_example.js`, `_kit.js` | working reference scenes — **read both first**; copy their structure |
| `tools/*` | preview & QA tools (§6) |

## 2. Your scene module

File `src/scenes/<id>.js` (id given in your task, e.g. `s02_curvature`). ES module, default export:

```js
import * as THREE from 'three';
import { seg, ease, ... } from '../util.js';  import { ... } from '../geom.js';  import * as kit from '../kit.js';
export default {
  init(ctx) { /* build everything ONCE: geometry, materials, precomputed tables. add to ctx.scene */ },
  update(t, ctx) { /* pose everything for local time t (seconds). called every frame */ },
  beats: [ { t: 5.0, kind: 'hit', label: 'fan launches' }, ... ],   // OPTIONAL musical hints, local seconds (kinds: hit | swell | tick | sparkle | whoosh)
};
```

`ctx` gives you: `THREE, scene, camera (PerspectiveCamera), renderer, W, H, px (=W/1920, scale for pixel sizes), aspect, t, T, dur,
post (per-frame mutable post params), ui (overlay API), rng(seed), background(hex), fatLine(points, opts), fatSegments(flatPositions, opts)`.
`ctx.scene` and `ctx.camera` are yours alone. The engine clears to `palette.void` (#02030a) each frame.

### Time contract (critical)
* `update(t, ctx)` MUST be a **pure function of `t`** — no `Math.random`, `Date.now`, `performance.now`, no state carried between frames,
  no `requestAnimationFrame`, no CSS transitions. Frames are rendered in any order, in parallel, and by seeking. If you need a simulation
  (geodesics, orbits, flows) **precompute the whole trajectory in `init` into arrays and index it by `t`**.
* Use `ctx.rng(seed)` / `util.rng(seed)` / `noise3` for randomness (deterministic).
* Your scene is alive for `t ∈ [0, dur + 1.0]`: while the *next* scene transitions in (up to 1 s) yours keeps rendering past `dur`.
  It must stay beautiful and continuous there (hold / drift, never snap, never go empty). Also `t=0` must already look intentional
  (the incoming transition shows you from t≈0).
* Scene durations are in `src/timeline.js`. **`anchors.hero` is the local time of your biggest visual moment** — the music lands a hit there; make it
  unmistakable (bloom pulse via `ctx.post.bloom`/`ctx.post.flash`, camera push, brightness surge, reveal). `anchors.build` is where tension starts rising.

## 3. Rendering rules (HDR, linear)
* All colour is **linear HDR**. Values > 1 bloom — that's how you get glow: emissive materials `new THREE.Color(hex).multiplyScalar(2..8)`,
  `fatLine({intensity: 2..3})`. `new THREE.Color(hex)` converts sRGB hex → linear for you. Custom `ShaderMaterial`: output linear colour, **no tonemapping,
  no gamma** — `gl_FragColor = vec4(col, alpha)`.
* Post params you may set per frame (reset to defaults every frame, so set them every frame): `ctx.post.{exposure, bloom, bloomThreshold, bloomScatter, streak, streakColor[3], contrast, saturation, tint[3], vignette, ca, grain, flash}`.
  **`flash` (REVISED after round 1)**: now a proper cinematic hit = bloom swell + exposure surge, so bright objects blow out into glowing white while dark space stays dark (no more grey fog). Values: **0.1–0.3 punchy hit, 0.5–0.8 heavy, ≥0.9 pure white** (needs ~3–8 frames of falloff, e.g. `0.7*Math.exp(-(t-HERO)/0.08)`). A hero moment should use this: earlier scenes kept it ~0 because the old flat-add flash looked like fog — that limitation is gone, so **raise hero flash to a real hit (≈0.4–0.8 for 2–4 frames) where the storyboard calls for a big moment**, but check the frame at full-res: it must look radiant, never grey. Keep `bloom` 0.4–1.2 normally, up to 2.5 for hero pulses.
  Greek letters/maths inside `ui.text` html: use `kit.math('\\kappa')` (inline KaTeX) — never hand-style κ τ in a sans/italic system face (reads as K/T).
* Premium look = **dark background + a few luminous elements + soft depth**. Avoid flat large bright areas. Use `kit.backdrop` and `kit.starfield` (subtle) or a
  pure gradient; vary composition between scenes but keep the family look (palette below).
* **Lines**: `THREE.Line` is 1 px and looks cheap — use `ctx.fatLine` / `ctx.fatSegments` (screen-space width in 1080p px, additive glow by default).
  To grow a fat line over time set `line.geometry.instanceCount = n` (see `_example.js`); to move it, `geometry.setPositions([...])` (allocates: keep point counts moderate).
* **Surfaces**: build with `geom.parametricGeometry` + `kit.surfaceMaterial` (curvature colouring, iso-lines, rim, reveal sweep). To animate a surface, call
  `parametricGeometry(f, opts, this.geo)` each frame (same nu,nv) — ≤ ~20k vertices per animated surface.
* Anti-aliasing is 4× MSAA. Avoid sub-pixel-thin geometry/flicker; avoid huge transparent overdraw stacks.

### Performance budget (final render runs on a software GL renderer!)
* Scene cost is measured by `tools/shot.mjs` ("render N ms", 960×540). **Target ≤ 400 ms per frame at 960×540** for your scene (excluding the first frame
  which includes shader compile). ≤ ~300k triangles visible, prefer `InstancedMesh`/`Points`, ≤ ~60 draw calls of heavy geometry, avoid per-pixel loops > 16 iterations in fragment shaders.
  If you must exceed, say so in your report.

## 4. Overlay API (`ctx.ui`) — 1920×1080 logical px regardless of output size
Immediate mode: call every frame you want the element visible; untouched elements vanish. Keys are private to your scene.
```js
ui.text(key, html, {x,y, anchor:'cc'|'tl'|'tc'|'tr'|'cl'|'cr'|'bl'|'bc'|'br', size, weight, font:'serif'|'en'|'sans'|'mono', color:'#hex'|0xhex, opacity, track(em), lh, glow:px|{r,color},
                    blur, scale, rot, align, width, reveal:0..1, revealMode:'chars'|'mask'|'fade', spread, italic, upper, stroke, hollow, mix:'screen', z})
ui.tex(key, latexString, {...same..., display:true})            // KaTeX. use String.raw`...`
ui.path(key, 'M..', {stroke, width, fill, opacity, progress:0..1 (draw-on), dash:[a,b], glow:px, glowColor, x,y,scale,rot})   // SVG, viewBox 1920×1080
ui.line / ui.rect / ui.circle (key, ...coords, opts)
```
* Fonts: `serif` = Noto Serif SC (Chinese titles, weight 400/600/700/900), `en` = Cormorant Garamond (elegant Latin, use `italic:true`), `mono` = JetBrains Mono (readouts, kickers), `sans` = Inter.
* **Use full-width Chinese punctuation** in Chinese text (，。：、《》—) and proper math symbols (κ τ ∬ ∮ χ π).
* Composition safe area: keep important content inside **x ∈ [110,1810], y ∈ [100,980]**. When `chrome` is on the engine draws corner brackets, a
  timecode top-right, brand top-left and a chapter tag bottom-left (y≈1010) — don't collide with those.
* Legibility: captions ≥ 40 px, formulas ≥ 46 px, readouts ≥ 20 px. Max **three text things on screen at once**. Text must never sit on a bright bloomed area; give
  captions space. Titles and captions animate in with `reveal` and out with opacity — never pop.
* Use `kit.chapterTitle`, `kit.caption`, `kit.formula`, `kit.readout` so typography is uniform across the film (customise via options, or build your own if a scene needs it, but match the look).

## 5. Style guide (one film, eight authors — stay in the family)
* **Palette** (`util.palette`): void `#02030a`, cyan `#5ee7ff` (primary line/light), blue `#3b6dff`, violet `#8a5cff`, magenta `#ff4fd8`, gold `#ffc861` (accent, positive curvature), white `#f4f8ff`.
  **Curvature colour code is film-wide law**: gold/orange = K > 0 (sphere-like), deep violet = K = 0 (flat), cyan/blue = K < 0 (saddle). Same in every scene.
  Frenet frame law: **T = gold, N = cyan, B = magenta**.
* **Motion**: nothing is ever static. Slow camera drift/orbit/dolly the whole time (parallax!), plus one decisive "hero" gesture. Ease everything (`ease.inOutCubic`, `outExpo`). Prefer few big moves over many small jitters.
  Reveal by *drawing* (sweeps, growing lines, particles converging) rather than fading whole objects.
* **Composition**: one clear focal subject; use depth (foreground particles, backdrop); rule of thirds; leave the text area calm. Title block default is top-left (`kit.chapterTitle`), subject centre/right.
* **Depth & texture**: layer `starfield`, faint `backdrop`, rim-light, thin grid floors, drifting dust `Points`. Add subtle life (pulses travelling along curves, slow shimmer).
* **Math must be right.** Use `geom.js` for real curvature/geodesics/holonomy; show real numbers in readouts (they should actually be computed, not faked). No wrong formulas.
* Text tone: poetic but exact, short lines (see STORYBOARD script). Chinese first, English italic beneath.

## 6. Tools — use them, look at your output!
```
node tools/shot.mjs --scene <id> --times 0,1.5,3,5,7.5,10 --w 960 --h 540 --sheet     # stills + contact sheet  -> out/dev/<id>/<id>_sheet.png
node tools/shot.mjs --scene <id> --times 5 --w 1920 --h 1080                           # full-res single frame (check detail/typography)
node tools/shot.mjs --scene <id> --times 2 --chrome                                    # with film HUD chrome
node tools/qa.mjs   --scene <id> --fps 8                                               # whole scene at 8 fps -> pops / blown-out / black frames / luminance jumps + out/qa/<id>/analysis.png
node --check src/scenes/<id>.js                                                        # syntax
node tools/test-geom.mjs                                                               # geometry library self-test
```
**You can see images with the Read tool — open the PNGs and judge them like a film director.** Non-negotiable loop: write → shot (contact sheet at ≥ 8 times spanning 0…dur+1) → *look* → fix → repeat, until it is genuinely stunning.
Also inspect at least one full-res 1920×1080 frame for typography/detail, and run `qa.mjs` to catch pops. `shot.mjs` exits non-zero and prints the problem if your module fails to load/compile (it silently renders a placeholder otherwise — check the output says "no console errors" and the picture is yours).
Timing note: the first frame of a run includes shader compilation (slow); later frames are representative. Software rendering: don't chase absolute ms, chase the ≤400 ms/frame budget.

## 7. Quality bar — checklist a critic will apply
1. **Impact**: is there a "wow" within the first second, a decisive hero moment at `anchors.hero`, and a satisfying end state? Would this make someone want to study geometry?
2. **Clarity**: one idea per scene; the mathematics is legible from the picture + 2–3 short text items; the hero object is instantly readable.
3. **Typography**: no overlaps with subject/HUD, no tofu (□) glyphs, correct punctuation, consistent with kit look, readable at 1080p.
4. **Motion**: continuous easing, no pops/flicker/frozen frames > 1 s, camera always alive, valid for `t ∈ [0, dur+1]`.
5. **Look**: family palette, curvature colour law, glow without blowing out (no > 35 % clipped white), depth layers, not flat.
6. **Technical**: zero console errors, within perf budget, deterministic (renders the same twice), no `Math.random`/time APIs.
7. **Math**: computed via geom.js (real values), formulas correct.

## 8. Report format
Finish by returning the structured JSON your task asks for (file, summary, hero time, beats, perf, known issues, engine requests). Be honest about weaknesses.

## 9. Rules of engagement
* Edit **only your own file(s)**: `src/scenes/<id>.js` (and, if needed, extra helper files named `src/scenes/<id>_*.js`). **Never edit** `engine.js post.js ui.js util.js geom.js kit.js timeline.js main.js index.html tools/*`.
  If you find a bug or need a feature in shared code, work around it in your file and list it under `engineRequests`.
* Other authors are working on the other scenes right now, on the same machine (CPU is shared): don't run heavy loops for long, always use 960×540 for exploration, and don't leave background processes running.
* Do not `git commit`/`git push`. Do not create pull requests.
* Don't write outside the repo dir except `/tmp` scratch. Put screenshots under `out/dev/` (already the default).
