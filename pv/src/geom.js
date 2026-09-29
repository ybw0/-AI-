// Numerical differential geometry toolkit.
//  * Surfaces are functions f(u,v) -> [x,y,z] (plain arrays, fast).
//  * Curves are functions r(t) -> [x,y,z].
// Everything is deterministic and works on any smooth parametrisation via finite differences (double precision).
import * as THREE from 'three';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const vec = { sub, add, scl, dot, cross, len, nrm };

// =====================================================================================================================
//  Surface local geometry
// =====================================================================================================================
/**
 * Full local differential geometry at (u,v):
 *  p, fu, fv, n (unit normal = fu×fv normalised), E,F,G (first fundamental form), L,M,N (second),
 *  K (Gaussian), H (mean), k1>=k2 (principal curvatures), e1,e2 (principal directions as unit R^3 vectors), det=EG-F^2.
 * hu,hv: finite-difference steps in parameter space.
 */
export function frame(f, u, v, hu = 1e-3, hv = hu) {
  const p = f(u, v);
  const a = f(u + hu, v), b = f(u - hu, v), c = f(u, v + hv), d = f(u, v - hv);
  const pp = f(u + hu, v + hv), pm = f(u + hu, v - hv), mp = f(u - hu, v + hv), mm = f(u - hu, v - hv);
  const fu = scl(sub(a, b), 1 / (2 * hu)), fv = scl(sub(c, d), 1 / (2 * hv));
  const fuu = scl(add(sub(a, scl(p, 2)), b), 1 / (hu * hu));
  const fvv = scl(add(sub(c, scl(p, 2)), d), 1 / (hv * hv));
  const fuv = scl(sub(add(pp, mm), add(pm, mp)), 1 / (4 * hu * hv));
  const E = dot(fu, fu), F = dot(fu, fv), G = dot(fv, fv);
  const det = E * G - F * F;
  const nn = cross(fu, fv);
  const nl = len(nn);
  const n = nl > 1e-14 ? scl(nn, 1 / nl) : [0, 1, 0];
  const L = dot(fuu, n), M = dot(fuv, n), N = dot(fvv, n);
  const dd = det > 1e-14 ? det : 1e-14;
  const K = (L * N - M * M) / dd;
  const H = (E * N - 2 * F * M + G * L) / (2 * dd);
  const disc = Math.sqrt(Math.max(0, H * H - K));
  const k1 = H + disc, k2 = H - disc;
  // shape operator S = I^{-1} II in basis (fu,fv)
  const sa = (G * L - F * M) / dd, sb = (G * M - F * N) / dd, sc = (-F * L + E * M) / dd, sd = (-F * M + E * N) / dd;
  const dirFor = (k) => {
    let w1 = sb, w2 = k - sa;
    let w1b = k - sd, w2b = sc;
    if (Math.hypot(w1b, w2b) > Math.hypot(w1, w2)) { w1 = w1b; w2 = w2b; }
    if (Math.hypot(w1, w2) < 1e-9) return nrm(fu); // umbilic
    return nrm(add(scl(fu, w1), scl(fv, w2)));
  };
  const e1 = dirFor(k1);
  const e2 = disc < 1e-6 ? nrm(cross(n, e1)) : dirFor(k2);
  return { p, fu, fv, n, E, F, G, L, M, N, K, H, k1, k2, e1, e2, det };
}

/** frame() that survives poles / degenerate points by nudging toward the domain centre. */
export function safeFrame(f, u, v, dom, hu, hv) {
  let fr = frame(f, u, v, hu, hv);
  if (fr.det > 1e-10 && isFinite(fr.K)) return fr;
  const cu = (dom.u0 + dom.u1) / 2, cv = (dom.v0 + dom.v1) / 2;
  for (const e of [4e-3, 1.5e-2]) {
    fr = frame(f, u + (cu - u) * e, v + (cv - v) * e, hu, hv);
    if (fr.det > 1e-10 && isFinite(fr.K)) return fr;
  }
  return fr;
}

