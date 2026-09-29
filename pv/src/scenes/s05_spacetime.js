// s05_spacetime — 时空 / Spacetime.  52–62 s (local 0–10, alive to 11), hero 6.0.
// Act A (0–6): Flamm's paraboloid (the true embedding of the Schwarzschild spatial slice, K = -r_s/2r^3) forms around a star that sinks in as the
//   sheet deepens; probes trace precessing rosettes = timelike geodesics (RK4 in init); photons bend around the well = null geodesics.
// HERO 6.0: the star collapses, the camera dives down the throat, flash — and we are looking at a Schwarzschild black hole: exact RK4 photon
//   tracing baked into a lookup texture gives the lensed accretion disk, photon ring, lensed star field and an Einstein ring of a galaxy behind it.
// Everything is a pure function of t.  Precomputed in init: orbit tables, ray tables, lens table.
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, smoothstep, palette, orbitCamera, rng, glowTexture, TAU, GLSL } from '../util.js';
import { frame } from '../geom.js';
import * as kit from '../kit.js';
import { R0, yOf, flamm, funnelGeometry, funnelSurface, orbit, phiAtTau, rAtPhi, makeRibbons, makeOrbs } from './s05_spacetime_parts.js';
import { bakeTable, lensMaterial, lensQuad, deflection, integratePhoton, BC } from './s05_spacetime_lens.js';

const T_HERO = 6.0;
const PROBES = [
  { rp: 3.1, ra: 11.5, col: palette.gold, ph0: 0.0, t0: 1.9, adv: 0.9 },
  { rp: 4.0, ra: 13.5, col: palette.cyan, ph0: 1.15, t0: 2.1, adv: 0.5 },
  { rp: 3.4, ra: 9.5, col: palette.magenta, ph0: 2.55, t0: 2.3, adv: 1.1 },
  { rp: 6.0, ra: 11, col: palette.violet, ph0: 3.7, t0: 2.5, adv: 0.7 },
  { rp: 5.0, ra: 15.5, col: palette.white, ph0: 4.7, t0: 2.2, adv: 0.4 },
  { rp: 8.0, ra: 13, col: 0x7fb0ff, ph0: 5.6, t0: 2.7, adv: 0.6 },
];
const TAU_RATE = 44, TRAIL_N = 240, TRAIL_ANG = 4.4 * Math.PI;
const RAYS = [2.95, -3.15, 3.7, -4.4, 5.2, -6.2, 7.6, -9.2, 11.5];
const RAY_N = 200, RAY_ROT = 4.4;
const MOTES = 620;

