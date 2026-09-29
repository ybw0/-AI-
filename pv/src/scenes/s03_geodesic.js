// s03_geodesic — 测地线 / Geodesics.  32–42 s, hero 5.0.
// Act I  (0–6.5): a dark glass torus, one point of light P.  A lone photon leaves P along a true geodesic (the "straightest" path) while a ring of 48
//                 direction ticks charges around P; at 5.0 the whole fan of 48 geodesics (RK4 in init, analytic Christoffel symbols) detonates out of P together
//                 with their geodesic circle (the wavefront through all 48 heads).  Some hug the outer equator (Clairaut oscillators), some plunge through the hole.
// Act II (6.2–11): the camera trucks across the world to a sphere; a vector is parallel-transported round the octant triangle A→B→C→A (geom.parallelTransport,
//                 per leg) and returns rotated by exactly ∬K dA = 90°.
// Everything is a pure function of t: all trajectories / tables are precomputed in init().
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, smoothstep, palette, orbitCamera, rng, TAU, GLSL } from '../util.js';
import { frame, geodesic, christoffel, uvVelocity, parallelTransport, surfaces, parametricGeometry, vec } from '../geom.js';
import * as kit from '../kit.js';
import { makeSegs, makePoints } from './s03_geodesic_lines.js';

// ------------------------------------------------------------------------------------------------------------- constants
const T_HERO = 5.0;
const R0 = 1.9, r0 = 0.72;                       // torus radii
const TS = surfaces.torus(R0, r0), TF = TS.f;
const U0 = Math.PI / 2, V0 = 0.62;               // launch point P (front / upper-outer, K > 0)
const N_FAN = 48, DS = 0.10, L_FAN = 16, L_HERO = 20, PSI_H = 0.28;        // DS 0.10 / L_FAN 16: ~1/3 of the original instanced quads (software GL pays per instance; the fan is off-screen long before its tail matters)
const FLOOR_Y = -1.85;
const SPH = new THREE.Vector3(8.8, 0, 0), RS = 1.8;       // sphere world position & scale
const CYAN = new THREE.Color(palette.cyan), ICE = new THREE.Color(palette.ice), GOLD = new THREE.Color(palette.gold), MAG = new THREE.Color(palette.magenta), WHITE = new THREE.Color(palette.white);

// analytic Christoffel symbols  (E = ρ², G = r²,  ρ = R + r cos v)  in the naming of geom.christoffel
const torusChris = (u, v) => { const rho = R0 + r0 * Math.cos(v); return { G111: 0, G211: (rho * Math.sin(v)) / r0, G112: (-r0 * Math.sin(v)) / rho, G212: 0, G122: 0, G222: 0 }; };
const tn = (u, v) => [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];       // torus outward normal

// ------------------------------------------------------------------------------------------------------------- sphere / parallel-transport data
const SA = [1, -1, 0].map((x) => x / Math.SQRT2);
const SB = [1, 1, 1].map((x) => x / Math.sqrt(3));
const SC = vec.nrm(vec.cross(SB, SA));
const sphF = (u, v) => { const c = Math.cos(v), s = Math.sin(v), cu = Math.cos(u), su = Math.sin(u); return [c * SA[0] + s * (cu * SB[0] + su * SC[0]), c * SA[1] + s * (cu * SB[1] + su * SC[1]), c * SA[2] + s * (cu * SB[2] + su * SC[2])]; };
const sphUV = (p) => [Math.atan2(vec.dot(p, SC), vec.dot(p, SB)), Math.acos(clamp(vec.dot(p, SA), -1, 1))];
const sphChris = (u, v) => ({ G111: 0, G211: -Math.sin(v) * Math.cos(v), G112: Math.cos(v) / Math.sin(v), G212: 0, G122: 0, G222: 0 });
const VA = [1, 0, 0], VB = [0, 1, 0], VC = [0, 0, 1];
const slerp = (p0, p1, s) => { const om = Math.acos(clamp(vec.dot(p0, p1), -1, 1)), so = Math.sin(om); return vec.add(vec.scl(p0, Math.sin((1 - s) * om) / so), vec.scl(p1, Math.sin(s * om) / so)); };
const LEGS = [[VA, VB], [VB, VC], [VC, VA]], PT_STEPS = 120;

function buildTransport() {
  const W0v = vec.nrm(vec.add(VB, VC));                           // bisector of the interior angle at A (tangent at A)
  const uvA = sphUV(VA);
  let W = uvVelocity(sphF, uvA[0], uvA[1], W0v);
  const P = [], V = [];
  for (let k = 0; k < 3; k++) {
    const [p0, p1] = LEGS[k];
    const path = (t) => sphUV(slerp(p0, p1, t));
    const out = parallelTransport(sphF, path, W, { t0: 0, t1: 1, steps: PT_STEPS, christoffelFn: sphChris });
    out.forEach((o, i) => { if (k > 0 && i === 0) return; P.push(slerp(p0, p1, o.t)); V.push(vec.nrm(o.vec)); });
    W = out[out.length - 1].W;
  }
  // holonomy angle at A (signed, about the outward normal)
  const Vf = V[V.length - 1], V0_ = V[0];
  const ang = Math.atan2(vec.dot(VA, vec.cross(V0_, Vf)), vec.dot(V0_, Vf));
  // ∬K dA over the octant by quadrature on the barycentric map (K from geom.frame on the same sphere)
  const M = 48; let area = 0, Ksum = 0;
  const pb = (a, b) => vec.nrm([a, b, 1 - a - b]);
  for (let i = 0; i < M; i++) for (let j = 0; j < M - i; j++) for (const [ca, cb] of [[(i + 1 / 3) / M, (j + 1 / 3) / M], [(i + 2 / 3) / M, (j + 2 / 3) / M]]) {
    if (ca + cb > 1) continue;
    const h = 1e-4, pu = vec.sub(pb(ca + h, cb), pb(ca - h, cb)), pv = vec.sub(pb(ca, cb + h), pb(ca, cb - h));
    const dA = vec.len(vec.cross(vec.scl(pu, 1 / (2 * h)), vec.scl(pv, 1 / (2 * h)))) / (M * M) * 0.5;
    const uv = sphUV(pb(ca, cb)); const K = frame(sphF, uv[0], uv[1], 1e-3).K;
    area += dA; Ksum += K * dA;
  }
  // interior angles from the transported-path tangents at the three vertices (geodesic legs)
  const tang = (k, atEnd) => { const [p0, p1] = LEGS[k]; const e = 1e-4; const s = atEnd ? 1 : 0; return vec.nrm(vec.sub(slerp(p0, p1, clamp(s + e * (atEnd ? 0 : 1), 0, 1)), slerp(p0, p1, clamp(s - e * (atEnd ? 1 : 0), 0, 1)))); };
  const ext = [0, 1, 2].map((k) => Math.acos(clamp(vec.dot(tang(k, true), tang((k + 1) % 3, false)), -1, 1)));
  return { P, V, ang, area, Ksum, interior: ext.map((e) => Math.PI - e) };
}

