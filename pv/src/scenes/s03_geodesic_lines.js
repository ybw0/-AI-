// Helpers for s03_geodesic: a single-draw-call glowing segment renderer whose brightness is a function of *arclength behind a moving head*
// (so 50 geodesics grow, glow and carry light pulses with no per-frame geometry work), plus a soft round point-sprite cloud for heads / dust.
import * as THREE from 'three';

/**
 * Instanced screen-space-width segments.  Each instance = one segment A->B with an arclength coordinate aS, colour aC, id aId.
 * Visible where uS >= aS; brightness = base + tail*exp(-age/uTail) + head*exp(-age/uHeadLen) + pulses(beads running along the line).
 * Call seg.put(i, A, B, s, [r,g,b], id) then seg.commit(n). Uniforms live in seg.U.
 */
export function makeSegs(ctx, { count, depthTest = true, order = 3, ds = 0.04, dynamic = false } = {}) {
  const base = new THREE.InstancedBufferGeometry();
  base.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
  base.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // dummy (three wants 'position')
  base.setIndex([0, 1, 2, 2, 1, 3]);
  const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(count * n), n);
  const aA = mk(3), aB = mk(3), aC = mk(3), aS = mk(1), aId = mk(1);
  if (dynamic) { aA.setUsage(THREE.DynamicDrawUsage); aB.setUsage(THREE.DynamicDrawUsage); aC.setUsage(THREE.DynamicDrawUsage); aS.setUsage(THREE.DynamicDrawUsage); }
  base.setAttribute('aA', aA); base.setAttribute('aB', aB); base.setAttribute('aC', aC); base.setAttribute('aS', aS); base.setAttribute('aId', aId);
  base.instanceCount = 0;
  const U = (v) => ({ value: v });
  const U_ = {
    uRes: U(new THREE.Vector2(ctx.W, ctx.H)), uWidth: U(4), uDs: U(ds), uS: U(0), uTail: U(1.5), uHeadLen: U(0.3), uBase: U(0.3), uTailI: U(1.0), uHeadI: U(4.0),
    uPulse: U(0), uT: U(0), uOp: U(1), uCore: U(3.0), uBeadF: U(0.28),
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: U_,
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute vec3 aA, aB, aC; attribute float aS, aId;
      uniform vec2 uRes; uniform float uWidth, uDs, uS;
      varying vec3 vC; varying float vS, vX, vId, vLive;
      void main(){
        mat4 mvp = projectionMatrix*modelViewMatrix;
        vec4 ca = mvp*vec4(aA,1.0), cb = mvp*vec4(aB,1.0);
        vec2 sa = ca.xy/ca.w*0.5*uRes, sb = cb.xy/cb.w*0.5*uRes;
        vec2 d = sb - sa; float l = length(d); d = l > 1e-4 ? d/l : vec2(1.0,0.0);
        vec2 n = vec2(-d.y, d.x);
        float hw = uWidth*0.5;
        vec2 sp = mix(sa, sb, corner.x) + n*corner.y*hw;
        vec4 c = mix(ca, cb, corner.x);
        gl_Position = vec4(sp/(0.5*uRes)*c.w, c.z, c.w);
        vC = aC; vS = aS + uDs*corner.x; vX = corner.y; vId = aId; vLive = step(aS, uS);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vS, vX, vId, vLive;
      uniform float uS, uTail, uHeadLen, uBase, uTailI, uHeadI, uPulse, uT, uOp, uCore, uBeadF;
      void main(){
        if(vLive < 0.5) discard;
        float age = max(uS - vS, 0.0);
        float core = exp(-vX*vX*uCore);
        float beads = pow(0.5 + 0.5*sin(6.28318530718*(vS*uBeadF - uT*0.55 + vId*7.31)), 10.0);
        float k = uBase + uTailI*exp(-age/uTail) + uHeadI*exp(-age/uHeadLen) + uPulse*beads;
        gl_FragColor = vec4(vC*k*core*uOp, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(base, mat);
  mesh.frustumCulled = false; mesh.renderOrder = order;
  mesh.U = U_;
  mesh.put = (i, A, B, s, col, id = 0) => {
    aA.setXYZ(i, A[0], A[1], A[2]); aB.setXYZ(i, B[0], B[1], B[2]); aS.setX(i, s); aC.setXYZ(i, col[0], col[1], col[2]); aId.setX(i, id);
  };
  mesh.commit = (n) => { base.instanceCount = n; for (const a of [aA, aB, aC, aS, aId]) a.needsUpdate = true; };
  mesh.sync = (t, ctx2, widthPx) => { U_.uRes.value.set(ctx2.W, ctx2.H); U_.uWidth.value = widthPx * ctx2.px; U_.uT.value = t; };
  return mesh;
}

/** Soft round HDR points (heads, dust). setup: pts.put(i, [x,y,z], [r,g,b], sizePx). Positions/colours may be rewritten each frame (dynamic). */
export function makePoints(ctx, { count, dynamic = true, order = 5, depthTest = false } = {}) {
  const g = new THREE.BufferGeometry();
  const P = new THREE.BufferAttribute(new Float32Array(count * 3), 3), C = new THREE.BufferAttribute(new Float32Array(count * 3), 3), S = new THREE.BufferAttribute(new Float32Array(count), 1);
  if (dynamic) { P.setUsage(THREE.DynamicDrawUsage); C.setUsage(THREE.DynamicDrawUsage); S.setUsage(THREE.DynamicDrawUsage); }
  g.setAttribute('position', P); g.setAttribute('color', C); g.setAttribute('aSize', S);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uPx: { value: ctx.px }, uOp: { value: 1 } },
    vertexShader: `attribute float aSize; uniform float uPx; varying vec3 vC; void main(){ vC = color; gl_PointSize = aSize*uPx; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vC; uniform float uOp; void main(){ vec2 p = gl_PointCoord-0.5; float d = length(p)*2.0; float a = smoothstep(1.0,0.0,d); float core = exp(-d*d*9.0); gl_FragColor = vec4(vC*(a*a*0.7 + core*1.6)*uOp, 1.0); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = order;
  pts.put = (i, p, c, s) => { P.setXYZ(i, p[0], p[1], p[2]); C.setXYZ(i, c[0], c[1], c[2]); S.setX(i, s); };
  pts.commit = (n) => { g.setDrawRange(0, n); P.needsUpdate = true; C.needsUpdate = true; S.needsUpdate = true; };
  return pts;
}
