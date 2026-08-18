import { useMemo } from 'react';
import { ChampionArt, championStyle } from '../ChampionArt.tsx';
import { TeamLogo } from '../TeamLogo.tsx';
import { SearchSelect, type SearchOption } from './SearchSelect.tsx';
import {
  ROLES,
  ROLE_SHORT,
  type Champion,
  type CompetitionId,
  type Role,
  type Side,
} from '../../domain/types.ts';
import { MOTIVATIONS, type Motivation, type PredictorModel } from '../../predictor/types.ts';
import { isMeta } from '../../predictor/engine.ts';

interface DraftComposerProps {
  side: Side;
  model: PredictorModel;
  competition: CompetitionId | null;
  team: string | null;
  champions: (Champion | null)[];
  /** The other side's picks, which are also unavailable to this one. */
  opposingChampions: (Champion | null)[];
  motivation: Motivation;
  /** Teams selectable for this side, already scoped to the competition. */
  teamOptions: readonly string[];
  onTeamChange: (team: string | null) => void;
  onChampionChange: (index: number, champion: Champion | null) => void;
  onMotivationChange: (motivation: Motivation) => void;
}

/**
 * One side of the draft board, in composer form.
 *
 * Deliberately shaped like `DraftBoard`'s side — same portrait proportions,
 * same role plates — so switching between playing the quiz and building a
 * prediction doesn't feel like moving between two different apps.
 */
export function DraftComposer({
  side,
  model,
  competition,
  team,
  champions,
  opposingChampions,
  motivation,
  teamOptions,
  onTeamChange,
  onChampionChange,
  onMotivationChange,
}: DraftComposerProps) {
  const teamChoices = useMemo<SearchOption[]>(
    () => teamOptions.map((name) => ({ value: name, label: name })),
    [teamOptions],
  );

  const roster = team ? (model.rosters.get(team.toLowerCase()) ?? {}) : {};

  // One champion cannot be on both teams, so the whole board is off-limits —
  // not just this side's own picks.
  const takenIds = useMemo(
    () =>
      new Set(
        [...champions, ...opposingChampions]
          .filter((c): c is Champion => c !== null)
          .map((c) => c.id),
      ),
    [champions, opposingChampions],
  );

  return (
    <section className={`composer composer--${side}`} aria-label={`${side} side draft`}>
      <header className="composer-head">
        <TeamLogo teamName={team ?? '—'} tag={team ?? '—'} size="md" />
        <div className="composer-id">
          <span className="composer-side">{side === 'blue' ? 'Blue side' : 'Red side'}</span>
          <SearchSelect
            label={`${side} team`}
            tone={side}
            value={team}
            valueLabel={team ?? undefined}
            options={teamChoices}
            onChange={onTeamChange}
            placeholder={competition ? 'Pick a team' : 'Pick a competition first'}
            disabled={teamChoices.length === 0}
          />
        </div>
      </header>

      <div className="composer-picks">
        {ROLES.map((role, index) => (
          <PickSlot
            key={role}
            role={role}
            side={side}
            model={model}
            champion={champions[index] ?? null}
            player={roster[role] ?? null}
            takenIds={takenIds}
            onChange={(champion) => onChampionChange(index, champion)}
          />
        ))}
      </div>

      <label className="composer-motivation">
        <span className="field-label">Motivation</span>
        <select
          className="select"
          value={motivation}
          onChange={(event) => onMotivationChange(event.target.value as Motivation)}
        >
          {MOTIVATIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

interface PickSlotProps {
  role: Role;
  side: Side;
  model: PredictorModel;
  champion: Champion | null;
  player: string | null;
  takenIds: ReadonlySet<string>;
  onChange: (champion: Champion | null) => void;
}

function PickSlot({ role, side, model, champion, player, takenIds, onChange }: PickSlotProps) {
  const pool = model.championsByRole.get(role) ?? [];

  const options = useMemo<SearchOption[]>(
    () =>
      pool
        .filter((entry) => entry.id === champion?.id || !takenIds.has(entry.id))
        .map((entry) => ({
          value: entry.id,
          label: entry.name,
          hint: isMeta(model, entry, role) ? 'meta' : undefined,
        })),
    [pool, takenIds, champion?.id, model, role],
  );

  const byId = useMemo(() => new Map(pool.map((entry) => [entry.id, entry])), [pool]);
  const meta = champion ? isMeta(model, champion, role) : false;

  return (
    <div className={`pick-slot${champion ? ' is-filled' : ''}`} style={champion ? championStyle(champion) : undefined}>
      <div className="pick-slot-art">
        {champion ? (
          <ChampionArt champion={champion} variant="portrait" />
        ) : (
          <span className="pick-slot-empty" aria-hidden="true">
            {ROLE_SHORT[role]}
          </span>
        )}
        {champion && <span className={`pick-slot-tag${meta ? ' is-meta' : ''}`}>{meta ? 'META' : 'OFF-META'}</span>}
      </div>

      <div className="pick-slot-body">
        <div className="pick-slot-role">
          <span className="role-chip">{ROLE_SHORT[role]}</span>
          {player && <span className="pick-slot-player">{player}</span>}
        </div>
        <SearchSelect
          label={`${side} ${role}`}
          tone={side}
          value={champion?.id ?? null}
          valueLabel={champion?.name}
          options={options}
          onChange={(id) => onChange(id ? (byId.get(id) ?? null) : null)}
          placeholder="Champion"
          disabled={options.length === 0}
        />
      </div>
    </div>
  );
}