// ------------------------------------------------------------------------------------------------------------- shaders
const floorFS = /* glsl */ `
  varying vec2 vP; uniform float uT, uAmp; uniform vec2 uC0, uC1; uniform float uWave, uWaveA;
  ${GLSL.hash}
  void main(){
    vec2 p = vP;
    vec2 g = p/1.0; vec2 d = abs(fract(g - 0.5) - 0.5)/max(fwidth(g), vec2(1e-4)); float l = 1.0 - min(min(d.x, d.y), 1.0);
    vec2 g2 = p/5.0; vec2 d2 = abs(fract(g2 - 0.5) - 0.5)/max(fwidth(g2), vec2(1e-4)); float l2 = 1.0 - min(min(d2.x, d2.y), 1.0);
    float f0 = exp(-length(p - uC0)*0.16), f1 = exp(-length(p - uC1)*0.19);
    float fade = max(f0, f1);
    float wave = exp(-pow((length(p - uC0) - uWave)/0.30, 2.0))*step(0.01, uWave)*exp(-uWave*0.09);
    vec3 col = vec3(0.16,0.30,0.95)*l*0.05 + vec3(0.45,0.55,1.0)*l2*0.14;
    col *= fade; col += vec3(0.4,0.75,1.0)*wave*0.12*uWaveA*f0;
    gl_FragColor = vec4(col*uAmp, 1.0);
  }`;

const discFS = /* glsl */ `
  varying vec2 vP; uniform float uA, uT; uniform vec3 uCol;
  void main(){ float r = length(vP); float e = exp(-pow((r - 1.0)/0.03, 2.0)); float fill = smoothstep(1.0, 0.0, r)*0.18; float sweep = exp(-pow(fract(uT*0.4) - r, 2.0)/0.01)*0.35;
    gl_FragColor = vec4(uCol*(fill + sweep*(1.0 - r) + e*0.5)*uA, 1.0); }`;

