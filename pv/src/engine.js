// Engine: deterministic, random-access renderer. renderAt(T) is a PURE function of T (no hidden state), so frames can be
// rendered in any order / in parallel and previewed anywhere.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { Post, POST_DEFAULTS, TRANSITIONS } from './post.js';
import { UI } from './ui.js';
import { rng, smoothstep, clamp, lerp, palette, seg } from './util.js';
import * as TL from './timeline.js';

// Reuse GPU buffers when a fat line is re-posed with the same point count (scenes call geometry.setPositions every frame).
// Without this every call allocates fresh buffers; thousands of frames would leak GPU memory in the offline renderer.
{
  const orig = LineSegmentsGeometry.prototype.setPositions;
  LineSegmentsGeometry.prototype.setPositions = function (array) {
    const a = this.attributes.instanceStart;
    if (a && a.data.array.length === array.length) {
      a.data.array.set(array); a.data.needsUpdate = true; this.instanceCount = a.count; return this;
    }
    return orig.call(this, array);
  };
}

const CLEAR = new THREE.Color(palette.void);

const flat = (pts) => {
  if (pts instanceof Float32Array || (typeof pts[0] === 'number')) return Array.from(pts);
  const out = [];
  for (const p of pts) { if (Array.isArray(p)) out.push(p[0], p[1], p[2]); else out.push(p.x, p.y, p.z); }
  return out;
};

const placeholder = (entry) => ({
  init(ctx) {
    ctx.background(palette.void);
    const g = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 2), new THREE.MeshBasicMaterial({ color: palette.blue, wireframe: true, transparent: true, opacity: 0.6 }));
    ctx.scene.add(g); this.g = g;
  },
  update(t, ctx) {
    this.g.rotation.set(t * 0.3, t * 0.5, 0);
    ctx.camera.position.set(0, 0, 6); ctx.camera.lookAt(0, 0, 0);
    ctx.ui.text('ph', `${entry.chapter.zh}<br><span style="font-size:.4em;letter-spacing:.3em">${entry.chapter.en} · ${entry.id} · PLACEHOLDER</span>`, { x: 960, y: 540, size: 120, weight: 700, glow: 20, reveal: clamp(t / 1.2) });
  },
});

class Runtime {
  constructor(engine, entry, def) {
    this.engine = engine; this.entry = entry; this.def = def;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, engine.W / engine.H, 0.05, 500);
    this.post = { ...POST_DEFAULTS };
    this.uiAlpha = 1;
    this.lines = new Set();
    const self = this;
    this.ctx = {
      THREE, scene: this.scene, camera: this.camera, post: this.post, renderer: engine.renderer,
      W: engine.W, H: engine.H, px: engine.W / 1920, aspect: engine.W / engine.H,
      T: 0, t: 0, dur: entry.dur, frame: 0, entry,
      ui: engine.ui.scope(entry.id, () => self.uiAlpha),
      rng,
      background: (hex) => { this.scene.background = new THREE.Color(hex); },
      /** Glowing screen-space-width polyline. points: [[x,y,z]...] | Vector3[] | flat array. width in 1080p px (auto-scaled).
       *  opts: {color, width, opacity, intensity (HDR multiplier), additive=true, dashed, dashSize, gapSize, colors (flat rgb per vertex), depthTest=true} */
      fatLine: (points, o = {}) => {
        const geo = new LineGeometry(); geo.setPositions(flat(points));
        if (o.colors) geo.setColors(o.colors);
        const mat = new LineMaterial({
          color: 0xffffff, linewidth: 2, vertexColors: !!o.colors, transparent: true, opacity: o.opacity ?? 1,
          blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, depthTest: o.depthTest ?? true,
          dashed: !!o.dashed, dashSize: o.dashSize ?? 0.2, gapSize: o.gapSize ?? 0.1, alphaToCoverage: false,
        });
        mat.color.set(o.color ?? palette.cyan).multiplyScalar(o.intensity ?? 1);
        const line = new Line2(geo, mat); if (o.dashed) line.computeLineDistances();
        line.frustumCulled = false; line.userData.width = o.width ?? 2; this.lines.add(line); return line;
      },
      /** Pairs of points -> many separate segments in one draw call. positions: flat [x1,y1,z1,x2,y2,z2,...] */
      fatSegments: (positions, o = {}) => {
        const geo = new LineSegmentsGeometry(); geo.setPositions(flat(positions));
        if (o.colors) geo.setColors(o.colors);
        const mat = new LineMaterial({
          color: 0xffffff, linewidth: 2, vertexColors: !!o.colors, transparent: true, opacity: o.opacity ?? 1,
          blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, depthTest: o.depthTest ?? true,
        });
        mat.color.set(o.color ?? palette.cyan).multiplyScalar(o.intensity ?? 1);
        const line = new LineSegments2(geo, mat); line.frustumCulled = false; line.userData.width = o.width ?? 2; this.lines.add(line); return line;
      },
    };
  }
  async init() { await this.def.init?.(this.ctx); }
  syncLines() {
    const e = this.engine;
    for (const l of this.lines) { l.material.linewidth = (l.userData.width ?? 2) * (e.W / 1920); l.material.resolution.set(e.W, e.H); }
  }
  resize() {
    this.ctx.W = this.engine.W; this.ctx.H = this.engine.H; this.ctx.px = this.engine.W / 1920; this.ctx.aspect = this.engine.W / this.engine.H;
    this.camera.aspect = this.ctx.aspect; this.camera.updateProjectionMatrix();
    this.def.resize?.(this.ctx);
  }
  /** Update + render into rt at local time t. */
  render(t, T, frame, rt) {
    const c = this.ctx;
    Object.assign(this.post, POST_DEFAULTS, { tint: [1, 1, 1], streakColor: [0.45, 0.65, 1.0] });
    c.t = t; c.T = T; c.frame = frame;
    this.camera.aspect = c.aspect;
    this.def.update?.(t, c);
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    this.syncLines();
    const r = this.engine.renderer;
    r.setRenderTarget(rt); r.setClearColor(CLEAR, 1); r.clear(true, true, true);
    r.render(this.scene, this.camera);
  }
}

