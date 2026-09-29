// s04_gaussbonnet — 高斯–博内 / Gauss–Bonnet.  42–52 s, hero 5.0.
// Act I  (0–5):  three geodesic triangles in a row — sphere octant, plane, saddle.  Light draws each side (true geodesics; the saddle's are found by Newton shooting),
//                interior angles are measured from the edge tangents and count up; the sums 270° / 180° / 111.4° lock; the curvature energy of the three
//                triangles streams to one point while the camera dives in.
// 5.0 HERO:      white-out — the theorem ignites,  ∬K dA + ∮k_g ds = 2πχ(M),  and the camera keeps flying through a tunnel of light into…
// Act II (5–11): …the topology montage: sphere (χ=2), torus (χ=0), double torus (χ=−2, implicit surface meshed by marching tetrahedra in init) — each swept by
//                its true curvature heat-map while ∬K dA is integrated live (geom.frame quadrature / exact implicit-surface K) and lands on 4π, 0, −4π.
// Pure function of t: every table / mesh is precomputed in init().
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, smoothstep, palette, orbitCamera, rng, TAU, GLSL, glowTexture } from '../util.js';
import { parametricGeometry, surfaces, frame } from '../geom.js';
import * as kit from '../kit.js';
import { buildTriangles, SPH_R, SAD_S, SAD_A } from './s04_gaussbonnet_tri.js';
import { F2, marchingTets, implicitK } from './s04_gaussbonnet_mesh.js';

const T_HERO = 5.0, NE = 160;
const GOLD = new THREE.Color(palette.gold), CYAN = new THREE.Color(palette.cyan), VIO = new THREE.Color(0xa98bff), WHITE = new THREE.Color(palette.white), MAG = new THREE.Color(palette.magenta);
const B_OFF = new THREE.Vector3(0, 0, -140);                    // Act II lives far away; the camera "arrives" there through the flash
const FLOOR_A = -2.2, FLOOR_B = -2.75, ST_SCALE = 1.1, ST_X = 3.4;
const HTML_MONO = `font-family:'JetBrains Mono',monospace`;

const f3 = (v, d = 3) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? '' : v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const deg = (r) => (r * 180) / Math.PI;
const outC = (c, k = 1) => c.clone().multiplyScalar(k);

// ------------------------------------------------------------------------------------------------------------- shaders
const floorMat = (centres, cols, gridCol = [0.12, 0.34, 0.95]) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uT: { value: 0 }, uC: { value: centres.map((c) => new THREE.Vector2(...c)) }, uCol: { value: cols.map((c) => new THREE.Vector3(c.r, c.g, c.b)) }, uI: { value: 1 }, uG: { value: new THREE.Vector3(...gridCol) }, uWave: { value: -1 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uBand: { value: new THREE.Vector3(0.6, 0.9, 0) } },
  vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `varying vec2 vP; uniform float uT, uI, uWave; uniform vec2 uRes; uniform vec3 uBand; uniform vec2 uC[3]; uniform vec3 uCol[3]; uniform vec3 uG;
    float gridL(vec2 p, float s){ vec2 g = p/s; vec2 d = abs(fract(g-0.5)-0.5)/max(fwidth(g), vec2(1e-4)); return 1.0 - min(min(d.x,d.y),1.0); }
    void main(){
      float l = gridL(vP,1.0)*0.55 + gridL(vP,5.0)*0.6;
      float fade = exp(-length(vP*vec2(0.85,1.0))*0.075);
      float sy = 1.0 - gl_FragCoord.y/uRes.y; fade *= 1.0 - uBand.z*smoothstep(uBand.x-0.05, uBand.x+0.02, sy)*(1.0 - smoothstep(uBand.y-0.02, uBand.y+0.05, sy));   // calm the grid under the text band
      vec3 pool = vec3(0.0); float near = 0.0;
      for(int i=0;i<3;i++){ vec2 d = vP-uC[i]; float q = exp(-dot(d,d)/(2.6)); pool += uCol[i]*q; near = max(near,q); }
      float wave = exp(-pow((length(vP-uC[1]) - uWave)/1.3, 2.0))*step(0.0,uWave)*exp(-uWave*0.15);
      vec3 col = uG*l*fade*(0.9+2.2*near+1.2*wave)*uI + pool*0.22*uI + vec3(0.5,0.8,1.0)*wave*l*0.7;
      gl_FragColor = vec4(col, clamp(l*fade + length(pool)*0.3 + wave*0.25, 0.0, 1.0));
    }`,
});

const sprite = (col, scale, k = 4) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: col.clone().multiplyScalar(k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(scale); return s;
};

