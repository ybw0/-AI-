// Helper for s06_ricci: real spherical harmonics, precomputed per-vertex derivative tables and an analytic
// differential-geometry pass for a radial graph surface  f(u,v) = exp(h(u,v)) * d(u,v),
//   d = (sin v cos u, cos v, sin v sin u)      (u longitude, v colatitude, y up  -- same chart as geom.surfaces.sphere)
//   h = sum_{l>=2,m} c_lm(tau) Yhat_lm(u,v),   c_lm(tau) = c_lm(0) exp(-l(l+1) tau)       (storyboard spectral flow)
// All pure functions of their inputs (deterministic).
import * as THREE from 'three';
import { gauss, rng, clamp } from '../util.js';

export const LMAX = 9;
const NB = (LMAX + 1) * (LMAX + 1);

/** Yhat_lm for all l<=LMAX, m in [-l,l]; index l*l + l + m. Normalised so that sum_m Yhat_lm^2 == 1 pointwise for every l. */
const _pmm = new Float64Array(NB);
export function shBasis(u, v, out) {
  const ct = Math.cos(v), st = Math.sin(v);
  // normalised associated Legendre P_l^m(ct) (including 1/sqrt(4pi)), stored in out temporarily via _pmm[l*(l+1)/2 + m]
  const P = _pmm;
  const at = (l, m) => (l * (l + 1)) / 2 + m;
  P[at(0, 0)] = Math.sqrt(1 / (4 * Math.PI));
  for (let m = 1; m <= LMAX; m++) P[at(m, m)] = -Math.sqrt((2 * m + 1) / (2 * m)) * st * P[at(m - 1, m - 1)];
  for (let m = 0; m < LMAX; m++) P[at(m + 1, m)] = Math.sqrt(2 * m + 3) * ct * P[at(m, m)];
  for (let m = 0; m <= LMAX; m++) {
    for (let l = m + 2; l <= LMAX; l++) {
      const a = Math.sqrt((4 * l * l - 1) / (l * l - m * m)), b = Math.sqrt(((l - 1) * (l - 1) - m * m) / (4 * (l - 1) * (l - 1) - 1));
      P[at(l, m)] = a * (ct * P[at(l - 1, m)] - b * P[at(l - 2, m)]);
    }
  }
  for (let l = 0; l <= LMAX; l++) {
    const norm = Math.sqrt((4 * Math.PI) / (2 * l + 1));
    out[l * l + l] = P[at(l, 0)] * norm;
    for (let m = 1; m <= l; m++) {
      const k = Math.SQRT2 * P[at(l, m)] * norm;
      out[l * l + l + m] = k * Math.cos(m * u);
      out[l * l + l - m] = k * Math.sin(m * u);
    }
  }
}

/** Initial spectral amplitudes A_l (pointwise rms of the degree-l band). Strong high-frequency content => spiky. */
/** radial profile r = exp(phi(h)), phi(h) = h + BETA h^3 (odd => sharper spikes and deeper dents, exactly 0 at the sphere) */
export const BETA = 0.5;
export const phi = (h) => h + BETA * h * h * h;
export const AMP = { 2: 0.38, 3: 0.40, 4: 0.20, 5: 0.19, 6: 0.20, 7: 0.20, 8: 0.20, 9: 0.20 };

/** deterministic initial coefficients; returns { modes:[{l,m,k}], c0: Float64Array(nmodes) } (k = basis index) */
export function initialCoeffs(seed = 20031111, gain = 1) {
  const R = rng(seed), modes = [], c0 = [];
  for (let l = 2; l <= LMAX; l++) for (let m = -l; m <= l; m++) { modes.push({ l, m, k: l * l + l + m }); c0.push(AMP[l] * gauss(R) * gain); }
  return { modes, c0: Float64Array.from(c0) };
}

