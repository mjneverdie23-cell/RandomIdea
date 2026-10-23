import { describe, expect, it } from 'vitest';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type CompetitionId, type Game, type Role, type StageKind } from '../domain/types.ts';
import { emptyPredictorModel } from './derive.ts';
import {
  callTournament,
  championsByRole,
  contestedChampions,
  gameCall,
  goldStory,
  pocketSummary,
  predictionInput,
  seriesCall,
  seriesLengthOf,
  stageGames,
  tournamentGames,
  tournamentOptions,
  tournamentRecords,
  tournamentStructure,
  verdict,
  type EventSeries,
  type GameCall,
} from './tournament.ts';
import type { PatchMeta } from './types.ts';

const BLUE_DRAFT = ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Thresh'];
const RED_DRAFT = ['Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'];
const START = Date.UTC(2026, 9, 1);
const HOUR = 3_600_000;

interface Spec {
  id: string;
  blue: string;
  red: string;
  winner: string;
  day: number;
  hour?: number;
  gameNumber?: number;
  kind?: StageKind;
  competition?: CompetitionId;
  season?: string;
  split?: string | null;
  league?: string;
  diffs?: (number | null)[];
  totals?: [number, number];
  seconds?: number | null;
  blueDraft?: string[];
  bans?: [string[], string[]];
}

function game(spec: Spec): Game {
  const side = (which: 'blue' | 'red', team: string, draft: string[], bans: string[]) => ({
    side: which,
    teamName: team,
    teamId: null,
    tag: team.slice(0, 3),
    players: ROLES.map((role, index) => ({
      role,
      playerName: `${team}-${role}`,
      playerId: null,
      champion: makeChampion(draft[index]!)!,
    })),
    bans: bans.map((name) => makeChampion(name)!),
    goldDiff:
      which === 'blue' && spec.diffs ? { checkpoints: spec.diffs, peak: 0, trough: 0 } : null,
    gold: spec.totals ? { at: [null, null, null, null], total: spec.totals[which === 'blue' ? 0 : 1] } : null,
  });
  const kind = spec.kind ?? 'group';
  const competition = spec.competition ?? 'WORLDS';
  return {
    gameId: spec.id,
    competition,
    sourceLeague: spec.league ?? 'WLDs',
    tournamentLabel: `${competition === 'OTHER' ? spec.league : competition} ${spec.season ?? '2026'}`,
    season: spec.season ?? '2026',
    split: spec.split === undefined ? 'Main Event' : spec.split,
    date: new Date(START + spec.day * 24 * HOUR + (spec.hour ?? 0) * HOUR).toISOString(),
    patch: '16.19',
    stage: { kind, label: kind, elimination: false },
    seriesFormat: 'BO3',
    seriesFormatInferred: true,
    gameNumber: spec.gameNumber ?? 1,
    blue: side('blue', spec.blue, spec.blueDraft ?? BLUE_DRAFT, spec.bans?.[0] ?? []),
    red: side('red', spec.red, RED_DRAFT, spec.bans?.[1] ?? []),
    winner: spec.winner === spec.blue ? 'blue' : 'red',
    durationSeconds: spec.seconds === undefined ? 1800 : spec.seconds,
    demo: false,
  };
}

/**
 * A 16-team Swiss — record-matched pools, out at three wins or three losses,
 * Bo3 when a team's place is on the line — then an eight-team bracket. The
 * stronger team (earlier letter) always wins, so every result is known.
 */
