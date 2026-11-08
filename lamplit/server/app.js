// HTTP + WebSocket wiring around HallManager. `startServer` is used by both the CLI
// entry point (index.js) and the integration tests.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { HallManager } from './halls.js';
import { createStaticHandler } from './static.js';
import { TokenBucket } from './rate-limit.js';
import { openDb } from './db.js';
import { ProfileService } from './profiles.js';
import { createApi } from './api.js';
import { sanitizeClientMessage, PROTOCOL, MAX_MESSAGE_BYTES } from '../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Drop a socket whose unsent backlog grows past this (a client that stopped reading). */
const MAX_BUFFERED = 1 << 20;
const HEARTBEAT_MS = 25_000;
const HELLO_TIMEOUT_MS = 10_000;

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self' ws: wss:; media-src 'self' blob: data:; font-src 'self'; object-src 'none'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function startServer(cfg, { log = console.log, now } = {}) {
  if (cfg.dbPath !== ':memory:') fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  const db = openDb(cfg.dbPath);
  const profiles = new ProfileService(db, { startLumens: cfg.startLumens });
  const manager = new HallManager({
    profiles,
    capacity: cfg.hallCapacity,
    maxHalls: cfg.maxHalls,
    maxQueue: cfg.maxQueue,
    ...(now ? { now } : {}),
  });
  const api = createApi(profiles, cfg, now);
  const purge = setInterval(() => db.purgeTokens(Date.now()), 6 * 3600_000);
  purge.unref();

  const serveStatic = createStaticHandler(
    [
      { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
      { prefix: '/vendor/', dir: path.join(ROOT, 'client', 'vendor'), cache: 'public, max-age=86400' },
      { prefix: '/', dir: path.join(ROOT, 'client') },
    ],
    { headers: SECURITY_HEADERS },
  );

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(manager.status()));
      return;
    }
    if (url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    const fail = () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    };
    api(req, res, clientIp(req))
      .then((handled) => {
        if (!handled) return serveStatic(req, res);
        return undefined;
      })
      .catch(fail);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const perIp = new Map();
  let nextClientId = 1;

  const clientIp = (req) => {
    if (cfg.trustProxy) {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || 'unknown';
  };

  server.on('upgrade', (req, socket, head) => {
    const reject = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!(req.url || '').startsWith('/ws')) return reject(404, 'Not Found');
    if (cfg.allowedOrigins.length > 0 && !cfg.allowedOrigins.includes(req.headers.origin)) return reject(403, 'Forbidden');
    const ip = clientIp(req);
    if ((perIp.get(ip) || 0) >= cfg.maxConnectionsPerIp) return reject(429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, ip));
  });

  wss.on('connection', (ws, ip) => {
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    let closed = false;
    const client = {
      id: nextClientId++,
      sendRaw(raw) {
        if (closed || ws.readyState !== 1) return;
        if (ws.bufferedAmount > MAX_BUFFERED) {
          ws.terminate();
          return;
        }
        ws.send(raw);
      },
      send(obj) {
        this.sendRaw(JSON.stringify(obj));
      },
      close(reason) {
        if (closed) return;
        this.send({ t: 'bye', reason });
        ws.close(1000, String(reason).slice(0, 60));
      },
    };
    const bucket = new TokenBucket(12, 6);
    let dropped = 0;
    let joined = false;
    ws.isAlive = true;
    const helloTimer = setTimeout(() => {
      if (!joined) ws.close(1008, 'hello timeout');
    }, HELLO_TIMEOUT_MS);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (!bucket.take()) {
        if (++dropped > 60) client.close('rate');
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const clean = sanitizeClientMessage(msg);
      if (!clean) return;
      if (clean.t === 'ping') {
        client.send({ t: 'pong', c: clean.c, s: Date.now() });
        return;
      }
      // One bad message must never take the whole server down.
      try {
        if (!joined) {
          if (clean.t !== 'hello') return;
          if (clean.v !== PROTOCOL) {
            client.close('version');
            return;
          }
          joined = true;
          clearTimeout(helloTimer);
          manager.join(client, clean);
          return;
        }
        if (clean.t !== 'hello') manager.handle(client, clean);
      } catch (err) {
        log(`error handling "${clean.t}": ${err?.stack || err}`);
      }
    });

    ws.on('close', () => {
      closed = true;
      clearTimeout(helloTimer);
      const left = (perIp.get(ip) || 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
      if (joined) manager.leave(client);
    });

    ws.on('error', () => {});
  });

  const tick = setInterval(() => manager.tick(), cfg.tickMs);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      const { port } = server.address();
      log(`Lamplit is open on http://localhost:${port} (rooms of ${manager.capacity}, up to ${manager.maxHalls} rooms)`);
      resolve(port);
    });
  });

  async function close(reason = 'restart') {
    clearInterval(tick);
    clearInterval(heartbeat);
    for (const ws of wss.clients) {
      try {
        ws.send(JSON.stringify({ t: 'bye', reason }));
      } catch {
        // socket already gone
      }
      ws.close(1001, reason);
    }
    await new Promise((resolve) => wss.close(() => resolve()));
    await new Promise((resolve) => server.close(() => resolve()));
    clearInterval(purge);
    db.close();
  }

  return { server, manager, profiles, db, ready, close };
}
