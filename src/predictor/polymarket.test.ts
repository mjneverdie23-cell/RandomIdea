import { describe, expect, it } from 'vitest';
import {
  classifyMarket,
  eventFits,
  findEvent,
  livePrices,
  loadEvent,
  matchSides,
  pickEvent,
  quoteMarket,
  readEvent,
  readTitle,
  slugFromLink,
  teamKey,
  type GammaEvent,
  type GammaMarket,
} from './polymarket.ts';

/** Shaped the way Gamma sends it: outcomes and prices as JSON strings, book quotes for outcome 0. */
function market(id: string, question: string, outcomes: string[], extra: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id,
    question,
    outcomes: JSON.stringify(outcomes),
    outcomePrices: JSON.stringify(['0.6', '0.4']),
    active: true,
    closed: false,
    acceptingOrders: true,
    ...extra,
  };
}

const EVENT: GammaEvent = {
  id: '9001',
  slug: 'lol-gen-t1-2026-11-01',
  title: 'LoL: Gen.G vs T1 (BO5) - Worlds Playoffs',
  startDate: '2026-11-01T08:00:00Z',
  closed: false,
  markets: [
    market('1', 'LoL: Gen.G vs T1 (BO5) - Worlds Playoffs', ['Gen.G', 'T1'], {
      bestBid: 0.61,
      bestAsk: 0.63,
      lastTradePrice: '0.62',
      volumeNum: 250000,
    }),
    market('2', 'Game 1 Winner', ['Gen.G', 'T1'], { bestBid: '0.55', bestAsk: '0.57', groupItemTitle: 'Game 1' }),
    market('3', 'Game 2 Winner', ['Gen.G', 'T1'], { bestBid: 0.5, bestAsk: 0.53, closed: true }),
    market('4', 'Game Handicap: Gen.G (-1.5) vs T1 (+1.5)', ['Gen.G', 'T1'], { bestBid: 0.4, bestAsk: 0.42 }),
    market('5', 'Total Games O/U 3.5', ['Over', 'Under'], { bestBid: 0.48, bestAsk: 0.5 }),
  ],
};

describe('names', () => {
  it('reads team names the same however they are dressed', () => {
    expect(teamKey('Anyone’s Legend')).toBe(teamKey("Anyone's Legend Esports"));
    expect(teamKey('Gen.G')).toBe('geng');
    expect(teamKey('Team Liquid')).toBe('liquid');
  });

  it('maps two names onto our blue and red, either way round, or not at all', () => {
    expect(matchSides(['Gen.G', 'T1'], 'T1', 'Gen.G')).toEqual({ blue: 1, red: 0 });
    expect(matchSides(['Dplus KIA', 'Movistar KOI'], 'Dplus KIA', 'Movistar KOI Esports')).toEqual({ blue: 0, red: 1 });
    expect(matchSides(['Over', 'Under'], 'T1', 'Gen.G')).toBeNull();
    // Both of ours fitting the same name is not a match.
    expect(matchSides(['T1', 'G2'], 'T1', 'T1 Academy')).toBeNull();
  });

  it('reads the teams, best-of and stage from an LoL event title', () => {
    expect(readTitle('LoL: Dplus KIA vs Movistar KOI (BO3) - Worlds Group Stage')).toEqual({
      teams: ['Dplus KIA', 'Movistar KOI'],
      bestOf: 'BO3',
      stage: 'Worlds Group Stage',
    });
    expect(readTitle('Will it rain in Seoul?')).toBeNull();
  });

  it('takes the slug from a link of any shape', () => {
    expect(slugFromLink('https://polymarket.com/esports/league-of-legends/worlds/lol-dk-mkoi-2026-10-25')).toBe('lol-dk-mkoi-2026-10-25');
    expect(slugFromLink('https://polymarket.com/event/lol-gen-ly-2026-10-25/game-1?tid=1')).toBe('lol-gen-ly-2026-10-25');
    expect(slugFromLink('polymarket.com/event/lol-tl2-al-2026-10-26')).toBe('lol-tl2-al-2026-10-26');
    expect(slugFromLink('  lol-los-tsw-2026-10-26 ')).toBe('lol-los-tsw-2026-10-26');
    expect(slugFromLink('not a slug!')).toBeNull();
  });
});

