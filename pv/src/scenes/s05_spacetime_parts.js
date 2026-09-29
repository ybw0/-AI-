// s05_spacetime helper: Flamm-paraboloid funnel, geodesic orbit tables (Schwarzschild), screen-space ribbons, sprite orbs.
// Units: r_s = 2GM/c^2 = 1  (so GM = 1/2).  Embedding of the spatial Schwarzschild slice:  y = 2 sqrt(r_s (r - r_s))  (Flamm's paraboloid), K = -r_s/(2 r^3).
import * as THREE from 'three';
import { GLSL, TAU } from '../util.js';

/** screen-space legibility mask: dims luminous content under the chapter title (top-left) and the caption band (bottom). m = (title, caption) visibility */
export const MASK_GLSL = /* glsl */ `
  float legMask(vec2 fc, vec2 res, vec3 m){
    vec2 sp = fc/res; float ar = res.x/res.y;
    float t = m.x*exp(-pow((sp.x - 0.21)/0.25, 2.0) - pow((sp.y - 0.66)/0.27, 2.0));
    float c = m.y*(1.0 - smoothstep(0.16, 0.40, sp.y));
    // readout box (top-right): x 1120..1796, y 108..266 of 1080 -> soft rectangle
    float bx = smoothstep(0.55, 0.60, sp.x)*(1.0 - smoothstep(0.93, 0.965, sp.x)), by = smoothstep(0.72, 0.755, sp.y)*(1.0 - smoothstep(0.90, 0.935, sp.y));
    float r = m.z*bx*by;
    return 1.0 - 0.95*max(max(t, c), r);
  }`;
export const R0 = 18;                                  // outer radius of the visible sheet
/** height of the embedding at radius r for horizon radius rs, anchored so that the rim (r = R0) sits at y = 0 */
export const yOf = (r, rs) => 2 * Math.sqrt(rs * Math.max(r - rs, 0)) - 2 * Math.sqrt(rs * (R0 - rs));
/** Flamm surface as a parametric surface f(w, phi): r = rs + w^2  (used with geom.frame to get the TRUE Gaussian curvature) */
export const flamm = (rs) => (w, ph) => { const r = rs + w * w; return [r * Math.cos(ph), 2 * Math.sqrt(rs) * w, r * Math.sin(ph)]; };

// ------------------------------------------------------------------------------------------------------------- funnel mesh
export function funnelGeometry(np = 170, na = 180) {
  const pos = new Float32Array((np + 1) * (na + 1) * 3), idx = [];
  for (let i = 0; i <= np; i++) for (let j = 0; j <= na; j++) { const o = (i * (na + 1) + j) * 3; pos[o] = i / np; pos[o + 1] = (j / na) * TAU; pos[o + 2] = 0; }
  for (let i = 0; i < np; i++) for (let j = 0; j < na; j++) { const a = i * (na + 1) + j, b = a + 1, c = a + na + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -4, 0), 60); return g;
}
const FUNNEL_VS = /* glsl */ `
  uniform float uRs, uR0; varying float vR, vAng, vK; varying vec3 vW, vN;
  void main(){
    float w = position.x*sqrt(uR0 - uRs), r = uRs + w*w, a = position.y;
    float y = 2.0*sqrt(uRs)*(w - sqrt(uR0 - uRs));
    vec3 P = vec3(r*cos(a), y, r*sin(a)); vW = P; vR = r; vAng = a; vK = -uRs/(2.0*r*r*r);
    float dy = sqrt(uRs/max(r - uRs, 1e-3)); vN = normalize(vec3(-dy*cos(a), 1.0, -dy*sin(a)));
    gl_Position = projectionMatrix*modelViewMatrix*vec4(P, 1.0);
  }`;
