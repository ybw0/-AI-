// Tiny static server (used by the dev tools). Usage: import {serve} from './serve.mjs'; const {port, close} = await serve();
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };
export function serve(port = 0) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
      fs.readFile(p, (e, d) => {
        if (e) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(d);
      });
    }).listen(port, () => resolve({ port: srv.address().port, close: () => srv.close() }));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const { port } = await serve(+process.argv[2] || 8080); console.log('http://localhost:' + port + '/index.html'); }
