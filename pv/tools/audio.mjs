// Render the score (src/audio/score.js) offline in headless Chromium -> out/score.wav, then print analysis.
//   node tools/audio.mjs [--out out/score.wav] [--noanalyze]
import { openPV, parseArgs, ROOT } from './lib.mjs';
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process';
const a = parseArgs(); const out = path.resolve(ROOT, a.out || 'out/score.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
const { page, logs, close } = await openPV({ w: 320, h: 180, only: '__none__' });
const t0 = Date.now();
const b64 = await page.evaluate(() => window.PV.renderAudioWav());
const errs = await page.evaluate('window.PV.errors'); if (errs.length || logs.length) console.log('PROBLEMS:\n' + [...new Set([...errs, ...logs])].join('\n'));
await close();
if (!b64) { console.log('NO SCORE MODULE (src/audio/score.js missing or failed)'); process.exit(1); }
fs.writeFileSync(out, Buffer.from(b64, 'base64')); console.log(`wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!a.noanalyze) console.log(execFileSync('python3', [path.join(ROOT, 'tools/audio_analyze.py'), out], { encoding: 'utf8' }));
