// Render still frames of a scene (or the full timeline) so you can LOOK at them (use the Read tool on the PNGs).
//   node tools/shot.mjs --scene s01_surface --times 0,1,2.5,5,9 [--w 960 --h 540] [--out out/dev/s01] [--chrome] [--sheet]
//   node tools/shot.mjs --T 12.5,30,44 [--w 960 --h 540]        (absolute timeline time: includes transitions, global fade, HUD chrome)
// Prints per-frame render time (SwiftShader software GL, so times are pessimistic) and any console errors/warnings.
import { openPV, parseArgs, ROOT } from './lib.mjs';
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process';
const a = parseArgs();
const w = +(a.w || 960), h = +(a.h || 540);
const scene = a.scene || null;
const times = String(a.times || a.T || '0').split(',').map(Number);
const out = path.resolve(ROOT, a.out || (scene ? `out/dev/${scene}` : 'out/dev/full'));
fs.mkdirSync(out, { recursive: true });
// fail fast on syntax errors in the scene file (the browser only reports a vague 'failed to fetch module')
if (scene) { try { execFileSync('node', ['--check', path.join(ROOT, 'src/scenes', scene + '.js')], { stdio: 'pipe' }); } catch (e) { console.log('SYNTAX ERROR in scene file:\n' + (e.stderr || e.message)); process.exit(2); } }
const { page, logs, close } = await openPV({ w, h, only: a.T ? null : scene, nochrome: false });
const files = [];
let failed = false;
for (const t of times) {
  const t0 = Date.now();
  try {
    if (a.T) await page.evaluate(([T]) => window.PV.renderAt(T), [t]);
    else await page.evaluate(([id, tt, chrome]) => window.PV.renderSolo(id, tt, { chrome }), [scene, t, !!a.chrome]);
  } catch (e) { console.log('RENDER ERROR at', t, e.message); failed = true; continue; }
  const ms = Date.now() - t0;
  const f = path.join(out, `${scene || 'T'}_${String(t).replace('.', '_').padStart(5, '0')}.png`);
  await page.screenshot({ path: f, type: 'png' });
  files.push(f);
  console.log(`t=${t}  render ${ms} ms  -> ${path.relative(ROOT, f)}`);
}
const errs = await page.evaluate('window.PV.errors');
const info = await page.evaluate('window.PV.info()');
if (info.log.length) { console.log('ENGINE LOG:', info.log.join('\n')); if (scene && info.log.some((l) => l.includes(scene))) { console.log('!! SCENE FAILED TO LOAD - a placeholder was rendered instead. Check the console problems below and the file for import/runtime errors.'); failed = true; } }
if (logs.length || errs.length) { console.log('--- console/page problems ---'); console.log([...new Set([...logs, ...errs])].slice(0, 30).join('\n')); failed = failed || errs.length > 0; }
else console.log('no console errors');
if (a.sheet && files.length) {
  const sheet = path.join(out, `${scene || 'T'}_sheet.png`);
  execFileSync('python3', [path.join(ROOT, 'tools/sheet.py'), sheet, String(a.cols || 3), ...files.flatMap((f, i) => [f, 't=' + times[i]])]);
  console.log('contact sheet ->', path.relative(ROOT, sheet));
}
await close();
process.exit(failed ? 1 : 0);
