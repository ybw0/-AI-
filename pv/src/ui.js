// Deterministic overlay layer: text, KaTeX formulas and SVG HUD shapes.
// Design space is ALWAYS 1920x1080 logical px (the layer is CSS-scaled to the real output size).
// Everything is IMMEDIATE MODE: call ui.text(key, ...) every frame you want it visible; anything not touched in a frame is hidden.
import katex from 'katex';

const FONTS = {
  serif: `'Noto Serif SC', 'Noto Serif', 'Cormorant Garamond', serif`,   // Noto Serif supplies Greek (κ τ) that Noto Serif SC lacks
  en: `'Cormorant Garamond', 'Noto Serif', 'Noto Serif SC', serif`,           // elegant italic/roman Latin
  sans: `'Inter', 'Noto Serif SC', sans-serif`,
  mono: `'JetBrains Mono', 'Noto Serif SC', monospace`,
};
const cssColor = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c);
const ANCH = { l: 0, c: 50, r: 100, t: 0, b: 100 };
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function wrapChars(root) {
  const spans = [];
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const ch of Array.from(child.textContent)) {
          const s = document.createElement('span');
          s.className = 'ch'; s.textContent = ch; s.style.display = 'inline-block'; s.style.whiteSpace = 'pre';
          frag.appendChild(s); spans.push(s);
        }
        node.replaceChild(frag, child);
      } else if (child.nodeType === 1) walk(child);
    }
  };
  walk(root);
  return spans;
}

export class UI {
  constructor(textRoot, svgRoot) {
    this.textRoot = textRoot; this.svg = svgRoot;
    this.els = new Map(); this.used = new Set(); this.texCache = new Map();
  }
  begin() { this.used.clear(); }
  end() {
    for (const [k, e] of this.els) if (!this.used.has(k) && e.visible) { e.node.style.display = 'none'; e.visible = false; }
  }
  /** Returns a view of this UI whose keys are namespaced and whose opacities are multiplied by alpha() */
  scope(prefix, alpha = () => 1) {
    const s = (k) => prefix + ':' + k;
    const wrap = (o) => ({ ...o, opacity: (o && o.opacity !== undefined ? o.opacity : 1) * alpha() });
    return {
      text: (k, html, o = {}) => this.text(s(k), html, wrap(o)),
      tex: (k, latex, o = {}) => this.tex(s(k), latex, wrap(o)),
      path: (k, d, o = {}) => this.path(s(k), d, wrap(o)),
      line: (k, x1, y1, x2, y2, o = {}) => this.line(s(k), x1, y1, x2, y2, wrap(o)),
      rect: (k, x, y, w, h, o = {}) => this.rect(s(k), x, y, w, h, wrap(o)),
      circle: (k, cx, cy, r, o = {}) => this.circle(s(k), cx, cy, r, wrap(o)),
    };
  }

  _text(key, kind) {
    let e = this.els.get(key);
    if (!e) {
      const node = document.createElement('div');
      node.className = 'ui-el ui-' + kind;
      this.textRoot.appendChild(node);
      e = { node, kind, visible: false, html: null, chars: null };
      this.els.set(key, e);
    }
    this.used.add(key);
    return e;
  }

  _style(e, o) {
    const n = e.node;
    const size = o.size ?? 48;
    const ax = ANCH[(o.anchor || 'cc')[1]] ?? 50, ay = ANCH[(o.anchor || 'cc')[0]] ?? 50;
    const opacity = o.opacity ?? 1;
    if (opacity <= 0.001) { if (e.visible) { n.style.display = 'none'; e.visible = false; } return false; }
    if (!e.visible) { n.style.display = 'block'; e.visible = true; }
    const st = n.style;
    st.opacity = opacity.toFixed(4);
    st.fontSize = size + 'px';
    st.fontFamily = FONTS[o.font || 'serif'] || o.font;
    st.fontWeight = o.weight ?? 400;
    st.fontStyle = o.italic ? 'italic' : 'normal';
    st.color = cssColor(o.color ?? '#f4f8ff');
    st.letterSpacing = (o.track ?? 0) + 'em';
    st.lineHeight = o.lh ?? 1.25;
    st.textAlign = o.align || (ax === 0 ? 'left' : ax === 100 ? 'right' : 'center');
    st.width = o.width ? o.width + 'px' : 'max-content';
    st.textTransform = o.upper ? 'uppercase' : 'none';
    st.mixBlendMode = o.mix || 'normal';
    st.zIndex = o.z ?? 1;
    const g = o.glow;
    const gcol = cssColor((g && g.color) ?? o.color ?? '#5ee7ff');
    const gr = typeof g === 'number' ? g : g ? g.r : 0;
    st.textShadow = o.shadow || (gr ? `0 0 ${gr * 0.5}px ${gcol}, 0 0 ${gr}px ${gcol}, 0 0 ${gr * 2}px ${gcol}66` : 'none');
    st.webkitTextStroke = o.stroke ? `${o.stroke}px ${cssColor(o.strokeColor ?? o.color ?? '#fff')}` : '0';
    if (o.stroke && o.hollow) st.color = 'transparent';
    st.filter = o.blur ? `blur(${o.blur}px)` : 'none';
    st.transformOrigin = `${ax}% ${ay}%`;
    st.transform = `translate(${(o.x ?? 960) + (o.dx || 0)}px, ${(o.y ?? 540) + (o.dy || 0)}px) translate(${-ax}%, ${-ay}%) rotate(${o.rot || 0}deg) scale(${o.scale ?? 1})`;
    return true;
  }

