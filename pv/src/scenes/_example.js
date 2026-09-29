// REFERENCE SCENE - shows every engine feature. Copy its structure. Preview: node tools/shot.mjs --scene _example --times 0.5,2,4,6 --sheet
import * as THREE from 'three';
import { seg, ease, pulse, clamp, lerp, palette, orbitCamera, TAU, GLSL } from '../util.js';
import { frenet, curves } from '../geom.js';

const R = curves.helix(1.2, 0.22);          // r(t) -> [x,y,z]
const T0 = -9, T1 = 9, N = 600;

export default {
  init(ctx) {
    ctx.background(palette.void);
    // 1) glowing curve: a pre-built polyline; reveal by changing instanceCount-like draw range via geometry.instanceCount
    const pts = []; for (let i = 0; i <= N; i++) pts.push(R(lerp(T0, T1, i / N)));
    this.line = ctx.fatLine(pts, { color: palette.cyan, width: 3.5, intensity: 2.2 });
    this.halo = ctx.fatLine(pts, { color: palette.blue, width: 14, intensity: 0.35, opacity: 0.6 });
    ctx.scene.add(this.halo, this.line);
    // 2) a glowing head
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.white).multiplyScalar(6) }));
    ctx.scene.add(this.head);
    // 3) Frenet arrows (T red-gold, N cyan, B violet), drawn as fat lines updated per frame
    this.axes = ['T', 'N', 'B'].map((k, i) => { const l = ctx.fatLine([[0, 0, 0], [0, 0, 1]], { color: [palette.gold, palette.cyan, palette.magenta][i], width: 4, intensity: 2.5 }); ctx.scene.add(l); return l; });
    // 4) custom shader plane with HDR output (values >1 bloom)
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec2 vP; uniform float uT; ${GLSL.hash}
        void main(){ vec2 g = abs(fract(vP*0.5)-0.5)/fwidth(vP*0.5); float l = 1.0 - min(min(g.x,g.y),1.0);
          float fade = exp(-length(vP)*0.09); gl_FragColor = vec4(vec3(0.15,0.4,0.9)*l*1.2*fade, l*fade); }`,
    }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -2.2; ctx.scene.add(this.floor);
  },
  update(t, ctx) {
    // ---- everything below is a pure function of t ----
    const grow = seg(t, 0.4, 4.2, ease.inOutCubic);                      // 0..1 progress of the curve being drawn
    const n = Math.max(2, Math.floor(grow * N));
    // reveal the first n segments of the fat line by limiting instanceCount
    this.line.geometry.instanceCount = n; this.halo.geometry.instanceCount = n;
    const tt = lerp(T0, T1, grow), fr = frenet(R, tt);
    this.head.position.set(...fr.p); this.head.scale.setScalar(pulse(t, 0.3, 99, 0.3, 1) * (1 + 0.15 * Math.sin(t * 8)));
    const L = 0.9; [fr.T, fr.N, fr.B].forEach((v, i) => {
      this.axes[i].geometry.setPositions([...fr.p, fr.p[0] + v[0] * L, fr.p[1] + v[1] * L, fr.p[2] + v[2] * L]);
      this.axes[i].visible = grow > 0.02;
    });
    // camera: slow orbit + push in
    orbitCamera(ctx.camera, { target: [0, 0, 0], r: lerp(11, 7.5, ease.outCubic(clamp(t / 6))), az: 0.5 + t * 0.12, el: 0.32 });
    // post: scenes may push these per-frame (reset to defaults every frame)
    ctx.post.bloom = 0.7 + 0.5 * pulse(t, 3.6, 5, 0.3, 1.2); ctx.post.exposure = 1.0;
    // ---- overlay ----
    const ui = ctx.ui;
    ui.text('h', '曲线', { x: 200, y: 200, size: 132, weight: 900, anchor: 'tl', glow: 22, color: '#f4f8ff', reveal: seg(t, 0.6, 1.9, ease.linear) });
    ui.text('s', 'CURVES · FRENET–SERRET FRAME', { x: 206, y: 340, size: 22, font: 'mono', track: 0.32, anchor: 'tl', color: '#5ee7ff', reveal: seg(t, 1.2, 2.2, ease.linear), revealMode: 'mask' });
    ui.tex('f', String.raw`\begin{aligned} \mathbf T' &= \kappa\,\mathbf N \\ \mathbf N' &= -\kappa\,\mathbf T + \tau\,\mathbf B \\ \mathbf B' &= -\tau\,\mathbf N \end{aligned}`,
      { x: 1700, y: 300, size: 46, anchor: 'tr', display: true, color: '#e8f6ff', glow: 10, opacity: seg(t, 2.0, 3.0), reveal: seg(t, 2.0, 3.4, ease.linear), revealMode: 'mask' });
    ui.text('k', `κ = ${fr.kappa.toFixed(3)}<br>τ = ${fr.tau.toFixed(3)}`, { x: 1700, y: 900, size: 30, font: 'mono', anchor: 'br', color: '#ffc861', opacity: seg(t, 2.4, 3.2), align: 'right' });
    ui.path('p', 'M 200 980 C 500 900 700 1040 1000 960 S 1500 900 1720 980', { stroke: '#5ee7ff', width: 2.5, progress: seg(t, 1.0, 5.0), glow: 8, opacity: 0.8 });
  },
};