function worlds(options: { knockoutSeries?: number } = {}): Game[] {
  const teams = Array.from({ length: 16 }, (_, index) => `Team ${String.fromCharCode(65 + index)}`);
  const strength = (team: string) => teams.indexOf(team);
  const record = new Map(teams.map((team) => [team, { wins: 0, losses: 0 }]));
  const games: Game[] = [];
  let counter = 0;

  const play = (a: string, b: string, day: number, hour: number, count: number, kind: StageKind) => {
    const winner = strength(a) < strength(b) ? a : b;
    for (let number = 1; number <= count; number += 1) {
      const blue = number % 2 === 1 ? a : b;
      const red = blue === a ? b : a;
      counter += 1;
      games.push(game({ id: `g${counter}`, blue, red, winner, day, hour: hour + number, gameNumber: number, kind }));
    }
    return winner;
  };

  // Play-in: two teams that never reach the main event, so they don't disturb it.
  play('Play X', 'Play Y', -3, 0, 3, 'playin');

  let alive = [...teams];
  for (let round = 1; round <= 5; round += 1) {
    const pools = new Map<string, string[]>();
    for (const team of alive) {
      const { wins, losses } = record.get(team)!;
      const key = `${wins}-${losses}`;
      pools.set(key, [...(pools.get(key) ?? []), team]);
    }
    let hour = 0;
    for (const members of pools.values()) {
      for (let index = 0; index + 1 < members.length; index += 2) {
        const [a, b] = [members[index]!, members[index + 1]!];
        const stakes = record.get(a)!.wins === 2 || record.get(a)!.losses === 2;
        const winner = play(a, b, round, hour, stakes ? 2 : 1, 'group');
        hour += 3;
        const loser = winner === a ? b : a;
        record.get(winner)!.wins += 1;
        record.get(loser)!.losses += 1;
      }
    }
    alive = alive.filter((team) => record.get(team)!.wins < 3 && record.get(team)!.losses < 3);
  }

  const qualifiers = teams.filter((team) => record.get(team)!.wins === 3);
  let bracket = qualifiers;
  let day = 8;
  let played = 0;
  const limit = options.knockoutSeries ?? Infinity;
  while (bracket.length > 1 && played < limit) {
    const next: string[] = [];
    for (let index = 0; index < bracket.length / 2 && played < limit; index += 1) {
      next.push(play(bracket[index]!, bracket[bracket.length - 1 - index]!, day + index, 0, 3, 'playoffs'));
      played += 1;
    }
    bracket = next;
    day += 5;
  }
  return games;
}

const ids = (series: EventSeries[]) => series.map((entry) => entry.teams.join(' v '));

describe('tournamentOptions', () => {
  it('lists international events first, one per season, then leagues by split', () => {
    const games = [
      game({ id: 'a', blue: 'T1', red: 'Gen.G', winner: 'T1', day: 0, competition: 'LCK', split: 'Summer', league: 'LCK', kind: 'regular' }),
      game({ id: 'b', blue: 'T1', red: 'G2', winner: 'T1', day: 5, split: 'Play-In', kind: 'playin' }),
      game({ id: 'c', blue: 'T1', red: 'G2', winner: 'G2', day: 6, split: 'Main Event' }),
      // An event outside the configured leagues keeps its own name.
      game({ id: 'd', blue: 'T1', red: 'BLG', winner: 'T1', day: 9, competition: 'OTHER', league: 'Demacia Cup', split: null }),
    ];
    const options = tournamentOptions(games);
    expect(options.map((option) => [option.key, option.label, option.games, option.international])).toEqual([
      ['WORLDS|2026', 'Worlds 2026', 2, true],
      ['OTHER|Demacia Cup|2026', 'Demacia Cup 2026', 1, false],
      ['LCK|2026|Summer', 'LCK 2026', 1, false],
    ]);
    expect(tournamentGames(games, 'WORLDS|2026').map((g) => g.gameId)).toEqual(['b', 'c']);
  });
});

