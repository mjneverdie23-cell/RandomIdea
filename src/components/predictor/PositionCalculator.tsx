import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PROFILE,
  MARKET_STOP_AT,
  RISK_PROFILES,
  THIN_RECORD_GAMES,
  assessPosition,
  modelProbability,
  parseOdds,
  type Market,
  type MarketQuality,
  type RiskProfileId,
  type SideAssessment,
} from '../../predictor/position.ts';
import type { Prediction, SeriesLength } from '../../predictor/types.ts';
import { readTabScoped, writeTabScoped } from '../../storage/tabScoped.ts';

/**
 * Bankroll and risk appetite belong to the person, not the match, so they are
 * shared across tabs. Everything about the price belongs to one match.
 */
const PREFS_KEY = 'draftcall.position.prefs.v1';
const MATCH_KEY = 'draftcall.position.match.v1';

interface Prefs {
  bankroll: string;
  profile: RiskProfileId;
}

interface MatchState {
  /** `blue|red` the odds were entered for. */
  teams: string;
  market: Market;
  oddsBlue: string;
  oddsRed: string;
  useRead: boolean;
  /** The user's read on blue, in whole percent. */
  readBlue: number | null;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      return {
        bankroll: typeof parsed.bankroll === 'string' ? parsed.bankroll : '',
        profile:
          parsed.profile && parsed.profile in RISK_PROFILES ? parsed.profile : DEFAULT_PROFILE,
      };
    }
  } catch {
    // Storage is a convenience; fall through to defaults.
  }
  return { bankroll: '', profile: DEFAULT_PROFILE };
}

/**
 * The saved price for this matchup, and nothing else's.
 *
 * Odds typed for yesterday's series must never size today's — that is the
 * single most expensive mistake a sizing tool can make quietly. So a stored
 * price is only reused when it was entered for these two teams. If they are
 * the same two teams with the sides swapped, the prices and the read travel
 * with their teams rather than staying on the wrong side.
 */
function loadMatch(teams: string): MatchState {
  let stored: MatchState | null = null;
  try {
    const raw = readTabScoped(MATCH_KEY);
    if (raw) stored = JSON.parse(raw) as MatchState;
  } catch {
    stored = null;
  }
  const fresh: MatchState = {
    teams,
    market: stored?.market === 'game' ? 'game' : 'series',
    oddsBlue: '',
    oddsRed: '',
    useRead: false,
    readBlue: null,
  };
  if (!stored) return fresh;
  if (stored.teams === teams) return stored;

  const [a = '', b = ''] = stored.teams.split('|');
  if (`${b}|${a}` === teams) {
    return {
      ...stored,
      teams,
      oddsBlue: stored.oddsRed,
      oddsRed: stored.oddsBlue,
      readBlue: stored.readBlue === null ? null : 100 - stored.readBlue,
    };
  }
  return fresh;
}

const pct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`;
const signedPct = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%`;
const money = (x: number) =>
  x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const QUALITY_LABEL: Record<MarketQuality, string> = {
  arbitrage: 'under 100% — check the prices',
  tight: 'tight',
  normal: 'normal',
  high: 'high',
  'very high': 'very high',
};

interface Props {
  prediction: Prediction;
  blueTeam: string;
  redTeam: string;
  seriesLength: SeriesLength;
}

