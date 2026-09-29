// s01_surface — 曲面 / Surfaces.  10–20 s, hero 5.0.
// A single glowing circle sweeps around an axis and *grows a torus*; a marker glides over it carrying its tangent plane, unit normal and the two
// principal directions; at 5.0 the lines of curvature (on a torus: exactly the parameter circles) ignite from the marker as an expanding wavefront,
// two orthogonal families of glowing circles with comets of light racing along them. All numbers in the readout are computed by geom.frame().
// Everything is a pure function of t: tables (spark emission times, hero geometry) are precomputed in init().
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, smoothstep, palette, orbitCamera, rng, TAU, GLSL, glowTexture } from '../util.js';
import { frame, surfaces, parametricGeometry, vec } from '../geom.js';
import * as kit from '../kit.js';

// ------------------------------------------------------------------------------------------------------------- constants
const R0 = 1.7, r0 = 0.65;
const TS = surfaces.torus(R0, r0);
const NU_L = 32, NV_L = 12;                       // line-of-curvature families (u = const meridians, v = const parallels)
const SW0 = 0.4, SW1 = 3.3, OVER = 1.04;          // sweep window and reveal overshoot (so the seam glow leaves cleanly)
const T_HERO = 5.0, T_IGN = T_HERO - 0.12;      // the wavefront leaves the marker a hair before the hit so ignited lines are on screen AT the hit
const COL_A = new THREE.Color(0x5ee7ff), COL_B = new THREE.Color(0xff6fe0);   // family A (meridians, k1) cyan · family B (parallels, k2) magenta
const WHITE = new THREE.Color(palette.white);

const sweepFrac = (t) => ease.inOutCubic(clamp((t - SW0) / (SW1 - SW0))) * OVER;   // u/(2π) of the sweeping ring

// ------------------------------------------------------------------------------------------------------------- camera
/** Everything in one pure function of t. Returns look-at pose. */
function camPose(t) {
  const w1 = seg(t, 0.1, 3.4, ease.inOutCubic);        // ring close-up -> full torus
  const hs = seg(t, 4.8, 6.2, ease.outQuart);          // hero swoop
  const st = seg(t, 6.2, 11.5, ease.inOutSine);        // slow settle / drift-out
  const dl = seg(t, 8.0, 11.0, ease.inOutSine);        // late dolly-in toward the marker
  const azSlow = 0.62 - 0.46 * sweepFrac(t) * TAU / OVER + 0.05 * t;   // camera partly follows the sweeping ring
  return {
    target: [lerp(R0, 0, w1), lerp(0, -0.12, w1), 0],
    r: lerp(3.5, 9.4, w1) - 2.0 * hs + 2.2 * st - 1.1 * dl,
    azSlow,
    az: azSlow + 0.34 * hs + 0.6 * st,
    el: lerp(0.2, 0.52, w1) - 0.2 * hs + 0.02 * st + 0.03 * Math.sin(t * 0.7),
    roll: 0.07 * (1 - w1) - 0.05 * hs * (1 - st) + 0.02 * Math.sin(t * 0.5),
    shx: -0.15 * seg(t, 1.0, 4.0) - 0.05 * seg(t, 6.0, 8.0),
    shy: -0.115 * seg(t, 1.0, 2.2) + 0.04 * seg(t, 3.2, 5.0),   // torus rides high while caption 1 speaks, settles for the hero
  };
}

/** marker (u,v) on the torus as a function of t: keeps facing the camera, glides right and up over the tube through K=0 into K<0. */
function markerUV(t) {
  const c = camPose(t);
  const uFace = Math.PI / 2 - c.azSlow;
  const off = 0.32 - 1.25 * (1 - Math.exp(-(t - 2.3) / 3.6));
  const tt = Math.max(0, t - 8.0), hh = tt < 1 ? 0.5 * tt * tt : tt - 0.5;   // C1 ramp: glides on faster after 8 s
  return [uFace + off, 0.72 + 0.075 * (t - 2.3) + 0.24 * hh];   // K > 0 while the caption speaks; crosses K = 0 (top of the tube) at t = 9.8 and ends on the inner side (still facing the camera: v < pi/2 + el)
}

const outward = (u, v) => [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];

// ------------------------------------------------------------------------------------------------------------- shaders
const overlayVS = /* glsl */ `
  uniform float uOff; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){ vUv = uv; vec3 p = position - normal*uOff; vec4 mv = modelViewMatrix*vec4(p,1.0); vN = normalize(normalMatrix*normal); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`;