/** Single-pass funnel: dark translucent body (alpha) + additive curvature-coloured grid, composed as premultiplied alpha. */
export function funnelSurface() {
  const m = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uRs: { value: 1 }, uR0: { value: R0 }, uFade: { value: 1 }, uT: { value: 0 }, uWaveR: { value: -10 }, uWaveI: { value: 0 }, uGain: { value: 1 }, uSweep: { value: 1 }, uStarY: { value: 0 }, uStarI: { value: 1 }, uBand: { value: 2.8 }, uThroat: { value: 0.25 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uMask: { value: new THREE.Vector3(0, 0, 0) } },
    vertexShader: FUNNEL_VS,
    fragmentShader: /* glsl */ `
      varying float vR, vAng, vK; varying vec3 vW, vN; uniform float uFade, uT, uWaveR, uWaveI, uGain, uSweep, uRs, uStarY, uStarI, uBand, uThroat; uniform vec2 uRes; uniform vec3 uMask;
      ${GLSL.curvatureColor}
      ${MASK_GLSL}
      float line(float x, float w){ float g = abs(fract(x - 0.5) - 0.5)/max(fwidth(x), 1e-5); return 1.0 - min(g/w, 1.0); }
      void main(){
        vec3 v = normalize(cameraPosition - vW), n = normalize(vN); if(dot(n, v) < 0.0) n = -n;
        float fr = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);
        float R = vR/${R0.toFixed(1)};
        // ---- body
        vec3 body = vec3(0.006, 0.014, 0.05) + vec3(0.03,0.08,0.22)*fr*0.9;
        float ds = length(vec3(vW.x, (vW.y - uStarY)*0.8, vW.z));
        body += vec3(1.0, 0.55, 0.16)*uStarI*exp(-ds*0.55)*(0.55 + 0.45*max(dot(n, normalize(vec3(-vW.x, uStarY - vW.y + 0.5, -vW.z))), 0.0))*0.85;
        float rimFade = 1.0 - smoothstep(0.55, 1.0, R);
        float swF = 1.0 - smoothstep(uSweep - 0.02, uSweep + 0.05, R);
        float alpha = 0.80*rimFade*uFade*(0.35 + 0.65*swF)*mix(uThroat, 1.0, smoothstep(1.4, 3.4, vR));   // thin near the throat so the star's lower half does not show as a ghost cup
        // ---- grid: rings of constant Schwarzschild r (every 4th brighter) and radial lines
        float rl = line(vR, 1.25), rM = line(vR*0.25, 1.6);
        float na = 56.0, al = line(vAng*na/${TAU.toFixed(5)}, 1.15);
        float dens = 1.0 - smoothstep(0.3, 0.9, fwidth(vR)*0.9);
        float adens = 1.0 - smoothstep(0.25, 0.8, fwidth(vAng*na/${TAU.toFixed(5)}));
        float aNear = smoothstep(1.2, 3.2, vR);
        float kn = -clamp(pow(abs(vK)/0.15, 0.30), 0.0, 1.0);
        vec3 kc = curvatureColor(kn);
        vec3 cc = kc*1.9 + vec3(0.05,0.10,0.22);
        float lines = (rl*0.55*dens + rM*0.95*dens + al*0.42*adens*aNear)*mix(0.30, 1.0, smoothstep(1.0, 2.8, vR));   // grid lines dim inside r < 2.8 so the throat does not read as a glass cup around the star
        float bandX = fract(vR*0.045 + uT*0.16), band = exp(-pow((bandX - 0.5)/0.05, 2.0));
        float wave = exp(-pow((vR - uWaveR)/1.1, 2.0))*uWaveI;
        vec3 g = cc*lines*(0.75 + 1.6*fr + uBand*band + 1.0*wave)*uGain;
        g += kc*0.10*(0.4 + fr)*(0.6 + 2.0*band);
        g += vec3(0.5,0.9,1.0)*wave*0.12;
        float sw = 1.0 - smoothstep(uSweep - 0.05, uSweep, R);
        g += vec3(0.7,0.95,1.0)*smoothstep(0.012,0.0,abs(R - uSweep + 0.02))*step(uSweep, 0.999)*0.9;
        g *= rimFade*uFade*sw*legMask(gl_FragCoord.xy, uRes, uMask);
        gl_FragColor = vec4(body*alpha + g, alpha);
      }`,
  });
  m.extensions = { derivatives: true };
  return m;
}

// ------------------------------------------------------------------------------------------------------------- orbits (timelike geodesics)
/**
 * Bound orbit of a massive probe in Schwarzschild (u = 1/r, phi):  u'' = -u + GM/L^2 + 3 GM u^2,  d tau/d phi = r^2 / L.
 * Starts at apoapsis ra; turning points fix L.  Returns uniform-in-phi tables + measured apsidal precession per orbit.
 */
