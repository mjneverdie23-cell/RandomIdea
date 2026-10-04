import { describe, expect, it } from 'vitest';
import {
  buildPasteMatch,
  championDisplayName,
  chooseGame,
  competitionFor,
  liveMatches,
  pasteText,
  readEventDetails,
  readWindow,
  recentMatches,
  snapTeamName,
  teamsFromSeasons,
} from '../../scripts/lib/lolesports.mjs';
import { makeChampion } from '../domain/champions.ts';
import { resolveCompetition } from '../domain/competitions.ts';
import { parseMatchText } from './matchImport.ts';

/*
 * Recorded-shape fixtures: trimmed to the fields the puller reads, in the
 * structure lolesports.com's own feeds return.
 */

const T1 = { id: '98767991853197861', name: 'T1', code: 'T1' };
const HLE = { id: '100205573495116443', name: 'Hanwha Life Esports', code: 'HLE' };

const getLive = {
  data: {
    schedule: {
      events: [
        {
          id: '113503303285447053',
          startTime: '2026-09-20T08:00:00Z',
          state: 'inProgress',
          type: 'match',
          blockName: 'Playoffs - Round 3',
          league: { name: 'LCK', slug: 'lck' },
          match: {
            id: '113503303285447053',
            teams: [
              { ...T1, result: { outcome: null, gameWins: 2 } },
              { ...HLE, result: { outcome: null, gameWins: 0 } },
            ],
            strategy: { type: 'bestOf', count: 5 },
          },
        },
        { id: 'show-1', type: 'show', state: 'inProgress', league: { name: 'LCK', slug: 'lck' } },
        {
          id: '113503303285447999',
          startTime: '2026-09-20T17:00:00Z',
          state: 'inProgress',
          type: 'match',
          blockName: 'Week 3',
          league: { name: 'LEC', slug: 'lec' },
          match: {
            id: '113503303285447999',
            teams: [
              { name: 'G2 Esports', code: 'G2', result: { gameWins: 0 } },
              { name: 'Fnatic', code: 'FNC', result: { gameWins: 0 } },
            ],
            strategy: { type: 'bestOf', count: 1 },
          },
        },
      ],
    },
  },
};

const eventDetails = {
  data: {
    event: {
      id: '113503303285447053',
      type: 'match',
      league: { name: 'LCK', slug: 'lck' },
      match: {
        strategy: { count: 5 },
        teams: [
          { ...T1, result: { gameWins: 2 } },
          { ...HLE, result: { gameWins: 0 } },
        ],
        games: [
          { number: 1, id: '113503303285447054', state: 'completed', teams: [{ id: T1.id, side: 'blue' }, { id: HLE.id, side: 'red' }] },
          { number: 2, id: '113503303285447055', state: 'completed', teams: [{ id: HLE.id, side: 'blue' }, { id: T1.id, side: 'red' }] },
          { number: 3, id: '113503303285447056', state: 'inProgress', teams: [{ id: HLE.id, side: 'blue' }, { id: T1.id, side: 'red' }] },
          { number: 4, id: '113503303285447057', state: 'unstarted', teams: [] },
          { number: 5, id: '113503303285447058', state: 'unstarted', teams: [] },
        ],
      },
    },
  },
};

const participant = (id: number, name: string, championId: string, role: string) => ({
  participantId: id,
  esportsPlayerId: String(1000 + id),
  summonerName: name,
  championId,
  role,
});

const windowJson = {
  esportsGameId: '113503303285447056',
  gameMetadata: {
    patchVersion: '26.18.712.4455',
    blueTeamMetadata: {
      esportsTeamId: HLE.id,
      participantMetadata: [
        participant(1, 'HLE Zeus', 'KSante', 'top'),
        participant(2, 'HLE Kanavi', 'MonkeyKing', 'jungle'),
        participant(3, 'HLE Zeka', 'Viktor', 'mid'),
        participant(4, 'HLE Viper', 'Kaisa', 'bottom'),
        participant(5, 'HLE Delight', 'Rakan', 'support'),
      ],
    },
    redTeamMetadata: {
      esportsTeamId: T1.id,
      participantMetadata: [
        participant(6, 'T1 Doran', 'Jax', 'top'),
        participant(7, 'T1 Oner', 'Nocturne', 'jungle'),
        participant(8, 'T1 Faker', 'Azir', 'mid'),
        participant(9, 'T1 Gumayusi', 'MissFortune', 'bottom'),
        participant(10, 'T1 Keria', 'TahmKench', 'support'),
      ],
    },
  },
  frames: [
    {
      rfc460Timestamp: '2026-09-20T10:31:00.000Z',
      gameState: 'in_game',
      blueTeam: { totalGold: 24100, totalKills: 4, towers: 1 },
      redTeam: { totalGold: 25300, totalKills: 6, towers: 2 },
    },
  ],
};

