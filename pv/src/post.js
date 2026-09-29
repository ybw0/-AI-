// HDR post-processing: transitions -> multi-mip bloom (+anamorphic streak) -> grade (tonemap, CA, vignette, grain, dither).
// All render targets are half-float linear HDR. Scene shaders should output LINEAR colour (values > 1 will bloom).
import * as THREE from 'three';

export const POST_DEFAULTS = {
  exposure: 1.0,
  bloom: 0.55,            // bloom strength
  bloomThreshold: 0.85,
  bloomKnee: 0.6,
  bloomScatter: 0.74,     // 0..1 how wide the glow spreads
  streak: 0.12,           // anamorphic horizontal streak strength (crank up for scenes with bright point lights)
  streakColor: [0.45, 0.65, 1.0],
  contrast: 1.06,
  saturation: 1.12,
  tint: [1.0, 1.0, 1.0],  // multiplicative colour grade
  vignette: 0.5,
  ca: 0.0016,             // chromatic aberration (radial)
  grain: 0.03,
  flash: 0,               // additive white (HDR) - for hits
};
export const TRANSITIONS = { fade: 0, flash: 1, iris: 2, glitch: 3, zoom: 4, dip: 5 };

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const COMMON = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
  float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
`;

function pass(frag, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: COMMON + frag, uniforms,
    depthTest: false, depthWrite: false, transparent: false, blending: THREE.NoBlending,
  });
}

const F_PREFILTER = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold, knee;
  vec3 pf(vec3 c){
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - threshold + knee, 0.0, 2.0*knee); soft = soft*soft/(4.0*knee + 1e-4);
    float k = max(soft, br - threshold) / max(br, 1e-4);
    return min(c*k, vec3(64.0));
  }
  vec3 tap(vec2 uv, vec2 o){ return pf(texture2D(tSrc, uv + texel*o).rgb); }
  void main(){
    vec3 a=tap(vUv,vec2(-2, 2)), b=tap(vUv,vec2(0, 2)), c=tap(vUv,vec2(2, 2));
    vec3 d=tap(vUv,vec2(-2, 0)), e=tap(vUv,vec2(0, 0)), f=tap(vUv,vec2(2, 0));
    vec3 g=tap(vUv,vec2(-2,-2)), h=tap(vUv,vec2(0,-2)), i=tap(vUv,vec2(2,-2));
    vec3 j=tap(vUv,vec2(-1, 1)), k=tap(vUv,vec2(1, 1)), l=tap(vUv,vec2(-1,-1)), m=tap(vUv,vec2(1,-1));
    vec3 g0=(a+b+d+e)*.25, g1=(b+c+e+f)*.25, g2=(d+e+g+h)*.25, g3=(e+f+h+i)*.25, g4=(j+k+l+m)*.25;
    float w0=.125/(1.+luma(g0)), w1=.125/(1.+luma(g1)), w2=.125/(1.+luma(g2)), w3=.125/(1.+luma(g3)), w4=.5/(1.+luma(g4));
    gl_FragColor = vec4((g0*w0+g1*w1+g2*w2+g3*w3+g4*w4)/(w0+w1+w2+w3+w4), 1.0);
  }
`;
const F_DOWN = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 texel;
  vec3 tap(vec2 uv, vec2 o){ return texture2D(tSrc, uv + texel*o).rgb; }
  void main(){
    vec3 a=tap(vUv,vec2(-2, 2)), b=tap(vUv,vec2(0, 2)), c=tap(vUv,vec2(2, 2));
    vec3 d=tap(vUv,vec2(-2, 0)), e=tap(vUv,vec2(0, 0)), f=tap(vUv,vec2(2, 0));
    vec3 g=tap(vUv,vec2(-2,-2)), h=tap(vUv,vec2(0,-2)), i=tap(vUv,vec2(2,-2));
    vec3 j=tap(vUv,vec2(-1, 1)), k=tap(vUv,vec2(1, 1)), l=tap(vUv,vec2(-1,-1)), m=tap(vUv,vec2(1,-1));
    vec3 o = e*.125 + (a+c+g+i)*.03125 + (b+d+f+h)*.0625 + (j+k+l+m)*.125;
    gl_FragColor = vec4(o, 1.0);
  }
