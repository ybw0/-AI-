// Shared visual kit: everything that must look IDENTICAL across scenes lives here (backdrop, stars, hero surface material, arrows, titles, captions).
import * as THREE from 'three';
import { GLSL, palette, clamp, lerp, ease, seg, pulse, smoothstep, rng, fbm3, TAU, css } from './util.js';

// ============================================================================================================ 3D pieces
/** Star field on a big shell. Returns THREE.Points. Twinkle is a pure function of time: call kit.updateStars(points, t). */
export function starfield(ctx, { count = 1800, radius = 90, seed = 7, size = 1.6, intensity = 1.0, tint = [0.75, 0.85, 1.0] } = {}) {
  const r = rng(seed), pos = new Float32Array(count * 3), col = new Float32Array(count * 3), sz = new Float32Array(count), ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - u * u), rad = radius * (0.85 + 0.3 * r());
    pos.set([rad * s * Math.cos(a), rad * u, rad * s * Math.sin(a)], i * 3);
    const warm = r(), b = Math.pow(r(), 3) * 1.6 + 0.25;
    col.set([lerp(tint[0], 1.0, warm * 0.5) * b, lerp(tint[1], 0.9, warm * 0.5) * b, lerp(tint[2], 0.8, warm * 0.4) * b], i * 3);
    sz[i] = size * (0.5 + 1.6 * Math.pow(r(), 4)); ph[i] = r() * TAU;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uT: { value: 0 }, uPx: { value: ctx.px }, uI: { value: intensity } },
    vertexShader: `attribute float aSize; attribute float aPh; uniform float uT, uPx; varying vec3 vC; varying float vTw;
      void main(){ vC = color; vTw = 0.75 + 0.25*sin(uT*1.7 + aPh*3.0); vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = aSize*uPx*2.2; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vTw; uniform float uI; void main(){ vec2 p = gl_PointCoord-0.5; float d = length(p)*2.0; float a = smoothstep(1.0,0.0,d); a = a*a; gl_FragColor = vec4(vC*a*vTw*uI*2.0, a); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = -10; return pts;
}
export const updateStars = (pts, t, px) => { pts.material.uniforms.uT.value = t; if (px) pts.material.uniforms.uPx.value = px; };

/** Deep-space nebula backdrop: baked once (cheap per frame). Add to scene; call backdrop.rotation.y = ... to drift. */
export function backdrop(ctx, { seed = 3, a = 0x0a1240, b = 0x2a0f52, c = 0x0a3a5a, intensity = 1.0, scale = 1.6 } = {}) {
  const W = 512, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), img = g.createImageData(W, H);
  const ca = new THREE.Color(a), cb = new THREE.Color(b), cc = new THREE.Color(c), o = seed * 17.3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const th = (x / W) * TAU, ph = (y / H) * Math.PI, sx = Math.sin(ph) * Math.cos(th), sy = Math.cos(ph), sz = Math.sin(ph) * Math.sin(th);
    const n1 = fbm3(sx * scale + o, sy * scale, sz * scale, 4) * 0.5 + 0.5, n2 = fbm3(sx * scale * 2 + 9 + o, sy * scale * 2, sz * scale * 2 + 3, 3) * 0.5 + 0.5;
    const k1 = Math.pow(clamp((n1 - 0.35) * 2.2), 2.0), k2 = Math.pow(clamp((n2 - 0.4) * 2.4), 2.2);
    const i = (y * W + x) * 4;
    const r = ca.r * 0.25 + cb.r * k1 + cc.r * k2, gg = ca.g * 0.25 + cb.g * k1 + cc.g * k2, bb = ca.b * 0.25 + cb.b * k1 + cc.b * k2;
    // store sRGB-encoded for the texture; linearised on sampling
    const enc = (v) => Math.round(255 * clamp(Math.pow(clamp(v * intensity), 1 / 2.2)));
    img.data[i] = enc(r); img.data[i + 1] = enc(gg); img.data[i + 2] = enc(bb); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 48, 32), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }));
  mesh.renderOrder = -20; mesh.frustumCulled = false; return mesh;
}

/**
 * THE hero material for parametric surfaces built with geom.parametricGeometry (needs attributes aK, uv, normal).
 * Uniforms (all live-editable via mat.uniforms.X.value):
 *  uCurv: 0..1 blend of divergent curvature colouring (gold = K>0, cyan = K<0, deep violet = 0)   uKScale: 1/|Kmax| to normalise K
 *  uBase: base colour (THREE.Color)         uAlpha: opacity (material is transparent when < 1)
 *  uGrid: (nu, nv) iso-parametric line count, uGridW: line width px, uGridI: line glow intensity, uGridCol
 *  uRim / uRimCol: fresnel rim glow           uSpec: specular sheen           uEmis: flat emissive of base
 *  uReveal: 0..1 sweep along uv.x (with glowing edge)       uRevealV: 0..1 sweep along uv.y (use 1 to disable)   uTime
 *  uLevels / uLevelI: K iso-contour lines (curvature level sets)
 */
export function surfaceMaterial(o = {}) {
  const U = (v) => ({ value: v });
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: o.depthWrite ?? true,
    uniforms: {
      uCurv: U(o.curv ?? 0), uKScale: U(o.kScale ?? 1), uBase: U(new THREE.Color(o.base ?? 0x1a2a66)), uAlpha: U(o.alpha ?? 1),
      uGrid: U(new THREE.Vector2(...(o.grid ?? [24, 12]))), uGridW: U(o.gridW ?? 1.2), uGridI: U(o.gridI ?? 1.0), uGridCol: U(new THREE.Color(o.gridCol ?? palette.cyan)),
      uRim: U(o.rim ?? 1.2), uRimCol: U(new THREE.Color(o.rimCol ?? palette.cyan)), uSpec: U(o.spec ?? 0.5), uEmis: U(o.emis ?? 0.0),
      uReveal: U(o.reveal ?? 1.01), uRevealV: U(o.revealV ?? 1.01), uTime: U(0), uPx: U(1), uLevels: U(o.levels ?? 0), uLevelI: U(o.levelI ?? 0.0),
    },
    vertexShader: /* glsl */ `
      attribute float aK; varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vK;
      void main(){ vUv = uv; vK = aK; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vK;
      uniform float uCurv,uKScale,uAlpha,uGridW,uGridI,uRim,uSpec,uEmis,uReveal,uRevealV,uTime,uPx,uLevels,uLevelI; uniform vec3 uBase,uGridCol,uRimCol; uniform vec2 uGrid;
      ${GLSL.curvatureColor}
      void main(){
        float e = uReveal - vUv.x, ev = uRevealV - vUv.y; if(e < 0.0 || ev < 0.0) discard;
        vec3 n = normalize(vN); if(!gl_FrontFacing) n = -n; vec3 v = normalize(vV);
        float kn = clamp(vK*uKScale, -1.0, 1.0);
        vec3 base = mix(uBase, curvatureColor(kn), uCurv);
        vec3 L1 = normalize(vec3(0.45,0.80,0.55)), L2 = normalize(vec3(-0.75,0.15,0.45)), L3 = normalize(vec3(0.0,-0.6,-0.8));
        float d1 = max(dot(n,L1),0.0), d2 = max(dot(n,L2),0.0), d3 = max(dot(n,L3),0.0);
        vec3 col = base*(0.10 + 0.85*d1) + base*vec3(0.55,0.65,1.0)*d2*0.35 + uRimCol*d3*0.10;
        float fr = pow(1.0 - clamp(dot(n,v),0.0,1.0), 2.6); col += uRimCol*fr*uRim;
        vec3 h = normalize(L1+v); col += vec3(1.0,0.95,0.9)*pow(max(dot(n,h),0.0), 48.0)*uSpec;
        col += base*uEmis;
        vec2 gp = vUv*uGrid; vec2 gd = abs(fract(gp-0.5)-0.5)/max(fwidth(gp), vec2(1e-4)); float gl = 1.0 - min(min(gd.x,gd.y)/max(uGridW,0.01), 1.0);
        col += uGridCol*uGridI*gl*gl*(0.35+0.65*(0.4+fr));
        if(uLevels > 0.5){ float lk = kn*uLevels; float ld = abs(fract(lk-0.5)-0.5)/max(fwidth(lk),1e-4); float lc = 1.0 - min(ld/1.2,1.0); col += vec3(1.0,0.96,0.85)*uLevelI*lc; }
        float edgeGlow = smoothstep(0.035, 0.0, e) * step(e, 0.06) * step(uReveal, 1.0) + smoothstep(0.035,0.0,ev)*step(uRevealV,1.0);
        col += vec3(0.6,0.9,1.0)*edgeGlow*5.0;
        gl_FragColor = vec4(col, uAlpha);
      }`,
  });
  mat.extensions = { derivatives: true };
  return mat;
}

/** 3D arrow (fat shaft + cone head), HDR emissive. arrow.set(from[3], dir[3], length) each frame. */
export function arrow(ctx, { color = palette.gold, width = 4, head = 0.09, intensity = 2.5 } = {}) {
  const g = new THREE.Group();
  const shaft = ctx.fatLine([[0, 0, 0], [0, 1, 0]], { color, width, intensity });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.55, head * 1.5, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
  g.add(shaft, cone);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  g.set = (from, dir, len = 1) => {
    d.set(dir[0], dir[1], dir[2]).normalize();
    const tip = [from[0] + d.x * len, from[1] + d.y * len, from[2] + d.z * len];
    const base = [from[0] + d.x * (len - head * 0.9), from[1] + d.y * (len - head * 0.9), from[2] + d.z * (len - head * 0.9)];
    shaft.geometry.setPositions([...from, ...base]);
    cone.position.set(tip[0] - d.x * head * 0.75, tip[1] - d.y * head * 0.75, tip[2] - d.z * head * 0.75);
    q.setFromUnitVectors(up, d); cone.quaternion.copy(q);
    g.visible = len > 1e-4;
  };
  return g;
}

// ============================================================================================================ 2D overlay components
/**
 * Standard chapter title: giant Chinese serif word + English italic + mono kicker + animated rule.
 * kit.chapterTitle(ctx.ui, t, {at:0.6, hold:3.5, zh:'曲面', en:'Surfaces', kicker:'CHAPTER 02', sub:'一句话副标题', x:170, y:200, size:170, align:'left'})
 * Reveal over 1.4s starting at `at`, stays for `hold`, then fades out over 0.7s. Returns visibility 0..1.
 */
export function chapterTitle(ui, t, { at = 0.5, hold = 3.5, zh, en, kicker = '', sub = '', x = 170, y = 220, size = 170, key = 'ct', color = '#f4f8ff', accent = '#5ee7ff', anchor = 'tl' } = {}) {
  const inn = seg(t, at, at + 1.4, ease.outCubic), out = seg(t, at + 1.4 + hold, at + 2.1 + hold, ease.inOutCubic), v = inn * (1 - out);
  if (v <= 0.001) return 0;
  const al = anchor[1] === 'r' ? 'right' : anchor[1] === 'c' ? 'center' : 'left';
  const dx = anchor[1] === 'r' ? -1 : 1;
  ui.text(key + 'k', kicker, { x, y: y - size * 0.34, anchor, size: 20, font: 'mono', track: 0.42, color: accent, opacity: v, reveal: seg(t, at, at + 0.9, ease.linear), revealMode: 'mask', align: al });
  ui.text(key + 'z', zh, { x, y, anchor, size, weight: 900, color, glow: 26, opacity: v, reveal: seg(t, at + 0.15, at + 1.35, ease.linear), spread: 0.9, align: al, track: 0.04 });
  ui.text(key + 'e', en, { x: x + 6 * dx, y: y + size * 1.02, anchor, size: Math.round(size * 0.27), font: 'en', italic: true, weight: 400, track: 0.22, color: '#cfeaff', opacity: v * 0.9, reveal: seg(t, at + 0.5, at + 1.5, ease.linear), revealMode: 'mask', align: al, upper: false });
  const rw = 220;
  ui.line(key + 'r', x + (dx > 0 ? 0 : -rw), y + size * 1.02 + size * 0.36, x + (dx > 0 ? rw : 0), y + size * 1.02 + size * 0.36, { stroke: accent, width: 2.5, progress: seg(t, at + 0.4, at + 1.4), opacity: v * 0.9, glow: 8 });
  if (sub) ui.text(key + 's', sub, { x: x + 4 * dx, y: y + size * 1.02 + size * 0.36 + 34, anchor, size: 26, weight: 400, color: '#dcecff', opacity: v * 0.85, reveal: seg(t, at + 0.8, at + 1.8, ease.linear), revealMode: 'mask', align: al, track: 0.12 });
  return v;
}

/** Bottom-centre narration caption: Chinese line + small English line. kit.caption(ui, t, {at, dur, zh, en, key}). Fade 0.5 in / 0.5 out. */
export function caption(ui, t, { at, dur = 3.0, zh, en = '', key = 'cap', y = 930, size = 44, color = '#f4f8ff' }) {
  const v = pulse(t, at, at + dur, 0.55, 0.55);
  if (v <= 0.001) return 0;
  ui.text(key + 'z', zh, { x: 960, y, anchor: 'bc', size, weight: 600, color, glow: 14, opacity: v, reveal: seg(t, at, at + 0.9, ease.linear), spread: 0.7, track: 0.14 });
  if (en) ui.text(key + 'e', en, { x: 960, y: y + 14, anchor: 'tc', size: Math.round(size * 0.46), font: 'en', italic: true, color: '#b8dcff', opacity: v * 0.85, track: 0.18, reveal: seg(t, at + 0.3, at + 1.1, ease.linear), revealMode: 'mask' });
  return v;
}

/** Mono HUD readout block. lines: array of strings/html. kit.readout(ui, 'ro', lines, {x,y,opacity,anchor,size,color}) */
export function readout(ui, key, lines, { x = 1700, y = 900, opacity = 1, anchor = 'br', size = 22, color = '#ffc861', track = 0.08 } = {}) {
  ui.text(key, lines.join('<br>'), { x, y, anchor, size, font: 'mono', color, opacity, lh: 1.55, track, align: anchor[1] === 'r' ? 'right' : 'left' });
}

/** Big formula card: KaTeX with glow and mask reveal. kit.formula(ui, t, key, latex, {at, dur, x, y, size, anchor, color}) */
export function formula(ui, t, key, latex, { at = 0, dur = 99, x = 960, y = 540, size = 64, anchor = 'cc', color = '#f4f8ff', glow = 12, display = true, fi = 0.8, fo = 0.6 } = {}) {
  const v = pulse(t, at, at + dur, fi, fo);
  if (v <= 0.001) return 0;
  ui.tex(key, latex, { x, y, size, anchor, color, glow, display, opacity: v, reveal: seg(t, at, at + fi + 0.5, ease.linear), revealMode: 'mask' });
  return v;
}
