/**
 * Requests to the LoL Esports feeds from the browser, for the live draft.
 *
 * Under `npm run dev` / `npm run preview` they go through the Vite server
 * (`scripts/vite-lolesports-proxy.mjs`), which adds the site's public key.
 * Served as static files, the client calls the feeds directly with the key,
 * which works only if they allow your page. Which route works is remembered.
 */

import { API_BASE, API_KEY, FEED_BASE } from '../../scripts/lib/lolesports.mjs';

const PROXY = '/__draftcall/lolesports';

export class FeedError extends Error {}

let route: 'proxy' | 'direct' | null = null;

/** JSON, or `null` for "nothing yet" — the stats feed's 204 before a game loads, or a 404. */
async function read(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new FeedError('LoL Esports refused the request — its public key may have changed, or the network blocks it.');
  }
  const text = await response.text();
  if (!response.ok) {
    let message = '';
    try {
      message = String((JSON.parse(text) as { error?: unknown }).error ?? '');
    } catch {
      // Not JSON; use the status.
    }
    throw new FeedError(message || `LoL Esports answered HTTP ${response.status}.`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new FeedError('LoL Esports sent something other than JSON.');
  }
}

async function get(proxyPath: string, directUrl: string, apiKey: boolean): Promise<unknown> {
  if (route !== 'direct') {
    try {
      const response = await fetch(`${PROXY}${proxyPath}`, { cache: 'no-store' });
      if (response.headers.get('x-draftcall-proxy') === '1') {
        route = 'proxy';
        return await read(response);
      }
    } catch (error) {
      if (route === 'proxy') throw error instanceof FeedError ? error : new FeedError('The local server stopped answering.');
    }
    route = 'direct';
  }
  try {
    return await read(await fetch(directUrl, { cache: 'no-store', headers: apiKey ? { 'x-api-key': API_KEY } : {} }));
  } catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError(
      'The browser could not reach LoL Esports. Run the app with `npm run dev` or `npm run preview`, which pass the requests through.',
    );
  }
}

/** An esports-api endpoint (`getLive`, `getEventDetails`, …). */
export function lolApi(endpoint: 'getLive' | 'getEventDetails' | 'getSchedule', params: Record<string, string> = {}) {
  const query = new URLSearchParams({ hl: 'en-US', ...params }).toString();
  return get(`/api/${endpoint}?${query}`, `${API_BASE}/${endpoint}?${query}`, true);
}

/** A game's live stats window; `null` until the game has loaded. */
export function lolWindow(gameId: string) {
  const id = encodeURIComponent(gameId);
  return get(`/feed/window/${id}`, `${FEED_BASE}/window/${id}`, false);
}
