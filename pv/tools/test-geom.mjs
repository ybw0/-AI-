import * as G from '../src/geom.js';
const near=(a,b,tol,msg)=>{const ok=Math.abs(a-b)<=tol;console.log((ok?'PASS':'FAIL'),msg,a.toExponential(4),'vs',b.toExponential(4));if(!ok)process.exitCode=1;};
// sphere R=1.7: K=1/R^2, H=1/R (with n=fu×fv orientation => sign may flip; check |H|)
{const s=G.surfaces.sphere(1.7);const fr=G.frame(s.f,1.1,1.3,1e-3);near(fr.K,1/(1.7*1.7),1e-5,'sphere K');near(Math.abs(fr.H),1/1.7,1e-5,'sphere |H|');}
// torus
{const R=1.6,r=0.6,t=G.surfaces.torus(R,r);for(const v of [0.3,1.9,3.5,5.0]){const fr=G.frame(t.f,0.7,v,1e-3);near(fr.K,Math.cos(v)/(r*(R+r*Math.cos(v))),1e-5,`torus K v=${v}`);}}
// catenoid/helicoid isometry: K = -1/cosh^4(v) for all theta
for(const th of [0,0.4,0.9,1.3,Math.PI/2]){const s=G.surfaces.catenoidHelicoid(th);const fr=G.frame(s.f,0.8,0.6,1e-3);near(fr.K,-1/Math.pow(Math.cosh(0.6),4),1e-5,`cat-hel theta=${th.toFixed(2)} K`);near(fr.H,0,1e-5,`cat-hel theta=${th.toFixed(2)} H(minimal)`);}
// pseudosphere K=-1
{const s=G.surfaces.pseudosphere();const fr=G.frame(s.f,1.2,0.5,1e-3);near(fr.K,-1,1e-5,'pseudosphere K');}
// principal dirs on torus: at v=0 (outer equator) e1 should be along either parallel or meridian; check orthogonality and tangency
{const t=G.surfaces.torus();const fr=G.frame(t.f,0.7,0.4,1e-3);near(G.vec.dot(fr.e1,fr.e2),0,1e-6,'e1⟂e2');near(G.vec.dot(fr.e1,fr.n),0,1e-6,'e1⟂n');}
// geodesic on unit sphere = great circle: from equator heading north-east, after arclength pi returns antipodal point
{const s=G.surfaces.sphere(1);const u0=0.3,v0=Math.PI/2;const dir=G.vec.nrm(G.vec.add(G.frame(s.f,u0,v0).fu,[0,1.0,0]));
 const uv0=G.uvVelocity(s.f,u0,v0,dir);const gd=G.geodesic(s.f,u0,v0,uv0[0],uv0[1],{steps:314,ds:Math.PI/314});
 const p0=gd.pts[0],p1=gd.pts[gd.pts.length-1];near(G.vec.len(G.vec.add(p0,p1)),0,2e-3,'sphere geodesic half-circle -> antipode');
 const mid=gd.pts[157];near(G.vec.dot(mid,G.vec.nrm(G.vec.cross(p0,gd.pts[10]))),0,5e-3,'geodesic stays in a plane through origin');}
// geodesic on torus: outer equator (v=0) is a geodesic: heading along u stays at v=0
{const t=G.surfaces.torus(1.6,0.6);const gd=G.geodesic(t.f,0,0,1/(1.6+0.6),0,{steps:200,ds:0.05});near(gd.uv[200][1],0,1e-6,'torus outer-equator geodesic keeps v=0');}
// parallel transport around a small latitude circle on the unit sphere: holonomy angle = 2π(1-cos(colat))
{const s=G.surfaces.sphere(1);const v0=Math.PI/3;const path=(t)=>[t*2*Math.PI,v0];
 const pt=G.parallelTransport(s.f,path,[0,-1/Math.sin(v0)*0+1],{steps:400});// start with vector along fv
 const last=pt[pt.length-1];const first=pt[0];const c=G.vec.dot(G.vec.nrm(first.vec),G.vec.nrm(last.vec));const ang=Math.acos(Math.min(1,c));
 near(ang,2*Math.PI*(1-Math.cos(v0))%(2*Math.PI) > Math.PI ? 2*Math.PI-(2*Math.PI*(1-Math.cos(v0))%(2*Math.PI)):(2*Math.PI*(1-Math.cos(v0))%(2*Math.PI)),2e-3,'parallel transport holonomy = enclosed area (2π(1−cosθ) mod 2π)');}
// Frenet: helix a=1,b=0.3 (r=(cos t, .3t, sin t)) => kappa=a/(a^2+b^2), tau=b/(a^2+b^2)
{const r=G.curves.helix(1,0.3);const fr=G.frenet(r,1.3);near(fr.kappa,1/(1+0.09),1e-5,'helix kappa');near(Math.abs(fr.tau),0.3/(1+0.09),1e-4,'helix |tau|');}
// geometry builder smoke test
{const s=G.surfaces.sphere(1);const g=G.parametricGeometry(s.f,{nu:32,nv:16,...s.dom});console.log('geom verts',g.attributes.position.count,'tris',g.index.count/3,'K@equator',g.attributes.aK.array[8]);
 const bad=[...g.attributes.aK.array].filter(x=>!isFinite(x)).length;console.log('non-finite K count',bad);}
