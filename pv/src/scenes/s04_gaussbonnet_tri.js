// Geodesic triangles for s04_gaussbonnet: sphere octant, Euclidean triangle, saddle triangle (true geodesic sides found by shooting).
// Everything numerical: interior angles come from the edge tangents, and  ∬K dA  from quadrature of geom.frame().K  (an independent check of
//   Σθ − π = ∬K dA   for a geodesic triangle,  Gauss–Bonnet with k_g = 0).
import { surfaces, frame, geodesic, uvVelocity, metric, vec } from '../geom.js';

export const SPH_R = 1.2, SAD_S = 1.2, SAD_A = 1.12;
const NE = 160;                       // samples per edge (uniform in arclength)

const slerp = (p, q, s) => { const om = Math.acos(Math.max(-1, Math.min(1, vec.dot(p, q)))), so = Math.sin(om); return vec.add(vec.scl(p, Math.sin((1 - s) * om) / so), vec.scl(q, Math.sin(s * om) / so)); };

// second-order one-sided tangent of a polyline at its start (dir = +1) or end (dir = -1, pointing back along the edge)
const tangent = (P, atEnd) => {
  const n = P.length, g = (i) => P[atEnd ? n - 1 - i : i];
  return vec.nrm(vec.add(vec.sub(vec.scl(g(1), 4), vec.scl(g(0), 3)), vec.scl(g(2), -1)));
};
// interior angles at V0,V1,V2 from edges e0:V0->V1, e1:V1->V2, e2:V2->V0
const interior = (e) => [0, 1, 2].map((k) => Math.acos(Math.max(-1, Math.min(1, vec.dot(tangent(e[k], false), tangent(e[(k + 2) % 3], true))))));

// ------------------------------------------------------------------ saddle: y = (x^2 - z^2)/s, analytic Christoffels of the Monge patch
const SF = surfaces.saddle(SAD_S, SAD_A).f;
const sadChris = (u, v) => { const hu = (2 * u) / SAD_S, hv = (-2 * v) / SAD_S, w = 1 / (1 + hu * hu + hv * hv), huu = 2 / SAD_S, hvv = -2 / SAD_S; return { G111: hu * huu * w, G211: hv * huu * w, G112: 0, G212: 0, G122: hu * hvv * w, G222: hv * hvv * w }; };
function geodesicBetween(f, P, Q, chrisFn) {
  const m = metric(f, P[0], P[1]), e1 = vec.nrm(m.fu), n = vec.nrm(vec.cross(m.fu, m.fv)), e2 = vec.cross(n, e1);
  const ch = vec.sub(f(Q[0], Q[1]), f(P[0], P[1]));
  const run = (x) => { const d = vec.add(vec.scl(e1, Math.cos(x[0])), vec.scl(e2, Math.sin(x[0]))); const w = uvVelocity(f, P[0], P[1], d); return geodesic(f, P[0], P[1], w[0], w[1], { steps: NE, ds: x[1] / NE, christoffelFn: chrisFn }); };
  let x = [Math.atan2(vec.dot(ch, e2), vec.dot(ch, e1)), vec.len(ch) * 1.03];
  for (let it = 0; it < 40; it++) {                      // Newton shooting on (initial angle, length)
    const g = run(x), e = g.uv[NE], r = [e[0] - Q[0], e[1] - Q[1]];
    if (Math.hypot(r[0], r[1]) < 1e-10) break;
    const h = 1e-5, J = [0, 1].map((k) => { const y = [...x]; y[k] += h; const e2_ = run(y).uv[NE]; return [(e2_[0] - e[0]) / h, (e2_[1] - e[1]) / h]; });
    const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
    x = [x[0] - (r[0] * J[1][1] - r[1] * J[1][0]) / det, x[1] - (-r[0] * J[0][1] + r[1] * J[0][0]) / det];
  }
  const g = run(x); g.len = x[1]; return g;
}
const polyLerp = (P, s) => { const n = P.length - 1, x = Math.min(Math.max(s, 0), 1) * n, i = Math.min(Math.floor(x), n - 1), a = x - i; return P[i].map((c, k) => c + (P[i + 1][k] - c) * a); };

