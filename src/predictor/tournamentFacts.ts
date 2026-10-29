/**
 * What each pick has done at the tournament being played — "First Akali pick
 * at Worlds 2026", "Last Akali pick lost — G2 vs T1, Round 3" — for the
 * Predictor's per-lane detail.
 *
 * Reported, not scored. Built only from games played before the game being
 * predicted (the caller passes the same history the model is cut to), so in a
 * backtest the facts are what anyone could have said at kickoff.
 *
 * Pure: no React, no storage.
 */

import type { CompetitionId, Game, Role, TeamSide } from '../domain/types.ts';
import { tournamentGames, tournamentOptions, tournamentStructure } from './tournament.ts';

/** A tournament whose newest game is older than this isn't the one being played. */
export const CURRENT_WITHIN_DAYS = 45;

export interface CurrentTournament {
  key: string;
  label: string;
  /** Oldest first. */
  games: Game[];
  /** The round each game was in, e.g. `Round 3`, `Quarterfinal`. */
  roundOf: Map<string, string>;
}

/**
 * The tournament of `competition` being played at `at`: the one with the
 * newest game before then, unless that game is weeks old — on the first day of
 * a new event, last year's would be the wrong one to talk about.
 */
export function currentTournament(
  history: readonly Game[],
  competition: CompetitionId | null,
  at: number,
): CurrentTournament | null {
  if (!competition) return null;
  const own = history.filter((game) => game.competition === competition);
  const newest = tournamentOptions(own)[0];
  if (!newest || at - newest.last > CURRENT_WITHIN_DAYS * 86_400_000) return null;
  const games = tournamentGames(own, newest.key);
  const roundOf = new Map<string, string>();
  for (const series of tournamentStructure(games).series) {
    for (const game of series.games) roundOf.set(game.gameId, series.round);
  }
  return { key: newest.key, label: newest.label, games, roundOf };
}

interface Outing {
  game: Game;
  side: TeamSide;
  opponent: TeamSide;
  role: Role;
  player: string;
  won: boolean;
}

export interface PickFacts {
  tournament: string;
  champion: string;
  /** Picked in any role, and won. */
  picks: number;
  wins: number;
  /** Picked in this role, and won. */
  rolePicks: number;
  roleWins: number;
  bans: number;
  last: { won: boolean; team: string; opponent: string; date: string; round: string | null; role: Role } | null;
  /** The run of identical results ending with the last pick. */
  streak: { won: boolean; length: number } | null;
  /** This player on this champion here, when the player is known. */
  player: { name: string; picks: number; wins: number } | null;
  /** The facts as short sentences, most telling first. */
  lines: string[];
}

const ROLE_WORD: Record<Role, string> = { top: 'top', jungle: 'jungle', mid: 'mid', bot: 'bot', support: 'support' };
const wl = (picks: number, wins: number) => `${wins}–${picks - wins}`;
const shortDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One pick — a champion in a role, played by `player` if known — at the current tournament. */
export function pickFacts(
  tournament: CurrentTournament,
  championId: string,
  championName: string,
  role: Role,
  player: string | null,
): PickFacts {
  const outings: Outing[] = [];
  let bans = 0;
  for (const game of tournament.games) {
    for (const side of [game.blue, game.red]) {
      bans += side.bans.filter((ban) => ban.id === championId).length;
      const slot = side.players.find((entry) => entry.champion.id === championId);
      if (!slot) continue;
      outings.push({
        game,
        side,
        opponent: side === game.blue ? game.red : game.blue,
        role: slot.role,
        player: slot.playerName,
        won: game.winner === side.side,
      });
    }
  }
  // Newest first.
  outings.sort((a, b) => Date.parse(b.game.date) - Date.parse(a.game.date) || b.game.gameNumber - a.game.gameNumber);

  const wins = outings.filter((outing) => outing.won).length;
  const inRole = outings.filter((outing) => outing.role === role);
  const roleWins = inRole.filter((outing) => outing.won).length;
  const newest = outings[0];
  let streak: PickFacts['streak'] = null;
  if (newest) {
    let length = 0;
    while (length < outings.length && outings[length]!.won === newest.won) length += 1;
    streak = { won: newest.won, length };
  }
  const mine = player ? outings.filter((outing) => same(outing.player, player)) : [];

  const facts: PickFacts = {
    tournament: tournament.label,
    champion: championName,
    picks: outings.length,
    wins,
    rolePicks: inRole.length,
    roleWins,
    bans,
    last: newest
      ? {
          won: newest.won,
          team: newest.side.teamName,
          opponent: newest.opponent.teamName,
          date: newest.game.date,
          round: tournament.roundOf.get(newest.game.gameId) ?? null,
          role: newest.role,
        }
      : null,
    streak,
    player: player ? { name: player, picks: mine.length, wins: mine.filter((outing) => outing.won).length } : null,
    lines: [],
  };
  facts.lines = describe(facts, role);
  return facts;
}

function describe(facts: PickFacts, role: Role): string[] {
  const { champion, tournament: at, picks, wins, rolePicks, roleWins, bans, last, streak, player } = facts;
  const lines: string[] = [];
  const banned = bans > 0 ? `banned ${bans}×` : '';

  if (picks === 0) {
    lines.push(`First ${champion} pick at ${at}${bans > 0 ? ` — ${banned} before` : ''}`);
    return lines;
  }

  if (rolePicks === 0) {
    lines.push(`First ${champion} ${ROLE_WORD[role]} at ${at} — ${picks} game${picks === 1 ? '' : 's'} in other roles`);
  }
  const byRole = rolePicks > 0 && rolePicks < picks ? ` (${wl(rolePicks, roleWins)} as ${ROLE_WORD[role]})` : '';
  lines.push(`${champion} at ${at}: ${wl(picks, wins)}${byRole}${banned ? ` · ${banned}` : ''}`);

  if (last) {
    const where = [last.round, shortDate(last.date)].filter(Boolean).join(', ');
    lines.push(`Last ${champion} pick ${last.won ? 'won' : 'lost'} — ${last.team} vs ${last.opponent}${where ? `, ${where}` : ''}`);
  }
  if (streak && streak.length >= 2) {
    lines.push(
      streak.length === picks
        ? `${streak.won ? 'Unbeaten' : 'Yet to win'} at ${at} (${wl(picks, wins)})`
        : `${streak.won ? 'Won' : 'Lost'} its last ${streak.length} at ${at}`,
    );
  }
  if (player) {
    lines.push(
      player.picks === 0
        ? `${player.name}'s first ${champion} at ${at}`
        : `${player.name} on ${champion} at ${at}: ${wl(player.picks, player.wins)}`,
    );
  }
  return lines;
}
