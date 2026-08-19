import { describe, expect, it } from 'vitest';
import {
  DECISIVE_GOLD,
  MIN_TEMPO_SAMPLE,
  buildPredictorModel,
  deriveMeta,
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
    bans: [],
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
    blue: build('blue', spec.blue, spec.blueDraft ?? DEFAULT_BLUE, blueGold, spec.bluePlayers),
    red: build('red', spec.red, spec.redDraft ?? DEFAULT_RED, redGold, spec.redPlayers),
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
