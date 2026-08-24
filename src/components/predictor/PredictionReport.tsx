import { ChampionArt } from '../ChampionArt.tsx';
import { ROLE_SHORT, type Side } from '../../domain/types.ts';
import type {
  ChampionScaling,
  Notice,
  PickLine,
  Prediction,
  ScalingRead,
  SideScore,
  WinLoss,
} from '../../predictor/types.ts';

/**
 * Percentage that never claims a certainty it doesn't have.
 *
 * A 99.96% series probability rounds to "100.0%", which reads as settled when
 * the model still gives the other side a chance. Anything short of exact is
 * held back to 99.9 / 0.1.
 */
const pct = (value: number): string => {
  const shown = value * 100;
  if (value < 1 && shown >= 99.95) return '99.9%';
  if (value > 0 && shown < 0.05) return '0.1%';
  return `${shown.toFixed(1)}%`;
};
const signed = (value: number): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;

interface PredictionReportProps {
  prediction: Prediction;
  blueTeam: string;
  redTeam: string;
  showSweep: boolean;
  /** Season the standings and behaviour reads describe. */
  formSeason: string | null;
  /** Where the rank and fraud numbers came from. */
  ratingsLabel: string;
  /** Teams in this matchup that the ratings table doesn't list. */
  unratedTeams: string[];
}