/** Hermite keyframes [[t,v],...] -> smooth C1 function of t */
function kf(t, K) {
  const n = K.length; if (t <= K[0][0]) return K[0][1]; if (t >= K[n - 1][0]) return K[n - 1][1];
  let i = 0; while (i < n - 2 && t >= K[i + 1][0]) i++;
  const [t0, v0] = K[i], [t1, v1] = K[i + 1], dt = t1 - t0, h = (t - t0) / dt;
  const m0 = i > 0 ? (v1 - K[i - 1][1]) / (t1 - K[i - 1][0]) : (v1 - v0) / dt, m1 = i < n - 2 ? (K[i + 2][1] - v0) / (K[i + 2][0] - t0) : (v1 - v0) / dt;
  const h2 = h * h, h3 = h2 * h;
  return (2 * h3 - 3 * h2 + 1) * v0 + (h3 - 2 * h2 + h) * dt * m0 + (-2 * h3 + 3 * h2) * v1 + (h3 - h2) * dt * m1;
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sci = (x) => { if (x === 0) return '0'; const e = Math.floor(Math.log10(Math.abs(x))), m = x / Math.pow(10, e); return `${m.toFixed(2).replace('-', '−')}×10${e < 0 ? '⁻' : ''}${String(Math.abs(e)).split('').map((d) => SUP[+d]).join('')}`; };

export default {
  init(ctx) {
    ctx.background(palette.void);
    const S = ctx.scene;
    this.bd = kit.backdrop(ctx, { seed: 11, a: 0x050a26, b: 0x1c0c46, c: 0x06304a, intensity: 0.75, scale: 1.4 }); S.add(this.bd);
    this.stars = kit.starfield(ctx, { count: 2600, seed: 21, intensity: 0.9 }); S.add(this.stars);

    // ---- funnel (Flamm paraboloid) : dark body + additive curvature-coloured grid
    this.fGeo = funnelGeometry(); this.fMat = funnelSurface();
    this.fMesh = new THREE.Mesh(this.fGeo, this.fMat); this.fMesh.renderOrder = 0; this.fMesh.frustumCulled = false;
    this.funnel = new THREE.Group(); this.funnel.add(this.fMesh); S.add(this.funnel);

    // ---- the star (the mass) that sinks into the well and later collapses
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uI: { value: 1 } },
      vertexShader: 'varying vec3 vN, vP, vV; void main(){ vP = position; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }',
      fragmentShader: `varying vec3 vN, vP, vV; uniform float uT, uI; ${GLSL.noise}
        void main(){ vec3 n = normalize(vN), v = normalize(vV); float fr = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);
          float g = snoise(vP*3.2 + vec3(0.0, uT*0.5, 0.0))*0.5 + 0.5, g2 = snoise(vP*8.0 - uT*0.7)*0.5 + 0.5;
          vec3 col = mix(vec3(1.0,0.30,0.04), vec3(1.0,0.72,0.28), g*0.7 + g2*0.3)*1.9 + vec3(1.0,0.75,0.4)*fr*2.4; gl_FragColor = vec4(col*uI, 1.0); }`,
    });
    this.star = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.starMat); S.add(this.star);
    this.starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xffa040).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.starGlow.renderOrder = 4; S.add(this.starGlow);
    this.starGlow2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0x5ee7ff).multiplyScalar(0.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.starGlow2.renderOrder = 4; S.add(this.starGlow2);
    this.burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xfff4e0).multiplyScalar(5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, depthTest: false }));
    this.burst.renderOrder = 6; S.add(this.burst);

    // ---- probes: timelike geodesics with real apsidal precession
    this.orbits = PROBES.map((p) => orbit(p.rp, p.ra));
    this.trails = makeRibbons(PROBES.length, TRAIL_N, { width: 3.4 }); this.trails.mesh.renderOrder = 2; S.add(this.trails.mesh);
    PROBES.forEach((p, i) => { const c = new THREE.Color(p.col); this.trails.C.set([c.r * 2.1, c.g * 2.1, c.b * 2.1], i * 3); });
    // ---- photons: null geodesics (light rays) bent by the well
    this.rays = RAYS.map((b) => this.traceRay(b));
    this.rayRib = makeRibbons(RAYS.length, RAY_N, { width: 3.0 }); this.rayRib.mesh.renderOrder = 2; S.add(this.rayRib.mesh);
    for (let i = 0; i < RAYS.length; i++) { const c = new THREE.Color(0xffefc8); this.rayRib.C.set([c.r * 1.9, c.g * 1.85, c.b * 1.7], i * 3); }
    // ---- orbs: probe heads + photon pulses, and the drifting dust that falls into the well
    this.heads = makeOrbs(PROBES.length + RAYS.length, ctx.px); this.heads.pts.renderOrder = 3; S.add(this.heads.pts);
    this.motes = makeOrbs(MOTES, ctx.px); this.motes.pts.renderOrder = 3; S.add(this.motes.pts);
    const r = rng(77); this.mote = Array.from({ length: MOTES }, () => ({ ph: r(), a0: r() * TAU, sp: 0.55 + 0.9 * r(), rate: 0.035 + 0.05 * r(), lift: 0.05 + 0.5 * r() * r(), sz: 2.0 + 4.5 * Math.pow(r(), 3), m: r(), br: 0.25 + 0.75 * r() }));

    // ---- black hole lens (full-screen quad, exact ray tables)
    this.tab = bakeTable(); this.lensMat = lensMaterial(this.tab); this.lens = lensQuad(this.lensMat); S.add(this.lens);

    // ---- real numbers for the HUD
    this.bcNum = (() => { let lo = 2.5, hi = 2.7; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (integratePhoton(m, 4096, 20 * Math.PI).state === 1) lo = m; else hi = m; } return (lo + hi) / 2; })();
    this.alpha10 = deflection(10);
    this.flammF = flamm(1);
  },

  /** null geodesic of the Schwarzschild well (r_s = 1) coming from the left with impact parameter b; returns resampled (r, psi) arrays */
  traceRay(b) {
    const ab = Math.abs(b), sg = Math.sign(b), Rs = R0 - 1.5, dphi = 0.002, f = (u) => -u + 1.5 * u * u;
    let u = 1 / Rs, w = Math.sqrt(Math.max(0, 1 / (ab * ab) - u * u * (1 - u))), phi = 0;
    const rr = [1 / u], ps = [0], ss = [0]; let s = 0;
    for (let i = 0; i < 9000; i++) {
      const k1u = w, k1w = f(u), k2u = w + 0.5 * dphi * k1w, k2w = f(u + 0.5 * dphi * k1u), k3u = w + 0.5 * dphi * k2w, k3w = f(u + 0.5 * dphi * k2u), k4u = w + dphi * k3w, k4w = f(u + dphi * k3u);
      const un = u + (dphi / 6) * (k1u + 2 * k2u + 2 * k3u + k4u), wn = w + (dphi / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
      phi += dphi; const r0 = 1 / u, r1 = 1 / un; s += Math.hypot(r1 - r0, 0.5 * (r0 + r1) * dphi);
      u = un; w = wn; rr.push(r1); ps.push(phi); ss.push(s);
      if (un > 0.985 || (w < 0 && un <= 1 / Rs)) break;
    }
    const psi0 = Math.PI - Math.asin(Math.min(1, ab / Rs)), rs_ = new Float32Array(RAY_N), pp = new Float32Array(RAY_N);
    let j = 0; const total = ss[ss.length - 1];
    for (let i = 0; i < RAY_N; i++) { const target = (i / (RAY_N - 1)) * total; while (j < ss.length - 2 && ss[j + 1] < target) j++; const q = (target - ss[j]) / Math.max(ss[j + 1] - ss[j], 1e-9); rs_[i] = rr[j] + (rr[j + 1] - rr[j]) * q; pp[i] = sg * (psi0 - (ps[j] + (ps[j + 1] - ps[j]) * q)); }
    return { r: rs_, psi: pp, total, b };
  },

  update(t, ctx) {
    const ui = ctx.ui, S = ctx.scene;
    // the sheet reaches its true r_s = 1 curvature by t = 2.0, i.e. BEFORE the first probe (t0 >= 1.9) is launched, so every geodesic rides the sheet it was integrated on
    const rs = 0.10 + 0.90 * seg(t, 0.0, 2.0, ease.inOutCubic);
    const inFun = t < 6.2, heroK = smoothstep(5.90, 6.08, t);   // funnel -> lens crossfade window 5.90-6.08 (no single-frame swap)
    // ---------------------------------------------------------------- camera (funnel phase)
    const az = kf(t, [[0, 0.52], [3, 1.02], [5, 1.42], [5.6, 1.95], [6.1, 2.6]]);
    const el = kf(t, [[0, 0.66], [1.5, 0.44], [3.0, 0.32], [4, 0.38], [5.0, 0.52], [5.6, 0.92], [6.0, 1.36], [6.1, 1.4]]);
    const rc = kf(t, [[0, 16], [1.6, 19.6], [3, 20], [5, 17.5], [5.6, 14], [6.0, 6.5], [6.1, 6.0]]);
    const ty = kf(t, [[0, -3.0], [3, -3.6], [5, -4.4], [5.6, -7.6], [6.0, -9.3], [6.1, -9.4]]);
    orbitCamera(ctx.camera, { target: [0, ty, 0], r: rc, az, el });
    const cam = ctx.camera.position;

    // ---------------------------------------------------------------- funnel + star
    for (const m of [this.fMat]) { m.uniforms.uRs.value = rs; m.uniforms.uT.value = t; m.uniforms.uFade.value = 1 - smoothstep(5.90, 6.10, t); }
    this.fMat.uniforms.uSweep.value = 0.22 + 1.03 * seg(t, 0.0, 1.9, ease.outCubic);          // the grid ignites outward from the star
    this.fMat.uniforms.uBand.value = 2.8 + 1.9 * (1 - seg(t, 0.5, 1.9, ease.inOutSine));       // bright travelling band pulse in the opening second
        const yThroat = yOf(rs, rs);
    const collapse = seg(t, 5.15, 5.96, ease.inCubic);
    const starR = 1.0 * (1 - 0.93 * collapse), starY = yThroat + (1.32 + 0.08 * Math.sin(t * 1.3)) * (1 - 0.35 * collapse);
    const throb = 1 + 0.03 * Math.sin(t * 7.0) + 0.5 * collapse * Math.sin(t * 38.0) * 0.1;
    this.star.position.set(0, starY, 0); this.star.scale.setScalar(starR * throb);
    this.starMat.uniforms.uT.value = t; this.starMat.uniforms.uI.value = 1 + 0.9 * collapse;
    this.star.visible = t < 5.99;
    const starVis = 1 - smoothstep(5.85, 6.02, t);
    const dC = cam.distanceTo(this.star.position);
    this.starGlow.position.set(0, starY, 0); this.starGlow.scale.setScalar(Math.min(dC * 0.30, 3.6) * (1 + 0.12 * Math.sin(t * 2.2) + 0.35 * collapse) * starVis); this.starGlow.material.opacity = 0.85;
    this.starGlow2.position.copy(this.starGlow.position); this.starGlow2.scale.setScalar(Math.min(dC * 0.6, 7) * (1 + 0.2 * collapse) * starVis); this.starGlow2.material.opacity = 0.45 * (1 - collapse * 0.6);
    this.starGlow.visible = this.starGlow2.visible = starVis > 0.001 && inFun;
    for (const m of [this.fMat]) { m.uniforms.uStarY.value = starY; m.uniforms.uStarI.value = (0.7 + 0.4 * collapse) * (1 - smoothstep(5.8, 6.0, t)); }

    // collapse burst: a radial blaze (not a veil) that peaks exactly at the hero hit
    const bw = seg(t, 5.9, 6.0, ease.inQuad) * (1 - seg(t, 6.0, 6.09, ease.outQuad));
    { const dir = new THREE.Vector3(0, ty, 0).sub(cam).normalize(), ctr = cam.clone().add(dir.multiplyScalar(dC)), k = smoothstep(5.9, 6.0, t); this.burst.position.set(ctr.x * k, lerp(starY, ctr.y, k), ctr.z * k); } this.burst.scale.setScalar(0.7 + 0.9 * bw); this.burst.material.opacity = 0.18 * bw; this.burst.visible = bw > 0.001;
    // ---------------------------------------------------------------- probes (timelike geodesics) — trails on the sheet
    const hp = [];
    const tr = this.trails, P = tr.P, A = tr.A;
    for (let i = 0; i < PROBES.length; i++) {
      const o = this.orbits[i], pr = PROBES[i];
      const tau = Math.max(0, t - pr.t0) * TAU_RATE, phiH = phiAtTau(o, tau), active = t > pr.t0;
      let head = null;
      for (let k = 0; k < TRAIL_N; k++) {
        const q = k / (TRAIL_N - 1), ph = phiH - q * TRAIL_ANG, ok = active && ph >= 0;
        const rr_ = rAtPhi(o, Math.max(ph, 0)), ang = pr.ph0 + Math.max(ph, 0);
        const y = yOf(rr_, rs) + 0.03, id = (i * TRAIL_N + k) * 3;
        P[id] = rr_ * Math.cos(ang); P[id + 1] = y; P[id + 2] = rr_ * Math.sin(ang);
        A[i * TRAIL_N + k] = ok ? 0.95 * Math.pow(1 - q, 1.7) : 0;
        if (k === 0) head = [P[id], y + 0.02, P[id + 2], rr_, ang];
      }
      hp.push({ head, active, o, phiH, r: head[3], ang: head[4] });
    }
    tr.mat.uniforms.uFade.value = 1 - smoothstep(5.7, 6.15, t); tr.commit(); tr.mesh.visible = inFun;

    // ---------------------------------------------------------------- photons
    const rb = this.rayRib, HR = this.heads;
    for (let i = 0; i < RAYS.length; i++) {
      const ray = this.rays[i], t0 = 3.3 + 0.28 * i, cyc = (t - t0) / (2.5 + 0.12 * (i % 3)), on = t > t0;
      const f = on ? (cyc - Math.floor(cyc)) * 1.35 : -1, appear = on ? smoothstep(0, 0.5, t - t0) : 0;
      for (let k = 0; k < RAY_N; k++) {
        const q = k / (RAY_N - 1), r_ = ray.r[k], y = yOf(r_, rs) + 0.05, ang = ray.psi[k] + RAY_ROT, id = (i * RAY_N + k) * 3;
        rb.P[id] = r_ * Math.cos(ang); rb.P[id + 1] = y; rb.P[id + 2] = r_ * Math.sin(ang);
        const d = f - q; rb.A[i * RAY_N + k] = appear * (0.13 + (d >= 0 ? (1.2 * Math.exp(-d / 0.05) + 0.34 * Math.exp(-d / 0.45)) * smoothstep(0, 0.02, d + 0.005) : 0));
      }
      const hf = clamp(f, 0, 1), kk = Math.min(RAY_N - 1, Math.floor(hf * (RAY_N - 1))), idh = (i * RAY_N + kk) * 3, hv = on && f <= 1.0 ? Math.sin(Math.PI * clamp(f, 0, 1)) ** 0.5 : 0;
      const o = (PROBES.length + i) * 3; HR.pos[o] = rb.P[idh]; HR.pos[o + 1] = rb.P[idh + 1] + 0.03; HR.pos[o + 2] = rb.P[idh + 2];
      HR.col[o] = 1.6 * hv * appear; HR.col[o + 1] = 2.0 * hv * appear; HR.col[o + 2] = 2.4 * hv * appear; HR.size[PROBES.length + i] = 22 * hv;
    }
    rb.mat.uniforms.uFade.value = 1 - smoothstep(5.6, 6.1, t); rb.commit(); rb.mesh.visible = inFun;
    // probe heads
    for (let i = 0; i < PROBES.length; i++) {
      const h = hp[i], c = new THREE.Color(PROBES[i].col), o = i * 3, vis = h.active ? smoothstep(PROBES[i].t0, PROBES[i].t0 + 0.4, t) : 0;
      HR.pos[o] = h.head[0]; HR.pos[o + 1] = h.head[1] + 0.02; HR.pos[o + 2] = h.head[2];
      HR.col[o] = (0.9 + c.r * 2.4) * vis; HR.col[o + 1] = (0.9 + c.g * 2.4) * vis; HR.col[o + 2] = (0.9 + c.b * 2.4) * vis; HR.size[i] = 34 * vis;
    }
    HR.mat.uniforms.uFade.value = 1 - smoothstep(5.7, 6.15, t); HR.commit(); HR.pts.visible = inFun;

    // ---------------------------------------------------------------- dust motes falling down the well
    const M_ = this.motes;
    for (let i = 0; i < MOTES; i++) {
      const m = this.mote[i], f = (m.ph + t * m.rate) % 1, r_ = (R0 - 1) - (R0 - 3.5) * Math.pow(f, 1.35), ang = m.a0 + t * m.sp * 2.4 / Math.pow(Math.max(r_, 1.5), 1.5) * 3.0;
      const y = yOf(r_, rs) + m.lift, a = smoothstep(0.0, 0.07, f) * (1 - smoothstep(0.9, 1.0, f)) * (0.35 + 0.65 * smoothstep(0.0, 0.5, t)) * m.br;
      M_.pos[i * 3] = r_ * Math.cos(ang); M_.pos[i * 3 + 1] = y; M_.pos[i * 3 + 2] = r_ * Math.sin(ang);
      const warm = smoothstep(9, 2.5, r_); M_.col[i * 3] = (0.35 + 1.0 * warm + 0.2 * m.m) * a; M_.col[i * 3 + 1] = (0.7 + 0.2 * warm) * a; M_.col[i * 3 + 2] = (1.0 - 0.45 * warm) * a; M_.size[i] = m.sz * (1 + 0.5 * warm);
    }
    M_.mat.uniforms.uFade.value = 1 - smoothstep(5.8, 6.2, t); M_.commit(); M_.pts.visible = inFun;

    // ---------------------------------------------------------------- hero: black hole lens
    const L = this.lensMat.uniforms, th = t - T_HERO;
    L.uAlpha.value = heroK; this.lens.visible = t > 5.89;
    // framing: the hole is already at (nearly) its final composition at the hit — shadow radius ~ the funnel throat (matched scale), then a quick
    // settle (done by ~6.9) and a slow push-in over 8-11 so the ending never freezes
    const settle = ease.outCubic(seg(t, T_HERO, T_HERO + 0.9, ease.linear)), push = seg(t, 8.0, 11.0, ease.inOutSine);
    L.uBScale.value = lerp(9.2, 10.4, settle) - 1.0 * push;
    const cx = lerp(0.0, 0.52, ease.inOutCubic(seg(t, T_HERO + 0.05, T_HERO + 1.1, ease.linear))) + 0.05 * push, cy = lerp(0.0, 0.09, seg(t, 6.1, 8.0));
    L.uCenter.value.set(cx, cy);
    L.uInc.value = lerp(0.55, 0.19, ease.outCubic(seg(t, T_HERO + 0.05, T_HERO + 1.2, ease.linear))) + 0.02 * Math.sin(t * 0.5);
    L.uRoll.value = lerp(-0.25, 0.13, ease.outCubic(seg(t, T_HERO, T_HERO + 3.0, ease.linear))) + 0.012 * Math.sin(t * 0.35) + 0.03 * Math.sin(0.55 * (t - 7.0)) * seg(t, 7.0, 8.5, ease.inOutSine);
    L.uT.value = t; L.uSkyRot.value = 0.25 + 0.035 * t; L.uSpin.value = 3.0 * (1 - seg(t, 6.0, 8.0));
    L.uRin.value = 3.0; L.uRout.value = 8.6;
    const heroGlow = smoothstep(5.92, 6.02, t) * Math.exp(-Math.max(t - 6.05, 0) / 0.40);     // 0..1 surge of the disk right at the hit, decays over ~0.6 s
    L.uDiskI.value = 0.32 + 0.16 * pulse(t, 6.0, 7.4, 0.06, 1.2) + 0.50 * heroGlow;
    L.uRingI.value = 0.42 + 0.22 * pulse(t, 6.0, 7.2, 0.05, 1.2); L.uGal.value = 0.8 + 0.5 * seg(t, 6.5, 8.8);
    L.uWave.value = th >= 0 && th < 1.4 ? th : -1;
    this.stars.visible = this.bd.visible = t < 6.12;
    kit.updateStars(this.stars, t);
    this.lensMat.uniforms.uRes.value.set(ctx.W, ctx.H);
    for (const m of [tr.mat, rb.mat]) m.uniforms.uRes.value.set(ctx.W, ctx.H);
    HR.mat.uniforms.uPx.value = ctx.px; M_.mat.uniforms.uPx.value = ctx.px;
    // spacetime ripple spreading over the funnel at the collapse
    const wv = seg(t, 5.7, 6.15, ease.linear); this.fMat.uniforms.uWaveR.value = wv > 0 ? 1 + wv * 17 : -10; this.fMat.uniforms.uWaveI.value = wv > 0 ? Math.sin(Math.PI * wv) * 0.5 : 0;
    this.fMat.uniforms.uGain.value = 1 + 0.9 * seg(t, 4.6, 5.9, ease.inQuad);
    this.funnel.visible = inFun;

    // ---------------------------------------------------------------- post: quiet build, huge hit at 6.0
    const hit = Math.exp(-Math.pow((t - T_HERO) / 0.035, 2));
    const build = seg(t, 4.8, 5.95, ease.inCubic);
    const wake = t >= T_HERO ? Math.exp(-(t - T_HERO) / 0.09) : 0;                // short tail after the hit
    ctx.post.bloom = 0.8 + 0.25 * build + 0.28 * hit + 0.3 * pulse(t, 6.0, 7.6, 0.05, 1.4) + 0.1 * wake;
    ctx.post.flash = 0.42 * Math.exp(-Math.pow((t - T_HERO) / 0.016, 2));   // real white-out on the frame that lands on the hit (6.0); neighbours at 5.967/6.033 get only ~3 %. A longer tail would just gray-veil the dark sky
    ctx.post.streak = (0.10 + 0.14 * build) * (1 - 0.7 * seg(t, 6.6, 7.4, ease.inOutSine)) + 0.8 * hit + 0.25 * wake;   // the rays of the hit come from the anamorphic streak, not from overlay lines
    ctx.post.streakColor = [1.0, 0.72, 0.42]; if (t < 5.6) ctx.post.streakColor = [0.45, 0.7, 1.0];
    ctx.post.ca = (0.0012 + 0.0025 * build) * (1 - 0.5 * seg(t, 6.3, 7.0, ease.linear)) + 0.003 * hit; ctx.post.vignette = 0.55 + 0.1 * build;
    ctx.post.exposure = 1.0 + 0.1 * hit + 0.14 * heroGlow; ctx.post.bloomThreshold = 0.85;
    ctx.post.contrast = 1.08; ctx.post.bloomScatter = 0.74 - 0.2 * build - 0.12 * hit;   // lower scatter = tighter glow: the hit stays a bright core with rays, not a veil

    // ---------------------------------------------------------------- overlay
    const vTitle = kit.chapterTitle(ui, t, { at: 2.75, hold: 1.2, zh: '时空', en: 'Spacetime', kicker: 'CHAPTER 06', sub: '质量，让时空弯曲', x: 170, y: 215, size: 170 });
    // captions: same look as kit.caption but the English line is 32 px and brighter (kit's 0.46 ratio gives an illegible 19-21 px)
    let scrim = 0;
    const cap = (key, at, dur, zh, en) => {
      const v = pulse(t, at, at + dur, 0.55, 0.55); if (v <= 0.001) return 0;
      scrim = Math.max(scrim, v);
      ui.text(key + 'z', zh, { x: 960, y: 925, anchor: 'bc', size: 46, weight: 600, color: '#f4f8ff', glow: 14, opacity: v, reveal: seg(t, at, at + 0.9, ease.linear), spread: 0.7, track: 0.12 });
      ui.text(key + 'e', en, { x: 960, y: 934, anchor: 'tc', size: 32, weight: 700, font: 'en', italic: true, color: '#f2f8ff', glow: 10, opacity: v, track: 0.10, reveal: seg(t, at + 0.3, at + 1.1, ease.linear), revealMode: 'mask' });
      return v;
    };
    const vCap = cap('c1', 2.4, 3.4, '物质告诉时空如何弯曲；时空告诉物质如何运动。', 'Matter tells spacetime how to curve; spacetime tells matter how to move.');
    cap('c2', 7.2, 3.5, '引力，就是时空的几何。', 'Gravity is the geometry of spacetime.');
    // soft dark scrim behind the caption band (stacked translucent rects = gradient)
    if (scrim > 0.001) for (let i = 0; i < 6; i++) ui.rect('scr' + i, 0, 1080 - (100 + 42 * i), 1920, 100 + 42 * i, { fill: '#02030a', stroke: 'none', width: 0, opacity: 0.075 * scrim });
    const ro1m = pulse(t, 3.5, 5.6, 0.7, 0.6);
    // legibility masks: dim grid / trails / orbs under the title block and the caption band
    for (const m of [this.fMat, tr.mat, rb.mat, HR.mat, M_.mat]) m.uniforms.uMask.value.set(vTitle, vCap, ro1m);
    for (const m of [this.fMat, HR.mat, M_.mat]) m.uniforms.uRes.value.set(ctx.W, ctx.H);
    // funnel readout — genuinely computed: Flamm surface -> geom.frame K, probe 0 radius, measured apsidal precession
    const ro1 = pulse(t, 3.5, 5.6, 0.7, 0.6);
    if (ro1 > 0.002) {
      const h0 = hp[0], w = Math.sqrt(Math.max(h0.r - 1, 1e-4)), fr = frame(this.flammF, w, ((h0.ang % TAU) + TAU) % TAU, 1e-3, 1e-3);
      ui.rect('ro1bg', 1120, 108, 676, 158, { fill: '#02030a', stroke: '#5ee7ff', width: 1, opacity: 0.6 * ro1 });
      kit.readout(ui, 'ro1', [
        `<span style="color:#9be9ff">r<sub>s</sub> = 2GM/c² = 1.000</span>`,
        `probe &nbsp;r = ${h0.r.toFixed(2)} r<sub>s</sub>`,
        `K = ${sci(fr.K)} &nbsp;<span style="opacity:.6">(−r<sub>s</sub>/2r³ = ${sci(-1 / (2 * Math.pow(h0.r, 3)))})</span>`,
        `<span style="color:#ffc861">apsidal precession Δϖ = ${this.orbits[0].precession.toFixed(2)} rad/orbit</span>`,
      ], { x: 1780, y: 122, anchor: 'tr', size: 21, color: '#dff6ff', opacity: ro1 });
    }
    const ro2 = pulse(t, 7.9, 11.0, 0.8, 0.9);
    if (ro2 > 0.002) kit.readout(ui, 'ro2', [
      `<span style="color:#ffc861">b<sub>c</sub> = 3√3 GM/c² = ${(this.bcNum).toFixed(3)} r<sub>s</sub></span>`,
      `photon sphere &nbsp;r = 1.5 r<sub>s</sub>`,
      `α(10 r<sub>s</sub>) = ${this.alpha10.toFixed(3)} <span style="opacity:.85">· weak field 4GM/bc² = ${(2 / 10).toFixed(3)}</span>`,
    ], { x: 170, y: 830, anchor: 'bl', size: 21, color: '#dff6ff', opacity: ro2 });
    // formula: plain fade-in (no clipping mask -> no visible step edge in the text glow while the black hole is the focus)
    const vF = pulse(t, 6.75, 99, 1.1, 0.6);
    if (vF > 0.001) ui.tex('ef', String.raw`\begin{aligned}\textcolor{#5ee7ff}{G_{\mu\nu}} &= \textcolor{#5ee7ff}{R_{\mu\nu}-\tfrac12 R\,g_{\mu\nu}}\\ &= \textcolor{#ffc861}{8\pi G\,T_{\mu\nu}}\end{aligned}`, { x: 170, y: 230, size: 58, anchor: 'tl', color: '#f4f8ff', glow: 7, display: true, opacity: vF });
  },

  beats: [
    { t: 0.0, kind: 'swell', label: 'the sheet ignites' }, { t: 1.9, kind: 'tick', label: 'probes launch' }, { t: 2.4, kind: 'sparkle', label: 'caption' },
    { t: 3.6, kind: 'whoosh', label: 'photons cross the well' }, { t: 5.0, kind: 'swell', label: 'dive begins' }, { t: 5.6, kind: 'whoosh', label: 'star collapses' },
    { t: 6.0, kind: 'hit', label: 'black hole + Einstein ring' }, { t: 7.2, kind: 'sparkle', label: 'gravity is geometry' },
  ],
};