// ------------------------------------------------------------------------------------------------------------- Act I: a triangle station
function buildStation(ctx, T, cfg) {
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner); root.position.set(cfg.x, cfg.y, 0); root.scale.setScalar(ST_SCALE);
  if (cfg.q) inner.quaternion.copy(cfg.q);
  const col = cfg.col, st = { root, inner, T, col, cfg, edges: [], heads: [], verts: [], arcs: [], fans: [] };
  // --- context surface patch
  let patchGeo, patchOutline;
  if (cfg.kind === 'sphere') {
    const S = surfaces.sphere(SPH_R); patchGeo = parametricGeometry(S.f, { nu: 72, nv: 48, ...S.dom });
    st.patchMat = kit.surfaceMaterial({ curv: 0.16, kScale: 0.5, base: 0x14246a, grid: [24, 12], gridI: 0.85, gridW: 1.1, gridCol: 0x5ee7ff, rim: 1.5, rimCol: 0xffc861, spec: 0.5, alpha: 0.96, reveal: 0 });
  } else if (cfg.kind === 'plane') {
    const A = 1.5; patchGeo = parametricGeometry((u, v) => [u, 0, v], { nu: 24, nv: 24, u0: -A, u1: A, v0: -A, v1: A });
    st.patchMat = kit.surfaceMaterial({ curv: 0, base: 0x1c1f66, grid: [15, 15], gridI: 0.95, gridW: 1.1, gridCol: 0xa98bff, rim: 1.0, rimCol: 0xa98bff, spec: 0.35, alpha: 0.9, reveal: 0 });
    patchOutline = [[-A, 0, -A], [A, 0, -A], [A, 0, A], [-A, 0, A], [-A, 0, -A]];
  } else {
    const S = surfaces.saddle(SAD_S, SAD_A); patchGeo = parametricGeometry(S.f, { nu: 40, nv: 40, ...S.dom });
    st.patchMat = kit.surfaceMaterial({ curv: 0.35, kScale: 0.55, base: 0x0f2456, grid: [16, 16], gridI: 0.95, gridW: 1.1, gridCol: 0x5ee7ff, rim: 1.1, rimCol: 0x5ee7ff, spec: 0.5, alpha: 0.93, reveal: 0 });
    const A = SAD_A, f = S.f; patchOutline = [];
    for (let i = 0; i <= 40; i++) patchOutline.push(f(-A + (2 * A * i) / 40, -A));
    for (let i = 1; i <= 40; i++) patchOutline.push(f(A, -A + (2 * A * i) / 40));
    for (let i = 1; i <= 40; i++) patchOutline.push(f(A - (2 * A * i) / 40, A));
    for (let i = 1; i <= 40; i++) patchOutline.push(f(-A, A - (2 * A * i) / 40));
  }
  st.patch = new THREE.Mesh(patchGeo, st.patchMat); inner.add(st.patch);
  if (patchOutline) { st.outline = ctx.fatLine(patchOutline, { color: col, width: 1.8, intensity: 1.3, opacity: 0.85 }); inner.add(st.outline); }
  // --- fill of the triangle (Coons-style map of the triangle: r from vertex A outward, w along BC)
  {
    const NR = 36, NW = 36, nv = (NR + 1) * (NW + 1), P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), K = new Float32Array(nv);
    let k = 0;
    for (let i = 0; i <= NR; i++) for (let j = 0; j <= NW; j++) {
      const r = i / NR, w = j / NW, p = T.fillPt(r, w), n = T.normal(p), o = 0.016;
      P[k * 3] = p[0] + n[0] * o; P[k * 3 + 1] = p[1] + n[1] * o; P[k * 3 + 2] = p[2] + n[2] * o; N.set(n, k * 3); UV[k * 2] = r; UV[k * 2 + 1] = w; k++;
    }
    const idx = new Uint32Array(NR * NW * 6); let q = 0;
    for (let i = 0; i < NR; i++) for (let j = 0; j < NW; j++) { const a = i * (NW + 1) + j, b = (i + 1) * (NW + 1) + j, c = a + 1, d = b + 1; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setAttribute('aK', new THREE.BufferAttribute(K, 1)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    st.fillMat = kit.surfaceMaterial({ curv: 0, base: cfg.fillBase, grid: [0, 0], gridI: 0, rim: 0.9, rimCol: col, spec: 0.5, emis: 0.55, alpha: 0.93, reveal: 0, depthWrite: false });
    st.fill = new THREE.Mesh(g, st.fillMat); st.fill.renderOrder = 2; inner.add(st.fill);
    st.fillPts = P;
  }
  // --- edges (core + halo), heads, vertex nodes, angle arcs
  const off = (p) => { const n = T.normal(p); return [p[0] + n[0] * 0.024, p[1] + n[1] * 0.024, p[2] + n[2] * 0.024]; };
  for (let e = 0; e < 3; e++) {
    const pts = T.edges[e].map(off);
    const core = ctx.fatLine(pts, { color: WHITE, width: 2.6, intensity: 2.6 }), halo = ctx.fatLine(pts, { color: col, width: 11, intensity: 0.55, opacity: 0.75 });
    core.renderOrder = 3; halo.renderOrder = 3; inner.add(halo, core); st.edges.push({ core, halo, pts });
    const h = sprite(col, 0.55, 4.5); inner.add(h); st.heads.push(h);
  }
  for (let k = 0; k < 3; k++) {
    const v = sprite(col, 0.5, 3.0); v.position.set(...off(T.V[k])); inner.add(v); st.verts.push(v);
    // arc + wedge in the tangent plane of the interior angle
    const Pk = T.V[k], eo = T.edges[k], ei = T.edges[(k + 2) % 3];
    const d1 = new THREE.Vector3(...eo[2]).sub(new THREE.Vector3(...eo[0])).normalize();
    const d2 = new THREE.Vector3(...ei[NE - 2]).sub(new THREE.Vector3(...ei[NE])).normalize();
    const th = Math.acos(clamp(d1.dot(d2), -1, 1)), rho = 0.36, ap = [], fan = [];
    const n = new THREE.Vector3(...T.normal(Pk));
    for (let i = 0; i <= 18; i++) {
      const s = i / 18, a = d1.clone().multiplyScalar(Math.sin((1 - s) * th) / Math.sin(th)), b = d2.clone().multiplyScalar(Math.sin(s * th) / Math.sin(th));
      const p = new THREE.Vector3(...Pk).add(a.add(b).multiplyScalar(rho)).addScaledVector(n, 0.05); ap.push([p.x, p.y, p.z]);
      fan.push(p);
    }
    const arc = ctx.fatLine(ap, { color: col.clone().lerp(WHITE, 0.35), width: 3.4, intensity: 2.4 }); arc.renderOrder = 4; inner.add(arc);
    const fp = [], c0 = new THREE.Vector3(...Pk).addScaledVector(n, 0.05);
    for (let i = 0; i < 18; i++) fp.push(c0.x, c0.y, c0.z, fan[i].x, fan[i].y, fan[i].z, fan[i + 1].x, fan[i + 1].y, fan[i + 1].z);
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    const fm = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    fm.renderOrder = 4; inner.add(fm); st.arcs.push(arc); st.fans.push(fm);
  }
  // centroid (local) for label placement
  st.cen = new THREE.Vector3(); T.V.forEach((v) => st.cen.add(new THREE.Vector3(...v)).multiplyScalar(1)); st.cen.multiplyScalar(1 / 3);
  return st;
}

