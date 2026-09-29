// s00_curve — 曲线 / Curves.  0–10 s, hero 6.0.
// A point of light ignites, flies, and its comet trail draws a closed trefoil knot; the Frenet frame + osculating circle ride the head
// (real κ, τ from geom.frenet), at 6.0 the curve closes and a gold pulse runs through the knot while the camera pulls back and the title lands.
// Everything is a pure function of t: the curve tables are precomputed in init(), all animation is uniforms / index lookups.
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, smoothstep, palette, orbitCamera, rng, TAU, css } from '../util.js';
import { frenet } from '../geom.js';
import * as kit from '../kit.js';

// ------------------------------------------------------------------------------------------------------------------ the curve
// trefoil, phase-shifted so the ignition point sits on a lobe tip; scaled so the whole knot is ~2.3 units across
// (3,2) torus knot = a trefoil that lies on a torus (R=2, r=1): 3-fold symmetric, smooth curvature kappa in [0.456,0.792] and torsion tau in [-0.808,0.390] (tau changes sign).
const KS = 0.8, U0 = 0, KR = 2.0, Kr = 1.0;
const R = (t) => { const u = t + U0, c = KR + Kr * Math.cos(2 * u); return [KS * c * Math.cos(3 * u), KS * Kr * Math.sin(2 * u), KS * c * Math.sin(3 * u)]; };
const NS = 1600;                                   // uniform-arclength samples
const ECHO = [ { lam: 1.42, ry: 0.55, rx: 0.35, w: 0.9 }, { lam: 1.95, ry: 1.25, rx: -0.5, w: -0.7 }, { lam: 2.6, ry: 2.1, rx: 0.75, w: 0.5 } ];
const HEAD_T0 = 1.5, HEAD_T1 = 6.0, T_IGNITE = 0.6, T_HERO = 6.0;

// ------------------------------------------------------------------------------------------------------------------ helpers
/** Hermite/Catmull-Rom keyframes [[t,v],...] -> smooth, C1, pure function of t. */
function kf(t, K) {
  const n = K.length; if (t <= K[0][0]) return K[0][1]; if (t >= K[n - 1][0]) return K[n - 1][1];
  let i = 0; while (i < n - 2 && t >= K[i + 1][0]) i++;
  const [t0, v0] = K[i], [t1, v1] = K[i + 1], dt = t1 - t0, h = (t - t0) / dt;
  const m0 = i > 0 ? (v1 - K[i - 1][1]) / (t1 - K[i - 1][0]) : (v1 - v0) / dt;
  const m1 = i < n - 2 ? (K[i + 2][1] - v0) / (K[i + 2][0] - t0) : (v1 - v0) / dt;
  const h2 = h * h, h3 = h2 * h;
  return (2 * h3 - 3 * h2 + 1) * v0 + (h3 - 2 * h2 + h) * dt * m0 + (-2 * h3 + 3 * h2) * v1 + (h3 - h2) * dt * m1;
}

/** Screen-space-width ribbon (many strips in one draw call). Custom shader = full control over comet / pulse / depth fade. */
function makeRibbon(strips) {
  const total = strips.reduce((a, s) => a + s.n, 0), V = total * 2;
  const P = new Float32Array(total * 3), pos = new Float32Array(V * 3), prv = new Float32Array(V * 3), nxt = new Float32Array(V * 3);
  const side = new Float32Array(V), sArr = new Float32Array(V), aA = new Float32Array(V).fill(1);
  const idx = []; const off = []; let o = 0;
  for (const s of strips) {
    off.push(o);
    for (let i = 0; i < s.n; i++) { const v = (o + i) * 2; side[v] = -1; side[v + 1] = 1; sArr[v] = sArr[v + 1] = i / (s.n - 1); }
    for (let i = 0; i < s.n - 1; i++) { const a = (o + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    o += s.n;
  }
  const geo = new THREE.BufferGeometry();
  const attrs = { position: pos, aPrev: prv, aNext: nxt, aSide: side, aS: sArr, aA };
  const dyn = {};
  for (const [k, arr] of Object.entries(attrs)) { const a = new THREE.BufferAttribute(arr, k === 'aSide' || k === 'aS' || k === 'aA' ? 1 : 3); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); dyn[k] = a; }
  geo.setIndex(idx);
  const rb = { geo, P, strips, off, total, dyn, aA };
  rb.commit = () => {
    for (let k = 0; k < strips.length; k++) {
      const { n, closed } = strips[k], b = off[k];
      for (let i = 0; i < n; i++) {
        const ip = i > 0 ? i - 1 : (closed ? n - 2 : 0), inx = i < n - 1 ? i + 1 : (closed ? 1 : n - 1);
        const c = (b + i) * 3, p = (b + ip) * 3, q = (b + inx) * 3;
        for (let j = 0; j < 2; j++) { const v = ((b + i) * 2 + j) * 3; for (let d = 0; d < 3; d++) { pos[v + d] = P[c + d]; prv[v + d] = P[p + d]; nxt[v + d] = P[q + d]; } }
      }
    }
    dyn.position.needsUpdate = dyn.aPrev.needsUpdate = dyn.aNext.needsUpdate = true;
  };
  rb.setAlpha = (k, a) => { const b = off[k] * 2, e = b + strips[k].n * 2; for (let i = b; i < e; i++) aA[i] = a; dyn.aA.needsUpdate = true; };
  return rb;
}

const RIBBON_VS = /* glsl */ `
  attribute vec3 aPrev, aNext; attribute float aSide, aS, aA; uniform vec2 uRes; uniform float uWidth;
  varying float vSide, vS, vDepth, vA;
  void main(){
    mat4 mvp = projectionMatrix*modelViewMatrix;
    vec4 c = mvp*vec4(position,1.), p = mvp*vec4(aPrev,1.), n = mvp*vec4(aNext,1.);
    vec2 hr = uRes*0.5; vec2 sc = c.xy/c.w*hr, sp = p.xy/p.w*hr, sn = n.xy/n.w*hr;
    vec2 d = (sc-sp)+(sn-sc); float dl = length(d); d = dl>1e-4 ? d/dl : vec2(1.,0.);
    vec2 nr = vec2(-d.y, d.x);
    vec2 s2 = sc + nr*aSide*uWidth*0.5;
    gl_Position = vec4(s2/hr*c.w, c.z, c.w);
    vSide = aSide; vS = aS; vA = aA; vDepth = -(modelViewMatrix*vec4(position,1.)).z;
  }`;
const RIBBON_FS = /* glsl */ `
  uniform vec3 uCol0, uCol1; uniform float uInt, uHalo, uBase, uComet, uHead, uTail, uDrawn, uPulseA, uPulseB, uPulseW, uPulseI, uT, uNear, uFar, uAlpha, uEdge, uShimmer, uPhase, uHueRate;
  varying float vSide, vS, vDepth, vA;
  void main(){
    float r = abs(vSide);
    float core = exp(-r*r*15.0), halo = exp(-r*3.4)*(1.0-r*r);
    float d = uHead - vS; d -= floor(d); float comet = exp(-d/uTail);
    float drawn = smoothstep(uDrawn, uDrawn-0.006, vS);
    float sh = 1.0 + uShimmer*sin(vS*6.2831853*7.0 - uT*1.7 + uPhase);
    float wa = (vS-uPulseA)/uPulseW, wb = (vS-uPulseB)/uPulseW;
    float pw = (exp(-wa*wa)+exp(-wb*wb))*uPulseI;
    float dep = mix(1.4, 0.25, smoothstep(uNear, uFar, vDepth));
    float edge = mix(1.0, smoothstep(0.0,0.2,vS)*smoothstep(1.0,0.8,vS), uEdge);
    vec3 base = mix(uCol0, uCol1, 0.5+0.5*cos(vS*6.2831853*uHueRate + uPhase));
    float prof = core*uInt + halo*uHalo;
    vec3 col = base*prof*uBase*sh*drawn*dep*edge;
    col += mix(base, vec3(1.0,0.97,0.9), 0.75)*(core*uInt*1.6 + halo*uHalo*1.4)*uComet*comet*drawn*dep;
    col += vec3(1.0,0.80,0.42)*(core*uInt*1.7 + halo*uHalo*2.4)*pw*drawn*dep + vec3(1.0,0.95,0.85)*core*pw*1.2*drawn;
    gl_FragColor = vec4(col*uAlpha*vA, 1.0);
  }`;
function ribbonMaterial(o = {}) {
  const U = (v) => ({ value: v });
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {
      uRes: U(new THREE.Vector2(1920, 1080)), uWidth: U(o.width ?? 8), uCol0: U(new THREE.Color(o.col0 ?? palette.cyan)), uCol1: U(new THREE.Color(o.col1 ?? palette.violet)),
      uInt: U(o.int ?? 2.2), uHalo: U(o.halo ?? 0.5), uBase: U(o.base ?? 1), uComet: U(o.comet ?? 0), uHead: U(0), uTail: U(o.tail ?? 0.05), uDrawn: U(1.05),
      uPulseA: U(-9), uPulseB: U(-9), uPulseW: U(0.05), uPulseI: U(0), uT: U(0), uNear: U(4), uFar: U(10), uAlpha: U(o.alpha ?? 1), uEdge: U(o.edge ?? 0),
      uShimmer: U(o.shimmer ?? 0.2), uPhase: U(o.phase ?? 0), uHueRate: U(o.hueRate ?? 3),
    },
    vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS,
  });
}