const EPS = 0.003;
const SKIP = 3e-4;   // modes below this amplitude are invisible (radius change < 0.01 %)
/** Precompute Yhat and its (u,v) derivatives per vertex per mode (mode-major contiguous Float32 arrays). */
export function buildTables(nu, nv, modes) {
  const nvert = (nu + 1) * (nv + 1), nm = modes.length, h = 1e-3;
  const T = { Y: [], Yu: [], Yv: [], Yuu: [], Yuv: [], Yvv: [] };
  for (const key in T) for (let k = 0; k < nm; k++) T[key].push(new Float32Array(nvert));
  const b0 = new Float64Array(NB), bs = Array.from({ length: 8 }, () => new Float64Array(NB));
  let idx = 0;
  for (let i = 0; i <= nu; i++) {
    const u = (2 * Math.PI * i) / nu;
    for (let j = 0; j <= nv; j++, idx++) {
      const v = clamp((Math.PI * j) / nv, EPS, Math.PI - EPS);
      shBasis(u, v, b0);
      shBasis(u + h, v, bs[0]); shBasis(u - h, v, bs[1]); shBasis(u, v + h, bs[2]); shBasis(u, v - h, bs[3]);
      shBasis(u + h, v + h, bs[4]); shBasis(u - h, v - h, bs[5]); shBasis(u + h, v - h, bs[6]); shBasis(u - h, v + h, bs[7]);
      for (let q = 0; q < nm; q++) {
        const k = modes[q].k, y = b0[k];
        T.Y[q][idx] = y;
        T.Yu[q][idx] = (bs[0][k] - bs[1][k]) / (2 * h);
        T.Yv[q][idx] = (bs[2][k] - bs[3][k]) / (2 * h);
        T.Yuu[q][idx] = (bs[0][k] - 2 * y + bs[1][k]) / (h * h);
        T.Yvv[q][idx] = (bs[2][k] - 2 * y + bs[3][k]) / (h * h);
        T.Yuv[q][idx] = (bs[4][k] + bs[5][k] - bs[6][k] - bs[7][k]) / (4 * h * h);
      }
    }
  }
  return T;
}

/** Scalar h(u,v) for coefficient vector c (used for spark placement and the geom.js tracked-point readout). */
const _b = new Float64Array(NB);
export function hAt(u, v, modes, c) {
  shBasis(u, v, _b);
  let s = 0;
  for (let q = 0; q < modes.length; q++) s += c[q] * _b[modes[q].k];
  return s;
}

/** signed area of the spherical triangle (n_a, n_b, n_c) (Van Oosterom–Strakhov) */
function sphTri(N, a, b, c) {
  const ax = N[a], ay = N[a + 1], az = N[a + 2], bx = N[b], by = N[b + 1], bz = N[b + 2], cx = N[c], cy = N[c + 1], cz = N[c + 2];
  const trip = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  const den = 1 + (ax * bx + ay * by + az * bz) + (bx * cx + by * cy + bz * cz) + (cx * ax + cy * ay + cz * az);
  return 2 * Math.atan2(trip, den);
}

