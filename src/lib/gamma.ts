/**
 * Requests to Polymarket's Gamma API from the browser.
 *
 * Under `npm run dev` / `npm run preview` the Vite server passes requests
 * through (`scripts/vite-polymarket-proxy.mjs`), which sidesteps the browser's
 * cross-site rules. Served as static files, that route isn't there — the
 * response lacks the proxy's marker header — so the client calls Gamma
 * directly, which works only if Polymarket allows it. Which route works is
 * remembered for the session.
 */

import { GAMMA_BASE, type GammaFetch } from '../predictor/polymarket.ts';

const PROXY = '/__draftcall/polymarket/gamma';

export class GammaError extends Error {}

let route: 'proxy' | 'direct' | null = null;

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new GammaError(`Polymarket sent something other than JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : '';
    throw new GammaError(message || `Polymarket answered HTTP ${response.status}.`);
  }
  return body;
}

export const gammaFetch: GammaFetch = async (path) => {
  if (route !== 'direct') {
    try {
      const response = await fetch(`${PROXY}${path}`, { cache: 'no-store' });
      if (response.headers.get('x-draftcall-proxy') === '1') {
        route = 'proxy';
        return await readJson(response);
      }
    } catch (error) {
      if (route === 'proxy') throw error instanceof GammaError ? error : new GammaError('The local server stopped answering.');
    }
    route = 'direct';
  }
  try {
    return await readJson(await fetch(`${GAMMA_BASE}${path}`, { cache: 'no-store' }));
  } catch (error) {
    if (error instanceof GammaError) throw error;
    throw new GammaError(
      'The browser could not reach Polymarket. Run the app with `npm run dev` or `npm run preview`, which pass the requests through.',
    );
  }
};