describe('markets', () => {
  it('tells the series, each game and everything else apart', () => {
    const kinds = EVENT.markets!.map((entry) => classifyMarket(entry, 'T1', 'Gen.G'));
    expect(kinds).toEqual([
      { kind: 'series' },
      { kind: 'game', game: 1 },
      { kind: 'game', game: 2 },
      { kind: 'other' },
      { kind: 'other' },
    ]);
    // "First Stand" is a tournament, not a first-blood market.
    expect(classifyMarket(market('9', 'LoL: T1 vs G2 (BO5) - First Stand Final', ['T1', 'G2']), 'T1', 'G2')).toEqual({ kind: 'series' });
  });

  it('prices the second outcome off the first one\'s book', () => {
    const [genG, t1] = quoteMarket(EVENT.markets![0]!);
    expect(genG).toMatchObject({ name: 'Gen.G', buy: 0.63, sell: 0.61, mid: 0.6, last: 0.62 });
    // Buying T1 is selling Gen.G: 1 − 0.61 to buy, 1 − 0.63 to sell.
    expect(t1!.name).toBe('T1');
    expect(t1!.buy).toBeCloseTo(0.39);
    expect(t1!.sell).toBeCloseTo(0.37);
    expect(t1!.last).toBeCloseTo(0.38);
  });

  it('falls back to the displayed midpoint when a side of the book is empty', () => {
    const [first, second] = quoteMarket(market('x', 'Q', ['A', 'B'], { bestBid: 0, bestAsk: null }));
    expect(first).toMatchObject({ buy: 0.6, sell: 0.6 });
    expect(second).toMatchObject({ buy: 0.4, sell: 0.4 });
  });
});

describe('readEvent', () => {
  const board = readEvent(EVENT, 'T1', 'Gen.G');

  it('maps every winner market onto our sides', () => {
    expect(board).toMatchObject({ bestOf: 'BO5', stage: 'Worlds Playoffs' });
    expect(board.event.url).toBe('https://polymarket.com/event/lol-gen-t1-2026-11-01');
    expect(board.series!.blue!.name).toBe('T1');
    expect(board.series!.blue!.buy).toBeCloseTo(0.39);
    expect(board.series!.red!.buy).toBe(0.63);
    expect(board.series!.volume).toBe(250000);
    expect(board.games.map((game) => [game.label, game.open])).toEqual([
      ['Game 1', true],
      ['Game 2', false],
    ]);
    expect(board.other.map((entry) => entry.label)).toEqual(['Game Handicap: Gen.G (-1.5) vs T1 (+1.5)', 'Total Games O/U 3.5']);
  });

  it('gives the calculator buy prices for the series and the current game, never a closed market', () => {
    expect(livePrices(board, 1, 5)).toMatchObject({ gameNumber: 1, at: 5, game: { red: 0.57 } });
    expect(livePrices(board, 1, 5).game!.blue).toBeCloseTo(0.45);
    expect(livePrices(board, 2, 5).game).toBeNull();
    expect(livePrices(board, 3, 5).game).toBeNull();
    expect(livePrices(board, 1, 5).series!.red).toBe(0.63);
  });
});

describe('finding the event', () => {
  const older: GammaEvent = { ...EVENT, id: '1', slug: 'lol-gen-t1-2026-05-01', startDate: '2026-05-01T08:00:00Z', closed: true };
  const other: GammaEvent = { ...EVENT, id: '2', slug: 'lol-hle-kt', title: 'LoL: Hanwha Life Esports vs KT Rolster (BO3)' };
  const now = Date.parse('2026-11-01T09:00:00Z');

  it('prefers the open event nearest to now', () => {
    expect(pickEvent([older, other, EVENT], 'T1', 'Gen.G', now)?.slug).toBe(EVENT.slug);
    expect(eventFits(other, 'T1', 'Gen.G')).toBe(false);
  });

  it('searches until something fits, and survives a request that fails', async () => {
    const asked: string[] = [];
    const found = await findEvent(
      async (path) => {
        asked.push(path);
        if (path.startsWith('/public-search?q=T1')) throw new Error('boom');
        if (path.startsWith('/public-search')) return { events: [other], tags: [] };
        return [older, EVENT];
      },
      'T1',
      'Gen.G',
      now,
    );
    expect(found?.slug).toBe(EVENT.slug);
    expect(asked).toHaveLength(3);
  });

  it('loads an event by slug, falling back to the query form', async () => {
    const viaPath = await loadEvent(async (path) => (path === '/events/slug/lol-gen-t1-2026-11-01' ? EVENT : []), EVENT.slug);
    expect(viaPath?.id).toBe('9001');
    const viaQuery = await loadEvent(async (path) => {
      if (path.startsWith('/events/slug/')) throw new Error('404');
      return [EVENT];
    }, EVENT.slug);
    expect(viaQuery?.id).toBe('9001');
  });
});