/**
 * Build (or refill) a BufferGeometry for a parametric surface with per-vertex curvature attributes.
 * opts: { nu, nv, u0,u1, v0,v1, curvature=true }
 * Attributes: position, normal, uv (in [0,1]^2), aK (Gaussian), aH (mean), aK1, aK2 (principal), aE1 (principal direction vec3).
 * Pass an existing geometry as `geom` to update in place each frame (animated surfaces): buffer sizes must match.
 */
export function parametricGeometry(f, opts = {}, geom = null) {
  const { nu = 64, nv = 64, u0 = 0, u1 = 1, v0 = 0, v1 = 1, curvature = true } = opts;
  const nvert = (nu + 1) * (nv + 1);
  const hu = (u1 - u0) * 2e-4, hv = (v1 - v0) * 2e-4;
  const dom = { u0, u1, v0, v1 };
  let g = geom;
  const fresh = !g;
  if (fresh) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nvert * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nvert * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nvert * 2), 2));
    g.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(nvert), 1));
    g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(nvert), 1));
    g.setAttribute('aK1', new THREE.BufferAttribute(new Float32Array(nvert), 1));
    g.setAttribute('aK2', new THREE.BufferAttribute(new Float32Array(nvert), 1));
    g.setAttribute('aE1', new THREE.BufferAttribute(new Float32Array(nvert * 3), 3));
    const idx = new Uint32Array(nu * nv * 6);
    let t = 0;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = (i + 1) * (nv + 1) + j, c = a + 1, d = b + 1;
      idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const P = g.attributes.position.array, Nn = g.attributes.normal.array, UV = g.attributes.uv.array;
  const AK = g.attributes.aK.array, AH = g.attributes.aH.array, AK1 = g.attributes.aK1.array, AK2 = g.attributes.aK2.array, AE = g.attributes.aE1.array;
  let k = 0;
  for (let i = 0; i <= nu; i++) {
    const u = u0 + ((u1 - u0) * i) / nu;
    for (let j = 0; j <= nv; j++) {
      const v = v0 + ((v1 - v0) * j) / nv;
      if (curvature) {
        const fr = safeFrame(f, u, v, dom, hu, hv);
        const p = f(u, v);
        P[k * 3] = p[0]; P[k * 3 + 1] = p[1]; P[k * 3 + 2] = p[2];
        Nn[k * 3] = fr.n[0]; Nn[k * 3 + 1] = fr.n[1]; Nn[k * 3 + 2] = fr.n[2];
        AK[k] = isFinite(fr.K) ? fr.K : 0; AH[k] = isFinite(fr.H) ? fr.H : 0; AK1[k] = isFinite(fr.k1) ? fr.k1 : 0; AK2[k] = isFinite(fr.k2) ? fr.k2 : 0;
        AE[k * 3] = fr.e1[0]; AE[k * 3 + 1] = fr.e1[1]; AE[k * 3 + 2] = fr.e1[2];
      } else {
        const p = f(u, v);
        const a = f(u + hu, v), b = f(u - hu, v), c = f(u, v + hv), d = f(u, v - hv);
        let n = nrm(cross(sub(a, b), sub(c, d)));
        P[k * 3] = p[0]; P[k * 3 + 1] = p[1]; P[k * 3 + 2] = p[2];
        Nn[k * 3] = n[0]; Nn[k * 3 + 1] = n[1]; Nn[k * 3 + 2] = n[2];
      }
      UV[k * 2] = i / nu; UV[k * 2 + 1] = j / nv;
      k++;
    }
  }
  for (const name of ['position', 'normal', 'uv', 'aK', 'aH', 'aK1', 'aK2', 'aE1']) g.attributes[name].needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

