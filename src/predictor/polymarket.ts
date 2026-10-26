/**
 * Polymarket prices for the Predictor, read from the public Gamma API.
 *
 * Gamma is Polymarket's market-listing service. A League of Legends match is
 * one *event* — "LoL: Dplus KIA vs Movistar KOI (BO3) - Worlds Group Stage" —
 * holding several two-outcome *markets*: the series winner, a winner for each
 * game ("Game 1 Winner"), a game handicap, total games and the like.
 *
 * Two quirks of the shape matter here:
 *
 * - `outcomes`, `outcomePrices` and `clobTokenIds` arrive as JSON *strings*
 *   (`'["T1","Gen.G"]'`), not arrays.
 * - `bestBid`, `bestAsk` and `lastTradePrice` quote the *first* outcome only.
 *   In a two-outcome market, buying the second outcome at x is selling the
 *   first at 1 − x, so the second's buy price is 1 − bestBid and its sell
 *   price 1 − bestAsk. `outcomePrices` is the midpoint Polymarket displays —
 *   not a price anyone can fill — so it is the fallback, never the first
 *   choice.
 *
 * Every price here is a probability from 0 to 1, the way the position
 * calculator reads them (60¢ = 0.60).
 *
 * Pure: no React, and no network — fetching is passed in.
 */

export const GAMMA_BASE = 'https://gamma-api.polymarket.com';

/** A market as Gamma returns it — only the fields read here. */
export interface GammaMarket {
  id: string;
  question?: string | null;
  slug?: string | null;
  groupItemTitle?: string | null;
  outcomes?: string | string[] | null;
  outcomePrices?: string | (string | number)[] | null;
  bestBid?: number | string | null;
  bestAsk?: number | string | null;
  lastTradePrice?: number | string | null;
  volume?: number | string | null;
  volumeNum?: number | null;
  liquidity?: number | string | null;
  liquidityNum?: number | null;
  active?: boolean | null;
  closed?: boolean | null;
  acceptingOrders?: boolean | null;
  sportsMarketType?: string | null;
  gameStartTime?: string | null;
  updatedAt?: string | null;
}

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  startDate?: string | null;
  endDate?: string | null;
  active?: boolean | null;
  closed?: boolean | null;
  volume?: number | string | null;
  markets?: GammaMarket[] | null;
  tags?: { slug?: string | null; label?: string | null }[] | null;
}

/** Fetches a Gamma path (`/events?slug=…`) and returns the parsed JSON. */
export type GammaFetch = (path: string) => Promise<unknown>;

/* ------------------------------------------------------------------ */
/* Reading values                                                      */
/* ------------------------------------------------------------------ */

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A price is only usable strictly between 0 and 1; 0 and 1 mean an empty book side. */
const price = (value: number | null) => (value !== null && value > 0 && value < 1 ? value : null);

/* ------------------------------------------------------------------ */
/* Matching team names                                                 */
/* ------------------------------------------------------------------ */

const FILLER = /\b(e-?sports?|gaming|team|club|the|lol)\b/g;

/** `Anyone’s Legend` and `Anyone's Legend Esports` both read `anyoneslegend`. */
export function teamKey(name: string): string {
  const plain = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '');
  const stripped = plain.replace(FILLER, ' ').replace(/[^a-z0-9]/g, '');
  return stripped || plain.replace(/[^a-z0-9]/g, '');
}

/** How well a Polymarket name fits one of ours: 3 exact, 2 one inside the other, 0 not at all. */
export function teamScore(theirs: string, ours: string): number {
  const a = teamKey(theirs);
  const b = teamKey(ours);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))) return 2;
  return 0;
}

/**
 * Which of two Polymarket names is our blue team and which our red, or `null`
 * unless both fit — and fit different names.
 */
