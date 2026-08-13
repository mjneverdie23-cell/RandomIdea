import { TeamLogo } from '../TeamLogo.tsx';
import type { Side } from '../../domain/types.ts';

interface PredictionBarProps {
  blueTeam: string;
  redTeam: string;
  blueTag: string;
  redTag: string;
  /** What the user picked, once they've picked. */
  prediction: Side | null;
  /** Revealed winner — set only during the reveal phase. */
  winner: Side | null;
  disabled: boolean;
  onPredict: (side: Side) => void;
}

/**
 * The only interaction in the quiz: call blue or red.
 *
 * Kept to two oversized targets so a 10-second question never costs the user
 * time hunting for a control. Keyboard shortcuts (B / R, or arrow keys) are
 * wired up by the quiz page.
 */
export function PredictionBar({
  blueTeam,
  redTeam,
  blueTag,
  redTag,
  prediction,
  winner,
  disabled,
  onPredict,
}: PredictionBarProps) {
  return (
    <div className="predict" role="group" aria-label="Predict the winner">
      <PredictButton
        side="blue"
        team={blueTeam}
        tag={blueTag}
        hint="Blue Side"
        shortcut="B"
        prediction={prediction}
        winner={winner}
        disabled={disabled}
        onPredict={onPredict}
      />
      <div className="predict-divider" aria-hidden="true">
        <span>Who won?</span>
      </div>
      <PredictButton
        side="red"
        team={redTeam}
        tag={redTag}
        hint="Red Side"
        shortcut="R"
        prediction={prediction}
        winner={winner}
        disabled={disabled}
        onPredict={onPredict}
      />
    </div>
  );
}

interface PredictButtonProps
  extends Omit<PredictionBarProps, 'blueTeam' | 'redTeam' | 'blueTag' | 'redTag'> {
  side: Side;
  team: string;
  tag: string;
  hint: string;
  shortcut: string;
}

function PredictButton({
  side,
  team,
  tag,
  hint,
  shortcut,
  prediction,
  winner,
  disabled,
  onPredict,
}: PredictButtonProps) {
  const chosen = prediction === side;
  const revealed = winner !== null;
  const isWinner = winner === side;

  const state = !revealed
    ? chosen
      ? 'chosen'
      : 'idle'
    : isWinner
      ? 'won'
      : chosen
        ? 'wrong'
        : 'lost';

  return (
    <button
      type="button"
      className={`predict-btn predict-btn--${side}`}
      data-state={state}
      disabled={disabled}
      onClick={() => onPredict(side)}
      aria-pressed={chosen}
    >
      <TeamLogo teamName={team} tag={tag} size="md" className="predict-logo" />
      <span className="predict-hint">{hint}</span>
      <span className="predict-team">{team}</span>
      <span className="predict-shortcut" aria-hidden="true">
        {shortcut}
      </span>
      {revealed && (
        <span className="predict-result">
          {isWinner ? 'Won' : 'Lost'}
          {chosen ? ' · Your call' : ''}
        </span>
      )}
    </button>
  );
}