describe('tournamentStructure', () => {
  const structure = tournamentStructure(worlds());
  const stage = (id: string) => structure.stages.find((option) => option.id === id);

  it('reads a record-matched group phase as a Swiss and numbers its rounds', () => {
    expect(structure.group).toBe('swiss');
    expect([1, 2, 3, 4, 5].map((round) => stage(`round-${round}`)?.series.length)).toEqual([8, 8, 8, 6, 3]);
    expect(stage('group')?.series).toHaveLength(33);
  });

  it('labels each Swiss series with the pool it was played in', () => {
    const pools = stage('round-3')!.series.map((entry) => entry.pool);
    expect(pools.filter((pool) => pool === '2–0')).toHaveLength(2);
    expect(pools.filter((pool) => pool === '1–1')).toHaveLength(4);
    expect(pools.filter((pool) => pool === '0–2')).toHaveLength(2);
    expect(stage('round-5')!.series.every((entry) => entry.pool === '2–2')).toBe(true);
  });

  it('names the knockout rounds from the size of the bracket', () => {
    expect(structure.knockout).toBe('single');
    expect(stage('ko-quarterfinal')?.series).toHaveLength(4);
    expect(stage('ko-semifinal')?.series).toHaveLength(2);
    expect(ids(stage('ko-final')!.series)).toEqual(['Team A v Team B']);
    expect(stage('ko-final')!.series[0]!.winner).toBe('Team A');
  });

  it('offers the whole event, the main event, the play-in, each round and each knockout round', () => {
    expect(structure.stages.map((option) => option.id)).toEqual([
      'all',
      'main',
      'playin',
      'group',
      'round-1',
      'round-2',
      'round-3',
      'round-4',
      'round-5',
      'knockout',
      'ko-quarterfinal',
      'ko-semifinal',
      'ko-final',
    ]);
    expect(stageGames(stage('playin')!)).toHaveLength(3);
    expect(stage('main')!.series.some((entry) => entry.phase === 'playin')).toBe(false);
  });

  it('still calls the first knockout night a quarterfinal before the bracket fills in', () => {
    const partial = tournamentStructure(worlds({ knockoutSeries: 2 }));
    const knockout = partial.series.filter((entry) => entry.phase === 'knockout');
    expect(knockout.map((entry) => entry.round)).toEqual(['Quarterfinal', 'Quarterfinal']);
  });

  it('keeps a series together across its games and scores it', () => {
    const final = stage('ko-final')!.series[0]!;
    expect(final.games.map((g) => g.gameNumber)).toEqual([1, 2, 3]);
    expect(final.wins).toEqual([3, 0]);
  });

  it('does not read a round robin as a Swiss', () => {
    // Four teams, each playing every other once a day: rounds line up, records don't.
    const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
    const games: Game[] = [];
    let counter = 0;
    for (let day = 0; day < 5; day += 1) {
      for (let index = 0; index < teams.length; index += 2) {
        const [a, b] = [teams[index]!, teams[index + 1]!];
        counter += 1;
        games.push(game({ id: `r${counter}`, blue: a, red: b, winner: counter % 3 ? a : b, day, hour: index }));
      }
      // Rotate everyone but the first team, as a round-robin schedule does.
      teams.splice(1, 0, teams.pop()!);
    }
    const read = tournamentStructure(games);
    expect(read.group).toBe('group');
    expect(read.stages.map((option) => option.id)).toEqual(['all', 'group']);
    expect(read.series[0]!.round).toBe('Group stage');
  });

  it('leaves a double-elimination bracket unsplit', () => {
    const games = [
      game({ id: 'k1', blue: 'A', red: 'B', winner: 'A', day: 0, kind: 'playoffs' }),
      game({ id: 'k2', blue: 'C', red: 'D', winner: 'C', day: 1, kind: 'playoffs' }),
      // The loser of the first series plays again: a lower bracket.
      game({ id: 'k3', blue: 'B', red: 'D', winner: 'B', day: 2, kind: 'playoffs' }),
    ];
    const read = tournamentStructure(games);
    expect(read.knockout).toBe('bracket');
    expect(read.series.map((entry) => entry.round)).toEqual(['Bracket', 'Bracket', 'Bracket']);
    expect(read.stages.map((option) => option.id)).toEqual(['all', 'knockout']);
  });

  it('takes round names from the export when it has them', () => {
    const games = [
      game({ id: 's1', blue: 'A', red: 'B', winner: 'A', day: 0, kind: 'semifinal' }),
      game({ id: 'f1', blue: 'A', red: 'C', winner: 'C', day: 3, kind: 'final' }),
    ];
    const read = tournamentStructure(games);
    expect(read.series.map((entry) => entry.round)).toEqual(['Semifinal', 'Final']);
    expect(read.stages.map((option) => option.label)).toEqual(['Whole event', 'All knockouts', 'Semifinals', 'Final']);
  });
});

