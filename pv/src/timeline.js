// THE single source of truth for timing. Visuals AND music are both built against this file.
// 120 BPM -> 1 beat = 0.5 s, 1 bar = 2 s. Every scene starts on a downbeat.
//
// A scene is alive for local time t in [0, dur + nextTransition.dur]: the outgoing scene keeps rendering during the
// next scene's transition, so scene.update(t) MUST behave for t up to dur + 1.0 (hold / gently continue, never snap).
// `anchors.hero` = local time (s) of the scene's biggest visual moment - the music lands a hit exactly there.
// `anchors.build` = local time the pre-hero tension/riser starts.

export const FPS = 30;
export const SIZE = { w: 1920, h: 1080 };
export const BPM = 120;
export const FADE_IN = 1.2;   // global fade from black at T=0
export const FADE_OUT = 1.6;  // global fade to black at the end

export const scenes = [
  { id: 's00_curve',       start: 0,  dur: 10, chapter: { no: '01', zh: '曲线',       en: 'CURVES' },       transition: { type: 'fade',   dur: 0.0 }, chrome: false, anchors: { build: 2.0, hero: 6.0 } },
  { id: 's01_surface',     start: 10, dur: 10, chapter: { no: '02', zh: '曲面',       en: 'SURFACES' },     transition: { type: 'zoom',   dur: 0.8 }, chrome: true,  anchors: { build: 2.0, hero: 5.0 } },
  { id: 's02_curvature',   start: 20, dur: 12, chapter: { no: '03', zh: '曲率',       en: 'CURVATURE' },    transition: { type: 'flash',  dur: 0.8 }, chrome: true,  anchors: { build: 2.0, hero: 6.0, climax: 10.0 } },
  { id: 's03_geodesic',    start: 32, dur: 10, chapter: { no: '04', zh: '测地线',     en: 'GEODESICS' },    transition: { type: 'iris',   dur: 0.8 }, chrome: true,  anchors: { build: 2.0, hero: 5.0 } },
  { id: 's04_gaussbonnet', start: 42, dur: 10, chapter: { no: '05', zh: '高斯–博内',  en: 'GAUSS–BONNET' }, transition: { type: 'glitch', dur: 0.5 }, chrome: true,  anchors: { build: 2.0, hero: 5.0 } },
  { id: 's05_spacetime',   start: 52, dur: 10, chapter: { no: '06', zh: '时空',       en: 'SPACETIME' },    transition: { type: 'zoom',   dur: 0.8 }, chrome: true,  anchors: { build: 2.0, hero: 6.0 } },
  { id: 's06_ricci',       start: 62, dur: 8,  chapter: { no: '07', zh: 'Ricci 流',   en: 'RICCI FLOW' },   transition: { type: 'dip',    dur: 0.8 }, chrome: true,  anchors: { build: 1.5, hero: 4.0 } },
  { id: 's07_finale',      start: 70, dur: 14, chapter: { no: '08', zh: '终章',       en: 'FINALE' },       transition: { type: 'flash',  dur: 1.0 }, chrome: false, anchors: { build: 0.0, hero: 3.0, end: 12.5 } },
];

export const TOTAL = scenes[scenes.length - 1].start + scenes[scenes.length - 1].dur; // 84 s

/** Absolute time of an anchor: absAnchor('s02_curvature','hero') */
export const absAnchor = (id, name) => { const s = scenes.find((x) => x.id === id); return s.start + s.anchors[name]; };

/** All musical anchors flattened & sorted: [{t, id, name}] (absolute seconds). */
export const allAnchors = () => scenes.flatMap((s) => [{ t: s.start, id: s.id, name: 'start' }, ...Object.entries(s.anchors).map(([name, t]) => ({ t: s.start + t, id: s.id, name }))]).sort((a, b) => a.t - b.t);
