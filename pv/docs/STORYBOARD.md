# 《微分几何》宣传片 — Storyboard

**Title**: 微分几何 · DIFFERENTIAL GEOMETRY  
**Tagline**: 在弯曲的世界里，寻找不变的真理。 / *In a curved world, find what never changes.*  
**Length**: 84 s · 120 BPM · 8 chapters · every cut on a downbeat (see `src/timeline.js`).  
**Arc**: a single point of light → curve → surface → curvature → geodesics → topology → the cosmos → everything relaxes to roundness → title.
Each chapter answers one question and ends on an image you would want to screenshot. Chapter 8 loops back to the ignition point of chapter 1.

Global rules: Chinese first (思源宋体), English italic beneath (Cormorant). Full-width Chinese punctuation. Curvature colours: **gold K>0 · violet 0 · cyan K<0**; Frenet: **T gold, N cyan, B magenta**.
Text budget per scene: a chapter title (`kit.chapterTitle`), 1–3 captions (`kit.caption`), 1–2 formulas (`kit.formula`), optional mono readouts. Scenes 0 and 7 have no HUD chrome.

Timeline (absolute s): 00 曲线 0–10 · 01 曲面 10–20 · 02 曲率 20–32 · 03 测地线 32–42 · 04 高斯–博内 42–52 · 05 时空 52–62 · 06 Ricci 流 62–70 · 07 终章 70–84.
Transitions into each scene (0.5–1.0 s, the engine blends; you just render): 01 zoom-blur · 02 white flash · 03 iris · 04 glitch · 05 zoom-blur · 06 dip-to-black · 07 white flash. Design your first 0.8 s and last 1 s accordingly (e.g. scene 02 begins right after a white flash: start bright-ish and resolve to dark; scene 06 starts from black).

---

## s00_curve — 曲线 · Curves (0–10 s) · hero 6.0 · build 2.0 · no chrome
*Question: how does a curve bend and twist?*  
**Beats of the picture**
* 0.0–1.5: pure darkness with faint stars/nebula; at ~0.6 a single point of light **ignites** (tiny hot white dot, bloom halo swelling, a soft shockwave ring). Camera slowly pushes in.
* 1.5–6: the point **flies**, its luminous comet trail drawing a beautiful 3D space curve (trefoil / (2,3) torus knot / a richer Lissajous knot — your choice, it must be gorgeous and closed). Camera tracks/orbits with parallax, speed varies elegantly.
  The **Frenet frame** rides the head (T gold, N cyan, B magenta, `kit.arrow`), plus the **osculating circle** (radius 1/κ, in the plane of T,N, centre along N) as a thin glowing ring. A live mono readout shows the true κ and τ (`geom.frenet`) and a tiny κ(s) graph draws itself (ui.path) — numbers must be the real ones for your curve.
* **6.0 HERO**: the curve closes; a bright pulse of light *runs through the whole knot* (bloom spike, `post.flash` for a few frames), the camera pulls back / rotates to reveal the full glowing knot; the title lands (`chapterTitle` 曲线 / Curves, kicker `CHAPTER 01`) timed to be fully visible ~6.5–9.
* 6–10: knot rotates slowly, faint echoes (a family of similar curves) shimmer around it; formula (Frenet–Serret) fades in: `\mathbf T'=\kappa\mathbf N,\ \mathbf N'=-\kappa\mathbf T+\tau\mathbf B,\ \mathbf B'=-\tau\mathbf N`. In the last 1.5 s begin hinting the next chapter: a thin ring/circle family starts to orbit the curve (sweeping = surface).
**Script**: 1.4 s caption「一切，从一个点的运动开始。」/ *Everything begins with a moving point.* · 6.8 s caption「曲率 κ 与挠率 τ，刻画曲线如何弯曲、如何扭转。」/ *Curvature κ and torsion τ: how a curve bends and twists.*
**End state** (must hold well through t=11): calm elegant knot, dark, lots of negative space.

