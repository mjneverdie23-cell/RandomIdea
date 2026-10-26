/**
 * Dev/preview pass-through to the LoL Esports feeds, for the Predictor's live
 * draft. Same idea as the Polymarket one: the Vite server makes the request,
 * so the browser's cross-site rules don't apply, and the site's public API key
 * is added here rather than shipped in every request from the page.
 *
 *   GET /__draftcall/lolesports/api/<getLive|getSchedule|getEventDetails>?…
 *         -> esports-api.lolesports.com/persisted/gw/<endpoint>?…   (+ x-api-key)
 *   GET /__draftcall/lolesports/feed/window/<gameId>
 *         -> feed.lolesports.com/livestats/v1/window/<gameId>
 *
 * Statuses pass through unchanged — the live stats feed answers 204 until a
 * game has loaded, and the app reads that as "no champions yet". Override the
 * targets with LOLESPORTS_API_BASE, LOLESPORTS_FEED_BASE and
 * LOLESPORTS_API_KEY, the same variables `npm run draft:live` reads.
 */

import { API_BASE, API_KEY, FEED_BASE } from './lib/lolesports.mjs';

const ROUTE = '/__draftcall/lolesports';
const ENDPOINTS = new Set(['getLive', 'getSchedule', 'getEventDetails']);

export function lolesportsProxyPlugin({ timeoutMs = 15_000 } = {}) {
  const api = (process.env.LOLESPORTS_API_BASE || API_BASE).replace(/\/+$/, '');
  const feed = (process.env.LOLESPORTS_FEED_BASE || FEED_BASE).replace(/\/+$/, '');
  const key = process.env.LOLESPORTS_API_KEY || API_KEY;

  const middleware = async (req, res, next) => {
    if (!req.url || !req.url.startsWith(`${ROUTE}/`)) return next();
    const url = new URL(req.url, 'http://localhost');
    const rest = url.pathname.slice(ROUTE.length);
    const send = (status, body, type = 'application/json') => {
      res.statusCode = status;
      res.setHeader('x-draftcall-proxy', '1');
      res.setHeader('cache-control', 'no-store');
      if (body === null) return res.end();
      res.setHeader('content-type', type);
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'Only GET is passed through.' });

    let target;
    let headers = { accept: 'application/json' };
    const apiMatch = /^\/api\/([A-Za-z]+)$/.exec(rest);
    const windowMatch = /^\/feed\/window\/([A-Za-z0-9]+)$/.exec(rest);
    if (apiMatch && ENDPOINTS.has(apiMatch[1])) {
      target = `${api}/${apiMatch[1]}${url.search}`;
      headers = { ...headers, 'x-api-key': key };
    } else if (windowMatch) {
      target = `${feed}/window/${windowMatch[1]}${url.search}`;
    } else {
      return send(400, { error: `Not a LoL Esports feed path: ${rest}` });
    }

    try {
      const upstream = await fetch(target, { headers, signal: AbortSignal.timeout(timeoutMs) });
      const text = await upstream.text();
      send(upstream.status, upstream.status === 204 || !text ? null : text, upstream.headers.get('content-type') || 'application/json');
    } catch (error) {
      send(502, { error: `Could not reach LoL Esports: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  return {
    name: 'draftcall-lolesports-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