`;
const F_UP = /* glsl */ `
  uniform sampler2D tLow, tHigh; uniform vec2 texelLow; uniform float scatter;
  void main(){
    vec3 s = vec3(0.0);
    s += texture2D(tLow, vUv + texelLow*vec2(-1,-1)).rgb*1.0; s += texture2D(tLow, vUv + texelLow*vec2(0,-1)).rgb*2.0; s += texture2D(tLow, vUv + texelLow*vec2(1,-1)).rgb*1.0;
    s += texture2D(tLow, vUv + texelLow*vec2(-1, 0)).rgb*2.0; s += texture2D(tLow, vUv).rgb*4.0;                            s += texture2D(tLow, vUv + texelLow*vec2(1, 0)).rgb*2.0;
    s += texture2D(tLow, vUv + texelLow*vec2(-1, 1)).rgb*1.0; s += texture2D(tLow, vUv + texelLow*vec2(0, 1)).rgb*2.0; s += texture2D(tLow, vUv + texelLow*vec2(1, 1)).rgb*1.0;
    s /= 16.0;
    gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, s, scatter), 1.0);
  }
`;
const F_BLURH = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 step;
  void main(){
    vec3 s = texture2D(tSrc, vUv).rgb*0.2270270270;
    s += (texture2D(tSrc, vUv+step*1.3846153846).rgb + texture2D(tSrc, vUv-step*1.3846153846).rgb)*0.3162162162;
    s += (texture2D(tSrc, vUv+step*3.2307692308).rgb + texture2D(tSrc, vUv-step*3.2307692308).rgb)*0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }
`;

const F_TRANS = /* glsl */ `
  uniform sampler2D tA, tB; uniform float p; uniform int type; uniform float aspect; uniform float seed;
  vec3 radial(sampler2D t, vec2 uv, float strength){
    vec3 s = vec3(0.0); vec2 c = uv - 0.5;
    for(int i=0;i<12;i++){ float f = float(i)/11.0; s += texture2D(t, 0.5 + c*(1.0 - strength*f)).rgb; }
    return s/12.0;
  }
  void main(){
    vec3 a = texture2D(tA, vUv).rgb, b = texture2D(tB, vUv).rgb; vec3 o;
    if(type==0){ float k = smoothstep(0.,1.,p); o = mix(a,b,k); }
    else if(type==1){ // white-out flash
      float k = smoothstep(.42,.58,p); o = mix(a,b,k);
      float f = pow(max(0., 1.-abs(2.*p-1.)), 2.2); o += vec3(1.0,0.97,0.92)*f*9.0;
    }
    else if(type==2){ // iris: reveal B inside a growing circle with glowing rim
      vec2 c = (vUv-0.5)*vec2(aspect,1.0); float r = length(c); float R = p*1.25*aspect*0.62+0.0001;
      float e = smoothstep(R, R-0.02, r); o = mix(a,b,e);
      float rim = exp(-pow((r-R)*40.,2.)) * sin(p*3.14159); o += vec3(0.4,0.8,1.0)*rim*6.0;
    }
    else if(type==3){ // glitch: horizontal slices displace + RGB split, swaps at p=.5
      float band = floor(vUv.y*28.+seed*7.); float h = hash21(vec2(band, floor(p*14.)+seed));
      float amt = sin(p*3.14159); float off = (h-.5)*.25*amt*step(.35,h);
      vec2 uv = vUv + vec2(off,0.);
      float k = step(.5, p + (h-.5)*.25);
      vec3 sa = vec3(texture2D(tA, uv+vec2(.012*amt,0.)).r, texture2D(tA, uv).g, texture2D(tA, uv-vec2(.012*amt,0.)).b);
      vec3 sb = vec3(texture2D(tB, uv+vec2(.012*amt,0.)).r, texture2D(tB, uv).g, texture2D(tB, uv-vec2(.012*amt,0.)).b);
      o = mix(sa,sb,k) * (1.0 + amt*0.4);
    }
    else if(type==4){ // zoom-blur push
      float s = sin(p*3.14159);
      vec3 ra = radial(tA, vUv, 0.45*p*p + 0.0*s), rb = radial(tB, vUv, -0.6*(1.-p)*(1.-p));
      o = mix(ra, rb, smoothstep(.25,.75,p)) * (1.0 + s*0.5);
    }
    else { // dip to black
      float k = p<.5 ? 1.-smoothstep(0.,.5,p) : smoothstep(.5,1.,p); o = (p<.5?a:b)*k;
    }
    gl_FragColor = vec4(o, 1.0);
  }
`;