// ------------------------------------------------------------------------------------------------------------- Act II: montage objects
/** integrate K over a parametrised surface with geom.frame; bins along the reveal coordinate (uv.x = i/nu). returns cumulative table [0..nu] */
function cumParam(f, dom, nu, nv) {
  const hu = (dom.u1 - dom.u0) / nu, hv = (dom.v1 - dom.v0) / nv, cum = new Float64Array(nu + 1); let tot = 0;
  for (let i = 0; i < nu; i++) { let row = 0; for (let j = 0; j < nv; j++) { const fr = frame(f, dom.u0 + (i + 0.5) * hu, dom.v0 + (j + 0.5) * hv, 1e-3); row += fr.K * Math.sqrt(fr.det) * hu * hv; } tot += row; cum[i + 1] = tot; }
  return cum;
}
function buildImplicit() {
  const m = marchingTets(F2, [-1.36, 1.36, -0.6, 0.6, -0.25, 0.25], [170, 76, 32]);
  const P = m.pos, nV = m.nV, Nn = new Float32Array(nV * 3), K = new Float32Array(nV), UV = new Float32Array(nV * 2), A = new Float64Array(nV);
  for (let v = 0; v < nV; v++) {                                // Newton-project each vertex onto F = 0
    let x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    for (let it = 0; it < 3; it++) { const e = 1e-4, g = [(F2(x + e, y, z) - F2(x - e, y, z)) / (2 * e), (F2(x, y + e, z) - F2(x, y - e, z)) / (2 * e), (F2(x, y, z + e) - F2(x, y, z - e)) / (2 * e)], f = F2(x, y, z), gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2] + 1e-20; x -= (f * g[0]) / gg; y -= (f * g[1]) / gg; z -= (f * g[2]) / gg; }
    P[3 * v] = x; P[3 * v + 1] = y; P[3 * v + 2] = z;
  }
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i], b = m.idx[i + 1], c = m.idx[i + 2];
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], wx = P[3 * c] - P[3 * a], wy = P[3 * c + 1] - P[3 * a + 1], wz = P[3 * c + 2] - P[3 * a + 2];
    const ar = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx); A[a] += ar / 3; A[b] += ar / 3; A[c] += ar / 3;
  }
  const NB = 120, cum = new Float64Array(NB + 1), bins = new Float64Array(NB);
  for (let v = 0; v < nV; v++) {
    const r = implicitK(F2, P[3 * v], P[3 * v + 1], P[3 * v + 2]);
    K[v] = r.K; Nn[3 * v] = r.n[0]; Nn[3 * v + 1] = r.n[1]; Nn[3 * v + 2] = r.n[2];
    const xn = clamp(0.9 * (P[3 * v] + 1.36) / 2.72 + 0.1 * (0.5 + 0.5 * P[3 * v + 2] / 0.16), 0, 0.9999); UV[2 * v] = xn;   // sweep coordinate tilted through the thickness so the front is not a flat glowing wall at the lobe ends
     UV[2 * v + 1] = (P[3 * v + 1] + 0.6) / 1.2;
    bins[Math.min(NB - 1, Math.floor(xn * NB))] += r.K * A[v];
  }
  for (let i = 0; i < NB; i++) cum[i + 1] = cum[i] + bins[i];
  { // display-only smoothing of K over the mesh (the integral above used the raw values)
    const acc = new Float64Array(nV), cnt = new Float64Array(nV);
    for (let pass = 0; pass < 22; pass++) {
      acc.fill(0); cnt.fill(0);
      for (let i = 0; i < m.idx.length; i += 3) for (let e = 0; e < 3; e++) { const a = m.idx[i + e], b = m.idx[i + (e + 1) % 3]; acc[a] += K[b]; cnt[a]++; acc[b] += K[a]; cnt[b]++; }
      for (let v = 0; v < nV; v++) K[v] = 0.4 * K[v] + 0.6 * (acc[v] / Math.max(1, cnt[v]));
    }
    for (let v = 0; v < nV; v++) K[v] = clamp(K[v], -12, 12);      // tame the marching-tetrahedra speckle in the display colour only
  }
  // marching tetrahedra does not give a consistent winding: re-orient every triangle to agree with the outward implicit gradient (the material flips shading by gl_FrontFacing)
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i], b = m.idx[i + 1], c = m.idx[i + 2];
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], wx = P[3 * c] - P[3 * a], wy = P[3 * c + 1] - P[3 * a + 1], wz = P[3 * c + 2] - P[3 * a + 2];
    const gx = uy * wz - uz * wy, gy = uz * wx - ux * wz, gz = ux * wy - uy * wx;
    if (gx * (Nn[3 * a] + Nn[3 * b] + Nn[3 * c]) + gy * (Nn[3 * a + 1] + Nn[3 * b + 1] + Nn[3 * c + 1]) + gz * (Nn[3 * a + 2] + Nn[3 * b + 2] + Nn[3 * c + 2]) < 0) { m.idx[i + 1] = c; m.idx[i + 2] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setAttribute('aK', new THREE.BufferAttribute(K, 1));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1)); g.computeBoundingSphere();
  return { geo: g, cum, euler: m.euler, nT: m.nT };
}
const sampleCum = (cum, s) => { const n = cum.length - 1, x = clamp(s, 0, 1) * n, i = Math.min(Math.floor(x), n - 1); return cum[i] + (cum[i + 1] - cum[i]) * (x - i); };