export function PredictionReport({
  prediction,
  blueTeam,
  redTeam,
  showSweep,
  formSeason,
  ratingsLabel,
  unratedTeams,
}: PredictionReportProps) {
  const { favourite, margin } = prediction;
  const leader = favourite === 'blue' ? blueTeam : favourite === 'red' ? redTeam : null;

  return (
    <div className="report">
      <section className={`verdict verdict--${favourite ?? 'level'}`}>
        <div className="verdict-head">
          <span className="verdict-label">Predicted winner</span>
          <strong className="verdict-team">{leader ?? 'Too close to call'}</strong>
          {leader && (
            <span className="verdict-margin">
              leads by {Math.abs(margin).toFixed(2)} point{Math.abs(margin) === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <ProbabilityBar
          label="This game"
          blue={prediction.gameProbBlue}
          red={prediction.gameProbRed}
          blueTeam={blueTeam}
          redTeam={redTeam}
        />

        {prediction.seriesTarget > 1 && (
          <ProbabilityBar
            label={`Series (needs ${prediction.needBlue}–${prediction.needRed} more)`}
            blue={prediction.seriesProbBlue}
            red={prediction.seriesProbRed}
            blueTeam={blueTeam}
            redTeam={redTeam}
          />
        )}

        {showSweep && prediction.seriesTarget > 1 && (
          <ProbabilityBar
            label="Sweep from here"
            blue={prediction.sweepProbBlue}
            red={prediction.sweepProbRed}
            blueTeam={blueTeam}
            redTeam={redTeam}
            independent
          />
        )}
      </section>

      <section className="panel tally-panel">
        <header className="panel-head">
          <h2>Point tally</h2>
          <p className="dim">Every line item is added up; the higher total is the predicted winner.</p>
        </header>
        <div className="tally-grid">
          <TallyColumn score={prediction.blue} side="blue" winner={favourite === 'blue'} />
          <TallyColumn score={prediction.red} side="red" winner={favourite === 'red'} />
        </div>
        <footer className="tally-notes">
          <p>
            <span className="dim">Form edge:</span> {prediction.formNote}
            {formSeason ? ` (${formSeason} season)` : ''}.
          </p>
          <p>
            <span className="dim">Rank edge:</span> {prediction.rankNote}.
          </p>
          <p>
            <span className="dim">Ratings source:</span> {ratingsLabel}
            {unratedTeams.length > 0 && (
              <>
                {' — '}
                {unratedTeams.join(' and ')}{' '}
                {unratedTeams.length === 1 ? 'is' : 'are'} not listed in it, so{' '}
                {unratedTeams.length === 1 ? 'that team is' : 'those teams are'} ranked
                behind every team that is
              </>
            )}
            . The fraud rating is reported in the notices and does not move the score.
          </p>
        </footer>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Scouting notices</h2>
        </header>
        <ul className="notice-list">
          {prediction.notices.map((notice, index) => (
            <NoticeRow key={`${notice.kind}-${index}`} notice={notice} />
          ))}
        </ul>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Usual behaviour</h2>
          <p className="dim">
            Reported, not scored{formSeason ? ` · ${formSeason} season` : ''}.
          </p>
        </header>
        <div className="tendency-grid">
          <TendencyColumn side="blue" team={blueTeam} lines={prediction.tendencyBlue} />
          <TendencyColumn side="red" team={redTeam} lines={prediction.tendencyRed} />
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Per-lane detail</h2>
        </header>
        <div className="lane-grid">
          <LaneColumn score={prediction.blue} side="blue" />
          <LaneColumn score={prediction.red} side="red" />
        </div>
      </section>
    </div>
  );
}

interface ProbabilityBarProps {
  label: string;
  blue: number;
  red: number;
  blueTeam: string;
  redTeam: string;
  /** Sweep odds are two separate questions, so they don't sum to 100%. */
  independent?: boolean;
}

function ProbabilityBar({ label, blue, red, blueTeam, redTeam, independent }: ProbabilityBarProps) {
  return (
    <div className="prob">
      <div className="prob-label">{label}</div>
      <div className="prob-values">
        <span className="prob-blue">
          {blueTeam} <strong>{pct(blue)}</strong>
        </span>
        <span className="prob-red">
          <strong>{pct(red)}</strong> {redTeam}
        </span>
      </div>
      {independent ? (
        // Sweep odds are two separate questions — "can blue run the rest out"
        // and "can red" — so they get a track each rather than one split bar
        // that would imply they add up to 100%.
        <div className="prob-pair">
          <div className="prob-track prob-track--empty">
            <span className="prob-fill prob-fill--blue" style={{ width: `${blue * 100}%` }} />
          </div>
          <div className="prob-track prob-track--empty">
            <span className="prob-fill prob-fill--red" style={{ width: `${red * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="prob-track">
          <span className="prob-fill prob-fill--blue" style={{ width: `${blue * 100}%` }} />
        </div>
      )}
    </div>
  );
}

const TALLY_ROWS = [
  { key: 'winRateBase', label: 'Win-rate base', hint: '5 lanes, capped at 1.00 each' },
  { key: 'metaBonus', label: 'Meta champions', hint: '+1 each' },
  { key: 'pocketBonus', label: 'Pocket picks', hint: '+1.5 each for 1–2 off-meta, more −2' },
  { key: 'formEdge', label: 'Form edge', hint: 'from the current-season record' },
  { key: 'motivationBonus', label: 'Motivation', hint: 'must-win +0.5, coasting −0.5, tanking −1' },
  { key: 'seriesEdge', label: 'Series edge', hint: '+0.3 per game of lead, capped at +0.6' },
  { key: 'rankBonus', label: 'Rank edge', hint: '+0.1 per place of rank gap, capped at +1.5' },
  { key: 'darkHorseBonus', label: 'Dark horse', hint: '+0.1 per high-ceiling champion' },
] as const;

function TallyColumn({ score, side, winner }: { score: SideScore; side: Side; winner: boolean }) {
  return (
    <div className={`tally tally--${side}${winner ? ' is-winner' : ''}`}>
      <header className="tally-head">
        <span className="tally-team">{score.team || '—'}</span>
        {winner && <span className="tally-flag">favoured</span>}
      </header>
      <dl className="tally-rows">
        {TALLY_ROWS.map((row) => (
          <div className="tally-row" key={row.key}>
            <dt>
              {row.label}
              <span className="tally-hint">{row.hint}</span>
            </dt>
            <dd className={score[row.key] === 0 ? 'is-zero' : undefined}>{signed(score[row.key])}</dd>
          </div>
        ))}
      </dl>
      <div className="tally-total">
        <span>Total</span>
        <strong>{score.total.toFixed(2)}</strong>
      </div>
      <p className="tally-meta">
        {score.metaCount}/{score.picks.length || 5} meta · {score.offMetaCount} off-meta
      </p>
    </div>
  );
}

function NoticeRow({ notice }: { notice: Notice }) {
  const tone = notice.warning ? 'is-warning' : '';
  const sideClass = notice.side ? `notice--${notice.side}` : 'notice--neutral';
  return (
    <li className={`notice ${sideClass} ${tone}`.trim()}>
      <span className="notice-kind">{notice.kind.replace('-', ' ')}</span>
      <span className="notice-text">{notice.text}</span>
    </li>
  );
}

function TendencyColumn({ side, team, lines }: { side: Side; team: string; lines: string[] }) {
  return (
    <div className={`tendency tendency--${side}`}>
      <h3>{team || '—'}</h3>
      <ul>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The presence rate broken back into its two halves.
 *
 * Presence is what decides meta or off-meta, and a champion can reach the bar
 * on either half: Poppy was 3% picked and 74% banned on patch 16.15. Splitting
 * it out is the difference between "everyone plays this" and "nobody is allowed
 * to", which the single number cannot tell you.
 */
function presenceSplit(pick: PickLine): string | undefined {
  if (pick.presenceRate === null || pick.pickRate === null) return undefined;
  const picked = pick.pickRate * 100;
  const banned = Math.max(0, pick.presenceRate * 100 - picked);
  return `${picked.toFixed(1)}% picked, ${banned.toFixed(1)}% banned`;
}

const SCALING_LABEL: Record<ChampionScaling, string> = {
  late: 'late game',
  balanced: 'balanced',
  early: 'early game',
};

/** The two win rates behind a scaling label, so the reader can judge it. */
function scalingDetail(read: ScalingRead): string {
  const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
  return (
    `${pct(read.shortRate)} in short games (${read.shortGames}), ` +
    `${pct(read.longRate)} in long ones (${read.longGames}) — ` +
    `${read.delta >= 0 ? '+' : ''}${(read.delta * 100).toFixed(0)} points`
  );
}

function LaneColumn({ score, side }: { score: SideScore; side: Side }) {
  if (score.picks.length === 0) {
    return (
      <div className={`lanes lanes--${side}`}>
        <h3>{score.team || '—'}</h3>
        <p className="dim">No champions picked yet.</p>
      </div>
    );
  }

  return (
    <div className={`lanes lanes--${side}`}>
      <h3>{score.team || '—'}</h3>
      {score.picks.map((pick) => (
        <article className="lane" key={pick.role}>
          <div className="lane-art">
            <ChampionArt champion={pick.champion} variant="icon" />
          </div>
          <div className="lane-body">
            <div className="lane-title">
              <span className="role-chip">{ROLE_SHORT[pick.role]}</span>
              <strong>{pick.champion.name}</strong>
              <span className={`lane-meta${pick.meta ? ' is-meta' : ''}`}>
                {pick.meta ? 'meta' : 'off-meta'}
                {pick.presenceRate !== null && (
                  // The number that produced the verdict — picks plus bans, so
                  // a surprising "off-meta" can be checked against the bar
                  // rather than taken on trust.
                  <span className="lane-rate" title={presenceSplit(pick)}>
                    {(pick.presenceRate * 100).toFixed(1)}%
                  </span>
                )}
              </span>
              {pick.scaling && (
                // How the champion trends with game length. Reported only —
                // it scores nothing, and the title carries the two win rates
                // so a surprising label can be weighed rather than believed.
                <span
                  className={`lane-scaling is-${pick.scaling.type}`}
                  title={scalingDetail(pick.scaling)}
                >
                  {SCALING_LABEL[pick.scaling.type]}
                </span>
              )}
            </div>
            <div className="lane-stat">
              <span className="lane-wr">{(pick.winRate * 100).toFixed(0)}%</span>
              <span className="dim">{scopeLabel(pick)}</span>
              {pick.player && <span className="lane-player">{pick.player}</span>}
            </div>
            <LaneRecords pick={pick} />
            {(pick.counters.length > 0 || pick.counteredBy.length > 0 || pick.synergy.length > 0) && (
              <div className="lane-edges">
                <EdgeList label="counters" tone="good" champions={pick.counters} />
                <EdgeList label="countered by" tone="bad" champions={pick.counteredBy} />
                <EdgeList label="synergy" tone="warm" champions={pick.synergy} />
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

/** Where the scored number came from, in the reader's words. */
function scopeLabel(pick: PickLine): string {
  switch (pick.scope) {
    case 'blend':
      return `${pick.splitLabel ?? 'split'} and career, averaged`;
    case 'split':
      return pick.splitLabel ? `${pick.splitLabel} form` : 'current split';
    case 'career':
      return pick.splitRecord ? 'career — split sample too thin' : 'career — first time this split';
    case 'team':
      return pick.player ? 'team record' : 'team record, roster unknown';
    case 'none':
      return 'off-meta with no record — prepared surprise';
    default:
      return 'no record either way — treated as even';
  }
}

/**
 * Both records side by side, split and career.
 *
 * Scoring uses the narrowest record it has, but the number it discards is
 * exactly the one a reader wants: a player who is 50% on Yone across his career
 * and has not touched it this split reads very differently from one who is 50%
 * on it right now. Both are shown, with the scored one marked, so the tally can
 * be checked rather than taken on faith.
 */
function LaneRecords({ pick }: { pick: PickLine }) {
  if (!pick.splitRecord && !pick.careerRecord) {
    return <p className="lane-note dim">{pick.note}</p>;
  }
  return (
    <div className="lane-records">
      <RecordChip
        label={pick.splitLabel ?? 'this split'}
        record={pick.splitRecord}
        // A blend is scored from both, so both are marked.
        scored={pick.scope === 'split' || pick.scope === 'blend'}
        empty="not picked yet"
      />
      <RecordChip
        label="career"
        record={pick.careerRecord}
        scored={pick.scope === 'career' || pick.scope === 'blend'}
        empty="none"
      />
    </div>
  );
}

function RecordChip({
  label,
  record,
  scored,
  empty,
}: {
  label: string;
  record: WinLoss | null;
  scored: boolean;
  empty: string;
}) {
  return (
    <span className={`lane-record${scored ? ' is-scored' : ''}`}>
      <span className="lane-record-label">{label}</span>
      {record && record.games > 0 ? (
        <>
          <strong>{Math.round((record.wins / record.games) * 100)}%</strong>
          <span className="dim">
            {record.wins}W/{record.games}
          </span>
        </>
      ) : (
        <span className="dim">{empty}</span>
      )}
    </span>
  );
}

function EdgeList({
  label,
  tone,
  champions,
}: {
  label: string;
  tone: 'good' | 'bad' | 'warm';
  champions: { id: string; name: string }[];
}) {
  if (champions.length === 0) return null;
  return (
    <span className={`edge edge--${tone}`}>
      <span className="edge-label">{label}</span>
      {champions.map((champion) => (
        <span className="edge-name" key={champion.id}>
          {champion.name}
        </span>
      ))}
    </span>
  );
}
