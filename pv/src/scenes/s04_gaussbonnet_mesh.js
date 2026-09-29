// Implicit-surface tooling for s04_gaussbonnet: marching tetrahedra + exact implicit curvature.
// Double torus (genus 2) = level set  F = h(x,y)^2 + (kz z)^2 - eps^2,  h = (x^2+y^2)^2 - c (x^2 - y^2)  (a tube around Bernoulli's lemniscate;
// the crossing of the lemniscate is a saddle of h, which merges the two loops into ONE connected surface of genus 2).
const C_LEM = 1.0, KZ = 1.0, EPS = 0.15;
export const F2 = (x, y, z) => { const r2 = x * x + y * y, h = r2 * r2 - C_LEM * (x * x - y * y), zz = KZ * z; return h * h + zz * zz - EPS * EPS; };

const grad = (F, x, y, z, e = 1e-4) => [
  (F(x + e, y, z) - F(x - e, y, z)) / (2 * e), (F(x, y + e, z) - F(x, y - e, z)) / (2 * e), (F(x, y, z + e) - F(x, y, z - e)) / (2 * e)];
const hess = (F, x, y, z, e = 2e-3) => {
  const f0 = F(x, y, z), H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const P = [x, y, z], ev = (dx, dy, dz) => F(x + dx, y + dy, z + dz);
  for (let i = 0; i < 3; i++) {
    const d = [0, 0, 0]; d[i] = e;
    H[i][i] = (ev(d[0], d[1], d[2]) - 2 * f0 + ev(-d[0], -d[1], -d[2])) / (e * e);
    for (let j = i + 1; j < 3; j++) {
      const a = [0, 0, 0]; a[i] = e; const b = [0, 0, 0]; b[j] = e;
      const v = (ev(a[0] + b[0], a[1] + b[1], a[2] + b[2]) - ev(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - ev(-a[0] + b[0], -a[1] + b[1], -a[2] + b[2]) + ev(-a[0] - b[0], -a[1] - b[1], -a[2] - b[2])) / (4 * e * e);
      H[i][j] = H[j][i] = v;
    }
  }
  return H;
};
/** Gaussian curvature of the level set {F=0} at a point: K = (grad^T adj(H) grad) / |grad|^4 */
export function implicitK(F, x, y, z) {
  const g = grad(F, x, y, z), H = hess(F, x, y, z);
  const adj = [
    [H[1][1] * H[2][2] - H[1][2] * H[2][1], H[1][2] * H[2][0] - H[1][0] * H[2][2], H[1][0] * H[2][1] - H[1][1] * H[2][0]],
    [H[0][2] * H[2][1] - H[0][1] * H[2][2], H[0][0] * H[2][2] - H[0][2] * H[2][0], H[0][1] * H[2][0] - H[0][0] * H[2][1]],
    [H[0][1] * H[1][2] - H[0][2] * H[1][1], H[0][2] * H[1][0] - H[0][0] * H[1][2], H[0][0] * H[1][1] - H[0][1] * H[1][0]]];
  let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += g[i] * adj[i][j] * g[j];
  const gl2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
  return { K: s / (gl2 * gl2), n: [g[0] / Math.sqrt(gl2), g[1] / Math.sqrt(gl2), g[2] / Math.sqrt(gl2)] };
}

// 6-tetrahedra decomposition of a cube around the 0-6 diagonal
const CORN = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const TETS = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];

/** Marching tetrahedra. Returns { pos:Float32Array, idx:Uint32Array, nV, nT, euler }. */
export function marchingTets(F, [x0, x1, y0, y1, z0, z1], [nx, ny, nz]) {
  const sx = (x1 - x0) / nx, sy = (y1 - y0) / ny, sz = (z1 - z0) / nz;
  const gi = (i, j, k) => (i * (ny + 1) + j) * (nz + 1) + k;
  const val = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) for (let k = 0; k <= nz; k++) val[gi(i, j, k)] = F(x0 + i * sx, y0 + j * sy, z0 + k * sz);
  const verts = [], cache = new Map(), tris = [];
  const vert = (a, b) => { // a,b = grid node ids (with coords) ; returns vertex index on edge
    const key = a.id < b.id ? a.id * 4194304 + b.id : b.id * 4194304 + a.id;
    let v = cache.get(key); if (v !== undefined) return v;
    const t = a.v / (a.v - b.v);
    v = verts.length / 3; verts.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); cache.set(key, v); return v;
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    let mn = 1e9, mx = -1e9; const nodes = CORN.map(([di, dj, dk]) => { const v = val[gi(i + di, j + dj, k + dk)]; mn = Math.min(mn, v); mx = Math.max(mx, v); return { id: gi(i + di, j + dj, k + dk), v, x: x0 + (i + di) * sx, y: y0 + (j + dj) * sy, z: z0 + (k + dk) * sz }; });
    if (mn > 0 || mx < 0) continue;
    for (const T of TETS) {
      const q = T.map((c) => nodes[c]), ins = q.filter((n) => n.v < 0), out = q.filter((n) => n.v >= 0);
      if (ins.length === 0 || ins.length === 4) continue;
      if (ins.length === 1) { const a = ins[0]; tris.push(vert(a, out[0]), vert(a, out[1]), vert(a, out[2])); }
      else if (ins.length === 3) { const a = out[0]; tris.push(vert(a, ins[0]), vert(a, ins[2]), vert(a, ins[1])); }
      else { const [a, b] = ins, [c, d] = out; const p = vert(a, c), r = vert(a, d), s = vert(b, d), u = vert(b, c); tris.push(p, r, s, p, s, u); }
    }
  }
  // drop degenerate triangles, compute Euler characteristic
  const idx = []; const edges = new Set(); let nT = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2]; if (a === b || b === c || a === c) continue;
    idx.push(a, b, c); nT++;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.add(p < q ? p * 1048576 + q : q * 1048576 + p);
  }
  const nV = verts.length / 3, used = new Set(idx);
  return { pos: new Float32Array(verts), idx: new Uint32Array(idx), nV, nT, euler: used.size - edges.size + nT };
}