describe('champions', () => {
  const games = [
    game({ id: 'a', blue: 'T1', red: 'G2', winner: 'T1', day: 0, bans: [['Rell', 'Yone'], ['Rell', 'Jax']] }),
    game({ id: 'b', blue: 'T1', red: 'G2', winner: 'G2', day: 1, blueDraft: ['Rumble', 'Viego', 'Azir', 'Jinx', 'Thresh'], bans: [['Yone'], []] }),
  ];

  it('counts picks and wins per role, most picked first', () => {
    const top = championsByRole(games).top;
    expect(top.map((line) => [line.champion.id, line.picks, line.wins])).toEqual([
      ['Gnar', 2, 1],
      ['Aatrox', 1, 1],
      ['Rumble', 1, 0],
    ]);
    expect(top[0]!.players).toEqual([{ name: 'G2-top', team: 'G2', games: 2 }]);
  });

  it('ranks the most banned and gives presence over games', () => {
    const contested = contestedChampions(games);
    expect(contested.slice(0, 2).map((line) => [line.champion.id, line.bans])).toEqual([
      ['Rell', 2],
      ['Yone', 2],
    ]);
    expect(contested.find((line) => line.champion.id === 'Viego')!.presence).toBe(1);
  });

  it('collects pocket picks against each game\'s patch, with draft win rates', () => {
    const meta: Map<string, PatchMeta> = new Map([
      [
        '16.19',
        new Map<Role, Set<string>>(ROLES.map((role, index) => [role, new Set([BLUE_DRAFT[index]!, RED_DRAFT[index]!])])),
      ],
    ]);
    const pockets = pocketSummary(games, meta);
    expect(pockets.lines.map((line) => [line.role, line.champion.id, line.picks, line.wins])).toEqual([['top', 'Rumble', 1, 0]]);
    expect(pockets).toMatchObject({ judged: 4, pocketDrafts: 1, pocketWins: 0, metaDrafts: 3, metaWins: 2 });
  });
});

describe('goldStory', () => {
  it('finds a comeback, each side\'s biggest lead and the end gap', () => {
    // Blue trails by 2,400 at 15, takes over late and wins.
    const story = goldStory(
      game({ id: 'c', blue: 'A', red: 'B', winner: 'A', day: 0, diffs: [-800, -2400, 300, 1500], totals: [70_000, 64_500], seconds: 1950 }),
    )!;
    expect(story.points).toEqual([
      { minute: 0, diff: 0 },
      { minute: 10, diff: -800 },
      { minute: 15, diff: -2400 },
      { minute: 20, diff: 300 },
      { minute: 25, diff: 1500 },
      { minute: 32.5, diff: 5500 },
    ]);
    expect(story.hasEnd).toBe(true);
    expect(story.comeback).toEqual({ amount: 2400, minute: 15 });
    expect(story.biggestLead).toEqual({ blue: { amount: 5500, minute: 32.5 }, red: { amount: 2400, minute: 15 } });
    expect(story.endDiff).toBe(5500);
  });

  it('reads from the winner\'s side when red wins, and skips marks the game never reached', () => {
    const story = goldStory(game({ id: 'r', blue: 'A', red: 'B', winner: 'B', day: 0, diffs: [1200, -500, null, null], seconds: 1150 }))!;
    expect(story.comeback).toEqual({ amount: 1200, minute: 10 });
    expect(story.hasEnd).toBe(false);
    expect(story.endDiff).toBeNull();
  });

  it('has no story without gold data', () => {
    expect(goldStory(game({ id: 'n', blue: 'A', red: 'B', winner: 'A', day: 0 }))).toBeNull();
  });
});

describe('tournamentRecords', () => {
  it('ranks comebacks and 15-minute leads, and says whether the lead held', () => {
    const games = [
      game({ id: 'x', blue: 'A', red: 'B', winner: 'A', day: 0, diffs: [-500, -3000, -1000, 2000] }),
      game({ id: 'y', blue: 'C', red: 'D', winner: 'D', day: 1, diffs: [600, 1800, 2500, null], seconds: 1300 }),
    ];
    const records = tournamentRecords(games);
    // D won from behind as well: 2,500 down at 20.
    expect(records.comebacks.map((moment) => [moment.team, moment.amount, moment.minute])).toEqual([
      ['A', 3000, 15],
      ['D', 2500, 20],
    ]);
    expect(records.leadsAt15.map((moment) => [moment.team, moment.amount, moment.held])).toEqual([
      ['B', 3000, false],
      ['C', 1800, false],
    ]);
    expect(records.fastest[0]!.gameId).toBe('y');
    expect(records.blueWins).toBe(1);
  });
});

