import { describe, expect, it } from 'vitest';
import {
  COMEBACK_DEFICIT,
  DECISIVE_GOLD,
  META_MIN_PICKS,
  MIN_TEMPO_SAMPLE,
  buildPredictorModel,
  deriveMeta,
  deriveEarlyGold,
  deriveScaling,
  latestSeason,
  streakOf,
} from './derive.ts';
import { anywhereKey, splitSubject } from './engine.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Game, type GoldDiffTrack, type Side } from '../domain/types.ts';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-02-01T00:00:00.000Z');

interface GameSpec {
  id: string;
  blue: string;
  red: string;
  winner: Side;
  day: number;
  gameNumber?: number;
  competition?: Game['competition'];
  season?: string;
  split?: string;
  patch?: string;
  /** Starter names in role order; defaults to `<team>-<role>`. */
  bluePlayers?: string[];
  redPlayers?: string[];
  seriesFormat?: Game['seriesFormat'];
  blueDraft?: string[];
  redDraft?: string[];
  blueBans?: string[];
  redBans?: string[];
  /** Game length; `null` means the export carried none. */
  durationSeconds?: number | null;
  blueGold?: GoldDiffTrack | null;
  /** Blue-side gold diff at 10/15/20/25; null entries mean "never reached". */
  blueCheckpoints?: (number | null)[];
  /** Minutes past midnight, so games in one series stay inside the 12h window. */
  hour?: number;
}

const DEFAULT_BLUE = ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Thresh'];
const DEFAULT_RED = ['Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'];

function makeGame(spec: GameSpec): Game {
  const build = (
    side: Side,
    teamName: string,
    draft: string[],
    gold: GoldDiffTrack | null,
    names: string[] | undefined,
    bans: string[] | undefined,
  ) => ({
    side,
    teamName,
    teamId: null,
    tag: teamName.slice(0, 3).toUpperCase(),
    players: ROLES.map((role, index) => ({
      role,
      playerName: names?.[index] ?? `${teamName}-${role}`,
      playerId: null,
      champion: makeChampion(draft[index]!)!,
    })),
    bans: (bans ?? []).map((name) => makeChampion(name)!),
    goldDiff: gold,
  });

  let blueGold = spec.blueGold === undefined ? null : spec.blueGold;
  if (spec.blueCheckpoints) {
    const present = spec.blueCheckpoints.filter((v): v is number => v !== null);
    blueGold = {
      checkpoints: spec.blueCheckpoints,
      peak: present.length ? Math.max(...present) : 0,
      trough: present.length ? Math.min(...present) : 0,
    };
  }
  const mirror = (track: GoldDiffTrack): GoldDiffTrack => ({
    ...(track.checkpoints
      ? { checkpoints: track.checkpoints.map((v) => (v === null ? null : -v)) }
      : {}),
    peak: -track.trough,
    trough: -track.peak,
  });
  const redGold = blueGold ? mirror(blueGold) : null;

  return {
    gameId: spec.id,
    competition: spec.competition ?? 'LCK',
    sourceLeague: spec.competition ?? 'LCK',
    tournamentLabel: 'Test',
    season: spec.season ?? '2026',
    split: spec.split ?? 'Spring',
    date: new Date(START + spec.day * DAY + (spec.hour ?? 0) * 3600_000).toISOString(),
    patch: spec.patch ?? '16.01',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: spec.seriesFormat ?? 'BO3',
    seriesFormatInferred: true,
    gameNumber: spec.gameNumber ?? 1,
    blue: build(
      'blue',
      spec.blue,
      spec.blueDraft ?? DEFAULT_BLUE,
      blueGold,
      spec.bluePlayers,
      spec.blueBans,
    ),
    red: build('red', spec.red, spec.redDraft ?? DEFAULT_RED, redGold, spec.redPlayers, spec.redBans),
    winner: spec.winner,
    durationSeconds: spec.durationSeconds === undefined ? 1800 : spec.durationSeconds,
    demo: false,
  };
}

/** One best-of-three, played on a single day. */
function series(
  id: string,
  blue: string,
  red: string,
  winners: Side[],
  day: number,
  extra: Partial<GameSpec> = {},
): Game[] {
  return winners.map((winner, index) =>
    makeGame({
      id: `${id}-g${index + 1}`,
      blue,
      red,
      winner,
      day,
      hour: index,
      gameNumber: index + 1,
      ...extra,
    }),
  );
}

describe('streakOf', () => {
  it('counts the current run only', () => {
    expect(streakOf(['L', 'W', 'W', 'W'])).toBe('3W');
    expect(streakOf(['W', 'W', 'L'])).toBe('1L');
    expect(streakOf([])).toBe('');
  });
});

