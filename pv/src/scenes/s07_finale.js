// s07_finale — 终章 · Finale (70–84 s).  hero 3.0 · end 12.5 · no chrome
// 0–3   after the white flash: a montage burst. Seven motifs of the film (knot, torus, helicoid, geodesic fan, geodesic triangle,
//       Flamm funnel, sphere) — every one built from real geometry — flash by for ~0.4 s each while ~130 comets spiral into one point:
//       the very ignition point of chapter 1.
// 3.0   HERO: the point detonates. Shock rings, a star-burst, ~2000 sparks, and a glowing glass KLEIN BOTTLE (figure-8 immersion) is
//       revealed by an expanding shell. Curvature-coloured (gold K>0 / cyan K<0), light pulses race along its iso-lines, geodesics
//       (integrated with geom.geodesic) fan out over it, particles stream over the surface. Readout: ∬K dA = 2πχ = 0, computed numerically.
// 4.5+  the title 「微分几何」 stands under the object, then the tagline; the object recedes and dims; final still ≈ 12.5.
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, smoothstep, palette, orbitCamera, rng, TAU, GLSL, curvatureColor } from '../util.js';
import { frame, geodesic, surfaces, uvVelocity } from '../geom.js';
import * as kit from '../kit.js';
import { buildMotifs } from './s07_finale_motifs.js';

const HERO = 3.0;
const REND = 17.6;                             // camera distance once the object has receded
const KLEIN = surfaces.klein(2);
const KSCALE = 1 / 2.0;                       // K normalisation (5–95 % of |K| is about 0–2.3)
const NG = 15;                                 // geodesics on the Klein bottle
const GSTEPS = 560, GDS = 0.03;
const GU0 = 1.15, GV0 = 2.05;                  // geodesic fan origin (u,v)
const NSTREAK = 170, NTAIL = 84;
const MOTIF_L = 1.3;

const fmtS = (v, d = 3) => { if (Math.abs(v) < 0.5 * Math.pow(10, -d)) v = 0; return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d); };
const lin = (hex, m = 1) => { const c = new THREE.Color(hex); return [c.r * m, c.g * m, c.b * m]; };

// --------------------------------------------------------------------------------------------------------------------------------- shaders
const FLARE_VS = 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }';
const FLARE_FS = /* glsl */ `
  varying vec2 vP;
  uniform float uScale,uCore,uHalo,uHP,uCoreI,uHaloI,uRing,uRingW,uRingI,uRays,uRayLen,uSeed; uniform vec3 uHot,uCol;
  void main(){
    float rn = length(vP), r = rn*uScale;
    float core = exp(-pow(r/uCore,2.0))*uCoreI;
    float halo = uHaloI/pow(1.0+pow(r/uHalo,2.0), uHP);
    float ring = uRingI*exp(-pow((r-uRing)/uRingW,2.0));
    float ang = atan(vP.y,vP.x);
    float rays = uRays*(pow(abs(cos(ang*5.0+uSeed)),70.0) + 0.7*pow(abs(cos(ang*9.0+2.0*uSeed)),110.0) + 0.5*pow(abs(cos(ang*14.0+3.0*uSeed)),180.0)) / (1.0+pow(r/uRayLen,1.4));
    vec3 c = uHot*(core+rays*0.9) + uCol*(halo+rays*0.45) + mix(uCol,uHot,0.45)*ring;
    gl_FragColor = vec4(c*smoothstep(1.0,0.72,rn), 1.0);
  }`;
function makeFlare(scale = 40) {
  const U = (v) => ({ value: v });
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: U(scale), uCore: U(0.05), uHalo: U(0.3), uHP: U(1), uCoreI: U(0), uHaloI: U(0), uRing: U(0), uRingW: U(0.2), uRingI: U(0), uRays: U(0), uRayLen: U(1), uSeed: U(0), uHot: U(new THREE.Color(1, 0.96, 0.9)), uCol: U(new THREE.Color(palette.cyan)) },
    vertexShader: FLARE_VS, fragmentShader: FLARE_FS,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); mesh.renderOrder = 6; mesh.frustumCulled = false; mesh.u = m.uniforms; return mesh;
}

const STREAK_VS = /* glsl */ `
  attribute vec4 aP; attribute vec3 aT; attribute float aS; uniform float uT,uPx,uAmp; varying vec3 vC; varying float vA;
  void main(){
    float start = aT.x, arrive = aT.y, tail = aT.z;
    float tau = uT - tail*0.30;
    float q = clamp((tau-start)/(arrive-start), 0.0, 1.0);
    float alive = step(start,tau)*step(tau,arrive);
    float e = 1.0 - q*0.985;
    float r = aP.y*pow(e,1.45);
    float th = aP.x + 1.5*(-log(max(e,0.02))) + 0.9*q;
    vec3 p = vec3(r*cos(th), r*sin(th)*0.88, aP.z*(1.0-q));
    vC = color;
    vA = alive*pow(1.0-tail,1.5)*(0.22+1.1*q*q)*uAmp;
    vec4 mv = modelViewMatrix*vec4(p,1.0);
    gl_PointSize = aS*uPx*(1.0-0.6*tail)*(0.8+1.5*q);
    gl_Position = projectionMatrix*mv;
  }`;
const GLOW_FS = /* glsl */ `
  varying vec3 vC; varying float vA;
  void main(){ vec2 p = gl_PointCoord-0.5; float d = length(p)*2.0; if(d>1.0) discard; float a = exp(-d*d*4.2); gl_FragColor = vec4(vC*a*vA, a*vA); }`;

const SURF_PTS_VS = /* glsl */ `
  attribute float aS; attribute float aPh; uniform float uT,uPx,uAmp,uRad; varying vec3 vC; varying float vA;
  void main(){ vC = color; float rr = length(position); vA = step(rr,uRad)*(0.55+0.45*sin(uT*2.6+aPh*6.2832))*uAmp;
    vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aS*uPx; gl_Position = projectionMatrix*mv; }`;

