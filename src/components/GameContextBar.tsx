import { competitionAccent, competitionShort } from '../domain/competitions.ts';
import type { GamePrompt } from '../domain/types.ts';
import { formatDate, formatPatch, formatSeriesFormat } from '../lib/format.ts';

interface GameContextBarProps {
  game: GamePrompt;
  /** Hides the demo pill in places that already show one. */
  hideDemoBadge?: boolean;
  /**
   * Which event this was: tournament, stage and date. Off in blind mode until
   * the third hint is spent — knowing it is a Worlds final narrows the field
   * considerably.
   */
  revealEvent?: boolean;
  /** The patch. Blind mode's second hint, since the patch implies the meta. */
  revealPatch?: boolean;
}

/**
 * Everything a viewer would see on the broadcast lower-third before a game:
 * which event, when, what patch, what's on the line.
 *
 * The league and the series position always show. The rest can be withheld, so
 * blind mode can hand it back a piece at a time rather than needing a bar of
 * its own that would drift from this one.
 */
export function GameContextBar({
  game,
  hideDemoBadge = false,
  revealEvent = true,
  revealPatch = true,
}: GameContextBarProps) {
  return (
    <div className="context-bar">
      <span
        className="context-comp"
        style={{ ['--accent' as string]: competitionAccent(game.competition) }}
      >
        {competitionShort(game.competition)}
      </span>
      {revealEvent && (
        <>
          <span className="context-title">{game.tournamentLabel}</span>
          <span className="context-sep" aria-hidden="true" />
          <span className="context-item">{game.stage.label}</span>
          <span className="context-sep" aria-hidden="true" />
        </>
      )}
      <span className="context-item">
        {formatSeriesFormat(game.seriesFormat)} · Game {game.gameNumber}
      </span>
      {revealEvent && (
        <>
          <span className="context-sep" aria-hidden="true" />
          <span className="context-item">{formatDate(game.date)}</span>
        </>
      )}
      {revealPatch && (
        <>
          <span className="context-sep" aria-hidden="true" />
          <span className="context-item">{formatPatch(game.patch)}</span>
        </>
      )}
      {!revealEvent && <span className="context-item dim">Event hidden</span>}
      {game.demo && !hideDemoBadge && <span className="badge badge-demo">Demo data</span>}
    </div>
  );
}