  /** text(key, html, {x,y,anchor:'cc'|'tl'|..., size, weight, font:'serif'|'en'|'sans'|'mono', color, opacity, track(em), lh, glow:px|{r,color}, blur, scale, rot,
   *        align, width, reveal:0..1, revealMode:'chars'|'mask'|'none', spread, upper, italic, stroke, hollow, mix:'screen'|'plus-lighter', z}) */
  text(key, html, o = {}) {
    const e = this._text(key, 'text');
    if (e.html !== html) {
      e.html = html; e.node.innerHTML = html; e.chars = null;
      if ((o.revealMode || 'chars') === 'chars' && o.reveal !== undefined) e.chars = wrapChars(e.node);
    }
    if (o.reveal !== undefined && (o.revealMode || 'chars') === 'chars' && !e.chars) e.chars = wrapChars(e.node);
    if (!this._style(e, o)) return;
    this._reveal(e, o);
  }

  /** tex(key, latexString, opts same as text). Rendered with KaTeX (cached). opts.display = true for display style. */
  tex(key, latex, o = {}) {
    const e = this._text(key, 'tex');
    const ck = (o.display ? 'D:' : 'I:') + latex;
    if (e.html !== ck) {
      let html = this.texCache.get(ck);
      if (!html) { html = katex.renderToString(latex, { throwOnError: false, displayMode: !!o.display, strict: false, output: 'html' }); this.texCache.set(ck, html); }
      e.html = ck; e.node.innerHTML = html; e.chars = null;
    }
    if (!this._style(e, { font: 'serif', ...o })) return;
    e.node.style.fontFamily = '';   // KaTeX supplies its own fonts
    this._reveal(e, { ...o, revealMode: o.revealMode === 'chars' ? 'mask' : o.revealMode });
  }

  _reveal(e, o) {
    const r = o.reveal;
    const n = e.node;
    if (r === undefined || r >= 1) {
      if (e.chars) for (const s of e.chars) { s.style.opacity = ''; s.style.transform = ''; s.style.filter = ''; }
      n.style.clipPath = 'none';
      return;
    }
    const mode = o.revealMode || 'chars';
    if (mode === 'mask') {
      n.style.clipPath = `inset(-20% ${((1 - clamp01(r)) * 100).toFixed(2)}% -20% 0)`;
    } else if (mode === 'chars' && e.chars) {
      const cnt = e.chars.length, sp = o.spread ?? 0.6;
      for (let i = 0; i < cnt; i++) {
        const p = clamp01(r * (1 + sp) - (sp * i) / Math.max(1, cnt - 1));
        const k = easeOutCubic(p);
        const s = e.chars[i].style;
        s.opacity = k.toFixed(3);
        s.transform = `translateY(${((1 - k) * 0.35).toFixed(3)}em)`;
        s.filter = p < 1 ? `blur(${((1 - k) * 10).toFixed(2)}px)` : '';
      }
    } else if (mode === 'fade') {
      n.style.opacity = (parseFloat(n.style.opacity) * clamp01(r)).toFixed(4);
    }
  }

  // ------------------------------------------------------------------ SVG HUD shapes (viewBox 0 0 1920 1080)
  _shape(key, tag) {
    let e = this.els.get(key);
    if (!e) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      this.svg.appendChild(node);
      e = { node, kind: tag, visible: false };
      this.els.set(key, e);
    }
    this.used.add(key);
    return e;
  }
  _sstyle(e, o) {
    const n = e.node, opacity = o.opacity ?? 1;
    if (opacity <= 0.001) { if (e.visible) { n.style.display = 'none'; e.visible = false; } return false; }
    if (!e.visible) { n.style.display = 'block'; e.visible = true; }
    n.setAttribute('stroke', cssColor(o.stroke ?? '#5ee7ff'));
    n.setAttribute('stroke-width', o.width ?? 2);
    n.setAttribute('fill', o.fill === undefined ? 'none' : cssColor(o.fill));
    n.setAttribute('stroke-linecap', o.cap || 'round');
    n.setAttribute('stroke-linejoin', 'round');
    n.style.opacity = opacity.toFixed(4);
    const gl = o.glow;
    n.style.filter = gl ? `drop-shadow(0 0 ${gl}px ${cssColor(o.glowColor ?? o.stroke ?? '#5ee7ff')})` : 'none';
    if (o.x || o.y || o.scale || o.rot) n.setAttribute('transform', `translate(${o.x || 0} ${o.y || 0}) rotate(${o.rot || 0}) scale(${o.scale ?? 1})`); else n.removeAttribute('transform');
    if (o.progress !== undefined || o.dash) {
      n.setAttribute('pathLength', '1');
      if (o.dash) { n.setAttribute('stroke-dasharray', o.dash.join(' ')); n.setAttribute('stroke-dashoffset', 0); }
      else { const p = clamp01(o.progress); n.setAttribute('stroke-dasharray', '1 1'); n.setAttribute('stroke-dashoffset', (1 - p).toFixed(5)); if (p <= 0) n.style.display = 'none'; }
    } else { n.removeAttribute('stroke-dasharray'); n.removeAttribute('stroke-dashoffset'); }
    return true;
  }
  /** path(key, 'M0 0 L...', {stroke, width, fill, opacity, progress:0..1 (draw-on), dash:[a,b], glow:px, glowColor, x,y,scale,rot}) */
  path(key, d, o = {}) { const e = this._shape(key, 'path'); if (e.d !== d) { e.node.setAttribute('d', d); e.d = d; } this._sstyle(e, o); }
  line(key, x1, y1, x2, y2, o = {}) { this.path(key, `M${x1} ${y1}L${x2} ${y2}`, o); }
  rect(key, x, y, w, h, o = {}) { this.path(key, `M${x} ${y}h${w}v${h}h${-w}Z`, o); }
  circle(key, cx, cy, r, o = {}) { this.path(key, `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`, o); }
}
