import { describe, expect, it } from 'vitest';
import {
  DECISIVE_GOLD,
  buildPredictorModel,
  deriveMeta,
  latestSeason,
  streakOf,
} from './derive.ts';
import { anywhereKey, recordKey } from './engine.ts';
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
  patch?: string;
  seriesFormat?: Game['seriesFormat'];
  blueDraft?: string[];
  redDraft?: string[];
  blueGold?: GoldDiffTrack | null;
  /** Minutes past midnight, so games in one series stay inside the 12h window. */
  hour?: number;
}

const DEFAULT_BLUE = ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Thresh'];
const DEFAULT_RED = ['Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'];

function makeGame(spec: GameSpec): Game {
  const build = (side: Side, teamName: string, draft: string[], gold: GoldDiffTrack | null) => ({
    side,
    teamName,
    teamId: null,
    tag: teamName.slice(0, 3).toUpperCase(),
    players: ROLES.map((role, index) => ({
      role,
      playerName: `${teamName}-${role}`,
      playerId: null,
      champion: makeChampion(draft[index]!)!,
    })),
    bans: [],
    goldDiff: gold,
  });

  const blueGold = spec.blueGold === undefined ? null : spec.blueGold;
  const redGold = blueGold ? { peak: -blueGold.trough, trough: -blueGold.peak } : null;

  return {
    gameId: spec.id,
    competition: spec.competition ?? 'LCK',
    sourceLeague: spec.competition ?? 'LCK',
    tournamentLabel: 'Test',
    season: spec.season ?? '2026',
    split: 'Spring',
    date: new Date(START + spec.day * DAY + (spec.hour ?? 0) * 3600_000).toISOString(),
    patch: spec.patch ?? '16.01',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: spec.seriesFormat ?? 'BO3',
    seriesFormatInferred: true,
    gameNumber: spec.gameNumber ?? 1,
    blue: build('blue', spec.blue, spec.blueDraft ?? DEFAULT_BLUE, blueGold),
    red: build('red', spec.red, spec.redDraft ?? DEFAULT_RED, redGold),
    winner: spec.winner,
    durationSeconds: 1800,
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
    const { metaByRole, patches } = deriveMeta(games);
    expect(patches).toEqual(['16.02']);
    expect(metaByRole.get('top')!.has(makeChampion('Aatrox')!.id)).toBe(true);
    expect(metaByRole.get('top')!.has(makeChampion('Rumble')!.id)).toBe(true);
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
});

describe('buildPredictorModel — champion records', () => {
  const games = [
    makeGame({ id: 'a', blue: 'T1', red: 'GenG', winner: 'blue', day: 0 }),
    makeGame({ id: 'b', blue: 'T1', red: 'GenG', winner: 'red', day: 5 }),
    makeGame({ id: 'c', blue: 'T1', red: 'GenG', winner: 'blue', day: 40, competition: 'WORLDS' }),
  ];

  it('counts wins per competition, team, role and champion', () => {
    const model = buildPredictorModel(games);
    const aatrox = makeChampion('Aatrox')!;
    expect(model.championRecord.get(recordKey('LCK', 'T1', 'top', aatrox.id))).toEqual({
      wins: 1,
      games: 2,
    });
    expect(model.championRecord.get(recordKey('WORLDS', 'T1', 'top', aatrox.id))).toEqual({
      wins: 1,
      games: 1,
    });
  });

  it('also keeps a competition-agnostic record', () => {
    const model = buildPredictorModel(games);
    const aatrox = makeChampion('Aatrox')!;
    expect(model.championRecordAnywhere.get(anywhereKey('T1', 'top', aatrox.id))).toEqual({
      wins: 2,
      games: 3,
    });
  });

  it('spans every enabled season, unlike the form reads', () => {
    const model = buildPredictorModel([
      makeGame({ id: 'old', blue: 'T1', red: 'GenG', winner: 'blue', day: 0, season: '2024' }),
      makeGame({ id: 'new', blue: 'T1', red: 'GenG', winner: 'blue', day: 400, season: '2026' }),
    ]);
    const aatrox = makeChampion('Aatrox')!;
    expect(model.championRecordAnywhere.get(anywhereKey('T1', 'top', aatrox.id))!.games).toBe(2);
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
