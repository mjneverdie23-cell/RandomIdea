/**
 * Dev/preview pass-through to Polymarket's public Gamma API.
 *
 * The Predictor polls Gamma for live prices. A browser page may not be allowed
 * to read another site's responses (CORS), and that is Polymarket's call, not
 * ours — so while the app runs under `npm run dev` or `npm run preview`, the
 * Vite server makes the request instead and hands back the JSON:
 *
 *   GET /__draftcall/polymarket/gamma/<path>  ->  GET https://gamma-api.polymarket.com/<path>
 *
 * Read-only and narrow on purpose: GET only, and only the listing endpoints
 * the app uses. Nothing is cached, so every poll is a fresh price. Set
 * POLYMARKET_GAMMA_BASE to point it at another server, e.g. a local mock.
 *
 * When the app is served as static files this route doesn't exist; the client
 * notices (no `x-draftcall-proxy` header) and calls Gamma directly instead.
 */

const ROUTE = '/__draftcall/polymarket/gamma';
const ALLOWED = /^\/(?:events|markets|public-search|sports|tags|series)(?:[/?]|$)/;
const DEFAULT_BASE = 'https://gamma-api.polymarket.com';

export function polymarketProxyPlugin({ timeoutMs = 10_000 } = {}) {
  const base = (process.env.POLYMARKET_GAMMA_BASE || DEFAULT_BASE).replace(/\/+$/, '');

  const middleware = async (req, res, next) => {
    if (!req.url || !req.url.startsWith(ROUTE)) return next();
    const rest = req.url.slice(ROUTE.length) || '/';
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-draftcall-proxy', '1');
      res.setHeader('cache-control', 'no-store');
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (req.method !== 'GET') return send(405, { error: 'Only GET is passed through.' });
    if (!ALLOWED.test(rest)) return send(400, { error: `Not a Gamma listing path: ${rest}` });

    try {
      const upstream = await fetch(`${base}${rest}`, {
        headers: { accept: 'application/json', 'user-agent': 'DraftCall (local predictor)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      send(upstream.status, await upstream.text());
    } catch (error) {
      send(502, { error: `Could not reach Polymarket: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  return {
    name: 'draftcall-polymarket-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