describe('predictions', () => {
  const event = worlds();
  const structure = tournamentStructure(event);
  const final = structure.stages.find((option) => option.id === 'ko-final')!.series[0]!;

  it('plays a knockout at its format even when it was a sweep', () => {
    expect(seriesLengthOf(final)).toBe('BO5');
    const opener = structure.stages.find((option) => option.id === 'round-1')!.series[0]!;
    expect(seriesLengthOf(opener)).toBe('BO1');
    const decider = structure.stages.find((option) => option.id === 'round-4')!.series[0]!;
    expect(seriesLengthOf(decider)).toBe('BO3');
  });

  it('gives the score going into a game, never the game itself', () => {
    const third = final.games[2]!;
    const input = predictionInput(third, final);
    expect(input.gameNumber).toBe(3);
    // Team A won games 1 and 2; game 3 sits blue for Team A again.
    expect([input.blue.team, input.scoreBlue, input.scoreRed]).toEqual(['Team A', 2, 0]);
    expect(input.blue.champions.map((champion) => champion?.id)).toEqual(BLUE_DRAFT);
    expect(predictionInput(final.games[0]!, final)).toMatchObject({ scoreBlue: 0, scoreRed: 0, gameNumber: 1 });
  });

  it('builds each day\'s model only from games before that day began', async () => {
    const other = game({ id: 'lck', blue: 'T1', red: 'Gen.G', winner: 'T1', day: -10, competition: 'LCK', kind: 'regular' });
    const all = [...event, other].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const seen: Game[][] = [];
    const progress: number[] = [];
    const calls = await callTournament(
      all,
      structure.series,
      (history) => {
        seen.push(history);
        return emptyPredictorModel();
      },
      { onProgress: (done) => progress.push(done) },
    );
    expect(calls!.size).toBe(event.length);
    const days = new Set(event.map((g) => g.date.slice(0, 10)));
    expect(seen).toHaveLength(days.size);
    expect(progress.at(-1)).toBe(days.size);
    // The first model sees only the league game; none sees its own day.
    expect(seen[0]!.map((g) => g.gameId)).toEqual(['lck']);
    for (const history of seen) {
      const newest = Math.max(...history.map((g) => Date.parse(g.date)));
      const later = event.filter((g) => Date.parse(g.date) > newest);
      const sameDay = later.filter((g) => g.date.slice(0, 10) === new Date(newest).toISOString().slice(0, 10));
      expect(sameDay.every((g) => !history.includes(g))).toBe(true);
    }
  });

  it('stops when cancelled', async () => {
    const calls = await callTournament(event, structure.series, () => emptyPredictorModel(), { cancelled: () => true });
    expect(calls).toBeNull();
  });

  it('grades calls as expected, upsets or toss-ups', () => {
    expect(verdict(0.52, false)).toBe('toss-up');
    expect(verdict(0.62, true)).toBe('expected');
    expect(verdict(0.62, false)).toBe('upset');
    expect(verdict(0.75, false)).toBe('big upset');

    const opener = final.games[0]!;
    const call: GameCall = { probBlue: 0.3, seriesProbBlue: 0.25, favourite: 'red' };
    expect(gameCall(opener, call)).toEqual({ favourite: 'Team B', underdog: 'Team A', probability: 0.7, verdict: 'big upset' });
    expect(seriesCall(final, new Map([[opener.gameId, call]]))).toEqual({
      favourite: 'Team B',
      underdog: 'Team A',
      probability: 0.75,
      verdict: 'big upset',
    });
    expect(gameCall(opener, { probBlue: 0.5, seriesProbBlue: 0.5, favourite: null })).toBeNull();
  });
});
