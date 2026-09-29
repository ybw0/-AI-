// s05_spacetime helper: Schwarzschild black-hole lensing.
// A photon's path in the equatorial plane obeys  u'' = -u + 3 M u^2  (u = 1/r, ' = d/dphi, G=c=1, r_s = 2M = 1).
// In init() we integrate that ODE (RK4) for ~1000 impact parameters b and bake, per b, the orbit u(phi) plus the total swept angle
// Phi(b) into a half-float texture. The fragment shader then needs NO loops: pixel -> b -> table row -> (a) where the ray crosses the
// accretion-disk plane (u at phi0 + k*pi), (b) which sky direction the ray finally escapes to (Phi). Everything is exact GR ray tracing
// of a thin disk + a star field + a distant galaxy sitting straight behind the hole (its image is the Einstein ring).
import * as THREE from 'three';
import { GLSL } from '../util.js';

export const RS = 1, M = 0.5, RO = 14;                // r_s = 1, observer at r = 14 r_s
export const BC = 3 * Math.sqrt(3) * M;               // critical impact parameter = 3*sqrt(3)/2 r_s = 2.598 r_s (photon-sphere shadow)
const NB = 1024, NC = 256, NCAP = 256, PHIMAX = 3 * Math.PI, BMAX = 40, PHIENC = 4 * Math.PI;

const bOfRow = (j) => {
  if (j < NCAP) return Math.max(0.03, BC * (j / (NCAP - 1)) * (1 - 1e-4));      // captured photons
  const s = (j - (NCAP - 1)) / (NB - NCAP); return BC + (BMAX - BC) * s * s * s; // escaping photons, densely sampled just above b_c
};

