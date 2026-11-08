// HTTP endpoints for getting in: continue as a guest, sign up, log in, log out, and
// "who am I". Everything else happens over the WebSocket.
//
// Tokens travel in the Authorization header (never in URLs) and no cookies are used, so
// there is nothing for another site to forge a request with.

import { TokenBucket } from './rate-limit.js';

const MAX_BODY = 4096;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      resolve({ error: 415 });
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve({ error: 413 });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(body && typeof body === 'object' && !Array.isArray(body) ? { body } : { error: 400 });
      } catch {
        resolve({ error: 400 });
      }
    });
    req.on('error', () => resolve({ error: 400 }));
  });
}

const bearer = (req) => {
  const m = /^Bearer ([A-Za-z0-9_-]{20,64})$/.exec(String(req.headers.authorization || ''));
  return m ? m[1] : null;
};

/**
 * @param {import('./profiles.js').ProfileService} profiles
 * @param {{ authPerMinute: number, authBurst: number }} cfg
 */
export function createApi(profiles, cfg, now = () => Date.now()) {
  const buckets = new Map();
  const sweep = setInterval(() => buckets.clear(), 30 * 60_000);
  sweep.unref?.();
  const limited = (ip) => {
    let b = buckets.get(ip);
    if (!b) {
      b = new TokenBucket(cfg.authBurst, cfg.authPerMinute / 60);
      buckets.set(ip, b);
    }
    return !b.take();
  };

  /** Returns true if the request was an API call and has been answered. */
  return async function handle(req, res, ip) {
    const path = (req.url || '').split('?')[0];
    if (!path.startsWith('/api/') || path === '/api/status') return false;

    if (path === '/api/me' && req.method === 'GET') {
      const token = bearer(req);
      const p = token && profiles.byToken(token, now());
      if (!p) send(res, 401, { error: 'auth' });
      else send(res, 200, { profile: profiles.me(p.id, p.tz, now()) });
      return true;
    }

    if (req.method !== 'POST') {
      send(res, 405, { error: 'method' });
      return true;
    }

    if (path === '/api/logout') {
      const token = bearer(req);
      if (token) profiles.logout(token);
      send(res, 200, { ok: true });
      return true;
    }

    if (!['/api/guest', '/api/signup', '/api/login'].includes(path)) {
      send(res, 404, { error: 'not found' });
      return true;
    }
    if (limited(ip)) {
      send(res, 429, { error: 'slow' });
      return true;
    }
    const { body, error } = await readJson(req);
    if (error) {
      send(res, error, { error: 'body' });
      return true;
    }
    const t = now();
    const tz = typeof body.tz === 'string' ? body.tz : undefined;

    if (path === '/api/guest') {
      const { id, token } = profiles.createGuest(t, tz);
      send(res, 200, { token, profile: profiles.me(id, tz, t) });
      return true;
    }

    const args = { username: body.username, password: body.password, tz };
    const r = path === '/api/signup' ? await profiles.signup({ ...args, guestToken: bearer(req) }, t) : await profiles.login(args, t);
    if (!r.ok) send(res, r.error === 'invalid' ? 401 : r.error === 'taken' ? 409 : 400, { error: r.error });
    else send(res, 200, { token: r.token, profile: profiles.me(r.id, tz, t) });
    return true;
  };
}