## s01_surface — 曲面 · Surfaces (10–20 s) · hero 5.0 · build 2.0
*Question: what is a surface, geometrically?*  
* 0–1: continues the ring motif from chapter 1 — a single glowing circle. It **sweeps** (rotates/translates) to *grow a torus*: iso-parametric grid lines and the surface reveal along `uReveal` with glowing sweep edge. Camera arcs around.
* 2–5: build: the torus becomes solid (curvature tint faint), rim glow; a marker point glides over it; at the point appear the **tangent plane** (translucent glowing quad, drawn-on outline), the **unit normal** (arrow), and the two **principal directions** as crossing bars.
* **5.0 HERO**: the **lines of curvature** ignite — on a torus they're exactly the parallels (u=const) and meridians (v=const): two orthogonal families of glowing circles with light pulses racing along them; camera swoops; bloom pulse. Title lands slightly before (`chapterTitle` 曲面 / Surfaces, kicker `CHAPTER 02`, ~3.6–6.5).
* 6–10: slow orbit; both fundamental forms typeset (`\mathrm{I}=E\,du^2+2F\,du\,dv+G\,dv^2`, `\mathrm{II}=L\,du^2+2M\,du\,dv+N\,dv^2`), readout of real E,F,G,L,M,N (from `geom.frame`) at the moving point.
**Script**: 1.6 s「把一条曲线扫过空间，曲面便诞生了。」/ *Sweep a curve through space and a surface is born.* · 5.6 s「每一点，都有一张切平面，和一个法向。」/ *Every point has a tangent plane and a normal.*

## s02_curvature — 曲率 · Curvature (20–32 s) · hero 6.0 · build 2.0 · climax 10.0  — the intellectual heart
*Question: how do you measure "curved"? …and can a bug living on the surface feel it?*  
Starts right after a white flash → open bright, settle into dark.
* **Act A (0–6)**: Three archetypes side by side or in sequence, each a glowing patch with its two **osculating circles / principal curvature circles**: sphere-cap (both circles on the same side → K>0, gold), plane (K=0, violet), saddle (circles on opposite sides → K<0, cyan). Big `K=\kappa_1\kappa_2` builds letter by letter. Optionally the **Gauss map** flash (normals → unit sphere).
* **6.0 HERO**: the torus (or a lumpy blob) **ignites with its true Gaussian-curvature heat map** (gold outside, cyan inside, sweep-reveal with glowing front), bloom pulse, camera flies in. Title `曲率 / Curvature` (`CHAPTER 03`) around 3–6.
* **Act B (6–12): Theorema Egregium** — the **catenoid bends into the helicoid** (`surfaces.catenoidHelicoid(θ)`, θ from π/2 → 0 and beyond, smooth, looping) while its curvature colouring stays **exactly the same at every material point** (K depends only on (u,v)); a big live readout `K = −1/cosh⁴ v` at a tracked point stays constant while the shape changes utterly. **10.0 CLIMAX**: mid-bend, camera swoops close, the tracked point glows, a "K 不变 / K unchanged" stamp.
  Formula: `K(\theta)\equiv-\dfrac{1}{\cosh^{4}v}`.
**Script**: 2.0 s「曲率，是弯曲的度量。」/ *Curvature measures bending.* · 6.6 s「高斯的绝妙定理：曲率是曲面的内蕴性质。」/ *Gauss's Theorema Egregium: curvature is intrinsic.* · 9.6 s「无需离开曲面，就能感知它的弯曲。」/ *You can feel the curvature without ever leaving the surface.*

## s03_geodesic — 测地线 · Geodesics (32–42 s) · hero 5.0 · build 2.0
*Question: what is a "straight line" in a curved world?*  
* 0–4: an elegant dark torus (or sphere) with grid; a point on it glows. Build tension: a slow camera dolly, faint particles.
* **5.0 HERO**: from the point a **fan of 36–60 geodesics** launches simultaneously like beams of light (`geom.geodesic` integrated in `init`; trails grow with arclength ∝ t, wrapping the torus, some closing, some ergodically filling), bloom pulse + flash, camera pulls to reveal the pattern. Title lands before (`测地线 / Geodesics`, `CHAPTER 04`, ~2.4–5).
* 6–10: **parallel transport**: on a sphere, a vector carried around a geodesic triangle (octant) returns **rotated by 90° = ∬K dA** (`geom.parallelTransport`; readout `Δθ = 90.0° = ∬K dA`). Show the arrow at successive points (ghosts) so the rotation is visible. Can be the same scene composition (sphere appears beside/instead of the torus via a sweep) — make the switch a designed move, not a cut.
  Formula: `\ddot{x}^k+\Gamma^k_{ij}\,\dot{x}^i\dot{x}^j=0`.
**Script**: 2.6 s「在弯曲的世界里，最“直”的路，叫测地线。」/ *In a curved world, the straightest path is a geodesic.* · 7.0 s「沿闭合路径平行移动，方向却变了。」/ *Carry a vector around a loop — it returns rotated.*