// ============================================================================================================= scene
export default {
  init(ctx) {
    ctx.background(palette.void);
    this.T = buildTriangles();
    // ---- shared backdrop (follows camera so it has no parallax = infinitely far)
    this.bd = kit.backdrop(ctx, { seed: 11, a: 0x0a1040, b: 0x33105f, c: 0x0a3f66, intensity: 1.0, scale: 1.7 }); ctx.scene.add(this.bd);
    this.stars = kit.starfield(ctx, { count: 1700, radius: 90, seed: 41, size: 1.5, intensity: 0.9 }); ctx.scene.add(this.stars);

    // ================= Act I group
    const gA = this.gA = new THREE.Group(); ctx.scene.add(gA);
    const qSph = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0.0, 0.66, 0.75).normalize());
    qSph.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.0, 0.66, 0.75).normalize(), 0.5));
    const cfgs = [
      { kind: 'sphere', x: -ST_X, y: -0.42, col: GOLD, fillBase: 0xffb347, q: qSph, name: '球面', sign: 'K &gt; 0', hex: '#ffc861' },
      { kind: 'plane', x: 0, y: -0.5, col: VIO, fillBase: 0x8a5cff, name: '平面', sign: 'K = 0', hex: '#b69cff' },
      { kind: 'saddle', x: ST_X, y: 0.1, col: CYAN, fillBase: 0x2fd8ff, name: '鞍面', sign: 'K &lt; 0', hex: '#5ee7ff' },
    ];
    this.st = cfgs.map((c, i) => { const s = buildStation(ctx, this.T[c.kind], c); s.idx = i; gA.add(s.root); return s; });
    this.floorA = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), floorMat([[-ST_X, 0.3], [0, 0.3], [ST_X, 0.3]], [outC(GOLD, 0.9), outC(VIO, 1.0), outC(CYAN, 0.9)]));
    this.floorA.rotation.x = -Math.PI / 2; this.floorA.position.y = FLOOR_A; gA.add(this.floorA);
    // (planar floor coordinates are x, -z of the rotated plane; centres are symmetric so sign of z is irrelevant for the pools)
    this.dustA = kit.starfield(ctx, { count: 360, radius: 9, seed: 5, size: 2.4, intensity: 0.75, tint: [0.7, 0.85, 1] }); gA.add(this.dustA);
    // ---- curvature-energy stream: particles leave the three triangles and converge on the hero point
    const NP = 260; this.NP = NP;
    const r = rng(77), pp = new Float32Array(NP * 3 * 3), pc = new Float32Array(NP * 3 * 3); this.pinfo = [];
    for (let s = 0; s < 3; s++) for (let i = 0; i < NP; i++) {
      const a = r(), b = r(), st = this.st[s], nR = 36, ri = Math.floor(Math.sqrt(a) * nR), wj = Math.floor(b * 36);
      const k = ri * 37 + wj, lp = new THREE.Vector3(st.fillPts[k * 3], st.fillPts[k * 3 + 1], st.fillPts[k * 3 + 2]);
      this.pinfo.push({ s, lp, delay: r() * 0.7, swirl: (r() - 0.5) * 1.4, lift: 0.4 + r() * 1.2, sz: r() });
      const c = st.col, br = 1.2 + r() * 2.2; pc.set([c.r * br, c.g * br, c.b * br], (s * NP + i) * 3);
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    this.pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.09, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.pts.frustumCulled = false; this.pts.renderOrder = 6; gA.add(this.pts);
    this.hub = sprite(WHITE, 1, 6); gA.add(this.hub);                    // the point they converge on

    // ================= Act II group
    const gB = this.gB = new THREE.Group(); gB.position.copy(B_OFF); ctx.scene.add(gB); gB.visible = false;
    this.floorB = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMat([[-3.95, 0], [0, 0], [3.95, 0]], [outC(GOLD, 0.8), outC(WHITE, 0.55), outC(CYAN, 0.9)], [0.1, 0.3, 0.9]));
    this.floorB.rotation.x = -Math.PI / 2; this.floorB.position.y = FLOOR_B; gB.add(this.floorB);
    this.dustB = kit.starfield(ctx, { count: 420, radius: 15, seed: 8, size: 2.4, intensity: 0.7, tint: [0.7, 0.85, 1] }); gB.add(this.dustB);
    const mkObj = (geo, kScale, gridSpec, level, x, hex, tilt, ov = {}) => {
      const root = new THREE.Group(); root.position.set(x, 0, 0); root.rotation.x = tilt; const spin = new THREE.Group(); root.add(spin);
      const ghost = new THREE.Mesh(geo, kit.surfaceMaterial({ curv: 0, base: 0x1b3080, alpha: 0.30, grid: gridSpec ?? [1, 1], gridI: gridSpec ? 0.45 : 0, gridW: 1.0, rim: ov.ghostRim ?? 1.7, rimCol: 0x8fd8ff, spec: 0.3, depthWrite: false }));
      const mat = kit.surfaceMaterial({ curv: 1, kScale, base: 0x101a55, alpha: 1, grid: gridSpec ?? [1, 1], gridI: gridSpec ? (ov.gridI ?? 0.5) : 0, gridW: 1.0, gridCol: 0xfff0d0, rim: ov.rim ?? 1.3, rimCol: 0xbfe8ff, spec: ov.spec ?? 0.7, emis: gridSpec ? 0.42 : 0.42, levels: level ? level : 0, levelI: level ? 0.32 : 0, reveal: 0 });
      const mesh = new THREE.Mesh(geo, mat); mesh.scale.setScalar(1.004);
      ghost.material.depthTest = false; ghost.renderOrder = 1; mesh.renderOrder = 0; spin.add(ghost, mesh); gB.add(root); return { root, spin, mat, ghost, mesh, hex };
    };
    // sphere
    { const S = surfaces.sphere(1.32), dom = S.dom, nu = 96, nv = 64, geo = parametricGeometry(S.f, { nu, nv, ...dom });
      const o = mkObj(geo, 0.62 * 1.32 * 1.32, [24, 12], 0, -3.95, '#ffc861', 0.28); o.cum = cumParam(S.f, dom, nu, nv); o.chi = 2; o.g = 0; o.name = '球面'; o.label = 'SPHERE'; this.oS = o; }
    // torus (roles of u,v swapped so the reveal sweeps around the tube: K>0 outside, K<0 inside)
    { const T = surfaces.torus(1.3, 0.52), f = (a, b) => T.f(b, a - Math.PI / 2), dom = { u0: 0, u1: TAU, v0: 0, v1: TAU }, nu = 96, nv = 64, geo = parametricGeometry(f, { nu, nv, ...dom });
      const o = mkObj(geo, 0.6 / 1.056, [32, 16], 5, 0, '#dcecff', 0.62); o.cum = cumParam(f, dom, nu, nv); o.chi = 0; o.g = 1; o.name = '环面'; o.label = 'TORUS'; this.oT = o; }
    // double torus (genus 2) from the implicit surface
    { const D = buildImplicit(); this.eul2 = D.euler; const o = mkObj(D.geo, 1 / 16, [40, 12], 0, 3.95, '#5ee7ff', -0.4, { rim: 0.45, spec: 0.3, ghostRim: 0.8, gridI: 0.34 }); o.spin.scale.setScalar(1.66); o.cum = D.cum; o.chi = -2; o.g = 2; o.name = '双环面'; o.label = 'DOUBLE TORUS'; this.oD = o; }
    this.objs = [this.oS, this.oT, this.oD];
    // ---- tunnel of light the camera flies through right after the hero
    { const r2 = rng(303), n = 260, pos = [], cols = [];
      for (let i = 0; i < n; i++) { const a = r2() * TAU, rad = 2.2 + Math.pow(r2(), 0.7) * 9, z0 = -6 + r2() * 46, L = 1.5 + r2() * 5.5, x = Math.cos(a) * rad, y = Math.sin(a) * rad * 0.62 + 0.5;
        pos.push(x, y, z0, x, y, z0 + L); const w = r2(), b = 0.6 + r2() * 2.4, c = new THREE.Color().setRGB(0.55 + 0.45 * w, 0.8, 1).lerp(new THREE.Color(1, 0.8, 0.5), w > 0.82 ? 0.7 : 0).multiplyScalar(b); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); }
      this.tunnel = ctx.fatSegments(pos, { colors: cols, width: 1.5, intensity: 0.4, opacity: 1 }); gB.add(this.tunnel); }
    this._v = new THREE.Vector3(); this._tmp = new THREE.Vector3(); this._t1 = new THREE.Vector3(); this._t2 = new THREE.Vector3(); this._camT = new THREE.Vector3(); this._aux = new THREE.Vector3(); this._bpos = new THREE.Vector3();
  },

  // ------------------------------------------------------------------------------------------------------ frame
  update(t, ctx) {
    const cam = ctx.camera, ui = ctx.ui, post = ctx.post, tt = t;
    const inA = t < T_HERO + 0.05, inB = t >= T_HERO - 0.02;
    this.gA.visible = inA; this.gB.visible = inB;

    // ---------------------------------------------------------------------------------------------- camera
    const camT = this._camT;
    if (inA) {
      const p = seg(t, 0, 4.6, ease.inOutSine), push = ease.inCubic(seg(t, 4.0, 5.0, ease.linear));
      const az = lerp(-0.2, 0.14, p) - 0.10 * push, r0 = lerp(9.6, 10.6, ease.outCubic(seg(t, 0, 4.6, ease.linear))), el = lerp(0.50, 0.42, p);
      const tgt = [lerp(0, 0.0, push), lerp(-0.5, 0.25, push), lerp(0.2, 0.9, push)];
      const r = lerp(r0, 3.2, push);
      orbitCamera(cam, { target: tgt, r, az, el: lerp(el, 0.16, push), roll: -0.05 * push });
      cam.fov = lerp(40, 58, push); camT.set(...tgt);
    } else {
      const tp = seg(t, T_HERO, 8.0, ease.outQuart), slow = seg(t, 6.0, 11.0, ease.inOutSine), dolly = smoothstep(9.0, 11.2, t);
      const r = 12.4 + 36 * (1 - tp) - 0.4 * slow - 0.3 * dolly, az = lerp(0.25, -0.16, slow) + 0.5 * (1 - tp), el = lerp(0.12, 0.2, slow);
      orbitCamera(cam, { target: [B_OFF.x, B_OFF.y - 0.35 + 7.5 * (1 - tp), B_OFF.z], r, az, el, roll: 0.06 * (1 - tp) });
      cam.fov = lerp(52, 38, ease.outCubic(seg(t, T_HERO, 6.4, ease.linear))); camT.copy(B_OFF);
    }
    cam.near = inA ? 0.4 : 2.0; cam.far = 420; // (tight near plane: the thin double-torus tube needs depth precision)
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    this.bd.position.copy(cam.position); this.stars.position.copy(cam.position); this.bd.rotation.y = t * 0.008;
    kit.updateStars(this.stars, t); kit.updateStars(this.dustA, t); kit.updateStars(this.dustB, t);

    // ---------------------------------------------------------------------------------------------- global post
    const pre = t < T_HERO ? smoothstep(4.82, 5.0, t) : 0, boom = t >= T_HERO ? Math.exp(-(t - T_HERO) / 0.05) : 0, tail = t >= T_HERO ? Math.exp(-(t - T_HERO) / 0.15) : 0;
    post.bloom = 0.72 + 0.3 * (1 - smoothstep(0, 0.7, t)) + 0.55 * pre + 0.5 * tail + 0.55 * pulse(t, 9.3, 10.3, 0.15, 0.6); post.flash = 0.28 * pre * pre + 0.28 * boom;
    post.streak = 0.12 + 0.6 * tail + 0.2 * pre; post.ca = 0.0016 + 0.018 * tail + 0.004 * pre; post.exposure = 1.0 + 0.06 * tail; post.vignette = 0.55;
    post.saturation = 1.12 + 0.30 * Math.max(tail, pre); post.contrast = 1.06 + 0.12 * Math.max(tail, pre);
    post.tint = [1.0 - 0.10 * tail, 1.0 - 0.02 * tail, 1.0 + 0.16 * tail];
    post.streakColor = [0.35, 0.75, 1.0];

    if (inA) this.updateA(t, ctx); else this.updateB(t, ctx);
    if (t >= T_HERO - 0.3) this.hero(t, ctx);

    // ---------------------------------------------------------------------------------------------- narration
    const tv = kit.chapterTitle(ui, t, { at: 1.9, hold: 0.5, zh: '高斯–博内', en: '', kicker: 'CHAPTER 05', x: 150, y: 128, size: 96, key: 'ct' });
    if (tv > 0.001) {   // own English line (bigger, clear of the zh glow) — the kit's accent rule is hidden (it would strike through this line)
      ui.line('ctr', 150, 250, 370, 250, { stroke: '#5ee7ff', width: 2, progress: 0, opacity: 0 });
      ui.text('cte', 'Gauss–Bonnet', { x: 156, y: 128 + 96 * 1.1, anchor: 'tl', size: 38, font: 'en', italic: true, weight: 500, track: 0.16, color: '#e2f2ff', opacity: tv * 0.95, reveal: seg(t, 2.4, 3.4, ease.linear), revealMode: 'mask' });
    }
    kit.caption(ui, t, { at: 2.4, dur: 2.2, size: 48, zh: '三角形的内角和，取决于曲率。', en: 'The angle sum of a triangle depends on curvature.', key: 'c1' });
    kit.caption(ui, t, { at: 6.5, dur: 3.9, y: 936, size: 48, zh: '局部的曲率，决定整体的拓扑。', en: 'Local curvature decides global topology.', key: 'c2' });
  },

  // ------------------------------------------------------------------------------------------------------ Act I
  updateA(t, ctx) {
    const ui = ctx.ui, cam = ctx.camera;
    this.floorA.material.uniforms.uRes.value.set(ctx.W, ctx.H); this.floorA.material.uniforms.uBand.value.set(0.62, 0.9, 0.7 * smoothstep(2.4, 3.0, t)); this.floorA.material.uniforms.uT.value = t; this.floorA.material.uniforms.uWave.value = -1;
    this.floorA.material.uniforms.uI.value = 0.24 + 0.7 * smoothstep(4.3, 5.0, t);
    // hero-point (world) the energy streams converge on
    const HUB = this._tmp.set(0.0, 0.25, 0.9);
    const flare = smoothstep(3.6, 4.95, t);
    this.hub.position.copy(HUB); this.hub.scale.setScalar(0.2 + 3.0 * ease.inCubic(seg(t, 4.0, 5.0, ease.linear))); this.hub.material.opacity = seg(t, 4.0, 4.6) * (1 - 0.8 * smoothstep(4.99, 5.05, t));
    const eb = ease.outCubic;
    this.st.forEach((s, si) => {
      const T = s.T, a0 = 0.08 + 0.13 * si, wob = 0.10 * Math.sin(0.5 * t + si * 1.7);
      s.root.rotation.y = wob;
      // patch + fill reveal
      const pr = eb(seg(t, 0.0, 1.25 + 0.1 * si, ease.linear)); s.patchMat.uniforms.uReveal.value = lerp(0.25, 1.02, pr); s.patchMat.uniforms.uTime.value = t;
      if (s.outline) s.outline.material.opacity = 0.85 * smoothstep(0.0, 0.8, t);
      const fr = seg(t, 2.75 + 0.12 * si, 3.9 + 0.12 * si, ease.inOutCubic);
      s.fillMat.uniforms.uReveal.value = fr * 1.03 - 0.0; s.fill.visible = fr > 0.001; s.fillMat.uniforms.uEmis.value = 0.5 + 1.6 * flare * flare; s.fillMat.uniforms.uTime.value = t;
      s.fillMat.uniforms.uRim.value = 0.9 + 1.2 * flare;
      // edges
      const pos = [];
      for (let e = 0; e < 3; e++) {
        const w0 = a0 + e * 0.6, f = seg(t, w0, w0 + 0.66, ease.inOutCubic), E = s.edges[e], n = E.pts.length - 1;
        const cnt = Math.floor(f * n); E.core.visible = E.halo.visible = cnt >= 1; if (cnt >= 1) { E.core.geometry.instanceCount = cnt; E.halo.geometry.instanceCount = cnt; }
        const breathe = 1 + 0.12 * Math.sin(t * 3 + e + si);
        E.core.material.opacity = 1; E.halo.material.opacity = 0.75 * breathe * (1 + 0.8 * flare);
        const head = s.heads[e], hi = clamp(Math.round(f * n), 0, n), hp = E.pts[hi];
        head.position.set(hp[0], hp[1], hp[2]); const alive = f > 0.001 && f < 0.999 ? 1 : 0; head.visible = alive > 0; head.scale.setScalar(0.55 + 0.15 * Math.sin(t * 20 + e));
      }
      // vertices: lit after the first edge that touches them completes
      const tv = [a0 + 0.0, a0 + 0.66, a0 + 1.26];
      for (let k = 0; k < 3; k++) { const v = s.verts[k], on = seg(t, tv[k] - 0.05, tv[k] + 0.35, ease.outCubic); v.visible = on > 0.001; v.scale.setScalar((0.32 + 0.2 * on) * (1 + 0.25 * Math.sin(t * 4 + k * 2 + si)) * (1 + 1.4 * pulse(t, 4.5, 5.0, 0.2, 0.3))); }
      // angle arcs appear when both edges exist
      const ta = [a0 + 1.85, a0 + 1.30, a0 + 1.30 + 0.6];
      for (let k = 0; k < 3; k++) {
        const A = ease.outCubic(seg(t, ta[k], ta[k] + 0.5, ease.linear)), arc = s.arcs[k], fan = s.fans[k];
        arc.visible = A > 0.001; arc.material.opacity = A; fan.material.opacity = 0.42 * A * (1 + 0.7 * flare);
      }
    });
    // ---- particle stream
    const P = this.pts.geometry.attributes.position.array, HV = HUB, v = this._v;
    this.st.forEach((s) => s.inner.updateMatrixWorld(true));
    for (let i = 0; i < this.pinfo.length; i++) {
      const pi = this.pinfo[i], s = this.st[pi.s], u = clamp((t - (3.55 + pi.delay)) / 1.35, 0, 1), e = ease.inCubic(u);
      v.copy(pi.lp); s.inner.localToWorld(v);
      const sx = v.x, sy = v.y, sz = v.z, mx = lerp(sx, HV.x, 0.5) + Math.sin(pi.swirl * 3) * 0.7, my = Math.max(sy, HV.y) + pi.lift * (1 - Math.abs(2 * u - 1) * 0) * 0.9, mz = lerp(sz, HV.z, 0.5) + pi.swirl;
      const q = e, a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c = q * q;
      const active = u > 0 ? 1 : 0;
      P[i * 3] = active ? a * sx + b * mx + c * HV.x : 9999; P[i * 3 + 1] = a * sy + b * my + c * HV.y; P[i * 3 + 2] = a * sz + b * mz + c * HV.z;
    }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.material.size = 0.06 + 0.05 * flare;
    this.gA.updateMatrixWorld(true);
    // ---- labels (projected)
    const proj = (w) => { this._v.copy(w).project(cam); return [(this._v.x * 0.5 + 0.5) * 1920, (0.5 - this._v.y * 0.5) * 1080, this._v.z]; };
    const fadeOut = 1 - smoothstep(4.4, 4.68, t);
    this.st.forEach((s, si) => {
      const T = s.T, a0 = 0.08 + 0.13 * si, cw = this._t2.copy(s.cen); s.inner.localToWorld(cw); const cs = proj(cw);
      const tl = [a0 + 2.3, a0 + 1.75, a0 + 2.35], tLock = Math.max(...tl) + 1.05;     // the moment every counter has landed
      const angFade = 1 - smoothstep(tLock + 0.3, tLock + 0.65, t);                    // angle labels hand over to the summed block
      for (let k = 0; k < 3; k++) {
        const w = this._t1.set(T.V[k][0], T.V[k][1], T.V[k][2]); s.inner.localToWorld(w); const vs = proj(w);
        const dx = vs[0] - cs[0], dy = vs[1] - cs[1], dl = Math.hypot(dx, dy) || 1;
        const cnt = ease.outCubic(seg(t, tl[k], tl[k] + 1.05, ease.linear)), val = deg(T.ang[k]) * cnt, o = seg(t, tl[k] - 0.05, tl[k] + 0.35, ease.linear) * fadeOut * angFade;
        if (o < 0.002) continue;
        const lock = smoothstep(tl[k] + 0.95, tl[k] + 1.15, t);
        ui.text(`a${si}${k}`, `${val.toFixed(1)}°`, { x: vs[0] + (dx / dl) * 62, y: vs[1] + (dy / dl) * 46 - 4, anchor: 'cc', size: 30, font: 'mono', weight: 600, color: lock > 0.5 ? s.cfg.hex : '#e8f3ff', shadow: `0 0 3px #02030a, 0 0 9px #02030a, 0 0 20px #02030acc, 0 0 16px ${s.cfg.hex}66`, opacity: o * 0.98, track: 0.02 });
      }
      // sum block under the station: name + Σθ (running sum of the three visible counters); the Gauss–Bonnet line lands only once everything has locked
      const fl = this._aux.set(s.cfg.x, FLOOR_A, 1.6), fs = proj(fl); fs[1] = 716; const so = seg(t, 2.45 + 0.1 * si, 3.0 + 0.1 * si, ease.linear) * fadeOut;
      if (so > 0.002) {
        let sum = 0; for (let k = 0; k < 3; k++) sum += deg(T.ang[k]) * ease.outCubic(seg(t, tl[k], tl[k] + 1.05, ease.linear));
        const locked = smoothstep(tLock - 0.05, tLock + 0.05, t), pop = 1 + 0.14 * pulse(t, tLock, tLock + 0.4, 0.05, 0.25);
        const ex = (sum - 180) * Math.PI / 180, l3o = smoothstep(tLock + 0.15, tLock + 0.45, t);   // ∬K dA = Σθ − π, both from the same running sum
        const big = `<span style="font-size:44px;${HTML_MONO};font-weight:700;color:${locked > 0.5 ? '#ffffff' : s.cfg.hex}">Σθ = ${sum.toFixed(1)}°</span>`;
        const l1 = `<span style="font-size:28px;font-family:'Noto Serif SC',serif;font-weight:600;color:${s.cfg.hex}">${s.cfg.name} · ${s.cfg.sign}</span>`;
        const l3 = `<span style="font-size:26px;${HTML_MONO};font-weight:600;color:#e2f1ff;opacity:${l3o.toFixed(3)}">∬K dA = Σθ − π = ${f3(ex, 3)}</span>`;
        ui.text(`sum${si}`, `${l1}<br>${big}<br>${l3}`, { x: fs[0], y: fs[1], anchor: 'tc', align: 'center', size: 30, lh: 1.25, color: '#fff', opacity: so, scale: pop, shadow: `0 0 4px #02030a, 0 0 10px #02030a, 0 0 22px #02030a, 0 0 30px #02030a, 0 0 46px #02030acc, 0 0 ${locked > 0.5 ? 26 : 10}px ${s.cfg.hex}88` });
      }
    });
  },

  // ------------------------------------------------------------------------------------------------------ Act II
  updateB(t, ctx) {
    const ui = ctx.ui, cam = ctx.camera, bl = t - T_HERO;
    this.floorB.material.uniforms.uRes.value.set(ctx.W, ctx.H); this.floorB.material.uniforms.uBand.value.set(0.66, 0.95, 0.65 * smoothstep(5.9, 6.6, t)); this.floorB.material.uniforms.uT.value = t; this.floorB.material.uniforms.uWave.value = Math.max(0, bl * 9); this.floorB.material.uniforms.uI.value = 0.55;
    this.tunnel.material.opacity = 1 - smoothstep(5.0, 5.9, t); this.tunnel.visible = this.tunnel.material.opacity > 0.01;
    const sweepT0 = [6.0, 6.35, 6.7], sweepDur = 2.6;
    this.objs.forEach((o, i) => {
      o.root.visible = t > 5.7 + 0.1 * i; o.root.position.y = 0.05 + 0.05 * Math.sin(0.9 * t + i * 2.1);
      o.spin.rotation.y = i === 2 ? 0.38 * Math.sin(0.75 * t + 0.4) : (i === 0 ? 0.35 : -0.42) * (t - 4) + i * 1.1;
      const rv = seg(t, sweepT0[i], sweepT0[i] + sweepDur, ease.inOutCubic);
      o.mat.uniforms.uReveal.value = rv * 1.02; o.mat.uniforms.uTime.value = t; o.ghost.material.uniforms.uTime.value = t; o.ghost.material.uniforms.uAlpha.value = 0.34 * (1 - smoothstep(0.05, 0.9, rv)); o.ghost.visible = rv < 0.95;
      o.mat.uniforms.uEmis.value = 0.34 + 0.14 * Math.sin(t * 1.3 + i);
      o.rv = rv;
    });
    this.gB.updateMatrixWorld(true);
    const proj = (w) => { this._v.copy(w).project(cam); return [(this._v.x * 0.5 + 0.5) * 1920, (0.5 - this._v.y * 0.5) * 1080]; };
    this.objs.forEach((o, i) => {
      const w = this._bpos.set(o.root.position.x, 0, 0).add(B_OFF), sp = proj(w), o1 = seg(t, 6.0 + 0.3 * i, 6.9 + 0.3 * i, ease.linear);
      if (o1 < 0.002) return;
      const I = sampleCum(o.cum, o.rv), tot = o.cum[o.cum.length - 1], done = smoothstep(0.985, 1.0, o.rv);
      const total = o.chi * TAU, cols = ['#ffc861', '#dcecff', '#5ee7ff'], c = cols[i];
      const l1 = `<span style="font-size:32px;font-family:'Noto Serif SC',serif;font-weight:600;color:${c}">${o.name} · 亏格 g = ${o.g}</span>`;
      const l2 = `<span style="font-size:24px;${HTML_MONO};color:#cfe6ff">χ = 2 − 2g = <b style="color:#fff">${o.chi}</b></span>`;
      const eq = ['4π', '0', '−4π'][i];
      const fin = pulse(t, 9.3, 10.4, 0.12, 0.7), pop = 1 + 0.07 * fin;   // closing beat: all three integrals flash together
      const l3 = done > 0.5
        ? `<span style="font-size:29px;${HTML_MONO};color:#fff;font-weight:700">∬K dA = ${eq}</span>`
        : `<span style="font-size:27px;${HTML_MONO};color:${c};font-weight:600">∬K dA ${i === 2 ? '≈' : '='} ${i === 2 ? f3(I, 1) : f3(I, 2)}</span>`;
      const hold = pulse(t, 8.4 + 0.35 * i, 8.4 + 0.35 * i + 0.7, 0.05, 0.6);
      ui.text(`ob${i}`, `${l1}<br>${l2}<br>${l3}`, { x: sp[0], y: 744, anchor: 'tc', align: 'center', size: 30, lh: 1.3, color: '#fff', opacity: o1, scale: pop * (1 + 0.08 * hold), glow: { r: 4 + 8 * done + 16 * fin + 14 * hold, color: c } });
    });
  },

  // ------------------------------------------------------------------------------------------------------ hero overlay: the theorem
  hero(t, ctx) {
    const ui = ctx.ui;
    const mv = seg(t, 5.35, 6.1, ease.inOutCubic), sc = lerp(1, 0.54, mv), fy = lerp(478, 192, mv);
    const tex = String.raw`\textcolor{#ffc861}{\iint_M K\,dA}\;+\;\textcolor{#5ee7ff}{\oint_{\partial M} k_g\,ds}\;=\;2\pi\,\chi(M)`;
    const ig = t >= T_HERO ? Math.exp(-(t - T_HERO) / 0.22) : 0;          // ignition swell of the glyphs
    ui.text('gbk', 'GAUSS–BONNET THEOREM', { x: 960, y: fy - 146 * sc, anchor: 'cc', size: 24, font: 'mono', track: 0.5, color: '#8fd8ff', opacity: seg(t, T_HERO + 0.2, T_HERO + 0.8, ease.linear), scale: lerp(1, 0.9, mv), reveal: seg(t, T_HERO + 0.2, T_HERO + 0.9, ease.linear), revealMode: 'mask' });
    // the formula is already 60% in at T+0.03 — inside the white peak — and sharp by T+0.15; a dark halo keeps it legible against the flash
    ui.tex('gb', tex, { x: 960, y: fy, size: 100, anchor: 'cc', display: true, color: '#ffffff', shadow: `0 0 8px #02030acc, 0 0 22px #02030a99, 0 0 ${(lerp(30, 14, mv) + 30 * ig).toFixed(1)}px #5ee7ffcc, 0 0 ${(60 + 60 * ig).toFixed(1)}px #5ee7ff66`, opacity: seg(t, T_HERO - 0.03, T_HERO + 0.06, ease.outCubic), scale: sc * (1 + 0.10 * (1 - seg(t, T_HERO, T_HERO + 0.6, ease.outCubic))), blur: 3 * (1 - seg(t, T_HERO, T_HERO + 0.15, ease.linear)) });
    const bt = seg(t, 6.3, 6.9, ease.linear);   // closed surfaces: no boundary term
    if (bt > 0.002) ui.text('gbn', '∂M = ∅  ⇒  ∮ k<sub>g</sub> ds = 0', { x: 960, y: fy + 78 * sc + 26, anchor: 'tc', align: 'center', size: 27, font: 'mono', weight: 500, color: '#cfe6ff', opacity: bt, track: 0.04, reveal: bt, revealMode: 'mask', shadow: '0 0 4px #02030a, 0 0 12px #02030a, 0 0 18px #5ee7ff55' });
    // shock rings (SVG) expanding from the centre of the screen
    for (let i = 0; i < 2; i++) {
      const u = seg(t, T_HERO + 0.04 + 0.18 * i, T_HERO + 1.3 + 0.18 * i, ease.outQuart);
      const ro = clamp(1 - u / 0.9); // (a near-transparent SVG element with a drop-shadow filter renders as a black slab in headless Chrome: fade to exactly 0 early)
      if (u > 0 && ro > 0.04) ui.circle('ring' + i, 960, 500, 40 + u * (i ? 1100 : 780), { stroke: i ? '#8fd8ff' : '#ffffff', width: 3.2 * (1 - u) + 0.8, opacity: ro * (i ? 0.5 : 0.85), glow: 14 });
    }
  },

  beats: [
    { t: 0.0, kind: 'whoosh', label: 'glitch in' }, { t: 0.5, kind: 'tick', label: 'geodesic sides ignite' }, { t: 2.0, kind: 'tick', label: 'title' },
    { t: 3.0, kind: 'swell', label: 'fills sweep, sums count' }, { t: 4.0, kind: 'swell', label: 'dive begins' }, { t: 4.6, kind: 'tick', label: 'sums lock' },
    { t: 5.0, kind: 'hit', label: 'theorem ignites' }, { t: 5.3, kind: 'whoosh', label: 'tunnel' }, { t: 6.0, kind: 'sparkle', label: 'sphere sweep' }, { t: 6.7, kind: 'sparkle', label: 'double torus sweep' }, { t: 8.8, kind: 'tick', label: 'integrals land' },
  ],
};
