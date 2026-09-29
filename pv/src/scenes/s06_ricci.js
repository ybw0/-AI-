// s06_ricci — Ricci 流 / Ricci flow (62–70 s). A spiky, curvature-coloured blob relaxes to a perfect sphere.
// Maths: radial graph f = exp(h) d(u,v), h = sum a_lm(0) e^{-l(l+1) tau} Yhat_lm (spectral flow of the storyboard).
// Curvature K of the mesh is analytic (validated against geom.frame), the tracked-point readout is geom.frame itself,
// and  ∬K dA  is integrated on the mesh every frame -> 4π at every instant (Gauss–Bonnet).
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, palette, orbitCamera, smoothstep, glowTexture, GLSL, TAU } from '../util.js';
import { frame as geomFrame } from '../geom.js';
import * as kit from '../kit.js';
import { RadialSurface, initialCoeffs, hAt, phi, LMAX } from './s06_ricci_sh.js';

const NU = 128, NV = 64, GAIN = 0.55, SEED = 15838;
const HERO = 4.0;
// Flow clock. tauBase is the model time of the heat-kernel flow (linear units, what the readout prints); it is warped
// exponentially so that the high modes die early and the last l=2/3 ovoid is still alive at ~3.9 (tauBase(3.5)~0.04, tauBase(3.9)~0.10).
// snapTau is the flow's final plunge (a smooth ease-in over 3.80 -> 4.02) that melts the last l=2/3 lobes into the sphere on the hit;
// it is part of tauOf(), which is exactly what the readout prints.
const T_S = 1.2, T_K = 2.2, T_0 = 0.000264;
const tauBase = (t) => (t <= T_S ? 0 : T_0 * (Math.exp(T_K * (t - T_S)) - 1));
const snapTau = (t) => 1.6 * Math.pow(seg(t, 3.84, 4.02, ease.linear), 2.4);
const tauOf = (t) => tauBase(t) + snapTau(t);
const camAz = (t) => 0.30 + 0.20 * t;
const beat = (t) => Math.exp(-7 * ((t / 0.5) % 1));           // 120 BPM heartbeat
const fmt = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
const pad = (s, n) => s.padStart(n, ' ');

// ------------------------------------------------------------------------------------------------ small GLSL shaders
const RING_V = `varying vec2 vP; uniform float uS; void main(){ vP = position.xy*uS; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const RING_F = `varying vec2 vP; uniform float uR,uW,uI,uT; uniform vec3 uCol;
  void main(){ float r = length(vP); float d = abs(r-uR); float core = exp(-d*d/(uW*uW)); float halo = 0.22*exp(-d/(uW*6.0));
    float a = atan(vP.y,vP.x); float m = 0.72 + 0.28*sin(a*7.0+uT*1.5)*sin(a*3.0-uT*0.8);
    gl_FragColor = vec4(uCol*(core+halo)*m*uI, 1.0); }`;
const SHELL_V = `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`;
const SHELL_F = `varying vec3 vN; varying vec3 vV; uniform vec3 uCol; uniform float uI;
  void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 5.0); gl_FragColor = vec4(uCol*f*uI, 1.0); }`;
const SPARK_V = `attribute vec3 aP0; attribute vec3 aDir; attribute vec4 aA; attribute vec2 aB; uniform float uT, uPx; varying vec4 vCol;
  void main(){
    float age = (uT - aA.x)/aA.y; float speed = aA.z; float mode = aA.w; float size = aB.x; float typ = aB.y;
    vec3 col = typ < 0.5 ? vec3(1.0,0.72,0.28)*2.4 : (typ < 1.5 ? vec3(0.30,0.85,1.0)*2.4 : vec3(1.0,0.95,0.85)*3.4);
    float alive = step(0.0, age)*step(age, 1.0); float a = clamp(age,0.0,1.0);
    vec3 p; float I;
    if(mode < 0.5){ p = aP0 + aDir*speed*(1.0-(1.0-a)*(1.0-a)); I = smoothstep(0.0,0.06,a)*pow(1.0-a,1.4); }
    else { p = aP0 + aDir*speed*(1.0-a)*(1.0-a)*1.3; I = smoothstep(0.0,0.2,a)*(0.25+a*a*1.8)*(1.0-smoothstep(0.92,1.0,a)); }
    vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
    gl_PointSize = alive*size*uPx*7.0/max(-mv.z,0.5)*(0.7+0.6*I); vCol = vec4(col*I*alive, 1.0);
  }`;
const SPARK_F = `varying vec4 vCol; void main(){ vec2 p = gl_PointCoord-0.5; float d = length(p)*2.0; float a = smoothstep(1.0,0.0,d); a = a*a; gl_FragColor = vec4(vCol.rgb*a, a); }`;
const DUST_V = `attribute vec4 aD; uniform float uT, uPx; uniform vec3 uTint; varying vec3 vC;
  void main(){ vec3 p = position + vec3(sin(uT*0.31+aD.x*6.28), cos(uT*0.23+aD.y*6.28), sin(uT*0.27+aD.z*6.28))*0.35;
    vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv; float tw = 0.55+0.45*sin(uT*1.3+aD.w*40.0);
    gl_PointSize = aD.w*uPx*7.0/max(-mv.z,0.5)*(3.0+3.0*aD.x); vC = uTint*tw*(0.35+0.65*aD.y); }`;
const DUST_F = `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-0.5; float d = length(p)*2.0; float a = smoothstep(1.0,0.0,d); a = a*a; gl_FragColor = vec4(vC*a, a); }`;

// analytic glow disc (no texture => no visible sprite edge / banding): smooth compact falloff, exactly zero at the rim
const GLOW_F = `varying vec2 vP; uniform vec3 uCol; uniform float uI, uPow;
  void main(){ float r = length(vP)*2.0; float a = 1.0 - smoothstep(0.0, 1.0, r); a = pow(a, uPow); gl_FragColor = vec4(uCol*a*uI, 1.0); }`;
const GLOW_V = `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const glowQuad = (depthTest, pw) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexShader: GLOW_V, fragmentShader: GLOW_F, uniforms: { uCol: { value: new THREE.Color(0, 0, 0) }, uI: { value: 1 }, uPow: { value: pw } } })); m.frustumCulled = false; return m; };

