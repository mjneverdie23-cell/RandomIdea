import { useMemo, useState } from 'react';
import { ChampionArt } from '../ChampionArt.tsx';
import { formatRate, type ChampionMetaEntry, type MetaIndex } from '../../meta/patchMeta.ts';
import { ROLE_LABEL, type CompetitionId } from '../../domain/types.ts';
import { formatCount } from '../../lib/format.ts';

type MetaTab = 'picked' | 'banned';

interface PatchMetaPanelProps {
  metaIndex: MetaIndex;
  patch: string | null;
  /** Scopes the sample to one competition when it has enough games. */
  competition?: CompetitionId | null;
  limit?: number;
}

/**
 * Compact patch-meta strip.
 *
 * Rates are derived from the loaded dataset for this game's patch — not a
 * hardcoded tier list — so it reflects whatever export the user imported. It
 * deliberately shows what was *contested*, which is the context a player needs
 * to judge a draft they're about to call.
 */
export function PatchMetaPanel({
  metaIndex,
  patch,
  competition = null,
  limit = 8,
}: PatchMetaPanelProps) {
  const [tab, setTab] = useState<MetaTab>('picked');

  const meta = useMemo(
    () => (patch ? metaIndex.get(patch, { competition }) : null),
    [metaIndex, patch, competition],
  );

  if (!patch) {
    return (
      <section className="meta-panel panel">
        <div className="panel-header">
          <h3>Patch Meta</h3>
        </div>
        <p className="meta-empty">This game has no patch recorded, so meta can't be computed.</p>
      </section>
    );
  }

  if (!meta || meta.sampleSize === 0) {
    return (
      <section className="meta-panel panel">
        <div className="panel-header">
          <h3>Patch Meta · {patch}</h3>
        </div>
        <p className="meta-empty">No other games on patch {patch} in the loaded dataset.</p>
      </section>
    );
  }

  const entries = (tab === 'picked' ? meta.topPicked : meta.topBanned).slice(0, limit);
  const max = entries.length
    ? Math.max(...entries.map((e) => (tab === 'picked' ? e.pickRate : e.banRate)))
    : 1;

  return (
    <section className="meta-panel panel">
      <div className="panel-header">
        <h3>
          Patch Meta <span className="dim">· {patch}</span>
        </h3>
        <div className="meta-tabs">
          <button
            type="button"
            className={`meta-tab${tab === 'picked' ? ' is-active' : ''}`}
            onClick={() => setTab('picked')}
          >
            Most picked
          </button>
          <button
            type="button"
            className={`meta-tab${tab === 'banned' ? ' is-active' : ''}`}
            onClick={() => setTab('banned')}
          >
            Most banned
          </button>
        </div>
      </div>

      <div className="meta-list">
        {entries.map((entry) => (
          <MetaRow key={entry.champion.id} entry={entry} tab={tab} max={max} />
        ))}
      </div>

      <footer className="meta-foot">
        From {formatCount(meta.sampleSize, 'game')} on patch {patch}
        {meta.competitions.length === 1 ? ` · ${meta.competitions[0]}` : ' · all competitions'}
      </footer>
    </section>
  );
}

function MetaRow({
  entry,
  tab,
  max,
}: {
  entry: ChampionMetaEntry;
  tab: MetaTab;
  max: number;
}) {
  const rate = tab === 'picked' ? entry.pickRate : entry.banRate;
  const width = max > 0 ? Math.max(4, (rate / max) * 100) : 0;

  return (
    <div className="meta-row" title={`${entry.champion.name} — ${formatRate(entry.pickRate)} pick, ${formatRate(entry.banRate)} ban`}>
      <div className="meta-icon">
        <ChampionArt champion={entry.champion} variant="icon" />
      </div>
      <div className="meta-body">
        <div className="meta-name-row">
          <span className="meta-name">{entry.champion.name}</span>
          {entry.primaryRole && <span className="meta-role">{ROLE_LABEL[entry.primaryRole]}</span>}
        </div>
        <div className="meta-bar">
          <span
            className={`meta-bar-fill meta-bar-fill--${tab}`}
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
      <div className="meta-rates num">
        <span className="meta-rate-main">{formatRate(rate)}</span>
        <span className="meta-rate-sub">
          {tab === 'picked'
            ? entry.winRate !== null
              ? `${formatRate(entry.winRate)} WR`
              : '—'
            : `${formatRate(entry.pickRate)} PR`}
        </span>
      </div>
    </div>
  );
}