const seasons = [
  {
    games: [
      { competition: 'LCK', blue: { teamName: 'T1', tag: 'T1' }, red: { teamName: 'Hanwha Life Esports', tag: 'HLE' } },
      { competition: 'LCK', blue: { teamName: 'BNK FearX', tag: 'BFX' }, red: { teamName: 'Gen.G', tag: 'GEN' } },
      { competition: 'LCK', blue: { teamName: 'OKSavingsBank BRION', tag: 'BRO' }, red: { teamName: 'T1', tag: 'T1' } },
    ],
  },
];

function pullThirdGame(known = teamsFromSeasons(seasons)) {
  const details = readEventDetails(eventDetails)!;
  const game = chooseGame(details)!;
  const codes = Object.fromEntries(details.teams.map((team) => [team.id, team.code]));
  const draft = readWindow(windowJson, codes)!;
  return { details, game, draft, ...buildPasteMatch({ details, game, draft, startTime: draft.live!.at, blockName: 'Playoffs - Round 3', known }) };
}

describe('listing matches', () => {
  it('keeps matches, drops shows, and filters by league slug or name', () => {
    expect(liveMatches(getLive).map((m) => m.matchId)).toEqual(['113503303285447053', '113503303285447999']);
    expect(liveMatches(getLive, ['lck']).map((m) => m.league?.slug)).toEqual(['lck']);
    expect(liveMatches(getLive, ['LEC']).map((m) => m.teams[0]!.name)).toEqual(['G2 Esports']);
    const [lck] = liveMatches(getLive);
    expect(lck).toMatchObject({ bestOf: 5, blockName: 'Playoffs - Round 3' });
    expect(lck!.teams.map((t) => t.wins)).toEqual([2, 0]);
  });

  it('lists finished matches newest first', () => {
    const done = (id: string, day: string) => ({
      ...getLive.data.schedule.events[0],
      id,
      state: 'completed',
      startTime: `2026-09-${day}T08:00:00Z`,
      match: { ...getLive.data.schedule.events[0]!.match, id },
    });
    const schedule = { data: { schedule: { events: [done('a', '10'), done('b', '12'), { ...done('c', '14'), state: 'unstarted' }] } } };
    expect(recentMatches(schedule).map((m) => m.matchId)).toEqual(['b', 'a']);
  });
});

describe('choosing the game', () => {
  const details = readEventDetails(eventDetails)!;

  it('takes the game in progress', () => {
    expect(chooseGame(details)!.number).toBe(3);
  });

  it('takes a named game, or the last finished one when none is live', () => {
    expect(chooseGame(details, 1)!.id).toBe('113503303285447054');
    const between = { ...details, games: details.games.map((g) => (g.number === 3 ? { ...g, state: 'unstarted' } : g)) };
    expect(chooseGame(between)!.number).toBe(2);
    expect(chooseGame(details, 9)).toBeNull();
  });
});

describe('reading the draft', () => {
  it('gives each role its champion, with readable names and bare player names', () => {
    const { draft } = pullThirdGame();
    expect(draft.blue.picks).toEqual({ top: "K'Sante", jungle: 'Wukong', mid: 'Viktor', bot: "Kai'Sa", support: 'Rakan' });
    expect(draft.red.picks.bot).toBe('Miss Fortune');
    expect(draft.red.players.mid).toBe('Faker');
    expect(draft.patch).toBe('26.18.712.4455');
    expect(draft.live!.gold).toEqual([24100, 25300]);
  });

  it('has nothing before the game loads', () => {
    expect(readWindow(null)).toBeNull();
    expect(readWindow({ gameMetadata: {} })).toBeNull();
  });

  it('names champions so the app lands on the same champion the feed meant', () => {
    const keys = ['MonkeyKing', 'KSante', 'Chogath', 'Kaisa', 'Khazix', 'Leblanc', 'Velkoz', 'Belveth', 'Nunu',
      'Renata', 'DrMundo', 'JarvanIV', 'MissFortune', 'RekSai', 'KogMaw', 'TahmKench', 'XinZhao', 'AurelionSol', 'Ahri'];
    for (const key of keys) expect(makeChampion(championDisplayName(key))!.id).toBe(key);
  });
});

