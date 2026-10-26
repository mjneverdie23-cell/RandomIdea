/**
 * Following a live pro match from inside the Predictor.
 *
 * Built on the same LoL Esports reader as `npm run draft:live`
 * (`scripts/lib/lolesports.mjs`), and it ends in the same place: a match in
 * the paste format, read by the Predictor's own paste importer, so a followed
 * match fills the composer exactly as pasting it would.
 *
 * What the feeds give, and when:
 *
 * - The match (`getEventDetails`): both teams, best-of, the series score and
 *   which game is in progress with its sides — as soon as the game starts.
 * - The champions (the live stats window): only once the game has loaded.
 *   The feeds don't publish champion select pick by pick, so the composer
 *   gets the teams and score first and all ten champions a little later.
 *
 * Like every paste, nothing here reads who won the game being predicted: the
 * score is the series score going into the game in progress.
 *
 * Pure: parsed JSON in, plain values out. The network is the caller's.
 */

import {
  buildPasteMatch,
  pasteText,
  readEventDetails,
  readWindow,
  type EventDetails,
  type FeedDraft,
  type KnownTeam,
} from '../../scripts/lib/lolesports.mjs';
import type { PredictorDraft } from './draft.ts';
import { matchToDraft, parseMatchText } from './matchImport.ts';

export type LiveGame = EventDetails['games'][number];

export interface LiveRead {
  details: EventDetails;
  /**
   * `waiting` between games, `loading` while a game is live but its champions
   * aren't in the feed yet, `drafted` once they are, `finished` when the series
   * is over.
   */
  state: 'waiting' | 'loading' | 'drafted' | 'finished';
  /** The game in progress. */
  game: LiveGame | null;
  /** The next game to start, while waiting. */
  next: number | null;
  /** In-game gold, kills and towers, blue then red, from the latest frame. */
  inGame: FeedDraft['live'];
  /** What the composer should hold; `null` while there is nothing to fill. */
  composer: PredictorDraft | null;
  /** Changes whenever the composer would — new game, new teams, champions in. */
  fingerprint: string | null;
  warnings: string[];
}

/** The in-progress game, if any. */
export function liveGame(details: EventDetails): LiveGame | null {
  return details.games.find((game) => game.state === 'inProgress') ?? null;
}

/** Read a followed match: details from `getEventDetails`, the window for its live game (or `null`). */
export function readLive(
  detailsJson: unknown,
  windowJson: unknown,
  known: KnownTeam[],
  aliases: Record<string, string> = {},
): LiveRead | null {
  const details = readEventDetails(detailsJson);
  if (!details) return null;

  const target = details.bestOf ? Math.ceil(details.bestOf / 2) : null;
  const decided = target !== null && details.teams.some((team) => team.wins >= target);
  const game = liveGame(details);

  if (!game) {
    const next = details.games.find((entry) => entry.state === 'unstarted')?.number ?? null;
    return {
      details,
      state: decided || next === null ? 'finished' : 'waiting',
      game: null,
      next: decided ? null : next,
      inGame: null,
      composer: null,
      fingerprint: null,
      warnings: [],
    };
  }

  const codes = Object.fromEntries(details.teams.map((team) => [team.id, team.code]));
  const draft = windowJson ? readWindow(windowJson, codes) : null;
  // Before the game loads, the teams and sides still come from the match.
  const sides: FeedDraft = draft ?? {
    patch: null,
    blue: { teamId: game.sides.blue ?? null, picks: {}, players: {} },
    red: { teamId: game.sides.red ?? null, picks: {}, players: {} },
    live: null,
  };
  const built = buildPasteMatch({ details, game, draft: sides, known, aliases });
  // Empty lanes are expected until the game loads; everything else is worth saying.
  const warnings = built.warnings.filter((warning) => draft !== null || !/no champion for/.test(warning));
  const imported = parseMatchText(pasteText([built.match]));
  const match = imported.matches[0];
  const usable = match && match.blue.team && match.red.team;

  return {
    details,
    state: draft ? 'drafted' : 'loading',
    game,
    next: null,
    inGame: draft?.live ?? null,
    composer: usable ? matchToDraft(match) : null,
    fingerprint: usable
      ? [
          game.id,
          match.blue.team,
          match.red.team,
          match.scoreBlue,
          match.scoreRed,
          ...match.blue.champions.map((champion) => champion?.id ?? ''),
          ...match.red.champions.map((champion) => champion?.id ?? ''),
        ].join('|')
      : null,
    warnings: [...warnings, ...imported.warnings.filter((warning) => draft !== null || !/lanes filled/.test(warning))],
  };
}
