import { describe, expect, it } from 'vitest';
import { readLive } from './liveDraft.ts';

/* Shaped like lolesports.com's own feeds, trimmed to what is read. */

const T1 = { id: '98767991853197861', name: 'T1', code: 'T1' };
const HLE = { id: '100205573495116443', name: 'Hanwha Life Esports', code: 'HLE' };

function details(games: { number: number; state: string; blue?: string; red?: string }[], wins: [number, number]) {
  return {
    data: {
      event: {
        id: '113503303285447053',
        type: 'match',
        blockName: 'Playoffs - Round 3',
        league: { name: 'LCK', slug: 'lck' },
        match: {
          strategy: { count: 5 },
          teams: [
            { ...T1, result: { gameWins: wins[0] } },
            { ...HLE, result: { gameWins: wins[1] } },
          ],
          games: games.map((game) => ({
            number: game.number,
            id: `g${game.number}`,
            state: game.state,
            teams: game.blue && game.red ? [{ id: game.blue, side: 'blue' }, { id: game.red, side: 'red' }] : [],
          })),
        },
      },
    },
  };
}

const participant = (id: number, name: string, championId: string, role: string) => ({
  participantId: id,
  summonerName: name,
  championId,
  role,
});

const windowJson = {
  esportsGameId: 'g3',
  gameMetadata: {
    patchVersion: '26.20.1',
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
      rfc460Timestamp: '2026-10-26T10:31:00.000Z',
      gameState: 'in_game',
      blueTeam: { totalGold: 24100, totalKills: 4, towers: 1 },
      redTeam: { totalGold: 25300, totalKills: 6, towers: 2 },
    },
  ],
};

const known = [
  { name: 'T1', tag: 'T1', competition: 'LCK' },
  { name: 'Hanwha Life Esports', tag: 'HLE', competition: 'LCK' },
];

const gameThree = details(
  [
    { number: 1, state: 'completed', blue: T1.id, red: HLE.id },
    { number: 2, state: 'completed', blue: HLE.id, red: T1.id },
    { number: 3, state: 'inProgress', blue: HLE.id, red: T1.id },
    { number: 4, state: 'unstarted' },
    { number: 5, state: 'unstarted' },
  ],
  [2, 0],
);

describe('readLive', () => {
  it('fills the composer with the live game: teams on their sides, score going in, every champion', () => {
    const read = readLive(gameThree, windowJson, known)!;
    expect(read.state).toBe('drafted');
    expect(read.game?.number).toBe(3);
    const composer = read.composer!;
    expect([composer.blue.team, composer.red.team]).toEqual(['Hanwha Life Esports', 'T1']);
    expect([composer.scoreBlue, composer.scoreRed, composer.seriesLength]).toEqual([0, 2, 'BO5']);
    expect(composer.blue.competition).toBe('LCK');
    // Feed keys (`MonkeyKing`, `Kaisa`) come through as the app's own champions.
    expect(composer.blue.champions.map((champion) => champion?.id)).toEqual(['KSante', 'MonkeyKing', 'Viktor', 'Kaisa', 'Rakan']);
    expect(composer.red.champions.map((champion) => champion?.id)).toEqual(['Jax', 'Nocturne', 'Azir', 'MissFortune', 'TahmKench']);
    expect(read.inGame).toMatchObject({ gold: [24100, 25300], kills: [4, 6], towers: [1, 2] });
    expect(read.warnings).toEqual([]);
  });

  it('fills teams and score before the game loads, and changes fingerprint when champions arrive', () => {
    const early = readLive(gameThree, null, known)!;
    expect(early.state).toBe('loading');
    expect([early.composer!.blue.team, early.composer!.red.team]).toEqual(['Hanwha Life Esports', 'T1']);
    expect(early.composer!.blue.champions.every((champion) => champion === null)).toBe(true);
    // Empty lanes are expected at this point, not a warning.
    expect(early.warnings).toEqual([]);
    const late = readLive(gameThree, windowJson, known)!;
    expect(late.fingerprint).not.toBe(early.fingerprint);
    expect(readLive(gameThree, windowJson, known)!.fingerprint).toBe(late.fingerprint);
  });

  it('waits between games and says which is next', () => {
    const between = details(
      [
        { number: 1, state: 'completed', blue: T1.id, red: HLE.id },
        { number: 2, state: 'completed', blue: HLE.id, red: T1.id },
        { number: 3, state: 'unstarted' },
        { number: 4, state: 'unstarted' },
        { number: 5, state: 'unstarted' },
      ],
      [1, 1],
    );
    expect(readLive(between, null, known)).toMatchObject({ state: 'waiting', next: 3, composer: null });
  });

  it('knows when the series is over', () => {
    const done = details(
      [
        { number: 1, state: 'completed', blue: T1.id, red: HLE.id },
        { number: 2, state: 'completed', blue: HLE.id, red: T1.id },
        { number: 3, state: 'completed', blue: HLE.id, red: T1.id },
        { number: 4, state: 'unstarted' },
        { number: 5, state: 'unstarted' },
      ],
      [3, 0],
    );
    expect(readLive(done, null, known)).toMatchObject({ state: 'finished', next: null });
  });

  it('says when a team is not in your data', () => {
    const read = readLive(gameThree, windowJson, [known[0]!])!;
    expect(read.warnings.some((warning) => warning.includes('"Hanwha Life Esports" is not a team in your data'))).toBe(true);
  });

  it('reads nothing from a response without a match', () => {
    expect(readLive({ data: {} }, null, known)).toBeNull();
  });
});
