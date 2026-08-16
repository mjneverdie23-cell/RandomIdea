import { competitionAccent } from '../../domain/competitions.ts';
import { formatDate, formatDateTime } from '../../lib/format.ts';
import type { YearDataset } from '../../domain/types.ts';

interface YearBarProps {
  year: YearDataset;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}

/**
 * One imported season, with a switch that takes it in or out of the quiz pool.
 *
 * Switching off is not deleting — the games stay stored, so a player can focus
 * on, say, 2025 without re-importing four other files to get them back.
 */
export function YearBar({ year, onToggle, onRemove }: YearBarProps) {
  const competitions = Object.entries(year.stats.perCompetition).sort((a, b) => b[1] - a[1]);
  const range = year.stats.dateRange;

  return (
    <div className={`year-bar${year.enabled ? '' : ' is-off'}`}>
      <label className="year-switch">
        <input
          type="checkbox"
          checked={year.enabled}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`Use ${year.year} games in the quiz`}
        />
        <span className="year-switch-track" aria-hidden="true">
          <span className="year-switch-thumb" />
        </span>
      </label>

      <div className="year-id">
        <span className="year-number num">{year.year}</span>
        <span className="year-count dim num">{year.games.length.toLocaleString()} games</span>
      </div>

      <div className="year-comps">
        {competitions.length === 0 ? (
          <span className="dim">No eligible games</span>
        ) : (
          competitions.map(([competition, count]) => (
            <span
              key={competition}
              className="year-comp"
              style={{ ['--accent' as string]: competitionAccent(competition as never) }}
              title={`${count} games`}
            >
              {competition}
              <span className="num">{count.toLocaleString()}</span>
            </span>
          ))
        )}
      </div>

      <div className="year-meta dim">
        {range ? (
          <span>
            {formatDate(range.from)} – {formatDate(range.to)}
          </span>
        ) : (
          <span>No dates</span>
        )}
        <span className="year-file" title={year.label}>
          {year.label}
        </span>
        <span>Imported {formatDateTime(year.importedAt)}</span>
      </div>

      <button
        type="button"
        className="btn btn-sm btn-ghost year-remove"
        onClick={onRemove}
        title={`Delete the ${year.year} games`}
      >
        Delete
      </button>
    </div>
  );
}