const patchVS = /* glsl */ `
  varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
// The octant is swept by a "hand" turning about vertex A: the swept fan angle alpha has  \u222c K dA = alpha  exactly (unit sphere, K = 1), so the front IS the holonomy.
const patchFS = /* glsl */ `
  varying vec3 vP; uniform float uRev, uA, uT; uniform vec3 uCol;
  float ln(float x){ float w = fwidth(x); float f = abs(fract(x - 0.5) - 0.5)/max(w, 1e-4); return 1.0 - min(f/1.3, 1.0); }
  void main(){
    vec3 p = normalize(vP);
    float phi = atan(p.z, p.y)/1.5707963, d = acos(clamp(p.x, -1.0, 1.0))/1.5707963;
    float a = smoothstep(uRev, uRev - 0.07, phi);
    float edge = exp(-pow((phi - uRev + 0.012)/0.022, 2.0))*step(0.002, uRev);
    float halo = exp(-pow((phi - uRev + 0.05)/0.12, 2.0))*step(0.002, uRev);
    float lf = smoothstep(0.05, 0.22, d);
    float lines = (ln(phi*18.0)*0.6 + ln(d*9.0)*0.5)*lf;
    float bord = exp(-min(min(p.x, p.y), p.z)/0.09);
    float sh = 0.85 + 0.15*sin(uT*1.6 - d*9.0);
    vec3 hot = mix(uCol, vec3(1.0, 0.95, 0.8), 0.5);
    gl_FragColor = vec4((uCol*a*(0.11 + 0.62*lines + 0.32*bord)*sh + hot*(edge*0.4 + halo*0.08*(1.0 - a*0.5)))*uA, 1.0);
  }`;

/** kit.chapterTitle variant with the English line dropped clear of the CJK glyph descent. */
function title(ui, t, { at, hold, zh, en, kicker, x, y, size }) {
  const inn = seg(t, at, at + 1.4, ease.outCubic), out = seg(t, at + 1.4 + hold, at + 2.1 + hold, ease.inOutCubic), v = inn * (1 - out);
  if (v <= 0.001) return;
  const yE = y + size * 1.3, yR = yE + size * 0.42;
  ui.text('tk', kicker, { x, y: y - size * 0.34, anchor: 'tl', size: 20, font: 'mono', track: 0.42, color: '#5ee7ff', opacity: v, reveal: seg(t, at, at + 0.9, ease.linear), revealMode: 'mask' });
  ui.text('tz', zh, { x, y, anchor: 'tl', size, weight: 900, color: '#f4f8ff', glow: 26, opacity: v, reveal: seg(t, at + 0.15, at + 1.35, ease.linear), spread: 0.9, track: 0.04 });
  ui.text('te', en, { x: x + 6, y: yE, anchor: 'tl', size: Math.round(size * 0.27), font: 'en', italic: true, weight: 400, track: 0.22, color: '#cfeaff', opacity: v * 0.9, reveal: seg(t, at + 0.5, at + 1.5, ease.linear), revealMode: 'mask' });
  ui.line('tr', x, yR, x + 220, yR, { stroke: '#5ee7ff', width: 2.5, progress: seg(t, at + 0.4, at + 1.4), opacity: v * 0.9, glow: 8 });
}

// ------------------------------------------------------------------------------------------------------------- time laws
const T_LAUNCH = 4.86;                                       // the fan starts to emerge 0.14 s before the downbeat, so the hit frame already carries geodesics (~1.4 units long)
const sFan = (t) => { const tau = Math.max(0, t - T_HERO); return Math.min(L_FAN - 0.5, 1.6 * smoothstep(T_LAUNCH, T_HERO + 0.04, t) + 6.5 * (1 - Math.exp(-1.7 * tau)) + 2.0 * tau); };
const sHero = (t) => {
  const w = clamp(t - 1.0, 0, 1);
  const teaser = t < 2.0 ? 1.6 * (w * w * w - (w * w * w * w) / 2) : 0.8 + 1.6 * (Math.min(t, T_HERO) - 2.0);
  return Math.min(L_HERO - 0.5, teaser + sFan(t));
};
const tmix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** camera pose: one pure function of t */
function camPose(t) {
  const a = seg(t, 0.0, 4.9, ease.inOutSine);
  const h = seg(t, 4.55, 6.9, ease.inOutCubic);
  const P = TF(U0, V0);
  const tgtA = tmix3([P[0] * 0.72, P[1] * 0.72 - 0.05, P[2] * 0.72 - 0.15], [-1.35, -0.75, 0], ease.inOutCubic(clamp(t / 4.9)));
  tgtA[1] -= 0.38 * seg(t, 4.3, 5.6, ease.inOutCubic);          // lifts the torus clear of the caption during the fan
  const rA = lerp(4.1, 9.6, a) + 1.5 * h;
  const azA = lerp(-0.62, 0.10, a) + 0.34 * h;
  const elA = lerp(0.36, 0.55, a) + 0.30 * h;
  const k = seg(t, 5.9, 8.2, ease.inOutCubic);
  const d = Math.max(0, t - 8.2);
  const tgtB = [SPH.x + 0.55, -0.36, 0.0];            // sphere near the centre, the readout column stays clear on the right
  return {
    target: tmix3(tgtA, tgtB, k),
    r: lerp(rA, 7.8, k) - 0.10 * d,
    az: lerp(azA + 0.05 * Math.max(0, t - 6), 0.04, k) + 0.05 * d,
    el: lerp(elA, 0.34, k),
    roll: 0.05 * (1 - a) * 0 + 0.028 * Math.sin(k * Math.PI) - 0.012 * h * (1 - k),
  };
}

// ------------------------------------------------------------------------------------------------------------- scene
export default {
  beats: [
    { t: 0.0, kind: 'swell', label: 'point of light' },
    { t: 1.0, kind: 'whoosh', label: 'first photon leaves along a geodesic' },
    { t: 3.0, kind: 'tick' }, { t: 4.0, kind: 'tick' },
    { t: 4.5, kind: 'swell', label: 'ring charges' },
    { t: 5.0, kind: 'hit', label: 'fan of 48 geodesics launches' },
    { t: 5.15, kind: 'sparkle' },
    { t: 6.3, kind: 'whoosh', label: 'truck to the sphere' },
    { t: 7.6, kind: 'tick' },
    { t: 9.4, kind: 'hit', label: 'transported vector returns rotated' },
    { t: 9.5, kind: 'sparkle' },
  ],

  init(ctx) {
    const { scene } = ctx;
    ctx.background(palette.void);
    this.bd = kit.backdrop(ctx, { seed: 23, a: 0x060a2c, b: 0x2a1060, c: 0x0a3050, intensity: 0.34 }); scene.add(this.bd);
    this.stars = kit.starfield(ctx, { count: 1900, seed: 33, intensity: 0.85 }); scene.add(this.stars);

    // ---------------------------------------------------------------- floor
    this.floorMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uAmp: { value: 1 }, uC0: { value: new THREE.Vector2(0, 0) }, uC1: { value: new THREE.Vector2(SPH.x, 0) }, uWave: { value: 0 }, uWaveA: { value: 1 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: floorFS,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.set(0, FLOOR_Y, 0); this.floor.renderOrder = -5; scene.add(this.floor);

    // ---------------------------------------------------------------- torus
    this.tgeo = parametricGeometry(TF, { nu: 120, nv: 52, ...TS.dom });
    this.tmat = kit.surfaceMaterial({ base: 0x0e1e66, curv: 0.10, kScale: 1 / 0.6, grid: [48, 18], gridW: 1.0, gridI: 0.4, gridCol: 0x4a86ff, rim: 0.85, rimCol: 0x5ee7ff, spec: 0.07, alpha: 0.9, emis: 0.0 });
    this.torus = new THREE.Mesh(this.tgeo, this.tmat); this.torus.renderOrder = 0; scene.add(this.torus);

    // ---------------------------------------------------------------- geodesics (REAL: RK4 with analytic Γ, cross-checked against geom.christoffel)
    const fr0 = frame(TF, U0, V0, 1e-3);
    this.K_P = fr0.K;
    const eu = vec.nrm(fr0.fu), ev = vec.nrm(fr0.fv);
    const P0 = fr0.p;
    const chk = (() => { const a = torusChris(0, 1.1), b = christoffel(TF, 0, 1.1); return Math.max(Math.abs(a.G211 - b.G211), Math.abs(a.G112 - b.G112)); })();
    const run = (psi, L) => {
      const dir = vec.add(vec.scl(eu, Math.cos(psi)), vec.scl(ev, Math.sin(psi)));
      const [du, dv] = uvVelocity(TF, U0, V0, dir);
      return geodesic(TF, U0, V0, du, dv, { steps: Math.round(L / DS), ds: DS, christoffelFn: torusChris });
    };
    const OFF = 0.024;
    const lift = (g) => g.pts.map((p, i) => { const n = tn(g.uv[i][0], g.uv[i][1]); return [p[0] + n[0] * OFF, p[1] + n[1] * OFF, p[2] + n[2] * OFF]; });
    const colFor = (psi) => {
      let a = ((psi % TAU) + TAU) % TAU; if (a > Math.PI) a = TAU - a; const k = a / Math.PI;
      const stops = [[0, palette.cyan], [0.3, 0x3b7dff], [0.55, palette.violet], [0.78, palette.magenta], [1, palette.ice]];
      let i = 0; while (i < stops.length - 2 && k > stops[i + 1][0]) i++;
      const [k0, c0] = stops[i], [k1, c1] = stops[i + 1];
      return new THREE.Color(c0).lerp(new THREE.Color(c1), clamp((k - k0) / (k1 - k0)));
    };
    this.fan = []; let drift = 0;
    for (let j = 0; j < N_FAN; j++) {
      const psi = ((j + 0.5) / N_FAN) * TAU, g = run(psi, L_FAN), P = lift(g);
      this.fan.push({ psi, g, P, col: colFor(psi) });
      // Clairaut: c = ρ² u̇ is constant along a geodesic (5-point stencil for u̇ from the RK4 samples)
      let c0 = null;
      for (let i = 2; i < g.uv.length - 2; i += 6) {
        const ud = (-g.uv[i + 2][0] + 8 * g.uv[i + 1][0] - 8 * g.uv[i - 1][0] + g.uv[i - 2][0]) / (12 * DS), rho = R0 + r0 * Math.cos(g.uv[i][1]);
        const c = rho * rho * ud; if (c0 === null) c0 = c; drift = Math.max(drift, Math.abs(c - c0) / Math.max(Math.abs(c0), 0.3));
      }
    }
    this.drift = drift; this.chk = chk;
    const gh = run(PSI_H, L_HERO); this.hero = { g: gh, P: lift(gh) };

    // step-major segment table: all 48 geodesics grow together with a single instanceCount
    const nSteps = Math.round(L_FAN / DS);
    this.fanSegs = makeSegs(ctx, { count: nSteps * N_FAN, ds: DS, order: 3 });
    for (let i = 0; i < nSteps; i++) for (let j = 0; j < N_FAN; j++) { const f = this.fan[j]; this.fanSegs.put(i * N_FAN + j, f.P[i], f.P[i + 1], i * DS, [f.col.r, f.col.g, f.col.b], j / N_FAN); }
    this.fanSegs.commit(0);
    const nH = Math.round(L_HERO / DS);
    this.heroSegs = makeSegs(ctx, { count: nH, ds: DS, order: 4 });
    for (let i = 0; i < nH; i++) this.heroSegs.put(i, this.hero.P[i], this.hero.P[i + 1], i * DS, [1, 1, 1], 0.5);
    this.heroSegs.commit(0);
    const ghostOf = (m) => { const gm = m.material.clone(); gm.depthTest = false; const g = new THREE.Mesh(m.geometry, gm); g.U = gm.uniforms; g.frustumCulled = false; g.renderOrder = 2; return g; };
    this.torusBox = new THREE.Box3(new THREE.Vector3(-R0 - r0 - 0.6, -r0 - 0.6, -R0 - r0 - 0.6), new THREE.Vector3(R0 + r0 + 0.6, r0 + 0.6, R0 + r0 + 0.6)); this.frus = new THREE.Frustum(); this.pvm = new THREE.Matrix4();
    this.heroGhost = ghostOf(this.heroSegs);              // x-ray pass for the photon only: a second full pass over the 48-ray fan doubled its cost for an invisible gain
    scene.add(this.heroGhost, this.fanSegs, this.heroSegs);

    // geodesic circle (wavefront through the 48 heads)
    this.wave = makeSegs(ctx, { count: N_FAN, ds: 0.01, order: 4, dynamic: true, depthTest: false });
    this.wave.commit(N_FAN); scene.add(this.wave);
    // heads
    this.heads = makePoints(ctx, { count: N_FAN + 1, order: 6 }); scene.add(this.heads);
    // P marker (core + halo) + vertex-style points
    this.pm = makePoints(ctx, { count: 3, order: 7 }); scene.add(this.pm);

    // ---------------------------------------------------------------- tangent ring / direction ticks at P
    const nrm = tn(U0, V0);
    this.Pw = P0; this.nP = nrm;
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...eu), new THREE.Vector3(...ev), new THREE.Vector3(...nrm));
    this.ringG = new THREE.Group(); this.ringG.position.set(P0[0] + nrm[0] * 0.03, P0[1] + nrm[1] * 0.03, P0[2] + nrm[2] * 0.03); this.ringG.quaternion.setFromRotationMatrix(basis); scene.add(this.ringG);
    const RR = 0.5, ring = []; for (let i = 0; i <= 96; i++) ring.push([RR * Math.cos((i / 96) * TAU), RR * Math.sin((i / 96) * TAU), 0]);
    this.ring = ctx.fatLine(ring, { color: palette.cyan, width: 2.2, intensity: 1.6, depthTest: false }); this.ring.renderOrder = 8; this.ringG.add(this.ring);
    this.shock = ctx.fatLine(ring, { color: palette.white, width: 2.0, intensity: 1.8, depthTest: false }); this.shock.renderOrder = 8; this.shock.visible = false; this.ringG.add(this.shock);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(RR * 1.0, 64), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 1 }, uT: { value: 0 }, uCol: { value: new THREE.Color(palette.cyan) } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy/0.5; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: discFS,
    }));
    this.disc.renderOrder = 1; this.ringG.add(this.disc);
    this.ticks = makeSegs(ctx, { count: N_FAN, ds: 0.0, order: 8, depthTest: false });
    for (let j = 0; j < N_FAN; j++) {
      const psi = this.fan[j].psi, d = vec.add(vec.scl(eu, Math.cos(psi)), vec.scl(ev, Math.sin(psi))), c = this.fan[j].col;
      const A = [0, 1, 2].map((i) => this.ringG.position.getComponent(i) + d[i] * RR * 1.06), B = [0, 1, 2].map((i) => this.ringG.position.getComponent(i) + d[i] * RR * 1.34);
      this.ticks.put(j, A, B, j / N_FAN, [c.r, c.g, c.b], j / N_FAN);
    }
    this.ticks.commit(N_FAN); scene.add(this.ticks);

    // ---------------------------------------------------------------- dust
    const rg = rng(91); this.dustN = 460; this.dust = makePoints(ctx, { count: this.dustN, order: 1, depthTest: true });
    this.dustBase = []; for (let i = 0; i < this.dustN; i++) this.dustBase.push({ p: [(rg() - 0.5) * 34 + 4.4, (rg() - 0.5) * 10, (rg() - 0.5) * 16], v: [(rg() - 0.5) * 0.12, 0.05 + rg() * 0.09, (rg() - 0.5) * 0.12], s: 3 + rg() * 5, b: 0.15 + rg() * 0.5, ph: rg() * TAU });
    scene.add(this.dust);

    // ---------------------------------------------------------------- sphere act
    this.seed = makePoints(ctx, { count: 2, order: 7, depthTest: true }); scene.add(this.seed);
    { const ringPts = []; for (let i = 0; i <= 96; i++) ringPts.push([Math.cos((i / 96) * TAU), 0, Math.sin((i / 96) * TAU)]);
      this.birthRing = ctx.fatLine(ringPts, { color: palette.cyan, width: 4, intensity: 3 }); this.birthRing.position.set(SPH.x, FLOOR_Y + 0.02, SPH.z); this.birthRing.visible = false; scene.add(this.birthRing); }
    this.sg = new THREE.Group(); this.sg.position.copy(SPH); this.sg.scale.setScalar(RS); scene.add(this.sg);
    const m = new THREE.Vector3(1, 1, 1).normalize();
    { // Two poses.  WIDE (A 50°, centroid ~5° off the axis): the whole octant loop sits on the visible cap (transport A→B→C→A is followed round).
      //            FOCUS (A 36° off the axis): B and C stay ≲ 65° off-axis (the visible cap ends at ≈ 74°), so no leg is ever seen edge-on, while the payoff at A is still near face-on.
      const cp = camPose(10), ce = Math.cos(cp.el);
      const c = new THREE.Vector3(cp.target[0] + cp.r * ce * Math.sin(cp.az), cp.target[1] + cp.r * Math.sin(cp.el), cp.target[2] + cp.r * ce * Math.cos(cp.az)).sub(SPH).normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(c).normalize(), up = c.clone().cross(right).normalize();
      const dirA = right.clone().multiplyScalar(0.92).addScaledVector(up, -0.22).normalize();
      const alpha = Math.acos(1 / Math.sqrt(3));
      const basis = (a, mm) => { const f2 = mm.clone().addScaledVector(a, -a.dot(mm)).normalize(); return new THREE.Matrix4().makeBasis(a, f2, a.clone().cross(f2)); };
      const Em = basis(new THREE.Vector3(1, 0, 0), m);
      const pose = (deg) => {
        const TH = (deg * Math.PI) / 180;
        const Aw = c.clone().multiplyScalar(Math.cos(TH)).addScaledVector(dirA, Math.sin(TH));
        const Mw = c.clone().multiplyScalar(Math.cos(alpha - TH)).addScaledVector(dirA, -Math.sin(alpha - TH));
        return new THREE.Quaternion().setFromRotationMatrix(basis(Aw, Mw).multiply(Em.clone().invert()));
      };
      this.q0 = pose(50); this.q1 = pose(36);
      this.sg.quaternion.copy(this.q0);
      this.viewDir = c;
    }
    this.sgeo = parametricGeometry(sphF, { nu: 112, nv: 64, u0: -Math.PI, u1: Math.PI, v0: 0, v1: Math.PI });
    { // orientation sanity: normals must point outward
      const p = this.sgeo.attributes.position.array, n = this.sgeo.attributes.normal.array; let s = 0; for (let i = 0; i < p.length; i += 3 * 97) s += p[i] * n[i] + p[i + 1] * n[i + 1] + p[i + 2] * n[i + 2];
      if (s < 0) for (let i = 0; i < n.length; i++) n[i] = -n[i];
    }
    this.smat = kit.surfaceMaterial({ base: 0x0e1e66, curv: 0.0, kScale: 0.62, grid: [36, 18], gridW: 1.0, gridI: 0.40, gridCol: 0x5a90ff, rim: 1.4, rimCol: 0x5ee7ff, spec: 0.04, alpha: 0.95, emis: 0.02 });
    this.sphere = new THREE.Mesh(this.sgeo, this.smat); this.sg.add(this.sphere);
    this.sgeoRef = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 8), new THREE.MeshBasicMaterial({ visible: false })); this.sg.add(this.sgeoRef);

    this.tr = buildTransport(); this.NP = this.tr.P.length;         // 361 samples
    const TR = this.tr;
    // octant patch (K-integral made visible)
    { const M = 30, pos = [], idx = [], map = new Map(); let c = 0;
      for (let i = 0; i <= M; i++) for (let j = 0; j <= M - i; j++) { const p = vec.nrm([i / M + 1e-6, j / M + 1e-6, (M - i - j) / M + 1e-6]); pos.push(p[0] * 1.008, p[1] * 1.008, p[2] * 1.008); map.set(i * 1000 + j, c++); }
      for (let i = 0; i < M; i++) for (let j = 0; j < M - i; j++) { idx.push(map.get(i * 1000 + j), map.get((i + 1) * 1000 + j), map.get(i * 1000 + j + 1)); if (i + j < M - 1) idx.push(map.get((i + 1) * 1000 + j), map.get((i + 1) * 1000 + j + 1), map.get(i * 1000 + j + 1)); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      this.patchMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uRev: { value: 0 }, uA: { value: 1 }, uT: { value: 0 }, uCol: { value: new THREE.Color(palette.gold) } }, vertexShader: patchVS, fragmentShader: patchFS });
      this.patchMat.extensions = { derivatives: true };
      this.patch = new THREE.Mesh(g, this.patchMat); this.patch.renderOrder = 2; this.sg.add(this.patch); }
    // legs of the loop (geodesics of the sphere), drawn with the transport parameter τ ∈ [0,3]
    const NPT = this.NP; this.legs = makeSegs(ctx, { count: NPT - 1, ds: 3 / (NPT - 1), order: 4 });
    for (let i = 0; i < NPT - 1; i++) { const a = vec.scl(TR.P[i], 1.014), b = vec.scl(TR.P[i + 1], 1.014); this.legs.put(i, a, b, (3 * i) / (NPT - 1), [CYAN.r, CYAN.g, CYAN.b], 0.3); }
    this.legs.commit(NPT - 1); this.legs.U.uHeadI.value = 5; this.legs.U.uHeadLen.value = 0.05; this.legs.U.uBase.value = 0.9; this.legs.U.uTailI.value = 1.2; this.legs.U.uTail.value = 0.35; this.legs.U.uCore.value = 2.6;
    this.sg.add(this.legs);
    // vertex dots + carrier
    this.vp = makePoints(ctx, { count: 4, order: 7 }); this.sg.add(this.vp);
    // arrows: live, ghosts each 45 samples (9 -> 7 interior ones), initial at A, final at A
    const arrowLen = 0.56;
    const place = (i) => { const p = vec.scl(TR.P[i], 1.03); return p; };
    this.live = kit.arrow(ctx, { color: palette.ice, width: 4.5, head: 0.08, intensity: 2.4 }); this.sg.add(this.live);
    this.ghosts = [];
    for (let i = 0; i <= NPT - 1; i += 45) {
      const kk = i / (NPT - 1), col = new THREE.Color(palette.ice).lerp(new THREE.Color(palette.magenta), smoothstep(0.35, 1.0, kk));
      const a = kit.arrow(ctx, { color: col.getHex(), width: 3.0, head: 0.06, intensity: 1.7 }); a.children[1].material.transparent = true; a.userData.cone = a.children[1];
      a.set(place(i), TR.V[i], arrowLen); a.visible = false; a.userData.k = kk; a.userData.p = TR.P[i]; this.sg.add(a); this.ghosts.push(a);
    }
    this.finalA = kit.arrow(ctx, { color: palette.magenta, width: 5.5, head: 0.09, intensity: 2.6 }); this.finalA.set(place(NPT - 1), TR.V[NPT - 1], arrowLen); this.finalA.visible = false; this.sg.add(this.finalA);
    this.initA = kit.arrow(ctx, { color: palette.white, width: 5.5, head: 0.09, intensity: 2.4 }); this.initA.set(place(0), TR.V[0], arrowLen); this.initA.visible = false; this.sg.add(this.initA);
    // rotation arc at A between initial and final (in the tangent plane at A)
    { const e1 = VB, e2 = VC, th0 = Math.atan2(vec.dot(TR.V[0], e2), vec.dot(TR.V[0], e1)), Ra = 0.44, pts = [];
      const th1 = th0 + TR.ang; for (let i = 0; i <= 48; i++) { const th = lerp(th0, th1, i / 48); pts.push(vec.add(vec.scl(VA, 1.03), vec.add(vec.scl(e1, Ra * Math.cos(th)), vec.scl(e2, Ra * Math.sin(th))))); }
      this.arc = ctx.fatLine(pts, { color: palette.gold, width: 4, intensity: 2.8 }); this.arc.renderOrder = 9; this.arcN = pts.length; this.sg.add(this.arc);
      const mid = pts[24]; this.arcMid = new THREE.Vector3(...mid); }
    // right-angle marks
    this.rights = [];
    for (let k = 0; k < 3; k++) {
      const V = LEGS[k][1], Vn = LEGS[(k + 1) % 3][1], Vp = LEGS[k][0];
      const d1 = vec.nrm(vec.sub(Vp, vec.scl(V, vec.dot(Vp, V)))), d2 = vec.nrm(vec.sub(Vn, vec.scl(V, vec.dot(Vn, V)))), a = 0.16;
      const q = (x) => vec.scl(vec.nrm(vec.add(V, x)), 1.03);
      const l = ctx.fatLine([q(vec.scl(d1, a)), q(vec.add(vec.scl(d1, a), vec.scl(d2, a))), q(vec.scl(d2, a))], { color: palette.gold, width: 2.6, intensity: 2.4 });
      l.renderOrder = 9; l.visible = false; this.sg.add(l); this.rights.push(l);
    }
    this.tmpV = new THREE.Vector3();
    // readout numbers
    this.n = { ang: (TR.ang * 180) / Math.PI, area: TR.Ksum, sumAng: TR.interior.reduce((a, b) => a + b, 0) * 180 / Math.PI };
  },

  update(t, ctx) {
    const { camera, ui, post } = ctx;
    const clamped = (x) => clamp(x, 0, 1);
    const cp = camPose(t);
    const shake = 0.0018;
    orbitCamera(camera, { target: cp.target, r: cp.r, az: cp.az + shake * Math.sin(t * 1.3), el: cp.el + shake * Math.sin(t * 0.9 + 1.0), roll: cp.roll });
    const camPos = camera.position;
    // Act I geometry is only drawn while the torus is inside the view frustum (after the truck to the sphere it is far off-screen: skip ~15k instanced quads + the 18k-tri torus)
    camera.updateMatrixWorld(); this.pvm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frus.setFromProjectionMatrix(this.pvm);
    const torusOn = this.frus.intersectsBox(this.torusBox);
    this.torus.visible = torusOn;

    // ------------------------------------------------------------------ environment
    kit.updateStars(this.stars, t, ctx.px); this.bd.rotation.y = 0.006 * t;
    this.tmat.uniforms.uTime.value = t; this.smat.uniforms.uTime.value = t;
    const sHd = sHero(t), sF = sFan(t);
    this.floorMat.uniforms.uT.value = t; this.floorMat.uniforms.uWave.value = t > T_HERO ? sF * 0.6 : 0; this.floorMat.uniforms.uWaveA.value = 1 - smoothstep(5.5, 6.3, t);
    this.floorMat.uniforms.uAmp.value = 0.85 * smoothstep(0.0, 1.5, t) + 0.3 * smoothstep(4.6, 5.2, t) * (1 - smoothstep(5.6, 7.0, t));
    const dustVis = 0.9;
    for (let i = 0; i < this.dustN; i++) {
      const d = this.dustBase[i], bx = 34, by = 10, bz = 16, cx = 4.4;
      const x = ((d.p[0] - cx + d.v[0] * t + bx * 50) % bx) - bx / 2 + cx, y = ((d.p[1] + d.v[1] * t + by * 50) % by) - by / 2, z = ((d.p[2] + d.v[2] * t + bz * 50) % bz) - bz / 2;
      const tw = 0.6 + 0.4 * Math.sin(t * 1.3 + d.ph);
      this.dust.put(i, [x, y, z], [0.55 * d.b * tw * dustVis, 0.8 * d.b * tw * dustVis, 1.4 * d.b * tw * dustVis], d.s * (0.8 + 0.4 * tw));
    }
    this.dust.commit(this.dustN); this.dust.material.uniforms.uPx.value = ctx.px;

    // ------------------------------------------------------------------ Act I: torus, P, ring, geodesics
    const fadeT = 1 - smoothstep(6.6, 8.4, t) * 0.55;                    // torus dims a bit once the camera leaves it
    this.tmat.uniforms.uAlpha.value = 0.93;
    const P = this.Pw, nP = this.nP;
    const pPulse = 0.5 + 0.5 * Math.sin(t * 5.2);
    const charge = seg(t, 3.4, 5.0, ease.inQuad);
    const launch = smoothstep(T_LAUNCH, T_HERO + 0.06, t);
    const ign = Math.exp(-Math.pow((t - 0.42) / 0.3, 2));                // the point ignites at 0.4 s
    const tk = Math.max(0, t - T_HERO);
    const bang = Math.exp(-tk / 0.2) * launch;
    const pcore = (1.0 + 0.8 * charge + 1.8 * ign) * (1 - 0.6 * launch) * (0.85 + 0.15 * pPulse) + 1.3 * bang;
    const pp = [P[0] + nP[0] * 0.03, P[1] + nP[1] * 0.03, P[2] + nP[2] * 0.03];
    this.pm.put(0, pp, [1.5 * pcore, 1.4 * pcore, 1.25 * pcore], 30 + 12 * charge + 22 * ign + 26 * bang);
    this.pm.put(1, pp, [0.35 * pcore, 0.6 * pcore, 1.0 * pcore], 150 + 80 * charge * (1 - launch) + 90 * ign + 45 * launch * Math.exp(-tk / 0.4));
    this.pm.put(2, pp, [0.5 * pcore * 0.7, 0.32 * pcore * 0.7, 0.12 * pcore * 0.7], 210 * (0.7 + 0.3 * charge) * (1 - 0.6 * launch) + 130 * ign + 100 * launch * Math.exp(-tk / 0.35));
    this.pm.commit(3); this.pm.material.uniforms.uPx.value = ctx.px * (t < 1 ? 0.6 + 0.4 * ease.outCubic(clamp(t / 1)) : 1);
    this.pm.material.uniforms.uOp.value = 0.85 * (1 - 0.65 * smoothstep(6.0, 7.4, t)) * (0.6 + 0.4 * seg(t, 0, 0.5));
    // exposure ramps up with the pull-back (the torus rim is dim at t=0 and ignites), plus a small shockwave ring when P ignites
    this.tmat.uniforms.uRim.value = lerp(0.42, 0.85, seg(t, 0.2, 2.6, ease.inOutCubic));
    { const sw = ease.outCubic(seg(t, 0.25, 1.35)); this.shock.scale.setScalar(0.25 + 2.6 * sw); this.shock.material.opacity = 0.9 * (1 - sw) * seg(t, 0.25, 0.4); this.shock.visible = t > 0.25 && t < 1.4; }

    // ring + disc + ticks
    const ringA = (1 - launch) + launch * (1 - smoothstep(T_HERO + 0.05, T_HERO + 0.55, t));
    this.ringG.visible = ringA > 0.01;
    const ringS = 1 + 3.2 * ease.outQuart(clamp((t - T_HERO) / 0.75));
    this.ringG.scale.setScalar(ringS);
    this.ring.material.opacity = ringA * (0.55 + 0.45 * charge) * (0.5 + 0.5 * seg(t, 0, 0.6));
    this.disc.material.uniforms.uA.value = ringA * (0.7 + 0.6 * charge) * (0.5 + 0.5 * seg(t, 0, 0.6)); this.disc.material.uniforms.uT.value = t;
    const T = this.ticks.U; this.ticks.sync(t, ctx, 3.4);
    T.uS.value = seg(t, 0.9, 4.5, ease.inOutSine) * 1.05; T.uTail.value = 0.5; T.uHeadLen.value = 0.06; T.uBase.value = 0.35 + 1.4 * charge; T.uTailI.value = 0.6; T.uHeadI.value = 3.0; T.uOp.value = ringA * seg(t, 0.7, 1.4) * (1 - smoothstep(T_HERO + 0.1, T_HERO + 0.45, t));

    // hero geodesic (the first photon) and the fan
    const dimTail = 1.0;
    const drive = (mesh, ghost, s, o) => {
      for (const m of ghost ? [mesh, ghost] : [mesh]) { const U = m.U || m.material.uniforms; U.uS.value = s; U.uT.value = t; U.uRes.value.set(ctx.W, ctx.H); U.uWidth.value = o.w * ctx.px; U.uTail.value = o.tail; U.uHeadLen.value = o.head; U.uBase.value = o.base; U.uTailI.value = o.tailI; U.uHeadI.value = o.headI; U.uPulse.value = o.pulse; U.uCore.value = o.core; }
      mesh.U.uOp.value = o.op; if (ghost) ghost.U.uOp.value = o.op * 0.10 * (1 - smoothstep(6.0, 6.8, t));      // x-ray pass (photon only): faint, gone by t ≈ 6.8
    };
    const fanFade = 1 - 0.30 * smoothstep(7.0, 9.5, t);
    const pulseAmt = 1.8 * smoothstep(5.6, 7.0, t);
    drive(this.fanSegs, null, sF, { w: 4.0, tail: 2.0, head: 0.25, base: 0.75, tailI: 2.4, headI: 6.0, pulse: pulseAmt, core: 3.2, op: fanFade * launch });
    drive(this.heroSegs, this.heroGhost, sHd, { w: 4.6, tail: 2.4, head: 0.28, base: 0.55, tailI: 1.4, headI: 5.0, pulse: pulseAmt * 0.6, core: 3.0, op: (0.9 + 0.1 * launch) * seg(t, 1.0, 1.15) });
    this.fanSegs.geometry.instanceCount = Math.min(Math.round(L_FAN / DS) * N_FAN, (Math.floor(sF / DS) + 2) * N_FAN);
    this.heroSegs.geometry.instanceCount = Math.min(Math.round(L_HERO / DS), Math.floor(sHd / DS) + 2);
    const ghostOn = t < 6.85;
    this.fanSegs.visible = torusOn && t >= T_LAUNCH - 0.01;
    this.heroSegs.visible = torusOn && t >= 1.0; this.heroGhost.visible = this.heroSegs.visible && ghostOn;

    // heads & wavefront
    const at = (arr, s) => { const f = clamp(s / DS, 0, arr.length - 1.001), i = Math.floor(f), k = f - i, a = arr[i], b = arr[i + 1]; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; };
    const facing = (p) => { const rho = Math.hypot(p[0], p[2]) || 1, cx = (p[0] / rho) * R0, cz = (p[2] / rho) * R0; const n = [p[0] - cx, p[1], p[2] - cz]; const nl = Math.hypot(n[0], n[1], n[2]) || 1; const vv = [camPos.x - p[0], camPos.y - p[1], camPos.z - p[2]]; const vl = Math.hypot(vv[0], vv[1], vv[2]) || 1; return smoothstep(-0.12, 0.3, (n[0] * vv[0] + n[1] * vv[1] + n[2] * vv[2]) / (nl * vl)); };
    let nh = 0; const headAmp = 1 - smoothstep(9.0, 10.8, t) * 0.5;
    const headsOn = t >= T_LAUNCH && torusOn;
    if (headsOn) for (let j = 0; j < N_FAN; j++) {
      const f = this.fan[j], p = at(f.P, sF), fc = 0.25 + 0.75 * facing(p);
      const sz = 26 * (0.6 + 0.4 * Math.exp(-(sF) / 8)); const b = 2.6 * fc * headAmp * (0.55 + 0.45 * Math.exp(-sF / 6));
      this.heads.put(nh++, p, [f.col.r * b, f.col.g * b, f.col.b * b], sz);
    }
    if (t >= 1.0 && torusOn) { const p = at(this.hero.P, sHd), fc = 0.3 + 0.7 * facing(p), b = 4.2 * fc * seg(t, 1.0, 1.25); this.heads.put(nh++, p, [b, b * 1.0, b * 1.05], 36 + 14 * Math.exp(-tk / 0.3) * launch); }
    this.heads.commit(nh); this.heads.material.uniforms.uPx.value = ctx.px;
    // geodesic circle
    this.wave.visible = torusOn;
    { const WU = this.wave.U; this.wave.sync(t, ctx, 3.0);
      WU.uS.value = 1e3; WU.uBase.value = 1.0; WU.uTailI.value = 0; WU.uHeadI.value = 0; WU.uPulse.value = 0; WU.uCore.value = 3.0;
      const pts = this.fan.map((f) => at(f.P, sF));
      for (let j = 0; j < N_FAN; j++) { const c = this.fan[j].col; this.wave.put(j, pts[j], pts[(j + 1) % N_FAN], 0, [0.55 + 0.45 * c.r, 0.75 + 0.25 * c.g, 1.0], 0); }
      this.wave.commit(N_FAN);
      WU.uOp.value = launch * 2.2 * Math.exp(-sF / 2.2) * (1 - smoothstep(T_HERO + 3.0, T_HERO + 4.5, t)) * (sF > 0.05 ? 1 : 0);
    }

    // ------------------------------------------------------------------ Act II: sphere
    const birth = seg(t, 6.9, 8.5, ease.outCubic), bA = seg(t, 6.9, 7.7, ease.outCubic);
    this.sg.scale.setScalar(Math.max(0.001, RS * birth));
    this.smat.uniforms.uAlpha.value = 0.95 * bA; this.sphere.visible = bA > 0.001;
    this.sg.visible = t > 6.0;
    this.sg.quaternion.slerpQuaternions(this.q0, this.q1, ease.inOutCubic(seg(t, 8.4, 9.5)));
    { // the seed of light the sphere grows from (mirrors P)
      const g = Math.exp(-Math.pow((t - 6.95) / 0.42, 2)) * seg(t, 6.2, 6.8) * (1 - smoothstep(7.15, 7.6, t)), pos = [SPH.x, SPH.y, SPH.z];
      this.seed.put(0, pos, [2.4 * g, 2.3 * g, 2.1 * g], 34 + 70 * g); this.seed.put(1, pos, [0.4 * g, 0.7 * g, 1.4 * g], 200 + 260 * g); this.seed.commit(2); this.seed.material.uniforms.uPx.value = ctx.px;
      const rr = ease.outQuart(clamp((t - 7.0) / 1.6)); this.birthRing.scale.setScalar(Math.max(0.001, 1 + 9 * rr)); this.birthRing.material.opacity = 0.9 * (1 - rr) * seg(t, 7.0, 7.1); this.birthRing.visible = t > 7.0 && rr < 0.999; }
    const tau = 3 * seg(t, 7.55, 8.95, ease.inOutSine);                     // transport progress 0..3 (A→B→C→A)
    const NPT = this.NP;
    const sweep = seg(t, 9.05, 9.95, ease.inOutCubic);                     // one clock for patch, arc and counter: swept angle α, ∬K dA = α
    this.patchMat.uniforms.uRev.value = 1.08 * sweep; this.patchMat.uniforms.uT.value = t;
    this.patchMat.uniforms.uA.value = 1.0; this.patch.visible = sweep > 0.001;
    const L = this.legs.U; this.legs.sync(t, ctx, 4.2); L.uS.value = tau + 0.001; L.uT.value = t; L.uOp.value = seg(t, 7.35, 7.75) * 1.0; L.uPulse.value = 0.0;
    this.legs.geometry.instanceCount = tau > 0.001 ? Math.min(NPT - 1, Math.floor((tau / 3) * (NPT - 1)) + 2) : 0;
    this.legs.visible = tau > 0.001;
    // vertex points and carrier
    const vW = (v) => vec.scl(v, 1.03);
    const vDot = (k) => Math.max(seg(t, 7.1 + 0.1 * k, 7.5 + 0.1 * k), 0);
    const vSz = 20 - 8 * smoothstep(7.6, 8.2, t);
    this.vp.put(0, vW(VA), [3, 2.4, 1.6], vSz * vDot(0)); this.vp.put(1, vW(VB), [1.2, 2.6, 3], vSz * vDot(1)); this.vp.put(2, vW(VC), [1.2, 2.6, 3], vSz * vDot(2));
    const ci = clamp((tau / 3) * (NPT - 1), 0, NPT - 1), c0 = Math.floor(ci), c1 = Math.min(NPT - 1, c0 + 1), ck = ci - c0;
    const carrier = vec.scl(vec.nrm(vec.add(vec.scl(this.tr.P[c0], 1 - ck), vec.scl(this.tr.P[c1], ck))), 1.03);
    const cw = tau > 0.001 && tau < 2.995 ? 1 : 0;
    this.vp.put(3, carrier, [3.6, 3.3, 3.0], 28 * cw); this.vp.commit(4); this.vp.material.uniforms.uPx.value = ctx.px;
    this.vp.material.uniforms.uOp.value = 0.9;
    // arrows
    // how squarely a unit-sphere point faces the (perspective) camera: cos of the angle between its outward normal and the ray to the eye
    const vFacing = (v, lo = -0.12, hi = 0.12) => { const wp = this.sg.localToWorld(this.tmpV.set(v[0], v[1], v[2])).clone(); const n = wp.clone().sub(this.sg.position).normalize(); return smoothstep(lo, hi, n.dot(camPos.clone().sub(wp).normalize())); };
    const Vc = vec.nrm(vec.add(vec.scl(this.tr.V[c0], 1 - ck), vec.scl(this.tr.V[c1], ck)));
    this.live.set(vec.scl(vec.nrm(vec.add(vec.scl(this.tr.P[c0], 1 - ck), vec.scl(this.tr.P[c1], ck))), 1.03), Vc, 0.56);
    const doneAll = tau > 2.985;
    this.live.visible = tau > 0.001 && !doneAll;
    const ghostDim = 1 - 0.55 * smoothstep(9.05, 9.5, t);
    this.ghosts.forEach((g, i) => {
      const kk = g.userData.k * 3, o = smoothstep(kk - 0.001, kk + 0.22, tau) * 0.8 * ghostDim * vFacing(g.userData.p, 0.3, 0.5);      // only ghosts that face the camera (never edge-on cones)
      g.visible = tau > 0.001 && i !== 0 && i !== this.ghosts.length - 1 && o > 0.01;
      g.children[0].material.opacity = o; g.userData.cone.material.opacity = o;
    });
    this.ghosts[0].visible = false; this.ghosts[this.ghosts.length - 1].visible = false;
    this.initA.visible = t > 7.45; this.finalA.visible = doneAll;
    // arc: grows with the sweep, so the gold arc = the fan angle = the rotation of the vector
    this.arc.visible = sweep > 0.001; this.arc.geometry.instanceCount = Math.max(1, Math.floor(sweep * (this.arcN - 1)));
    this.rights.forEach((l, k) => { l.visible = t > 8.2 + 0.3 * k; });

    // ------------------------------------------------------------------ post
    const tau5 = Math.max(0, t - T_HERO);
    const hit = Math.exp(-tau5 / 0.5) * smoothstep(4.80, 5.0, t);
    post.bloom = 0.8 + 0.35 * charge + 0.8 * hit + 0.2 * Math.exp(-Math.pow((t - 0.45) / 0.25, 2)) + 0.15 * pulse(t, 9.2, 10.6, 0.15, 1.0);
    post.flash = 0.02 * smoothstep(4.80, 4.98, t) * (1 - smoothstep(4.98, 5.3, t));
    post.ca = 0.0016 + 0.005 * hit;
    post.streak = (0.14 + 0.35 * hit + 0.1 * charge) * (1 - smoothstep(7.6, 8.4, t));       // no anamorphic slash across the Act II diagram
    post.exposure = 1.0 + 0.08 * hit;

    // ------------------------------------------------------------------ overlay
    title(ui, t, { at: 2.3, hold: 2.0, zh: '测地线', en: 'Geodesics', kicker: 'CHAPTER 04', x: 170, y: 190, size: 150 });
    caption(ui, t, { at: 2.6, dur: 3.7, zh: '在弯曲的世界里，最“直”的路，叫测地线。', en: 'In a curved world, the straightest path is a geodesic.', key: 'c1' });
    caption(ui, t, { at: 6.9, dur: 3.8, zh: '沿闭合路径平行移动，方向却变了。', en: 'Carry a vector around a loop — it returns rotated.', key: 'c2' });
    kit.formula(ui, t, 'gf', String.raw`\ddot{x}^{k}+\Gamma^{k}_{ij}\,\dot{x}^{i}\dot{x}^{j}=0`, { at: 7.3, dur: 3.9, x: 1790, y: 150, size: 54, anchor: 'tr' });
    // torus readout (real numbers)
    const roT = pulse(t, 5.2, 7.1, 0.4, 0.6);
    if (roT > 0.002) {
      const dg = Math.ceil(this.drift * 1e6), bound = dg >= 10 ? `${dg / 10}×10⁻⁵` : `${dg}×10⁻⁶`;
      const lines = [`GEODESIC FAN · N = ${N_FAN}`, `arclength s = ${sF.toFixed(2)}`, `K(P) = ${this.K_P >= 0 ? '+' : ''}${this.K_P.toFixed(3)}`, `Clairaut ρ²u̇ = const, Δ ≤ ${bound}`];
      ui.text('ro1', lines.join('<br>'), { x: 176, y: 684, anchor: 'tl', size: 24, font: 'mono', color: '#ffd98a', opacity: roT, lh: 1.5, track: 0.06, align: 'left', glow: { r: 12, color: '#02030a' }, reveal: seg(t, 5.2, 5.9, ease.linear), revealMode: 'mask' });
    }
    // sphere readout: the counter runs on the same clock as the sweep
    const roS = pulse(t, 8.4, 11.6, 0.8, 0.9);
    const screenOf = (v, out = 0) => { const w = this.sg.localToWorld(this.tmpV.set(v[0] * (1 + out), v[1] * (1 + out), v[2] * (1 + out))).clone().project(camera); return [(w.x * 0.5 + 0.5) * 1920, (1 - (w.y * 0.5 + 0.5)) * 1080]; };
    if (roS > 0.002) {
      const holo = Math.min(1, 1.08 * sweep);
      const dth = this.n.ang * holo;
      ui.text('ro2', `<span style="font-size:38px;color:#ffe3a0">Δθ = ${dth.toFixed(1)}°</span><br><span style="font-size:24px;color:#ffe3a0">= ∬K dA = ${(this.n.area * holo).toFixed(4)} rad</span><br>loop A→B→C→A · length 3·π/2 = ${(3 * Math.PI / 2).toFixed(3)}<br>angle sum Σ∠ = ${this.n.sumAng.toFixed(1)}° = 180° + 90°`, { x: 1790, y: 620, anchor: 'tr', size: 22, font: 'mono', color: '#c4e2ff', opacity: roS, lh: 1.65, track: 0.05, align: 'right', reveal: seg(t, 8.4, 9.3, ease.linear), revealMode: 'mask' });
      const sp = (() => { const w = this.sg.localToWorld(this.tmpV.copy(this.arcMid)).clone().project(camera); return [(w.x * 0.5 + 0.5) * 1920, (1 - (w.y * 0.5 + 0.5)) * 1080]; })();
      if (sweep > 0.02) ui.line('ld', sp[0] + 16, sp[1] - 4, 1524, 652, { stroke: '#ffc861', width: 1.6, opacity: 0.7 * roS * Math.min(1, sweep * 3), glow: 6, progress: Math.min(1, sweep * 1.6) });      // ends at the left edge of the Δθ readout
    }
    // vertex labels
    [['A', VA], ['B', VB], ['C', VC]].forEach(([nm, v], k) => {
      const o = seg(t, 7.3 + 0.12 * k, 7.8 + 0.12 * k) * pulse(t, 7.3, 11.6, 0.1, 0.9) * vFacing(v);
      if (o < 0.01) return;
      const [sx, sy] = screenOf(v, 0.2), x = clamp(sx, 110, 1810), y = clamp(sy, 130, 980);       // never under the film chrome (brand / timecode) or outside the safe area
      ui.text('vl' + nm, nm, { x, y, anchor: 'cc', size: 40, font: 'en', italic: true, weight: 600, color: '#f4f8ff', glow: 10, opacity: o });
    });
  },
};

/** kit.caption with a larger, brighter English line (this scene is caption-driven). */
function caption(ui, t, { at, dur = 3.0, zh, en = '', key = 'cap', y = 918, size = 44 }) {
  const v = pulse(t, at, at + dur, 0.55, 0.55);
  if (v <= 0.001) return 0;
  ui.text(key + 'z', zh, { x: 960, y, anchor: 'bc', size, weight: 600, color: '#f4f8ff', glow: 14, opacity: v, reveal: seg(t, at, at + 0.9, ease.linear), spread: 0.7, track: 0.14 });
  if (en) ui.text(key + 'e', en, { x: 960, y: y + 12, anchor: 'tc', size: 27, font: 'en', italic: true, weight: 500, color: '#d6ebff', opacity: v * 0.95, track: 0.14, reveal: seg(t, at + 0.3, at + 1.1, ease.linear), revealMode: 'mask' });
  return v;
}