const F_GRADE = /* glsl */ `
  uniform sampler2D tScene, tBloom, tStreak;
  uniform float exposure, bloomStr, streakStr, contrast, saturation, vignette, ca, grain, flash, fade, frame;
  uniform vec3 streakColor, tint; uniform float aspect;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }
  vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1./2.4))-0.055, step(0.0031308, c)); }
  void main(){
    vec2 c = vUv - 0.5; float r2 = dot(c*vec2(aspect,1.), c*vec2(aspect,1.));
    vec2 off = c*ca*(1.0+r2*2.0);
    vec3 col = vec3(texture2D(tScene, vUv+off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv-off).b);
    col += texture2D(tBloom, vUv).rgb * bloomStr;
    col += texture2D(tStreak, vUv).rgb * streakColor * streakStr;
    col *= exposure * tint;
    col *= 1.0 - vignette * smoothstep(0.15, 0.95, r2*1.6);
    col += vec3(1.0,0.97,0.92)*flash;
    col = aces(col);
    col = toSRGB(col);
    col = (col-0.5)*contrast + 0.5;
    float l = luma(col); col = mix(vec3(l), col, saturation);
    col = max(col, 0.0);
    float n = hash21(gl_FragCoord.xy + frame*17.13) - 0.5;
    float n2 = hash21(gl_FragCoord.xy*1.37 + frame*3.71) - 0.5;
    col += (n*grain*(0.35+l)) + (n+n2)/255.0;      // film grain + triangular dither (kills banding on dark gradients)
    col *= fade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Post {
  constructor(renderer, W, H, type = THREE.HalfFloatType) {
    this.r = renderer; this.type = type;
    this.quad = new THREE.Mesh(new THREE.BufferGeometry(), null);
    this.quad.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const u = (v) => ({ value: v });
    this.mPre = pass(F_PREFILTER, { tSrc: u(null), texel: u(new THREE.Vector2()), threshold: u(1), knee: u(0.5) });
    this.mDown = pass(F_DOWN, { tSrc: u(null), texel: u(new THREE.Vector2()) });
    this.mUp = pass(F_UP, { tLow: u(null), tHigh: u(null), texelLow: u(new THREE.Vector2()), scatter: u(0.7) });
    this.mBlur = pass(F_BLURH, { tSrc: u(null), step: u(new THREE.Vector2()) });
    this.mTrans = pass(F_TRANS, { tA: u(null), tB: u(null), p: u(0), type: u(0), aspect: u(16 / 9), seed: u(0) });
    this.mGrade = pass(F_GRADE, {
      tScene: u(null), tBloom: u(null), tStreak: u(null), exposure: u(1), bloomStr: u(0.5), streakStr: u(0.2), contrast: u(1), saturation: u(1), vignette: u(0.4),
      ca: u(0.002), grain: u(0.03), flash: u(0), fade: u(1), frame: u(0), streakColor: u(new THREE.Vector3(0.5, 0.7, 1)), tint: u(new THREE.Vector3(1, 1, 1)), aspect: u(16 / 9),
    });
    this.resize(W, H);
  }
  _rt(w, h) {
    return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), { type: this.type, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace });
  }
  resize(W, H) {
    this.W = W; this.H = H;
    for (const rt of [...(this.down || []), ...(this.up || []), ...(this.streak || []), this.rtMix]) rt && rt.dispose();
    this.rtMix = this._rt(W, H);
    this.down = []; this.up = [];
    const LEVELS = 6;
    for (let i = 0; i < LEVELS; i++) { const w = W / Math.pow(2, i + 1), h = H / Math.pow(2, i + 1); this.down.push(this._rt(w, h)); this.up.push(this._rt(w, h)); }
    this.streak = [this._rt(W / 8, H / 8), this._rt(W / 8, H / 8)];
    this.mGrade.uniforms.aspect.value = W / H; this.mTrans.uniforms.aspect.value = W / H;
  }
  _draw(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }

  /** Blend two HDR textures into rtMix, returns rtMix.texture */
  transition(texA, texB, p, type, seed = 0) {
    const u = this.mTrans.uniforms; u.tA.value = texA; u.tB.value = texB; u.p.value = p; u.type.value = type; u.seed.value = seed;
    this._draw(this.mTrans, this.rtMix);
    return this.rtMix.texture;
  }

  /** src: HDR texture. Draws graded result to the canvas. */
  finish(src, P, frameIndex, fade = 1) {
    const W = this.W, H = this.H;
    // bloom
    const pre = this.mPre.uniforms; pre.tSrc.value = src; pre.texel.value.set(1 / W, 1 / H); pre.threshold.value = P.bloomThreshold; pre.knee.value = Math.max(0.01, P.bloomKnee);
    this._draw(this.mPre, this.down[0]);
    for (let i = 1; i < this.down.length; i++) {
      const d = this.mDown.uniforms; d.tSrc.value = this.down[i - 1].texture; d.texel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
      this._draw(this.mDown, this.down[i]);
    }
    const last = this.down.length - 1;
    for (let i = last - 1; i >= 0; i--) {
      const up = this.mUp.uniforms; up.tLow.value = (i + 1 === last ? this.down[last] : this.up[i + 1]).texture; up.tHigh.value = this.down[i].texture;
      up.texelLow.value.set(1 / this.down[i + 1].width, 1 / this.down[i + 1].height); up.scatter.value = P.bloomScatter;
      this._draw(this.mUp, this.up[i]);
    }
    const bloomTex = this.up[0].texture;
    // anamorphic streak from a mid mip
    let streakTex = bloomTex;
    if (P.streak > 0.001) {
      const b = this.mBlur.uniforms; const s = this.streak;
      b.tSrc.value = this.down[2].texture; b.step.value.set((1 / s[0].width) * 1.0, 0); this._draw(this.mBlur, s[0]);
      b.tSrc.value = s[0].texture; b.step.value.set((1 / s[0].width) * 3.0, 0); this._draw(this.mBlur, s[1]);
      b.tSrc.value = s[1].texture; b.step.value.set((1 / s[0].width) * 9.0, 0); this._draw(this.mBlur, s[0]);
      b.tSrc.value = s[0].texture; b.step.value.set((1 / s[0].width) * 20.0, 0); this._draw(this.mBlur, s[1]);
      streakTex = s[1].texture;
    }
    const g = this.mGrade.uniforms;
    g.tScene.value = src; g.tBloom.value = bloomTex; g.tStreak.value = streakTex;
    g.exposure.value = P.exposure; g.bloomStr.value = P.bloom; g.streakStr.value = P.streak > 0.001 ? P.streak * 2.0 : 0;
    g.contrast.value = P.contrast; g.saturation.value = P.saturation; g.vignette.value = P.vignette; g.ca.value = P.ca; g.grain.value = P.grain; g.flash.value = P.flash;
    g.fade.value = fade; g.frame.value = frameIndex % 4096; g.streakColor.value.fromArray(P.streakColor); g.tint.value.fromArray(P.tint);
    this._draw(this.mGrade, null);
  }
}
