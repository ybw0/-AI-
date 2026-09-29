// s07_finale helper: the seven "glimpse" motifs of the opening montage, each built from REAL geometry (geom.js):
// trefoil torus knot, torus with K-coloured parallels/meridians, helicoid rulings, a geodesic fan integrated on a torus,
// a geodesic (octant) triangle on the sphere, Flamm's paraboloid + a precessing orbit, and the round sphere.
// Every motif returns { pos: Float32Array (segment pairs), col: Float32Array (linear rgb per vertex), n: segment count }.
import * as THREE from 'three';
import { curves, surfaces, geodesic, uvVelocity, frame } from '../geom.js';
import { curvatureColor, palette, TAU } from '../util.js';

const _c = new THREE.Color();
const rgb = (hex, m = 1) => { _c.set(hex); return [_c.r * m, _c.g * m, _c.b * m]; };
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const kcol = (k, m = 1.0, lift = 0.10) => { const c = curvatureColor(k, _c); return [(c.r + lift) * m, (c.g + lift * 0.9) * m, (c.b + lift * 1.3) * m]; };

/** curves: [{ pts:[[x,y,z]..], cols:[[r,g,b]..] }] -> segment lists ordered so that ALL curves draw on simultaneously. */
function assemble(cs) {
  const P = [], C = [];
  const maxLen = Math.max(...cs.map((c) => c.pts.length));
  for (let s = 0; s < maxLen - 1; s++) for (const c of cs) {
    if (s >= c.pts.length - 1) continue;
    P.push(...c.pts[s], ...c.pts[s + 1]); C.push(...c.cols[s], ...c.cols[s + 1]);
  }
  return { pos: new Float32Array(P), col: new Float32Array(C), n: P.length / 6 };
}
const sampleCurve = (f, a, b, n, colFn) => { const pts = [], cols = []; for (let i = 0; i <= n; i++) { const u = a + ((b - a) * i) / n; pts.push(f(u)); cols.push(colFn(u, i / n)); } return { pts, cols }; };

