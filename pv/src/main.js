import { Engine } from './engine.js';
import * as TL from './timeline.js';

const q = new URLSearchParams(location.search);
const RENDER = q.has('render');
const stage = document.getElementById('stage'), overlay = document.getElementById('overlay'), canvas = document.getElementById('gl');
const errors = [];
window.addEventListener('error', (e) => errors.push('error: ' + e.message));
window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && e.reason.stack || e.reason)));
const origErr = console.error; console.error = (...a) => { errors.push('console.error: ' + a.map(String).join(' ')); origErr(...a); };

let W = +q.get('w') || TL.SIZE.w, H = +q.get('h') || TL.SIZE.h;
function layoutFixed(W, H) { stage.style.width = W + 'px'; stage.style.height = H + 'px'; stage.style.transform = 'none'; stage.style.left = '0'; stage.style.top = '0'; overlay.style.transform = `scale(${W / 1920})`; }
function layoutLive() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.width = 1920 * s + 'px'; stage.style.height = 1080 * s + 'px'; overlay.style.transform = `scale(${s})`;
  const w = Math.min(2560, Math.round(1920 * s * dpr)), h = Math.round((w * 9) / 16);
  return [w & ~1, h & ~1];
}

async function preloadFonts() {
  const txt = '微分几何曲线面率测地时空流终章高斯博内定理欧拉示性数弯曲世界丈量不变真理0123456789';
  const specs = ['400', '600', '700', '900'].map((w) => `${w} 40px "Noto Serif SC"`).concat(['italic 400 40px "Cormorant Garamond"', '600 40px "Cormorant Garamond"', '400 40px "JetBrains Mono"', '600 40px "Inter"']);
  await Promise.all(specs.map((s) => document.fonts.load(s, txt).catch(() => {})));
  await document.fonts.ready;
}

const dataUrlToB64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
function wavFromBuffer(ab) {
  const ch = ab.numberOfChannels, n = ab.length, sr = ab.sampleRate, data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => ab.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return data.buffer;
}
async function loadScoreModule() { try { return await import('./audio/score.js'); } catch (e) { console.warn('[audio] no score module:', e.message); return null; } }

async function boot() {
  let liveDims;
  if (RENDER) layoutFixed(W, H); else { liveDims = layoutLive(); [W, H] = liveDims; }
  await preloadFonts();
  const engine = new Engine({ canvas, textRoot: document.getElementById('texts'), svgRoot: document.getElementById('hud'), W, H, only: q.get('only'), chrome: !q.has('nochrome'), rtType: q.get('rt') || (RENDER ? 'float' : 'half'), msaa: q.has('msaa') ? +q.get('msaa') : 4 });
  await engine.load();
  let audioBuf = null;
  const PV = window.PV = {
    engine, TL, errors,
    async renderAt(T, o) { engine.renderAt(T, o); await engine.settle(); engine.renderAt(T, o); await engine.settle(); },
    async renderSolo(id, t, o) { engine.renderSolo(id, t, o); await engine.settle(); engine.renderSolo(id, t, o); await engine.settle(); },
    /** fast path used for bulk rendering: fonts are warm, one render + one settle */
    async frame(T, o) { engine.renderAt(T, o); await engine.settle(); },
    resize(w, h) { W = w; H = h; layoutFixed(w, h); engine.resize(w, h); },
    async renderAudioWav() {
      const m = await loadScoreModule(); if (!m) return null;
      const buf = await m.renderScore(TL, { sampleRate: 48000 });
      return dataUrlToB64(wavFromBuffer(buf));
    },
    info() { const gl = engine.renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return { gl: gl.getParameter(gl.VERSION), gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?', W: engine.W, H: engine.H, scenes: engine.runtimes.map((r) => r.entry.id), log: engine.log }; },
  };
  window.__ready = true;
  if (RENDER) return;

  // ------------------------------------------------ live player
  const cover = document.getElementById('cover'), btn = document.getElementById('play'), bar = document.getElementById('bar');
  cover.style.display = 'flex';
  const mod = await loadScoreModule();
  if (mod) { btn.textContent = '合成配乐中…'; audioBuf = await mod.renderScore(TL, { sampleRate: 44100 }); }
  btn.disabled = false; btn.textContent = '▶ 播放 PLAY';
  let ac = null, srcNode = null, t0 = 0, paused = false, tPaused = 0, playing = false;
  const now = () => (paused ? tPaused : audioBuf ? ac.currentTime - t0 : performance.now() / 1000 - t0);
  const startAt = (from) => {
    if (srcNode) { try { srcNode.stop(); } catch {} srcNode.disconnect(); srcNode = null; }
    if (audioBuf) { srcNode = ac.createBufferSource(); srcNode.buffer = audioBuf; srcNode.connect(ac.destination); srcNode.start(0, from); t0 = ac.currentTime - from; }
    else t0 = performance.now() / 1000 - from;
    paused = false;
  };
  const loop = () => {
    const T = Math.min(now(), TL.TOTAL - 1e-3);
    engine.renderAt(T); bar.style.width = (T / TL.TOTAL) * 100 + '%';
    if (playing) requestAnimationFrame(loop);
  };
  btn.onclick = async () => {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: audioBuf ? audioBuf.sampleRate : 44100 });
    await ac.resume(); cover.style.opacity = 0; setTimeout(() => (cover.style.display = 'none'), 800);
    startAt(0); playing = true; loop();
  };
  window.addEventListener('keydown', (e) => {
    if (!playing) return;
    const T = now();
    if (e.code === 'Space') { e.preventDefault(); if (paused) { startAt(tPaused); } else { tPaused = T; paused = true; if (srcNode) { try { srcNode.stop(); } catch {} } } }
    else if (e.code === 'ArrowRight') startAt(Math.min(TL.TOTAL - 0.1, T + 5));
    else if (e.code === 'ArrowLeft') startAt(Math.max(0, T - 5));
    else if (e.code === 'KeyR') startAt(0);
    else if (e.code === 'KeyF') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const [w, h] = layoutLive(); engine.resize(w, h); }, 150); });
}
boot().catch((e) => { errors.push('boot: ' + (e.stack || e)); console.error(e); window.__bootError = String(e.stack || e); });