const BURST_VS = /* glsl */ `
  attribute float aV; attribute float aS; attribute float aPh; uniform float uT,uPx,uAmp; varying vec3 vC; varying float vA;
  void main(){
    float tau = uT - ${HERO.toFixed(2)};
    float on = step(0.0,tau); tau = max(tau,0.0);
    float k = 1.5;
    float d = aV*(1.0-exp(-k*tau))/k;
    vec3 dir = position;
    float sw = 0.16*tau*(0.4+aPh);
    float cs = cos(sw), sn = sin(sw);
    dir = vec3(dir.x*cs - dir.z*sn, dir.y, dir.x*sn + dir.z*cs);
    vec3 p = dir*d;
    vec3 hot = vec3(1.0,0.95,0.85);
    vC = mix(hot*2.0, color, smoothstep(0.0,0.9,tau));
    vA = on*exp(-0.62*tau)*smoothstep(0.0,0.04,tau)*uAmp*(0.55+0.45*sin(tau*9.0+aPh*40.0));
    vec4 mv = modelViewMatrix*vec4(p,1.0);
    gl_PointSize = aS*uPx*(1.0+2.5*exp(-2.6*tau));
    gl_Position = projectionMatrix*mv;
  }`;

const HALO_VS = /* glsl */ `
  attribute vec4 aP; attribute float aS; uniform float uT,uPx,uAmp,uFront; varying vec3 vC; varying float vA;
  void main(){
    float r = aP.x, w = 0.55/pow(r,1.5);
    float a = aP.y + uT*w;
    vec3 p = vec3(r*cos(a), aP.z + 0.10*sin(uT*0.7+aP.y*5.0), r*sin(a));
    vC = color;
    vA = smoothstep(uFront, uFront-1.6, r)*uAmp*(0.5+0.5*sin(uT*1.9+aP.w*6.2832));
    vec4 mv = modelViewMatrix*vec4(p,1.0);
    gl_PointSize = aS*uPx*(1.0+0.6*sin(uT*2.3+aP.w*9.0));
    gl_Position = projectionMatrix*mv;
  }`;

const SCRIM_FS = /* glsl */ `
  uniform float uS,uRO; uniform vec2 uRes; void main(){
    vec2 uv = gl_FragCoord.xy/uRes; float y = 1.0-uv.y;
    float e1 = pow(abs((uv.x-0.5)/0.36),3.0) + pow(abs((y-0.62)/0.19),2.6);
    float e2 = pow(abs((uv.x-0.5)/0.34),3.0) + pow(abs((y-0.875)/0.08),2.6);
    float e3 = pow(abs((uv.x-0.20)/0.17),2.6) + pow(abs((y-0.215)/0.15),2.6);
    float a = uS*(0.62*exp(-e1) + 0.55*exp(-e2)) + uRO*0.70*exp(-e3);
    gl_FragColor = vec4(0.0,0.0,0.02, a);
  }`;

// The glass Klein bottle. Premultiplied output: body alpha + additive glow terms (lines, rim, edge) that ignore the alpha.
function kleinMaterial(side, uniforms) {
  return new THREE.ShaderMaterial({
    side, transparent: true, depthWrite: false, uniforms,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `attribute float aK; varying vec3 vN,vV,vP; varying vec2 vUv; varying float vK;
      void main(){ vUv = uv; vK = aK; vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN,vV,vP; varying vec2 vUv; varying float vK;
      uniform float uT,uRad,uRadMax,uKScale,uAlpha,uDim,uLineI,uGridW,uBack; uniform vec2 uGrid;
      ${GLSL.curvatureColor}
      void main(){
        float rr = length(vP);
        float e = uRad - rr + 0.03*sin(vP.x*2.7+vP.z*3.1+vP.y*1.3)*sin(vP.y*4.0+1.3);
        if(e < 0.0) discard;
        vec3 n = normalize(vN); if(!gl_FrontFacing) n = -n;
        vec3 v = normalize(vV);
        float kn = clamp(sign(vK)*pow(abs(vK)*uKScale,0.66), -1.0, 1.0);
        vec3 base = curvatureColor(kn)*1.15 + vec3(0.014,0.010,0.060);
        vec3 L1 = normalize(vec3(0.45,0.80,0.55)), L2 = normalize(vec3(-0.75,0.15,0.45)), L3 = normalize(vec3(0.0,-0.6,-0.8));
        float d1 = max(dot(n,L1),0.0), d2 = max(dot(n,L2),0.0), d3 = max(dot(n,L3),0.0);
        float fr = pow(1.0-clamp(dot(n,v),0.0,1.0), 2.3);
        vec3 body = base*(0.38+1.45*d1) + base*vec3(0.5,0.62,1.0)*d2*0.45 + vec3(0.18,0.30,0.9)*d3*0.06;
        vec3 h = normalize(L1+v); body += vec3(1.0,0.95,0.9)*pow(max(dot(n,h),0.0),56.0)*0.55;
        vec3 rim = mix(vec3(0.05,0.55,1.0), vec3(0.62,0.28,1.0), 0.5+0.5*n.x)*fr*0.55;
        vec2 gp = vUv*uGrid; vec2 gd = abs(fract(gp-0.5)-0.5)/max(fwidth(gp),vec2(1e-4));
        float lu = 1.0-min(gd.x/uGridW,1.0), lv = 1.0-min(gd.y/uGridW,1.0);
        float pu = pow(0.5+0.5*sin(6.2832*(vUv.y*2.0-uT*0.30)+1.7*floor(gp.x+0.5)),9.0);
        float pv = pow(0.5+0.5*sin(6.2832*(vUv.x*3.0+uT*0.24)+2.3*floor(gp.y+0.5)),9.0);
        vec3 lc = mix(vec3(0.60,0.90,1.0), base*3.4+0.15, 0.80);
        vec3 glowL = lc*(lu*lu*(0.30+3.2*pu) + lv*lv*(0.26+3.0*pv))*uLineI*(0.40+0.6*fr+0.25*d1);
        float lk = kn*5.0; float ld = abs(fract(lk-0.5)-0.5)/max(fwidth(lk),1e-4); float lcn = 1.0-min(ld/1.1,1.0);
        vec3 kc = vec3(1.0,0.90,0.72)*lcn*lcn*0.30*(0.4+fr);
        float alpha = clamp(uAlpha*(0.50+0.45*fr+0.30*d1), 0.0, 0.95);
        float front = step(uRad, uRadMax);
        vec3 edge = vec3(0.65,0.92,1.0)*smoothstep(0.28,0.0,e)*front*1.3;
        vec3 col = body*alpha + (rim*0.85 + glowL + kc)*(1.0-0.35*uBack) + edge;
        gl_FragColor = vec4(col*uDim, alpha*uDim);
      }`,
  });
}

