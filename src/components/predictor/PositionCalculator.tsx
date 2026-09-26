import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BASE_KELLY,
  MARKET_STOP_AT,
  MARKET_TAPER_FROM,
  MAX_STAKE,
  MIN_EDGE,
  THIN_RECORD_GAMES,
  assessPosition,
  modelProbability,
  parseCents,
  parseSureness,
  spikeWatch,
  userProbability,
  type Market,
  type PositionAssessment,
  type Side,
  type SideAssessment,
  type SpikeWatch,
} from '../../predictor/position.ts';
import { SWING_GOLD } from '../../predictor/derive.ts';
import type { GoldSwing, Prediction, SeriesLength } from '../../predictor/types.ts';
import { readTabScoped, writeTabScoped } from '../../storage/tabScoped.ts';

/**
 * The bankroll and the price ceiling belong to the person, not the match, so
 * they are shared across tabs. Everything about the price and the pick belongs
 * to one match.
 */
const PREFS_KEY = 'draftcall.position.prefs.v1';
// v1 held decimal odds; reading "1.60" back as 1.6¢ would be a silent disaster.
const MATCH_KEY = 'draftcall.position.match.v2';

interface MatchState {
  /** `blue|red` the prices were entered for. */
  teams: string;
  market: Market;
  priceBlue: string;
  priceRed: string;
  /** The team the user says wins — by name, so it survives a side swap. */
  pick: string;
  /** How sure they are, in percent, as typed. */
  sure: string;
}

interface Prefs {
  bankroll: string;
  /** The most the person will pay for a share, in cents as typed; blank for no ceiling. */
  maxEntry: string;
}

/** Most people who set a ceiling set it here; the field is always editable. */
const DEFAULT_MAX_ENTRY = '60';

function loadPrefs(): Prefs {
  const prefs: Prefs = { bankroll: '', maxEntry: DEFAULT_MAX_ENTRY };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { bankroll?: unknown; maxEntry?: unknown };
      if (typeof parsed.bankroll === 'string') prefs.bankroll = parsed.bankroll;
      if (typeof parsed.maxEntry === 'string') prefs.maxEntry = parsed.maxEntry;
    }
  } catch {
    // Storage is a convenience; fall through to defaults.
  }
  return prefs;
}

/**
 * The saved price for this matchup, and nothing else's.
 *
 * A price typed for yesterday's series must never size today's — that is the
 * single most expensive mistake a sizing tool can make quietly. So a stored
 * price is only reused when it was entered for these two teams. If they are
 * the same two teams with the sides swapped, the prices travel with their
 * teams rather than staying on the wrong side.
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
    priceBlue: '',
    priceRed: '',
    pick: '',
    sure: '',
  };
  if (!stored) return fresh;
  if (stored.teams === teams) return stored;

  const [a = '', b = ''] = stored.teams.split('|');
  if (`${b}|${a}` === teams) {
    return { ...stored, teams, priceBlue: stored.priceRed, priceRed: stored.priceBlue };
  }
  return fresh;
}

const pct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`;
const money = (x: number) =>
  x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A price as the market writes it: whole cents, or a tenth when that is what was typed. */
const cents = (p: number) => {
  const v = Math.round(p * 1000) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}¢`;
};
/** A probability quoted as a price: whole cents are all the precision the model has. */
const fair = (p: number) => `${Math.round(p * 100)}¢`;
/** A limit is rounded down: never quote a ceiling the edge does not actually clear. */
const limit = (p: number) => `${Math.max(0, Math.floor(p * 100 + 1e-6))}¢`;
const signedCents = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p * 1000) / 10)}¢`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Props {
  prediction: Prediction;
  blueTeam: string;
  redTeam: string;
  seriesLength: SeriesLength;
  /** Real gold leads and deficits by minute, per team (lower-case name). */
  goldSwing: Map<string, GoldSwing>;
  goldSwingLeague: GoldSwing;
}

