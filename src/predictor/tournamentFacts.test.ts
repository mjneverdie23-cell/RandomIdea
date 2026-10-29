import { describe, expect, it } from 'vitest';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type CompetitionId, type Game } from '../domain/types.ts';
import { currentTournament, pickFacts } from './tournamentFacts.ts';

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 10);

interface Spec {
  id: string;
  day: number;
  blue: string;
  red: string;
  blueWins: boolean;
  blueDraft?: string[];
  redDraft?: string[];
  blueBans?: string[];
  competition?: CompetitionId;
  season?: string;
}

const BLUE = ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Rell'];
const RED = ['Gnar', 'Vi', 'Orianna', 'Ezreal', 'Nautilus'];

function game(spec: Spec): Game {
  const side = (which: 'blue' | 'red', team: string, draft: string[], bans: string[]) => ({
    side: which,
    teamName: team,
    teamId: null,
    tag: team,
    players: ROLES.map((role, index) => ({
      role,
      playerName: `${team}-${role}`,
      playerId: null,
      champion: makeChampion(draft[index]!)!,
    })),
    bans: bans.map((name) => makeChampion(name)!),
  });
  const competition = spec.competition ?? 'WORLDS';
  return {
    gameId: spec.id,
    competition,
    sourceLeague: competition,
    tournamentLabel: `${competition} ${spec.season ?? '2026'}`,
    season: spec.season ?? '2026',
    split: 'Main Event',
    date: new Date(START + spec.day * DAY).toISOString(),
    patch: '16.20',
    stage: { kind: 'group', label: 'Group', elimination: false },
    seriesFormat: 'BO1',
    seriesFormatInferred: true,
    gameNumber: 1,
    blue: side('blue', spec.blue, spec.blueDraft ?? BLUE, spec.blueBans ?? []),
    red: side('red', spec.red, spec.redDraft ?? RED, []),
    winner: spec.blueWins ? 'blue' : 'red',
    durationSeconds: 1800,
    demo: false,
  };
}

const lastYear = game({ id: 'old', day: -365, blue: 'T1', red: 'G2', blueWins: true, season: '2025', blueDraft: ['Akali', 'Viego', 'Azir', 'Jinx', 'Rell'] });
const lck = game({ id: 'lck', day: 1, blue: 'T1', red: 'HLE', blueWins: true, competition: 'LCK' });
const history = [
  lastYear,
  lck,
  // Akali mid for T1: won, then lost twice; once top for G2 (lost).
  game({ id: 'w1', day: 0, blue: 'T1', red: 'G2', blueWins: true, blueDraft: ['Aatrox', 'Viego', 'Akali', 'Jinx', 'Rell'] }),
  game({ id: 'w2', day: 2, blue: 'G2', red: 'T1', blueWins: true, blueDraft: ['Akali', 'Viego', 'Azir', 'Jinx', 'Rell'] }),
  game({ id: 'w3', day: 3, blue: 'T1', red: 'HLE', blueWins: false, blueDraft: ['Aatrox', 'Viego', 'Akali', 'Jinx', 'Rell'] }),
  game({ id: 'w4', day: 4, blue: 'HLE', red: 'T1', blueWins: true, redDraft: ['Gnar', 'Vi', 'Akali', 'Ezreal', 'Nautilus'], blueBans: ['Yone', 'Kalista'] }),
  game({ id: 'w5', day: 5, blue: 'T1', red: 'GEN', blueWins: true, blueBans: ['Kalista'] }),
];
const at = START + 6 * DAY;

describe('currentTournament', () => {
  it('takes the newest event of the competition being predicted, with each game\'s round', () => {
    const current = currentTournament(history, 'WORLDS', at)!;
    expect(current.label).toBe('Worlds 2026');
    expect(current.games.map((g) => g.gameId)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    expect(current.roundOf.get('w1')).toBeTruthy();
  });

  it('has none when the newest event is weeks old, or there is no competition', () => {
    expect(currentTournament(history, 'WORLDS', at + 60 * DAY)).toBeNull();
    expect(currentTournament(history, null, at)).toBeNull();
    expect(currentTournament(history, 'MSI', at)).toBeNull();
  });
});

describe('pickFacts', () => {
  const current = currentTournament(history, 'WORLDS', at)!;

  it('gives the record, the role split, the last pick and the run it is on', () => {
    // G2 won on Akali top (w2); T1 won with it mid (w1) and lost with it mid twice (w3, w4).
    const facts = pickFacts(current, 'Akali', 'Akali', 'mid', 'T1-mid');
    expect(facts).toMatchObject({ picks: 4, wins: 2, rolePicks: 3, roleWins: 1, bans: 0 });
    expect(facts.last).toMatchObject({ won: false, team: 'T1', opponent: 'HLE' });
    expect(facts.streak).toEqual({ won: false, length: 2 });
    expect(facts.player).toEqual({ name: 'T1-mid', picks: 3, wins: 1 });
    expect(facts.lines).toEqual([
      'Akali at Worlds 2026: 2–2 (1–2 as mid)',
      expect.stringMatching(/^Last Akali pick lost — T1 vs HLE, .*Oct 14$/),
      'Lost its last 2 at Worlds 2026',
      'T1-mid on Akali at Worlds 2026: 1–2',
    ]);
  });

  it('says when a champion is new to the event, and how often it was banned', () => {
    const facts = pickFacts(current, 'Kalista', 'Kalista', 'bot', 'HLE-bot');
    expect(facts.lines).toEqual(['First Kalista pick at Worlds 2026 — banned 2× before']);
    // Last year's Akali doesn't count.
    expect(pickFacts(current, 'Zed', 'Zed', 'mid', null).lines).toEqual(['First Zed pick at Worlds 2026']);
  });

  it('says when it is new to the role, and when a player has not played it here', () => {
    const facts = pickFacts(current, 'Akali', 'Akali', 'support', 'GEN-support');
    expect(facts.lines[0]).toBe('First Akali support at Worlds 2026 — 4 games in other roles');
    expect(facts.lines.at(-1)).toBe("GEN-support's first Akali at Worlds 2026");
  });

  it('calls an unbroken record unbeaten, or yet to win', () => {
    // In w1 and w5, T1 won on blue: its Aatrox top won both, G2's and GEN's Gnar top lost both.
    const twoGames = { ...current, games: current.games.filter((g) => ['w1', 'w5'].includes(g.gameId)) };
    expect(pickFacts(twoGames, 'Aatrox', 'Aatrox', 'top', null).lines).toContain('Unbeaten at Worlds 2026 (2–0)');
    expect(pickFacts(twoGames, 'Gnar', 'Gnar', 'top', null).lines).toContain('Yet to win at Worlds 2026 (0–2)');
  });
});