// ------------------------------------------------------------------------------------------------------------------------------- module
export default {
  init(ctx) {
    ctx.background(palette.void);
    const R = ctx.rng;
    // ---------------------------------------------------------------------------------------------------- atmosphere
    this.bd = kit.backdrop(ctx, { seed: 11, a: 0x0a1446, b: 0x3a1268, c: 0x0b4d78, intensity: 0.5, scale: 1.8 }); ctx.scene.add(this.bd);
    this.stars = kit.starfield(ctx, { count: 2600, radius: 90, seed: 21, size: 1.5, intensity: 1.0 }); ctx.scene.add(this.stars);

    // ---------------------------------------------------------------------------------------------------- ignition point + shock rings
    this.flare = makeFlare(); this.flare.u.uSeed.value = 0.7; ctx.scene.add(this.flare);
    this.beatRing = makeFlare(); this.beatRing.u.uCol.value.set(palette.blue); ctx.scene.add(this.beatRing);
    this.ring1 = makeFlare(); this.ring1.u.uCol.value.set(palette.cyan); ctx.scene.add(this.ring1);
    this.ring2 = makeFlare(); this.ring2.u.uCol.value.set(palette.magenta); this.ring2.u.uHot.value.set(1, 0.7, 0.95); ctx.scene.add(this.ring2);
    this.ring3 = makeFlare(); this.ring3.u.uCol.value.set(palette.gold); this.ring3.u.uHot.value.set(1, 0.9, 0.6); ctx.scene.add(this.ring3);

    // ---------------------------------------------------------------------------------------------------- spiral comets (analytic in the vertex shader)
    {
      const N = NSTREAK * NTAIL, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), aP = new Float32Array(N * 4), aT = new Float32Array(N * 3), aS = new Float32Array(N);
      const r = R(4242), tints = [palette.cyan, palette.blue, palette.violet, palette.magenta, palette.gold, palette.ice, palette.cyan, palette.white];
      for (let i = 0; i < NSTREAK; i++) {
        const arrive = HERO - 2.6 * Math.pow(r(), 1.7) + 0.02, dur = 1.3 + 1.2 * r(), start = arrive - dur;
        const th0 = r() * TAU, r0 = 5.2 + 8.5 * Math.pow(r(), 0.8), z0 = -5 + 9 * r();
        const tint = lin(tints[Math.floor(r() * tints.length)], 1.5), sz = 5.0 + 7.0 * Math.pow(r(), 2.0);
        for (let j = 0; j < NTAIL; j++) {
          const k = i * NTAIL + j, tl = j / (NTAIL - 1);
          aP.set([th0, r0, z0, 0], k * 4); aT.set([start, arrive, tl], k * 3); aS[k] = sz;
          const w = Math.min(1, tl * 2.2), hot = lin(0xfff2dd, 2.0);
          col.set([hot[0] + (tint[0] - hot[0]) * w, hot[1] + (tint[1] - hot[1]) * w, hot[2] + (tint[2] - hot[2]) * w], k * 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aP', new THREE.BufferAttribute(aP, 4)); g.setAttribute('aT', new THREE.BufferAttribute(aT, 3)); g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, vertexColors: true,
        uniforms: { uT: { value: 0 }, uPx: { value: ctx.px }, uAmp: { value: 1 } }, vertexShader: STREAK_VS, fragmentShader: GLOW_FS });
      this.streaks = new THREE.Points(g, m); this.streaks.frustumCulled = false; this.streaks.renderOrder = 4; ctx.scene.add(this.streaks);
    }

    // ---------------------------------------------------------------------------------------------------- montage motifs
    this.motifs = buildMotifs().map((m, i) => {
      const grp = new THREE.Group();
      const core = ctx.fatSegments(m.pos, { colors: m.col, color: 0xffffff, width: 3.2, intensity: 1.0, depthTest: false });
      const halo = ctx.fatSegments(m.pos, { colors: m.col, color: 0xffffff, width: 13, intensity: 0.13, depthTest: false });
      core.renderOrder = 3; halo.renderOrder = 2;
      grp.add(halo, core); ctx.scene.add(grp); grp.visible = false;
      return { id: m.id, n: m.n, grp, core, halo, a: -0.5 + i * 0.36, phi: 0.4 + i * 2.39996, R0: 2.4 + 0.3 * ((i * 5) % 3), sc: [1.9, 1.9, 2.3, 1.75, 1.9, 2.4, 1.9][i], rx: 0.5 + 0.35 * i, ry: 0.25 * i, w: i % 2 ? -1 : 1, gain: [1, 0.85, 1, 0.5, 1, 1, 0.9][i] };
    });

    // ---------------------------------------------------------------------------------------------------- Klein bottle
    const S = KLEIN, dom = S.dom, f = S.f;
    const nu = 220, nv = 110;
    const geo = new THREE.BufferGeometry();
    {
      // parametric geometry with curvature attributes (aK is what the shader needs)
      const nvert = (nu + 1) * (nv + 1), P = new Float32Array(nvert * 3), Nn = new Float32Array(nvert * 3), UV = new Float32Array(nvert * 2), AK = new Float32Array(nvert);
      let k = 0;
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
        const u = dom.u0 + ((dom.u1 - dom.u0) * i) / nu, v = dom.v0 + ((dom.v1 - dom.v0) * j) / nv, fr = frame(f, u, v, 4e-4);
        P.set(fr.p, k * 3); Nn.set(fr.n, k * 3); UV[k * 2] = i / nu; UV[k * 2 + 1] = j / nv; AK[k] = isFinite(fr.K) ? fr.K : 0; k++;
      }
      const idx = new Uint32Array(nu * nv * 6); let t = 0;
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = (i + 1) * (nv + 1) + j, c = a + 1, d = b + 1; idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c; }
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); geo.setAttribute('aK', new THREE.BufferAttribute(AK, 1));
      geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
    }
    // numerical proof: Gauss–Bonnet for the Klein bottle (χ = 0)
    {
      const mu = 160, mv = 80, du = (dom.u1 - dom.u0) / mu, dv = (dom.v1 - dom.v0) / mv; let I = 0, A = 0, kmin = 1e9, kmax = -1e9;
      for (let i = 0; i < mu; i++) for (let j = 0; j < mv; j++) { const fr = frame(f, dom.u0 + (i + 0.5) * du, dom.v0 + (j + 0.5) * dv, 1e-3); const dA = Math.sqrt(fr.det) * du * dv; I += fr.K * dA; A += dA; kmin = Math.min(kmin, fr.K); kmax = Math.max(kmax, fr.K); }
      this.stat = { I, A, kmin, kmax };
    }
    const U = (v) => ({ value: v });
    const uni = { uT: U(0), uRad: U(0), uRadMax: U(4.6), uKScale: U(KSCALE), uAlpha: U(0.9), uDim: U(1), uLineI: U(0.55), uGridW: U(1.15), uBack: U(0), uGrid: U(new THREE.Vector2(56, 28)) };
    const uniB = { ...uni, uAlpha: U(0.62), uBack: U(1), uLineI: U(0.40) };
    this.uF = uni; this.uB = uniB;
    this.kg = new THREE.Group(); ctx.scene.add(this.kg); this.kg.visible = false;
    this.meshB = new THREE.Mesh(geo, kleinMaterial(THREE.BackSide, uniB)); this.meshB.renderOrder = 1; this.meshB.frustumCulled = false;
    this.meshF = new THREE.Mesh(geo, kleinMaterial(THREE.FrontSide, uni)); this.meshF.renderOrder = 2; this.meshF.frustumCulled = false;
    this.kg.add(this.meshB, this.meshF);

    // ---- geodesics on the Klein bottle (real: geom.geodesic, RK4 with numerical Christoffel symbols)
    {
      const fr0 = frame(f, GU0, GV0, 1e-3);
      this.geo = [];
      for (let k = 0; k < NG; k++) {
        const a = (TAU * k) / NG + 0.2;
        const d3 = [0, 1, 2].map((c) => Math.cos(a) * fr0.e1[c] + Math.sin(a) * fr0.e2[c]);
        const [du, dv] = uvVelocity(f, GU0, GV0, d3);
        const g = geodesic(f, GU0, GV0, du, dv, { steps: GSTEPS, ds: GDS });
        const cols = new Float32Array(g.pts.length * 3), Ks = new Float32Array(g.pts.length), K1 = new Float32Array(g.pts.length), K2 = new Float32Array(g.pts.length);
        const wt = lin(0xfff6e6, 2.2);
        for (let i = 0; i < g.pts.length; i++) {
          const fr = frame(f, g.uv[i][0], g.uv[i][1], 1e-3); Ks[i] = fr.K; K1[i] = fr.k1; K2[i] = fr.k2;
          const kn = clamp(Math.sign(fr.K) * Math.pow(Math.abs(fr.K) * KSCALE, 0.66), -1, 1), c = curvatureColor(kn, new THREE.Color());
          const m = 0.35;                                    // blend toward hot white: bright threads that still obey the K colour law
          cols[i * 3] = (c.r * 3.2 + 0.25) * (1 - m) + wt[0] * m; cols[i * 3 + 1] = (c.g * 3.2 + 0.25) * (1 - m) + wt[1] * m; cols[i * 3 + 2] = (c.b * 3.2 + 0.30) * (1 - m) + wt[2] * m;
        }
        const line = ctx.fatLine(g.pts, { colors: Array.from(cols), color: 0xffffff, width: k === 0 ? 3.2 : 1.7, intensity: 0.85 });
        const halo = ctx.fatLine(g.pts, { colors: Array.from(cols), color: 0xffffff, width: k === 0 ? 11 : 8, intensity: 0.13 });
        line.renderOrder = 3; halo.renderOrder = 3;
        this.kg.add(halo, line);
        this.geo.push({ line, halo, n: g.pts.length - 1, pts: g.pts, Ks, K1, K2, s: g.s });
      }
    }
    // marker riding geodesic 0
    {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([2.6, 2.4, 2.0]), 3));
      g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array([46]), 1)); g.setAttribute('aPh', new THREE.BufferAttribute(new Float32Array([0]), 1));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, vertexColors: true,
        uniforms: { uT: U(0), uPx: U(ctx.px), uAmp: U(1), uRad: U(99) }, vertexShader: SURF_PTS_VS, fragmentShader: GLOW_FS });
      this.marker = new THREE.Points(g, m); this.marker.frustumCulled = false; this.marker.renderOrder = 7; this.kg.add(this.marker);
    }
    // particles that stream over the surface (positions rebuilt every frame from f(u+ωt, v): pure function of t)
    {
      const N = 2600, r = R(777), pos = new Float32Array(N * 3), col = new Float32Array(N * 3), aS = new Float32Array(N), aPh = new Float32Array(N);
      this.fl = { N, u0: new Float32Array(N), v0: new Float32Array(N), w: new Float32Array(N), dv: new Float32Array(N) };
      const pal = [lin(palette.gold, 1.5), lin(palette.cyan, 1.5), lin(palette.white, 1.8), lin(palette.ice, 1.3), lin(palette.violet, 1.5)];
      for (let i = 0; i < N; i++) {
        this.fl.u0[i] = r() * TAU; this.fl.v0[i] = r() * TAU; this.fl.w[i] = (0.25 + 0.55 * r()) * (r() < 0.75 ? 1 : -0.6); this.fl.dv[i] = (r() - 0.5) * 0.10;
        col.set(pal[Math.floor(r() * pal.length)], i * 3); aS[i] = 1.7 + 3.8 * Math.pow(r(), 3.0); aPh[i] = r();
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aS', new THREE.BufferAttribute(aS, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(aPh, 1));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
        uniforms: { uT: U(0), uPx: U(ctx.px), uAmp: U(1), uRad: U(0) }, vertexShader: SURF_PTS_VS, fragmentShader: GLOW_FS });
      this.flow = new THREE.Points(g, m); this.flow.frustumCulled = false; this.flow.renderOrder = 4; this.kg.add(this.flow);
    }

    // ---------------------------------------------------------------------------------------------------- detonation sparks + orbiting halo dust
    {
      const N = 2200, r = R(9001), pos = new Float32Array(N * 3), col = new Float32Array(N * 3), aV = new Float32Array(N), aS = new Float32Array(N), aPh = new Float32Array(N);
      const pal = [lin(palette.gold, 1.6), lin(palette.cyan, 1.6), lin(palette.white, 1.8), lin(palette.magenta, 1.4), lin(palette.violet, 1.6), lin(palette.ice, 1.6)];
      for (let i = 0; i < N; i++) {
        const uu = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - uu * uu); pos.set([s * Math.cos(a), uu * 0.85, s * Math.sin(a)], i * 3);
        aV[i] = 2.0 + 15 * Math.pow(r(), 1.6); aS[i] = 1.8 + 4.5 * Math.pow(r(), 3.0); aPh[i] = r(); col.set(pal[Math.floor(r() * pal.length)], i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aV', new THREE.BufferAttribute(aV, 1)); g.setAttribute('aS', new THREE.BufferAttribute(aS, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(aPh, 1));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
        uniforms: { uT: U(0), uPx: U(ctx.px), uAmp: U(1) }, vertexShader: BURST_VS, fragmentShader: GLOW_FS });
      this.burst = new THREE.Points(g, m); this.burst.frustumCulled = false; this.burst.renderOrder = 5; ctx.scene.add(this.burst);
    }
    {
      const N = 2600, r = R(31337), pos = new Float32Array(N * 3), col = new Float32Array(N * 3), aP = new Float32Array(N * 4), aS = new Float32Array(N);
      const pal = [lin(palette.violet, 1.1), lin(palette.blue, 1.3), lin(palette.cyan, 1.2), lin(palette.magenta, 0.9), lin(palette.gold, 1.0), lin(palette.ice, 1.3)];
      for (let i = 0; i < N; i++) {
        const rad = 4.3 + 8.0 * Math.pow(r(), 1.25);
        aP.set([rad, r() * TAU, (r() - 0.5) * (0.5 + 0.10 * rad) * (r() < 0.8 ? 1 : 3), r()], i * 4); aS[i] = (i % 40 === 0 ? 12 + 8 * r() : 2.4 + 4.0 * Math.pow(r(), 3.0)); col.set(pal[Math.floor(r() * pal.length)].map((x) => x * (i % 40 === 0 ? 0.35 : 1.7)), i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aP', new THREE.BufferAttribute(aP, 4)); g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
        uniforms: { uT: U(0), uPx: U(ctx.px), uAmp: U(0.9), uFront: U(0) }, vertexShader: HALO_VS, fragmentShader: GLOW_FS });
      this.dust = new THREE.Points(g, m); this.dust.frustumCulled = false; this.dust.renderOrder = 4; ctx.scene.add(this.dust);
    }

    // ---------------------------------------------------------------------------------------------------- orbiting comet arcs (an armillary of light around the object)
    this.orbits = [[5.1, 0.35, 0.20, 0.55, 2.6, palette.cyan], [6.1, -0.55, 0.45, -0.42, 2.1, palette.gold], [6.7, 0.15, -0.65, 0.30, 1.7, palette.magenta]].map(([rad, rx, rz, w, arc, hex], i) => {
      const N = 110, pts = [], cols = [], ring = [], head = lin(0xfff4e0, 2.6), tint = lin(hex, 1.9);
      for (let k = 0; k <= N; k++) {
        const a = -arc * (1 - k / N), fade = Math.pow(k / N, 2.2);
        pts.push([rad * Math.cos(a), 0, rad * Math.sin(a)]);
        const m = Math.pow(k / N, 6);
        cols.push(tint[0] * fade * (1 - m) + head[0] * m * fade, tint[1] * fade * (1 - m) + head[1] * m * fade, tint[2] * fade * (1 - m) + head[2] * m * fade);
      }
      for (let k = 0; k <= 160; k++) { const a = (TAU * k) / 160; ring.push([rad * Math.cos(a), 0, rad * Math.sin(a)]); }
      const tilt = new THREE.Group(), spin = new THREE.Group();
      const comet = ctx.fatLine(pts, { colors: cols, color: 0xffffff, width: 3.0, intensity: 1.0, depthTest: false });
      const cometHalo = ctx.fatLine(pts, { colors: cols, color: 0xffffff, width: 10, intensity: 0.16, depthTest: false });
      const faint = ctx.fatLine(ring, { color: hex, width: 1.2, intensity: 0.22, depthTest: false });
      comet.renderOrder = cometHalo.renderOrder = faint.renderOrder = 4;
      spin.add(comet, cometHalo); tilt.add(spin, faint); tilt.rotation.set(rx, 0, rz); tilt.visible = false; ctx.scene.add(tilt);
      return { tilt, spin, comet, cometHalo, faint, w, ph: i * 2.1 };
    });

    // ---------------------------------------------------------------------------------------------------- scrim (dims the picture behind the title / tagline)
    this.scrim = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, uniforms: { uS: { value: 0 }, uRO: { value: 0 }, uRes: { value: new THREE.Vector2(ctx.W, ctx.H) } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: SCRIM_FS,
    }));
    this.scrim.renderOrder = 100; this.scrim.frustumCulled = false; ctx.scene.add(this.scrim);
    this.tmpV = new THREE.Vector3();
  },

  update(t, ctx) {
    const cam = ctx.camera, post = ctx.post, ui = ctx.ui, tt = t - HERO;
    const eL = (x, a, b) => seg(x, a, b, ease.linear);

    // ============================================================================================ camera
    const rollA = TAU * seg(t, -0.4, 5.8, ease.inOutCubic);
    let r = lerp(15.5, 11.0, ease.inOutCubic(clamp(t / HERO)));
    r = t < HERO ? r : (t < 3.4 ? lerp(11.0, 9.2, ease.outCubic((t - HERO) / 0.4)) : (t < 5.6 ? lerp(9.2, REND, ease.inOutCubic((t - 3.4) / 2.2)) : lerp(REND, REND + 1.4, eL(t, 5.6, 14.5))));
    const el = lerp(0.07, 0.62, seg(t, 1.6, 4.6, ease.inOutCubic)) + 0.035 * Math.sin(t * 0.33);
    const az = 0.25 + 0.085 * t + 0.10 * Math.sin(t * 0.21);
    const k0 = seg(t, 2.6, 3.7, ease.inOutCubic);
    orbitCamera(cam, { target: [0, 0, 0], r, az: az * (0.25 + 0.75 * k0), el: el * (0.4 + 0.6 * k0) });
    // one full turn about the view axis, accelerating into the hero and settling by ~5.8 s
    cam.rotateZ(-rollA);
    cam.updateMatrixWorld();
    // view offset is set on every frame (never toggled). x: object glides right while the readout is up; y: object lifts to make room for the title
    const yOff = seg(t, 3.6, 5.0, ease.inOutCubic) * 0.245 * 1080;
    const xOff = 300 * seg(t, 3.15, 3.9, ease.inOutCubic) * (1 - seg(t, 4.5, 5.4, ease.inOutCubic));
    cam.setViewOffset(ctx.W, ctx.H, -xOff * ctx.px, yOff * ctx.px, ctx.W, ctx.H);

    // ============================================================================================ time-driven uniforms
    kit.updateStars(this.stars, t, ctx.px);
    this.bd.rotation.y = 0.02 * t; this.bd.rotation.x = 0.01 * t;
    const heroPulse = t < HERO ? 0 : Math.exp(-tt * 2.2);
    this.bd.material.color.setScalar(1.0 + 0.5 * (t < HERO ? seg(t, 0, HERO, ease.inCubic) : 0) + 0.25 * heroPulse * (t >= HERO ? 1 : 0));
    this.stars.material.uniforms.uI.value = 1.0 + 1.2 * heroPulse;
    this.streaks.material.uniforms.uT.value = t; this.streaks.material.uniforms.uPx.value = ctx.px;
    this.streaks.material.uniforms.uAmp.value = (0.40 + 0.35 * seg(t, 1.6, 2.9, ease.inOutQuad)) * pulse(t, -1, HERO + 0.1, 0.1, 0.1) + 0.001;
    this.burst.material.uniforms.uT.value = t; this.burst.material.uniforms.uPx.value = ctx.px;
    this.burst.material.uniforms.uAmp.value = 1.0;
    this.dust.material.uniforms.uT.value = t; this.dust.material.uniforms.uPx.value = ctx.px;
    this.dust.material.uniforms.uFront.value = t < HERO ? 0 : 16 * ease.outQuart(clamp(tt / 1.8));
    this.dust.material.uniforms.uAmp.value = 0.9 * (1 - 0.55 * seg(t, 9.5, 12.5));

    // ============================================================================================ ignition point / rings (billboards at the origin)
    for (const m of [this.flare, this.beatRing, this.ring1, this.ring2, this.ring3]) m.quaternion.copy(cam.quaternion);
    {
      const F = this.flare.u, g = seg(t, 0.0, 2.85, ease.inQuad);
      const collapse = seg(t, 2.72, HERO, ease.inCubic);                  // the point contracts, then goes off
      const ig = seg(t, 1.8, 2.9, ease.inOutQuad);   // ignition core keeps growing through the gap after the last motif
      let core = 0.035 + 0.05 * g + 0.03 * ig, halo = 0.18 + 2.0 * Math.pow(g, 1.4) + 1.2 * ig, coreI = 14 + 40 * g * g + 40 * ig, haloI = 0.7 + 3.4 * g + 1.6 * ig, rays = 0.3 + 0.8 * g + 1.0 * ig;
      halo *= 1 - 0.75 * collapse; coreI *= 1 + 5 * collapse; core *= 1 - 0.3 * collapse;
      if (t >= HERO) {
        const x = clamp(tt / 1.4);
        core = 0.10 + 0.5 * ease.outExpo(x); coreI = 16 * Math.exp(-tt * 5.5) + 1.4 * (1 - seg(t, 3.0, 6.0)) + 0.35;
        halo = 0.7 + 3.3 * ease.outExpo(clamp(tt / 1.2)); haloI = 2.0 * Math.exp(-tt * 3.6) + 0.4 * (1 - seg(t, 3.0, 7.0));
        rays = 4.0 * Math.exp(-tt * 3.0) + 0.05;
      }
      F.uHP.value = t >= HERO ? 1.7 : 1.0; F.uCore.value = core; F.uHalo.value = halo; F.uCoreI.value = coreI; F.uHaloI.value = haloI; F.uRays.value = rays; F.uRayLen.value = 1.4 + 6 * (t >= HERO ? ease.outExpo(clamp(tt / 1.0)) : 0);
      F.uSeed.value = 0.7 + 0.4 * t;
      // a soft beat ring every 0.5 s while the energy builds
      const B = this.beatRing.u, ph = (t / 0.5) % 1, en = pulse(t, 0.2, 2.75, 0.3, 0.05);
      B.uRing.value = 0.15 + 3.4 * ease.outCubic(ph); B.uRingW.value = 0.05 + 0.18 * ph; B.uRingI.value = 1.3 * en * Math.pow(1 - ph, 1.6) * (0.5 + g);
      const showR = t >= HERO;
      const x1 = clamp(tt / 1.5), x2 = clamp((tt - 0.10) / 2.2), x3 = clamp((tt - 0.28) / 2.8);
      const R1 = this.ring1.u, R2 = this.ring2.u, R3 = this.ring3.u;
      R1.uRing.value = 10.5 * ease.outCubic(x1); R1.uRingW.value = 0.10 + 0.55 * x1; R1.uRingI.value = showR ? 4.0 * Math.pow(1 - x1, 1.8) : 0;
      R2.uRing.value = 8.5 * ease.outCubic(x2); R2.uRingW.value = 0.14 + 0.7 * x2; R2.uRingI.value = showR ? 2.8 * Math.pow(1 - x2, 1.6) : 0;
      R3.uRing.value = 6.0 * ease.outCubic(x3); R3.uRingW.value = 0.10 + 0.5 * x3; R3.uRingI.value = showR ? 1.4 * Math.pow(1 - x3, 1.5) : 0;
    }

    // ============================================================================================ montage motifs
    for (let i = 0; i < this.motifs.length; i++) {
      const m = this.motifs[i], q = (t - m.a) / MOTIF_L;
      if (q <= 0 || q >= 1) { m.grp.visible = false; continue; }
      m.grp.visible = true;
      const e = 1 - Math.pow(q, 1.6), rho = m.R0 * Math.pow(e, 1.7), phi = m.phi + 2.4 * q + 1.4 * q * q;
      m.grp.position.set(rho * Math.cos(phi), rho * Math.sin(phi) * 0.75, 1.4 * e * (i % 2 ? -1 : 1));
      m.grp.scale.setScalar(m.sc * (0.16 + 0.84 * Math.pow(e, 1.05)));
      m.grp.rotation.set(m.rx + m.w * 1.7 * q, m.ry + m.w * 2.8 * q, 0.35 * m.w * q);
      const al = smoothstep(0, 0.10, q) * (1 - smoothstep(0.50, 0.95, q)), n = Math.max(1, Math.floor(ease.outCubic(clamp(q / 0.38)) * m.n));
      m.core.geometry.instanceCount = n; m.halo.geometry.instanceCount = n;
      const dens = 0.35 + 0.65 * smoothstep(0.0, 0.7, e); const gn = m.gain; m.core.material.opacity = al * dens * gn; m.halo.material.opacity = 0.7 * al * dens * dens * gn;
    }

    // ============================================================================================ the Klein bottle
    const on = t >= HERO;
    this.kg.visible = on;
    if (on) {
      const radv = 4.7 * (0.8 / 4.7 + (1 - 0.8 / 4.7) * ease.outCubic(clamp(tt / 1.8)));
      const dim = lerp(1, 0.48, seg(t, 9.4, 12.8, ease.inOutCubic));
      for (const u of [this.uF, this.uB]) { u.uT.value = t; u.uRad.value = radv; u.uDim.value = dim * (0.75 + 0.25 * seg(t, 3.0, 3.6)); u.uRadMax.value = 4.6; }
      this.uF.uLineI.value = 0.55 + 0.3 * heroPulse; this.uB.uLineI.value = 0.40 + 0.2 * heroPulse;
      const sc = (0.62 + 0.38 * ease.outBack(clamp(tt / 1.5))) * lerp(1, 0.88, seg(t, 9.4, 13.2, ease.inOutCubic));
      this.kg.scale.setScalar(sc);
      this.kg.rotation.set(0.20 + 0.05 * Math.sin(t * 0.3), 0.30 + 0.20 * tt - 0.45 * (1 - ease.outCubic(clamp(tt / 3.0))), 0.10 * Math.sin(t * 0.23));
      // geodesic fan grows out of the origin point of the fan
      for (let k = 0; k < NG; k++) {
        const G = this.geo[k], grow = k === 0 ? seg(t, 3.55, 12.2, ease.linear) * 0.70 + seg(t, 3.55, 5.0, ease.outCubic) * 0.05 : seg(t, 3.75 + 0.015 * k, 6.6 + 0.05 * k, ease.outCubic) * 0.30;
        const n = Math.max(1, Math.floor(grow * G.n)); G.line.geometry.instanceCount = n; G.halo.geometry.instanceCount = n;
        const fo = (k === 0 ? 1 : 0.8 - 0.5 * seg(t, 8.5, 12.5)) * (1 - 0.3 * seg(t, 9.5, 12.5)); G.line.material.opacity = fo * seg(t, 3.5, 3.9); G.halo.material.opacity = fo * seg(t, 3.5, 3.9);
        G.line.visible = G.halo.visible = t >= 3.5;
      }
      // marker + real numbers at its position
      const G0 = this.geo[0], gi = Math.max(1, Math.min(G0.n, Math.floor(((seg(t, 3.55, 12.2, ease.linear) * 0.70 + seg(t, 3.55, 5.0, ease.outCubic) * 0.05)) * G0.n)));
      const mp = G0.pts[gi], pos = this.marker.geometry.attributes.position.array; pos[0] = mp[0]; pos[1] = mp[1]; pos[2] = mp[2]; this.marker.geometry.attributes.position.needsUpdate = true;
      this.marker.material.uniforms.uAmp.value = seg(t, 3.6, 4.0) * (1 - seg(t, 10.5, 12.5) * 0.6) * (0.85 + 0.15 * Math.sin(t * 9));
      this.marker.material.uniforms.uPx.value = ctx.px; this.marker.material.uniforms.uT.value = t;
      // surface flow
      const F = this.fl, pa = this.flow.geometry.attributes.position.array, S = KLEIN.f, tf = tt;
      for (let i = 0; i < F.N; i++) { const p = S(F.u0[i] + F.w[i] * tf, F.v0[i] + F.dv[i] * tf); pa[i * 3] = p[0]; pa[i * 3 + 1] = p[1]; pa[i * 3 + 2] = p[2]; }
      this.flow.geometry.attributes.position.needsUpdate = true;
      this.flow.material.uniforms.uT.value = t; this.flow.material.uniforms.uPx.value = ctx.px; this.flow.material.uniforms.uRad.value = radv;
      this.flow.material.uniforms.uAmp.value = 0.5 * dim * (1 - 0.4 * seg(t, 10, 13));
      // readout (real numbers): live K, κ1, κ2 at the marker + numerical ∬K dA
      this._live = { K: G0.Ks[gi], k1: G0.K1[gi], k2: G0.K2[gi], s: G0.s[gi] };
    }

    // orbiting comets
    {
      const fadeO = seg(t, 3.5, 4.6, ease.inOutCubic) * (1 - seg(t, 4.2, 5.4, ease.inOutCubic)), shr = lerp(1, 0.70, seg(t, 4.5, 6.0, ease.inOutCubic));
      for (const o of this.orbits) {
        o.tilt.visible = fadeO > 0.002; o.spin.rotation.y = o.ph + o.w * (t - HERO) * 1.0 + 2.4 * (1 - ease.outCubic(clamp(tt / 3.0))) * Math.sign(o.w);
        o.comet.material.opacity = fadeO; o.cometHalo.material.opacity = fadeO; o.faint.material.opacity = fadeO * 0.55; o.tilt.scale.setScalar(shr);
        o.tilt.rotation.y = 0.05 * t;
      }
    }

    // ============================================================================================ post
    const hit = on ? Math.exp(-tt * 3.2) : 0, build = t < HERO ? seg(t, 0, HERO, ease.inCubic) : 0;
    post.bloom = Math.min(1.3, 0.60 + 0.30 * build + 0.6 * hit + (on ? 0.04 : 0)); post.bloomThreshold = on ? 0.95 : 0.85;
    post.bloomScatter = 0.74 - (on ? 0.12 * Math.exp(-tt * 9) : 0.12 * seg(t, 2.6, HERO, ease.inQuad)) + 0.03 * hit;
    post.streak = 0.05 + 0.10 * build + 0.2 * hit; post.streakColor = [0.5, 0.7, 1.0];
    post.flash = on ? 0.008 * Math.exp(-tt * 34) : 0.006 * Math.pow(seg(t, 2.95, HERO, ease.inQuad), 2);
    post.ca = 0.0018 + 0.012 * hit * hit + 0.002 * build;
    post.vignette = 0.62; post.exposure = 1.0 - 0.10 * seg(t, 10, 13); post.contrast = 1.06;
    this.scrim.material.uniforms.uS.value = seg(t, 4.2, 5.8, ease.inOutCubic) * 0.9;
    this.scrim.material.uniforms.uRes.value.set(ctx.W, ctx.H);
    this.scrim.material.uniforms.uRO.value = pulse(t, 3.5, 5.0, 0.5, 0.55);

    // ============================================================================================ typography
    this.text(t, ctx);
  },

  text(t, ctx) {
    const ui = ctx.ui, s = this.stat;
    // readout: real numbers (computed in init / live along the marker's geodesic)
    const vro = pulse(t, 3.5, 5.0, 0.5, 0.55);
    if (vro > 0.001 && this._live) {
      const L = this._live;
      kit.readout(ui, 'ro', [
        '<span style="color:#5ee7ff">KLEIN BOTTLE · χ = 0</span>',
        `∬K dA = ${fmtS(s.I, 4)} ≈ 2π·χ = 0`,
        `K ∈ [${fmtS(s.kmin, 2)}, ${fmtS(s.kmax, 2)}]`,
        `geodesic s = ${L.s.toFixed(2)}`,
        `Gauss K = ${fmtS(L.K, 3)}`,
        `κ₁ = ${fmtS(L.k1, 2)} &nbsp; κ₂ = ${fmtS(L.k2, 2)}`,
      ], { x: 128, y: 130, anchor: 'tl', size: 26, opacity: vro, color: '#ffc861', track: 0.05 });
    }
    // title
    const tin = eLin(t, 5.2, 6.5);
    const ty = 636;
    if (tin > 0) {
      ui.text('tt', '微分几何', { x: 960, y: ty, anchor: 'cc', size: 232, weight: 900, color: '#f6faff', glow: { r: 30, color: '#6fd0ff' }, track: 0.07, reveal: tin, spread: 0.5, opacity: seg(t, 5.2, 5.4) });
      // (the hollow cyan ghost outline was removed: text-stroke exposes glyph contour overlaps as stray bars)
    }
    const rl = seg(t, 5.9, 7.0, ease.outCubic);
    if (rl > 0) ui.line('rule', 960 - 300 * rl, 758, 960 + 300 * rl, 758, { stroke: '#5ee7ff', width: 2.2, opacity: 0.85 * (t < 12.5 ? 1 : 1), glow: 9 });
    const ten = eLin(t, 6.1, 7.6);
    if (ten > 0) ui.text('en', 'DIFFERENTIAL GEOMETRY', { x: 960 + 13, y: 802, anchor: 'cc', size: 44, font: 'en', weight: 500, track: 0.62, color: '#d6eeff', glow: 10, reveal: ten, revealMode: 'mask' });
    // tagline, then the closing line
    const cap = (key, at, dur, zh, en, y, zs, es, color) => {
      const v = pulse(t, at, at + dur, 0.55, 0.55); if (v <= 0.001) return;
      ui.text(key + 'z', zh, { x: 960, y, anchor: 'bc', size: zs, weight: 600, color, glow: 14, opacity: v, reveal: eLin(t, at, at + 0.9), spread: 0.3, track: 0.14 });
      ui.text(key + 'e', en, { x: 960, y: y + 18, anchor: 'tc', size: es, font: 'en', italic: true, weight: 600, color: '#dcefff', opacity: v * 0.92, track: 0.14, reveal: eLin(t, at + 0.3, at + 1.2), revealMode: 'mask' });
    };
    cap('tag', 7.9, 3.1, '在弯曲的世界里，寻找不变的真理。', 'In a curved world, find what never changes.', 915, 48, 38, '#f4f8ff');
    cap('end', 10.9, 6.0, '开启弯曲世界的大门。', 'Open the door to curved worlds.', 915, 46, 38, '#ffe9bd');
  },

  beats: [
    { t: 0.5, kind: 'tick' }, { t: 1.0, kind: 'tick' }, { t: 1.5, kind: 'tick', label: 'motifs accelerate' }, { t: 2.0, kind: 'swell' }, { t: 2.5, kind: 'tick' },
    { t: 2.7, kind: 'whoosh' }, { t: 3.0, kind: 'hit', label: 'the point detonates: Klein bottle' }, { t: 4.5, kind: 'sparkle', label: 'title' },
    { t: 5.6, kind: 'sparkle', label: 'DIFFERENTIAL GEOMETRY' }, { t: 7.6, kind: 'swell', label: 'tagline' }, { t: 10.9, kind: 'sparkle', label: 'closing line' },
  ],
};

function eLin(x, a, b) { return clamp((x - a) / (b - a)); }