/** camera-facing billboard: disc glow (mode 0) or ring (mode 1). size = radius in 1080p px. */
function makeBillboard(ctx) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uCenter: { value: new THREE.Vector3() }, uRes: { value: new THREE.Vector2(1920, 1080) }, uSize: { value: 40 }, uCol: { value: new THREE.Color(1, 1, 1) }, uInt: { value: 1 }, uMode: { value: 0 }, uR: { value: 0.5 }, uTh: { value: 0.05 }, uSharp: { value: 30 } },
    vertexShader: `uniform vec3 uCenter; uniform vec2 uRes; uniform float uSize; varying vec2 vP;
      void main(){ vP = position.xy; vec4 c = projectionMatrix*viewMatrix*vec4(uCenter,1.); gl_Position = c + vec4(position.xy*uSize/(uRes*0.5)*c.w, 0., 0.); }`,
    fragmentShader: `varying vec2 vP; uniform vec3 uCol; uniform float uInt,uMode,uR,uTh,uSharp;
      void main(){ float r = length(vP); float g;
        if(uMode < 0.5){ g = exp(-r*r*uSharp) + exp(-r*5.5)*0.32 + exp(-r*1.8)*0.05; g *= smoothstep(1.0,0.75,r); }
        else { float dd = (r-uR)/uTh; g = exp(-dd*dd)*smoothstep(1.0,0.9,r); }
        gl_FragColor = vec4(uCol*uInt*g, 1.0); }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); mesh.frustumCulled = false; mesh.renderOrder = 5;
  mesh.set = (c, sizePx, col, inten, extra = {}) => {
    const u = m.uniforms; u.uCenter.value.set(c[0], c[1], c[2]); u.uSize.value = sizePx * ctx.px; u.uRes.value.set(ctx.W, ctx.H); u.uCol.value.set(col); u.uInt.value = inten;
    u.uMode.value = extra.mode ?? 0; u.uR.value = extra.r ?? 0.5; u.uTh.value = extra.th ?? 0.05; u.uSharp.value = extra.sharp ?? 30; mesh.visible = inten > 1e-3 && sizePx > 0.2;
  };
  return mesh;
}

/** GPU sparks: every particle is a pure function of (uT - birth). */
function makeSparks(ctx, list) {
  const n = list.length, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), info = new Float32Array(n * 4);
  list.forEach((p, i) => { pos.set(p.p, i * 3); vel.set(p.v, i * 3); info.set([p.tb, p.life, p.size, p.seed], i * 4); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aV', new THREE.BufferAttribute(vel, 3)); g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uPx: { value: ctx.px }, uInt: { value: 1 } },
    vertexShader: `attribute vec3 aV; attribute vec4 aInfo; uniform float uT,uPx,uInt; varying vec3 vC;
      void main(){ float age = uT-aInfo.x, life = aInfo.y;
        if(age<0.0||age>life){ gl_Position = vec4(2.,2.,2.,1.); gl_PointSize = 0.; vC = vec3(0.); return; }
        float k = age/life; float sd = aInfo.w;
        vec3 p = position + aV*(1.0-exp(-age*2.2))/2.2 + 0.07*vec3(sin(age*2.1+sd*40.), cos(age*1.7+sd*17.), sin(age*2.5+sd*9.))*k;
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
        gl_PointSize = max(1.5, aInfo.z*uPx*(1.0-0.55*k)*clamp(7.5/(-mv.z),0.5,2.0));
        vec3 base = mix(vec3(0.55,0.92,1.0), vec3(1.0,0.78,0.42), step(0.72, fract(sd*7.13)));
        vC = base*pow(1.0-k,1.7)*smoothstep(0.0,0.06,age)*uInt*(0.75+0.25*sin(age*25.+sd*90.)); }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5)*2.0; float a = smoothstep(1.0,0.0,d); a*=a; gl_FragColor = vec4(vC*a, 1.0); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 4; return pts;
}

