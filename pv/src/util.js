// Shared math / easing / palette / GLSL chunks for every scene.
// Everything here is PURE and deterministic (no Math.random, no Date.now).
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const PI = Math.PI;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (x - a) / (b - a);
export const remap = (x, a, b, c, d) => lerp(c, d, clamp((x - a) / (b - a)));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smootherstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
export const mix = lerp;
export const fract = (x) => x - Math.floor(x);

/** Easing functions: all map [0,1] -> [0,1]. */
export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  inSine: (t) => 1 - Math.cos((t * PI) / 2),
  outSine: (t) => Math.sin((t * PI) / 2),
  inOutSine: (t) => -(Math.cos(PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inOutBack: (t) => { const c2 = 1.70158 * 1.525; return t < 0.5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2; },
  outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * PI) / 3)) + 1),
};

/** seg(t, t0, t1, easeFn): eased progress of t through the window [t0,t1] (clamped to 0..1). THE workhorse for choreography. */
export const seg = (t, t0, t1, fn = ease.inOutCubic) => fn(clamp((t - t0) / (t1 - t0)));
/** pulse(t, t0, t1, fadeIn, fadeOut): 0 -> 1 -> 0 envelope, useful for text that appears then disappears. */
export const pulse = (t, t0, t1, fi = 0.5, fo = 0.5) => smoothstep(t0, t0 + fi, t) * (1 - smoothstep(t1 - fo, t1, t));

/** Seeded PRNG (mulberry32). Use this instead of Math.random. Returns () => [0,1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r()); // normal(0,1) from an rng

// ---------------------------------------------------------------- Simplex noise 3D (deterministic)
const _p = new Uint8Array(512);
{
  const r = rng(1234567);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) _p[i] = perm[i & 255];
}
const _g3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
/** 3D simplex noise, range about [-1,1]. */
export function noise3(x, y, z) {
  const F3 = 1 / 3, G3 = 1 / 6;
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  const c = (xx, yy, zz, gi) => { let tt = 0.6 - xx * xx - yy * yy - zz * zz; if (tt < 0) return 0; tt *= tt; const g = _g3[gi % 12]; return tt * tt * (g[0] * xx + g[1] * yy + g[2] * zz); };
  const n0 = c(x0, y0, z0, _p[ii + _p[jj + _p[kk]]]);
  const n1 = c(x1, y1, z1, _p[ii + i1 + _p[jj + j1 + _p[kk + k1]]]);
  const n2 = c(x2, y2, z2, _p[ii + i2 + _p[jj + j2 + _p[kk + k2]]]);
  const n3 = c(x3, y3, z3, _p[ii + 1 + _p[jj + 1 + _p[kk + 1]]]);
  return 32 * (n0 + n1 + n2 + n3);
}
export const fbm3 = (x, y, z, oct = 4) => { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2; a *= 0.5; } return s; };

// ---------------------------------------------------------------- Palette (hex sRGB). THREE.Color(hex) converts to linear for you.
export const palette = {
  void: 0x02030a,     // background
  deep: 0x060b1f,
  ink: 0x0b1230,
  cyan: 0x5ee7ff,     // primary line / light colour
  ice: 0xbdf4ff,
  blue: 0x3b6dff,
  violet: 0x8a5cff,
  magenta: 0xff4fd8,
  gold: 0xffc861,     // positive curvature / accent
  amber: 0xff9a3c,
  ember: 0xff5a36,
  white: 0xf4f8ff,
  mint: 0x6dffc4,
};
export const css = (hex) => '#' + hex.toString(16).padStart(6, '0');
export const color = (hex) => new THREE.Color(hex);

/** Divergent curvature colour map (JS). k normalised to [-1,1]: -1 saddle = cyan/blue, 0 = deep violet-navy, +1 sphere-like = gold/ember. Returns THREE.Color (linear). */
export function curvatureColor(k, out = new THREE.Color()) {
  k = clamp(k, -1, 1);
  const neg = new THREE.Color(0x2fd8ff), mid = new THREE.Color(0x1a1550), pos = new THREE.Color(0xffb347), hot = new THREE.Color(0xff4a2a);
  if (k < 0) return out.copy(mid).lerp(neg, Math.pow(-k, 0.8));
  if (k < 0.6) return out.copy(mid).lerp(pos, Math.pow(k / 0.6, 0.8));
  return out.copy(pos).lerp(hot, (k - 0.6) / 0.4);
}

// ---------------------------------------------------------------- GLSL chunks (concatenate into your shader source)
export const GLSL = {
  hash: /* glsl */ `
    float hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
    float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
    vec3  hash33(vec3 p3){ p3 = fract(p3*vec3(.1031,.1030,.0973)); p3 += dot(p3,p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }
  `,
  noise: /* glsl */ `
    // 3D simplex noise (Ashima / Ian McEwan), range ~[-1,1]
    vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;} vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
    vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);} vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
    float snoise(vec3 v){
      const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
      vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
      vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
      vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
      i=mod289(i);
      vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
      float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
      vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
      vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
      vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
      vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
      vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
      vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
      vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
      vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
      return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }
    float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.02; a*=.5;} return s; }
  `,
  // Divergent curvature colour map, matches util.curvatureColor(). k in [-1,1]. Output is LINEAR colour.
  curvatureColor: /* glsl */ `
    vec3 curvatureColor(float k){
      k = clamp(k,-1.,1.);
      vec3 neg = vec3(0.028,0.687,1.0), mid = vec3(0.010,0.008,0.080), pos = vec3(1.0,0.450,0.065), hot = vec3(1.0,0.070,0.023);
      if(k<0.) return mix(mid,neg,pow(-k,.8));
      if(k<.6) return mix(mid,pos,pow(k/.6,.8));
      return mix(pos,hot,(k-.6)/.4);
    }
  `,
  cosPalette: /* glsl */ `
    vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(6.28318*(c*t+d)); }
  `,
  fresnel: /* glsl */ `
    float fresnel(vec3 n, vec3 v, float p){ return pow(1. - clamp(dot(normalize(n), normalize(v)), 0., 1.), p); }
  `,
};

/** Convenience: place a perspective camera on a sphere around target. az/el in radians. */
export function orbitCamera(camera, { target = [0, 0, 0], r = 6, az = 0, el = 0.3, roll = 0 } = {}) {
  const ce = Math.cos(el);
  camera.position.set(target[0] + r * ce * Math.sin(az), target[1] + r * Math.sin(el), target[2] + r * ce * Math.cos(az));
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  camera.lookAt(target[0], target[1], target[2]);
  camera.updateMatrixWorld();
}

/** Build a THREE.CatmullRomCurve3 point list -> array of Vector3 sampled uniformly. */
export function samplePoints(fn, n, t0 = 0, t1 = 1) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = lerp(t0, t1, i / n); const p = fn(t); pts.push(Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone()); }
  return pts;
}

/** Soft additive glow sprite texture (radial gradient), created once. Use with THREE.Sprite / Points + AdditiveBlending. */
let _glowTex;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.14)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c); _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