// ---------------------------------------------------------------------------------------------------------------- 1. knot
function knot() {
  const R = curves.torusKnot(2, 3, 1.5, 0.62), s = 0.62;
  const A = rgb(palette.cyan, 1.25), B = rgb(palette.white, 1.6), M = rgb(palette.magenta, 1.0);
  const c = sampleCurve((t) => { const p = R(t); return [p[0] * s, p[1] * s, p[2] * s]; }, 0, TAU, 360, (t, k) => {
    const w = 0.5 + 0.5 * Math.sin(3 * t); return mixc(mixc(A, B, w), M, 0.5 * Math.pow(0.5 + 0.5 * Math.sin(2 * t + 1), 3));
  });
  return assemble([c]);
}
// ---------------------------------------------------------------------------------------------------------------- 2. torus
function torus() {
  const S = surfaces.torus(0.78, 0.33), cs = [];
  const K = (v) => Math.cos(v) / (0.33 * (0.78 + 0.33 * Math.cos(v)));
  for (let i = 0; i < 9; i++) { const v = (TAU * i) / 9; cs.push(sampleCurve((u) => S.f(u, v), 0, TAU, 96, () => kcol(K(v) / 4.5, 1.6))); }
  for (let j = 0; j < 22; j++) { const u = (TAU * j) / 22; cs.push(sampleCurve((v) => S.f(u, v), 0, TAU, 40, (v) => kcol(K(v) / 4.5, 1.6))); }
  return assemble(cs);
}
// ---------------------------------------------------------------------------------------------------------------- 3. helicoid
function helicoid() {
  const S = surfaces.catenoidHelicoid(0, 1.15), cs = [], sc = 0.36;
  const F = (u, v) => { const p = S.f(u, v); return [p[0] * sc * 1.1, p[2] * sc * 1.05, p[1] * sc * 1.1]; };
  const Kc = (v) => -1 / Math.pow(Math.cosh(v), 4);
  for (let i = 0; i < 15; i++) { const u = -Math.PI + (TAU * i) / 14; cs.push(sampleCurve((v) => F(u, v), -1.15, 1.15, 30, (v) => kcol(Kc(v) * 1.1, 1.8, 0.12))); }
  for (let j = 0; j < 7; j++) { const v = -1.15 + (2.3 * j) / 6; cs.push(sampleCurve((u) => F(u, v), -Math.PI, Math.PI, 90, () => kcol(Kc(v) * 1.1, 1.8, 0.12))); }
  return assemble(cs);
}
// ---------------------------------------------------------------------------------------------------------------- 4. geodesic fan (real geodesics on a torus)
function fan() {
  const S = surfaces.torus(0.78, 0.33), cs = [], f = S.f, sc = 1.0;
  const u0 = 0.4, v0 = 0.0, fr = frame(f, u0, v0);
  const gold = rgb(palette.gold, 1.3), white = rgb(palette.white, 1.5);
  const NG = 30;
  for (let k = 0; k < NG; k++) {
    const a = (TAU * k) / NG + 0.05;
    const d3 = [fr.fu[0] / Math.hypot(...fr.fu) * Math.cos(a) + fr.fv[0] / Math.hypot(...fr.fv) * Math.sin(a),
      fr.fu[1] / Math.hypot(...fr.fu) * Math.cos(a) + fr.fv[1] / Math.hypot(...fr.fv) * Math.sin(a),
      fr.fu[2] / Math.hypot(...fr.fu) * Math.cos(a) + fr.fv[2] / Math.hypot(...fr.fv) * Math.sin(a)];
    const [du, dv] = uvVelocity(f, u0, v0, d3);
    const g = geodesic(f, u0, v0, du, dv, { steps: 200, ds: 0.03 });
    cs.push({ pts: g.pts.map((p) => [p[0] * sc, p[1] * sc, p[2] * sc]), cols: g.pts.map((_, i) => mixc(white, gold, Math.min(1, i / 60))) });
  }
  // faint torus scaffold
  const dim = rgb(palette.violet, 0.5);
  for (let j = 0; j < 16; j++) { const u = (TAU * j) / 16; cs.push(sampleCurve((v) => f(u, v), 0, TAU, 32, () => dim)); }
  return assemble(cs);
}
// ---------------------------------------------------------------------------------------------------------------- 5. geodesic triangle (octant) on the sphere
function triangle() {
  const cs = [], R = 0.95, S = surfaces.sphere(R);
  const dim = rgb(palette.gold, 0.55);
  for (let i = 1; i < 6; i++) { const v = (Math.PI * i) / 6; cs.push(sampleCurve((u) => S.f(u, v), 0, TAU, 72, () => dim)); }
  for (let j = 0; j < 12; j++) { const u = (TAU * j) / 12; cs.push(sampleCurve((v) => S.f(u, v), 0, Math.PI, 40, () => dim)); }
  const A = [1, 0, 0], B = [0, 1, 0], C = [0, 0, 1];
  const slerp = (p, q, t) => { const w = Math.acos(p[0] * q[0] + p[1] * q[1] + p[2] * q[2]), s = Math.sin(w); const a = Math.sin((1 - t) * w) / s, b = Math.sin(t * w) / s; return [(p[0] * a + q[0] * b) * R * 1.005, (p[1] * a + q[1] * b) * R * 1.005, (p[2] * a + q[2] * b) * R * 1.005]; };
  const hot = rgb(palette.white, 3.0), warm = rgb(palette.gold, 3.0);
  for (const [p, q] of [[A, B], [B, C], [C, A]]) cs.push(sampleCurve((t) => slerp(p, q, t), 0, 1, 40, (t) => mixc(warm, hot, 0.5 + 0.5 * Math.sin(t * Math.PI))));
  return assemble(cs);
}
// ---------------------------------------------------------------------------------------------------------------- 6. funnel: Flamm's paraboloid + precessing geodesic rosette
function funnel() {
  const rs = 0.22, cs = [];
  const Z = (r) => -2 * Math.sqrt(rs * Math.max(r - rs, 0)) + 0.55;
  const cy = rgb(palette.cyan, 1.5), bl = rgb(palette.blue, 1.4);
  const Kf = (r) => -rs / (2 * r * r * r);
  const ra = [];
  for (let i = 0; i < 12; i++) ra.push(rs * 1.0001 + Math.pow(i / 11, 1.7) * 1.2);
  for (const r of ra) cs.push(sampleCurve((u) => [r * Math.cos(u), Z(r), r * Math.sin(u)], 0, TAU, 80, () => mixc(bl, cy, Math.min(1, rs / r * 1.5))));
  for (let j = 0; j < 24; j++) { const u = (TAU * j) / 24; cs.push(sampleCurve((r) => [r * Math.cos(u), Z(r), r * Math.sin(u)], rs * 1.0001, rs + 1.2, 40, (r) => mixc(cy, bl, (r - rs) / 1.2))); }
  const w = rgb(palette.white, 3.2);
  cs.push(sampleCurve((p) => { const r = 0.62 / (1 + 0.42 * Math.cos(0.8 * p)); return [r * Math.cos(p), Z(r) + 0.02, r * Math.sin(p)]; }, 0, TAU * 2.5, 260, () => w));
  return assemble(cs);
}
// ---------------------------------------------------------------------------------------------------------------- 7. sphere
function sphere() {
  const S = surfaces.sphere(0.95), cs = [];
  const g = rgb(palette.gold, 1.7), h = rgb(palette.amber, 1.6);
  for (let i = 1; i < 10; i++) { const v = (Math.PI * i) / 10; cs.push(sampleCurve((u) => S.f(u, v), 0, TAU, 80, () => (i === 5 ? rgb(palette.white, 2.6) : g))); }
  for (let j = 0; j < 18; j++) { const u = (TAU * j) / 18; cs.push(sampleCurve((v) => S.f(u, v), 0, Math.PI, 44, () => h)); }
  return assemble(cs);
}

export function buildMotifs() {
  return [
    { id: 'knot', ...knot() }, { id: 'torus', ...torus() }, { id: 'helicoid', ...helicoid() }, { id: 'fan', ...fan() },
    { id: 'triangle', ...triangle() }, { id: 'funnel', ...funnel() }, { id: 'sphere', ...sphere() },
  ];
}
