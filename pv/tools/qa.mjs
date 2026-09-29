// Render a whole scene at low-res / low-fps and analyse it for pops, blown-out frames, black frames, luminance jumps.
//   node tools/qa.mjs --scene s02_curvature [--fps 8] [--w 480 --h 270]   (renders t = 0 .. dur+1 ; solo scene, no transitions)
//   node tools/qa.mjs --full [--fps 4]                                    (whole timeline incl. transitions)
// Writes out/qa/<name>/analysis.png (+ .json) and prints a summary. Then LOOK at analysis.png and a few frames.
import { openPV, parseArgs, ROOT } from './lib.mjs';
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process';
const a = parseArgs(); const w = +(a.w || 480), h = +(a.h || 270), fps = +(a.fps || 8);
const name = a.full ? 'full' : a.scene; const out = path.resolve(ROOT, 'out/qa', name);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const { page, logs, close } = await openPV({ w, h, only: a.full ? null : a.scene });
const TL = await page.evaluate('({scenes: window.PV.TL.scenes, TOTAL: window.PV.TL.TOTAL})');
let dur, id;
if (!a.full) { const s = await page.evaluate((id) => window.PV.engine.runtimes.find((r) => r.entry.id === id).entry, a.scene); dur = s.dur + 1.0; id = s.id; } else dur = TL.TOTAL;
const n = Math.floor(dur * fps); const t0 = Date.now();
for (let i = 0; i < n; i++) {
  const t = i / fps;
  if (a.full) await page.evaluate((T) => window.PV.frame(T), t); else await page.evaluate(([id, tt]) => window.PV.renderSolo(id, tt), [id, t]);
  await page.screenshot({ path: path.join(out, `f_${String(i).padStart(4, '0')}.png`), type: 'png' });
}
console.log(`rendered ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const errs = await page.evaluate('window.PV.errors'); if (logs.length || errs.length) console.log('PROBLEMS:\n' + [...new Set([...logs, ...errs])].slice(0, 20).join('\n'));
await close();
console.log(execFileSync('python3', [path.join(ROOT, 'tools/analyze.py'), out, String(fps)]).toString());
console.log('plot ->', path.relative(ROOT, path.join(out, 'analysis.png')));