export function orbit(rp, ra, phiTot = 7 * Math.PI, dphi = 0.004) {
  const up = 1 / rp, ua = 1 / ra, invL2 = (up + ua) - (up * up + up * ua + ua * ua), L = 1 / Math.sqrt(invL2), GM = 0.5;
  const n = Math.ceil(phiTot / dphi) + 1, r = new Float32Array(n), tau = new Float32Array(n);
  const f = (u) => -u + GM * invL2 + 3 * GM * u * u;
  let u = ua, w = 0, tt = 0, prevW = 0, prec = NaN, seenPeri = false, uPrev = u;
  for (let i = 0; i < n; i++) {
    r[i] = 1 / u; tau[i] = tt;
    const k1u = w, k1w = f(u), k2u = w + 0.5 * dphi * k1w, k2w = f(u + 0.5 * dphi * k1u), k3u = w + 0.5 * dphi * k2w, k3w = f(u + 0.5 * dphi * k2u), k4u = w + dphi * k3w, k4w = f(u + dphi * k3u);
    const un = u + (dphi / 6) * (k1u + 2 * k2u + 2 * k3u + k4u), wn = w + (dphi / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    tt += dphi * 0.5 * (1 / (u * u) + 1 / (un * un)) / L;
    if (i > 2 && prevW > 0 && wn < 0) seenPeri = true;
    if (seenPeri && isNaN(prec) && w < 0 && wn >= 0) prec = (i + w / (w - wn)) * dphi - TAU;   // second apoapsis reached: extra angle beyond 2 pi
    prevW = w; uPrev = u; u = un; w = wn;
  }
  return { rp, ra, L, r, tau, dphi, n, precession: prec, p: (2 * rp * ra) / (rp + ra), phi: (i) => i * dphi };
}
/** phi at proper time tau (binary search + lerp) */
export function phiAtTau(o, tau) {
  const a = o.tau; if (tau <= 0) return 0; if (tau >= a[o.n - 1]) return (o.n - 1) * o.dphi;
  let lo = 0, hi = o.n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= tau) lo = m; else hi = m; }
  return (lo + (tau - a[lo]) / (a[hi] - a[lo])) * o.dphi;
}
export function rAtPhi(o, ph) { const x = Math.min(Math.max(ph, 0) / o.dphi, o.n - 1.001), i = Math.floor(x), q = x - i; return o.r[i] * (1 - q) + o.r[i + 1] * q; }