/** slow parallax dust with depth-scaled size (bokeh-ish). */
function makeDust(ctx, count, seed, spread) {
  const r = rng(seed), pos = new Float32Array(count * 3), info = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - u * u), rad = spread * (0.3 + 0.7 * Math.cbrt(r()));
    pos.set([rad * s * Math.cos(a), rad * u * 0.75, rad * s * Math.sin(a)], i * 3);
    info.set([1.2 + 3.2 * Math.pow(r(), 3), r() * TAU, 0.15 + 0.5 * r(), 0.2 + 0.8 * r()], i * 4);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uPx: { value: ctx.px }, uInt: { value: 1 }, uFocus: { value: 8 } },
    vertexShader: `attribute vec4 aInfo; uniform float uT,uPx,uFocus; varying float vA; varying vec3 vC;
      void main(){ vec3 p = position + aInfo.z*vec3(sin(uT*0.17+aInfo.y*6.),cos(uT*0.13+aInfo.y*9.),sin(uT*0.11+aInfo.y*4.));
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv; float dz = -mv.z;
        float bok = abs(dz-uFocus)/uFocus;
        gl_PointSize = max(1.2, aInfo.x*uPx*(8.0/max(dz,1.0))*(1.0+bok*2.2));
        vA = aInfo.w*(0.55+0.45*sin(uT*1.3+aInfo.y*5.))/(1.0+bok*bok*5.0)*smoothstep(0.6,2.0,dz); vC = mix(vec3(0.5,0.75,1.0), vec3(0.85,0.6,1.0), fract(aInfo.y*3.7)); }`,
    fragmentShader: `varying float vA; varying vec3 vC; uniform float uInt; void main(){ float d = length(gl_PointCoord-0.5)*2.0; float a = smoothstep(1.0,0.0,d); gl_FragColor = vec4(vC*a*a*vA*uInt*1.4, 1.0); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 3; return pts;
}


// ------------------------------------------------------------------------------------------------------------------ typography (kit look, tuned for this scene)
/** Chapter title: same look as kit.chapterTitle, but a clean left-to-right mask wipe (no blurred per-glyph reveal) and the English line sits clear of the glyphs. */
function chapterTitle(ui, t, { at, hold, zh, en, kicker, x, y, size, key }) {
  const inn = seg(t, at, at + 0.25, ease.outCubic), out = seg(t, at + 0.7 + hold, at + 1.3 + hold, ease.inOutCubic), v = inn * (1 - out);
  if (v <= 0.001) return 0;
  const yEn = y + size * 1.2, enSize = Math.round(size * 0.27);
  ui.text(key + 'k', kicker, { x, y: y - size * 0.34, anchor: 'tl', size: 22, font: 'mono', track: 0.42, color: '#5ee7ff', opacity: v, reveal: seg(t, at, at + 0.3, ease.linear), revealMode: 'mask' });
  ui.text(key + 'z', zh, { x, y, anchor: 'tl', size, weight: 900, color: '#f4f8ff', glow: 18 * seg(t, at + 0.3, at + 0.9), opacity: v, reveal: seg(t, at, at + 0.35, ease.outQuad), revealMode: 'mask', track: 0.04 });
  ui.text(key + 'e', en, { x: x + 6, y: yEn, anchor: 'tl', size: enSize, font: 'en', italic: true, weight: 400, track: 0.22, color: '#cfeaff', opacity: v, reveal: seg(t, at + 0.15, at + 0.55, ease.linear), revealMode: 'mask' });
  ui.line(key + 'r', x, yEn + enSize * 1.45, x + 220, yEn + enSize * 1.45, { stroke: '#5ee7ff', width: 2.5, progress: seg(t, at + 0.2, at + 0.6), opacity: v * 0.9, glow: 8 });
  return v;
}
/** Greek letter in an explicit serif italic face (the CJK / display fonts fall back to a small bold Latin-looking glyph). */
const GR = (ch) => `<span style="font-family:'DejaVu Serif','Noto Serif SC',serif;font-style:italic;font-weight:400;font-size:1.08em;letter-spacing:0;padding:0 0.06em">${ch}</span>`;
/** Bottom-centre narration: Chinese line + a larger, fully opaque English line (kit.caption's 0.46x/0.85 is too faint at 1080p). */
function caption(ui, t, { at, dur, zh, en, key, y = 925, size = 50, track = 0.14 }) {
  const v = pulse(t, at, at + dur, 0.55, 0.55);
  if (v <= 0.001) return 0;
  ui.text(key + 'z', zh, { x: 960, y, anchor: 'bc', size, weight: 600, color: '#f4f8ff', glow: 14, opacity: v, reveal: seg(t, at, at + 0.8, ease.linear), revealMode: 'mask', track });
  ui.text(key + 'e', en, { x: 960, y: y + 10, anchor: 'tc', size: 30, font: 'en', italic: true, weight: 500, color: '#d6ebff', opacity: v, track: 0.12, glow: 6, reveal: seg(t, at + 0.3, at + 1.1, ease.linear), revealMode: 'mask' });
  return v;
}

/** Like kit.formula but with a soft fade-in instead of a hard mask wipe (a wipe leaves a bright clipped bar through the glyphs). */
function fadeFormula(ui, t, key, latex, { at, dur, x, y, size, anchor, glow, fi = 0.8, fo = 0.6 }) {
  const v = pulse(t, at, at + dur, fi, fo);
  if (v <= 0.001) return 0;
  ui.tex(key, latex, { x, y, size, anchor, color: '#f4f8ff', glow, display: true, opacity: v });
  return v;
}

// ------------------------------------------------------------------------------------------------------------------ scene
export default {
  beats: [
    { t: 0.6, kind: 'hit', label: 'ignition' }, { t: 1.5, kind: 'whoosh', label: 'point departs' }, { t: 3.0, kind: 'tick', label: 'frame rides' },
    { t: 4.6, kind: 'swell', label: 'closing in' }, { t: 6.0, kind: 'hit', label: 'curve closes, pulse runs' }, { t: 7.0, kind: 'sparkle', label: 'waves meet' }, { t: 8.5, kind: 'swell', label: 'rings sweep' },
  ],

  init(ctx) {
    const { scene } = ctx;
    ctx.background(palette.void);
    this.mats = [];

    // ---- exact curve tables, uniform in arclength ----
    const M = 8000, uu = new Float64Array(M + 1), cum = new Float64Array(M + 1);
    let prev = R(0);
    for (let i = 1; i <= M; i++) { uu[i] = (i / M) * TAU; const p = R(uu[i]); cum[i] = cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]); prev = p; }
    this.L = cum[M];
    const U = new Float64Array(NS + 1); { let k = 0; for (let j = 0; j <= NS; j++) { const target = (j / NS) * this.L; while (k < M - 1 && cum[k + 1] < target) k++; const f = (target - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-12); U[j] = uu[k] + f * (uu[k + 1] - uu[k]); } }
    this.U = U;
    const P = new Float32Array((NS + 1) * 3), FN = new Float32Array((NS + 1) * 3), FB = new Float32Array((NS + 1) * 3), FT = new Float32Array((NS + 1) * 3);
    this.kap = new Float32Array(NS + 1); this.tau = new Float32Array(NS + 1);
    for (let j = 0; j <= NS; j++) {
      const f = frenet(R, j === NS ? TAU : U[j], 4e-3); P.set(f.p, j * 3); FN.set(f.N, j * 3); FB.set(f.B, j * 3); FT.set(f.T, j * 3); this.kap[j] = f.kappa; this.tau[j] = f.tau;
    }
    P.set(P.slice(0, 3), NS * 3); FN.set(FN.slice(0, 3), NS * 3); FB.set(FB.slice(0, 3), NS * 3); FT.set(FT.slice(0, 3), NS * 3); this.kap[NS] = this.kap[0]; this.tau[NS] = this.tau[0];
    this.P = P; this.FN = FN; this.FB = FB; this.FT = FT;
    this.p0 = [P[0], P[1], P[2]];
    this.kmin = Math.min(...this.kap); this.kmax = Math.max(...this.kap); this.tmin = Math.min(...this.tau); this.tmax = Math.max(...this.tau);

    // ---- head motion s(t): slow departure, accelerating with wobble, arrives at s=1 exactly at HERO ----
    const NT = 900, tab = new Float64Array(NT + 1); { let acc = 0; const vf = (x) => (0.30 + 1.9 * Math.pow(x, 2.2) + 0.32 * Math.sin(TAU * 2.2 * x + 0.6) * (0.4 + 0.6 * x)) * (0.22 + 0.78 * smoothstep(0, 0.16, x));
      const raw = []; for (let i = 0; i <= NT; i++) raw.push(vf(i / NT)); let tot = 0; for (let i = 0; i < NT; i++) tot += 0.5 * (raw[i] + raw[i + 1]) / NT; this.v6 = raw[NT] / tot / (HEAD_T1 - HEAD_T0);
      for (let i = 1; i <= NT; i++) { acc += 0.5 * (raw[i - 1] + raw[i]) / NT / tot; tab[i] = acc; } tab[NT] = 1; }
    this.sTab = tab; this.NT = NT;

    // ---- knot ribbons ----
    const knotPts = NS + 1;
    this.knot = makeRibbon([{ n: knotPts, closed: true }]);
    this.knot.P.set(P.subarray(0, knotPts * 3)); this.knot.commit();
    const mkMesh = (rb, mat, order = 0) => { const m = new THREE.Mesh(rb.geo, mat); m.frustumCulled = false; m.renderOrder = order; this.mats.push(mat); scene.add(m); return m; };
    // core line + wide soft halo (both comet-aware)
    this.mCore = ribbonMaterial({ width: 7.5, int: 2.7, halo: 0.8, base: 0.55, comet: 1.0, tail: 0.055, shimmer: 0.3, hueRate: 3 });
    this.mHalo = ribbonMaterial({ width: 34, int: 0.12, halo: 0.42, base: 0.6, comet: 0.7, tail: 0.09, shimmer: 0.25, hueRate: 3 });
    this.knotCore = mkMesh(this.knot, this.mCore, 2); this.knotHalo = mkMesh(this.knot, this.mHalo, 1);
    // floor projection ("shadow"): same ribbon flattened onto a plane below
    this.floorY = -1.9;
    this.mShadow = ribbonMaterial({ width: 3.2, int: 1.0, halo: 0.3, base: 0.28, comet: 0.8, tail: 0.06, shimmer: 0.2, hueRate: 3, col0: palette.blue, col1: palette.violet });
    this.shadow = mkMesh(this.knot, this.mShadow, 0); this.shadow.scale.y = 0; this.shadow.position.y = this.floorY;

    // echoes: a family of similar curves (homothetic copies), faint and shimmering
    this.echoes = ECHO.map((e, i) => {
      const n = 520, rb = makeRibbon([{ n, closed: true }]);
      for (let j = 0; j < n; j++) { const p = R((j / (n - 1)) * TAU); rb.P.set([p[0] * e.lam, p[1] * e.lam, p[2] * e.lam], j * 3); }
      rb.commit();
      const mat = ribbonMaterial({ width: 2.6, int: 1.0, halo: 0.25, base: 0.0, comet: 0, shimmer: 0.6, phase: i * 1.7, col0: i === 1 ? palette.violet : palette.cyan, col1: i === 2 ? palette.blue : palette.violet, hueRate: 2 + i });
      mat.uniforms.uDrawn.value = 0;
      const mesh = mkMesh(rb, mat, 0); mesh.rotation.set(e.rx, e.ry, 0); return { mesh, mat, e };
    });

    // ---- Frenet frame (T gold, N cyan, B magenta) + osculating circle ----
    this.axT = kit.arrow(ctx, { color: palette.gold, width: 4, head: 0.11, intensity: 2.6 });
    this.axN = kit.arrow(ctx, { color: palette.cyan, width: 4, head: 0.11, intensity: 2.6 });
    this.axB = kit.arrow(ctx, { color: palette.magenta, width: 4, head: 0.11, intensity: 2.6 });
    scene.add(this.axT, this.axN, this.axB);
    this.NOSC = 121;
    this.osc = makeRibbon([{ n: this.NOSC, closed: false }, { n: 2, closed: false }]);
    this.mOsc = ribbonMaterial({ width: 2.8, int: 1.3, halo: 0.5, base: 1, col0: 0xeaf8ff, col1: 0xbfe4ff, hueRate: 1, edge: 0, shimmer: 0.15 });
    this.osc.setAlpha(1, 0.4); this.oscMesh = mkMesh(this.osc, this.mOsc, 3);

    // ---- sweep rings for the last 1.5 s (a hint of the next chapter) ----
    this.NR = 8; this.RN = 49;
    this.rings = makeRibbon(Array.from({ length: this.NR }, () => ({ n: this.RN, closed: true })));
    this.mRing = ribbonMaterial({ width: 4, int: 1.1, halo: 0.7, base: 1, col0: 0x9fe6ff, col1: 0x8fdcff, hueRate: 1, shimmer: 0.0 });
    this.ringMesh = mkMesh(this.rings, this.mRing, 2);

    // ---- billboards: head core / halo, osc centre, shock rings ----
    this.hCore = makeBillboard(ctx); this.hHalo = makeBillboard(ctx); this.cDot = makeBillboard(ctx);
    this.flare = makeBillboard(ctx); this.sw1 = makeBillboard(ctx); this.sw2 = makeBillboard(ctx); this.swH = makeBillboard(ctx); this.swH2 = makeBillboard(ctx); this.meetGlow = makeBillboard(ctx);
    scene.add(this.flare, this.hCore, this.hHalo, this.cDot, this.sw1, this.sw2, this.swH, this.swH2, this.meetGlow);

    // ---- sparks: ignition burst + trail sparks (born as the head passes) + hero burst (born as the pulse passes) ----
    const rr = rng(4242), L = [];
    const sph = () => { const u = rr() * 2 - 1, a = rr() * TAU, s = Math.sqrt(1 - u * u); return [s * Math.cos(a), u, s * Math.sin(a)]; };
    for (let i = 0; i < 150; i++) { const d = sph(), sp = 0.4 + 2.2 * Math.pow(rr(), 1.6); L.push({ p: this.p0, v: d.map((x) => x * sp), tb: T_IGNITE + rr() * 0.08, life: 1.0 + 1.6 * rr(), size: 3 + 5 * rr(), seed: rr() }); }
    for (let i = 0; i < 520; i++) {
      const s = rr(), j = Math.round(s * NS), d = sph(), sp = 0.08 + 0.4 * rr();
      const tb = this.tHead(s);
      L.push({ p: [P[j * 3], P[j * 3 + 1], P[j * 3 + 2]], v: [d[0] * sp - FT[j * 3] * 0.12, d[1] * sp - FT[j * 3 + 1] * 0.12, d[2] * sp - FT[j * 3 + 2] * 0.12], tb, life: 1.2 + 2.2 * rr(), size: 2.4 + 4 * Math.pow(rr(), 2), seed: rr() });
    }
    for (let i = 0; i < 640; i++) {
      const s = rr(), j = Math.round(s * NS), a = rr() * TAU, sp = 0.15 + 0.9 * Math.pow(rr(), 1.4), ca = Math.cos(a) * sp, sa = Math.sin(a) * sp;
      L.push({ p: [P[j * 3], P[j * 3 + 1], P[j * 3 + 2]], v: [FN[j * 3] * ca + FB[j * 3] * sa, FN[j * 3 + 1] * ca + FB[j * 3 + 1] * sa, FN[j * 3 + 2] * ca + FB[j * 3 + 2] * sa], tb: this.hero2t(s), life: 1.6 + 2.6 * rr(), size: 3 + 5 * Math.pow(rr(), 2), seed: rr() });
    }
    this.sparks = makeSparks(ctx, L); scene.add(this.sparks);

    // ---- atmosphere ----
    this.bd = kit.backdrop(ctx, { seed: 11, a: 0x070d2e, b: 0x24104a, c: 0x093552, intensity: 0.55 }); scene.add(this.bd);
    try { // soften the 512x256 bake so the nebula does not show blocky texels when magnified
      const tex = this.bd.material.map, src = tex.image, cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const g2 = cv.getContext('2d'); g2.filter = 'blur(2.2px)'; g2.drawImage(src, 0, 0); g2.drawImage(src, -src.width, 0); g2.drawImage(src, src.width, 0);
      const g1 = src.getContext('2d'); g1.clearRect(0, 0, src.width, src.height); g1.drawImage(cv, 0, 0); tex.needsUpdate = true;
    } catch (e) { /* cosmetic only */ }
    this.stars = kit.starfield(ctx, { count: 2200, radius: 90, seed: 21, size: 1.5, intensity: 0.85 }); scene.add(this.stars);
    this.near = kit.starfield(ctx, { count: 700, radius: 13, seed: 33, size: 2.2, intensity: 0.32, tint: [0.7, 0.8, 1.0] }); scene.add(this.near);
    this.dust = makeDust(ctx, 420, 55, 7.5); scene.add(this.dust);

    // polar-grid floor
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uA: { value: 0 }, uC: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec2 vP; uniform float uT,uA; uniform vec3 uC;
        void main(){ float r = length(vP); float a = atan(vP.y, vP.x);
          float rw = fwidth(r)*1.2; float rings = 1.0 - min(abs(fract(r*0.8-0.5)-0.5)/(0.8*rw+1e-4), 1.0);
          float sp = 48.0/6.2831853; float aw = fwidth(a*r)*1.2; float spokes = 1.0 - min(abs(fract(a*sp-0.5)-0.5)/(sp*aw/max(r,0.1)+1e-4), 1.0);
          float fade = exp(-r*0.16)*smoothstep(0.4,1.6,r);
          float ripple = 0.5+0.5*sin(r*1.4-uT*0.9);
          float l = (rings*(0.6+0.4*ripple) + spokes*0.05)*fade;
          gl_FragColor = vec4(vec3(0.16,0.42,1.0)*l*uA*0.75, 1.0); }`,
    }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = this.floorY - 0.001; this.floor.renderOrder = -5; scene.add(this.floor);

    this.tmpV = new THREE.Vector3();
  },

  // ---- helpers bound to tables ----
  sOfT(t) {                                   // head arclength fraction (unwrapped, >1 after the closure)
    if (t <= HEAD_T0) return 0;
    if (t < HEAD_T1) { const x = (t - HEAD_T0) / (HEAD_T1 - HEAD_T0) * this.NT, i = Math.min(this.NT - 1, Math.floor(x)); return lerp(this.sTab[i], this.sTab[i + 1], x - i); }
    const dt = t - HEAD_T1, vf = 0.085, tau = 0.85; return 1 + vf * dt + (this.v6 - vf) * tau * (1 - Math.exp(-dt / tau));
  },
  tHead(s) {                                  // inverse of sOfT on [0,1]
    if (s <= 0) return HEAD_T0; let lo = 0, hi = this.NT; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.sTab[m] < s) lo = m; else hi = m; }
    const f = (s - this.sTab[lo]) / Math.max(this.sTab[hi] - this.sTab[lo], 1e-9); return HEAD_T0 + (lo + f) / this.NT * (HEAD_T1 - HEAD_T0);
  },
  hero2t(s) { return T_HERO + 1.0 * (Math.min(s, 1 - s) / 0.5); },   // pulse arrival time at arclength s (matches wave centres in update)
  at(s, out = {}) {                           // interpolate tables at arclength fraction s (wrapped)
    s = s - Math.floor(s); const x = s * NS, j = Math.min(NS - 1, Math.floor(x)), f = x - j;
    const g = (A, k) => lerp(A[j * 3 + k], A[(j + 1) * 3 + k], f);
    out.p = [g(this.P, 0), g(this.P, 1), g(this.P, 2)]; out.N = [g(this.FN, 0), g(this.FN, 1), g(this.FN, 2)]; out.B = [g(this.FB, 0), g(this.FB, 1), g(this.FB, 2)]; out.T = [g(this.FT, 0), g(this.FT, 1), g(this.FT, 2)];
    out.u = lerp(this.U[j], this.U[j + 1], f); return out;
  },

  update(t, ctx) {
    const { camera, post, ui, px } = ctx;
    const tt = t, TAUV = TAU;
    const sRaw = this.sOfT(tt), sHead = sRaw - Math.floor(sRaw >= 1 ? sRaw : 0);       // wrapped
    const headS = tt < HEAD_T0 ? 0 : sHead;
    const drawn = sRaw >= 1 ? 1.05 : Math.max(sRaw, 0.0005);
    const hd = this.at(headS);
    const head = hd.p;

    // ------------------------------------------------------------------ camera
    const az = kf(tt, [[0, -2.75], [1.5, -2.5], [3.5, -2.0], [5.5, -1.2], [6.0, -0.9], [7.5, -0.25], [9.0, 0.3], [12, 0.95]]);
    const rad = kf(tt, [[0, 9.4], [1.5, 6.2], [3.0, 7.5], [5.0, 7.9], [5.6, 7.7], [6.0, 8.2], [6.9, 8.9], [8.0, 9.0], [9.6, 9.1], [12, 9.5]]);
    const el = kf(tt, [[0, 0.18], [1.5, 0.30], [3.5, 0.58], [5.5, 0.50], [6.6, 0.42], [8, 0.40], [12, 0.42]]);
    const lagS = this.at(this.sOfT(tt - 0.4)).p;
    const wF = seg(tt, 1.3, 3.0, ease.inOutCubic), wC = seg(tt, 5.0, 7.2, ease.inOutCubic);
    const follow = [0, 1, 2].map((k) => lerp(this.p0[k], (tt < HEAD_T0 ? this.p0[k] : lagS[k]) * 0.45, wF));
    const tgt = follow.map((v) => lerp(v, 0, wC));
    orbitCamera(camera, { target: tgt, r: rad, az, el });
    // reframing pan: knot to the right / slightly high once the title block appears
    const pan = seg(tt, 5.6, 8.2, ease.inOutCubic), lift = seg(tt, 1.2, 2.6, ease.inOutCubic), prePan = seg(tt, 2.0, 3.4, ease.inOutCubic);
    if (pan > 0 || lift > 0 || prePan > 0) {
      const m = camera.matrixWorld.elements, rt = [m[0], m[1], m[2]], up = [m[4], m[5], m[6]];
      const recentre = 1 - 0.85 * seg(tt, 9.2, 11.0, ease.inOutCubic), sx = -(0.7 * prePan + 0.3 * pan) * recentre, sy = lerp(-0.45 * lift, -0.3, pan);
      camera.position.set(camera.position.x + rt[0] * sx + up[0] * sy, camera.position.y + rt[1] * sx + up[1] * sy, camera.position.z + rt[2] * sx + up[2] * sy);
      camera.lookAt(tgt[0] + rt[0] * sx + up[0] * sy, tgt[1] + rt[1] * sx + up[1] * sy, tgt[2] + rt[2] * sx + up[2] * sy); camera.updateMatrixWorld();
    }
    const camD = camera.position.distanceTo(this.tmpV.set(tgt[0], tgt[1], tgt[2]));

    // ------------------------------------------------------------------ hero envelopes
    const th = tt - T_HERO, heroE = th >= 0 ? Math.exp(-th * 2.3) : 0, heroSharp = th >= 0 ? Math.exp(-th * 30) : 0;
    const ign = tt - T_IGNITE, ignE = ign >= 0 ? Math.exp(-ign * 2.6) : 0;
    const closing = seg(tt, 4.6, 5.98, ease.inCubic);                       // tension riser: knot glows up as the loop is about to close

    // ------------------------------------------------------------------ knot uniforms
    const pulseK = th >= 0 ? ease.inOutSine(clamp(th / 1.0)) : 0;
    const pA = th >= 0 ? 0.5 * pulseK : -9, pB = th >= 0 ? 1 - 0.5 * pulseK : -9, pI = th >= 0 ? (1 - smoothstep(0.85, 1.9, th)) : 0;
    const settle = 1 - 0.06 * seg(tt, 6.4, 9, ease.inOutSine);
    const bd = camD;
    const setKnotMat = (m, o) => {
      const u = m.uniforms; u.uT.value = tt; u.uHead.value = headS; u.uDrawn.value = drawn; u.uNear.value = bd - 2.4; u.uFar.value = bd + 3.0;
      u.uPulseA.value = pA; u.uPulseB.value = pB; u.uPulseW.value = o.pw; u.uPulseI.value = pI * o.pi; u.uBase.value = o.base * settle * (1 + 0.35 * closing + 0.6 * heroE);
      u.uComet.value = o.comet * (1 + 0.5 * closing) * (tt >= HEAD_T1 ? lerp(1, 0.45, seg(tt, 6.0, 8.0)) : 1);
    };
    setKnotMat(this.mCore, { pw: 0.055, pi: 2.4, base: 0.55, comet: 1.0 });
    setKnotMat(this.mHalo, { pw: 0.08, pi: 1.3, base: 0.6, comet: 0.7 });
    setKnotMat(this.mShadow, { pw: 0.04, pi: 0.4, base: 0.28, comet: 0.8 });
    this.mHalo.uniforms.uInt.value = 0.12; this.mShadow.uniforms.uNear.value = bd - 2.4;
    this.knotCore.visible = this.knotHalo.visible = tt > HEAD_T0 - 0.05; this.shadow.visible = this.knotCore.visible;
    this.floor.material.uniforms.uT.value = tt; this.floor.material.uniforms.uA.value = 0.5 * seg(tt, 1.2, 3.0) * (1 + 0.5 * heroE) * lerp(1, 0.5, seg(tt, 6.6, 7.6, ease.inOutSine));

    // echoes
    const echoIn = seg(tt, 6.35, 8.4, ease.inOutCubic);
    this.echoes.forEach(({ mesh, mat, e }, i) => {
      const u = mat.uniforms; u.uT.value = tt; u.uDrawn.value = 1.08 * seg(tt, 6.3 + i * 0.25, 7.6 + i * 0.3, ease.inOutCubic);
      u.uNear.value = bd - 3.4; u.uFar.value = bd + 5.2; u.uBase.value = 0.26 * (0.6 + 0.4 * echoIn) * (1 - 0.5 * seg(tt, 8.4, 9.6, ease.inOutSine)); u.uAlpha.value = 1;
      u.uPulseA.value = -9;
      mesh.rotation.y = e.ry + (tt - 6) * 0.05 * e.w; mesh.rotation.x = e.rx + 0.06 * Math.sin(tt * 0.4 + i);
      mesh.visible = tt > 6.25;
    });

    // ------------------------------------------------------------------ head glow / ignition
    const pilot = seg(tt, 0.1, 0.58, ease.inOutSine);                        // a tiny hot dot fades up before it ignites
    const swell = ease.outCubic(seg(ign, 0, 0.4));                           // ...then swells (no one-frame pop)
    const ignSize = 12 + (12 + 34 * ignE) * swell;
    const hotBoost = 1 + 0.5 * closing + 1.4 * heroSharp;
    const flick = 1 + 0.08 * Math.sin(tt * 47) + 0.05 * Math.sin(tt * 23 + 1.3);
    const coreI = tt < T_IGNITE ? 1.0 * pilot : lerp(1.0, (2.6 + 11 * ignE + 3 * Math.exp(-ign * 14)) * hotBoost * flick, ease.outQuad(seg(ign, 0, 0.16)));
    const coreS = tt < T_IGNITE ? 4 + 12 * pilot : ignSize * (1 + 0.35 * Math.exp(-ign * 9)) * (1 + 1.6 * heroSharp);
    this.hCore.set(head, coreS * 1.5, 0xfff4e8, coreI, { sharp: 11 });
    const haloI = tt < T_IGNITE ? 0.08 * pilot : (0.3 + 1.2 * ignE + 0.4 * closing + 0.8 * heroE) * flick;
    const haloS = tt < T_IGNITE ? 10 + 30 * pilot : lerp(40 + 220 * seg(ign, 0, 0.9, ease.outCubic), 105, seg(tt, 1.4, 2.2)) * (1 + 0.5 * heroE);
    this.hHalo.set(head, haloS, palette.cyan, haloI, { sharp: 6 });
    this.flare.set(this.p0, 220 * (0.4 + 0.6 * Math.exp(-th * 6)), 0xfff0d8, th >= 0 ? 0.4 * Math.exp(-th * 8) : 0, { sharp: 40 });
    // shock rings
    const r1 = seg(tt, T_IGNITE, T_IGNITE + 1.9, ease.outExpo), r2 = seg(tt, T_IGNITE + 0.14, T_IGNITE + 2.3, ease.outExpo);
    this.sw1.set(this.p0, 520, 0xcfeeff, tt >= T_IGNITE ? 0.6 * Math.pow(1 - seg(tt, T_IGNITE, T_IGNITE + 1.9, ease.linear), 2.6) : 0, { mode: 1, r: r1 * 0.96, th: 0.01 + 0.02 * r1 });
    this.sw2.set(this.p0, 520, palette.violet, tt >= T_IGNITE + 0.14 ? 0.5 * Math.pow(1 - seg(tt, T_IGNITE + 0.14, T_IGNITE + 2.3, ease.linear), 2.6) : 0, { mode: 1, r: r2 * 0.9, th: 0.012 + 0.022 * r2 });
    const rh = seg(tt, T_HERO, T_HERO + 1.5, ease.outExpo), rh2 = seg(tt, T_HERO + 0.12, T_HERO + 1.9, ease.outExpo);
    this.swH.set(this.p0, 1400, 0xffdca0, th >= 0 ? 0.5 * Math.pow(1 - seg(tt, T_HERO, T_HERO + 1.5, ease.linear), 2.0) : 0, { mode: 1, r: rh * 0.97, th: 0.006 + 0.007 * rh });
    this.swH2.set(this.p0, 1400, palette.cyan, th >= 0.12 ? 0.32 * Math.pow(1 - seg(tt, T_HERO + 0.12, T_HERO + 1.9, ease.linear), 2.0) : 0, { mode: 1, r: rh2 * 0.9, th: 0.007 + 0.008 * rh2 });
    // where the two pulse waves meet: a soft second flare
    const meetT = T_HERO + 1.0, mm = tt - meetT, mE = mm >= -0.06 ? Math.exp(-Math.abs(mm) * (mm < 0 ? 30 : 3.2)) : 0;
    this.meetGlow.set(this.at(0.5).p, 90 * (0.6 + mE), 0xfff4e0, 1.2 * mE, { sharp: 18 });

    // ------------------------------------------------------------------ Frenet frame + osculating circle at the head
    const fr = frenet(R, hd.u, 4e-3);
    const showFrame = seg(tt, 2.1, 2.9, ease.outCubic) * (1 - 0.45 * seg(tt, 6.6, 9.6)) * (1 - seg(tt, 10.2, 10.9));
    const AL = 0.8 * (0.4 + 0.6 * showFrame);
    this.axT.set(fr.p, fr.T, AL * showFrame); this.axN.set(fr.p, fr.N, AL * showFrame); this.axB.set(fr.p, fr.B, AL * showFrame);
    const rho = 1 / fr.kappa, alpha = Math.min(1.9, 3.6 / rho);          // partial arc: it must not read as the whole curve
    const oscOn = seg(tt, 2.4, 3.3, ease.outCubic) * (1 - seg(tt, 6.4, 8.6, ease.inOutSine) * 0.6) * (1 - seg(tt, 10.0, 10.8));
    if (oscOn > 0.003) {
      const c = [fr.p[0] + fr.N[0] * rho, fr.p[1] + fr.N[1] * rho, fr.p[2] + fr.N[2] * rho], Pp = this.osc.P;
      for (let i = 0; i < this.NOSC; i++) {
        const ph = lerp(-alpha, alpha, i / (this.NOSC - 1)), cn = -Math.cos(ph) * rho, st = Math.sin(ph) * rho;
        Pp[i * 3] = c[0] + fr.N[0] * cn + fr.T[0] * st; Pp[i * 3 + 1] = c[1] + fr.N[1] * cn + fr.T[1] * st; Pp[i * 3 + 2] = c[2] + fr.N[2] * cn + fr.T[2] * st;
      }
      { const b = this.NOSC * 3; Pp[b] = fr.p[0]; Pp[b + 1] = fr.p[1]; Pp[b + 2] = fr.p[2]; Pp[b + 3] = c[0]; Pp[b + 4] = c[1]; Pp[b + 5] = c[2]; }
      this.osc.strips[0].closed = false; this.osc.commit();
      const u = this.mOsc.uniforms; u.uEdge.value = 1; u.uAlpha.value = oscOn * 0.5 * (1 - closing * 0.3); u.uT.value = tt; u.uNear.value = bd - 2.5; u.uFar.value = bd + 3;
      u.uHead.value = (tt * 0.35) % 1; u.uComet.value = 0.9; u.uTail.value = 0.12; u.uPhase.value = 0;
      this.oscMesh.visible = true;
      this.cDot.set(c, 7, palette.ice, 1.4 * oscOn * (rho < 4.5 ? 1 : 0), { sharp: 8 });
    } else { this.oscMesh.visible = false; this.cDot.set(head, 0, 0xffffff, 0); }

    // ------------------------------------------------------------------ sweep rings (hint of chapter 02)
    const ringPhase = tt - 8.9;
    if (ringPhase > -0.05) {
      // meridian circles of the very torus the knot lives on (R=2, r=1): circles sweeping around the axis = a torus in the making
      const Pr = this.rings.P, ringFade = 1 - 0.55 * seg(tt, 10.2, 11.0, ease.inOutSine);
      for (let k = 0; k < this.NR; k++) {
        const born = 9.0 + 0.8 * (k / this.NR), a = seg(tt, born, born + 0.9, ease.outCubic);
        const th0 = (k / this.NR) * TAU + 0.22 * Math.max(0, tt - 8.9) * (0.6 + 0.4 * seg(tt, 8.9, 10, ease.inOutSine)) + 0.0;
        const cth = Math.cos(th0), sth = Math.sin(th0), rr2 = Kr * KS * (0.12 + 0.88 * a);
        for (let i = 0; i < this.RN; i++) {
          const ph = (i / (this.RN - 1)) * TAU, cc = KS * KR + rr2 * Math.cos(ph), o = (k * this.RN + i) * 3;
          Pr[o] = cc * cth; Pr[o + 1] = rr2 * Math.sin(ph); Pr[o + 2] = cc * sth;
        }
        this.rings.setAlpha(k, a * 0.14 * ringFade);
      }
      this.rings.commit(); this.ringMesh.visible = true;
      const u = this.mRing.uniforms; u.uNear.value = bd - 2.4; u.uFar.value = bd + 3.2; u.uT.value = tt;
    } else this.ringMesh.visible = false;

    // ------------------------------------------------------------------ atmosphere
    this.sparks.material.uniforms.uT.value = tt; this.sparks.material.uniforms.uInt.value = 1.35;
    this.dust.material.uniforms.uT.value = tt; this.dust.material.uniforms.uFocus.value = bd; this.dust.material.uniforms.uInt.value = 0.9 * (0.45 + 0.55 * seg(tt, 0.3, 1.5));
    kit.updateStars(this.stars, tt, px); kit.updateStars(this.near, tt, px);
    this.bd.rotation.y = 0.012 * tt; this.stars.rotation.y = -0.006 * tt; this.near.rotation.y = 0.01 * tt; this.near.rotation.x = 0.004 * tt;
    for (const m of this.mats) { m.uniforms.uRes.value.set(ctx.W, ctx.H); { const bw = (m.uniforms.uWidth.baseW ??= m.uniforms.uWidth.value); m.uniforms.uWidth.value = Math.max(bw * px, Math.min(bw, 3.4)); } }
    // shadow fades in with the floor
    this.mShadow.uniforms.uAlpha.value = seg(tt, 1.6, 3.2);

    // ------------------------------------------------------------------ post
    post.bloom = 0.6 + 0.5 * ignE + 0.3 * closing + 0.3 * heroE + 0.2 * mE;
    post.bloomScatter = 0.74;
    post.streak = 0.11 + 0.3 * ignE * seg(ign, 0, 0.2, ease.outQuad) + 0.1 * closing + 0.2 * heroE;
    post.flash = th >= 0 ? 0.004 * Math.exp(-th * 50) : 0;   // tiny: a linear-HDR flash lifts every black to grey, so the hit is carried by the core/streak/bloom instead
    post.ca = 0.0016 + 0.0005 * heroE + 0.001 * ignE; post.exposure = 1.0 + 0.05 * heroE + 0.22 * heroSharp;
    post.vignette = 0.55; post.streakColor = [0.5, 0.7, 1.0];
    post.contrast = 1.08;

    // ------------------------------------------------------------------ overlay
    // frame labels
    const proj = (p) => { this.tmpV.set(p[0], p[1], p[2]).project(camera); return [(this.tmpV.x * 0.5 + 0.5) * 1920, (1 - (this.tmpV.y * 0.5 + 0.5)) * 1080]; };
    if (showFrame > 0.01) {
      [['T', fr.T, '#ffc861'], ['N', fr.N, '#5ee7ff'], ['B', fr.B, '#ff4fd8']].forEach(([lab, d, col]) => {
        const tip = [fr.p[0] + d[0] * (AL * showFrame + 0.12), fr.p[1] + d[1] * (AL * showFrame + 0.12), fr.p[2] + d[2] * (AL * showFrame + 0.12)];
        const [x, y] = proj(tip);
        ui.text('lb' + lab, `<b>${lab}</b>`, { x, y, anchor: 'cc', size: 30, font: 'en', italic: true, color: col, opacity: showFrame * 0.95, glow: 8 });
      });
    }

    // captions
    caption(ui, tt, { at: 1.4, dur: 3.5, zh: '一切，从一个点的运动开始。', en: 'Everything begins with a moving point.', key: 'c1' });
    const gk = GR('κ'), gt = GR('τ');
    caption(ui, tt, { at: 6.9, dur: 3.4, zh: `曲率 ${gk} 与挠率 ${gt}，刻画曲线如何弯曲、如何扭转。`, en: `Curvature ${gk} and torsion ${gt}: how a curve bends and twists.`, key: 'c2', track: 0.08 });
    // chapter title
    chapterTitle(ui, tt, { at: 6.3, hold: 1.6, zh: '曲线', en: 'Curves', kicker: 'CHAPTER 01', x: 170, y: 180, size: 160, key: 'ct' });
    // formula (Frenet–Serret), colour-coded T gold / N cyan / B magenta
    const G = '{\\color{#ffc861}\\mathbf T}', Nn = '{\\color{#5ee7ff}\\mathbf N}', Bb = '{\\color{#ff4fd8}\\mathbf B}';
    fadeFormula(ui, tt, 'fs', String.raw`\begin{aligned}${G}' &= \kappa\,${Nn}\\ ${Nn}' &= -\kappa\,${G}+\tau\,${Bb}\\ ${Bb}' &= -\tau\,${Nn}\end{aligned}`, { at: 8.0, dur: 3.1, x: 170, y: 540, size: 52, anchor: 'tl', glow: 10, fi: 0.6, fo: 0.6 });

    // live HUD: real κ, τ and the κ(s), τ(s) graph that draws itself as the head flies
    const hud = seg(tt, 2.3, 3.1, ease.outCubic) * (1 - seg(tt, 5.7, 6.05, ease.inOutCubic));
    if (hud > 0.003) {
      const gx = 110, gy = 705, gw = 460, gh = 140;
      const kmax = Math.max(this.kmax, 1e-9), lo = Math.min(this.tmin, 0) * 1.1, hi = Math.max(this.kmax, this.tmax) * 1.08;
      const Y = (v) => gy + gh - ((v - lo) / (hi - lo)) * gh;
      if (!this.gK) {
        const NPT = 160; let dk = '', dt = '';
        for (let i = 0; i <= NPT; i++) { const j = Math.round((i / NPT) * NS), x = gx + (i / NPT) * gw; dk += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + Y(this.kap[j]).toFixed(1); dt += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + Y(this.tau[j]).toFixed(1); }
        this.gK = dk; this.gT = dt;
      }
      const prog = clamp(sRaw);
      ui.path('gk', this.gK, { stroke: '#5ee7ff', width: 3, progress: prog, glow: 8, opacity: hud * 0.95 });
      ui.path('gt', this.gT, { stroke: '#ff4fd8', width: 3, progress: prog, glow: 8, opacity: hud * 0.95 });
      ui.line('gaxx', gx, gy + gh, gx + gw, gy + gh, { stroke: '#9fc4ff', width: 1.5, opacity: hud * 0.4, progress: hud });
      ui.line('gaxy', gx, gy - 6, gx, gy + gh, { stroke: '#9fc4ff', width: 1.5, opacity: hud * 0.4, progress: hud });
      ui.line('gz', gx, Y(0), gx + gw, Y(0), { stroke: '#9fc4ff', width: 1, opacity: hud * 0.3, dash: [4, 7] });
      const mx = gx + prog * gw;
      ui.circle('gmk', mx, Y(fr.kappa), 6, { stroke: '#e8fbff', width: 2, fill: '#5ee7ff', opacity: hud * seg(tt, 1.6, 2.4), glow: 10 });
      ui.circle('gmt', mx, Y(fr.tau), 6, { stroke: '#ffe8fa', width: 2, fill: '#ff4fd8', opacity: hud * seg(tt, 1.6, 2.4), glow: 10 });
      ui.line('gcur', mx, gy - 4, mx, gy + gh, { stroke: '#ffffff', width: 1, opacity: hud * 0.18 });
      const sg = (v) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(3);
      ui.text('ghd', `<span style="color:#5ee7ff">κ ${sg(fr.kappa).replace('+', ' ')}</span>&nbsp;&nbsp;<span style="color:#ff4fd8">τ ${sg(fr.tau)}</span>`, { x: gx, y: gy - 92, anchor: 'tl', size: 30, font: 'mono', opacity: hud, track: 0.04 });
      ui.text('ghd2', `<span style="color:#9fc4ff">s = ${(clamp(sRaw) * this.L).toFixed(2)} / ${this.L.toFixed(2)} &nbsp;&nbsp; 1/κ = ${(1 / fr.kappa).toFixed(2)}</span>`, { x: gx, y: gy - 50, anchor: 'tl', size: 24, font: 'mono', opacity: hud * 0.9, track: 0.03 });
      // axis legend: curve names at the start of each graph line, x axis label under the axis
      const lg = (ch, col) => `<span style="color:${col};font-family:'DejaVu Serif','Noto Serif SC',serif;font-style:italic">${ch}</span><span style="color:${col};font-family:'Cormorant Garamond',serif;font-style:italic">(s)</span>`;
      ui.text('glk', lg('κ', '#5ee7ff'), { x: gx + gw + 14, y: Y(this.kap[0]), anchor: 'cl', size: 26, opacity: hud * 0.9 });
      ui.text('glt', lg('τ', '#ff4fd8'), { x: gx + gw + 14, y: Y(this.tau[0]), anchor: 'cl', size: 26, opacity: hud * 0.9 });
    }
  },
};
