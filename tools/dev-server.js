#!/usr/bin/env node
/**
 * Zero-dependency static file server for local play.
 *   npm start          -> http://localhost:5173
 *   npm start -- 8080  -> different port
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.join(root, relative);

  // Never serve anything outside the project directory.
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + relative);
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(data);
  });
}).listen(port, () => {
  console.log(`Raptor Strike dev server: http://localhost:${port}`);
});