// ------------------------------------------------------------------------------------------------------------- ribbons (screen-space width, HDR, per-vertex alpha)
export function makeRibbons(nStrips, nPts, { width = 3, blending = THREE.AdditiveBlending } = {}) {
  const total = nStrips * nPts, V = total * 2;
  const P = new Float32Array(total * 3), pos = new Float32Array(V * 3), prv = new Float32Array(V * 3), nxt = new Float32Array(V * 3);
  const side = new Float32Array(V), A = new Float32Array(total), aA = new Float32Array(V), aC = new Float32Array(V * 3), C = new Float32Array(nStrips * 3), W = new Float32Array(nStrips).fill(1), aW = new Float32Array(V).fill(1);
  const idx = [];
  for (let s = 0; s < nStrips; s++) for (let i = 0; i < nPts; i++) { const v = (s * nPts + i) * 2; side[v] = -1; side[v + 1] = 1; if (i < nPts - 1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  const geo = new THREE.BufferGeometry(), attrs = { position: [pos, 3], aPrev: [prv, 3], aNext: [nxt, 3], aSide: [side, 1], aA: [aA, 1], aC: [aC, 3], aW: [aW, 1] }, dyn = {};
  for (const [k, [arr, n]] of Object.entries(attrs)) { const at = new THREE.BufferAttribute(arr, n); at.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, at); dyn[k] = at; }
  geo.setIndex(idx); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending, uniforms: { uRes: { value: new THREE.Vector2(1920, 1080) }, uWidth: { value: width }, uFade: { value: 1 }, uMask: { value: new THREE.Vector3(0, 0, 0) } },
    vertexShader: /* glsl */ `
      attribute vec3 aPrev, aNext, aC; attribute float aSide, aA, aW; uniform vec2 uRes; uniform float uWidth; varying float vSide, vA; varying vec3 vC;
      void main(){
        mat4 mvp = projectionMatrix*modelViewMatrix; vec4 c = mvp*vec4(position,1.), p = mvp*vec4(aPrev,1.), n = mvp*vec4(aNext,1.);
        float cw = c.w; c.w = max(c.w, 0.6); p.w = max(p.w, 0.6); n.w = max(n.w, 0.6);
        vec2 hr = uRes*0.5; vec2 sc = c.xy/c.w*hr, sp = p.xy/p.w*hr, sn = n.xy/n.w*hr;
        vec2 d = (sc - sp) + (sn - sc); float dl = length(d); d = dl > 1e-4 ? d/dl : vec2(1.,0.); vec2 nr = vec2(-d.y, d.x);
        vec2 s2 = sc + nr*aSide*uWidth*aW*0.5; gl_Position = vec4(s2/hr*c.w, c.z, c.w);
        vSide = aSide; vA = aA*smoothstep(0.6, 2.5, cw); vC = aC;
      }`,
    fragmentShader: /* glsl */ `varying float vSide, vA; varying vec3 vC; uniform float uFade; uniform vec2 uRes; uniform vec3 uMask; ${MASK_GLSL} void main(){ float f = pow(max(1.0 - vSide*vSide, 0.0), 1.4); float a = f*vA*uFade*legMask(gl_FragCoord.xy, uRes, uMask); gl_FragColor = vec4(vC, a); }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const rb = { mesh, P, A, C, W, nStrips, nPts, mat };
  /** copy P/A/C/W into the GPU attributes (call once per frame after writing P, A, C) */
  rb.commit = () => {
    for (let s = 0; s < nStrips; s++) {
      for (let i = 0; i < nPts; i++) {
        const k = s * nPts + i, ip = i > 0 ? k - 1 : k, inx = i < nPts - 1 ? k + 1 : k;
        for (let j = 0; j < 2; j++) {
          const v = k * 2 + j;
          for (let d = 0; d < 3; d++) { pos[v * 3 + d] = P[k * 3 + d]; prv[v * 3 + d] = P[ip * 3 + d]; nxt[v * 3 + d] = P[inx * 3 + d]; aC[v * 3 + d] = C[s * 3 + d]; }
          aA[v] = A[k]; aW[v] = W[s];
        }
      }
    }
    dyn.position.needsUpdate = dyn.aPrev.needsUpdate = dyn.aNext.needsUpdate = dyn.aA.needsUpdate = dyn.aC.needsUpdate = dyn.aW.needsUpdate = true;
  };
  return rb;
}

// ------------------------------------------------------------------------------------------------------------- orbs: round soft additive sprites (probe heads, light pulses, dust motes)
export function makeOrbs(count, px) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
  const g = new THREE.BufferGeometry();
  const aP = new THREE.BufferAttribute(pos, 3), aCo = new THREE.BufferAttribute(col, 3), aS = new THREE.BufferAttribute(size, 1);
  aP.setUsage(THREE.DynamicDrawUsage); aCo.setUsage(THREE.DynamicDrawUsage); aS.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', aP); g.setAttribute('aCol', aCo); g.setAttribute('aSize', aS); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: px }, uFade: { value: 1 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uMask: { value: new THREE.Vector3(0, 0, 0) } },
    vertexShader: `attribute vec3 aCol; attribute float aSize; uniform float uPx; varying vec3 vC; void main(){ vC = aCol; gl_PointSize = max(aSize*uPx, 0.0); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vC; uniform float uFade; uniform vec2 uRes; uniform vec3 uMask; ${MASK_GLSL} void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p)*2.0; float a = smoothstep(1.0, 0.0, d); float c = a*a*a; gl_FragColor = vec4(vC*(0.25*a*a + c*1.6)*uFade*legMask(gl_FragCoord.xy, uRes, uMask), 1.0); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return { pts, pos, col, size, mat, commit: () => { aP.needsUpdate = aCo.needsUpdate = aS.needsUpdate = true; } };
}