const mixPost = (a, b, k) => {
  const o = {};
  for (const key of Object.keys(POST_DEFAULTS)) {
    const va = a[key], vb = b[key];
    o[key] = Array.isArray(va) ? va.map((x, i) => lerp(x, vb[i], k)) : lerp(va, vb, k);
  }
  return o;
};

export class Engine {
  constructor({ canvas, textRoot, svgRoot, W = 1920, H = 1080, only = null, chrome = true, rtType = 'half', msaa = 4 }) {
    this.rtType = rtType === 'float' ? THREE.FloatType : rtType === 'byte' ? THREE.UnsignedByteType : THREE.HalfFloatType; this.msaa = msaa;
    this.canvas = canvas; this.W = W; this.H = H; this.only = only; this.chromeOn = chrome;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1); r.setSize(W, H, false);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
    this.ui = new UI(textRoot, svgRoot);
    this.post = new Post(r, W, H, this.rtType);
    this._makeRTs();
    this.runtimes = [];
    this.timeline = TL;
    this.log = [];
  }
  _makeRTs() {
    const mk = () => new THREE.WebGLRenderTarget(this.W, this.H, { type: this.rtType, format: THREE.RGBAFormat, samples: this.msaa, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace });
    this.rtA?.dispose(); this.rtB?.dispose();
    this.rtA = mk(); this.rtB = mk();
  }
  resize(W, H) {
    this.W = W; this.H = H; this.renderer.setSize(W, H, false); this.post.resize(W, H); this._makeRTs();
    for (const rt of this.runtimes) rt.resize();
  }
  async load(onProgress) {
    let entries = TL.scenes.filter((s) => !this.only || s.id === this.only);
    // dev scenes (ids starting with '_', e.g. _example) are not on the timeline: synthesise an entry so they can be previewed solo
    if (this.only && !entries.length && this.only.startsWith('_')) entries = [{ id: this.only, start: 0, dur: 8, chapter: { no: '00', zh: '开发', en: 'DEV' }, transition: { type: 'fade', dur: 0 }, chrome: false, anchors: {} }];
    let i = 0;
    for (const entry of entries) {
      let def;
      try { const mod = await import(`./scenes/${entry.id}.js`); def = mod.default; if (!def) throw new Error('scene module has no default export'); }
      catch (e) { this.log.push(`[engine] scene ${entry.id} failed to load (${e.message}); using placeholder`); console.warn(this.log[this.log.length - 1]); def = placeholder(entry); }
      const rt = new Runtime(this, entry, def);
      await rt.init();
      this.runtimes.push(rt);
      onProgress?.(++i / entries.length, entry.id);
    }
  }

  /** wait for webfont glyph slices requested by the just-rendered frame */
  async settle() {
    void this.ui.textRoot.offsetHeight;
    await document.fonts.ready;
    void this.ui.textRoot.offsetHeight;
    await new Promise((r) => requestAnimationFrame(() => r()));
  }

  _chrome(T, alpha) {
    if (!this.chromeOn || alpha <= 0.001) return;
    const u = this.ui, a = alpha, W = 1920, H = 1080, m = 56, L = 46;
    const col = '#bfe9ff';
    const br = (k, x, y, sx, sy) => u.path('chrome:' + k, `M${x} ${y + sy * L}V${y}H${x + sx * L}`, { stroke: col, width: 2, opacity: 0.4 * a });
    br('tl', m, m, 1, 1); br('tr', W - m, m, -1, 1); br('bl', m, H - m, 1, -1); br('br', W - m, H - m, -1, -1);
    u.text('chrome:brand', 'DIFFERENTIAL GEOMETRY · 微分几何', { x: m + 24, y: m + 18, anchor: 'tl', size: 15, font: 'mono', track: 0.28, color: col, opacity: 0.55 * a, z: 5 });
    const f = Math.floor(T * TL.FPS), ss = Math.floor(T), mm = Math.floor(ss / 60);
    const tc = `${String(mm).padStart(2, '0')}:${String(ss % 60).padStart(2, '0')}:${String(f % TL.FPS).padStart(2, '0')}`;
    u.text('chrome:tc', tc, { x: W - m - 24, y: m + 18, anchor: 'tr', size: 15, font: 'mono', track: 0.2, color: col, opacity: 0.55 * a, z: 5 });
    // progress hairline
    const bw = 220, bx = W - m - 24 - bw, by = H - m - 20, p = clamp(T / TL.TOTAL);
    u.line('chrome:pbg', bx, by, bx + bw, by, { stroke: col, width: 1.5, opacity: 0.25 * a });
    u.line('chrome:pfg', bx, by, bx + bw * p, by, { stroke: '#5ee7ff', width: 2.5, opacity: 0.9 * a, glow: 6 });
    // chapter tag for the scene that owns T
    const sc = TL.scenes.filter((s) => s.start <= T).pop();
    if (sc && sc.chrome) {
      const t = T - sc.start, k = seg(t, 0.4, 1.3) * (1 - seg(t, sc.dur - 0.5, sc.dur + 0.2));
      u.text('chrome:chap', `<span style="font-family:'JetBrains Mono';font-size:15px;letter-spacing:.3em;color:#5ee7ff">${sc.chapter.no} / 08</span><span style="opacity:.5;margin:0 14px">—</span><span style="font-size:22px;font-weight:600;letter-spacing:.18em">${sc.chapter.zh}</span><span style="font-family:'Cormorant Garamond';font-style:italic;font-size:22px;letter-spacing:.16em;margin-left:16px;opacity:.75">${sc.chapter.en}</span>`,
        { x: m + 24, y: H - m - 14, anchor: 'bl', size: 22, color: '#eaf6ff', opacity: 0.95 * k * a, z: 5, reveal: k, revealMode: 'mask' });
    }
  }

  _fade(T) { return smoothstep(0, TL.FADE_IN, T) * (1 - smoothstep(TL.TOTAL - TL.FADE_OUT, TL.TOTAL, T)); }

  /** Render the full timeline at absolute time T (seconds). */
  renderAt(T, { chrome = true, fadeGlobal = true } = {}) {
    T = clamp(T, 0, TL.TOTAL - 1e-6);
    const frame = Math.round(T * TL.FPS);
    this.ui.begin();
    const scenes = TL.scenes, act = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i], nx = scenes[i + 1];
      const end = s.start + s.dur + (nx ? nx.transition.dur : 0);
      if (T >= s.start && T < end + 1e-9) act.push(i);
    }
    const rts = [this.rtA, this.rtB];
    let src, P, chromeAlpha = 1;
    const runtimeOf = (i) => this.runtimes.find((r) => r.entry.id === scenes[i].id);
    if (act.length === 2) {
      const [ia, ib] = act; const A = runtimeOf(ia), B = runtimeOf(ib), tr = scenes[ib].transition;
      const p = clamp((T - scenes[ib].start) / tr.dur);
      if (A && B) {
        A.uiAlpha = 1 - smoothstep(0.0, 0.55, p); B.uiAlpha = smoothstep(0.45, 1.0, p);
        A.render(T - scenes[ia].start, T, frame, rts[0]); B.render(T - scenes[ib].start, T, frame, rts[1]);
        src = this.post.transition(rts[0].texture, rts[1].texture, p, TRANSITIONS[tr.type] ?? 0, frame * 0.01);
        P = mixPost(A.post, B.post, smoothstep(0, 1, p));
        chromeAlpha = (scenes[ia].chrome ? 1 - p : 0) + (scenes[ib].chrome ? p : 0);
      }
    } else if (act.length >= 1) {
      const i = act[0], R = runtimeOf(i);
      if (R) { R.uiAlpha = 1; R.render(T - scenes[i].start, T, frame, rts[0]); src = rts[0].texture; P = R.post; chromeAlpha = scenes[i].chrome ? 1 : 0; }
    }
    if (!src) { this.renderer.setRenderTarget(null); this.renderer.setClearColor(CLEAR); this.renderer.clear(); this.ui.end(); return; }
    this._chrome(T, chrome ? chromeAlpha : 0);
    this.post.finish(src, P, frame, fadeGlobal ? this._fade(T) : 1);
    this.ui.end();
  }

  /** Dev helper: render ONE scene at local time t (no transitions, no global fade). */
  renderSolo(id, t, { chrome = false } = {}) {
    const R = this.runtimes.find((r) => r.entry.id === id);
    if (!R) throw new Error('unknown scene ' + id);
    this.ui.begin();
    R.uiAlpha = 1;
    const T = R.entry.start + t, frame = Math.round(T * TL.FPS);
    R.render(t, T, frame, this.rtA);
    this._chrome(T, chrome ? 1 : 0);
    this.post.finish(this.rtA.texture, R.post, frame, 1);
    this.ui.end();
  }
}
