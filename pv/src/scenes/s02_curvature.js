// s02_curvature — 曲率 · Curvature (20–32 s).  hero 6.0 · build 2.0 · climax 10.0
// Act A: three archetypal patches (dome K>0 / rolled sheet K=0 / saddle K<0) with their real principal-curvature (osculating) circles.
//        K = κ1 κ2 builds; everything dissolves into a stream of light that converges on a torus…
// HERO 6.0: the torus ignites with its true Gaussian-curvature heat map.
// Act B: Theorema Egregium — the torus collapses to the catenoid's waist and the catenoid bends into the helicoid (θ: π/2 → −π/2)
//        while K(u,v) = −1/cosh⁴ v stays glued to every material point.
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, smoothstep, palette, orbitCamera, TAU, rng, glowTexture } from '../util.js';
import { frame, parametricGeometry, surfaces } from '../geom.js';
import * as kit from '../kit.js';

const PI = Math.PI;
const HERO = 6.0;
const RP = 1.5;                       // patch disc radius
const PX = [-3.75, 0, 3.75];            // patch centres (x)
const FLOOR_Y = -2.5;
const TR = 1.7, Tr = 0.7;             // torus R, r
const CAT_S = 0.8;                    // catenoid world scale
const VMAX = 1.5;
const U0 = 0.7, V0 = 0.55;            // tracked material point on catenoid/helicoid (u,v)
const TILT = 0.95, TILTZ = 0.22;      // torus tilt at the hero (hole opens toward the camera so the K<0 inner wall is visible)
const GOLD = '#ffc861', CYAN = '#5ee7ff', VIOLET = '#b7a0ff';

// ------------------------------------------------------------------------------------------------ patch base surfaces B(x,z)
const DOME = { a: 0.85, b: 1.5 };
const SAD = { a: 1.6, b: 1.0 };
const domeB = (x, z) => [x, -(DOME.a * x * x + DOME.b * z * z) / 2, z];
const saddleB = (x, z) => [x, (SAD.a * z * z - SAD.b * x * x) / 2, z];
const sheetB = (c) => (x, z) => (Math.abs(c) < 1e-4 ? [x, (c * x * x) / 2, z] : [Math.sin(c * x) / c, (1 - Math.cos(c * x)) / c, z]);
const polar = (B) => (rho, phi) => B(rho * Math.cos(phi), -rho * Math.sin(phi));
const upF = (B) => (u, v) => B(v, u);            // orientation with normal = +y
const PDOM = { nu: 22, nv: 96, u0: 0.02, u1: RP, v0: 0, v1: TAU };

// ------------------------------------------------------------------------------------------------ small helpers
const _p = new THREE.Vector3();
const toScr = (cam, x, y, z) => { _p.set(x, y, z).project(cam); return [(_p.x * 0.5 + 0.5) * 1920, (0.5 - _p.y * 0.5) * 1080]; };
const fmt = (v, d = 3) => { if (Math.abs(v) < 0.5 * Math.pow(10, -d)) v = 0; return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d); };
const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** points on the osculating circle (normal section) at p: centre p + n/k, radius 1/|k|. half = half-angle of the arc drawn */
function arcPts(p, n, k, e, half = PI, N = 96) {
  const r = 1 / Math.abs(k), s = Math.sign(k) || 1;
  const c = add3(p, n, 1 / k), d0 = [-s * n[0], -s * n[1], -s * n[2]];
  const out = [];
  for (let i = 0; i <= N; i++) {
    const a = -half + (2 * half * i) / N, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    out.push(c[0] + ca * d0[0] + sa * e[0], c[1] + ca * d0[1] + sa * e[1], c[2] + ca * d0[2] + sa * e[2]);
  }
  return out;
}
const linePts = (p, e, L, N = 96) => { const o = []; for (let i = 0; i <= N; i++) { const s = -L + (2 * L * i) / N; o.push(p[0] + e[0] * s, p[1] + e[1] * s, p[2] + e[2] * s); } return o; };

// ------------------------------------------------------------------------------------------------ custom point materials
function dustMaterial(ctx) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uPx: { value: ctx.px }, uA: { value: 1 } },
    vertexShader: `attribute float aS; attribute float aPh; attribute vec3 aV; attribute vec3 aC; uniform float uT,uPx,uA; varying float vA; varying vec3 vC;
      void main(){ vec3 BOX = vec3(26.,11.,18.); vec3 p = position + aV*uT; p = mod(p + BOX*0.5, BOX) - BOX*0.5; p.y += 0.5;
        vec4 mv = modelViewMatrix*vec4(p,1.); float d = max(-mv.z, 0.5);
        gl_PointSize = clamp(aS*uPx*34./d, 1.0, 26.*uPx); vA = uA*(0.55+0.45*sin(uT*0.9+aPh))*smoothstep(1.2,4.0,d); vC = aC; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC; void main(){ vec2 q = gl_PointCoord-0.5; float d = length(q)*2.; float a = smoothstep(1.,0.,d); a = a*a*a; gl_FragColor = vec4(vC*a*vA*1.6, a*vA); }`,
  });
}

/** light particles that peel off the three patches and converge onto the torus (position is a pure function of uT) */
function convergeMaterial(ctx) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uPx: { value: ctx.px }, uI: { value: 1 } },
    vertexShader: `attribute vec3 aStart; attribute vec3 aEnd; attribute vec3 aBulge; attribute vec3 aCol; attribute vec4 aP; // delay, dur, size, trail
      uniform float uT,uPx,uI; varying vec3 vC; varying float vA;
      void main(){
        float p = clamp((uT - aP.x - aP.w*0.045)/aP.y, 0., 1.);
        float e = p*p*(3.-2.*p); e = e*e*(3.-2.*e)*0.5 + e*0.5;
        vec3 pos = mix(aStart, aEnd, e) + aBulge*sin(3.14159*e);
        vec4 mv = modelViewMatrix*vec4(pos,1.); float d = max(-mv.z,1.0);
        float vis = smoothstep(0.0,0.03,p)*(1.0-smoothstep(0.965,1.0,p));
        gl_PointSize = clamp(aP.z*uPx*(0.7+1.3*e)*(1.0-0.16*aP.w)*36./d, 1.0, 30.*uPx);
        vC = mix(aCol, vec3(1.0,0.82,0.5)*1.2, e*e*0.7) * uI / (1.0 + aP.w*0.9);
        vA = vis; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 q = gl_PointCoord-0.5; float d = length(q)*2.; float a = smoothstep(1.,0.,d); a = a*a; gl_FragColor = vec4(vC*a*vA*2.2, a*vA); }`,
  });
}

const ringMaterial = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uR: { value: 0 }, uW: { value: 0.03 }, uA: { value: 0 }, uCol: { value: new THREE.Color(0xffd9a0) } },
  vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `varying vec2 vP; uniform float uR,uW,uA; uniform vec3 uCol;
    void main(){ float r = length(vP); float d = (r-uR)/uW; float b = exp(-d*d) + 0.25*exp(-d*d*0.08)*step(r,uR); gl_FragColor = vec4(uCol*b*uA, 1.0); }`,
});