const overlayFS = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  uniform float uT, uIgn, uAmp, uR, ur; uniform vec2 uMark, uCnt; uniform vec3 uColA, uColB;
  ${GLSL.hash}
  float wrap01(float d){ return d - floor(d + 0.5); }
  void main(){
    float v = vUv.y*6.28318530718;
    float du = wrap01(vUv.x - uMark.x)*6.28318530718*(uR + ur*cos(v));
    float dv = wrap01(vUv.y - uMark.y)*6.28318530718*ur;
    float dist = length(vec2(du, dv));
    float vis = smoothstep(uIgn, uIgn - 1.1, dist);
    float front = exp(-pow((dist - uIgn)/0.30, 2.0)) * step(0.001, uIgn) * (1.0 - smoothstep(8.5, 11.0, uIgn));
    vec2 g = vUv*uCnt;
    float ix = floor(g.x + 0.5), iy = floor(g.y + 0.5);
    float dxp = abs(g.x - ix)/max(fwidth(g.x), 1e-4), dyp = abs(g.y - iy)/max(fwidth(g.y), 1e-4);
        float hA = hash11(mod(ix, uCnt.x) + 3.7), hB = hash11(mod(iy, uCnt.y) + 11.3);
    // comets: sharp head, long exponential tail; alternate direction per line; integer #pulses per loop (seamless)
    float sA = hA > 0.5 ? 1.0 : -1.0, sB = hB > 0.5 ? 1.0 : -1.0;
    float phA = fract(sA*vUv.y*2.0 - uT*(0.28 + 0.34*hA) + hA*9.0);
    float phB = fract(sB*vUv.x*3.0 - uT*(0.20 + 0.30*hB) + hB*7.0);
    float pA = pow(phA, 11.0)*(1.0 - smoothstep(0.93, 1.0, phA)), pB = pow(phB, 11.0)*(1.0 - smoothstep(0.93, 1.0, phB));
    pA *= 1.5; pB *= 1.5;
    float lA = exp(-dxp*dxp*0.30/(1.0 + 0.3*pA)) + 0.24*exp(-dxp*0.42/(1.0 + 0.4*pA));
    float lB = exp(-dyp*dyp*0.30/(1.0 + 0.3*pB)) + 0.24*exp(-dyp*0.42/(1.0 + 0.4*pB));
    vec3 n = normalize(vN); if(!gl_FrontFacing) n = -n; vec3 vv = normalize(vV);
    float fr = pow(1.0 - clamp(dot(n, vv), 0.0, 1.0), 2.0);
    float shade = 0.65 + 0.7*fr;
    vec3 col = uColA*lA*(0.34 + 7.5*pA)*shade + uColB*lB*(0.32 + 7.0*pB)*shade;
    // cross-glow where the two families meet
    col += vec3(1.0,0.95,1.0)*lA*lB*0.9;
    col *= vis;
    col += vec3(0.65,0.92,1.0)*front*(0.9 + 1.3*fr);
    gl_FragColor = vec4(col*uAmp, 1.0);
  }`;

const sparkVS = /* glsl */ `
  attribute vec3 aVel; attribute float aBirth, aLife, aSize, aDrag; attribute vec3 aCol;
  uniform float uT, uPx; varying vec3 vC;
  void main(){
    float age = uT - aBirth; float k = age/aLife;
    float alive = step(0.0, age)*step(age, aLife);
    vec3 p = position + aVel*(1.0 - exp(-aDrag*max(age,0.0)))/aDrag;
    float fade = (1.0-k)*(1.0-k)*smoothstep(0.0, 0.05, age);
    vC = aCol*fade*alive;
    vec4 mv = modelViewMatrix*vec4(p,1.0);
    gl_PointSize = max(alive*1.8, aSize*(0.4+0.6*(1.0-k))*1483.0*uPx/max(-mv.z,0.1));
    gl_Position = projectionMatrix*mv;
    vC *= 1.0 - 0.9*smoothstep(-0.60, -0.78, gl_Position.y/gl_Position.w);   // keep the caption band clear of sparks
  }`;
const sparkFS = /* glsl */ `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-0.5; float d = length(p)*2.0; float a = smoothstep(1.0,0.0,d); a = a*a; gl_FragColor = vec4(vC*a, a); }`;

const dustVS = /* glsl */ `
  attribute vec3 aVel; attribute float aSize, aPh; attribute vec3 aCol; uniform float uT, uPx, uBox, uAmp; varying vec3 vC;
  void main(){
    vec3 b = vec3(uBox, uBox*0.6, uBox);
    vec3 p = mod(position + aVel*uT + b*0.5, b) - b*0.5;
    float tw = 0.65 + 0.35*sin(uT*1.3 + aPh*6.28);
    vC = aCol*tw*uAmp*smoothstep(0.0, 1.0, 1.0 - length(p.xz)/(uBox*0.55));
    vec4 mv = modelViewMatrix*vec4(p,1.0);
    gl_PointSize = max(1.6, aSize*1483.0*uPx/max(-mv.z,0.1));
    gl_Position = projectionMatrix*mv;
  }`;

const planeFS = /* glsl */ `
  varying vec2 vP; uniform float uProg, uHalf, uA, uT; uniform vec3 uCol;
  void main(){
    vec2 p = vP; float m = max(abs(p.x), abs(p.y)); float d = uHalf - m;
    float rr = length(p)/uHalf;
    float rev = smoothstep(uProg*1.55, uProg*1.55 - 0.3, rr);
    float w = fwidth(d) + 1e-5;
    float edge = exp(-pow(abs(d)/(w*1.3), 2.0)) + 0.32*exp(-abs(d)/(w*5.0));
    float ang = fract(atan(p.y, p.x)/6.28318530718);
    edge *= smoothstep(uProg*1.02, uProg*1.02 - 0.05, ang);
    float inside = smoothstep(-w, w, d);
    vec2 q = (p/uHalf)*3.0; vec2 f = abs(fract(q + 0.5) - 0.5)/max(fwidth(q), 1e-4); float gl = 1.0 - min(min(f.x, f.y), 1.0);
    float ring = exp(-pow((rr - fract(uT*0.33)*1.5)/0.07, 2.0))*(1.0 - fract(uT*0.33))*0.5;
    float fill = 0.085 + 0.08*(1.0 - clamp(rr, 0.0, 1.0));
    vec3 c = uCol*((fill + gl*gl*0.28 + ring)*inside*rev + edge*2.0);
    gl_FragColor = vec4(c*uA, 1.0);
  }`;

const floorFS = /* glsl */ `
  varying vec2 vP; uniform float uWave, uT, uAmp; ${GLSL.hash}
  void main(){
    float rad = length(vP); float ang = atan(vP.y, vP.x);
    // polar lattice: concentric rings + radial spokes (the torus' own symmetry group)
    float gr = rad/0.5, ga = ang/6.28318530718*96.0;
    float dr = abs(fract(gr - 0.5) - 0.5)/max(fwidth(gr), 1e-4), da = abs(fract(ga - 0.5) - 0.5)/max(fwidth(ga), 1e-4);
    float lr = 1.0 - min(dr, 1.0), la = (1.0 - min(da, 1.0))*smoothstep(0.7, 2.5, rad);
    float gm = rad/2.5; float dm = abs(fract(gm - 0.5) - 0.5)/max(fwidth(gm), 1e-4); float lm = 1.0 - min(dm, 1.0);
    // footprints of the torus (outer / inner equator)
    float fo = exp(-pow((rad - 2.35)/0.035, 2.0)) + exp(-pow((rad - 1.05)/0.035, 2.0));
    fo *= 0.8;
    float fade = exp(-rad*0.20)*smoothstep(0.3, 1.4, rad);
    float wave = exp(-pow((rad - uWave)/0.55, 2.0))*step(0.01, uWave)*exp(-uWave*0.10);
    vec3 col = vec3(0.10,0.30,0.85)*(lr*0.22 + la*0.08) + vec3(0.30,0.60,1.0)*lm*0.40 + vec3(0.5,0.9,1.0)*fo*0.36;
    col *= fade*(1.0 + 5.0*wave);
    col += vec3(0.4,0.8,1.0)*wave*0.4*fade;
    gl_FragColor = vec4(col*uAmp, 1.0);
  }`;

/** kit.chapterTitle with the English line dropped clear of the glyph descent (kit's default touches the CJK glyphs). */
function title(ui, t, { at, hold, zh, en, kicker, x, y, size }) {
  const inn = seg(t, at, at + 1.4, ease.outCubic), out = seg(t, at + 1.4 + hold, at + 2.1 + hold, ease.inOutCubic), v = inn * (1 - out);
  if (v <= 0.001) return;
  const yE = y + size * 1.3, yR = yE + size * 0.42;
  ui.text('tk', kicker, { x, y: y - size * 0.34, anchor: 'tl', size: 20, font: 'mono', track: 0.42, color: '#5ee7ff', opacity: v, reveal: seg(t, at, at + 0.9, ease.linear), revealMode: 'mask' });
  ui.text('tz', zh, { x, y, anchor: 'tl', size, weight: 900, color: '#f4f8ff', glow: 26, opacity: v, reveal: seg(t, at + 0.15, at + 1.35, ease.linear), spread: 0.9, track: 0.04 });
  ui.text('te', en, { x: x + 6, y: yE, anchor: 'tl', size: Math.round(size * 0.27), font: 'en', italic: true, weight: 400, track: 0.22, color: '#cfeaff', opacity: v * 0.9, reveal: seg(t, at + 0.5, at + 1.5, ease.linear), revealMode: 'mask' });
  ui.line('tr', x, yR, x + 220, yR, { stroke: '#5ee7ff', width: 2.5, progress: seg(t, at + 0.4, at + 1.4), opacity: v * 0.9, glow: 8 });
}

// ------------------------------------------------------------------------------------------------------------- scene
export default {
  beats: [
    { t: 0.4, kind: 'whoosh', label: 'ring starts to sweep' },
    { t: 1.6, kind: 'swell', label: 'surface being born' },
    { t: 3.3, kind: 'tick', label: 'torus closes' },
    { t: 4.4, kind: 'swell', label: 'charge' },
    { t: 5.0, kind: 'hit', label: 'lines of curvature ignite' },
    { t: 5.6, kind: 'sparkle' },
    { t: 7.4, kind: 'tick' },
  ],

  init(ctx) {
    const { scene } = ctx;
    ctx.background(palette.void);
    const line = (pts, o = {}) => { const l = ctx.fatLine(pts, o); l.renderOrder = o.order ?? 3; return l; };

    // ---- environment
    this.bd = kit.backdrop(ctx, { seed: 11, a: 0x070c30, b: 0x2a0f52, c: 0x0a3a5a, intensity: 0.32 }); scene.add(this.bd);
    this.stars = kit.starfield(ctx, { count: 1700, seed: 21, intensity: 0.9 }); scene.add(this.stars);

    this.floorMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uWave: { value: 0 }, uT: { value: 0 }, uAmp: { value: 1 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: floorFS,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -1.55; this.floor.renderOrder = -5; scene.add(this.floor);

    this.back = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0x2a52ff).multiplyScalar(0.55), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.back.scale.set(18, 18, 1); this.back.position.set(0, 0, 0); this.back.renderOrder = -6; scene.add(this.back);

    // ---- the torus
    this.geo = parametricGeometry(TS.f, { nu: 192, nv: 72, ...TS.dom });
    this.mat = kit.surfaceMaterial({ base: 0x1a2868, curv: 0.05, kScale: 1 / 1.1, grid: [NU_L, NV_L], gridW: 1.1, gridI: 0.6, gridCol: 0x7fe9ff, rim: 0.55, rimCol: 0x5ee7ff, spec: 0.4, reveal: 0.0 });
    // patch the kit shader: every substitution is verified on its own (a kit.js edit must not silently break the look)
    let fsrc = this.mat.fragmentShader;
    const patch = (from, to) => { if (!fsrc.includes(from)) { console.warn('[s01_surface] kit shader patch not applied: ' + from); return; } fsrc = fsrc.replace(from, to); };
    patch('step(uReveal, 1.0)', '(1.0-smoothstep(0.985,1.035,uReveal))');                                        // seam glow leaves cleanly after the sweep
    patch('smoothstep(0.035, 0.0, e) * step(e, 0.06)', 'pow(smoothstep(0.011, 0.0, e), 1.4) * step(e, 0.06)');    // fine seam line, not a fat collar
    patch('vec3 base = mix(uBase, curvatureColor(kn), uCurv);', 'vec3 base = mix(uBase, curvatureColor(kn)*0.72, uCurv);');
    patch('col += vec3(0.6,0.9,1.0)*edgeGlow*5.0;', 'col += vec3(0.6,0.9,1.0)*edgeGlow*0.55;');
    this.mat.fragmentShader = fsrc;
    this.torus = new THREE.Mesh(this.geo, this.mat); this.torus.renderOrder = 0; scene.add(this.torus);

    this.ovMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uOff: { value: 0.012 }, uT: { value: 0 }, uIgn: { value: 0 }, uAmp: { value: 1 }, uR: { value: R0 }, ur: { value: r0 }, uMark: { value: new THREE.Vector2() }, uCnt: { value: new THREE.Vector2(NU_L, NV_L) }, uColA: { value: COL_A.clone().multiplyScalar(1.15) }, uColB: { value: COL_B.clone().multiplyScalar(1.15) } },
      vertexShader: overlayVS, fragmentShader: overlayFS, extensions: { derivatives: true },
    });
    this.ovMat.extensions = { derivatives: true };
    this.overlay = new THREE.Mesh(this.geo, this.ovMat); this.overlay.renderOrder = 1; scene.add(this.overlay);

    // ---- the sweeping circle (with a rotating comet along it) + halo + echoes
    const NR = 128, ringPts = [], ringCols = [];
    for (let i = 0; i <= NR; i++) {
      const a = (i / NR) * TAU; ringPts.push([r0 * Math.cos(a), r0 * Math.sin(a), 0]);
      const ph = (i / NR); const comet = Math.pow(ph, 10);
      const k = 1.5 + 6.0 * comet; ringCols.push(0.8 * k, 0.97 * k, 1.0 * k);
    }
    this.sw1 = new THREE.Group(); this.sw2 = new THREE.Group(); this.sw2.position.x = R0; this.sw1.add(this.sw2); scene.add(this.sw1);
    this.ring = line(ringPts, { colors: ringCols, width: 5.5, intensity: 1.0 });
    this.ringHalo = line(ringPts, { color: 0x3b6dff, width: 16, intensity: 0.5, opacity: 0.3 });
    this.sw2.add(this.ringHalo, this.ring);
    this.echo = [];
    for (let k = 0; k < 8; k++) {
      const g1 = new THREE.Group(), g2 = new THREE.Group(); g2.position.x = R0; g1.add(g2);
      const l = line(ringPts, { color: 0x6fd8ff, width: 3.0 - k * 0.2, intensity: 1.6, opacity: 0.5 }); g2.add(l); scene.add(g1);
      this.echo.push({ g1, l, k });
    }
    this.ringGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0x7fd8ff).multiplyScalar(1.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.ringGlow.renderOrder = 6; this.sw2.add(this.ringGlow);

    // ---- marker, tangent plane, normal, principal bars
    this.blast = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.blast.renderOrder = 8; scene.add(this.blast);
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), new THREE.MeshBasicMaterial({ color: WHITE.clone().multiplyScalar(6) }));
    this.marker.renderOrder = 4; scene.add(this.marker);
    this.mGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xa8ecff).multiplyScalar(1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, depthTest: false }));
    this.mGlow.renderOrder = 7; scene.add(this.mGlow);

    this.planeHalf = 0.66;
    this.planeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uProg: { value: 0 }, uHalf: { value: this.planeHalf }, uA: { value: 1 }, uT: { value: 0 }, uCol: { value: new THREE.Color(0x9fe6ff).multiplyScalar(1.0) } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: planeFS, extensions: { derivatives: true },
    });
    this.planeMat.extensions = { derivatives: true };
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(this.planeHalf * 2.5, this.planeHalf * 2.5), this.planeMat); this.plane.renderOrder = 2; scene.add(this.plane);

    this.nArrow = kit.arrow(ctx, { color: palette.white, width: 3.6, head: 0.13, intensity: 3.2 }); this.nArrow.renderOrder = 4; scene.add(this.nArrow);
    const bar = (col) => { const l = line([[-1, 0, 0], [1, 0, 0]], { color: col, width: 4.2, intensity: 3.0 }); scene.add(l); return l; };
    this.barA = bar(0x5ee7ff); this.barB = bar(0xff6fe0);
    this.capA = [], this.capB = [];
    for (const [arr, c] of [[this.capA, 0x5ee7ff], [this.capB, 0xff6fe0]]) for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(4) })); m.renderOrder = 4; scene.add(m); arr.push(m);
    }

    // ---- hero lines through the marker: half-circles growing in both directions
    const NH = 96, hm = [], hp = [];
    for (let i = 0; i <= NH; i++) { const a = (i / NH) * Math.PI; hm.push([r0 * 1.02 * Math.cos(a), r0 * 1.02 * Math.sin(a), 0]); hp.push([Math.cos(a), 0, Math.sin(a)]); }
    const mk = (pts, col, w) => { const l = line(pts, { color: col, width: w, intensity: 3.4 }); l.geometry.instanceCount = 1; return l; };
    this.hMer = [0, 1].map((k) => { const g1 = new THREE.Group(), g2 = new THREE.Group(); g2.position.x = R0; g2.scale.y = k ? -1 : 1; const l = mk(hm, 0x5ee7ff, 4.4); g2.add(l); g1.add(g2); scene.add(g1); return { g1, g2, l }; });
    this.hPar = [0, 1].map((k) => { const g1 = new THREE.Group(), g2 = new THREE.Group(); g2.scale.z = k ? -1 : 1; const l = mk(hp, 0xff6fe0, 4.4); g2.add(l); g1.add(g2); scene.add(g1); return { g1, g2, l }; });
    this.NH = NH;
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3(); this._vx = new THREE.Vector3(1, 0, 0);

    // ---- photons racing round the two lines of curvature through the marker (each with a fading trail)
    this.photons = [];
    for (let f = 0; f < 2; f++) for (let d = 0; d < 2; d++) {
      const col = f ? COL_B : COL_A, trail = [];
      for (let k = 0; k < 9; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true }));
        sp.renderOrder = 6; sp.visible = false; scene.add(sp); trail.push(sp);
      }
      this.photons.push({ f, d, col, trail });
    }

    // ---- hero shock rings (in the tangent plane at the hero location)
    const ringUnit = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * TAU; ringUnit.push([Math.cos(a), Math.sin(a), 0]); }
    this.shock = [0, 1].map((k) => { const l = line(ringUnit, { color: k ? 0xff9af0 : 0xbdf4ff, width: 3.4 - k, intensity: 3 }); l.visible = false; scene.add(l); return l; });

    // ---- sparks: (a) shed by the sweeping ring, (b) hero burst from the marker
    const uv5 = markerUV(T_HERO), fr5 = frame(TS.f, uv5[0], uv5[1]); this.hero = { uv: uv5, fr: fr5 };
    const r = rng(101), N1 = 1500, N2 = 1000, N = N1 + N2;
    const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), birth = new Float32Array(N), life = new Float32Array(N), size = new Float32Array(N), drag = new Float32Array(N), col = new Float32Array(N * 3);
    const put = (i, p, vl, b, l, s, d, c) => { pos.set(p, i * 3); vel.set(vl, i * 3); birth[i] = b; life[i] = l; size[i] = s; drag[i] = d; col.set(c, i * 3); };
    const invSweep = (f) => { let a = SW0, b = SW1; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (sweepFrac(m) < f) a = m; else b = m; } return (a + b) / 2; };
    for (let i = 0; i < N1; i++) {
      const uf = 0.02 + 0.97 * r(), u = uf * TAU, v = r() * TAU, e = invSweep(uf);
      const p = TS.f(u, v), no = outward(u, v), tu = [-Math.sin(u), 0, Math.cos(u)];
      const sp = 0.2 + 0.85 * r(), tr = 0.08 + 0.5 * r();
      const jx = (r() - 0.5) * 0.5, jy = (r() - 0.5) * 0.5, jz = (r() - 0.5) * 0.5;
      const cc = r(), k = 1.2 + 3.6 * Math.pow(r(), 2);
      const c = cc < 0.72 ? [0.7 * k, 0.95 * k, 1.0 * k] : cc < 0.88 ? [1.0 * k, 0.72 * k, 0.32 * k] : [1.0 * k, 0.45 * k, 0.9 * k];
      put(i, p, [no[0] * sp - tu[0] * tr + jx, no[1] * sp - tu[1] * tr + jy, no[2] * sp - tu[2] * tr + jz], e + r() * 0.03, 1.0 + 1.8 * r(), 0.010 + 0.030 * Math.pow(r(), 3), 1.5, c);
    }
    const P5 = fr5.p, E1 = fr5.e1, E2 = fr5.e2, Nn = vec.cross(E1, E2);
    for (let i = 0; i < N2; i++) {
      const axis = r() < 0.7; const base = axis ? Math.floor(r() * 4) * (Math.PI / 2) : r() * TAU;
      const th = base + (axis ? (r() - 0.5) * 0.28 : 0), fam = Math.abs(Math.cos(th)) > Math.abs(Math.sin(th)) ? 0 : 1;
      const sp = 0.9 + 4.2 * Math.pow(r(), 0.8), nz = (r() - 0.4) * 0.9;
      const d = [Math.cos(th) * E1[0] + Math.sin(th) * E2[0] + nz * Nn[0] * 0.6, Math.cos(th) * E1[1] + Math.sin(th) * E2[1] + nz * Nn[1] * 0.6, Math.cos(th) * E1[2] + Math.sin(th) * E2[2] + nz * Nn[2] * 0.6];
      const k = 1.5 + 4.5 * Math.pow(r(), 2), cc = axis ? (fam ? [1.0, 0.5, 0.92] : [0.5, 0.92, 1.0]) : [1.0, 0.85, 0.6];
      put(N1 + i, P5, d.map((x) => x * sp), T_HERO + r() * 0.06, 1.2 + 1.7 * r(), 0.016 + 0.05 * Math.pow(r(), 2), 1.8, cc.map((x) => x * k * 1.3));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    sg.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1)); sg.setAttribute('aLife', new THREE.BufferAttribute(life, 1)); sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aDrag', new THREE.BufferAttribute(drag, 1)); sg.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.sparkMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uPx: { value: ctx.px } }, vertexShader: sparkVS, fragmentShader: sparkFS });
    this.sparks = new THREE.Points(sg, this.sparkMat); this.sparks.frustumCulled = false; this.sparks.renderOrder = 5; scene.add(this.sparks);

    // ---- ambient dust + big soft bokeh (parallax)
    const mkDust = (n, seed, box, sz0, sz1, cInt, amp) => {
      const q = rng(seed), P = new Float32Array(n * 3), V = new Float32Array(n * 3), S = new Float32Array(n), Ph = new Float32Array(n), C = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        P.set([(q() - 0.5) * box, (q() - 0.5) * box * 0.6, (q() - 0.5) * box], i * 3); V.set([(q() - 0.5) * 0.1, 0.03 + 0.08 * q(), (q() - 0.5) * 0.1], i * 3);
        S[i] = sz0 + (sz1 - sz0) * Math.pow(q(), 2); Ph[i] = q(); const w = q(), k = cInt * (0.4 + 0.9 * q());
        C.set(w < 0.6 ? [0.55 * k, 0.85 * k, 1.0 * k] : w < 0.85 ? [0.75 * k, 0.55 * k, 1.0 * k] : [1.0 * k, 0.8 * k, 0.5 * k], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aVel', new THREE.BufferAttribute(V, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(S, 1));
      g.setAttribute('aPh', new THREE.BufferAttribute(Ph, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(C, 3));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uPx: { value: ctx.px }, uBox: { value: box }, uAmp: { value: amp } }, vertexShader: dustVS, fragmentShader: sparkFS });
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 6; scene.add(pts); return pts;
    };
    this.dust = mkDust(700, 5, 16, 0.012, 0.03, 1.0, 1.0);
    this.bokeh = mkDust(26, 9, 12, 0.22, 0.5, 0.11, 1.0);
  },

  update(t, ctx) {
    const ui = ctx.ui, P = ctx.post;
    const cp = camPose(t);
    // ------------------------------------------------------------------ camera
    orbitCamera(ctx.camera, { target: cp.target, r: cp.r, az: cp.az, el: cp.el, roll: cp.roll });
    ctx.camera.translateX(cp.shx * cp.r); ctx.camera.translateY(cp.shy * cp.r);
    ctx.camera.updateMatrixWorld();

    // ------------------------------------------------------------------ sweep / reveal
    const sw = sweepFrac(t), su = sw * TAU;
    const done = seg(t, SW1 - 0.1, SW1 + 0.9);
    this.mat.uniforms.uReveal.value = t < SW0 ? 0 : sw;
    this.mat.uniforms.uTime.value = t;
    const hp = t < T_HERO ? 0.12 * smoothstep(4.3, 5.0, t) : Math.exp(-(t - T_HERO) * 3.2);          // hero pulse envelope
    const afterHero = seg(t, T_HERO, T_HERO + 1.2);
    this.mat.uniforms.uCurv.value = 0.05 + 0.80 * seg(t, T_HERO - 0.2, T_HERO + 1.3);
    this.mat.uniforms.uGridI.value = lerp(0.6, 0.22, afterHero);
    this.mat.uniforms.uRim.value = 0.55 + 0.32 * hp + 0.15 * seg(t, 2, 4);
    this.mat.uniforms.uSpec.value = 0.45;

    // ring: the one circle, alive from t = 0 (comet rotating along it), sweeping via rotation about the y axis
    const ringOn = 1 - seg(t, SW1 - 0.2, SW1 + 0.8);
    this.sw1.rotation.y = -su; this.sw2.rotation.z = t * 2.4;
    this.ring.visible = this.ringHalo.visible = this.ringGlow.visible = ringOn > 0.002;
    const ringPulse = 1 + 0.12 * Math.sin(t * 9.0);
    this.ring.material.opacity = ringOn; this.ringHalo.material.opacity = 0.32 * ringOn * ringPulse;
    this.ringGlow.material.color.setRGB(0.4, 0.75, 1.0).multiplyScalar(0.1 * ringOn * ringPulse);
    this.ringGlow.scale.setScalar(r0 * 3.0);
    const fan = 1 - seg(t, 0.0, 1.1, ease.inOutCubic);           // at t = 0 a fan of rings (the previous chapter's family) collapses into one circle
    for (const e of this.echo) {
      const sgn = e.k % 2 ? -1 : 1, fo = sgn * (0.12 + 0.11 * Math.floor(e.k / 2)) * fan;
      const ue = su - (e.k + 1) * 0.14 * (0.4 + 0.6 * ease.outCubic(seg(t, SW0, SW0 + 0.8))) * (1 - fan) + fo;
      e.g1.rotation.y = -ue; const on = (1 - seg(t, SW1 - 0.3, SW1 + 0.5));
      e.l.visible = on > 0.01 && (fan > 0.02 || ue > 0.0); e.l.material.opacity = 0.55 * on * (1 - e.k / 9) * (fan > 0.02 ? 1 : seg(t, SW0, SW0 + 0.3));
    }

    // ------------------------------------------------------------------ marker + differential geometry at the marker
    const [mu, mv] = markerUV(t);
    const fr = frame(TS.f, mu, mv);
    const c0 = [R0 * Math.cos(mu), 0, R0 * Math.sin(mu)];
    const sgn = Math.sign(vec.dot(fr.n, vec.sub(fr.p, c0))) || 1;
    const nO = vec.scl(fr.n, sgn);
    const mOn = seg(t, 2.0, 2.6, ease.outCubic);
    const charge = seg(t, 4.1, T_HERO, ease.inCubic);
    const pk = t < T_HERO ? 0 : Math.exp(-(t - T_HERO) * 3.0);
    this.marker.visible = mOn > 0.01;
    const mp = vec.add(fr.p, vec.scl(nO, 0.02));
    this.marker.position.set(...mp); this.marker.scale.setScalar(mOn * (1 + 0.5 * charge + 1.2 * pk));
    this.mGlow.position.set(...mp); this.mGlow.scale.setScalar(0.32 * mOn * (1 + 1.2 * charge + 2.2 * pk) * (1 + 0.08 * Math.sin(t * 7)));
    this.mGlow.material.color.setRGB(0.6, 0.9, 1.0).multiplyScalar(0.9 * mOn * (0.8 + 0.6 * charge + 0.9 * pk));

    // tangent plane
    const e1 = fr.e1, e2 = fr.e2, e3 = vec.nrm(vec.cross(e1, e2));
    const pProg = seg(t, 2.5, 3.7, ease.outCubic);
    this.plane.visible = pProg > 0.001;
    this.plane.position.set(...vec.add(fr.p, vec.scl(nO, 0.014)));
    this.plane.quaternion.setFromRotationMatrix(this._m4.makeBasis(this._v1.set(...e1), this._v2.set(...e2), this._v3.set(...e3)));
    this.planeMat.uniforms.uProg.value = pProg; this.planeMat.uniforms.uT.value = t;
    this.planeMat.uniforms.uA.value = (0.60 + 0.30 * seg(t, T_HERO + 0.8, T_HERO + 2.0) + 0.08 * pk) * (1 - seg(t, 10.2, 11.4) * 0.4);

    // normal arrow
    const nLen = 0.95 * seg(t, 3.2, 4.0, ease.outCubic);
    this.nArrow.set(fr.p, nO, Math.max(nLen, 1e-5)); this.nArrow.visible = nLen > 0.01;

    // principal direction bars
    const bLen = 0.6 * seg(t, 3.7, 4.5, ease.outCubic), barVis = 1 - 0.55 * seg(t, T_HERO + 0.2, T_HERO + 1.2);
    const posBar = (l, dir) => { l.position.set(...vec.add(fr.p, vec.scl(nO, 0.02))); l.quaternion.setFromUnitVectors(this._vx, this._v1.set(...dir)); l.scale.setScalar(Math.max(bLen, 1e-4)); l.visible = bLen > 0.01; l.material.opacity = barVis; };
    posBar(this.barA, e1); posBar(this.barB, e2);
    const cap = (arr, dir) => arr.forEach((m, i) => { m.visible = bLen > 0.02; m.position.set(...vec.add(vec.add(fr.p, vec.scl(nO, 0.02)), vec.scl(dir, (i ? -1 : 1) * bLen))); m.scale.setScalar(barVis); });
    cap(this.capA, e1); cap(this.capB, e2);

    // ------------------------------------------------------------------ HERO: lines of curvature ignite
    const ign = t < T_IGN ? 0 : 10.5 * ease.outCubic(seg(t, T_IGN, T_HERO + 1.8, ease.linear));
    this.overlay.visible = ign > 0.001;
    const ou = this.ovMat.uniforms;
    ou.uIgn.value = ign; ou.uT.value = t; ou.uMark.value.set(((this.hero.uv[0] / TAU) % 1 + 1) % 1, ((this.hero.uv[1] / TAU) % 1 + 1) % 1);
    ou.uAmp.value = 1.0 + 0.35 * hp;
    // the two lines through the current marker (fat, growing outwards from it)
    const g = ease.outExpo(seg(t, T_IGN, T_HERO + 1.0, ease.linear));
    const nSeg = Math.max(1, Math.floor(g * this.NH));
    const lk = seg(t, T_HERO + 2.0, T_HERO + 4.5, ease.inOutSine), lu = lerp(this.hero.uv[0], mu, lk), lv = lerp(this.hero.uv[1], mv, lk);
    const rho = R0 + (r0 * 1.02) * Math.cos(lv), hh = (r0 * 1.02) * Math.sin(lv);
    for (const m of this.hMer) { m.g1.rotation.y = -lu; m.g2.rotation.z = lv; m.l.geometry.instanceCount = nSeg; m.l.visible = g > 0.002; }
    for (const m of this.hPar) { m.g1.rotation.y = -lu; m.g1.position.y = hh; m.g1.scale.set(rho, 1, rho); m.l.geometry.instanceCount = nSeg; m.l.visible = g > 0.002; }
    // photons
    { const pOn = seg(t, T_HERO + 0.25, T_HERO + 1.0) * (1 - 0.45 * seg(t, 8, 9.5));
      for (const ph of this.photons) {
        const dir = ph.d ? -1 : 1, s0 = dir * (2.2 * (t - T_HERO) + ph.f * 1.6);
        ph.trail.forEach((sp, k) => {
          const a = s0 - dir * k * 0.085;
          const q = ph.f ? TS.f(lu + a * (r0 / (R0 + r0 * Math.cos(lv))), lv) : TS.f(lu, lv + a);
          const no = ph.f ? outward(lu + a * (r0 / (R0 + r0 * Math.cos(lv))), lv) : outward(lu, lv + a);
          sp.visible = pOn > 0.01; sp.position.set(q[0] + no[0] * 0.03, q[1] + no[1] * 0.03, q[2] + no[2] * 0.03);
          const w = Math.pow(1 - k / 9, 2);
          sp.scale.setScalar(0.34 * (0.35 + 0.65 * w));
          sp.material.color.copy(ph.col).multiplyScalar(2.2 * w * pOn);
        });
      } }
    // shock rings on the tangent plane at the hero location
    const hf = this.hero.fr, hn = vec.nrm(vec.cross(hf.e1, hf.e2));
    const qh = this._q.setFromRotationMatrix(this._m4.makeBasis(this._v1.set(...hf.e1), this._v2.set(...hf.e2), this._v3.set(...hn)));
    this.shock.forEach((l, k) => {
      const a = t - T_HERO - k * 0.10, on = a > 0 && a < 1.05;
      l.visible = on; if (!on) return;
      const rr = 0.05 + 1.55 * ease.outExpo(a / 1.05);
      l.position.set(...vec.add(hf.p, vec.scl(hn, 0.02))); l.quaternion.copy(qh); l.scale.setScalar(rr); l.material.opacity = Math.pow(1 - a / 1.05, 2.0);
    });

    // hero blast: a localized flash (a flat full-frame white lift looks like fog; a big soft light at the marker looks like an explosion of light)
    { const a = t - T_HERO, k = t < T_HERO ? 0.10 * ease.inCubic(seg(t, 4.5, T_HERO, ease.linear)) : Math.exp(-a * 6.5);
      this.blast.visible = k > 0.003; this.blast.position.set(...this.hero.fr.p); this.blast.scale.setScalar(2.6 + 7 * ease.outCubic(clamp(a / 0.7)) - 0.6 * (t < T_HERO ? 1 - seg(t, 4.5, T_HERO) : 0));
      this.blast.material.color.setRGB(0.62, 0.86, 1.0).multiplyScalar(0.7 * k); }

    // ------------------------------------------------------------------ atmosphere
    this.sparkMat.uniforms.uT.value = t;
    this.dust.material.uniforms.uT.value = t; this.bokeh.material.uniforms.uT.value = t;
    this.dust.material.uniforms.uAmp.value = 0.5 + 0.5 * seg(t, 0, 2); this.bokeh.material.uniforms.uAmp.value = seg(t, 0.5, 3);
    this.floorMat.uniforms.uT.value = t; this.floorMat.uniforms.uWave.value = t < T_HERO ? 0 : (t - T_HERO) * 8.5;
    this.floorMat.uniforms.uAmp.value = 0.15 + 0.85 * seg(t, 1.2, 3.5);
    this.back.material.color.setRGB(0.16, 0.32, 1.0).multiplyScalar(0.12 * (0.5 + 0.5 * seg(t, 0.5, 3)) * (1 + 1.4 * hp));
    kit.updateStars(this.stars, t, ctx.px); this.bd.rotation.y = 0.02 * t;

    // ------------------------------------------------------------------ post: hero pulse
    P.bloom = 0.72 + 0.48 * hp + 0.15 * (1 - seg(t, 0, 1.5));
    P.exposure = 1.0 + 0.08 * (t >= T_HERO ? Math.exp(-(t - T_HERO) * 3.2) : 0) + 0.05 * (1 - seg(t, 0, 1.0));
    P.flash = 0;
    P.streak = 0.16 + 0.32 * hp; P.bloomThreshold = 0.85 + 0.2 * hp;
    P.vignette = 0.5;
    P.ca = 0.0016 + 0.0032 * (t >= T_HERO ? Math.exp(-(t - T_HERO) * 4.0) : 0);

    // ------------------------------------------------------------------ typography
    kit.caption(ui, t, { at: 1.6, dur: 3.3, zh: '把一条曲线扫过空间，曲面便诞生了。', en: 'Sweep a curve through space and a surface is born.', key: 'c1' });
    title(ui, t, { at: 3.2, hold: 1.5, zh: '曲面', en: 'Surfaces', kicker: 'CHAPTER 02', x: 150, y: 215, size: 170 });
    kit.caption(ui, t, { at: 5.6, dur: 3.6, zh: '每一点，都有一张切平面，和一个法向。', en: 'Every point has a tangent plane and a normal.', key: 'c2' });
    kit.formula(ui, t, 'fI', String.raw`\begin{aligned}\mathrm{I}&=E\,du^{2}+2F\,du\,dv+G\,dv^{2}\\[4pt]\mathrm{II}&=L\,du^{2}+2M\,du\,dv+N\,dv^{2}\end{aligned}`, { at: 7.3, dur: 99, x: 150, y: 190, size: 46, anchor: 'tl', glow: 10 });
    const ro = seg(t, 7.8, 8.6);
    if (ro > 0.001) {
      // uniform spacing after '=': no padding characters, a true minus sign only where the value is negative
      const f3 = (x) => { const s = Math.abs(x) < 5e-4 ? 0 : x; return (s < 0 ? '&minus;' : '') + Math.abs(s).toFixed(3); };
      const s3 = f3;
      const uw = ((mu % TAU) + TAU) % TAU, vw = ((mv % TAU) + TAU) % TAU, Kc = fr.K >= 0 ? '#ffc861' : '#5ee7ff';
      const lines = [
        `<span style="color:#9fd8ff">(u, v)</span>&nbsp;=&nbsp;(${uw.toFixed(2)}, ${vw.toFixed(2)})`,
        `E=${f3(fr.E)}&nbsp;&nbsp;F=${f3(fr.F)}&nbsp;&nbsp;G=${f3(fr.G)}`,
        `L=${s3(fr.L)}&nbsp;&nbsp;M=${s3(fr.M)}&nbsp;&nbsp;N=${s3(fr.N)}`,
        `<span style="color:${Kc}">K=${s3(fr.K)}&nbsp;&nbsp;H=${s3(fr.H)}</span>`,
        `<span style="color:#a8c4e0">F=M=0&nbsp;&#8658;&nbsp;parameter curves<br>are lines of curvature</span>`,
      ];
      kit.readout(ui, 'ro', lines, { x: 154, y: 400, anchor: 'tl', size: 23, color: '#dff3ff', opacity: ro, track: 0.04 });
    }
  },
};