// =====================================================================================================================
//  Metric, Christoffel symbols, geodesics, parallel transport (intrinsic geometry, all via finite differences of f)
// =====================================================================================================================
export function metric(f, u, v, h = 1e-4) {
  const fu = scl(sub(f(u + h, v), f(u - h, v)), 1 / (2 * h));
  const fv = scl(sub(f(u, v + h), f(u, v - h)), 1 / (2 * h));
  return { E: dot(fu, fu), F: dot(fu, fv), G: dot(fv, fv), fu, fv };
}
/** Christoffel symbols of the second kind at (u,v). Returns { G111,G211,G112,G212,G122,G222 } (Γ^k_ij with k up, ij down). */
export function christoffel(f, u, v, h = 1e-4, hm = 5e-4) {
  const m0 = metric(f, u, v, h);
  const mu1 = metric(f, u + hm, v, h), mu0 = metric(f, u - hm, v, h);
  const mv1 = metric(f, u, v + hm, h), mv0 = metric(f, u, v - hm, h);
  const Eu = (mu1.E - mu0.E) / (2 * hm), Fu = (mu1.F - mu0.F) / (2 * hm), Gu = (mu1.G - mu0.G) / (2 * hm);
  const Ev = (mv1.E - mv0.E) / (2 * hm), Fv = (mv1.F - mv0.F) / (2 * hm), Gv = (mv1.G - mv0.G) / (2 * hm);
  const { E, F, G } = m0;
  const D = 2 * (E * G - F * F);
  return {
    G111: (G * Eu - 2 * F * Fu + F * Ev) / D, G211: (2 * E * Fu - E * Ev - F * Eu) / D,
    G112: (G * Ev - F * Gu) / D, G212: (E * Gu - F * Eu) / D,
    G122: (2 * G * Fv - G * Gv - F * Gu) / D, G222: (E * Gv - 2 * F * Fv + F * Gu) / D,
  };
}

/** Convert a 3D tangent direction at (u,v) into parameter-space velocity (du,dv) with unit speed on the surface. */
export function uvVelocity(f, u, v, dir3, h = 1e-4) {
  const { E, F, G, fu, fv } = metric(f, u, v, h);
  const bu = dot(dir3, fu), bv = dot(dir3, fv), det = E * G - F * F;
  let a = (G * bu - F * bv) / det, b = (-F * bu + E * bv) / det;
  const sp = Math.sqrt(E * a * a + 2 * F * a * b + G * b * b) || 1;
  return [a / sp, b / sp];
}

/**
 * Integrate a geodesic (RK4) starting at (u,v) with parameter velocity (du,dv) (use uvVelocity for unit speed).
 * Returns { uv: [[u,v],...], pts: [[x,y,z],...], s: [arclength...] } with `steps+1` samples, step `ds` in parameter time.
 * Because geodesics have constant speed, parameter time == arclength when the initial speed is 1.
 * Pass christoffelFn(u,v) -> same object as christoffel() for analytic symbols (much more accurate on long runs).
 */