/** RK4-integrate one photon. Returns { u: Float32Array(NC), phiTot } (phiTot = total swept angle incl. the final flight to infinity, or PHIENC if captured / winding a lot). */
export function integratePhoton(b, ncol = NC, phiMax = PHIMAX) {
  const u0 = 1 / RO, sub = 6, dphi = phiMax / (ncol - 1) / sub;
  let u = u0, w = Math.sqrt(Math.max(0, 1 / (b * b) - u0 * u0 * (1 - u0))), phi = 0, state = 0, phiTot = PHIENC;   // state 0 flying, 1 captured, 2 escaped
  const out = new Float32Array(ncol), f = (uu) => -uu + 1.5 * uu * uu;
  out[0] = u0;
  for (let j = 1; j < ncol; j++) {
    if (state === 0) {
      for (let s = 0; s < sub && state === 0; s++) {
        const k1u = w, k1w = f(u), k2u = w + 0.5 * dphi * k1w, k2w = f(u + 0.5 * dphi * k1u), k3u = w + 0.5 * dphi * k2w, k3w = f(u + 0.5 * dphi * k2u), k4u = w + dphi * k3w, k4w = f(u + dphi * k3u);
        const un = u + (dphi / 6) * (k1u + 2 * k2u + 2 * k3u + k4u), wn = w + (dphi / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
        if (un >= 1) { state = 1; break; }
        if (wn < 0 && un <= u0) { const q = (u - u0) / Math.max(u - un, 1e-12); phiTot = phi + q * dphi + Math.asin(Math.min(1, b / RO)); state = 2; phi += dphi; break; }
        u = un; w = wn; phi += dphi;
      }
    }
    out[j] = state === 0 ? u : state === 1 ? 1 : 0;
  }
  return { u: out, phiTot: state === 1 ? PHIENC : Math.min(phiTot, PHIENC), state };
}

/** textbook deflection alpha(b): RK4 from infinity to infinity (u = 0 -> turning point -> u = 0), alpha = Phi_total - pi  (weak field: 4GM/(b c^2) = 2/b in r_s units, plus O(1/b^2) corrections) */
export function deflection(b) {
  const dphi = 0.0005, f = (uu) => -uu + 1.5 * uu * uu;
  let u = 0, w = 1 / b, phi = 0, turned = false;
  for (let i = 0; i < 400000; i++) {
    const k1u = w, k1w = f(u), k2u = w + 0.5 * dphi * k1w, k2w = f(u + 0.5 * dphi * k1u), k3u = w + 0.5 * dphi * k2w, k3w = f(u + 0.5 * dphi * k2u), k4u = w + dphi * k3w, k4w = f(u + dphi * k3u);
    const un = u + (dphi / 6) * (k1u + 2 * k2u + 2 * k3u + k4u), wn = w + (dphi / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    if (un >= 1) return NaN;
    if (wn < 0) turned = true;
    if (turned && un <= 0) { const q = u / Math.max(u - un, 1e-12); return phi + q * dphi - Math.PI; }
    u = un; w = wn; phi += dphi;
  }
  return NaN;
}

export function bakeTable() {
  const data = new Uint16Array(NB * NC * 4), H = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < NB; j++) {
    const r = integratePhoton(bOfRow(j)), g = H(r.phiTot / PHIENC);
    for (let i = 0; i < NC; i++) { const o = (j * NC + i) * 4; data[o] = H(r.u[i]); data[o + 1] = g; data[o + 2] = 0; data[o + 3] = H(1); }
  }
  const tex = new THREE.DataTexture(data, NC, NB, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}

export function lensMaterial(tab) {
  const U = (v) => ({ value: v });
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      uTab: U(tab), uRes: U(new THREE.Vector2(1920, 1080)), uCenter: U(new THREE.Vector2(0, 0)), uBScale: U(9), uInc: U(1.36), uRoll: U(0), uT: U(0), uAlpha: U(1),
      uRin: U(3.0), uRout: U(8.5), uSkyRot: U(0), uDiskI: U(1), uRingI: U(1), uWave: U(-1), uSkyI: U(1), uSpin: U(0), uGal: U(1),
    },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      precision highp float; varying vec2 vP; uniform sampler2D uTab;
      uniform vec2 uRes, uCenter; uniform float uBScale,uInc,uRoll,uT,uAlpha,uRin,uRout,uSkyRot,uDiskI,uRingI,uWave,uSkyI,uSpin,uGal;
      ${GLSL.hash} ${GLSL.noise}
      const float PI = 3.14159265, BC = ${BC.toFixed(6)}, BMAX = ${BMAX.toFixed(1)}, NCAPm = ${(NCAP - 1).toFixed(1)}, NBv = ${NB.toFixed(1)}, NBnc = ${(NB - NCAP).toFixed(1)}, PHIMAX = ${PHIMAX.toFixed(6)}, NCn = ${NC.toFixed(1)}, PHIENC = ${PHIENC.toFixed(6)}, RO = ${RO.toFixed(1)};

      vec3 starLayer(vec3 d, float sc, float dens, float sz, float bright){
        vec3 p = d*sc, c = floor(p), f = p - c, h = hash33(c), h2 = hash33(c + 17.31);
        float on = step(1.0 - dens, h.x);
        vec3 pos = 0.22 + 0.56*h2;
        float fw = length(fwidth(p))*0.75, r = clamp(max(sz, fw), sz, 0.45);
        float dd = length(f - pos), a = smoothstep(r, 0.0, dd); a *= a;
        vec3 col = mix(vec3(0.62,0.78,1.0), vec3(1.0,0.84,0.62), h.y);
        return col*a*on*bright*(0.25 + 2.2*h.z*h.z*h.z);
      }
      vec3 diskRamp(float x){
        vec3 c0 = vec3(0.30,0.05,0.02), c1 = vec3(1.00,0.34,0.07), c2 = vec3(1.00,0.70,0.30), c3 = vec3(1.00,0.92,0.80), c4 = vec3(0.80,0.90,1.00);
        if(x < 0.35) return mix(c0, c1, x/0.35); if(x < 0.75) return mix(c1, c2, (x-0.35)/0.40); if(x < 1.15) return mix(c2, c3, (x-0.75)/0.40); return mix(c3, c4, clamp((x-1.15)/0.6,0.,1.));
      }
      void main(){
        float asp = uRes.x/uRes.y;
        vec2 p = vec2(vP.x*asp, vP.y) - uCenter;
        float rho = length(p), kk = uBScale/RO, b = RO*rho*kk/sqrt(1.0 + rho*rho*kk*kk)/sqrt(1.0 - 1.0/RO);   // static observer at RO: b = RO sin(eps)/sqrt(1 - r_s/RO), eps = atan(rho k)
        float th = atan(p.y, p.x) - uRoll;
        float si = sin(uInc), ci = cos(uInc);
        vec3 a = vec3(0.0, si, ci), e1 = vec3(1.0,0.0,0.0), e2 = vec3(0.0, ci, -si);
        vec3 d = cos(th)*e1 + sin(th)*e2;
        float idx = b < BC ? b/BC*NCAPm : NCAPm + pow(clamp((b-BC)/(BMAX-BC), 0.0, 1.0), 0.3333333)*NBnc;
        float vy = (idx + 0.5)/NBv;
        bool capt = b < BC;
        float PhiT = texture2D(uTab, vec2(0.5/NCn, vy)).g*PHIENC;

        // ---- accretion disk: up to 3 crossings of the disk plane y = 0 (front to back)
        float phi0 = atan(a.y, -d.y);
        vec3 col = vec3(0.0); float accA = 0.0;
        for(int k = 0; k < 3; k++){
          float ph = phi0 + float(k)*PI;
          if(k == 2 && uInc < 0.3 && b > 1.6*BC) break;     // third (far-side) image only matters near the shadow at grazing angles
          if(ph < PHIMAX && accA < 0.985){
            float uu = texture2D(uTab, vec2((ph/PHIMAX*(NCn-1.0) + 0.5)/NCn, vy)).r;
            float r = 1.0/max(uu, 1e-3);
            if(r > uRin && r < uRout){
              vec3 q = cos(ph)*a + sin(ph)*d;
              float aa = atan(q.z, q.x);
              float om = 0.55/(r*sqrt(r));
              float ang = aa - om*uT*(1.0 + uSpin);
              float t0 = pow(uRin/r, 0.75);
              float fwr = fwidth(r);
              float hf = 1.0 - smoothstep(0.10, 0.40, fwr);
              float n1 = snoise(vec3(r*2.6, cos(ang)*1.5, sin(ang)*1.5))*0.5 + 0.5;
              float n2 = 0.5;
              if(r < 6.0){ n2 = (snoise(vec3(r*11.0, cos(ang*2.0)*2.4, sin(ang*2.0)*2.4) + 7.0)*0.5 + 0.5)*hf + 0.5*(1.0-hf); }   // fine detail only where it is visible (perf)
              float turb = 0.42 + 0.75*n1*(0.55 + 0.9*n2);
              vec3 tv = vec3(q.z, 0.0, -q.x);                       // orbital direction (counter-clockwise seen from +y)
              float beta = sqrt(0.5/r)*0.95;
              float g = sqrt(1.0 - beta*beta)/(1.0 - beta*dot(tv, a)); // Doppler
              float gz = sqrt(max(1.0 - 1.0/r, 0.02));                 // gravitational redshift
              float gg = g*gz;
              float tm = t0*gg*0.95;
              float I = (0.45 + 2.0*t0)*turb*pow(gg, 2.1);
              float op = smoothstep(uRin, uRin + 0.22, r)*(1.0 - smoothstep(uRout - 2.2, uRout, r))*clamp(0.35 + 0.8*n1, 0.0, 0.97);
              vec3 c = diskRamp(tm)*I*uDiskI;
              col += (1.0 - accA)*c*op; accA += (1.0 - accA)*op;
            }
          }
        }

        // ---- sky seen through the lens (only for photons that escape)
        vec3 sky = vec3(0.0);
        if(!capt && accA < 0.98){
          float Phi = min(PhiT, PHIENC);
          vec3 dout = cos(Phi)*a + sin(Phi)*d;
          // rotate about the view axis (slow sky drift)
          float cr = cos(uSkyRot), sr = sin(uSkyRot);
          vec3 ds = dout*cr + cross(a, dout)*sr + a*dot(a, dout)*(1.0 - cr);
          sky  = starLayer(ds, 62.0, 0.05, 0.075, 1.2) + starLayer(ds + 3.1, 150.0, 0.03, 0.10, 1.4);
          sky += starLayer(ds + 9.7, 28.0, 0.010, 0.11, 2.6)*vec3(1.0,0.96,0.9);
          float n = snoise(ds*5.0 + 1.3)*0.5 + 0.5, m = snoise(ds*9.0 + 8.0)*0.5 + 0.5;
          float k = pow(clamp(n*0.75 + m*0.45 - 0.42, 0.0, 1.0), 1.5);
          sky += mix(vec3(0.02,0.06,0.22), vec3(0.16,0.05,0.30), m)*k*0.30;
          // the distant galaxy directly behind the lens -> Einstein ring / arcs
          if(cos(Phi) < -0.97){   // galaxy only where the escaping ray points (nearly) straight back behind the hole
          vec3 sd = normalize(-a + 0.024*(cos(uSkyRot + 1.0)*e1 + sin(uSkyRot + 1.0)*e2));
          vec3 qq = dout - dot(dout, sd)*sd; float gx = dot(qq, e1), gy = dot(qq, e2), s1 = 0.0100, s2 = 0.0050;
          float ell = (gx*gx)/(s1*s1) + (gy*gy)/(s2*s2), core = exp(-ell*0.5), sp = 0.5 + 0.5*cos(atan(gy, gx*2.0)*2.0 - length(qq)*110.0);
          sky += uGal*(vec3(1.0,0.82,0.55)*core*2.1 + vec3(0.55,0.72,1.0)*exp(-length(qq)/0.014)*(0.4 + 0.6*sp)*0.75); }
          sky *= uSkyI;
        }
        // ---- photon ring + soft halo hugging the shadow
        float rd = (b - BC)/BC;
        float ring = capt ? 0.0 : exp(-pow(rd/0.022, 2.0))*1.5 + exp(-rd/0.09)*0.16;
        vec3 ringC = vec3(1.0,0.86,0.62)*ring*uRingI;
        float glowIn = capt ? exp(-(BC - b)/0.25)*0.05 : 0.0;
        vec3 res = col + (1.0 - accA)*sky + ringC*(1.0 - 0.6*accA) + vec3(0.9,0.55,0.25)*glowIn*uRingI;
        // ---- hero shock ring (spacetime ripple)
        if(uWave >= 0.0){
          float rw = uWave*1.9, wd = (rho - rw)/(0.005 + 0.006*uWave), fadeW = exp(-uWave*1.7);
          res += vec3(0.6,0.88,1.0)*exp(-wd*wd)*1.5*fadeW + vec3(0.25,0.4,1.0)*exp(-abs(rho - rw)*4.0)*0.05*fadeW*step(rho, rw);
        }
        gl_FragColor = vec4(res, uAlpha);
      }`,
  });
}

export function lensQuad(mat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; m.renderOrder = -50; return m;
}