export function PositionCalculator({ prediction, blueTeam, redTeam, seriesLength }: Props) {
  const teams = `${blueTeam}|${redTeam}`;
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [match, setMatch] = useState<MatchState>(() => loadMatch(teams));

  // Re-key on a new matchup during render rather than in an effect, so there
  // is never a frame where the new teams are shown against the old prices.
  const [loadedFor, setLoadedFor] = useState(teams);
  if (loadedFor !== teams) {
    setLoadedFor(teams);
    setMatch(loadMatch(teams));
  }

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Not persisting is fine.
    }
  }, [prefs]);
  useEffect(() => writeTabScoped(MATCH_KEY, JSON.stringify(match)), [match]);

  // A best-of-one's series is its game; offering both would be noise.
  const market: Market = seriesLength === 'BO1' ? 'game' : match.market;
  const modelBlue = modelProbability(prediction, market);
  const reportBlue = market === 'series' ? prediction.seriesProbBlue : prediction.gameProbBlue;

  const oddsBlue = parseOdds(match.oddsBlue);
  const oddsRed = parseOdds(match.oddsRed);
  const bankroll = Number(prefs.bankroll.replace(/[, ]/g, ''));

  /**
   * Lanes whose win rate rests on almost nothing: no record at all, or a record
   * of a few games. A 0-for-3 moves the margin as hard as a 0-for-30 does, and
   * a draft full of them is how the model ends up confidently wrong.
   */
  const thinLanes = useMemo(
    () =>
      [...prediction.blue.picks, ...prediction.red.picks].filter((pick) => {
        if (pick.scope === 'unknown' || pick.scope === 'none') return true;
        const record = pick.scope === 'split' ? pick.splitRecord : pick.careerRecord;
        if (pick.scope === 'team' || !record) return false;
        return record.games < THIN_RECORD_GAMES;
      }).length,
    [prediction],
  );

  const assessment = useMemo(() => {
    if (modelBlue === null) return null;
    return assessPosition({
      bankroll: Number.isFinite(bankroll) && bankroll > 0 ? bankroll : null,
      oddsBlue,
      oddsRed,
      modelBlue,
      readBlue: match.useRead && match.readBlue !== null ? match.readBlue / 100 : null,
      profile: prefs.profile,
      thinLanes,
    });
  }, [modelBlue, bankroll, oddsBlue, oddsRed, match.useRead, match.readBlue, prefs.profile, thinLanes]);

  const update = (patch: Partial<MatchState>) => setMatch((m) => ({ ...m, ...patch }));
  const nameOf = (side: 'blue' | 'red') => (side === 'blue' ? blueTeam : redTeam);

  return (
    <section className="panel position-panel" aria-label="Position calculator">
      <div className="panel-header">
        <h2>Position calculator</h2>
        <span className="dim">{RISK_PROFILES[prefs.profile].blurb}</span>
      </div>

      <div className="position-body">
        <div className="position-inputs">
          <label className="field">
            <span className="field-label">Bankroll</span>
            <input
              id="position-bankroll"
              className="input num"
              inputMode="decimal"
              placeholder="e.g. 1000"
              value={prefs.bankroll}
              onChange={(e) => setPrefs((p) => ({ ...p, bankroll: e.target.value }))}
            />
          </label>

          <label className="field">
            <span className="field-label">Market</span>
            <select
              id="position-market"
              className="select"
              value={market}
              disabled={seriesLength === 'BO1'}
              onChange={(e) => update({ market: e.target.value as Market })}
            >
              <option value="series">Series winner</option>
              <option value="game">This game</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">Risk profile</span>
            <select
              id="position-profile"
              className="select"
              value={prefs.profile}
              onChange={(e) => setPrefs((p) => ({ ...p, profile: e.target.value as RiskProfileId }))}
            >
              {(Object.keys(RISK_PROFILES) as RiskProfileId[]).map((id) => (
                <option key={id} value={id}>
                  {RISK_PROFILES[id].label}
                </option>
              ))}
            </select>
          </label>

          <OddsField
            id="position-odds-blue"
            team={blueTeam}
            tone="blue"
            raw={match.oddsBlue}
            parsed={oddsBlue}
            onChange={(oddsBlue) => update({ oddsBlue })}
          />
          <OddsField
            id="position-odds-red"
            team={redTeam}
            tone="red"
            raw={match.oddsRed}
            parsed={oddsRed}
            onChange={(oddsRed) => update({ oddsRed })}
          />
        </div>

        {modelBlue !== null && (
          <div className="position-read">
            <label className="position-read-toggle">
              <input
                id="position-use-read"
                type="checkbox"
                checked={match.useRead}
                onChange={(e) =>
                  update({
                    useRead: e.target.checked,
                    // Start the slider on the model, so switching it on changes
                    // nothing until the user actually moves it.
                    readBlue: match.readBlue ?? Math.round(modelBlue * 100),
                  })
                }
              />
              <span>Add my own read</span>
              <span className="dim">— for what the model can't see: a sub, a patch, a sick player</span>
            </label>
            {match.useRead && match.readBlue !== null && (
              <div className="position-read-slider">
                <span className="position-read-team is-blue">
                  {blueTeam} <strong>{match.readBlue}%</strong>
                </span>
                <input
                  id="position-read"
                  type="range"
                  min={5}
                  max={95}
                  step={1}
                  value={match.readBlue}
                  onChange={(e) => update({ readBlue: Number(e.target.value) })}
                  aria-label={`How sure you are that ${blueTeam} wins`}
                />
                <span className="position-read-team is-red">
                  <strong>{100 - match.readBlue}%</strong> {redTeam}
                </span>
                <span className="dim position-read-model">model {pct(modelBlue, 0)}</span>
              </div>
            )}
          </div>
        )}

        {assessment === null ? (
          <p className="position-verdict is-info">
            This series is already decided at this score. Switch the market to <em>This game</em>,
            or there is nothing left to price.
          </p>
        ) : (
          <>
            <Verdict assessment={assessment} nameOf={nameOf} />

            <div className="position-table-wrap">
              <table className="position-table">
                <thead>
                  <tr>
                    <th />
                    <th className="is-blue">{blueTeam}</th>
                    <th className="is-red">{redTeam}</th>
                  </tr>
                </thead>
                <tbody>
                  <Row label="Offered odds" a={assessment.blue} b={assessment.red} cell={(s) => s.odds?.toFixed(2)} />
                  <Row
                    label="Implied, margin in"
                    a={assessment.blue}
                    b={assessment.red}
                    cell={(s) => (s.implied === null ? undefined : pct(s.implied))}
                  />
                  <Row
                    label="Market, margin out"
                    a={assessment.blue}
                    b={assessment.red}
                    cell={(s) => (s.marketFair === null ? undefined : pct(s.marketFair))}
                  />
                  <Row label="Model, calibrated" a={assessment.blue} b={assessment.red} cell={(s) => pct(s.model)} />
                  {match.useRead && (
                    <Row
                      label="Your read"
                      a={assessment.blue}
                      b={assessment.red}
                      cell={(s) => (s.read === null ? undefined : pct(s.read, 0))}
                    />
                  )}
                  <Row
                    label="Estimate"
                    strong
                    a={assessment.blue}
                    b={assessment.red}
                    cell={(s) => pct(s.estimate)}
                  />
                  <Row label="Fair odds" strong a={assessment.blue} b={assessment.red} cell={(s) => s.fairOdds.toFixed(2)} />
                  <Row
                    label={`Take it down to`}
                    a={assessment.blue}
                    b={assessment.red}
                    cell={(s) => s.minOdds.toFixed(2)}
                  />
                  <Row
                    label="Edge vs market"
                    a={assessment.blue}
                    b={assessment.red}
                    cell={(s) => (s.edgeVsMarket === null ? undefined : signedPct(s.edgeVsMarket))}
                  />
                  <Row
                    label="Expected value / unit"
                    a={assessment.blue}
                    b={assessment.red}
                    cell={(s) => (s.ev === null ? undefined : signedPct(s.ev))}
                    tone={(s) => (s.ev === null ? '' : s.ev > 0 ? 'is-pos' : 'is-neg')}
                  />
                  <Row
                    label="Full Kelly (reference)"
                    a={assessment.blue}
                    b={assessment.red}
                    cell={(s) => (s.fullKelly === null ? undefined : s.fullKelly > 0 ? pct(s.fullKelly) : '—')}
                  />
                  <tr className="position-stake-row">
                    <th scope="row">Stake</th>
                    {[assessment.blue, assessment.red].map((s) => (
                      <td key={s.side}>
                        <StakeCell side={s} blocked={assessment.blocked !== null} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {assessment.market && (
              <p className={`position-market is-${assessment.market.quality.replace(' ', '-')}`}>
                Bookmaker margin <strong>{signedPct(assessment.market.overround)}</strong> —{' '}
                {QUALITY_LABEL[assessment.market.quality]}
              </p>
            )}

            {assessment.warnings.length > 0 && (
              <ul className="position-warnings">
                {assessment.warnings.map((w) => (
                  <li key={w.text} className={`is-${w.tone}`}>
                    {w.text}
                  </li>
                ))}
              </ul>
            )}

            <p className="position-foot">
              Staked on a re-calibrated probability, not the one in the report above — here{' '}
              {blueTeam} is {pct(reportBlue)} in the report and {pct(assessment.blue.model)} for
              staking. At the report&apos;s scale the favourite wins about 12 points less often than
              stated once it says 80%+ (measured over 3,692 games), and Kelly bets hardest exactly
              where a model is overconfident. The model calls the winner about 64% of the time. This
              sizes one position: count anything you already have on this series against the cap, and
              never stake money you can&apos;t afford to lose.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function OddsField({
  id,
  team,
  tone,
  raw,
  parsed,
  onChange,
}: {
  id: string;
  team: string;
  tone: 'blue' | 'red';
  raw: string;
  parsed: number | null;
  onChange: (value: string) => void;
}) {
  const invalid = raw.trim() !== '' && parsed === null;
  // Show how a non-decimal price was read, so `150` vs `+150` is never a guess.
  const echo = parsed !== null && raw.trim() !== parsed.toFixed(2) ? `= ${parsed.toFixed(2)}` : null;
  return (
    <label className="field">
      <span className={`field-label position-odds-label is-${tone}`}>Odds · {team}</span>
      <input
        id={id}
        className={`input num${invalid ? ' is-invalid' : ''}`}
        placeholder="1.85, +150, 5/4"
        value={raw}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
      />
      <span className="field-hint position-odds-hint">
        {invalid
          ? 'Not a price — decimal (1.85), American (+150 / −200) or fractional (5/4)'
          : parsed !== null
            ? `${echo ? `${echo} · ` : ''}implies ${pct(1 / parsed)}`
            : ' '}
      </span>
    </label>
  );
}

function Row({
  label,
  a,
  b,
  cell,
  tone,
  strong,
}: {
  label: string;
  a: SideAssessment;
  b: SideAssessment;
  cell: (s: SideAssessment) => string | undefined;
  tone?: (s: SideAssessment) => string;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'is-strong' : undefined}>
      <th scope="row">{label}</th>
      {[a, b].map((s) => (
        <td key={s.side} className={tone?.(s)}>
          {cell(s) ?? <span className="dim">—</span>}
        </td>
      ))}
    </tr>
  );
}

function StakeCell({ side, blocked }: { side: SideAssessment; blocked: boolean }) {
  if (side.verdict === 'no odds') return <span className="dim">no price</span>;
  if (side.verdict !== 'value') {
    return <span className={`position-tag is-${side.verdict.replace(' ', '-')}`}>{side.verdict}</span>;
  }
  // The numbers say value, but the inputs failed a sanity check — never dress
  // that up as a recommendation.
  if (blocked) return <span className="position-tag is-blocked">not sized</span>;
  return (
    <span className="position-stake">
      <span className="position-tag is-value">value</span>
      <strong>{pct(side.stakeFraction, 2)}</strong>
      {side.stake !== null && <span>{money(side.stake)}</span>}
      {side.capped && <span className="dim">capped</span>}
    </span>
  );
}

function Verdict({
  assessment,
  nameOf,
}: {
  assessment: NonNullable<ReturnType<typeof assessPosition>>;
  nameOf: (side: 'blue' | 'red') => string;
}) {
  const { pick, blue, red, profile, blocked, distance, taper } = assessment;
  const priced = blue.odds !== null || red.odds !== null;

  if (blocked === 'arbitrage') {
    return (
      <p className="position-verdict is-danger">
        <strong>Check the odds first.</strong> These two prices can&apos;t both be right — nothing is
        sized until they are.
      </p>
    );
  }

  if (!priced) {
    return (
      <p className="position-verdict is-info">
        <strong>Fair price:</strong> {nameOf('blue')} {blue.fairOdds.toFixed(2)} · {nameOf('red')}{' '}
        {red.fairOdds.toFixed(2)}. Don&apos;t take less than {blue.minOdds.toFixed(2)} /{' '}
        {red.minOdds.toFixed(2)}. Enter the current odds to size a position.
      </p>
    );
  }

  if (blocked === 'no market') {
    const missing = blue.odds === null ? nameOf('blue') : nameOf('red');
    return (
      <p className="position-verdict is-info">
        <strong>Add {missing}&apos;s price too.</strong> A market can&apos;t be validated from one
        side — the margin, and whether the price is even sane, need both. Fair price:{' '}
        {nameOf('blue')} {blue.fairOdds.toFixed(2)} · {nameOf('red')} {red.fairOdds.toFixed(2)}.
      </p>
    );
  }

  if (blocked === 'far from market' && distance !== null) {
    return (
      <p className="position-verdict is-danger">
        <strong>Check the inputs — {Math.round(distance * 100)} points from the market.</strong>{' '}
        That gap is not an edge. Is the series score current, and is the market set to what the
        price is for? Nothing is sized past {Math.round(MARKET_STOP_AT * 100)} points.
      </p>
    );
  }

  if (pick) {
    return (
      <p className="position-verdict is-bet">
        <strong>
          Back {nameOf(pick.side)} — risk {pct(pick.stakeFraction, 2)} of bankroll
          {pick.stake !== null ? ` (${money(pick.stake)})` : ''}
        </strong>{' '}
        at {pick.odds!.toFixed(2)}, worth {signedPct(pick.ev!)} per unit. Still a position down to{' '}
        {pick.minOdds.toFixed(2)}; fair is {pick.fairOdds.toFixed(2)}.
        {taper < 1 && ` Cut to ${Math.round(taper * 100)}% of normal size for sitting ${Math.round((distance ?? 0) * 100)} points off the market.`}
      </p>
    );
  }

  // No position: explain it from the side that came closest.
  const best = [blue, red]
    .filter((s) => s.ev !== null)
    .sort((a, b) => (b.ev ?? -Infinity) - (a.ev ?? -Infinity))[0]!;
  return (
    <p className="position-verdict is-pass">
      <strong>No position.</strong>{' '}
      {best.verdict === 'thin'
        ? `Best edge is ${signedPct(best.ev!)} on ${nameOf(best.side)} — below the ${pct(profile.minEdge, 0)} this profile needs to clear model error.`
        : `Neither price beats fair value.`}{' '}
      You&apos;d want {nameOf(best.side)} at {best.minOdds.toFixed(2)} or better.
    </p>
  );
}