/** Mesh object: geometry + analytic curvature pass. */
export class RadialSurface {
  constructor(nu, nv, modes) {
    this.nu = nu; this.nv = nv; this.modes = modes; this.nvert = (nu + 1) * (nv + 1);
    this.tables = buildTables(nu, nv, modes);
    const n = this.nvert;
    this.h = [0, 0, 0, 0, 0, 0].map(() => new Float64Array(n));
    // constant direction data
    this.d = new Float64Array(n * 3); this.du = new Float64Array(n * 3); this.dv = new Float64Array(n * 3); this.duv = new Float64Array(n * 3);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3); this.uv = new Float32Array(n * 2); this.aK = new Float32Array(n);
    this.Karr = new Float64Array(n); this.dA = new Float64Array(n);
    let idx = 0;
    for (let i = 0; i <= nu; i++) {
      const u = (2 * Math.PI * i) / nu, cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= nv; j++, idx++) {
        const v = clamp((Math.PI * j) / nv, EPS, Math.PI - EPS), sv = Math.sin(v), cv = Math.cos(v);
        this.d.set([sv * cu, cv, sv * su], idx * 3); this.du.set([-sv * su, 0, sv * cu], idx * 3);
        this.dv.set([cv * cu, -sv, cv * su], idx * 3); this.duv.set([-cv * su, 0, cv * cu], idx * 3);
        this.uv[idx * 2] = i / nu; this.uv[idx * 2 + 1] = j / nv;
      }
    }
    const ind = new Uint32Array(nu * nv * 6); let t = 0;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = (i + 1) * (nv + 1) + j, c = a + 1, dd = b + 1;
      ind[t++] = a; ind[t++] = b; ind[t++] = c; ind[t++] = b; ind[t++] = dd; ind[t++] = c;
    }
    g.setIndex(new THREE.BufferAttribute(ind, 1));
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2)); g.setAttribute('aK', new THREE.BufferAttribute(this.aK, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
    this.geo = g;
  }

  /** Evaluate the surface for coefficient vector c: fills geometry, returns { Kmin, Kmax, GB (= integral K dA), area }. */
  update(c) {
    const { nvert, tables: T, h, modes, nu, nv } = this;
    let active = 0; for (let m = 0; m < modes.length; m++) if (Math.abs(c[m]) >= SKIP) active++;
    if (active === 0 && this._flat) return this._cache;   // exact sphere already built: nothing to recompute (t > ~4.2)
    for (let q = 0; q < 6; q++) h[q].fill(0);
    const keys = ['Y', 'Yu', 'Yv', 'Yuu', 'Yuv', 'Yvv'];
    for (let m = 0; m < modes.length; m++) {
      const cm = c[m]; if (Math.abs(cm) < SKIP) continue;
      for (let q = 0; q < 6; q++) { const src = T[keys[q]][m], dst = h[q]; for (let i = 0; i < nvert; i++) dst[i] += cm * src[i]; }
    }
    const [H, Hu, Hv, Huu, Huv, Hvv] = h;
    const P = this.pos, Nn = this.nor, AK = this.aK, d = this.d, du = this.du, dv = this.dv, duv = this.duv;
    let Kmin = 1e9, Kmax = -1e9, gb = 0, area = 0;
    const dU = (2 * Math.PI) / nu, dV = Math.PI / nv;
    for (let i = 0; i < nvert; i++) {
      const hh = H[i], hu = Hu[i], hv = Hv[i], p1 = 1 + 3 * BETA * hh * hh, p2 = 6 * BETA * hh, r = Math.exp(hh + BETA * hh * hh * hh);
      const ru = r * p1 * hu, rv = r * p1 * hv, ruu = r * (p1 * p1 * hu * hu + p2 * hu * hu + p1 * Huu[i]), ruv = r * (p1 * p1 * hu * hv + p2 * hu * hv + p1 * Huv[i]), rvv = r * (p1 * p1 * hv * hv + p2 * hv * hv + p1 * Hvv[i]);
      const k3 = i * 3;
      const dx = d[k3], dy = d[k3 + 1], dz = d[k3 + 2], ux = du[k3], uy = du[k3 + 1], uz = du[k3 + 2], vx = dv[k3], vy = dv[k3 + 1], vz = dv[k3 + 2], wx = duv[k3], wy = duv[k3 + 1], wz = duv[k3 + 2];
      // d_uu = (-sv cu, 0, -sv su) = (-dx, 0, -dz), d_vv = -d
      const duux = -dx, duuz = -dz;
      // f_u, f_v
      const fux = ru * dx + r * ux, fuy = ru * dy + r * uy, fuz = ru * dz + r * uz;
      const fvx = rv * dx + r * vx, fvy = rv * dy + r * vy, fvz = rv * dz + r * vz;
      const fuux = ruu * dx + 2 * ru * ux + r * duux, fuuy = ruu * dy + 2 * ru * uy, fuuz = ruu * dz + 2 * ru * uz + r * duuz;
      const fuvx = ruv * dx + ru * vx + rv * ux + r * wx, fuvy = ruv * dy + ru * vy + rv * uy + r * wy, fuvz = ruv * dz + ru * vz + rv * uz + r * wz;
      const fvvx = rvv * dx + 2 * rv * vx - r * dx, fvvy = rvv * dy + 2 * rv * vy - r * dy, fvvz = rvv * dz + 2 * rv * vz - r * dz;
      const E = fux * fux + fuy * fuy + fuz * fuz, F = fux * fvx + fuy * fvy + fuz * fvz, G = fvx * fvx + fvy * fvy + fvz * fvz;
      let nx = fuy * fvz - fuz * fvy, ny = fuz * fvx - fux * fvz, nz = fux * fvy - fuy * fvx;
      const nl = Math.hypot(nx, ny, nz) || 1e-12; nx /= nl; ny /= nl; nz /= nl;
      const L = fuux * nx + fuuy * ny + fuuz * nz, M = fuvx * nx + fuvy * ny + fuvz * nz, N = fvvx * nx + fvvy * ny + fvvz * nz;
      const det = Math.max(E * G - F * F, 1e-14);
      const K = (L * N - M * M) / det;
      P[k3] = r * dx; P[k3 + 1] = r * dy; P[k3 + 2] = r * dz;
      Nn[k3] = nx; Nn[k3 + 1] = ny; Nn[k3 + 2] = nz;
      AK[i] = K; this.Karr[i] = K;
      const j = i % (nv + 1), ii = (i - j) / (nv + 1);
      const w = (j === 0 || j === nv ? 0.5 : 1) * (ii === nu ? 0 : 1) * dU * dV * Math.sqrt(det);
      gb += K * w; area += w;
      if (K < Kmin) Kmin = K; if (K > Kmax) Kmax = K;
    }
    // Gauss-map form of the total curvature: integral K dA = signed area of the normal image (sum of spherical triangle areas
    // of the analytic vertex normals). Converges far better than the K*dA quadrature at needle-sharp spikes.
    let gm = 0; const nv1 = nv + 1;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = (i * nv1 + j) * 3, b = a + nv1 * 3, c = a + 3, d = b + 3;
      gm += sphTri(Nn, a, b, c) + sphTri(Nn, b, d, c);
    }
    this.gaussArea = gm;
    const g = this.geo;
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.aK.needsUpdate = true;
    this._flat = active === 0;
    return (this._cache = { Kmin, Kmax, GB: gm, GBq: gb, area, active });
  }
}