export function geodesic(f, u, v, du, dv, { steps = 400, ds = 0.02, christoffelFn = null } = {}) {
  const G = christoffelFn || ((uu, vv) => christoffel(f, uu, vv));
  const acc = (uu, vv, a, b) => {
    const c = G(uu, vv);
    return [-(c.G111 * a * a + 2 * c.G112 * a * b + c.G122 * b * b), -(c.G211 * a * a + 2 * c.G212 * a * b + c.G222 * b * b)];
  };
  const uv = [[u, v]], pts = [f(u, v)], s = [0];
  let x = u, y = v, a = du, b = dv;
  for (let i = 0; i < steps; i++) {
    const k1 = acc(x, y, a, b);
    const k2 = acc(x + 0.5 * ds * a, y + 0.5 * ds * b, a + 0.5 * ds * k1[0], b + 0.5 * ds * k1[1]);
    const k3 = acc(x + 0.5 * ds * (a + 0.5 * ds * k1[0]), y + 0.5 * ds * (b + 0.5 * ds * k1[1]), a + 0.5 * ds * k2[0], b + 0.5 * ds * k2[1]);
    const k4 = acc(x + ds * (a + 0.5 * ds * k2[0]), y + ds * (b + 0.5 * ds * k2[1]), a + ds * k3[0], b + ds * k3[1]);
    x += ds * (a + (ds / 6) * (k1[0] + k2[0] + k3[0]));
    y += ds * (b + (ds / 6) * (k1[1] + k2[1] + k3[1]));
    a += (ds / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    b += (ds / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    uv.push([x, y]); pts.push(f(x, y)); s.push((i + 1) * ds);
  }
  return { uv, pts, s };
}

/**
 * Parallel transport of a tangent vector W0=[a,b] (components in basis fu,fv) along a parameter-space path(t)->[u,v], t in [t0,t1].
 * Returns array of { t, uv, W:[a,b], vec:[x,y,z] } (vec is the vector in R^3).
 */
export function parallelTransport(f, path, W0, { t0 = 0, t1 = 1, steps = 200, christoffelFn = null } = {}) {
  const G = christoffelFn || ((uu, vv) => christoffel(f, uu, vv));
  const dp = (t) => { const e = 1e-5; const p1 = path(t + e), p0 = path(t - e); return [(p1[0] - p0[0]) / (2 * e), (p1[1] - p0[1]) / (2 * e)]; };
  const rhs = (t, W) => {
    const [u, v] = path(t), [du, dv] = dp(t), c = G(u, v);
    return [
      -(c.G111 * du * W[0] + c.G112 * du * W[1] + c.G112 * dv * W[0] + c.G122 * dv * W[1]),
      -(c.G211 * du * W[0] + c.G212 * du * W[1] + c.G212 * dv * W[0] + c.G222 * dv * W[1]),
    ];
  };
  const out = [];
  const h = (t1 - t0) / steps;
  let W = [W0[0], W0[1]];
  const emit = (t) => { const uv = path(t); const m = metric(f, uv[0], uv[1]); out.push({ t, uv, W: [W[0], W[1]], vec: add(scl(m.fu, W[0]), scl(m.fv, W[1])) }); };
  emit(t0);
  for (let i = 0; i < steps; i++) {
    const t = t0 + i * h;
    const k1 = rhs(t, W);
    const k2 = rhs(t + h / 2, [W[0] + (h / 2) * k1[0], W[1] + (h / 2) * k1[1]]);
    const k3 = rhs(t + h / 2, [W[0] + (h / 2) * k2[0], W[1] + (h / 2) * k2[1]]);
    const k4 = rhs(t + h, [W[0] + h * k3[0], W[1] + h * k3[1]]);
    W = [W[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), W[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    emit(t + h);
  }
  return out;
}

// =====================================================================================================================
//  Space curves: Frenet–Serret frame
// =====================================================================================================================
/** Frenet frame at t: { p, T, N, B, kappa, tau, speed }. r(t)->[x,y,z]. Uses 5-point stencils; h ~ 1e-2 is fine for smooth curves. */
export function frenet(r, t, h = 1e-2) {
  const p = r(t);
  const rp2 = r(t + 2 * h), rp1 = r(t + h), rm1 = r(t - h), rm2 = r(t - 2 * h);
  const d1 = scl(add(sub(scl(sub(rp1, rm1), 8), sub(rp2, rm2)), [0, 0, 0]), 1 / (12 * h));
  const d2 = scl(add(sub(scl(add(rp1, rm1), 16), add(rp2, rm2)), scl(p, -30)), 1 / (12 * h * h));
  const d3 = scl(add(sub(rp2, rm2), scl(sub(rm1, rp1), 2)), 1 / (2 * h * h * h));
  const c = cross(d1, d2), cl = len(c) || 1e-12, sp = len(d1) || 1e-12;
  const T = scl(d1, 1 / sp), B = scl(c, 1 / cl), N = cross(B, T);
  return { p, T, N, B, kappa: cl / (sp * sp * sp), tau: dot(c, d3) / (cl * cl), speed: sp };
}

export const curves = {
  helix: (a = 1, b = 0.3) => (t) => [a * Math.cos(t), b * t, a * Math.sin(t)],
  trefoil: (s = 1) => (t) => [s * (Math.sin(t) + 2 * Math.sin(2 * t)), s * (Math.cos(t) - 2 * Math.cos(2 * t)), s * -Math.sin(3 * t)],
  torusKnot: (p = 2, q = 3, R = 1.6, r = 0.6) => (t) => { const c = R + r * Math.cos(q * t); return [c * Math.cos(p * t), r * Math.sin(q * t), c * Math.sin(p * t)]; },
  lissajous: (a = 3, b = 2, c = 5, s = 1) => (t) => [s * Math.sin(a * t + 0.5), s * Math.sin(b * t), s * Math.sin(c * t + 1.1)],
};

// =====================================================================================================================
//  Classic surfaces. Each returns { f, dom:{u0,u1,v0,v1}, wrapU, wrapV } . f(u,v)->[x,y,z], y is "up".
// =====================================================================================================================
const S = Math.sin, C = Math.cos;
export const surfaces = {
  /** unit-ish sphere; u longitude [0,2π], v colatitude [0,π]. K = 1/R^2 */
  sphere: (R = 1) => ({ f: (u, v) => [R * S(v) * C(u), R * C(v), R * S(v) * S(u)], dom: { u0: 0, u1: 2 * Math.PI, v0: 0, v1: Math.PI }, wrapU: true }),
  /** torus: u around the big circle, v around the tube; K = cos v / (r (R + r cos v)) */
  torus: (R = 1.6, r = 0.6) => ({ f: (u, v) => [(R + r * C(v)) * C(u), r * S(v), (R + r * C(v)) * S(u)], dom: { u0: 0, u1: 2 * Math.PI, v0: 0, v1: 2 * Math.PI }, wrapU: true, wrapV: true }),
  /** Associate family: theta=0 helicoid, theta=π/2 catenoid; all isometric (same K(u,v) = -1/cosh^4(v)) and minimal. */
  catenoidHelicoid: (theta = 0, vmax = 1.6) => ({
    f: (u, v) => [C(theta) * Math.sinh(v) * S(u) + S(theta) * Math.cosh(v) * C(u), -C(theta) * Math.sinh(v) * C(u) + S(theta) * Math.cosh(v) * S(u), u * C(theta) + v * S(theta)],
    dom: { u0: -Math.PI, u1: Math.PI, v0: -vmax, v1: vmax }, wrapU: false,
  }),
  enneper: (a = 1.3) => ({ f: (u, v) => [u - (u * u * u) / 3 + u * v * v, u * u - v * v, v - (v * v * v) / 3 + v * u * u].map((x) => x * 0.6), dom: { u0: -a, u1: a, v0: -a, v1: a } }),
  mobius: (w = 0.8) => ({ f: (u, v) => { const r = 1 + (v / 2) * C(u / 2); return [r * C(u), (v / 2) * S(u / 2) * 1.0, r * S(u)]; }, dom: { u0: 0, u1: 2 * Math.PI, v0: -w, v1: w } }),
  /** figure-8 immersion of the Klein bottle */
  klein: (a = 2) => ({ f: (u, v) => { const r = a + C(u / 2) * S(v) - S(u / 2) * S(2 * v); return [r * C(u), S(u / 2) * S(v) + C(u / 2) * S(2 * v), r * S(u)]; }, dom: { u0: 0, u1: 2 * Math.PI, v0: 0, v1: 2 * Math.PI }, wrapU: true, wrapV: true }),
  /** hyperbolic paraboloid z = (u^2 - v^2)/s ; K<0 everywhere */
  saddle: (s = 1.2, a = 1.6) => ({ f: (u, v) => [u, (u * u - v * v) / s, v], dom: { u0: -a, u1: a, v0: -a, v1: a } }),
  monkeySaddle: (a = 1.2) => ({ f: (u, v) => [u, (u * u * u - 3 * u * v * v) * 0.5, v], dom: { u0: -a, u1: a, v0: -a, v1: a } }),
  /** pseudosphere (constant K = -1), u in (0, umax]; cusp at u=0 */
  pseudosphere: (umax = 3) => ({ f: (u, v) => [(1 / Math.cosh(u)) * C(v), u - Math.tanh(u), (1 / Math.cosh(u)) * S(v)], dom: { u0: 0.02, u1: umax, v0: 0, v1: 2 * Math.PI }, wrapV: true }),
  /** surface of revolution with profile radius ρ(z) */
  revolution: (rho, z0 = -1, z1 = 1) => ({ f: (u, v) => [rho(v) * C(u), v, rho(v) * S(u)], dom: { u0: 0, u1: 2 * Math.PI, v0: z0, v1: z1 }, wrapU: true }),
};