## s04_gaussbonnet — 高斯–博内 · Gauss–Bonnet (42–52 s) · hero 5.0 · build 2.0
*Question: how does local curvature control global shape?*  Starts after a glitch cut.
* 0–5: **geodesic triangles** on three surfaces in a row: sphere octant (angle sum 270° > 180°), plane (180°), saddle (< 180°, compute the true value from your surface). Interior angles are labelled with animated counters; the sum readout ticks up and snaps at the hero.
* **5.0 HERO**: the big formula ignites: `\iint_M K\,dA+\oint_{\partial M}k_g\,ds=2\pi\chi(M)` with flash; camera pushes through.
* 5.5–10: **topology montage**: sphere χ=2, torus χ=0, double torus χ=−2 (genus 2) rotating, coloured by curvature, with `χ = 2 − 2g` and the integral of K printed for each (∬K dA = 4π, 0, −4π; you may compute numerically for the torus to prove it). Title `高斯–博内 / Gauss–Bonnet` (`CHAPTER 05`) ~2.5–5.
  Hint for the double torus: implicit surface `(x(x−1)²(x+1)² + y² − 0.01)² + z² − 0.01 = 0` via your own marching-cubes/marching-tetrahedra in `init`, or a smooth-union of two tori.
**Script**: 2.4 s「三角形的内角和，取决于曲率。」/ *The angle sum of a triangle depends on curvature.* · 6.5 s「局部的曲率，决定整体的拓扑。」/ *Local curvature decides global topology.*

## s05_spacetime — 时空 · Spacetime (52–62 s) · hero 6.0 · build 2.0
*Question: is gravity geometry?*  
* 0–5: a vast luminous **spacetime grid** (embedding diagram, Flamm's paraboloid `z = 2√(r_s(r−r_s))` or a smooth well) with a central mass sinking in as you watch; probes/planets orbit on **geodesics** of the funnel (precessing rosettes: integrate in `init`); light rays bend.
* **6.0 HERO**: a **black hole with an Einstein ring** — accretion disk / photon ring glow and a gravitationally **lensed star field** (screen-space deflection α = 4GM/(bc²) — a cheap analytic deflection shader on a fullscreen sphere/quad is enough and looks real); massive bloom pulse, camera lunge.
  Title `时空 / Spacetime` (`CHAPTER 06`) ~3–6. Formula: `G_{\mu\nu}=8\pi G\,T_{\mu\nu}`.
**Script**: 2.4 s「物质告诉时空如何弯曲；时空告诉物质如何运动。」/ *Matter tells spacetime how to curve; spacetime tells matter how to move.* · 7.2 s「引力，就是时空的几何。」/ *Gravity is the geometry of spacetime.*

## s06_ricci — Ricci 流 · Ricci flow (62–70 s) · hero 4.0 · build 1.5
*Question: can any shape relax into its simplest form?*  Starts from black after a dip.
* 0–4: a **lumpy, spiky closed surface** (sphere + strong spherical-harmonic/noise bumps), curvature-coloured wildly (gold peaks, cyan dents), pulsing; the **flow** starts: high frequencies die first (`a_lm(t)=a_lm(0)·e^{-l(l+1)τ}`), colours homogenise. Camera slow orbit + push.
* **4.0 HERO**: the last bump melts — a **perfect sphere**, uniform gold; shockwave ring + bloom flash; readout `K ≡ const`.
* 4–8: sphere rotates; formula `\partial_t g_{ij}=-2R_{ij}` and credit line「格里戈里·佩雷尔曼 · 庞加莱猜想 · 2003」/ *Grigori Perelman · Poincaré Conjecture · 2003*. Title `Ricci 流 / Ricci Flow` (`CHAPTER 07`) ~2.2–5.
**Script**: 1.8 s「Ricci 流：让任意形状归于圆润。」/ *Ricci flow: every shape relaxes toward roundness.* · 4.6 s「最终，只剩下最简单的几何。」/ *In the end, only the simplest geometry remains.*

## s07_finale — 终章 · Finale (70–84 s) · hero 3.0 · end 12.5 · no chrome
* 0–3: after the white flash: **montage burst** — glimpses (0.3 s each) of the motifs (knot, torus grid, helicoid, geodesic fan, triangle, funnel, sphere) as light streaks **spiralling inward** to a single point — the ignition point of chapter 1.
* **3.0 HERO**: the point detonates into a magnificent luminous **Klein bottle / torus-knot tube / minimal surface** (curvature-coloured with glowing iso-lines, orbiting particles, backdrop nebula, huge bloom) — the most beautiful object in the film. Slow majestic orbit.
* 4.5–10: title **「微分几何」** huge (≈260 px, weight 900, glow, letter-by-letter), **DIFFERENTIAL GEOMETRY** wide-tracked beneath, then the tagline「在弯曲的世界里，寻找不变的真理。」/ *In a curved world, find what never changes.*
* 10–14: object recedes/dims into the dark with the title still standing; final tiny line「开启弯曲世界的大门。」/ *Open the door to curved worlds.*; the engine's global fade takes it to black in the last 1.6 s (design for a still, elegant last frame around 12.5).
