// Final renderer: deterministic frame capture in N parallel Chromium workers -> x264 chunks -> concat (+ audio mux).
//   node tools/render.mjs --w 1920 --h 1080 --fps 30 --workers 2 --crf 16 --preset slow --out out/pv.mp4 [--audio out/score.wav] [--from 0 --to 84]
import { openPV, parseArgs, ffmpegPath, ROOT } from './lib.mjs';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs'; import path from 'path';
const a = parseArgs();
const W = +(a.w || 1920), H = +(a.h || 1080), FPS = +(a.fps || 30), WORKERS = +(a.workers || 2), CRF = String(a.crf || 16), PRESET = a.preset || 'slow';
const outFile = path.resolve(ROOT, a.out || 'out/pv.mp4');
const FF = ffmpegPath();
const tmp = path.resolve(ROOT, 'out/render-tmp'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
const probe = await openPV({ w: 320, h: 180, only: null });
const TOTAL = await probe.page.evaluate('window.PV.TL.TOTAL'); await probe.close();
const from = +(a.from ?? 0), to = +(a.to ?? TOTAL);
const f0 = Math.round(from * FPS), f1 = Math.round(to * FPS), N = f1 - f0;
const per = Math.ceil(N / WORKERS);
console.log(`render ${W}x${H}@${FPS} frames ${f0}..${f1} (${N}) with ${WORKERS} workers, crf ${CRF} ${PRESET}`);
const t0 = Date.now(); let done = 0;
const tick = () => { const el = (Date.now() - t0) / 1000, rate = done / el; console.log(`[${done}/${N}] ${(done / N * 100).toFixed(1)}%  ${rate.toFixed(2)} fps  elapsed ${el.toFixed(0)}s  eta ${((N - done) / Math.max(rate, 1e-6)).toFixed(0)}s`); };
async function worker(k) {
  const s = f0 + k * per, e = Math.min(f1, s + per); if (s >= e) return null;
  const chunk = path.join(tmp, `chunk_${String(k).padStart(2, '0')}.mp4`);
  const { page, close } = await openPV({ w: W, h: H });
  const cdp = await page.context().newCDPSession(page);
  const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-tune', 'grain', '-g', String(FPS * 2), '-bf', '2',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', chunk], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res) => ff.on('close', res));
  for (let f = s; f < e; f++) {
    const T = f / FPS;
    await page.evaluate((T) => window.PV.frame(T), T);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 100 });
    const buf = Buffer.from(data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    done++; if (done % 30 === 0) tick();
  }
  ff.stdin.end(); await ffDone;
  const errs = await page.evaluate('window.PV.errors'); if (errs.length) console.log(`worker ${k} page errors:`, [...new Set(errs)].slice(0, 5));
  await close(); return chunk;
}
const chunks = (await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k)))).filter(Boolean);
const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, chunks.map((c) => `file '${c}'`).join('\n'));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
if (a.audio && fs.existsSync(path.resolve(ROOT, a.audio))) args.push('-i', path.resolve(ROOT, a.audio), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest'); else args.push('-c', 'copy');
args.push('-movflags', '+faststart', outFile);
execFileSync(FF, args, { stdio: 'inherit' });
const sz = fs.statSync(outFile).size; console.log(`DONE ${path.relative(ROOT, outFile)}  ${(sz / 1048576).toFixed(1)} MB  in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