describe('the paste', () => {
  it('loads cleanly in the Predictor’s own importer', () => {
    const { match, warnings } = pullThirdGame();
    expect(warnings).toEqual([]);

    const imported = parseMatchText(pasteText([match]));
    expect(imported.warnings).toEqual([]);
    const [m] = imported.matches;
    expect(m).toMatchObject({
      competition: 'LCK',
      stage: 'playoffs',
      seriesLength: 'BO5',
      gameNumber: 3,
      date: '2026-09-20',
    });
    expect(m!.blue.team).toBe('Hanwha Life Esports');
    expect(m!.red.team).toBe('T1');
    expect(m!.blue.champions.map((c) => c?.id)).toEqual(['KSante', 'MonkeyKing', 'Viktor', 'Kaisa', 'Rakan']);
    expect(m!.red.champions.map((c) => c?.id)).toEqual(['Jax', 'Nocturne', 'Azir', 'MissFortune', 'TahmKench']);
  });

  it('puts the running series score on the sides of this game', () => {
    // T1 lead 2-0 and are on red in game 3.
    const { match } = pullThirdGame();
    expect(match.score).toEqual([0, 2]);
    const [m] = parseMatchText(pasteText([match])).matches;
    expect([m!.scoreBlue, m!.scoreRed]).toEqual([0, 2]);
  });

  it('leaves the score out for a finished game and says so', () => {
    const details = readEventDetails(eventDetails)!;
    const game = chooseGame(details, 2)!;
    const draft = readWindow(windowJson, {})!;
    const { match, warnings } = buildPasteMatch({ details, game, draft });
    expect(match.score).toBeUndefined();
    expect(match.game).toBe(2);
    expect(warnings.join(' ')).toMatch(/series score before it isn't in the feed/);
  });

  it('maps league slugs onto the app’s competitions', () => {
    expect(resolveCompetition(competitionFor({ slug: 'lck_challengers_league', name: 'LCK Challengers' }))).toBe('LCK_CL');
    expect(resolveCompetition(competitionFor({ slug: 'first_stand', name: 'First Stand' }))).toBe('FIRST_STAND');
    expect(resolveCompetition(competitionFor({ slug: 'lpl', name: 'LPL' }))).toBe('LPL');
    expect(resolveCompetition(competitionFor({ slug: 'cblol-brazil', name: 'CBLOL' }))).toBe('CBLOL');
  });
});

describe('matching team names to your data', () => {
  const known = teamsFromSeasons(seasons);

  it('reads every team once from the season files', () => {
    expect(known.map((t) => t.name)).toEqual(['T1', 'Hanwha Life Esports', 'BNK FearX', 'Gen.G', 'OKSavingsBank BRION']);
  });

  it('matches through spelling, code and partial names, and says which', () => {
    expect(snapTeamName('T1', 'T1', known)).toEqual({ name: 'T1', via: 'exact' });
    expect(snapTeamName('BNK FEARX', 'BFX', known)).toEqual({ name: 'BNK FearX', via: 'spelling' });
    expect(snapTeamName('Hanwha Life', 'HLE', known)).toEqual({ name: 'Hanwha Life Esports', via: 'code' });
    expect(snapTeamName('BRION', 'BRO2', known)).toEqual({ name: 'OKSavingsBank BRION', via: 'partial' });
    expect(snapTeamName('Nongshim RedForce', 'NS', known)).toEqual({ name: 'Nongshim RedForce', via: null });
    expect(snapTeamName('Nongshim RedForce', 'NS', known, { 'NONGSHIM REDFORCE': 'NS RedForce' })).toEqual({
      name: 'NS RedForce',
      via: 'alias',
    });
  });

  it('warns about a team it cannot place, and not without a data folder', () => {
    const renamed = { ...eventDetails.data.event, match: { ...eventDetails.data.event.match, teams: [
      { ...T1, result: { gameWins: 2 } },
      { ...HLE, name: 'Mystery Squad', code: 'MYS', result: { gameWins: 0 } },
    ] } };
    const details = readEventDetails({ data: { event: renamed } })!;
    const game = chooseGame(details)!;
    const draft = readWindow(windowJson, {})!;
    expect(buildPasteMatch({ details, game, draft, known }).warnings.join(' ')).toMatch(/"Mystery Squad" is not a team in your data/);
    expect(buildPasteMatch({ details, game, draft, known: [] }).warnings).toEqual([]);
  });
});