export function matchSides(names: readonly string[], blue: string, red: string): { blue: number; red: number } | null {
  if (names.length < 2) return null;
  const straight = [teamScore(names[0]!, blue), teamScore(names[1]!, red)];
  const crossed = [teamScore(names[1]!, blue), teamScore(names[0]!, red)];
  const ok = (scores: number[]) => scores.every((score) => score > 0);
  const total = (scores: number[]) => scores[0]! + scores[1]!;
  if (ok(straight) && (!ok(crossed) || total(straight) >= total(crossed))) return { blue: 0, red: 1 };
  if (ok(crossed)) return { blue: 1, red: 0 };
  return null;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const TITLE = /^\s*(?:lol|league of legends)\s*:\s*(.+?)\s+vs\.?\s+(.+?)(?:\s*\((bo\d)\))?(?:\s+-\s+(.+))?\s*$/i;

/** The two teams, best-of and stage named in an LoL event title, when it has the usual shape. */
export function readTitle(title: string): { teams: [string, string]; bestOf: string | null; stage: string | null } | null {
  const match = TITLE.exec(title);
  if (!match) return null;
  return {
    teams: [match[1]!.trim(), match[2]!.trim()],
    bestOf: match[3] ? match[3].toUpperCase() : null,
    stage: match[4]?.trim() || null,
  };
}

export function isLolEvent(event: GammaEvent): boolean {
  if (readTitle(event.title)) return true;
  if (event.slug.startsWith('lol-')) return true;
  return (event.tags ?? []).some((tag) => /league-of-legends/i.test(tag.slug ?? '') || /league of legends/i.test(tag.label ?? ''));
}

/** Whether an event is this matchup, either way round. */
export function eventFits(event: GammaEvent, blue: string, red: string): boolean {
  if (!isLolEvent(event)) return false;
  const read = readTitle(event.title);
  return read !== null && matchSides(read.teams, blue, red) !== null;
}

/**
 * The event for this matchup among several: open ones before settled ones,
 * then the one whose start is nearest to now — the game being played, not
 * last month's meeting of the same two teams.
 */
export function pickEvent(events: readonly GammaEvent[], blue: string, red: string, now: number): GammaEvent | null {
  const fits = events.filter((event) => eventFits(event, blue, red));
  const when = (event: GammaEvent) => {
    const start = Date.parse(event.startDate ?? event.endDate ?? '');
    return Number.isFinite(start) ? Math.abs(start - now) : Infinity;
  };
  fits.sort((a, b) => Number(Boolean(a.closed)) - Number(Boolean(b.closed)) || when(a) - when(b));
  return fits[0] ?? null;
}

/**
 * The slug in a Polymarket link — `polymarket.com/event/<slug>`, the esports
 * pages' `…/league-of-legends/worlds/<slug>` — or a bare slug.
 */
export function slugFromLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let parts: string[];
  if (/polymarket\.com/i.test(trimmed)) {
    try {
      parts = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).pathname.split('/').filter(Boolean);
    } catch {
      return null;
    }
  } else {
    parts = trimmed.split(/[/?#]/).filter(Boolean);
  }
  const after = parts.indexOf('event');
  const slug = after >= 0 && parts[after + 1] ? parts[after + 1] : parts.at(-1);
  return slug && /^[a-z0-9][a-z0-9-]*$/i.test(slug) ? slug.toLowerCase() : null;
}

export const eventUrl = (slug: string) => `https://polymarket.com/event/${slug}`;

/* ------------------------------------------------------------------ */
/* Markets                                                             */
/* ------------------------------------------------------------------ */

export type MarketKind = { kind: 'series' } | { kind: 'game'; game: number } | { kind: 'other' };

/** Markets priced on the two teams that still aren't about who wins. "First Stand" is a tournament, so only named firsts count. */
const NOT_A_WINNER =
  /\b(?:handicap|spread|totals?|over|under|o\/u|odd|even|kills|first (?:blood|tower|dragon|baron|herald))\b/i;

/** What a market is about, from its question and group title. */
export function classifyMarket(market: GammaMarket, blue: string, red: string): MarketKind {
  const text = `${market.groupItemTitle ?? ''} ${market.question ?? ''}`;
  const sides = matchSides(list(market.outcomes), blue, red);
  if (!sides || NOT_A_WINNER.test(text)) return { kind: 'other' };
  const game = /\b(?:game|map)\s*(\d+)\b/i.exec(text);
  if (game) return { kind: 'game', game: Number(game[1]) };
  return { kind: 'series' };
}

export interface OutcomeQuote {
  name: string;
  /** What a share costs now: the best ask. */
  buy: number | null;
  /** What a share sells for now: the best bid. */
  sell: number | null;
  /** The midpoint Polymarket displays. */
  mid: number | null;
  last: number | null;
}

/** Buy, sell, mid and last for both outcomes of a two-outcome market. */
export function quoteMarket(market: GammaMarket): OutcomeQuote[] {
  const names = list(market.outcomes);
  const mids = list(market.outcomePrices).map(num);
  const bid = price(num(market.bestBid));
  const ask = price(num(market.bestAsk));
  const last = price(num(market.lastTradePrice));
  return names.map((name, index) => {
    const mid = price(mids[index] ?? null);
    if (index === 0) return { name, buy: ask ?? mid, sell: bid ?? mid, mid, last };
    if (index === 1) {
      return {
        name,
        buy: bid !== null ? 1 - bid : mid,
        sell: ask !== null ? 1 - ask : mid,
        mid,
        last: last !== null ? 1 - last : null,
      };
    }
    // Gamma's best bid and ask only describe the first two outcomes.
    return { name, buy: mid, sell: mid, mid, last: null };
  });
}

export interface LiveMarket {
  id: string;
  /** `Series`, `Game 2`, or the market's own question for anything else. */
  label: string;
  kind: MarketKind;
  /** Taking orders: active, not closed. */
  open: boolean;
  volume: number | null;
  liquidity: number | null;
  /** For winner markets, the quote for each of our teams. */
  blue: OutcomeQuote | null;
  red: OutcomeQuote | null;
  /** Every outcome, for markets that aren't about a winner. */
  outcomes: OutcomeQuote[];
}

export interface LiveBoard {
  event: { id: string; slug: string; title: string; start: string | null; url: string; closed: boolean };
  bestOf: string | null;
  stage: string | null;
  series: LiveMarket | null;
  /** Game winners, game 1 first. */
  games: LiveMarket[];
  other: LiveMarket[];
}

/** An event read for one matchup: which market is which, and each team's prices. */
export function readEvent(event: GammaEvent, blue: string, red: string): LiveBoard {
  const title = readTitle(event.title);
  const board: LiveBoard = {
    event: {
      id: String(event.id),
      slug: event.slug,
      title: event.title,
      start: event.startDate ?? null,
      url: eventUrl(event.slug),
      closed: Boolean(event.closed),
    },
    bestOf: title?.bestOf ?? null,
    stage: title?.stage ?? null,
    series: null,
    games: [],
    other: [],
  };

  for (const market of event.markets ?? []) {
    const kind = classifyMarket(market, blue, red);
    const quotes = quoteMarket(market);
    const sides = kind.kind === 'other' ? null : matchSides(list(market.outcomes), blue, red);
    const live: LiveMarket = {
      id: String(market.id),
      label: kind.kind === 'series' ? 'Series' : kind.kind === 'game' ? `Game ${kind.game}` : (market.groupItemTitle || market.question || 'Market'),
      kind,
      open: market.active !== false && market.closed !== true && market.acceptingOrders !== false,
      volume: num(market.volumeNum ?? market.volume),
      liquidity: num(market.liquidityNum ?? market.liquidity),
      blue: sides ? (quotes[sides.blue] ?? null) : null,
      red: sides ? (quotes[sides.red] ?? null) : null,
      outcomes: quotes,
    };
    if (kind.kind === 'series' && !board.series) board.series = live;
    else if (kind.kind === 'game') board.games.push(live);
    else board.other.push(live);
  }
  board.games.sort((a, b) => (a.kind.kind === 'game' ? a.kind.game : 0) - (b.kind.kind === 'game' ? b.kind.game : 0));
  return board;
}

/* ------------------------------------------------------------------ */
/* Talking to Gamma                                                    */
/* ------------------------------------------------------------------ */

const asEvents = (value: unknown): GammaEvent[] => {
  if (Array.isArray(value)) return value as GammaEvent[];
  if (value && typeof value === 'object' && Array.isArray((value as { events?: unknown }).events)) {
    return (value as { events: GammaEvent[] }).events;
  }
  return [];
};

/** One event, with all its markets, by slug. */
export async function loadEvent(fetchJson: GammaFetch, slug: string): Promise<GammaEvent | null> {
  const encoded = encodeURIComponent(slug);
  try {
    const single = await fetchJson(`/events/slug/${encoded}`);
    if (single && typeof single === 'object' && !Array.isArray(single) && 'slug' in single) return single as GammaEvent;
  } catch {
    // Older deployments only answer the query form below.
  }
  const events = asEvents(await fetchJson(`/events?slug=${encoded}`));
  return events.find((event) => event.slug === slug) ?? events[0] ?? null;
}

/**
 * Find this matchup's event: a search by both team names, then a search by
 * one, then the list of open LoL events — the first that turns it up wins.
 * Each is a separate request, so one Gamma change doesn't break the rest.
 */
export async function findEvent(fetchJson: GammaFetch, blue: string, red: string, now: number): Promise<GammaEvent | null> {
  const attempts = [
    `/public-search?q=${encodeURIComponent(`${blue} ${red}`)}&events_status=active&limit_per_type=20`,
    `/public-search?q=${encodeURIComponent(`LoL ${blue}`)}&events_status=active&limit_per_type=50`,
    `/events?tag_slug=league-of-legends&closed=false&limit=200`,
  ];
  let failures = 0;
  for (const path of attempts) {
    try {
      const found = pickEvent(asEvents(await fetchJson(path)), blue, red, now);
      if (found) return found;
    } catch (error) {
      failures += 1;
      if (failures === attempts.length) throw error;
    }
  }
  return null;
}

/** The buy prices the position calculator takes, per side, for the series and for one game. */
export interface LivePrices {
  series: { blue: number | null; red: number | null } | null;
  game: { blue: number | null; red: number | null } | null;
  /** The game the `game` prices are for. */
  gameNumber: number;
  /** When the prices were read, epoch ms. */
  at: number;
  title: string;
}

export function livePrices(board: LiveBoard, gameNumber: number, at: number): LivePrices {
  const buys = (market: LiveMarket | null | undefined) =>
    market && market.open && (market.blue?.buy != null || market.red?.buy != null)
      ? { blue: market.blue?.buy ?? null, red: market.red?.buy ?? null }
      : null;
  const game = board.games.find((entry) => entry.kind.kind === 'game' && entry.kind.game === gameNumber);
  return { series: buys(board.series), game: buys(game), gameNumber, at, title: board.event.title };
}