// ================================================================================================================================
export default {
  beats: [
    { t: 0.0, kind: 'hit', label: 'flash resolves, patches ignite' },
    { t: 1.0, kind: 'tick', label: 'dome circles' },
    { t: 2.0, kind: 'tick', label: 'sheet lines' },
    { t: 3.0, kind: 'tick', label: 'saddle circles' },
    { t: 3.2, kind: 'swell', label: 'title' },
    { t: 4.8, kind: 'whoosh', label: 'light converges' },
    { t: 6.0, kind: 'hit', label: 'HERO: torus heat map ignites' },
    { t: 7.6, kind: 'whoosh', label: 'torus collapses to the waist' },
    { t: 8.6, kind: 'sparkle', label: 'catenoid unfurls' },
    { t: 10.0, kind: 'hit', label: 'climax: K unchanged' },
  ],

  init(ctx) {
    const { scene } = ctx;
    ctx.background(palette.void);
    this.bd = kit.backdrop(ctx, { seed: 11, a: 0x070d2e, b: 0x2b1069, c: 0x08405e, intensity: 0.8 }); scene.add(this.bd);
    this.stars = kit.starfield(ctx, { count: 1500, intensity: 0.7 }); scene.add(this.stars);

    // ---- floor grid
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90, 1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uA: { value: 1 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec2 vP; uniform float uA; uniform float uT;
        void main(){ vec2 q = vP; float d = length(q); vec2 g = abs(fract(q*0.5-0.5)-0.5)/fwidth(q*0.5); float l = 1.0-min(min(g.x,g.y),1.0);
          vec2 g2 = abs(fract(q*0.1-0.5)-0.5)/fwidth(q*0.1); float l2 = 1.0-min(min(g2.x,g2.y),1.0);
          float fade = exp(-d*0.085); gl_FragColor = vec4(vec3(0.16,0.42,1.0)*(l*0.32+l2*0.75)*fade*uA, 1.0); }`,
    }));
    this.floor.rotation.x = -PI / 2; this.floor.position.y = FLOOR_Y; this.floor.renderOrder = -5; scene.add(this.floor);

    // ---- dust
    {
      const r = rng(5), n = 480, pos = new Float32Array(n * 3), aS = new Float32Array(n), aPh = new Float32Array(n), aV = new Float32Array(n * 3), aC = new Float32Array(n * 3);
      const cols = [[0.55, 0.85, 1.0], [1.0, 0.8, 0.5], [0.7, 0.6, 1.0]];
      for (let i = 0; i < n; i++) {
        pos.set([(r() - 0.5) * 26, (r() - 0.5) * 11, (r() - 0.5) * 18], i * 3); aS[i] = 0.6 + 2.4 * Math.pow(r(), 3); aPh[i] = r() * TAU;
        aV.set([(r() - 0.5) * 0.10, 0.05 + r() * 0.12, (r() - 0.5) * 0.10], i * 3); const c = cols[Math.floor(r() * 3)]; aC.set(c, i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
      g.setAttribute('aPh', new THREE.BufferAttribute(aPh, 1)); g.setAttribute('aV', new THREE.BufferAttribute(aV, 3)); g.setAttribute('aC', new THREE.BufferAttribute(aC, 3));
      this.dust = new THREE.Points(g, dustMaterial(ctx)); this.dust.frustumCulled = false; this.dust.renderOrder = 5; scene.add(this.dust);
    }

    // ============================================================ Act A: three archetypes
    const mkPatch = (B, x, mo) => {
      const geo = parametricGeometry(polar(B), PDOM);
      const mat = kit.surfaceMaterial({ depthWrite: true, ...mo });
      const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 1;
      const grp = new THREE.Group(); grp.position.x = x; grp.add(mesh); scene.add(grp);
      return { B, geo, mat, mesh, grp };
    };
    const kD = 1 / (DOME.a * DOME.b), kS = 1 / (SAD.a * SAD.b);
    this.dome = mkPatch(domeB, PX[0], { curv: 1, kScale: 0.62 * kD, emis: 0.42, spec: 0.7, grid: [8, 32], gridI: 0.55, gridCol: 0xffe2a8, rim: 1.4, rimCol: 0xffb060, reveal: 0, gridW: 1.1 });
    this.sheet = mkPatch(sheetB(0), PX[1], { curv: 0, base: 0x4a2fd0, emis: 0.26, spec: 0.5, grid: [8, 32], gridI: 0.7, gridCol: 0xc9b8ff, rim: 1.8, rimCol: 0x9a7bff, reveal: 0, gridW: 1.1 });
    this.saddle = mkPatch(saddleB, PX[2], { curv: 1, kScale: 0.92 * kS, emis: 0.46, spec: 0.7, grid: [8, 32], gridI: 0.55, gridCol: 0xbdf4ff, rim: 1.5, rimCol: 0x5ee7ff, reveal: 0, gridW: 1.1 });
    this.patches = [this.dome, this.sheet, this.saddle];

    // real local geometry at each patch centre (normal = +y)
    const fr = (B) => frame(upF(B), 0, 0, 1e-3);
    this.frD = fr(domeB); this.frS = fr(saddleB);
    const W1 = 0xeaf6ff, W2 = 0xb9a4ff;
    const mkCirc = (grp, pts, col, w = 3.2, I = 2.2) => { const l = ctx.fatLine(pts, { color: col, width: w, intensity: I, depthTest: false }); l.renderOrder = 6; l.userData.pts = pts; grp.add(l); return l; };
    // dome: both circles on the same side
    const p0 = [0, 0, 0], N0 = [0, 1, 0];
    this.dome.c1 = mkCirc(this.dome.grp, arcPts(p0, N0, this.frD.k1, this.frD.e1), W1);
    this.dome.c2 = mkCirc(this.dome.grp, arcPts(p0, N0, this.frD.k2, this.frD.e2), W2);
    this.saddle.c1 = mkCirc(this.saddle.grp, arcPts(p0, N0, this.frS.k1, this.frS.e1), W1);
    this.saddle.c2 = mkCirc(this.saddle.grp, arcPts(p0, N0, this.frS.k2, this.frS.e2), W2);
    // sheet: roll direction is x (curved) and z (straight)
    this.sheet.c1 = mkCirc(this.sheet.grp, linePts(p0, [1, 0, 0], 1.7), W1);
    this.sheet.c2 = mkCirc(this.sheet.grp, linePts(p0, [0, 0, 1], 1.7), W2);
    // normals + touching points
    for (const P of this.patches) {
      P.arrow = kit.arrow(ctx, { color: palette.white, width: 3, head: 0.16, intensity: 1.8 }); P.grp.add(P.arrow);
      P.dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.white).multiplyScalar(6), depthTest: false })); P.dot.renderOrder = 7; P.grp.add(P.dot);
    }
    this.beads = [];
    for (const P of this.patches) for (const l of [P.c1, P.c2]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(6), depthTest: false }));
      m.renderOrder = 7; P.grp.add(m); this.beads.push({ m, l });
    }

    // ============================================================ hero torus
    const TS = surfaces.torus(TR, Tr); this.TS = TS; this.KO = frame(TS.f, 0.3, 0, 1e-3).K; this.KI = frame(TS.f, 0.3, PI, 1e-3).K;
    const tf = (R, r) => (u, v) => [(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)];
    this.tf = tf;
    this.torusOpts = { nu: 180, nv: 72, u0: 0, u1: TAU, v0: 0, v1: TAU };
    this.torusGeo = parametricGeometry(tf(TR, Tr), this.torusOpts);
    this.ghost = new THREE.Mesh(this.torusGeo, kit.surfaceMaterial({ depthWrite: false, curv: 0, base: 0x0b1440, alpha: 0.55, grid: [48, 24], gridI: 1.5, gridCol: 0xcfeaff, gridW: 1.0, rim: 1.0, rimCol: 0x5ee7ff, spec: 0.2, reveal: 0 }));
    this.ghost.renderOrder = 2;
    this.torusGrp = new THREE.Group(); scene.add(this.torusGrp); this.torusSpin = new THREE.Group(); this.torusGrp.add(this.torusSpin); this.torusSpin.add(this.ghost);
    this.hot = new THREE.Mesh(this.torusGeo, kit.surfaceMaterial({ depthWrite: true, curv: 1, kScale: 1 / 1.25, emis: 0.3, spec: 0.7, grid: [48, 24], gridI: 0.38, gridCol: 0xd8f0ff, gridW: 1.0, rim: 0.8, rimCol: 0xffe2b8, levels: 5.5, levelI: 0.45, reveal: 0 }));
    this.hot.renderOrder = 3; this.hot.scale.setScalar(1.002); this.torusSpin.add(this.hot);
    // waist ring (the torus collapses onto it, the catenoid grows out of it)
    const ringPts = []; for (let i = 0; i <= 128; i++) { const a = (i / 128) * TAU; ringPts.push([CAT_S * Math.cos(a), 0, CAT_S * Math.sin(a)]); }
    this.waist = ctx.fatLine(ringPts, { color: 0xfff1d8, width: 5, intensity: 3.2 }); this.waist.renderOrder = 8; scene.add(this.waist);
    this.waistHalo = ctx.fatLine(ringPts, { color: palette.cyan, width: 22, intensity: 0.5, opacity: 0.7 }); this.waistHalo.renderOrder = 8; scene.add(this.waistHalo);

    // convergence particles: patch surface -> torus surface
    {
      const r = rng(77), N = 1500, TRL = 4, n = N * TRL;
      const aStart = new Float32Array(n * 3), aEnd = new Float32Array(n * 3), aBulge = new Float32Array(n * 3), aCol = new Float32Array(n * 3), aP = new Float32Array(n * 4);
      const gcol = [[1.0, 0.72, 0.28], [0.62, 0.48, 1.0], [0.25, 0.85, 1.0]];
      const Bs = [domeB, sheetB(0), saddleB];
      for (let i = 0; i < N; i++) {
        const pi = i % 3, rho = RP * Math.sqrt(r()) * 0.98, ph = r() * TAU;
        const sp = Bs[pi](rho * Math.cos(ph), -rho * Math.sin(ph));
        const start = [sp[0] + PX[pi], sp[1], sp[2]];
        const u = r() * TAU, v = r() * TAU, R = TR + Tr * Math.cos(v);
        const end = new THREE.Vector3(R * Math.cos(u), Tr * Math.sin(v), R * Math.sin(u)).applyEuler(new THREE.Euler(TILT, 0, TILTZ, 'XYZ')).toArray();
        const bd = [(r() - 0.5) * 2.4, 0.6 + r() * 2.6, (r() - 0.5) * 2.4], delay = 4.2 + r() * 0.7, dur = 0.75 + r() * 0.3, size = 1.2 + 2.2 * Math.pow(r(), 2.5);
        for (let k = 0; k < TRL; k++) {
          const j = i * TRL + k;
          aStart.set(start, j * 3); aEnd.set(end, j * 3); aBulge.set(bd, j * 3); aCol.set(gcol[pi], j * 3); aP.set([delay, dur, size, k], j * 4);
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aStart', new THREE.BufferAttribute(aStart, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 3)); g.setAttribute('aBulge', new THREE.BufferAttribute(aBulge, 3));
      g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3)); g.setAttribute('aP', new THREE.BufferAttribute(aP, 4));
      this.conv = new THREE.Points(g, convergeMaterial(ctx)); this.conv.frustumCulled = false; this.conv.renderOrder = 9; scene.add(this.conv);
    }

    // shock rings + hero sprite
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), ringMaterial()); this.ring.rotation.x = -PI / 2; this.ring.position.y = -0.6; this.ring.renderOrder = 4; scene.add(this.ring);
    this.ring0 = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), ringMaterial()); this.ring0.rotation.x = -PI / 2; this.ring0.position.y = FLOOR_Y + 0.02; this.ring0.renderOrder = 4; scene.add(this.ring0);
    this.ring0.material.uniforms.uCol.value.set(0xfff0d8);
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xffd9a0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, depthTest: false }));
    this.sun.renderOrder = 0; scene.add(this.sun);

    // ============================================================ Act B: catenoid <-> helicoid
    // the cut of the (non-closed) associate-family domain sits at u = U0 +- pi: exactly opposite the tracked point the camera looks at
    this.catOpts = { nu: 128, nv: 56, u0: U0 - PI, u1: U0 + PI, v0: -VMAX, v1: VMAX, curvature: false };
    this.catGeo = parametricGeometry(surfaces.catenoidHelicoid(PI / 2, VMAX).f, this.catOpts);
    this.catMat = kit.surfaceMaterial({ depthWrite: true, curv: 1, kScale: 1.0, emis: 0.10, spec: 0.5, grid: [32, 14], gridI: 0.34, gridCol: 0xbdf4ff, gridW: 1.0, rim: 0.5, rimCol: 0x5ee7ff, levels: 5.5, levelI: 0.9, reveal: 1.02 });
    // seam dissolve: for theta != +-pi/2 the associate-family domain u in [U0-pi, U0+pi] is not closed (the two ends differ in height by 2*pi*cos(theta)).
    // Fade the surface out over the last few % of u at both ends (weight uSeam grows with |cos theta|, 0 when the surface really closes) so the open cut reads as a soft
    // dissolving edge instead of a torn flap.  (local copy of the shader string; shared kit.js untouched)
    this.catMat.uniforms.uSeam = { value: 0 };
    { const fs0 = this.catMat.fragmentShader, k = 'float e = uReveal - vUv.x,';
      if (fs0.includes(k) && fs0.includes('gl_FragColor = vec4(col, uAlpha);')) {
        this.catMat.fragmentShader = fs0.replace('void main(){', 'uniform float uSeam; void main(){')
          .replace('float kn = clamp(vK*uKScale, -1.0, 1.0);', 'float kn = -pow(clamp(-vK*uKScale, 0.0, 1.0), 2.0);')
          .replace(k, 'float sw = mix(0.03, 0.24, uSeam); float seamF = mix(1.0, pow(smoothstep(0.0, sw, vUv.x) * smoothstep(1.0, 1.0 - sw, vUv.x), 2.0), clamp(uSeam * 20.0, 0.0, 1.0)); if(seamF < 0.02) discard; ' + k)
          .replace('gl_FragColor = vec4(col, uAlpha);', 'gl_FragColor = vec4(col, uAlpha * seamF);');
      } }
    this.catGrp = new THREE.Group(); this.catGrp.rotation.x = -PI / 2; this.catGrp.scale.setScalar(CAT_S); scene.add(this.catGrp);
    this.cat = new THREE.Mesh(this.catGeo, this.catMat); this.cat.renderOrder = 3; this.catGrp.add(this.cat);
    // geodesic ring around the tracked point (a material curve: its intrinsic size never changes) + the "bug" + principal directions
    const ringN = 64; const rp = []; for (let i = 0; i <= ringN; i++) rp.push([0, 0, 0]);
    this.bugRing = ctx.fatLine(rp, { color: 0xfff1d8, width: 3.4, intensity: 2.6, depthTest: false }); this.bugRing.renderOrder = 8; this.catGrp.add(this.bugRing);
    this.bug = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.gold).multiplyScalar(7), depthTest: false })); this.bug.renderOrder = 9; this.catGrp.add(this.bug);
    this.pd1 = ctx.fatLine([[0, 0, 0], [0, 0, 1]], { color: palette.gold, width: 3, intensity: 2.4, depthTest: false }); this.pd1.renderOrder = 8; this.catGrp.add(this.pd1);
    this.pd2 = ctx.fatLine([[0, 0, 0], [0, 0, 1]], { color: palette.cyan, width: 3, intensity: 2.4, depthTest: false }); this.pd2.renderOrder = 8; this.catGrp.add(this.pd2);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xbdf4ff), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, depthTest: false }));
    this.halo.renderOrder = 10; this.catGrp.add(this.halo);
    // screen-space scrim (camera-attached) so captions / stamps stay legible over bright surfaces
    this.scrim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, uniforms: { uRes: { value: new THREE.Vector2(ctx.W, ctx.H) }, uB: { value: 0 }, uL: { value: 0 } },
      vertexShader: 'void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform vec2 uRes; uniform float uB,uL; void main(){ vec2 q = gl_FragCoord.xy/uRes; float a = uB*smoothstep(0.30,0.0,q.y) + uL*smoothstep(0.55,0.0,q.x)*smoothstep(0.1,0.35,q.y)*0.9; gl_FragColor = vec4(0.006,0.010,0.028, clamp(a,0.,0.8)); }`,
    }));
    this.scrim.renderOrder = 100; this.scrim.frustumCulled = false; this.scrim.position.z = -1; scene.add(ctx.camera); ctx.camera.add(this.scrim);
  },

  // ================================================================================================================================
  update(t, ctx) {
    const cam = ctx.camera, ui = ctx.ui, post = ctx.post, W = ctx.W, H = ctx.H;

    // -------------------------------------------------------------------------------- phase weights
    const hot = seg(t, HERO - 0.08, HERO + 0.9, ease.outCubic);              // heat-map sweep (front already visible on the hit frame)
    const collapse = seg(t, 7.7, 8.5, ease.inOutCubic);                     // torus -> ring
    const torusFade = 1 - seg(t, 7.95, 8.45, ease.inOutCubic);                // torus dissolves while its tube is still fat (the waist ring carries the hand-over)
    const grow = seg(t, 8.2, 9.1, ease.outCubic);                           // catenoid unfurls from the waist (overlaps the collapse)
    const theta = PI / 2 - PI * ease.inOutSine(seg(t, 8.9, 12.0, ease.linear));   // catenoid (π/2) -> helicoid (0) -> catenoid (−π/2), closed again (and held) from ~12.0

    // -------------------------------------------------------------------------------- ACT A patches
    const fadeA = 1 - smoothstep(4.95, 5.95, t);                             // patches dissolve into the light stream
    const rev = [seg(t, -0.4, 0.95, ease.outCubic), seg(t, -0.25, 1.1, ease.outCubic), seg(t, -0.1, 1.25, ease.outCubic)];
    const roll = 0.55 * ease.inOutSine(seg(t, 2.5, 4.1, ease.linear)) * (1 - ease.inOutSine(seg(t, 4.3, 5.4, ease.linear)));
    // NOTE: this.rollKey / rollKey2 / torusKey are parameter-keyed memo caches (geometry = f(parameters)), not carried state: any frame order renders identically.
    // rolling sheet: refill geometry in place, read real curvatures at the centre
    const rolling = t < 6.1, rkey = roll.toFixed(5);
    if (rolling && rkey !== this.rollKey) { parametricGeometry(polar(sheetB(roll)), PDOM, this.sheet.geo); this.rollKey = rkey; }
    const frS = frame(upF(sheetB(roll)), 0, 0, 1e-3);
    const kRoll = Math.abs(frS.k1) > Math.abs(frS.k2) ? frS.k1 : frS.k2;
    this.patches.forEach((P, i) => {
      P.mat.uniforms.uReveal.value = rev[i] * 1.02; P.mat.uniforms.uAlpha.value = fadeA; P.mat.uniforms.uTime.value = t;
      P.grp.visible = fadeA > 0.005 && t < 6.05;
      P.grp.scale.setScalar(lerp(1, 0.9, 1 - fadeA));
      P.grp.position.y = 0.0 + 0.12 * Math.sin(t * 0.9 + i * 2.1) * (1 - 0.5 * fadeA);
    });
    // circles draw on
    const drawOn = (l, a, b, ease_ = ease.inOutCubic, N = 96) => { const p = seg(t, a, b, ease_); l.geometry.instanceCount = Math.max(1, Math.floor(p * N)); l.visible = p > 0.001 && fadeA > 0.01; l.material.opacity = fadeA; return p; };
    drawOn(this.dome.c1, 0.95, 2.1); drawOn(this.dome.c2, 1.25, 2.4);
    drawOn(this.saddle.c1, 2.55, 3.7); drawOn(this.saddle.c2, 2.85, 4.0);
    // sheet: straight lines that bend into arcs as the sheet rolls
    {
      const pa = seg(t, 1.6, 2.6, ease.inOutCubic);
      const R = 1 / Math.max(Math.abs(kRoll), 1e-6), half = Math.min(PI, 1.7 / R);
      const c1 = Math.abs(kRoll) < 1e-4 ? linePts([0, 0, 0], [1, 0, 0], 1.7) : arcPts([0, 0, 0], [0, 1, 0], kRoll, [1, 0, 0], half);
      this.sheet.c1.userData.pts = c1;
      if (rolling && rkey !== this.rollKey2) { this.sheet.c1.geometry.setPositions(c1); this.rollKey2 = rkey; }
      this.sheet.c1.geometry.instanceCount = Math.max(1, Math.floor(pa * 96));
      this.sheet.c2.geometry.instanceCount = Math.max(1, Math.floor(seg(t, 1.9, 2.9, ease.inOutCubic) * 96));
      for (const l of [this.sheet.c1, this.sheet.c2]) { l.visible = pa > 0.001 && fadeA > 0.01; l.material.opacity = fadeA; }
    }
    this.beads.forEach((b, k) => {
      const pts = b.l.userData.pts, N = pts.length / 3 - 1, f = ((t * 0.3 + k * 0.29) % 1) * N, i = Math.min(N - 1, Math.floor(f)), w = f - i;
      b.m.position.set(lerp(pts[i * 3], pts[i * 3 + 3], w), lerp(pts[i * 3 + 1], pts[i * 3 + 4], w), lerp(pts[i * 3 + 2], pts[i * 3 + 5], w));
      b.m.visible = b.l.visible && b.l.geometry.instanceCount >= N && fadeA > 0.02; b.m.scale.setScalar(0.9 + 0.3 * Math.sin(t * 7 + k));
    });
    this.patches.forEach((P, i) => {
      const a = seg(t, 0.9 + i * 0.5, 1.6 + i * 0.5, ease.outCubic);
      P.arrow.set([0, 0.02, 0], [0, 1, 0], 1.15 * a); P.arrow.visible = a > 0.01 && fadeA > 0.01;
      P.dot.visible = a > 0.01 && fadeA > 0.01; P.dot.scale.setScalar(a * (1 + 0.2 * Math.sin(t * 5 + i)));
    });

    // -------------------------------------------------------------------------------- ghost + hero torus
    const ghostRev = seg(t, 4.75, 5.95, ease.inOutCubic);
    const tActive = t >= 4.7 && t < 8.7;
    {   // shared torus geometry is always f(t): refill only when its parameters change (cache, not state)
      const r = lerp(Tr, 0.035, collapse), R = lerp(TR, CAT_S, collapse), key = R.toFixed(5) + '/' + r.toFixed(5);
      if (key !== this.torusKey && t < 8.7) {   // NB: torusGeo intentionally stays stale for t >= 8.7 (the torus is hidden by then)
        parametricGeometry(this.tf(R, r), this.torusOpts, this.torusGeo); this.torusKey = key; }
    }
    this.torusGrp.rotation.set(TILT * (1 - collapse), 0, TILTZ * (1 - collapse)); this.torusSpin.rotation.y = 0.18 * (t - HERO);
    this.torusGrp.updateMatrixWorld(true);
    this.ghost.visible = tActive && torusFade > 0.01; this.hot.visible = t >= HERO - 0.1 && torusFade > 0.01;
    this.ghost.material.uniforms.uReveal.value = ghostRev * 1.02; this.ghost.material.uniforms.uTime.value = t;
    this.ghost.material.uniforms.uAlpha.value = 0.55 * (1 - hot * 0.6) * torusFade;
    this.hot.material.uniforms.uAlpha.value = torusFade; this.hot.material.uniforms.uReveal.value = hot < 1e-4 ? 0 : hot * 1.03; this.hot.material.uniforms.uTime.value = t;
    this.hot.material.uniforms.uGridI.value = 0.38 + 1.0 * pulse(t, HERO, HERO + 1.6, 0.05, 1.0);
    this.hot.material.uniforms.uLevelI.value = 0.45 + 1.0 * pulse(t, HERO, HERO + 1.6, 0.05, 1.0);
    { const rc = lerp(Tr, 0.035, collapse), Rc = lerp(TR, CAT_S, collapse), kmax = 1 / (rc * (Rc + rc)); this.hot.material.uniforms.uKScale.value = Math.min(1 / 1.25, 0.5 / kmax); }   // K of the thinning tube explodes: renormalise so it stays gold/cyan, never the red end of the ramp
    // waist ring
    const waistA = seg(t, 8.0, 8.35, ease.linear) * (1 - seg(t, 9.2, 9.9, ease.inOutCubic));
    this.waist.visible = this.waistHalo.visible = waistA > 0.01; this.waist.material.opacity = waistA; this.waistHalo.material.opacity = 0.7 * waistA;

    // -------------------------------------------------------------------------------- light-stream, rings, sun
    this.conv.material.uniforms.uT.value = t; this.conv.material.uniforms.uI.value = 1 - smoothstep(5.7, 6.05, t); this.conv.visible = t > 4.1 && t < 6.1;
    this.dust.material.uniforms.uT.value = t;
    this.dust.material.uniforms.uA.value = 0.8 + 0.6 * smoothstep(5.5, 6.2, t) * (1 - smoothstep(8, 9, t));
    kit.updateStars(this.stars, t); this.bd.rotation.y = 0.2 + t * 0.006;
    this.floor.material.uniforms.uA.value = 0.85 * (1 - 0.65 * smoothstep(7.5, 9.0, t)) * smoothstep(0.0, 0.8, t + 0.3) + 0.6 * pulse(t, 6.0, 7.5, 0.05, 1.2);
    // opening burst (continues the white flash) and hero shock
    {
      const u = this.ring0.material.uniforms; const p = seg(t, 0.0, 2.0, ease.outCubic);
      u.uR.value = 1 + p * 26; u.uW.value = 0.25 + 0.9 * p; u.uA.value = 0.3 * (1 - p) * (1 - p) * (t < 2.1 ? 1 : 0); this.ring0.visible = t < 2.1;
      const q = this.ring.material.uniforms, hp = seg(t, HERO - 0.06, HERO + 2.4, ease.outCubic);
      q.uR.value = 1.5 + hp * 24; q.uW.value = 0.12 + 0.7 * hp; q.uA.value = 0.9 * (1 - hp) * (1 - hp) * (t >= HERO - 0.06 ? 1 : 0); this.ring.visible = t >= HERO - 0.06 && t < HERO + 2.5;
      const sun = 0.3 * Math.exp(-Math.max(0, t - HERO) * 2.6) * smoothstep(HERO - 0.6, HERO - 0.05, t) * (t < 8 ? 1 : 0) + 0.3 * Math.exp(-t * 5.0);
      this.sun.visible = sun > 0.01; this.sun.material.color.setRGB(1.0, 0.72, 0.42).multiplyScalar(sun); this.sun.scale.setScalar(t < 3 ? 10 : 9 + 4 * smoothstep(HERO, HERO + 1.5, t)); this.sun.position.set(0, 0, 0);
    }

    // -------------------------------------------------------------------------------- ACT B catenoid / helicoid
    const catVis = t >= 8.15;
    this.catGrp.visible = catVis;
    let tp = [0, 0, 0], frB = null, S = null;
    if (catVis) {
      S = surfaces.catenoidHelicoid(theta, VMAX);
      const g = Math.max(grow, 1e-3);
      const f = (u, v) => S.f(u, g * v);
      parametricGeometry(f, this.catOpts, this.catGeo);
      const AK = this.catGeo.attributes.aK.array, nv = this.catOpts.nv, nu = this.catOpts.nu;
      for (let i = 0, k = 0; i <= nu; i++) for (let j = 0; j <= nv; j++, k++) { const v = lerp(-VMAX, VMAX, j / nv) * g; AK[k] = -1 / Math.pow(Math.cosh(v), 4); }
      this.catGeo.attributes.aK.needsUpdate = true;
      this.catMat.uniforms.uTime.value = t; this.catMat.uniforms.uSeam.value = smoothstep(0.0, 0.05, Math.abs(Math.cos(theta)));
      this.catMat.uniforms.uGridI.value = 0.55 + 0.5 * pulse(t, 8.6, 9.8, 0.1, 1.0);
      frB = frame(S.f, U0, V0, 1e-3);
      tp = frB.p;
      // geodesic ring (radius in metric units: E = G = cosh² v)
      const ch = Math.cosh(V0), rad = 0.42, pts = [];
      for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU; const q = S.f(U0 + (rad * Math.cos(a)) / ch, V0 + (rad * Math.sin(a)) / ch); pts.push(q[0] + frB.n[0] * 0.012, q[1] + frB.n[1] * 0.012, q[2] + frB.n[2] * 0.012); }
      this.bugRing.geometry.setPositions(pts); this.bugRing.geometry.instanceCount = 64;
      const ba = t * 2.4, bq = S.f(U0 + (rad * Math.cos(ba)) / ch, V0 + (rad * Math.sin(ba)) / ch);
      this.bug.position.set(bq[0] + frB.n[0] * 0.02, bq[1] + frB.n[1] * 0.02, bq[2] + frB.n[2] * 0.02);
      const L = 0.5, lift = 0.02;
      const pp = add3(tp, frB.n, lift);
      this.pd1.geometry.setPositions([...add3(pp, frB.e1, -L), ...add3(pp, frB.e1, L)]); this.pd1.geometry.instanceCount = 1;
      this.pd2.geometry.setPositions([...add3(pp, frB.e2, -L), ...add3(pp, frB.e2, L)]); this.pd2.geometry.instanceCount = 1;
      const trk = seg(t, 9.0, 9.8, ease.outCubic), climaxP = pulse(t, 9.7, 11.6, 0.3, 1.2);
      const vis = trk;
      for (const o of [this.bugRing, this.bug, this.pd1, this.pd2]) o.visible = vis > 0.01;
      this.bugRing.material.opacity = vis; this.pd1.material.opacity = this.pd2.material.opacity = vis;
      this.bug.scale.setScalar(vis * 1.5);
      this.halo.position.set(tp[0], tp[1], tp[2]); this.halo.scale.setScalar(0.75 + 0.75 * climaxP + 0.06 * Math.sin(t * 6));
      this.halo.material.color.setRGB(0.55, 0.9, 1.0).multiplyScalar(Math.min(0.9, 0.25 + 0.65 * climaxP * (0.85 + 0.15 * Math.sin(t * 9)))); this.halo.visible = vis > 0.01;
    }

    // -------------------------------------------------------------------------------- CAMERA
    let W2 = 0;
    const cA = ease.inOutSine(clamp(t / 6));
    let az = lerp(-0.5, 0.05, cA), el = 0.25 + 0.02 * Math.sin(t * 0.5), r = lerp(13.2, 11.5, ease.outCubic(clamp(t / 6))), roll_ = 0;
    let tgt = [0, -0.5, 0], fov = 40;
    const h1 = seg(t, HERO, HERO + 1.8, ease.outCubic), h2 = seg(t, HERO, HERO + 1.25, ease.outExpo);
    if (t >= HERO) {
      az = lerp(0.05, 0.75, h1) + 0.06 * (t - HERO); el = lerp(0.25, 0.34, h1); r = lerp(11.5, 8.5, h2) + 0.9 * seg(t, 6.3, 7.1);   // hit -> push in, then breathe back so the torus clears the caption
      tgt = [0, lerp(-0.5, 0.0, h1), 0]; roll_ = 0.035 * Math.sin((t - HERO) * 1.1) * h1; fov = lerp(40, 38, h2);
    }
    // act B
    const bT = seg(t, 7.5, 9.4, ease.inOutCubic);
    if (t >= 7.5) {
      const r0 = r, fov0 = fov, el0 = el;   // continue seamlessly from the hero camera
      const azH = 0.75 + 0.06 * 2 + 0.05 * (t - 8.0);
      const ang = Math.atan2(-tp[1], tp[0]), azT = PI / 2 - ang;    // world polar angle of the tracked point (mesh: (x,y,z) -> (x,z,-y))
      // w1 never fades: the camera stays on the tracked point's side of the surface, so the open cut of the associate-family domain (at u = U0 + pi) is always on the far side
      const w1 = seg(t, 8.5, 9.5, ease.inOutCubic);
      const w2 = seg(t, 9.1, 10.0, ease.inOutCubic) * (1 - seg(t, 10.7, 12.0, ease.inOutCubic)); W2 = w2;
      const tw = [tp[0] * CAT_S, tp[2] * CAT_S, -tp[1] * CAT_S];
      let d = azT - azH; d = d - TAU * Math.round(d / TAU);
      const azBase = lerp(az, azH, bT);
      // face-on view of the tracked point: look along its surface normal (world = (x,z,-y)), tilted a little for perspective
      let azN = azH + d, elN = 0.16;
      if (frB) {
        const nw = [frB.n[0], frB.n[2], -frB.n[1]]; const sg = nw[0] * tw[0] + nw[2] * tw[2] >= 0 ? 1 : -1;
        azN = Math.atan2(nw[0] * sg, nw[2] * sg) + 0.42; elN = clamp(Math.asin(clamp(nw[1] * sg, -1, 1)), -0.7, 0.7) * 0.85 + 0.16;
        let d2 = azN - azH; d2 = d2 - TAU * Math.round(d2 / TAU); azN = azH + d2;
      }
      az = lerp(azBase, azN, w1);
      el = lerp(lerp(el0, 0.24, bT), elN, w2) + 0.02 * Math.sin(t * 0.7);
      // push in on the collapsing ring (7.5-8.5), then ease back out to frame the whole catenoid while it unfurls; the climax stays wide enough to read the shape
      const rB = lerp(lerp(r0, 7.8, seg(t, 7.5, 8.4, ease.inOutCubic)), 9.8, seg(t, 8.6, 9.8, ease.inOutCubic));
      r = lerp(rB, 10.4, w2);
      const wt = 0.55 * w2;   // partial: the tracked point leads, the whole surface stays in frame
      tgt = [lerp(0, tw[0], wt), lerp(0, tw[1], wt), lerp(0, tw[2], wt)];
      fov = lerp(fov0, 35, bT);
      roll_ = 0.03 * Math.sin(t * 0.6) * (1 - w2) + 0.05 * w2 * Math.sin((t - 10) * 1.3);
    }
    this.scrim.material.uniforms.uRes.value.set(W, H);
    orbitCamera(cam, { target: tgt, r, az, el, roll: roll_ });
    cam.fov = fov;
    // lens shift: subject a little right of centre while the title is up
    const shiftX = -0.075 * seg(t, 2.6, 4.0) * (1 - seg(t, 8.0, 9.0)) - 0.14 * W2;
    const shiftY = 0.09 * seg(t, 6.2, 6.9) * (1 - seg(t, 9.4, 10.0));   // lift the subject clear of the bottom caption while c2 is up
    if (Math.abs(shiftX) > 1e-4 || Math.abs(shiftY) > 1e-4) cam.setViewOffset(W, H, shiftX * W, shiftY * H, W, H); else cam.clearViewOffset();
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    { const hh = 2 * Math.tan((cam.fov * PI) / 360) * 1.0; this.scrim.scale.set(hh * cam.aspect * 1.8, hh * 1.4, 1); this.scrim.material.uniforms.uB.value = (0.62 + 0.28 * pulse(t, 9.6, 12.6, 0.4, 0.6)) * smoothstep(1.4, 2.4, t);
      this.scrim.material.uniforms.uL.value = 0.75 * pulse(t, 9.4, 12.9, 0.6, 0.5) + 0.45 * pulse(t, 3.0, 8.4, 1.0, 1.0); }

    // -------------------------------------------------------------------------------- POST
    // note: post.flash is neutral-white HDR added before ACES, so it must stay small (a uniform add reads as grey fog); the warm light comes from the sun sprite + bloom.
    // the film's own white-out transition already carries the opening, so only a short warm-ish kick here
    const flash0 = 0.02 * Math.exp(-t * 7.0);
    const heroF = 0;   // NO neutral flash on the hit frame: 0.045 of white through ACES lifted the whole frame to a grey veil (luma 41 -> 80). Punch = sun sprite + shock ring + bloom.
    post.flash = flash0 + heroF;
    post.bloom = 0.72 + 0.5 * pulse(t, HERO - 0.2, HERO + 1.5, 0.2, 1.2) + 0.5 * pulse(t, 4.8, 6.0, 0.6, 0.2) + 0.25 * Math.exp(-t * 3) + 0.3 * pulse(t, 9.5, 11.5, 0.3, 1.0) + 0.35 * Math.exp(-Math.abs(t - 8.6) * 8);
    post.exposure = 1.0;
    { const wm = pulse(t, HERO - 0.05, HERO + 1.2, 0.05, 1.0); post.tint = [1.0, 1.0 - 0.05 * wm, 1.0 - 0.14 * wm]; }
    post.streak = 0.16 + 0.35 * pulse(t, HERO - 0.1, HERO + 1.0, 0.1, 0.9) + 0.15 * pulse(t, 9.8, 11, 0.3, 0.8);
    post.ca = 0.0012 + 0.003 * pulse(t, HERO - 0.05, HERO + 0.5, 0.05, 0.4);
    post.vignette = 0.85;
    { const hb = smoothstep(HERO + 0.1, HERO + 0.6, t) * (1 - smoothstep(HERO + 0.6, HERO + 2.2, t)); post.bloomThreshold = 0.85 + 0.35 * hb; post.bloomScatter = 0.74 - 0.12 * hb; }   // ramp only after the hit frame (t = HERO exactly stays at defaults)

    // -------------------------------------------------------------------------------- OVERLAY
    // K = κ1 κ2 builds (early, gone before the title lands)
    kit.formula(ui, t, 'kf', String.raw`K=\kappa_1\kappa_2=\dfrac{LN-M^{2}}{EG-F^{2}}`, { at: 0.95, dur: 2.15, x: 930, y: 140, size: 58, anchor: 'cc', fi: 1.0, fo: 0.6, glow: 14 });
    // per-patch labels (screen-space, tracked): ONE block per patch (zh line + folded mono kappa line).
    // Display convention: the normal is taken on the side of the larger |kappa| (dome: pointing down, into the bowl), so the dome reads (+,+), the saddle (+,-) and the sheet (+,0).
    const labVis = pulse(t, 1.3, 4.9, 0.7, 0.6);
    if (labVis > 0.01 && fadeA > 0.05) {
      const sgn = (a, b) => (Math.abs(a) >= Math.abs(b) ? Math.sign(a) || 1 : Math.sign(b) || 1);
      const dk = (fr_) => { const g = sgn(fr_.k1, fr_.k2); return [g * fr_.k1, g * fr_.k2]; };
      const [d1, d2] = dk(this.frD), [s1, s2] = dk(frS), [a1, a2] = dk(this.frS);
      const info = [
        { zh: '正曲率 K > 0', col: GOLD, l2: `κ₁=${fmt(d1, 2)}  κ₂=${fmt(d2, 2)}  同侧` },
        { zh: '零曲率 K = 0', col: VIOLET, l2: `κ₁=${fmt(s1, 2)}  κ₂=0 ⇒ K=0` },
        { zh: '负曲率 K < 0', col: CYAN, l2: `κ₁=${fmt(a1, 2)}  κ₂=${fmt(a2, 2)}  异侧` },
      ];
      const SHL = '0 0 4px #02030a, 0 0 12px #02030acc';
      info.forEach((o, i) => {
        const sc = toScr(cam, PX[i], FLOOR_Y + 0.0, 0);
        const a = seg(t, 1.5 + i * 0.55, 2.4 + i * 0.55, ease.linear) * labVis;
        ui.text('lz' + i, `${o.zh}<br><span style="font-family:'JetBrains Mono',monospace;font-size:0.66em;font-weight:400;letter-spacing:0.02em;color:#dbe9ff">${o.l2}</span>`,
          { x: sc[0], y: 788, anchor: 'tc', size: 32, weight: 600, color: o.col, glow: 10, shadow: SHL, lh: 1.5, align: 'center', opacity: a * fadeA, track: 0.08, reveal: seg(t, 1.5 + i * 0.55, 2.3 + i * 0.55, ease.linear), spread: 0.6 });
      });
    }
    // bottom captions: Chinese line + a larger, brighter English line than kit.caption (which is too thin over glow at 1080p)
    const cap = (key, at, dur, zh, en) => {
      const v = pulse(t, at, at + dur, 0.55, 0.55);
      if (v <= 0.001) return;
      ui.text(key + 'z', zh, { x: 960, y: 950, anchor: 'bc', size: 44, weight: 600, color: '#f4f8ff', glow: 14, opacity: v, reveal: seg(t, at, at + 0.9, ease.linear), spread: 0.7, track: 0.14 });
      ui.text(key + 'e', en, { x: 960, y: 962, anchor: 'tc', size: 27, font: 'en', italic: true, weight: 500, color: '#d8ecff', opacity: v, track: 0.08, shadow: '0 0 4px #02030a, 0 0 12px #02030acc', reveal: seg(t, at + 0.3, at + 1.1, ease.linear), revealMode: 'mask' });
    };
    cap('c1', 2.0, 2.6, '曲率，是弯曲的度量。', 'Curvature measures bending.');
    // chapter title lock-up (own copy of kit.chapterTitle with a roomier English line so it clears the 900-weight glyphs); gone by ~6.5
    {
      const at = 3.4, hold = 1.5, x = 150, y = 178, size = 150;
      const inn = seg(t, at, at + 1.4, ease.outCubic), out = seg(t, at + 1.4 + hold, at + 2.1 + hold, ease.inOutCubic), v = inn * (1 - out);
      if (v > 0.001) {
        const ey = y + size * 1.02 + 30;
        ui.text('ctk', 'CHAPTER 03', { x, y: y - size * 0.34, anchor: 'tl', size: 20, font: 'mono', track: 0.42, color: '#5ee7ff', opacity: v, reveal: seg(t, at, at + 0.9, ease.linear), revealMode: 'mask', align: 'left' });
        ui.text('ctz', '曲率', { x, y, anchor: 'tl', size, weight: 900, color: '#f4f8ff', glow: 26, opacity: v, reveal: seg(t, at + 0.15, at + 1.35, ease.linear), spread: 0.9, align: 'left', track: 0.04 });
        ui.text('cte', 'Curvature', { x: x + 6, y: ey, anchor: 'tl', size: 40, font: 'en', italic: true, weight: 500, track: 0.22, color: '#d8ecff', opacity: v, reveal: seg(t, at + 0.5, at + 1.5, ease.linear), revealMode: 'mask', align: 'left', upper: false });
        ui.line('ctr', x, ey + 62, x + 220, ey + 62, { stroke: '#5ee7ff', width: 2.5, progress: seg(t, at + 0.4, at + 1.4), opacity: v * 0.9, glow: 8 });
      }
    }

    // torus annotations (real K from geom.frame); the tag anchors follow the *current* (possibly collapsing) tube radii
    {
      const a = pulse(t, 6.6, 7.75, 0.3, 0.3);
      if (a > 0.01) {
        const Rc = lerp(TR, CAT_S, collapse), rc = lerp(Tr, 0.035, collapse);
        // the torus is rotationally symmetric, so the tags may slide: pick the visible outer-equator point farthest right, inner-equator point farthest left
        const M = this.torusGrp.matrixWorld, cp = cam.position, pw = new THREE.Vector3(), nw = new THREE.Vector3(), tv = new THREE.Vector3();
        let bo = null, bi = null;
        for (let k = 0; k < 72; k++) {
          const u = (k / 72) * TAU, cu = Math.cos(u), su = Math.sin(u);
          pw.set((Rc + rc) * cu, 0, (Rc + rc) * su).applyMatrix4(M); nw.set(cu, 0, su).transformDirection(M); tv.copy(cp).sub(pw).normalize();
          if (nw.dot(tv) > 0.3) { const sc = toScr(cam, pw.x, pw.y, pw.z); if (!bo || sc[0] > bo[0]) bo = sc; }
          pw.set((Rc - rc) * cu, 0, (Rc - rc) * su).applyMatrix4(M); nw.set(-cu, 0, -su).transformDirection(M); tv.copy(cp).sub(pw).normalize();
          if (nw.dot(tv) > 0.25) { const sc = toScr(cam, pw.x, pw.y, pw.z); if (!bi || sc[0] < bi[0]) bi = sc; }
        }
        const SH = '0 0 4px #02030a, 0 0 14px #02030acc, 0 0 28px #02030a99';
        if (bo) {
          ui.circle('tco', bo[0], bo[1], 7, { stroke: '#ffe2a8', width: 2.5, opacity: a, glow: 8 });
          ui.line('tlo', bo[0], bo[1], bo[0] + 90, bo[1] - 80, { stroke: '#ffc861', width: 1.6, opacity: 0.8 * a });
          ui.text('tto', `K = ${fmt(this.KO)}`, { x: bo[0] + 98, y: bo[1] - 80, anchor: 'cl', size: 34, font: 'mono', weight: 700, color: GOLD, shadow: SH, opacity: a, track: 0.04 });
        }
        if (bi) {
          // tag pushed off the bright inner wall, onto the dark area lower-left of the hole
          const tx = bi[0] - 300, ty = bi[1] - 50;
          ui.circle('tci', bi[0], bi[1], 7, { stroke: '#bdf4ff', width: 2.5, opacity: a, glow: 8 });
          ui.line('tli', bi[0], bi[1], tx + 8, ty - 4, { stroke: '#5ee7ff', width: 1.6, opacity: 0.8 * a });
          ui.text('tti', `K = ${fmt(this.KI)}`, { x: tx, y: ty, anchor: 'cr', size: 34, font: 'mono', weight: 700, color: '#8ff0ff', shadow: SH, opacity: a, track: 0.04 });
        }
      }
    }

    cap('c2', 6.6, 3.0, '高斯的绝妙定理：曲率是曲面的内蕴性质。', 'Gauss’s Theorema Egregium: curvature is intrinsic.');
    cap('c3', 9.6, 2.9, '无需离开曲面，就能感知它的弯曲。', 'You can feel the curvature without ever leaving the surface.');

    // Theorema Egregium formula (top-right, on dark, with room to be read) + live readout (dropped during the stamp so the frame stays calm)
    kit.formula(ui, t, 'ef', String.raw`K(\theta)\equiv-\dfrac{1}{\cosh^{4}v}`, { at: 8.4, dur: 2.9, x: 150, y: 120, size: 58, anchor: 'tl', fi: 0.5, fo: 0.6, glow: 12 });
    if (frB && t > 8.6) {
      const a = smoothstep(8.7, 9.0, t) * (1 - smoothstep(10.0, 10.5, t));
      const deg = theta * 180 / PI;
      const kk = frB.K;
      if (a > 0.01) kit.readout(ui, 'ro', [
        `θ = ${((deg < 0 ? '−' : '+') + Math.abs(deg).toFixed(1)).padStart(6, '\u00a0')}°`,
        `I   E=${frB.E.toFixed(3)} F=${fmt(frB.F, 3).slice(1)} G=${frB.G.toFixed(3)} 不变`,
        `II  L=${fmt(frB.L, 2)} M=${fmt(frB.M, 2)} N=${fmt(frB.N, 2)} 在变`,
      ], { x: 110, y: 620, anchor: 'tl', size: 24, opacity: a, color: '#ffd98a' });
      // the tracked point's live K tag
      const ta = pulse(t, 9.5, 12.5, 0.6, 0.5);
      if (ta > 0.01) {
        const w = this.catGrp.matrixWorld, pv = new THREE.Vector3(tp[0], tp[1], tp[2]).applyMatrix4(w), sp = toScr(cam, pv.x, pv.y, pv.z);
        const tx = clamp(sp[0] + 250, 700, 1560), ty = Math.max(sp[1] - 210, 330);
        ui.line('kl', sp[0] + 22, sp[1] - 18, tx - 8, ty + 24, { stroke: '#ffe2a8', width: 1.8, opacity: 0.85 * ta, glow: 6 });
        ui.text('kt', `K = ${fmt(kk, 4)}`, { x: tx, y: ty, anchor: 'bl', size: 50, font: 'mono', weight: 700, color: '#ffe9b8', shadow: '0 0 5px #02030a, 0 0 16px #02030a, 0 0 34px #02030acc', opacity: ta, track: 0.02 });
      }
    }
    // climax stamp
    {
      const a = pulse(t, 10.0, 12.5, 0.35, 0.6);
      if (a > 0.01) {
        ui.text('sz', 'K 不变', { x: 130, y: 300, anchor: 'tl', size: 132, weight: 900, color: '#ffe9b8', glow: { r: 30, color: '#ffb347' }, opacity: a, reveal: seg(t, 10.0, 10.9, ease.linear), spread: 0.9, track: 0.05 });
        ui.text('se', 'K UNCHANGED', { x: 138, y: 300 + 150, anchor: 'tl', size: 34, font: 'en', italic: true, color: '#d8ecff', track: 0.3, opacity: a, reveal: seg(t, 10.3, 11.2, ease.linear), revealMode: 'mask' });
      }
    }
  },
};