export default {
  init(ctx) {
    ctx.background(palette.void);
    const R = ctx.rng(606);
    this.bd = kit.backdrop(ctx, { seed: 9, a: 0x071035, b: 0x24104a, c: 0x0a3050, intensity: 0.75 }); ctx.scene.add(this.bd);
    this.stars = kit.starfield(ctx, { count: 2400, seed: 11, intensity: 0.85 }); ctx.scene.add(this.stars);

    // ---------------------------------------------------------------- the flowing surface
    const { modes, c0 } = initialCoeffs(SEED, GAIN);
    this.modes = modes; this.c0 = c0; this.cur = new Float64Array(c0.length);
    this.S = new RadialSurface(NU, NV, modes);
    const mat = this.mat = kit.surfaceMaterial({ curv: 1, kScale: 0.18, grid: [64, 32], gridW: 1.0, gridI: 0.28, rim: 0.55, spec: 0.3, levels: 4, levelI: 0.25, reveal: 1.01, revealV: 0.0 });
    mat.uniforms.uReveal.value = 1.01;
    mat.uniforms.uPx.value = ctx.px;
    // extra flowing wave band along colatitude
    mat.uniforms.uWave = { value: -1 }; mat.uniforms.uWaveI = { value: 0 }; mat.uniforms.uWaveCol = { value: new THREE.Color(0xffe2a0) };
    mat.fragmentShader = mat.fragmentShader
      .replace('uniform vec2 uGrid;', 'uniform vec2 uGrid; uniform float uWave,uWaveI; uniform vec3 uWaveCol;')
      .replace('col += vec3(0.6,0.9,1.0)*edgeGlow*5.0;', 'col += vec3(0.6,0.9,1.0)*edgeGlow*2.2;')
      .replace('col += vec3(1.0,0.96,0.85)*uLevelI*lc;', 'col += vec3(1.0,0.96,0.85)*uLevelI*lc*(1.0 - smoothstep(0.12, 0.40, fwidth(lk)));')
      .replace('gl_FragColor = vec4(col, uAlpha);', 'float wv = exp(-pow((vUv.y - uWave)/0.05, 2.0)); col += uWaveCol*wv*uWaveI*(0.5+fr); gl_FragColor = vec4(col, uAlpha);');
    mat.needsUpdate = true;
    this.mesh = new THREE.Mesh(this.S.geo, mat); this.mesh.frustumCulled = false; ctx.scene.add(this.mesh);
    // initial pass -> pick the tracked material point (sharp positive-curvature spike facing the camera at t~1)
    const st0 = this.S.update(c0); this.st0 = st0;
    let best = -1, bi = 0; const uFace = Math.PI / 2 - camAz(1.0);
    for (let i = 0; i <= NU; i++) for (let j = 12; j <= NV - 12; j++) {
      const u = (TAU * i) / NU, v = (Math.PI * j) / NV; let du = Math.atan2(Math.sin(u - uFace - 0.22), Math.cos(u - uFace - 0.22));
      if (Math.abs(du) > 0.3 || v < 0.95 || v > 2.0) continue;
      const idx = i * (NV + 1) + j, K = this.S.Karr[idx], rr = Math.hypot(this.S.pos[idx * 3], this.S.pos[idx * 3 + 1], this.S.pos[idx * 3 + 2]);
      const sc = Math.min(K, 250) + rr * 30; if (sc > best) { best = sc; bi = idx; }
    }
    this.tp = { u: (TAU * Math.floor(bi / (NV + 1))) / NU, v: (Math.PI * (bi % (NV + 1))) / NV, idx: bi };

    // ---------------------------------------------------------------- halo, dust
    this.halo = glowQuad(true, 2.2); this.halo.renderOrder = -5; ctx.scene.add(this.halo);
    this.flashSp = glowQuad(false, 2.6); this.flashSp.renderOrder = 5; ctx.scene.add(this.flashSp);
    const nd = 520, dp = new Float32Array(nd * 3), dd = new Float32Array(nd * 4);
    for (let i = 0; i < nd; i++) {
      const u = R() * 2 - 1, a = R() * TAU, s = Math.sqrt(1 - u * u), rad = 2.6 + 11 * Math.pow(R(), 0.7);
      dp.set([rad * s * Math.cos(a), rad * u * 0.75, rad * s * Math.sin(a)], i * 3); dd.set([R(), R(), R(), 0.25 + 0.75 * R() * R()], i * 4);
    }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('aD', new THREE.BufferAttribute(dd, 4));
    this.dustMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: DUST_V, fragmentShader: DUST_F, uniforms: { uT: { value: 0 }, uPx: { value: ctx.px }, uTint: { value: new THREE.Color(0.35, 0.6, 1.0) } } });
    this.dust = new THREE.Points(dg, this.dustMat); this.dust.frustumCulled = false; ctx.scene.add(this.dust);

    // ---------------------------------------------------------------- sparks: gold shed from peaks, cyan filling the dents, hero burst, loop-collapse burst
    this.loopAxis = (() => { const az = camAz(6.8), el = 0.34; const cx = Math.sin(az) * Math.cos(el), cy = Math.sin(el), cz = Math.cos(az) * Math.cos(el);
      const rx = Math.cos(az), rz = -Math.sin(az); const v = new THREE.Vector3(cx + rx * 0.18, cy + 0.12, cz + rz * 0.18).normalize(); return v; })();
    const sp = [];  // {P0[3], dir[3], tb, life, speed, mode, size, typ}
    const coefAt = (t) => { const ta = tauOf(t); return Float64Array.from(c0, (c, q) => c * Math.exp(-modes[q].l * (modes[q].l + 1) * ta)); };
    for (let i = 0; i < 430; i++) {
      const tb = 0.9 + 3.05 * Math.pow(R(), 0.85), c = coefAt(tb), inward = R() < 0.42; let bestS = null, bs = inward ? 1e9 : -1e9;
      for (let k = 0; k < 26; k++) {
        const uu = R() * TAU, vv = Math.acos(2 * R() - 1), h = hAt(uu, vv, modes, c);
        if (inward ? h < bs : h > bs) { bs = h; bestS = [uu, vv]; }
      }
      const [uu, vv] = bestS, d = [Math.sin(vv) * Math.cos(uu), Math.cos(vv), Math.sin(vv) * Math.sin(uu)], r0 = Math.exp(phi(hAt(uu, vv, modes, c)));
      sp.push({ P0: d.map((x) => x * r0), dir: d, tb, life: inward ? 0.9 + 0.7 * R() : 0.8 + 0.9 * R(), speed: inward ? 0.5 + 0.9 * R() : 0.7 + 1.5 * R(), mode: inward ? 1 : 0, size: 3.5 + 6 * R() * R(), typ: inward ? 1 : 0 });
    }
    for (let i = 0; i < 300; i++) {   // hero burst
      const uz = R() * 2 - 1, a = R() * TAU, s = Math.sqrt(1 - uz * uz), d = [s * Math.cos(a), uz, s * Math.sin(a)], big = R() < 0.18;
      sp.push({ P0: d.map((x) => x * 1.01), dir: d, tb: HERO + R() * 0.06, life: 1.1 + 1.6 * R(), speed: 1.2 + 6.5 * Math.pow(R(), 0.8), mode: 0, size: big ? 9 + 8 * R() : 3 + 5 * R(), typ: R() < 0.55 ? 0 : 2 });
    }
    const ax = this.loopAxis, pc = [ax.x * 1.012, ax.y * 1.012, ax.z * 1.012];
    for (let i = 0; i < 90; i++) {   // loop collapse burst
      const d = new THREE.Vector3(ax.x + (R() - 0.5) * 1.6, ax.y + (R() - 0.5) * 1.6, ax.z + (R() - 0.5) * 1.6).normalize();
      sp.push({ P0: pc, dir: [d.x, d.y, d.z], tb: 7.55 + R() * 0.05, life: 0.9 + 1.0 * R(), speed: 0.25 + 1.1 * R(), mode: 0, size: 3 + 5 * R(), typ: R() < 0.5 ? 2 : 1 });
    }
    const ns = sp.length, P0 = new Float32Array(ns * 3), DIR = new Float32Array(ns * 3), A = new Float32Array(ns * 4), B = new Float32Array(ns * 2);
    sp.forEach((s, i) => { P0.set(s.P0, i * 3); DIR.set(s.dir, i * 3); A.set([s.tb, s.life, s.speed, s.mode], i * 4); B.set([s.size, s.typ], i * 2); });
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(P0.slice(), 3));
    sg.setAttribute('aP0', new THREE.BufferAttribute(P0, 3)); sg.setAttribute('aDir', new THREE.BufferAttribute(DIR, 3));
    sg.setAttribute('aA', new THREE.BufferAttribute(A, 4)); sg.setAttribute('aB', new THREE.BufferAttribute(B, 2));
    this.sparkMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: SPARK_V, fragmentShader: SPARK_F, uniforms: { uT: { value: 0 }, uPx: { value: ctx.px } } });
    this.sparks = new THREE.Points(sg, this.sparkMat); this.sparks.frustumCulled = false; ctx.scene.add(this.sparks);

    // ---------------------------------------------------------------- rings (energy pulses) + hero shells + rays
    const ringMat = (col) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexShader: RING_V, fragmentShader: RING_F,
      uniforms: { uS: { value: 1 }, uR: { value: 1 }, uW: { value: 0.05 }, uI: { value: 1 }, uT: { value: 0 }, uCol: { value: new THREE.Color(col) } } });
    const ringDefs = [];
    [1.5, 2.0, 2.5, 3.0, 3.5].forEach((t0, i) => ringDefs.push({ t0, dur: 1.15, R0: 1.15, R1: 2.2 + i * 0.3, I: 0.30 + 0.10 * i, W: 0.02, col: palette.cyan, rx: 0, rz: 0 }));
    ringDefs.push({ t0: HERO, dur: 1.9, R0: 1.0, R1: 7.5, I: 1.7, W: 0.05, col: 0xffe6b0, rx: 0, rz: 0 });
    ringDefs.push({ t0: HERO + 0.06, dur: 1.7, R0: 1.0, R1: 5.5, I: 1.0, W: 0.04, col: palette.cyan, rx: 1.15, rz: 0.4 });

    ringDefs.push({ t0: HERO + 0.45, dur: 1.6, R0: 1.05, R1: 4.0, I: 0.6, W: 0.03, col: palette.ice, rx: 0.3, rz: 0.2 });
    ringDefs.push({ t0: 7.58, dur: 1.2, R0: 0.05, R1: 1.7, I: 0.8, W: 0.02, col: palette.ice, rx: 0, rz: 0, axis: true });
    this.rings = ringDefs.map((d) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMat(d.col)); m.rotation.order = 'YXZ';
      if (d.axis) { m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.loopAxis); m.position.copy(this.loopAxis).multiplyScalar(1.05); m.material.depthTest = false; }
      else { m.rotation.x = -Math.PI / 2 + d.rx; m.rotation.z = d.rz; }
      m.frustumCulled = false; m.visible = false; ctx.scene.add(m); return { d, m };
    });
    const shellMat = (col) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexShader: SHELL_V, fragmentShader: SHELL_F, uniforms: { uCol: { value: new THREE.Color(col) }, uI: { value: 0 } } });
    this.shells = [{ t0: HERO, dur: 1.4, R1: 3.2, I: 1.2, col: 0xffdca0 }].map((d) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 36), shellMat(d.col)); m.frustumCulled = false; m.visible = false; ctx.scene.add(m); return { d, m };
    });
    const rp = []; for (let i = 0; i < 56; i++) {
      const uz = R() * 2 - 1, a = R() * TAU, s = Math.sqrt(1 - uz * uz), d = [s * Math.cos(a), uz, s * Math.sin(a)], l0 = 1.06 + 0.3 * R(), l1 = l0 + 0.35 + 1.9 * Math.pow(R(), 1.6);
      rp.push(d[0] * l0, d[1] * l0, d[2] * l0, d[0] * l1, d[1] * l1, d[2] * l1);
    }
    this.rays = ctx.fatSegments(rp, { color: 0xffe2a8, width: 1.2, intensity: 1.4, opacity: 0.8 }); this.rays.visible = false; ctx.scene.add(this.rays);

    // ---------------------------------------------------------------- post-hero: geodesic great circles (K = const -> all closed) and the Poincare loop
    this.circles = [];
    const gc = (n1, n2) => { const pts = []; for (let i = 0; i <= 200; i++) { const a = (TAU * i) / 200; pts.push([1.012 * (n1[0] * Math.cos(a) + n2[0] * Math.sin(a)), 1.012 * (n1[1] * Math.cos(a) + n2[1] * Math.sin(a)), 1.012 * (n1[2] * Math.cos(a) + n2[2] * Math.sin(a))]); } return pts; };
    const cdefs = [[[1, 0, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 1]]];
    this.circGroup = new THREE.Group(); ctx.scene.add(this.circGroup);
    cdefs.forEach(([a, b], i) => {
      const pts = gc(a, b), core = ctx.fatLine(pts, { color: palette.ice, width: 2.8, intensity: 1.7 }), glow = ctx.fatLine(pts, { color: palette.cyan, width: 10, intensity: 0.3, opacity: 0.7 });
      core.frustumCulled = glow.frustumCulled = false; const g = new THREE.Group(); g.add(glow, core); g.rotation.set(0.5 * i + 0.4, 0.9 * i, 0.3 * i); this.circGroup.add(g); this.circles.push({ core, glow, g });
    });
    const NL = 160, lp = []; for (let i = 0; i <= NL; i++) lp.push([0, 0, 0].map((_, k) => (k === 0 ? 1 + i * 1e-4 : 0)));
    this.loopCore = ctx.fatLine(lp, { color: palette.white, width: 5.0, intensity: 3.6 }); this.loopGlow = ctx.fatLine(lp, { color: palette.cyan, width: 16, intensity: 0.7, opacity: 0.8 });
    this.loopCore.frustumCulled = this.loopGlow.frustumCulled = false; ctx.scene.add(this.loopGlow, this.loopCore); this.NL = NL;
    this.loopSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })); ctx.scene.add(this.loopSprite);
    this.tpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })); ctx.scene.add(this.tpSprite);
    // loop frame
    const a = this.loopAxis, up = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    this.e1 = new THREE.Vector3().crossVectors(a, up).normalize(); this.e2 = new THREE.Vector3().crossVectors(a, this.e1).normalize();
    this._v = new THREE.Vector3(); this._c = new THREE.Color();
  },

  update(t, ctx) {
    const { S, modes, c0, cur, mat } = this; const ui = ctx.ui;
    const tau = tauOf(t), env = 1 - seg(t, 0, 3.7, ease.linear), bt = beat(t);
    // ------------------------------------------------ the flow: decay the spectrum, rebuild the surface + true curvature
    for (let q = 0; q < c0.length; q++) {
      const l = modes[q].l;
      cur[q] = c0[q] * Math.exp(-l * (l + 1) * tau) * (1 + (l >= 4 ? 0.09 : 0.04) * env * bt * (1 + 0.5 * Math.sin(q * 1.7)));
    }
    const st = S.update(cur);

    // ------------------------------------------------ material states
    const hero = t - HERO, post = smoothstep(HERO, HERO + 0.02, t);
    mat.uniforms.uTime.value = t;
    mat.uniforms.uRevealV.value = (0.30 + 0.70 * ease.outCubic(clamp(t / 1.5))) * 1.04;
    const endUp = seg(t, 8.3, 9.05, ease.inOutCubic);   // outgoing sphere brightens into the finale's white flash
    mat.uniforms.uKScale.value = lerp(0.032, 0.40, ease.inOutCubic(seg(t, 2.2, 4.1)));
    mat.uniforms.uLevelI.value = 0.28 - 0.13 * seg(t, 1.8, 2.6) - 0.15 * seg(t, 3.6, 3.95);
    mat.uniforms.uGridI.value = lerp(0.28, 0.5, seg(t, 3.0, 3.9)) * (1 - 0.4 * seg(t, 4.3, 4.9)) + 1.0 * Math.exp(-Math.max(hero, 0) / 0.35) * post + 0.12 * Math.sin(t * 1.5);
    mat.uniforms.uEmis.value = 0.10 + 0.16 * env * bt + 0.10 * seg(t, 3.0, 3.98) + 0.03 * post * Math.exp(-Math.max(hero, 0) / 0.30) + 0.03 * post + 0.50 * endUp;
    mat.uniforms.uRim.value = lerp(0.55, 1.05, seg(t, 3.0, 3.98)) * (1 - 0.24 * seg(t, 4.3, 4.9)) + 0.30 * post * Math.exp(-Math.max(hero, 0) / 0.5);
    mat.uniforms.uWave.value = -1 + 2.15 * ease.outCubic(clamp(hero / 1.5)) * post; mat.uniforms.uWaveI.value = 0.9 * post * (1 - seg(t, HERO + 0.2, HERO + 1.5, ease.linear));
    mat.uniforms.uRimCol.value.set(palette.cyan).lerp(this._c.set(0x9fe9ff), post * 0.5);
    // sphere spin after the hero: slow, elegant, eased in
    this.mesh.rotation.y = 0.7 * (Math.max(t - HERO, 0) + 0.6 * (1 - Math.exp(-Math.max(t - HERO, 0) * 1.4)));
    this.mesh.rotation.x = 0.0;

    // ------------------------------------------------ camera: slow orbit + push, decisive lunge at the hero, right-of-centre composition
    const push = ease.inOutCubic(seg(t, 0, 3.9)), settle = ease.inOutCubic(seg(t, HERO, 8.8));
    const lunge = smoothstep(HERO - 0.12, HERO + 0.02, t) * Math.exp(-Math.max(t - HERO - 0.02, 0) / 0.55);
    let r = lerp(11.2, 6.5, push) + 1.5 * Math.sin(Math.PI * seg(t, 0.4, HERO)) + (t > HERO ? lerp(0, -1.3, settle) : 0) - 1.1 * lunge;
    const az = camAz(t) + 0.02 * lunge, el = 0.20 + 0.10 * Math.sin(0.55 * t) + 0.06 * seg(t, 3.5, 4.4);
    orbitCamera(ctx.camera, { r, az, el, roll: 0.018 * Math.sin(0.4 * t) - 0.02 * lunge });
    const hh = r * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2));
    ctx.camera.translateX(-0.14 * hh * ctx.aspect); ctx.camera.translateY(-0.17 * hh);
    ctx.camera.updateMatrixWorld(); ctx.camera.updateProjectionMatrix();

    // ------------------------------------------------ background: halo cools -> warms, dust, stars
    kit.updateStars(this.stars, t); this.bd.rotation.y = 0.012 * t; this.bd.rotation.x = 0.004 * t;
    const warm = post; const haloI = 0.10 + 0.10 * seg(t, 1.0, 3.9) + 0.08 * post * (0.5 + 0.5 * Math.exp(-Math.max(hero, 0) / 0.6)) + 0.10 * endUp;
    this.halo.material.uniforms.uCol.value.copy(this._c.set(palette.violet)).lerp(this._c2 || (this._c2 = new THREE.Color(0xd99a48).lerp(new THREE.Color(palette.violet), 0.15)), warm).multiplyScalar(haloI);
    this.halo.material.uniforms.uI.value = 1;
    this.halo.quaternion.copy(ctx.camera.quaternion); this.halo.position.copy(this._v.set(0, 0, -2.5).applyQuaternion(ctx.camera.quaternion));
    { const fa = t >= HERO ? Math.exp(-(t - HERO) / 0.10) : 0; this.flashSp.visible = fa > 0.01; this.flashSp.quaternion.copy(ctx.camera.quaternion); this.flashSp.position.copy(this._v.set(0, 0, -1.2).applyQuaternion(ctx.camera.quaternion)); this.flashSp.scale.setScalar(7 + 6 * (1 - fa)); this.flashSp.material.uniforms.uCol.value.set(0xffe8c0).multiplyScalar(0.30 * fa); }
    this.halo.scale.setScalar(lerp(13, 15, seg(t, 3.0, 4.6)) * (1 + 0.4 * lunge));
    this.dustMat.uniforms.uT.value = t; this.dustMat.uniforms.uTint.value.set(0.30, 0.55, 1.0).lerp(this._c.set(1.0, 0.72, 0.35), warm * 0.85).multiplyScalar(0.55 + 0.6 * lunge + 0.6 * seg(t, 5.5, 7.0));
    this.sparkMat.uniforms.uT.value = t;

    // ------------------------------------------------ rings / shells / rays
    for (const { d, m } of this.rings) {
      const age = (t - d.t0) / d.dur, on = age > 0 && age < 1; m.visible = on; if (!on) continue;
      const Rr = lerp(d.R0, d.R1, ease.outCubic(age)), u = m.material.uniforms, W = d.W * (1 + 2.2 * age);
      u.uR.value = Rr; u.uW.value = W; u.uS.value = Rr + 40 * W; u.uI.value = d.I * Math.pow(1 - age, 1.7) * smoothstep(0, 0.04, age); u.uT.value = t; m.scale.setScalar(Rr + 40 * W);
    }
    for (const { d, m } of this.shells) {
      const age = (t - d.t0) / d.dur, on = age > 0 && age < 1; m.visible = on; if (!on) continue;
      m.scale.setScalar(lerp(1.02, d.R1, ease.outExpo(age))); m.material.uniforms.uI.value = d.I * Math.pow(1 - age, 1.6);
    }
    { const age = (t - HERO) / 1.25, on = age > 0 && age < 1; this.rays.visible = on;
      if (on) { const s = lerp(1, 3.2, ease.outExpo(age)); this.rays.scale.setScalar(s); this.rays.material.opacity = 0.8 * Math.pow(1 - age, 1.3) * smoothstep(0, 0.03, age); this.rays.rotation.y = 0.15 * age; } }

    // ------------------------------------------------ post-hero geometry: great circles + Poincare loop
    this.circGroup.rotation.y = this.mesh.rotation.y * 1.3 + 0.22 * Math.max(t - 5.0, 0);
    this.circles.forEach((c, i) => {
      const p = seg(t, 4.35 + 0.25 * i, 5.5 + 0.25 * i, ease.inOutCubic); c.core.visible = c.glow.visible = p > 0.001;
      c.core.geometry.instanceCount = c.glow.geometry.instanceCount = Math.max(1, Math.floor(p * 200));
      c.g.rotation.x += 0; c.g.rotation.z = 0.3 * i + 0.12 * (t - 4) * (i % 2 ? 1 : -1);
      const fade = 1 - 0.6 * seg(t, 7.0, 8.0); c.core.material.opacity = fade; c.glow.material.opacity = 0.7 * fade;
    });
    // loop
    const lp = seg(t, 5.7, 6.5, ease.outCubic), th0 = 1.1 * (1 - ease.inOutCubic(seg(t, 6.3, 7.55, ease.linear)));
    const vis = lp > 0.001 && t < 7.62; this.loopCore.visible = this.loopGlow.visible = vis;
    if (vis) {
      const a = this.loopAxis, pts = new Float32Array((this.NL + 1) * 3), e1 = this.e1, e2 = this.e2, wob = 1 + 0.5 * (1 - ease.inOutCubic(seg(t, 6.3, 7.55)));
      for (let i = 0; i <= this.NL; i++) {
        const ph = (TAU * i) / this.NL, th = Math.min(3.0, th0 * (1 + 0.22 * Math.sin(2 * ph + 0.8 + 0.6 * t) * wob + 0.12 * Math.sin(3 * ph + 2.0 - 0.5 * t)));
        const s = Math.sin(th), c = Math.cos(th), cp = Math.cos(ph) * s, sp = Math.sin(ph) * s;
        pts[i * 3] = 1.014 * (a.x * c + e1.x * cp + e2.x * sp); pts[i * 3 + 1] = 1.014 * (a.y * c + e1.y * cp + e2.y * sp); pts[i * 3 + 2] = 1.014 * (a.z * c + e1.z * cp + e2.z * sp);
      }
      this.loopCore.geometry.setPositions(pts); this.loopGlow.geometry.setPositions(pts);
      const n = Math.max(2, Math.floor(lp * this.NL)); this.loopCore.geometry.instanceCount = this.loopGlow.geometry.instanceCount = n;
      const f = 1 - seg(t, 7.35, 7.6, ease.linear); this.loopCore.material.opacity = f; this.loopGlow.material.opacity = 0.8 * f;
    }
    { const a = this.loopAxis, sc = 0.45 * smoothstep(6.2, 7.5, t) * (t < 7.6 ? 1 : 0) + 0.7 * Math.exp(-Math.abs(t - 7.58) / 0.12) * smoothstep(7.5, 7.58, t) * (t > 7.5 ? 1 : 0) + 0.28 * smoothstep(7.6, 8.3, t) * (0.8 + 0.2 * Math.sin(t * 6));
      this.loopSprite.position.set(a.x * 1.02, a.y * 1.02, a.z * 1.02); this.loopSprite.scale.setScalar(Math.max(sc, 0.001)); this.loopSprite.material.color.set(0xfff2d8).multiplyScalar(2.0 * (sc > 0.001 ? 1 : 0)); this.loopSprite.visible = sc > 0.002; }

    // ------------------------------------------------ the tracked material point (geom.frame readout)
    const f = (u, v) => { const h = Math.exp(phi(hAt(u, v, modes, cur))); return [h * Math.sin(v) * Math.cos(u), h * Math.cos(v), h * Math.sin(v) * Math.sin(u)]; };
    const fr = geomFrame(f, this.tp.u, this.tp.v, 1e-3);
    const wp = new THREE.Vector3(fr.p[0], fr.p[1], fr.p[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
    const proj = wp.clone().project(ctx.camera); const sx = (proj.x * 0.5 + 0.5) * 1920, sy = (1 - (proj.y * 0.5 + 0.5)) * 1080;
    const nrm = new THREE.Vector3(...fr.n).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y), toCam = ctx.camera.position.clone().sub(wp).normalize();
    const face = smoothstep(0.05, 0.4, nrm.dot(toCam));
    const tpv = smoothstep(0.35, 0.65, t) * (1 - smoothstep(1.15, 1.42, t)) * face;
    this.tpSprite.position.copy(wp); this.tpSprite.scale.setScalar(0.34 + 0.1 * Math.sin(t * 9)); this.tpSprite.material.color.set(0xfff0d0).multiplyScalar(1.8 * tpv); this.tpSprite.visible = tpv > 0.01;
    if (tpv > 0.01) {
      const lx = Math.min(Math.max(sx + 260, 1400), 1440), ly = Math.max(sy - 110, 180);
      ui.circle('tpc', sx, sy, 16 + 2 * Math.sin(t * 9), { stroke: '#fff2d8', width: 2, opacity: tpv * 0.9, glow: 8, glowColor: '#ffc861' });
      ui.path('tpl', `M${sx + 12} ${sy - 12} L${lx - 10} ${ly + 16} L${lx + 340} ${ly + 16}`, { stroke: '#ffc861', width: 1.8, opacity: tpv * 0.85, progress: seg(t, 0.4, 0.8, ease.linear), glow: 5 });
      ui.text('tpt', `<span style="white-space:pre">κ₁ ${fmt(-fr.k1)}   κ₂ ${fmt(-fr.k2)}<br><span style="font-size:34px;color:#ffc861">K = κ₁κ₂ = ${fmt(fr.K)}</span></span>`, { x: lx, y: ly + 8, anchor: 'bl', size: 26, font: 'mono', color: '#dff4ff', opacity: tpv, lh: 1.4, reveal: seg(t, 0.55, 0.95, ease.linear), revealMode: 'mask', glow: 6 });
    }

    // ------------------------------------------------ post grade (hero: inhale, flash, bloom surge, CA kick)
    const inh = seg(t, 3.5, 3.98, ease.inOutQuad), sur = post * Math.exp(-Math.max(hero, 0) / 0.5);
    ctx.post.exposure = 1.0 - 0.10 * inh * (1 - post) + 0.02 * sur + 0.14 * endUp;
    ctx.post.bloomScatter = 0.74 - 0.12 * sur; ctx.post.bloom = 0.72 + 0.26 * inh * (1 - post) + 0.20 * sur + 0.15 * seg(t, 4.6, 6, ease.linear) + 0.65 * endUp;
    ctx.post.flash = t >= HERO ? 0.018 * Math.exp(-(t - HERO) / 0.04) : 0;
    ctx.post.streak = 0.08 + 0.04 * sur + 0.05 * endUp; ctx.post.ca = 0.0012 + 0.0008 * sur;
    ctx.post.vignette = 0.55 + 0.12 * inh * (1 - post); ctx.post.grain = 0.03;
    if (t < 0.9) ctx.post.exposure *= 0.9 + 0.1 * smoothstep(0, 0.9, t);

    // ------------------------------------------------ overlay (<= 3 text things at any time)
    //   0.6-1.9  tracked-point label + model-flow readout (+ the title starting at 1.3)
    //   1.3-4.0  title block, caption c1 (2.1-4.0), readout until 3.95      4.0-4.9  no readouts (burst)
    //   4.9-5.6  'K = const' readout + c2 (4.6-8.3)      5.7-9.6  formula        6.5-9.4  credit
    kit.chapterTitle(ui, t, { at: 0.8, hold: 1.1, zh: 'Ricci 流', en: 'Ricci Flow', kicker: 'CHAPTER 07', sub: '曲率之流，抚平一切褶皱', size: 150, x: 170, y: 190 });
    const cap = (key, at, dur, zh, en, fi = 0.4) => { // kit.caption look, bottom-left so the long spikes of the mid-flow surface never sit behind it
      const v = pulse(t, at, at + dur, fi, 0.4);
      if (v <= 0.001) return;
      ui.text(key + 'z', zh, { x: 170, y: 930, anchor: 'bl', size: 48, weight: 600, color: '#f4f8ff', glow: 14, opacity: v, reveal: seg(t, at, at + 0.8, ease.linear), spread: 0.7, track: 0.14, align: 'left' });
      ui.text(key + 'e', en, { x: 172, y: 944, anchor: 'tl', size: 26, font: 'en', italic: true, color: '#b8dcff', opacity: v * 0.9, track: 0.16, reveal: seg(t, at + 0.25, at + 1.0, ease.linear), revealMode: 'mask', align: 'left' });
    };
    cap('c1', 1.4, 2.6, 'Ricci 流：让任意形状归于圆润。', 'Ricci flow: every shape relaxes toward roundness.');
    cap('c2', 4.6, 3.3, '最终，只剩下最简单的几何。', 'In the end, only the simplest geometry remains.', 0.55);
    kit.formula(ui, t, 'f', String.raw`\partial_t\, g_{ij}=-2R_{ij}`, { at: 6.0, dur: 3.6, x: 170, y: 205, size: 84, anchor: 'tl', glow: 14 });
    // credit
    const cv = pulse(t, 6.5, 9.4, 0.8, 0.6);
    if (cv > 0.001) {
      ui.line('crl', 172, 642, 172, 806, { stroke: '#ffc861', width: 2.5, opacity: cv * 0.9, progress: seg(t, 6.5, 7.3, ease.linear), glow: 6 });
      ui.text('crz', '格里戈里·佩雷尔曼', { x: 200, y: 640, anchor: 'tl', size: 42, weight: 600, color: '#f4f8ff', glow: 12, opacity: cv, reveal: seg(t, 6.6, 7.6, ease.linear), spread: 0.7, track: 0.12 });
      ui.text('cry', '庞加莱猜想 · 2003', { x: 200, y: 706, anchor: 'tl', size: 32, weight: 400, color: '#ffc861', opacity: cv, reveal: seg(t, 6.9, 7.8, ease.linear), revealMode: 'mask', track: 0.14, glow: 8 });
      ui.text('cre', 'Grigori Perelman · Poincaré Conjecture · 2003', { x: 202, y: 758, anchor: 'tl', size: 32, font: 'en', italic: true, color: '#cfe6ff', opacity: cv * 0.95, reveal: seg(t, 7.1, 8.0, ease.linear), revealMode: 'mask', track: 0.1 });
    }
    // model-flow readout. Honest labelling: this is the heat-kernel (spectral) model of the flow, tau printed only pre-hero, in linear units.
    const ro = t < HERO ? smoothstep(0.9, 1.4, t) * (1 - smoothstep(3.6, 3.95, t)) : smoothstep(4.35, 4.75, t) * (1 - smoothstep(5.6, 6.0, t));
    if (ro > 0.001) {
      const big = (x) => (Math.abs(x) >= 1000 ? (x > 0 ? '>10³' : '<−10³') : fmt(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2));
      const n = (x) => pad(big(x), 6);
      let html;
      if (t < HERO) {
        const gbq = Math.abs(st.GBq - st.GB) < 0.005 * st.GB;   // quadrature line only once the mesh resolves the spikes
        html = `<span style="color:#8fd8ff">MODEL FLOW</span>  τ = ${tau.toFixed(3)}<br>Kmax ${n(st.Kmax)}   Kmin ${n(st.Kmin)}<br>∬K dA = ${st.GB.toFixed(3)} = 4π  <span style="color:#8fd8ff">Gauss map</span>` +
          (gbq ? `<br>∬K dA = ${st.GBq.toFixed(3)}       <span style="color:#8fd8ff">Σ K·dA</span>` : '') + `<br><span style="color:#8fd8ff">heat-kernel modes  aℓ ∝ e^(−ℓ(ℓ+1)τ)</span>`;
      } else {
        html = `<span style="color:#ffc861">MODEL FLOW</span>  τ → ∞<br><span style="color:#ffc861;font-size:36px;text-shadow:0 0 14px #ffb347">K ≡ const = ${(0.5 * (st.Kmax + st.Kmin)).toFixed(3)}</span><br>∬K dA = ${st.GB.toFixed(3)} = 4π`;
      }
      ui.text('ro', `<span style="white-space:pre">${html}</span>`, { x: 170, y: t < HERO ? 560 : 660, anchor: 'tl', size: 24, font: 'mono', color: '#f0faff', opacity: ro, lh: 1.6, track: 0.02, glow: 5 });
    }
  },

  beats: [
    { t: 1.0, kind: 'swell', label: 'flow begins' },
    { t: 1.5, kind: 'tick', label: 'l=9 falls' }, { t: 2.0, kind: 'tick' }, { t: 2.5, kind: 'tick' }, { t: 3.0, kind: 'tick' }, { t: 3.5, kind: 'swell', label: 'last bump' },
    { t: 4.0, kind: 'hit', label: 'perfect sphere' },
    { t: 4.6, kind: 'sparkle' }, { t: 7.55, kind: 'sparkle', label: 'loop contracts to a point' },
  ],
};
