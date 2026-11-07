// Minimal static file server with ETags and cached brotli/gzip compression, so the
// whole game (three.js included) reaches a phone in a couple of hundred kilobytes.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.txt']);

/**
 * @param {{prefix: string, dir: string, cache?: string}[]} mounts URL prefix -> directory,
 *   checked in order (put longer prefixes first).
 */
export function createStaticHandler(mounts, { headers: extraHeaders = {} } = {}) {
  const roots = mounts.map((m) => ({ ...m, dir: path.resolve(m.dir) }));
  const cache = new Map();

  const notFound = (res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders });
    res.end('Not found');
  };

  return async function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname.includes('\0')) return notFound(res);
    const mount = roots.find((m) => pathname.startsWith(m.prefix));
    if (!mount) return notFound(res);
    let rel = pathname.slice(mount.prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const abs = path.resolve(mount.dir, rel);
    if (!abs.startsWith(mount.dir + path.sep)) return notFound(res);

    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      return notFound(res);
    }
    if (!stat.isFile()) return notFound(res);

    const ext = path.extname(abs).toLowerCase();
    let entry = cache.get(abs);
    if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
      const raw = await fsp.readFile(abs);
      entry = { mtimeMs: stat.mtimeMs, size: stat.size, raw, etag: `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"` };
      if (COMPRESSIBLE.has(ext) && raw.length > 1024) {
        entry.br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
        entry.gz = zlib.gzipSync(raw, { level: 9 });
      }
      cache.set(abs, entry);
    }

    const accept = String(req.headers['accept-encoding'] || '');
    let body = entry.raw;
    let encoding = null;
    if (entry.br && /\bbr\b/.test(accept)) {
      body = entry.br;
      encoding = 'br';
    } else if (entry.gz && /\bgzip\b/.test(accept)) {
      body = entry.gz;
      encoding = 'gzip';
    }
    const etag = encoding ? `${entry.etag.slice(0, -1)}-${encoding}"` : entry.etag;
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      ETag: etag,
      Vary: 'Accept-Encoding',
      'Cache-Control': mount.cache || 'no-cache',
      ...extraHeaders,
    };
    if (encoding) headers['Content-Encoding'] = encoding;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
