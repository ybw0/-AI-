// Kit demo / visual regression scene: torus with curvature colouring, backdrop, stars, arrow, title, caption, formula.
import * as THREE from 'three';
import { seg, ease, palette, orbitCamera, lerp, clamp, TAU } from '../util.js';
import { parametricGeometry, surfaces } from '../geom.js';
import * as kit from '../kit.js';

export default {
  init(ctx) {
    ctx.background(palette.void);
    this.bd = kit.backdrop(ctx, { seed: 5 }); ctx.scene.add(this.bd);
    this.stars = kit.starfield(ctx, { count: 2200 }); ctx.scene.add(this.stars);
    const S = surfaces.torus(1.7, 0.7);
    this.geo = parametricGeometry(S.f, { nu: 160, nv: 80, ...S.dom });
    this.mat = kit.surfaceMaterial({ curv: 1, kScale: 1 / 1.2, grid: [40, 20], gridI: 0.8, rim: 1.4 });
    this.mesh = new THREE.Mesh(this.geo, this.mat); ctx.scene.add(this.mesh);
    this.arrow = kit.arrow(ctx, { color: palette.gold }); ctx.scene.add(this.arrow);
    this.S = S;
  },
  update(t, ctx) {
    this.mat.uniforms.uReveal.value = seg(t, 0.2, 2.6, ease.inOutCubic) * 1.02;
    this.mat.uniforms.uCurv.value = seg(t, 2.6, 4.2);
    this.mat.uniforms.uTime.value = t;
    this.mesh.rotation.y = t * 0.12;
    kit.updateStars(this.stars, t); this.bd.rotation.y = t * 0.01;
    const u = t * 0.6, v = 0.2; const p = this.S.f(u, v); this.arrow.set([p[0], p[1], p[2]], [Math.cos(u), 0.3, Math.sin(u)], 0.8);
    orbitCamera(ctx.camera, { r: lerp(10, 7.2, ease.outCubic(clamp(t / 6))), az: 0.4 + t * 0.1, el: 0.5 });
    ctx.post.bloom = 0.6;
    kit.chapterTitle(ctx.ui, t, { at: 0.5, hold: 3.5, zh: '曲率', en: 'Curvature', kicker: 'CHAPTER 03', sub: '弯曲,可以被精确地度量' });
    kit.caption(ctx.ui, t, { at: 3.0, dur: 3.2, zh: '在每一点,弯曲都有一个数字', en: 'At every point, curvature is a number' });
    kit.formula(ctx.ui, t, 'kf', String.raw`K=\kappa_1\kappa_2=\frac{LN-M^2}{EG-F^2}`, { at: 2.6, dur: 4, x: 1650, y: 300, size: 52, anchor: 'tr' });
  },
};