export function buildTriangles() {
  const out = {};
  // ============================================================ sphere octant (vertices on the axes)
  {
    const R = SPH_R, V = [[R, 0, 0], [0, R, 0], [0, 0, R]];
    const edges = [0, 1, 2].map((k) => Array.from({ length: NE + 1 }, (_, i) => slerp(V[k], V[(k + 1) % 3], i / NE)));
    const ang = interior(edges);
    // ∬K dA over the octant u∈[0,π/2] (longitude), v∈[0,π/2] (colatitude) with K from geom.frame on the sphere
    const SFn = surfaces.sphere(R).f; let I = 0; const M = 60, h = Math.PI / 2 / M;
    for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) { const u = (i + 0.5) * h, v = (j + 0.5) * h, fr = frame(SFn, u, v, 1e-3); I += fr.K * Math.sqrt(fr.det) * h * h; }
    const fillPt = (r, w) => { const Q = slerp(V[1], V[2], w), a = vec.add(V[0], vec.scl(vec.sub(Q, V[0]), r)); return vec.scl(vec.nrm(a), R); };
    out.sphere = { V, edges, ang, intK: I, fillPt, normal: (p) => vec.nrm(p) };
  }
  // ============================================================ Euclidean plane triangle
  {
    const V = [[-1.15, 0, 0.55], [0.35, 0, -0.98], [1.05, 0, 0.62]];
    const edges = [0, 1, 2].map((k) => Array.from({ length: NE + 1 }, (_, i) => vec.add(V[k], vec.scl(vec.sub(V[(k + 1) % 3], V[k]), i / NE))));
    const ang = interior(edges);
    const PF = (u, v) => [u, 0, v]; let I = 0; const M = 40, [A, B, C] = V;                     // K from frame() on the flat patch, midpoint rule on barycentric grid
    const area = 0.5 * Math.abs((B[0] - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (B[2] - A[2]));
    for (let i = 0; i < M; i++) for (let j = 0; j < M - i; j++) { const a = (i + 1 / 3) / M, b = (j + 1 / 3) / M, u = A[0] + a * (B[0] - A[0]) + b * (C[0] - A[0]), v = A[2] + a * (B[2] - A[2]) + b * (C[2] - A[2]); I += frame(PF, u, v, 1e-3).K * area / (M * M); }
    const fillPt = (r, w) => { const Q = vec.add(V[1], vec.scl(vec.sub(V[2], V[1]), w)); return vec.add(V[0], vec.scl(vec.sub(Q, V[0]), r)); };
    out.plane = { V, edges, ang, intK: I, fillPt, normal: () => [0, 1, 0] };
  }
  // ============================================================ saddle geodesic triangle
  {
    const Rr = 0.82, UV = [0, 1, 2].map((k) => { const a = Math.PI / 2 + (k * 2 * Math.PI) / 3; return [Rr * Math.cos(a), Rr * Math.sin(a)]; });
    const g = [0, 1, 2].map((k) => geodesicBetween(SF, UV[k], UV[(k + 1) % 3], sadChris));
    const edges = g.map((e) => e.pts);
    const ang = interior(edges);
    // ∬K dA over the region bounded by the three geodesics (point-in-polygon quadrature in (u,v), K from geom.frame)
    const poly = [...g[0].uv, ...g[1].uv, ...g[2].uv];
    const inside = (p) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    let I = 0; const N = 220, hh = 2 * 1.05 / N;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const u = -1.05 + (i + 0.5) * hh, v = -1.05 + (j + 0.5) * hh; if (!inside([u, v])) continue; const fr = frame(SF, u, v, 1e-3); I += fr.K * Math.sqrt(fr.det) * hh * hh; }
    const ABuv = g[0].uv, BCuv = g[1].uv, ACuv = g[2].uv.slice().reverse(), A = UV[0], B = UV[1], C = UV[2];
    const fillPt = (r, w) => {
      const Q = polyLerp(BCuv, w), ab = polyLerp(ABuv, r), ac = polyLerp(ACuv, r);
      const u = [0, 1].map((k) => A[k] + r * (Q[k] - A[k]) + (1 - w) * (ab[k] - (A[k] + r * (B[k] - A[k]))) + w * (ac[k] - (A[k] + r * (C[k] - A[k]))));
      return SF(u[0], u[1]);
    };
    out.saddle = { V: UV.map((p) => SF(p[0], p[1])), edges, ang, intK: I, fillPt, normal: (p) => { const u = p[0], v = p[2]; return vec.nrm([-(2 * u) / SAD_S, 1, (2 * v) / SAD_S]); }, uvV: UV };
  }
  for (const k of ['sphere', 'plane', 'saddle']) { const o = out[k]; o.sum = o.ang.reduce((a, b) => a + b, 0); o.excess = o.sum - Math.PI; }
  return out;
}
