// Shared helpers for dev tools: launch headless Chromium (SwiftShader WebGL2) pointed at the local static server.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { execSync } from 'child_process';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { return execSync(`python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`).toString().trim(); } catch { return 'ffmpeg'; }
}
export function parseArgs(argv = process.argv.slice(2)) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) o[k] = true; else { o[k] = nx; i++; } }
  }
  return o;
}
/** open a page with the PV app in render mode. opts: {w,h,only,nochrome} */
export async function openPV({ w = 1920, h = 1080, only = null, nochrome = false, verbose = false, extra = {} } = {}) {
  const { port, close } = await serve();
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--autoplay-policy=no-user-gesture-required', '--enable-features=SharedArrayBuffer'],
  });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning' || verbose) logs.push(`[${t}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  const qs = new URLSearchParams({ render: '1', w: String(w), h: String(h) }); if (only) qs.set('only', only); if (nochrome) qs.set('nochrome', '1'); for (const [k, v] of Object.entries(extra)) qs.set(k, String(v));
  await page.goto(`http://localhost:${port}/index.html?${qs}`);
  await page.waitForFunction('window.__ready || window.__bootError', null, { timeout: 180000 });
  const bootErr = await page.evaluate('window.__bootError || null');
  if (bootErr) throw new Error('boot error: ' + bootErr + '\n' + logs.join('\n'));
  return { page, logs, port, async close() { await browser.close(); close(); } };
}