describe('latestSeason', () => {
  it('picks the newest season present', () => {
    const games = [
      makeGame({ id: 'a', blue: 'A', red: 'B', winner: 'blue', day: 0, season: '2024' }),
      makeGame({ id: 'b', blue: 'A', red: 'B', winner: 'red', day: 1, season: '2026' }),
      makeGame({ id: 'c', blue: 'A', red: 'B', winner: 'blue', day: 2, season: '2025' }),
    ];
    expect(latestSeason(games)).toBe('2026');
  });
});

describe('deriveMeta', () => {
  it('keeps only champions picked often enough on the newest patches', () => {
    const games = [
      // 9 games on the newest patch where blue's top laner is always Aatrox.
      ...Array.from({ length: 9 }, (_, i) =>
        makeGame({ id: `new-${i}`, blue: 'A', red: 'B', winner: 'blue', day: i, patch: '16.02' }),
      ),
      // One game on the same patch with a different top pick: 1/10 = 10% > 5%.
      makeGame({
        id: 'rare',
        blue: 'A',
        red: 'B',
        winner: 'blue',
        day: 9,
        patch: '16.02',
        blueDraft: ['Rumble', 'Viego', 'Azir', 'Jinx', 'Thresh'],
      }),
    ];
    const { metaByRole, patches, pickRateByRole, windowGames } = deriveMeta(games);
    expect(patches).toEqual(['16.02']);
    expect(windowGames).toBe(10);
    expect(metaByRole.get('top')!.has(makeChampion('Aatrox')!.id)).toBe(true);
    // Rumble clears the rate bar on one pick, which is not evidence of a meta.
    expect(pickRateByRole.get('top')!.get(makeChampion('Rumble')!.id)).toBeCloseTo(0.1, 10);
    expect(metaByRole.get('top')!.has(makeChampion('Rumble')!.id)).toBe(false);
  });

  it('needs real picks behind the rate, not just a small denominator', () => {
    // Same 10% share, but now on enough picks to mean something.
    const games = [
      ...Array.from({ length: 36 }, (_, i) =>
        makeGame({ id: `new-${i}`, blue: 'A', red: 'B', winner: 'blue', day: i, patch: '16.02' }),
      ),
      ...Array.from({ length: META_MIN_PICKS }, (_, i) =>
        makeGame({
          id: `pocket-${i}`,
          blue: 'A',
          red: 'B',
          winner: 'blue',
          day: 40 + i,
          patch: '16.02',
          blueDraft: ['Rumble', 'Viego', 'Azir', 'Jinx', 'Thresh'],
        }),
      ),
    ];
    const { metaByRole } = deriveMeta(games);
    expect(metaByRole.get('top')!.has(makeChampion('Rumble')!.id)).toBe(true);

    // One pick short and it drops out, however good the percentage looks.
    const { metaByRole: thinner } = deriveMeta(games.slice(0, -1));
    expect(thinner.get('top')!.has(makeChampion('Rumble')!.id)).toBe(false);
  });

  it('ignores picks from patches outside the window', () => {
    const games = [
      // A champion that dominated an old patch and then vanished.
      ...Array.from({ length: 20 }, (_, i) =>
        makeGame({
          id: `old-${i}`,
          blue: 'A',
          red: 'B',
          winner: 'blue',
          day: i,
          patch: '15.01',
          blueDraft: ['Rumble', 'Viego', 'Azir', 'Jinx', 'Thresh'],
        }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeGame({ id: `mid-${i}`, blue: 'A', red: 'B', winner: 'blue', day: 30 + i, patch: '16.01' }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeGame({ id: `new-${i}`, blue: 'A', red: 'B', winner: 'blue', day: 40 + i, patch: '16.02' }),
      ),
    ];
    const { metaByRole, patches } = deriveMeta(games);
    expect(patches).toEqual(['16.02', '16.01']);
    expect(metaByRole.get('top')!.has(makeChampion('Aatrox')!.id)).toBe(true);
    expect(metaByRole.get('top')!.has(makeChampion('Rumble')!.id)).toBe(false);
  });

  it('counts a permabanned champion as meta, not as a pocket pick', () => {
    // Rumble is picked once in twenty games and banned in nineteen of them —
    // the Poppy shape. Picks alone read that as off-meta, which credited a
    // surprise bonus to whoever finally got him through.
    const games = [
      makeGame({
        id: 'through',
        blue: 'A',
        red: 'B',
        winner: 'blue',
        day: 0,
        patch: '16.02',
        blueDraft: ['Rumble', 'Viego', 'Azir', 'Jinx', 'Thresh'],
      }),
      ...Array.from({ length: 19 }, (_, i) =>
        makeGame({
          id: `banned-${i}`,
          blue: 'A',
          red: 'B',
          winner: 'blue',
          day: i + 1,
          patch: '16.02',
          redBans: ['Rumble'],
        }),
      ),
    ];

    const { metaByRole, pickRateByRole, presenceRateByRole } = deriveMeta(games);
    const rumble = makeChampion('Rumble')!.id;
    expect(pickRateByRole.get('top')!.get(rumble)).toBeCloseTo(0.05, 10);
    expect(presenceRateByRole.get('top')!.get(rumble)).toBeCloseTo(1.0, 10);
    expect(metaByRole.get('top')!.has(rumble)).toBe(true);
  });

  it('files a ban under the role that champion is actually played in', () => {
    // Bans carry no role in the source data, so the only way to place one is
    // by where the champion shows up on the board.
    const games = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeGame({
          id: `pick-${i}`,
          blue: 'A',
          red: 'B',
          winner: 'blue',
          day: i,
          patch: '16.02',
          blueDraft: ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Rumble'],
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeGame({
          id: `ban-${i}`,
          blue: 'A',
          red: 'B',
          winner: 'blue',
          day: 10 + i,
          patch: '16.02',
          blueBans: ['Rumble'],
        }),
      ),
    ];

    const { presenceRateByRole } = deriveMeta(games);
    const rumble = makeChampion('Rumble')!.id;
    // Ten support picks plus ten bans over twenty games, all on support.
    expect(presenceRateByRole.get('support')!.get(rumble)).toBeCloseTo(1.0, 10);
    expect(presenceRateByRole.get('top')!.get(rumble)).toBeUndefined();
  });

  it('still needs the appearances, however lopsided the bans', () => {
    // Three appearances in sixty games clears the rate bar in no role, and
    // META_MIN_PICKS is what stops a rounding artefact becoming a meta read.
    const games = [
      ...Array.from({ length: 60 }, (_, i) =>
        makeGame({ id: `plain-${i}`, blue: 'A', red: 'B', winner: 'blue', day: i, patch: '16.02' }),
      ),
      ...Array.from({ length: META_MIN_PICKS - 1 }, (_, i) =>
        makeGame({
          id: `rare-${i}`,
          blue: 'A',
          red: 'B',
          winner: 'blue',
          day: 100 + i,
          patch: '16.02',
          blueDraft: ['Rumble', 'Viego', 'Azir', 'Jinx', 'Thresh'],
        }),
      ),
    ];

    const { metaByRole } = deriveMeta(games);
    expect(metaByRole.get('top')!.has(makeChampion('Rumble')!.id)).toBe(false);
  });
});

describe('deriveScaling', () => {
  const SHORT = 20 * 60;
  const LONG = 45 * 60;

  /**
   * `wins` games won and `losses` lost at one length, with `champion` top for
   * blue. Enough of both lengths that the 30/70 cut lands between them.
   */
  function bucket(
    tag: string,
    champion: string,
    seconds: number,
    wins: number,
    losses: number,
  ): Game[] {
    const draft = [champion, 'Viego', 'Azir', 'Jinx', 'Thresh'];
    return [
      ...Array.from({ length: wins }, (_, i) =>
        makeGame({
          id: `${tag}-w${i}`,
          blue: 'A',
          red: 'B',
          winner: 'blue',
          day: i,
          durationSeconds: seconds,
          blueDraft: draft,
        }),
      ),
      ...Array.from({ length: losses }, (_, i) =>
        makeGame({
          id: `${tag}-l${i}`,
          blue: 'A',
          red: 'B',
          winner: 'red',
          day: 200 + i,
          durationSeconds: seconds,
          blueDraft: draft,
        }),
      ),
    ];
  }

  it('calls a champion late game when it wins more in long games', () => {
    // 25% over 20 short games, 75% over 20 long ones.
    const games = [
      ...bucket('short', 'Rumble', SHORT, 5, 15),
      ...bucket('long', 'Rumble', LONG, 15, 5),
    ];
    const { scalingByChampion } = deriveScaling(games);
    const read = scalingByChampion.get(makeChampion('Rumble')!.id)!;
    expect(read.type).toBe('late');
    expect(read.shortRate).toBeCloseTo(0.25, 10);
    expect(read.longRate).toBeCloseTo(0.75, 10);
    expect(read.delta).toBeCloseTo(0.5, 10);
  });

  it('calls it early game when the gap runs the other way', () => {
    const games = [
      ...bucket('short', 'Rumble', SHORT, 15, 5),
      ...bucket('long', 'Rumble', LONG, 5, 15),
    ];
    const read = deriveScaling(games).scalingByChampion.get(makeChampion('Rumble')!.id)!;
    expect(read.type).toBe('early');
    expect(read.delta).toBeCloseTo(-0.5, 10);
  });

  it('calls it balanced when the two ends agree', () => {
    const games = [
      ...bucket('short', 'Rumble', SHORT, 10, 10),
      ...bucket('long', 'Rumble', LONG, 10, 10),
    ];
    const read = deriveScaling(games).scalingByChampion.get(makeChampion('Rumble')!.id)!;
    expect(read.type).toBe('balanced');
  });

  it('leaves a champion unlabelled when either bucket is too thin', () => {
    // Plenty of long games, but under SCALING_MIN_BUCKET short ones.
    const games = [
      ...bucket('short', 'Rumble', SHORT, 2, 2),
      ...bucket('long', 'Rumble', LONG, 20, 5),
      // Filler so the quantile cut still has a spread to work with.
      ...bucket('filler-s', 'Gnar', SHORT, 10, 10),
      ...bucket('filler-l', 'Gnar', LONG, 10, 10),
    ];
    const { scalingByChampion } = deriveScaling(games);
    expect(scalingByChampion.has(makeChampion('Rumble')!.id)).toBe(false);
    expect(scalingByChampion.has(makeChampion('Gnar')!.id)).toBe(true);
  });

  it('reads nothing at all from an export with no game lengths', () => {
    const games = [
      ...bucket('short', 'Rumble', SHORT, 15, 5),
      ...bucket('long', 'Rumble', LONG, 5, 15),
    ].map((game) => ({ ...game, durationSeconds: null }));
    const { scalingByChampion, shortCutSeconds } = deriveScaling(games);
    expect(scalingByChampion.size).toBe(0);
    expect(shortCutSeconds).toBeNull();
  });

  it('cuts the buckets from the data rather than a fixed clock', () => {
    // Every game here is long by any absolute standard; the split still lands
    // inside this dataset's own spread.
    const games = [
      ...bucket('short', 'Rumble', 40 * 60, 5, 15),
      ...bucket('long', 'Rumble', 55 * 60, 15, 5),
    ];
    const { scalingByChampion, shortCutSeconds, longCutSeconds } = deriveScaling(games);
    expect(shortCutSeconds).toBeGreaterThanOrEqual(40 * 60);
    expect(longCutSeconds).toBeGreaterThan(shortCutSeconds!);
    expect(scalingByChampion.get(makeChampion('Rumble')!.id)!.type).toBe('late');
  });
});

describe('deriveEarlyGold', () => {
  /** Blue-side gold diff at 10/15/20/25, with blue winning or losing. */
  const g = (id: string, blueWins: boolean, checkpoints: (number | null)[], day = 0) =>
    makeGame({
      id,
      blue: 'A',
      red: 'B',
      winner: blueWins ? 'blue' : 'red',
      day,
      blueCheckpoints: checkpoints,
    });

  it('splits the early window into leading, level and behind', () => {
    // Blue: +2000 / +2000 (two leads), then −2000 / −2000, then +100 / −100.
    const games = [
      g('a', true, [2000, 2000, 0, 0], 0),
      g('b', false, [-2000, -2000, 0, 0], 1),
      g('c', true, [100, -100, 0, 0], 2),
    ];
    const profile = deriveEarlyGold(games).get('a')!;
    // Six observations: two ahead, two behind, two inside the ±500 band.
    expect(profile.sample).toBe(6);
    expect(profile.leadRate).toBeCloseTo(2 / 6, 10);
    expect(profile.behindRate).toBeCloseTo(2 / 6, 10);
    expect(profile.levelRate).toBeCloseTo(2 / 6, 10);
    expect(profile.minutes).toEqual([10, 15]);
  });

  it('only counts the 10 and 15 minute marks, since the export has nothing earlier', () => {
    // Huge swings at 20 and 25 must not touch the early shares.
    const games = Array.from({ length: 3 }, (_, i) =>
      g(`x-${i}`, true, [100, 100, 9000, 9000], i),
    );
    const profile = deriveEarlyGold(games).get('a')!;
    expect(profile.sample).toBe(6);
    expect(profile.levelRate).toBe(1);
    expect(profile.leadRate).toBe(0);
  });

  it('rates a comeback only when the lead came back and the game was won', () => {
    const games = [
      // Down 3000 at 10, leads again at 20, wins — a comeback.
      g('c1', true, [-3000, -3000, 500, 1000], 0),
      // Down 3000, leads again at 20, still loses — recovered but not a win.
      g('c2', false, [-3000, -3000, 500, 1000], 1),
      // Down 3000, never leads again, wins anyway — a late win, not a comeback.
      g('c3', true, [-3000, -3000, -900, -400], 2),
      // Down 3000 and loses.
      g('c4', false, [-3000, -3000, -2000, -3000], 3),
      g('c5', false, [-3000, -3000, -2000, -3000], 4),
    ];
    const profile = deriveEarlyGold(games).get('a')!;
    expect(profile.deficitSample).toBe(5);
    expect(profile.deficitGold).toBe(COMEBACK_DEFICIT);
    // c1 and c3 won; only c1 led again first.
    expect(profile.deficitWinRate).toBeCloseTo(2 / 5, 10);
    expect(profile.comebackRate).toBeCloseTo(1 / 5, 10);
  });

  it('withholds a comeback rate below the sample floor', () => {
    const games = [
      g('d1', true, [-3000, -3000, 500, 900], 0),
      ...Array.from({ length: 6 }, (_, i) => g(`e-${i}`, true, [100, 100, 0, 0], i + 1)),
    ];
    const profile = deriveEarlyGold(games).get('a')!;
    expect(profile.deficitSample).toBe(1);
    expect(profile.deficitWinRate).toBeNull();
    expect(profile.comebackRate).toBeNull();
  });

  it('ignores marks a game never reached rather than scoring them zero', () => {
    const games = Array.from({ length: 6 }, (_, i) =>
      g(`s-${i}`, true, [2000, null, null, null], i),
    );
    const profile = deriveEarlyGold(games).get('a')!;
    // Six games, but only the 10-minute mark ever exists — the missing 15s are
    // silent rather than counting as level.
    expect(profile.sample).toBe(6);
    expect(profile.leadRate).toBe(1);
    expect(profile.levelRate).toBe(0);
  });
});

describe('buildPredictorModel — champion records', () => {
  const aatrox = makeChampion('Aatrox')!;
  const games = [
    makeGame({ id: 'a', blue: 'T1', red: 'GenG', winner: 'blue', day: 0 }),
    makeGame({ id: 'b', blue: 'T1', red: 'GenG', winner: 'red', day: 5 }),
    makeGame({ id: 'c', blue: 'T1', red: 'GenG', winner: 'blue', day: 40, competition: 'WORLDS' }),
  ];

  it('counts wins per player, role and champion', () => {
    const model = buildPredictorModel(games);
    expect(model.playerCareerRecord.get(anywhereKey('T1-top', 'top', aatrox.id))).toEqual({
      wins: 2,
      games: 3,
    });
  });

  it('keeps a team-level record for when the roster is unknown', () => {
    const model = buildPredictorModel(games);
    expect(model.teamCareerRecord.get(anywhereKey('T1', 'top', aatrox.id))).toEqual({
      wins: 2,
      games: 3,
    });
  });

  it('scopes the split record to the split a player is currently in', () => {
    const model = buildPredictorModel([
      makeGame({ id: 'spring', blue: 'T1', red: 'GenG', winner: 'blue', day: 0, split: 'Spring' }),
      makeGame({ id: 'summer', blue: 'T1', red: 'GenG', winner: 'blue', day: 120, split: 'Summer' }),
    ]);
    expect(model.currentSplitOf.get(splitSubject('player', 'T1-top'))).toBe('2026|Summer');
    expect(model.playerSplitRecord.get(anywhereKey('T1-top', 'top', aatrox.id))).toEqual({
      wins: 1,
      games: 1,
    });
    // The career record still holds both.
    expect(model.playerCareerRecord.get(anywhereKey('T1-top', 'top', aatrox.id))!.games).toBe(2);
  });

  it('gives each league its own current split, not one global label', () => {
    // Split labels are per-league: the LCK is in "Summer" the same week the
    // LPL is in "Split 3". A single newest-label rule left the LPL with no
    // current-split record at all.
    const model = buildPredictorModel([
      makeGame({
        id: 'lpl',
        blue: 'BLG',
        red: 'JDG',
        winner: 'blue',
        day: 0,
        competition: 'LPL',
        split: 'Split 3',
      }),
      makeGame({ id: 'lck', blue: 'T1', red: 'GenG', winner: 'blue', day: 1, split: 'Summer' }),
    ]);
    expect(model.currentSplitOf.get(splitSubject('team', 'BLG'))).toBe('2026|Split 3');
    expect(model.currentSplitOf.get(splitSubject('team', 'T1'))).toBe('2026|Summer');
    expect(model.playerSplitRecord.get(anywhereKey('BLG-top', 'top', aatrox.id))!.games).toBe(1);
    expect(model.playerSplitRecord.get(anywhereKey('T1-top', 'top', aatrox.id))!.games).toBe(1);
  });

  it('does not carry a departed player’s record onto their replacement', () => {
    // Zeus loses four on Aatrox, Doran replaces him and wins three of four.
    const zeus = Array.from({ length: 4 }, (_, i) =>
      makeGame({
        id: `z${i}`,
        blue: 'T1',
        red: 'GenG',
        winner: 'red',
        day: i,
        bluePlayers: ['Zeus', 'Oner', 'Faker', 'Gumayusi', 'Keria'],
      }),
    );
    const doran = ['blue', 'blue', 'blue', 'red'].map((winner, i) =>
      makeGame({
        id: `d${i}`,
        blue: 'T1',
        red: 'GenG',
        winner: winner as Side,
        day: 10 + i,
        bluePlayers: ['Doran', 'Oner', 'Faker', 'Gumayusi', 'Keria'],
      }),
    );
    const model = buildPredictorModel([...zeus, ...doran]);

    expect(model.playerCareerRecord.get(anywhereKey('Zeus', 'top', aatrox.id))).toEqual({
      wins: 0,
      games: 4,
    });
    expect(model.playerCareerRecord.get(anywhereKey('Doran', 'top', aatrox.id))).toEqual({
      wins: 3,
      games: 4,
    });
    // The starter is the one who played most recently, so the scored read is
    // Doran's 3-4 rather than the team's combined 3-8.
    expect(model.rosters.get('t1')!.top).toBe('Doran');
    expect(model.teamCareerRecord.get(anywhereKey('T1', 'top', aatrox.id))).toEqual({
      wins: 3,
      games: 8,
    });
  });

  it('spans every enabled season, unlike the form reads', () => {
    const model = buildPredictorModel([
      makeGame({ id: 'old', blue: 'T1', red: 'GenG', winner: 'blue', day: 0, season: '2024' }),
      makeGame({ id: 'new', blue: 'T1', red: 'GenG', winner: 'blue', day: 400, season: '2026' }),
    ]);
    expect(model.playerCareerRecord.get(anywhereKey('T1-top', 'top', aatrox.id))!.games).toBe(2);
    expect(model.formSeason).toBe('2026');
  });
});

describe('buildPredictorModel — standings', () => {
  it('ranks by series win rate and records the streak', () => {
    const games = [
      ...series('s1', 'T1', 'GenG', ['blue', 'blue'], 0),
      ...series('s2', 'T1', 'KT', ['blue', 'blue'], 7),
      ...series('s3', 'GenG', 'KT', ['blue', 'blue'], 14),
    ];
    const model = buildPredictorModel(games);
    const table = model.standingsByCompetition.get('LCK')!;

    expect(table.get('t1')!.rank).toBe(1);
    expect(table.get('t1')!.seriesWon).toBe(2);
    expect(table.get('t1')!.seriesLost).toBe(0);
    expect(table.get('t1')!.streak).toBe('2W');
    expect(table.get('kt')!.seriesWon).toBe(0);
    expect(table.get('kt')!.seriesLost).toBe(2);
    expect(table.get('kt')!.streak).toBe('2L');
  });

  it('counts games as well as series', () => {
    // T1 win 2-1, so they take the series but drop a game.
    const model = buildPredictorModel(series('s1', 'T1', 'GenG', ['blue', 'red', 'blue'], 0));
    const table = model.standingsByCompetition.get('LCK')!;
    expect(table.get('t1')).toMatchObject({ seriesWon: 1, gamesWon: 2, gamesLost: 1 });
    expect(table.get('geng')).toMatchObject({ seriesLost: 1, gamesWon: 1, gamesLost: 2 });
  });

  it('scopes form to the most recent season', () => {
    const games = [
      ...series('old', 'T1', 'GenG', ['red', 'red'], 0, { season: '2025' }),
      ...series('new', 'T1', 'GenG', ['blue', 'blue'], 400, { season: '2026' }),
    ];
    const model = buildPredictorModel(games);
    expect(model.formSeason).toBe('2026');
    // Only the 2026 sweep counts; the 2025 loss is not in the table.
    expect(model.standingsByCompetition.get('LCK')!.get('t1')).toMatchObject({
      seriesWon: 1,
      seriesLost: 0,
    });
  });

  it('keeps a combined table across competitions', () => {
    const games = [
      ...series('a', 'T1', 'GenG', ['blue', 'blue'], 0),
      ...series('b', 'T1', 'G2', ['red', 'red'], 40, { competition: 'WORLDS' }),
    ];
    const model = buildPredictorModel(games);
    expect(model.standingsOverall.get('t1')).toMatchObject({ seriesWon: 1, seriesLost: 1 });
    expect(model.standingsByCompetition.get('LCK')!.get('t1')!.seriesWon).toBe(1);
    expect(model.standingsByCompetition.get('WORLDS')!.get('t1')!.seriesLost).toBe(1);
  });
});

describe('buildPredictorModel — behaviour', () => {
  it('reads side win rates once the sample is large enough', () => {
    // T1 on blue in six games, winning four.
    const games = Array.from({ length: 6 }, (_, i) =>
      makeGame({ id: `g${i}`, blue: 'T1', red: 'GenG', winner: i < 4 ? 'blue' : 'red', day: i * 3 }),
    );
    const model = buildPredictorModel(games);
    const t1 = model.behavior.get('t1')!;
    expect(t1.games).toBe(6);
    expect(t1.blueWinRate).toBeCloseTo(4 / 6, 10);
    expect(t1.redWinRate).toBeNull();
  });

  it('detects thrown leads from the gold checkpoints', () => {
    // Blue peaks above the decisive lead every game but loses four of five.
    const games = Array.from({ length: 5 }, (_, i) =>
      makeGame({
        id: `g${i}`,
        blue: 'T1',
        red: 'GenG',
        winner: i === 0 ? 'blue' : 'red',
        day: i * 3,
        blueGold: { peak: DECISIVE_GOLD + 500, trough: 0 },
      }),
    );
    const model = buildPredictorModel(games);
    const t1 = model.behavior.get('t1')!;
    expect(t1.throwSample).toBe(5);
    expect(t1.throwRate).toBeCloseTo(4 / 5, 10);
    // The mirrored deficit makes GenG the comeback team.
    const geng = model.behavior.get('geng')!;
    expect(geng.comebackSample).toBe(5);
    expect(geng.comebackRate).toBeCloseTo(4 / 5, 10);
  });

  it('leaves throw and comeback unknown when the export has no gold columns', () => {
    const games = Array.from({ length: 6 }, (_, i) =>
      makeGame({ id: `g${i}`, blue: 'T1', red: 'GenG', winner: 'blue', day: i * 3, blueGold: null }),
    );
    const behavior = buildPredictorModel(games).behavior.get('t1')!;
    expect(behavior.throwSample).toBe(0);
    expect(behavior.throwRate).toBeNull();
    expect(behavior.comebackRate).toBeNull();
  });

  it('weights recent games more heavily than old ones', () => {
    const rising = Array.from({ length: 8 }, (_, i) =>
      makeGame({ id: `r${i}`, blue: 'T1', red: 'GenG', winner: i < 4 ? 'red' : 'blue', day: i * 3 }),
    );
    const falling = Array.from({ length: 8 }, (_, i) =>
      makeGame({ id: `f${i}`, blue: 'T1', red: 'GenG', winner: i < 4 ? 'blue' : 'red', day: i * 3 }),
    );
    const up = buildPredictorModel(rising).behavior.get('t1')!.recentForm!;
    const down = buildPredictorModel(falling).behavior.get('t1')!.recentForm!;
    // Same 4-4 record, opposite trajectories.
    expect(up).toBeGreaterThan(0.5);
    expect(down).toBeLessThan(0.5);
  });

  it('scores a decider when a best-of-five reaches game five', () => {
    const games = series('s', 'T1', 'GenG', ['blue', 'red', 'blue', 'red', 'blue'], 0, {
      seriesFormat: 'BO5',
    });
    const model = buildPredictorModel(games);
    const t1 = model.behavior.get('t1')!;
    // 2-2 going into game five: a decider both sides played.
    expect(t1.deciderRate).toBeNull(); // one observation is below the sample floor
    expect(model.behavior.get('geng')!.chokeSample).toBe(0);
    // T1 led 2-1, lost game four, then won game five — a choke survived.
    expect(t1.chokeSample).toBe(1);
  });

  it('tracks the game-one win rate', () => {
    const games = [
      ...series('a', 'T1', 'GenG', ['blue', 'blue'], 0),
      ...series('b', 'T1', 'GenG', ['blue', 'blue'], 7),
      ...series('c', 'T1', 'GenG', ['red', 'red'], 14),
      ...series('d', 'T1', 'GenG', ['blue', 'blue'], 21),
    ];
    const t1 = buildPredictorModel(games).behavior.get('t1')!;
    expect(t1.game1Rate).toBeCloseTo(3 / 4, 10);
  });
});

describe('buildPredictorModel — rosters and pools', () => {
  it('takes the roster from each team most recent game', () => {
    const games = [
      makeGame({ id: 'old', blue: 'T1', red: 'GenG', winner: 'blue', day: 0 }),
      makeGame({ id: 'new', blue: 'T1', red: 'GenG', winner: 'blue', day: 30 }),
    ];
    const roster = buildPredictorModel(games).rosters.get('t1')!;
    expect(roster.top).toBe('T1-top');
    expect(Object.keys(roster)).toHaveLength(ROLES.length);
  });

  it('orders each role champion pool by how often it is picked', () => {
    // Aatrox tops for blue five times, Gnar for red once, Rumble once.
    const games = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeGame({
          id: `a${i}`,
          blue: 'T1',
          red: 'GenG',
          winner: 'blue',
          day: i,
          redDraft: ['Sion', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'],
        }),
      ),
      makeGame({
        id: 'rare',
        blue: 'T1',
        red: 'GenG',
        winner: 'blue',
        day: 9,
        blueDraft: ['Rumble', 'Viego', 'Azir', 'Jinx', 'Thresh'],
      }),
    ];
    const pool = buildPredictorModel(games).championsByRole.get('top')!;
    expect(pool.map((c) => c.name)).toEqual(['Aatrox', 'Sion', 'Gnar', 'Rumble']);
  });

  it('lists teams per competition', () => {
    const games = [
      makeGame({ id: 'a', blue: 'T1', red: 'GenG', winner: 'blue', day: 0 }),
      makeGame({ id: 'b', blue: 'G2', red: 'FNC', winner: 'blue', day: 1, competition: 'LEC' }),
    ];
    const model = buildPredictorModel(games);
    expect(model.teamsByCompetition.get('LCK')).toEqual(['GenG', 'T1']);
    expect(model.teamsByCompetition.get('LEC')).toEqual(['FNC', 'G2']);
    expect(model.allTeams).toEqual(['FNC', 'G2', 'GenG', 'T1']);
  });
});

describe('buildPredictorModel — early-game gold tempo', () => {
  /** `n` games where blue's 10-minute gold diff is exactly `diff`. */
  const runOf = (n: number, diff: number, team = 'T1', opp = 'GenG') =>
    Array.from({ length: n }, (_, i) =>
      makeGame({
        id: `${team}-${diff}-${i}`,
        blue: team,
        red: opp,
        winner: 'blue',
        day: i * 2,
        blueCheckpoints: [diff, diff, diff, diff],
      }),
    );

  it('averages the gold difference at each mark', () => {
    const model = buildPredictorModel(runOf(8, 500));
    const point = model.goldTempo.get('t1')!.find((p) => p.minute === 10)!;
    expect(point.averageDiff).toBe(500);
    expect(point.aheadRate).toBe(1);
    expect(point.sample).toBe(8);
  });

  it('mirrors the opponent read', () => {
    const model = buildPredictorModel(runOf(8, 500));
    const point = model.goldTempo.get('geng')!.find((p) => p.minute === 10)!;
    expect(point.averageDiff).toBe(-500);
    expect(point.aheadRate).toBe(0);
  });

  it('separates the average from how often a team is actually ahead', () => {
    // Nine small deficits and one huge lead: positive average, rarely ahead.
    const games = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeGame({
          id: `small-${i}`,
          blue: 'T1',
          red: 'GenG',
          winner: 'blue',
          day: i,
          blueCheckpoints: [-200, -200, -200, -200],
        }),
      ),
      makeGame({
        id: 'stomp',
        blue: 'T1',
        red: 'GenG',
        winner: 'blue',
        day: 20,
        blueCheckpoints: [8000, 8000, 8000, 8000],
      }),
    ];
    const point = buildPredictorModel(games).goldTempo.get('t1')!.find((p) => p.minute === 10)!;
    expect(point.averageDiff).toBeCloseTo(620, 5);
    expect(point.aheadRate).toBeCloseTo(0.1, 10);
  });

  it('ignores marks a game never reached instead of counting them as level', () => {
    // Every game ends before 25 minutes.
    const games = Array.from({ length: 8 }, (_, i) =>
      makeGame({
        id: `short-${i}`,
        blue: 'T1',
        red: 'GenG',
        winner: 'blue',
        day: i,
        blueCheckpoints: [600, 900, 1200, null],
      }),
    );
    const tempo = buildPredictorModel(games).goldTempo.get('t1')!;
    expect(tempo.map((p) => p.minute)).toEqual([10, 15, 20]);
    expect(tempo.find((p) => p.minute === 20)!.averageDiff).toBe(1200);
  });

  it('suppresses a mark with too few games to mean anything', () => {
    expect(buildPredictorModel(runOf(MIN_TEMPO_SAMPLE - 1, 400)).goldTempo.get('t1')).toBeUndefined();
    expect(buildPredictorModel(runOf(MIN_TEMPO_SAMPLE, 400)).goldTempo.get('t1')).toBeDefined();
  });

  it('skips games imported before checkpoints were captured', () => {
    const legacy = Array.from({ length: 8 }, (_, i) =>
      makeGame({
        id: `legacy-${i}`,
        blue: 'T1',
        red: 'GenG',
        winner: 'blue',
        day: i,
        blueGold: { peak: 2000, trough: -100 },
      }),
    );
    expect(buildPredictorModel(legacy).goldTempo.get('t1')).toBeUndefined();
  });

  it('scopes the read to the most recent season, like the other form reads', () => {
    const games = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeGame({
          id: `old-${i}`,
          blue: 'T1',
          red: 'GenG',
          winner: 'blue',
          day: i,
          season: '2025',
          blueCheckpoints: [-900, -900, -900, -900],
        }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        makeGame({
          id: `new-${i}`,
          blue: 'T1',
          red: 'GenG',
          winner: 'blue',
          day: 400 + i,
          season: '2026',
          blueCheckpoints: [700, 700, 700, 700],
        }),
      ),
    ];
    const point = buildPredictorModel(games).goldTempo.get('t1')!.find((p) => p.minute === 10)!;
    expect(point.averageDiff).toBe(700);
    expect(point.sample).toBe(8);
  });
});