export function PositionCalculator({
  prediction,
  blueTeam,
  redTeam,
  seriesLength,
  goldSwing,
  goldSwingLeague,
}: Props) {
  const teams = `${blueTeam}|${redTeam}`;
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [match, setMatch] = useState<MatchState>(() => loadMatch(teams));
  const sureRef = useRef<HTMLInputElement>(null);

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

  const priceBlue = parseCents(match.priceBlue);
  const priceRed = parseCents(match.priceRed);
  const sure = parseSureness(match.sure);
  const pickSide: Side | null =
    match.pick === blueTeam ? 'blue' : match.pick === redTeam ? 'red' : null;
  const bankroll = Number(prefs.bankroll.replace(/[, $]/g, ''));
  const maxEntry = parseCents(prefs.maxEntry);

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
      priceBlue,
      priceRed,
      modelBlue,
      userBlue: userProbability(pickSide, sure),
      thinLanes,
      maxEntry,
      pick: pickSide,
    });
  }, [modelBlue, bankroll, priceBlue, priceRed, pickSide, sure, thinLanes, maxEntry]);

  /** When the team you'd be waiting against is likeliest to take a real lead. */
  const watch = useMemo(() => {
    if (assessment?.decision.kind !== 'wait') return null;
    const ours = assessment.decision.side;
    const theirs = ours === 'blue' ? 'red' : 'blue';
    const key = (side: Side) => (side === 'blue' ? blueTeam : redTeam).toLowerCase();
    return spikeWatch(goldSwing.get(key(theirs)), goldSwing.get(key(ours)), goldSwingLeague);
  }, [assessment, goldSwing, goldSwingLeague, blueTeam, redTeam]);

  const update = (patch: Partial<MatchState>) => setMatch((m) => ({ ...m, ...patch }));
  const nameOf = (side: Side) => (side === 'blue' ? blueTeam : redTeam);

  const choose = (side: Side) => {
    if (pickSide === side) {
      update({ pick: '' });
      return;
    }
    update({ pick: nameOf(side) });
    // The next thing anyone does after picking is say how sure — save the click.
    sureRef.current?.focus();
  };

  const sureInvalid = match.sure.trim() !== '' && sure === null;
  const maxEntryInvalid = prefs.maxEntry.trim() !== '' && maxEntry === null;

  return (
    <section className="panel position-panel" aria-label="Position calculator">
      <div className="panel-header">
        <h2>Position calculator</h2>
        <span className="dim">Sized by the model · never over {pct(MAX_STAKE, 0)} of bankroll</span>
      </div>

      <div className="position-body">
        <div className="position-inputs">
          <div className="field position-field-pick">
            <span className="field-label">Who wins {market === 'series' ? 'the series' : 'this game'}?</span>
            <div className="position-pick" role="group" aria-label="Who wins">
              {(['blue', 'red'] as const).map((side) => (
                <button
                  key={side}
                  id={`position-pick-${side}`}
                  type="button"
                  className={`position-pick-btn is-${side}`}
                  aria-pressed={pickSide === side}
                  title={nameOf(side)}
                  onClick={() => choose(side)}
                >
                  {nameOf(side)}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">How sure?</span>
            <span className="position-affix">
              <input
                id="position-sure"
                ref={sureRef}
                className={`input num${sureInvalid ? ' is-invalid' : ''}`}
                inputMode="decimal"
                placeholder="e.g. 70"
                value={match.sure}
                onChange={(e) => update({ sure: e.target.value })}
                aria-invalid={sureInvalid}
              />
              <span aria-hidden="true">%</span>
            </span>
            {sureInvalid && <span className="field-hint position-hint is-error">50 to 100</span>}
            {!sureInvalid && sure !== null && pickSide === null && (
              <span className="field-hint position-hint">Pick who wins</span>
            )}
          </label>

          {(['blue', 'red'] as const).map((side) => {
            const raw = side === 'blue' ? match.priceBlue : match.priceRed;
            const other = side === 'blue' ? priceRed : priceBlue;
            return (
              <PriceField
                key={side}
                id={`position-price-${side}`}
                team={nameOf(side)}
                tone={side}
                raw={raw}
                parsed={side === 'blue' ? priceBlue : priceRed}
                complement={raw.trim() === '' && other !== null ? 1 - other : null}
                onChange={(value) => update(side === 'blue' ? { priceBlue: value } : { priceRed: value })}
              />
            );
          })}

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
            <span className="field-label">Max entry</span>
            <span className="position-affix">
              <input
                id="position-max-entry"
                className={`input num${maxEntryInvalid ? ' is-invalid' : ''}`}
                inputMode="decimal"
                placeholder="none"
                value={prefs.maxEntry}
                onChange={(e) => setPrefs((p) => ({ ...p, maxEntry: e.target.value }))}
                aria-invalid={maxEntryInvalid}
              />
              <span aria-hidden="true">¢</span>
            </span>
            {maxEntryInvalid && <span className="field-hint position-hint is-error">1 to 99, or blank</span>}
          </label>

          {seriesLength !== 'BO1' && (
            <div className="field">
              <span className="field-label">Prices are for</span>
              <div className="position-seg" role="group" aria-label="Prices are for">
                {(['series', 'game'] as const).map((m) => (
                  <button
                    key={m}
                    id={`position-market-${m}`}
                    type="button"
                    aria-pressed={market === m}
                    onClick={() => update({ market: m })}
                  >
                    {m === 'series' ? 'Series' : 'Game'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {assessment === null ? (
          <div className="position-call is-info" role="status">
            <div className="position-call-row">
              <span className="position-call-action">Series decided</span>
            </div>
            <div className="position-call-row is-sub">
              <span>Nothing left to price on the series — switch the prices to Game.</span>
            </div>
          </div>
        ) : (
          <>
            <Call assessment={assessment} nameOf={nameOf} maxEntry={maxEntry} watch={watch} />
            <Workings
              assessment={assessment}
              blueTeam={blueTeam}
              redTeam={redTeam}
              reportBlue={reportBlue}
              thinLanes={thinLanes}
            />
          </>
        )}
      </div>
    </section>
  );
}

function PriceField({
  id,
  team,
  tone,
  raw,
  parsed,
  complement,
  onChange,
}: {
  id: string;
  team: string;
  tone: Side;
  raw: string;
  parsed: number | null;
  /** The other side's complement, shown and used when this one is left blank. */
  complement: number | null;
  onChange: (value: string) => void;
}) {
  const invalid = raw.trim() !== '' && parsed === null;
  // Echo only a price typed in another form (0.40, $0.40), so it is never a guess.
  const echo = parsed !== null && raw.trim().replace(/\s*(¢|c)$/i, '') !== cents(parsed).slice(0, -1);
  return (
    <label className="field">
      <span className={`field-label position-price-label is-${tone}`} title={team}>
        {team}
      </span>
      <span className="position-affix">
        <input
          id={id}
          className={`input num${invalid ? ' is-invalid' : ''}`}
          inputMode="decimal"
          placeholder={complement !== null ? `${cents(complement).slice(0, -1)} auto` : 'e.g. 40'}
          value={raw}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
        <span aria-hidden="true">¢</span>
      </span>
      {invalid && <span className="field-hint position-hint is-error">Price in cents, 1 to 99</span>}
      {echo && <span className="field-hint position-hint">= {cents(parsed)}</span>}
    </label>
  );
}

/**
 * The answer, in the fewest words that carry it: what to do, how much, and the
 * one price that matters. Everything else is in the workings below.
 */
function Call({
  assessment,
  nameOf,
  maxEntry,
  watch,
}: {
  assessment: PositionAssessment;
  nameOf: (side: Side) => string;
  maxEntry: number | null;
  watch: SpikeWatch | null;
}) {
  /** The most worth paying, or the user's ceiling if that is lower. */
  const entry = (s: SideAssessment) =>
    maxEntry !== null && maxEntry < s.maxPrice ? `${limit(maxEntry)} (your max)` : limit(s.maxPrice);
  const { decision, blue, red, notes } = assessment;
  const note = notes.length > 0 && <p className="position-call-note">{capitalise(notes.join(' · '))}</p>;

  switch (decision.kind) {
    case 'buy': {
      const s = decision.side === 'blue' ? blue : red;
      return (
        <div className="position-call is-buy" role="status">
          <div className="position-call-row">
            <span className="position-call-action">Buy {nameOf(s.side)}</span>
            <span className="position-call-stake">
              {s.stake !== null ? money(s.stake) : pct(s.stakeFraction)}
            </span>
          </div>
          <div className="position-call-row is-sub">
            <span>
              at {cents(s.price!)} · worth it up to <strong>{limit(s.maxPrice)}</strong> · fair{' '}
              {fair(s.estimate)}
            </span>
            <span>{pct(s.stakeFraction)} of bankroll</span>
          </div>
          {note}
        </div>
      );
    }
    case 'wait': {
      const s = decision.side === 'blue' ? blue : red;
      const them = nameOf(decision.side === 'blue' ? 'red' : 'blue');
      return (
        <div className="position-call is-wait" role="status">
          <div className="position-call-row">
            <span className="position-call-action">
              Wait — {nameOf(s.side)} at {limit(decision.target)} or less
            </span>
            {decision.stakeFraction > 0 && (
              <span className="position-call-stake">
                {decision.stake !== null ? money(decision.stake) : pct(decision.stakeFraction)}
              </span>
            )}
          </div>
          <div className="position-call-row is-sub">
            <span>
              Now {cents(s.price!)} —{' '}
              {decision.reason === 'limit'
                ? `over your ${limit(maxEntry!)} max`
                : `no edge above ${limit(s.maxPrice)}`}{' '}
              · fair {fair(s.estimate)}
            </span>
            <span>
              {decision.stakeFraction > 0
                ? `at ${limit(decision.target)} if the game is still even`
                : `too far from fair to size at ${limit(decision.target)}`}
            </span>
          </div>
          {watch && (
            <p className="position-call-watch">
              <strong>Watch ~{watch.minute} min:</strong> {them} is {SWING_GOLD / 1000}k+ gold up at {watch.minute} in{' '}
              {pct(watch.rate, 0)} of games (league {pct(watch.leagueRate, 0)}).
              {watch.comeback !== null &&
                ` From that far down, ${watch.comebackIsLeague ? 'teams' : nameOf(s.side)} won ${pct(watch.comeback, 0)} (${watch.comebackSample} games) — a dip on a real lead is not a discount.`}
            </p>
          )}
          {note}
        </div>
      );
    }
    case 'no price':
      return (
        <div className="position-call is-info" role="status">
          <div className="position-call-row">
            <span className="position-call-action">Fair price</span>
            <span className="position-call-stake is-pair">
              {nameOf('blue')} {fair(blue.estimate)} · {nameOf('red')} {fair(red.estimate)}
            </span>
          </div>
          <div className="position-call-row is-sub">
            <span>
              Buy up to: {nameOf('blue')} <strong>{entry(blue)}</strong> · {nameOf('red')}{' '}
              <strong>{entry(red)}</strong>
            </span>
          </div>
        </div>
      );
    case 'crossed':
      return (
        <div className="position-call is-danger" role="status">
          <div className="position-call-row">
            <span className="position-call-action">Check the prices</span>
          </div>
          <div className="position-call-row is-sub">
            <span>
              {cents(blue.price!)} + {cents(red.price!)} = {cents(decision.total)} — under 100¢, so one of them
              is wrong.
            </span>
          </div>
        </div>
      );
    case 'too far':
      return (
        <div className="position-call is-danger" role="status">
          <div className="position-call-row">
            <span className="position-call-action">Don&apos;t size</span>
            <span className="position-call-stake">{Math.round(decision.distance * 100)} pts off</span>
          </div>
          <div className="position-call-row is-sub">
            <span>
              That gap is a wrong input, not an edge — check the series score and what the price is
              for, or you&apos;re surer than you should be.
            </span>
          </div>
        </div>
      );
  }
}

/** The full working, folded away so it never slows the decision down. */
function Workings({
  assessment,
  blueTeam,
  redTeam,
  reportBlue,
  thinLanes,
}: {
  assessment: PositionAssessment;
  blueTeam: string;
  redTeam: string;
  reportBlue: number;
  thinLanes: number;
}) {
  const { blue, red, market } = assessment;
  const hasUser = blue.user !== null;
  const priced = market !== null;
  const row = (label: string, cell: (s: SideAssessment) => string | null, strong = false) => (
    <tr className={strong ? 'is-strong' : undefined}>
      <th scope="row">{label}</th>
      {[blue, red].map((s) => (
        <td key={s.side}>{cell(s) ?? <span className="dim">—</span>}</td>
      ))}
    </tr>
  );

  return (
    <details className="position-details">
      <summary>Show the working</summary>
      <table className="position-table">
        <thead>
          <tr>
            <th />
            <th className="is-blue">{blueTeam}</th>
            <th className="is-red">{redTeam}</th>
          </tr>
        </thead>
        <tbody>
          {row('Price', (s) => (s.price === null ? null : `${cents(s.price)}${s.assumed ? ' auto' : ''}`))}
          {priced && row('Market, spread out', (s) => (s.marketFair === null ? null : cents(s.marketFair)))}
          {row('Model', (s) => cents(s.model))}
          {hasUser && row('You', (s) => (s.user === null ? null : cents(s.user)))}
          {row('Fair', (s) => cents(s.estimate), true)}
          {row('Worth it up to', (s) => limit(s.maxPrice))}
          {priced && row('Edge', (s) => (s.edge === null ? null : signedCents(s.edge)))}
          {priced &&
            row('Full Kelly', (s) => (s.fullKelly === null || s.fullKelly <= 0 ? null : pct(s.fullKelly)))}
          {priced && row('Conviction', (s) => (s.value ? pct(s.conviction.value, 0) : null))}
          {priced && row('Stake', (s) => (s.stakeFraction > 0 ? pct(s.stakeFraction) : null), true)}
        </tbody>
      </table>

      {market && (
        <p className="position-foot">
          Spread {signedCents(market.spread)} ({market.quality}).
        </p>
      )}
      <p className="position-foot">
        <strong>How the size is set.</strong> A side is only bought {Math.round(MIN_EDGE * 100)}¢ or
        more under its fair price. The stake is {pct(BASE_KELLY, 0)} of full Kelly
        times conviction, capped at {pct(MAX_STAKE, 0)} times the same conviction. Conviction starts at
        100% and is halved when you and the model split (one says the price is cheap, the other
        doesn&apos;t), halved when 4+ picks rest on under {THIN_RECORD_GAMES} games (here {thinLanes}), and
        tapers to nothing between {Math.round(MARKET_TAPER_FROM * 100)} and{' '}
        {Math.round(MARKET_STOP_AT * 100)} points off the market. Your sureness counts half, the model
        half.
      </p>
      <p className="position-foot">
        <strong>Waiting for an entry.</strong> Over your max entry, or with no edge yet, the call is to
        wait for the lower of the two prices, with the stake it would size there already worked out.
        That amount assumes the game is still roughly even when the price arrives. A price that falls
        because the other team took a {SWING_GOLD.toLocaleString()}g lead is mostly the market being
        right: league-wide, that lead at 15 minutes wins about 81% of the time. The watch line names
        the mark where the other team takes such a lead most unusually often (its rate is shrunk toward
        the league first), and how your team has done from that far behind there.
      </p>
      <p className="position-foot">
        The model here is re-calibrated, not the report&apos;s number — {blueTeam} is {pct(reportBlue)} in
        the report and {pct(blue.model)} for staking. At the report&apos;s scale the favourite wins about
        12 points less often than stated once it says 80%+ (3,692 games), and Kelly bets hardest exactly
        where a model is overconfident. It calls the winner about 64% of the time. This sizes one
        position: count anything already on this series against the cap, and never stake money you
        can&apos;t afford to lose.
      </p>
    </details>
  );
}
