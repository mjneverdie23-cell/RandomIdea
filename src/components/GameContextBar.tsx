import { competitionAccent, competitionShort } from '../domain/competitions.ts';
import type { GamePrompt } from '../domain/types.ts';
import { formatDate, formatPatch, formatSeriesFormat } from '../lib/format.ts';

interface GameContextBarProps {
  game: GamePrompt;
  /** Hides the demo pill in places that already show one. */
  hideDemoBadge?: boolean;
}

/**
 * Everything a viewer would see on the broadcast lower-third before a game:
 * which event, when, what patch, what's on the line.
 */
export function GameContextBar({ game, hideDemoBadge = false }: GameContextBarProps) {
  return (
    <div className="context-bar">
      <span
        className="context-comp"
        style={{ ['--accent' as string]: competitionAccent(game.competition) }}
      >
        {competitionShort(game.competition)}
      </span>
      <span className="context-title">{game.tournamentLabel}</span>
      <span className="context-sep" aria-hidden="true" />
      <span className="context-item">{game.stage.label}</span>
      <span className="context-sep" aria-hidden="true" />
      <span className="context-item">
        {formatSeriesFormat(game.seriesFormat)} · Game {game.gameNumber}
      </span>
      <span className="context-sep" aria-hidden="true" />
      <span className="context-item">{formatDate(game.date)}</span>
      <span className="context-sep" aria-hidden="true" />
      <span className="context-item">{formatPatch(game.patch)}</span>
      {game.demo && !hideDemoBadge && <span className="badge badge-demo">Demo data</span>}
    </div>
  );
}
