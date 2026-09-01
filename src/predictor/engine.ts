/**
 * Transparent additive-points prediction engine.
 *
 * There are no fitted weights and no black box. Each side's score is a plain
 * sum of labelled line items, and the higher total is the predicted winner:
 *
 *   win-rate base   the 5 starters' win rates on those champions, split and
 *                   career averaged; an off-meta pick with no record scores 1.0
 *   meta bonus      +1 per meta champion (meta = picks + bans, computed live)
 *   pocket picks    1-2 off-meta picks -> +1.5 each ; more than 2 -> -2
 *   form edge       up to +1 for the better current-season series record
 *   motivation      +0.5 must-win, -0.5 nothing to play for, -1 tank incentive
 *   series edge     +0.3 per game of lead in the series so far, capped
 *   rank edge       +0.1 per place of GlobalRank gap, capped at 1.5
 *   dark horse      +0.1 per hand-listed high-ceiling champion
 *
 * The fraud rating is reported as a notice and deliberately not scored: over
 * 374 backtested games it cost accuracy, and alone it predicted the winner only
 * 44.2% of the time.
 *
 * The point margin becomes a per-game probability through a logistic curve,
 * and the series/sweep probabilities follow from that by counting the ways a
 * best-of can still be won. Behaviour (throws, comebacks, deciders), early-game
 * gold tempo and each champion's late/early scaling are reported as plain
 * language and deliberately do not move the score — they are context for the
 * reader, not fitted terms. Two were measured as scoring terms and rejected:
 * champion scaling runs backwards, and a deduction for drafting outside a
 * player's usual champion classes lost games in every form tried. See the
 * README.
 *
 * Pure: no I/O, no React, no dates. Everything it knows arrives in the model.
 */

import { ROLES, type Champion, type Role, type Side } from '../domain/types.ts';
import { relevantEdges } from './championGraph.ts';
import { primaryClass } from './championClasses.ts';
import { lookupRating } from './ratings.ts';
import {
  SERIES_TARGET,
  type GoldTempo,
  type GoldTempoPoint,
  type EarlyGoldProfile,
  type ClassAffinity,
  type Notice,
  type PickLine,
  type Prediction,
  type PredictionInput,
  type PredictorModel,
  type Motivation,
  type SideInput,
  type SideScore,
  type StandingRow,
  type TeamBehavior,
  type WinLoss,
} from './types.ts';

/* ------------------------------------------------------------------ */
/* Point rules                                                         */
/* ------------------------------------------------------------------ */

export const META_POINT = 1.0;

/**
 * What one off-meta pick is worth, and why it beats a meta pick.
 *
 * An off-meta champion earns no meta bonus, so at parity with `META_POINT` the
 * two cancelled out exactly: four meta picks plus one pocket pick scored the
 * same as five meta picks, and the surprise factor the term exists to reward
 * was invisible in the total. Pricing a pocket pick above a meta pick makes it
 * a real edge rather than a wash.
 */
export const POCKET_POINT = 1.5;
/** Off-meta picks a team can take before the draft reads as chaos, not a plan. */
export const POCKET_MAX = 2;
export const POCKET_MANY_PENALTY = -2.0;

/**
 * The pocket term used to be halved in game one, and no longer is.
 *
 * The argument for the discount was that opening games are the volatile ones:
 * neither side has seen what the other intends to play, so an off-meta pick
 * there says less about a plan than the same pick in game three. Reasonable,
 * and wrong. Measured three ways over the same 1,317 games, full weight beat
 * the halved version every time — +3 games raising the scale to 1.0, +3 pricing
 * a game-one pocket pick at 1.25, and a per-pick sweep with a broad flat
 * optimum from 1.25 to 1.75 and a dip exactly at the halved 0.75.
 *
 * The old rule also produced an oddity nobody would design on purpose: because
 * an off-meta pick forfeits its meta point but earned only half a pocket bonus,
 * a game-one pocket pick scored **-0.25 against an all-meta draft** — the model
 * charged a team for the surprise. It is now +0.5, the same as any other game.
 */
export function pocketBonusFor(offMetaCount: number): number {
  if (offMetaCount <= 0) return 0;
  return offMetaCount <= POCKET_MAX ? offMetaCount * POCKET_POINT : POCKET_MANY_PENALTY;
}
/** Logistic scale converting a point margin into a per-game probability. */
export const PROB_SCALE = 2.0;

/** Points per full (100%) series-win-rate gap, and the cap on that award. */
export const FORM_SCALE = 2.0;
export const FORM_CAP = 1.0;
/** A record below this many series is not trusted for the form edge. */
export const MIN_FORM_SERIES = 3;

/**
 * What a team's situation is worth.
 *
 * This is the one term the data cannot supply — nothing in a results export
 * knows a team is already eliminated or would rather draw a softer bracket, so
 * the user states it and the model takes them at their word. The values are
 * scaled against the form edge (max ±1.00) rather than the meta bonus, because
 * a stated circumstance should be able to tip a close matchup without ever
 * outweighing what the teams actually drafted.
 */
export const MOTIVATION_POINTS: Record<Motivation, number> = {
  normal: 0,
  'must win': 0.5,
  'nothing to play for': -0.5,
  'tank incentive': -1.0,
};

/**
 * Win rate credited for a prepared surprise pick.
 *
 * A pro pulling out an **off-meta** champion they have no record on is not a
 * coin flip — it is a prepared pick. Nobody first-times something on stage; it
 * has been scrimmed, it is aimed at this opponent, and the other side has no
 * film on it. Knight's Swain at MSI is the case this exists for.
 *
 * Both halves of the test matter. Requiring the champion to be off-meta is what
 * separates a genuine surprise from the ordinary case of a player who simply
 * has not been handed a common meta pick yet — the latter says nothing about
 * preparation, and crediting it a full 1.00 made an unfamiliar meta pick score
 * better than a real 9-of-10 record.
 *
 * Note the test is *off-meta*, not "nobody has ever played it": Swain had seven
 * recorded games in the 2026 season before that MSI pick, so a literal
 * never-played rule would not have fired for the very case it exists for. What
 * was true is that Swain was nowhere near the pick-rate bar, and Knight himself
 * had no record on it.
 *
 * The one place to watch: with history cut at kickoff, an early-season backtest
 * has little recorded play, so many lanes qualify and the base inflates for
 * both sides at once.
 */
export const UNPLAYED_WIN_RATE = 1.0;

/**
 * Win rate credited when there is simply nothing to go on.
 *
 * A meta champion the starter has no record on, on a team with no record on it
 * either, is not a surprise pick and not a known quantity — it is an unknown,
 * and an unknown is a coin flip.
 */
export const NEUTRAL_WIN_RATE = 0.5;

/**
 * Points for each game of series lead, and how far the award can run.
 *
 * The tally used to ignore the series score completely: it fed the best-of
 * arithmetic and the notices, but the per-game margin was the same at 0-0 as at
 * 0-2 down. That is the one piece of "must win / doesn't need to win" a results
 * export genuinely knows, and it is worth something — over the 374 games of
 * July and August 2026, the side facing elimination won just 42.0% (60/143).
 *
 * The sign is the opposite of the intuition. A team facing elimination is not
 * lifted by the pressure; it is behind because it has been losing, and that
 * keeps being true for the next game. So the lead is credited, not the deficit.
 *
 * Sized at roughly half the raw signal: a 58/42 split is about 0.65 points
 * through the logistic, but the stronger team's strength is already priced into
 * the win-rate base and the form edge, so crediting the whole gap would count
 * it twice.
 */
export const SERIES_LEAD_POINT = 0.3;
export const SERIES_LEAD_CAP = 0.6;

/**
 * Champions credited a small extra for carry potential, and what each is worth.
 *
 * These are hand-picked rather than derived: the claim is that a Lee Sin or an
 * Akali in the right hands swings a game more than its win rate suggests,
 * because the ceiling is higher than the average. Nothing in a results export
 * measures that, so it is stated rather than computed. Edit the set to change
 * which champions qualify.
 *
 * Priced deliberately low, and here is the honest reason: measured over the 2026
 * season, none of the three is a surprise and one of them loses.
 *
 *   Lee Sin    230 picks, 12.6% of games, 53.9% win rate  (jungle)
 *   Akali      185 picks, 10.2% of games, 55.1% win rate  (mid)
 *   Nocturne   262 picks, 14.4% of games, 45.4% win rate  (jungle)
 *
 * All three clear the meta pick-rate bar comfortably, so they already collect a
 * full meta point — the extra partly double-counts a staple rather than
 * rewarding a surprise. And Nocturne is a **losing** pick over a 262-game
 * sample, so crediting it a bonus points the wrong way outright.
 *
 * Backtested four times now and it has never helped: one game lost over 374,
 * zero over 1,272, zero over 1,592, one gained over 1,317 — all inside noise,
 * with the Brier score unmoved every time. It is kept small enough to colour a
 * close call without overriding anything the data supports.
 */
export const DARK_HORSE = new Set<string>(['LeeSin', 'Akali', 'Nocturne']);
export const DARK_HORSE_POINT = 0.1;

/** How many of a side's picks are on the dark-horse list. */
export function darkHorseCount(champions: readonly (Champion | null)[]): number {
  return champions.filter((champion) => champion !== null && DARK_HORSE.has(champion.id)).length;
}

/**
 * The rank edge: the only signal that compares teams across regions.
 *
 * Everything else in the tally is computed from the games themselves, and that
 * is precisely why it cannot tell a good minor team from a good major one. A
 * win rate is only as meaningful as the opposition behind it, and nothing in an
 * Oracle's Elixir export says how hard a schedule was. EWC's LØS is the case
 * this exists for: going into their match with JD Gaming they had a 71% win
 * rate over 17 games and 83% recent form, against JDG's 52% over 110 and 31%.
 * Every internal read said LØS were the better team, and the model gave them
 * 80%. They lost, as they lost every game against a major-region side.
 *
 * So the term is priced to be able to overrule a draft read, not merely to
 * break a tie: 0.1 a place, capped at 1.5 — about one and a half meta picks.
 * Scaled rather than a flat award over a threshold, because a two-place gap and
 * a thirty-place gap are not the same claim.
 *
 * Two caveats worth keeping in view. GlobalRank is hand-maintained, so this is
 * an outside opinion rather than something the games prove; and the table is a
 * static snapshot, so unlike every other term it is *not* cut at kickoff — a
 * July game is scored with ranks formed knowing how the season went. That is
 * why the cap exists, and why any backtest number leaning on this term should
 * be read as optimistic.
 */
export const RANK_POINT = 0.1;
export const RANK_CAP = 1.5;

/**
 * Rank assumed for a team the ratings table does not list.
 *
 * Being absent from a hand-maintained table of the teams that matter is itself
 * evidence, and treating it as "no information" is what let LØS through: with
 * no entry they took no rank edge at all, so the term meant to catch exactly
 * that team never fired. Derived from the table rather than hardcoded, so an
 * imported file of any size behaves the same. The precise value barely matters
 * — the cap saturates long before it — which is what makes the assumption safe.
 */
export function unratedRank(model: PredictorModel): number {
  let worst = 0;
  for (const rating of model.ratings.values()) {
    if (rating.globalRank !== null && rating.globalRank > worst) worst = rating.globalRank;
  }
  return worst + 5;
}

/**
 * Fraud rating bands, for the notice.
 *
 * The rating no longer moves the score. Backtested over 374 games it was the
 * single most harmful term in the model: subtracting it cost about 1.4 points
 * of accuracy, and on its own it predicted the winner just 44.2% of the time —
 * the *more* fraudulent side won more often. It reads as a useful scouting note
 * and behaves as noise, so it is reported and not scored.
 */
export const FRAUD_BANDS: { min: number; label: string }[] = [
  { min: 0.75, label: 'high' },
  { min: 0.5, label: 'medium' },
  { min: 0.01, label: 'low' },
];

export function fraudBand(rating: number): string | null {
  return FRAUD_BANDS.find((band) => rating >= band.min)?.label ?? null;
}

/**
 * Side credited with first pick in the draft notice.
 *
 * Standard tournament draft gives blue the opening pick and red the last one,
 * so this is set against the rulebook on purpose — it matches the predictor
 * this was ported from, which is what the app's users expect to read. One
 * constant so the notice can be flipped without hunting through prose.
 */
export const FIRST_PICK_SIDE: Side = 'red';

/* ------------------------------------------------------------------ */
/* Probability                                                         */
/* ------------------------------------------------------------------ */

/**
 * Probability of winning `needSelf` more games before the opponent wins
 * `needOpp`, given a fixed per-game probability. This is the negative binomial
 * tail: sum over the number of games the opponent takes along the way.
 */
export function seriesWinProbability(p: number, needSelf: number, needOpp: number): number {
  if (needSelf <= 0) return 1;
  if (needOpp <= 0) return 0;
  let total = 0;
  for (let k = 0; k < needOpp; k += 1) {
    total += binomial(needSelf - 1 + k, k) * p ** needSelf * (1 - p) ** k;
  }
  return total;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

function logistic(margin: number): number {
  return 1 / (1 + Math.exp(-margin / PROB_SCALE));
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function anywhereKey(subject: string, role: Role, championId: string): string {
  return `${subject.toLowerCase()}|${role}|${championId}`;
}

/** Key for "which split is this player / team currently in". */
export function splitSubject(kind: 'player' | 'team', name: string): string {
  return `${kind}|${name.toLowerCase()}`;
}

/** Human name for a split key: `2026|Summer` reads as `Summer`, `2026|` as `2026`. */
export function splitLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  const [season = '', split = ''] = key.split('|');
  return split || season || null;
}

/**
 * Games a player needs in the current split before it outranks their career.
 *
 * One game is 0% or 100% and nothing in between, which would let a single
 * result overwrite a career's worth of evidence. Two is still a thin read, but
 * it is a read; below that the longer record is the better estimate. Both
 * numbers reach the report either way, so nothing is hidden by this choice.
 */
export const MIN_SPLIT_SAMPLE = 2;

/** Where a win rate came from, narrowest first. */
export type WinRateScope = 'blend' | 'split' | 'career' | 'team' | 'none' | 'unknown';

export interface WinRateRead {
  winRate: number;
  /** How the number was arrived at, e.g. `7W/11 (64%)`. */
  note: string;
  scope: WinRateScope;
  /** This player on this champion in the current split, when they have played it. */
  splitRecord: WinLoss | null;
  /** The same across everything loaded. */
  careerRecord: WinLoss | null;
  /** Who the record belongs to — the starter in that role, when known. */
  player: string | null;
  /** The split "this split" refers to for this player, e.g. `Summer`. */
  splitLabel: string | null;
}

function describe(record: WinLoss): string {
  const pct = Math.round((record.wins / record.games) * 100);
  return `${record.wins}W/${record.games} (${pct}%)`;
}

/**
 * Historical win rate for the player who will pilot this champion.
 *
 * Keyed on the player rather than the team, because a roster change otherwise
 * drags the departed player's results into their replacement's number. The
 * starter is whoever last played that role for the team, so with history cut at
 * kickoff it is the starter as of that game.
 *
 * When the player has both a current-split record and a career one, the two are
 * **averaged**. Career already contains the split games, so the mean is a 50/50
 * blend that leans on recent form without letting it erase everything that came
 * before: a player who is 1-3 on a champion this split but 20-5 on it across his
 * career is neither a 25% pick nor an 80% one.
 *
 * Failing that: career alone, then the prepared-surprise credit for an off-meta
 * champion they have no record on, then the team's record, then a neutral coin
 * flip. Both records are returned whichever was used, so the report can show a
 * player who was 50% on Yone last split and has not touched it this one.
 */
export function championWinRate(
  model: PredictorModel,
  team: string,
  role: Role,
  champion: Champion,
): WinRateRead {
  const player = model.rosters.get(team.toLowerCase())?.[role] ?? null;

  const splitRecord = player
    ? (model.playerSplitRecord.get(anywhereKey(player, role, champion.id)) ?? null)
    : null;
  const careerRecord = player
    ? (model.playerCareerRecord.get(anywhereKey(player, role, champion.id)) ?? null)
    : null;
  const label = splitLabel(
    player ? model.currentSplitOf.get(splitSubject('player', player)) : undefined,
  );

  const base = { splitRecord, careerRecord, player, splitLabel: label };
  const rate = (record: WinLoss): number => record.wins / record.games;

  // A one-game split is 0% or 100% and nothing between; averaging it in would
  // still swing the number by half that, so it stays out of the mean.
  const usableSplit = splitRecord !== null && splitRecord.games >= MIN_SPLIT_SAMPLE;

  if (usableSplit && careerRecord && careerRecord.games > 0) {
    const splitRate = rate(splitRecord);
    const careerRate = rate(careerRecord);
    return {
      ...base,
      winRate: (splitRate + careerRate) / 2,
      note:
        `${describe(splitRecord)} in ${label ?? 'the current split'} and ` +
        `${describe(careerRecord)} career, averaged`,
      scope: 'blend',
    };
  }
  if (usableSplit) {
    return {
      ...base,
      winRate: rate(splitRecord),
      note: `${describe(splitRecord)} in ${label ?? 'the current split'}`,
      scope: 'split',
    };
  }
  if (careerRecord && careerRecord.games > 0) {
    const thin = splitRecord ? ` · only ${splitRecord.games} this split` : ' · first time this split';
    return {
      ...base,
      winRate: rate(careerRecord),
      note: `${describe(careerRecord)} career${thin}`,
      scope: 'career',
    };
  }

  // The prepared surprise: an off-meta champion the starter has no history on.
  // A *meta* champion they happen not to have played is not the same thing and
  // falls through to the team record below.
  if (player && !isMeta(model, champion, role)) {
    return {
      ...base,
      winRate: UNPLAYED_WIN_RATE,
      note: 'off-meta with no record — prepared surprise pick',
      scope: 'none',
    };
  }

  // Nothing on the player: the team's own record is the next best thing, and
  // the only thing at all when the roster is unknown.
  const teamKey = anywhereKey(team, role, champion.id);
  const teamSplit = model.teamSplitRecord.get(teamKey) ?? null;
  const teamRecord =
    teamSplit && teamSplit.games >= MIN_SPLIT_SAMPLE
      ? teamSplit
      : (model.teamCareerRecord.get(teamKey) ?? null);
  if (teamRecord && teamRecord.games > 0) {
    return {
      ...base,
      winRate: rate(teamRecord),
      note: `${describe(teamRecord)} · team record${player ? '' : ', roster unknown'}`,
      scope: 'team',
    };
  }

  return {
    ...base,
    winRate: NEUTRAL_WIN_RATE,
    note: 'no record for this player or team — treated as even',
    scope: 'unknown',
  };
}

export function isMeta(model: PredictorModel, champion: Champion, role: Role): boolean {
  return model.metaByRole.get(role)?.has(champion.id) ?? false;
}

/** Standings row for a team, preferring the competition table. */
export function standingFor(
  model: PredictorModel,
  competition: string | null,
  team: string,
): StandingRow | null {
  const key = team.toLowerCase();
  if (competition) {
    const row = model.standingsByCompetition.get(competition as never)?.get(key);
    if (row) return row;
  }
  return model.standingsOverall.get(key) ?? null;
}

/** Series win rate for the form edge, only when the sample is big enough. */
function usableForm(model: PredictorModel, competition: string | null, team: string): number | null {
  const key = team.toLowerCase();
  const scoped = competition
    ? model.standingsByCompetition.get(competition as never)?.get(key)
    : undefined;
  if (scoped && scoped.seriesWon + scoped.seriesLost >= MIN_FORM_SERIES) return scoped.seriesPct;

  const overall = model.standingsOverall.get(key);
  if (overall && overall.seriesWon + overall.seriesLost >= MIN_FORM_SERIES) return overall.seriesPct;
  return null;
}

/* ------------------------------------------------------------------ */
/* Per-side tally                                                      */
/* ------------------------------------------------------------------ */

/**
 * How usual this pick is for the player starting the lane.
 *
 * Reported only. A deduction for drafting outside a player's usual classes was
 * measured across the full 2026 season and never helped — see
 * `deriveClassProfiles` for the numbers and the reason.
 */
function classAffinityFor(
  model: PredictorModel,
  player: string | null,
  champion: Champion,
): ClassAffinity | null {
  const klass = primaryClass(champion);
  if (!player || !klass) return null;
  const profile = model.classProfiles.get(player.toLowerCase());
  if (!profile) return null;
  return {
    championClass: klass,
    share: profile.shares.get(klass) ?? 0,
    offType: !profile.favourites.includes(klass),
    favourites: profile.favourites,
    profileGames: profile.games,
  };
}

function scoreSide(model: PredictorModel, input: SideInput, opposing: SideInput): SideScore {
  const own = input.champions.filter((c): c is Champion => c !== null);
  const against = opposing.champions.filter((c): c is Champion => c !== null);
  const roster = model.rosters.get(input.team.toLowerCase()) ?? {};

  const picks: PickLine[] = [];
  let winRateBase = 0;
  let metaCount = 0;

  ROLES.forEach((role, index) => {
    const champion = input.champions[index];
    if (!champion) return;
    const read = championWinRate(model, input.team, role, champion);
    const meta = isMeta(model, champion, role);
    winRateBase += read.winRate;
    if (meta) metaCount += 1;

    const edges = relevantEdges(champion, own, against);
    picks.push({
      role,
      champion,
      player: read.player ?? roster[role] ?? null,
      winRate: read.winRate,
      note: read.note,
      scope: read.scope,
      splitRecord: read.splitRecord,
      careerRecord: read.careerRecord,
      splitLabel: read.splitLabel,
      pickRate: model.pickRateByRole.get(role)?.get(champion.id) ?? null,
      presenceRate: model.presenceRateByRole.get(role)?.get(champion.id) ?? null,
      meta,
      scaling: model.scalingByChampion.get(champion.id) ?? null,
      classAffinity: classAffinityFor(model, roster[role] ?? null, champion),
      ...edges,
    });
  });

  // Five neutral lanes would otherwise be worth the same as five 100% lanes.
  winRateBase = Math.min(winRateBase, ROLES.length);

  const offMetaCount = picks.length - metaCount;
  const pocketBonus = pocketBonusFor(offMetaCount);

  const fraudPenalty = lookupRating(model.ratings, input.team)?.fraud ?? 0;

  return {
    team: input.team,
    picks,
    winRateBase,
    metaCount,
    metaBonus: metaCount * META_POINT,
    offMetaCount,
    pocketBonus,
    formEdge: 0,
    motivationBonus: MOTIVATION_POINTS[input.motivation] ?? 0,
    seriesEdge: 0,
    rankBonus: 0,
    darkHorseBonus: darkHorseCount(input.champions) * DARK_HORSE_POINT,
    fraudPenalty,
    total: 0,
  };
}

function finalizeTotal(score: SideScore): number {
  return (
    score.winRateBase +
    score.metaBonus +
    score.pocketBonus +
    score.formEdge +
    score.motivationBonus +
    score.seriesEdge +
    score.rankBonus +
    score.darkHorseBonus
  );
}

/* ------------------------------------------------------------------ */
/* Behaviour narration                                                 */
/* ------------------------------------------------------------------ */

const pct = (value: number): string => `${Math.round(value * 100)}%`;

export function behaviorTendencies(behavior: TeamBehavior | undefined): string[] {
  if (!behavior) return ['No games in the loaded seasons for a behavioural read.'];
  const out: string[] = [];

  const { recentForm } = behavior;
  if (recentForm !== null) {
    if (recentForm >= 0.6) out.push(`In strong recent form (${pct(recentForm)} weighted).`);
    else if (recentForm <= 0.4) out.push(`Struggling lately (${pct(recentForm)} weighted form).`);
    else out.push(`Middling recent form (${pct(recentForm)}).`);
  }

  const { blueWinRate: blue, redWinRate: red } = behavior;
  if (blue !== null && red !== null && Math.abs(blue - red) >= 0.12) {
    const stronger = blue > red ? 'blue' : 'red';
    out.push(`Clearly stronger on ${stronger} side (${pct(blue)} blue vs ${pct(red)} red).`);
  }

  if (behavior.throwRate !== null && behavior.throwSample >= 3) {
    if (behavior.throwRate >= 0.25) {
      out.push(
        `Prone to throwing leads (lost ${pct(behavior.throwRate)} of ${behavior.throwSample} games while well ahead).`,
      );
    } else if (behavior.throwRate <= 0.1) {
      out.push(`Rarely throws a lead (${pct(behavior.throwRate)} of ${behavior.throwSample}).`);
    }
  }

  if (behavior.comebackRate !== null && behavior.comebackSample >= 3) {
    if (behavior.comebackRate >= 0.4) {
      out.push(
        `Dangerous from behind (won ${pct(behavior.comebackRate)} of ${behavior.comebackSample} games down big).`,
      );
    } else if (behavior.comebackRate <= 0.15) {
      out.push(
        `Weak from behind (won only ${pct(behavior.comebackRate)} of ${behavior.comebackSample} deficits).`,
      );
    }
  }

  if (behavior.bouncebackRate !== null) {
    if (behavior.bouncebackRate >= 0.6) {
      out.push(`Bounces back well after a loss (${pct(behavior.bouncebackRate)} next game).`);
    } else if (behavior.bouncebackRate <= 0.4) {
      out.push(`Tends to tilt after a loss (${pct(behavior.bouncebackRate)} next game).`);
    }
  }

  if (behavior.chokeRate !== null && behavior.chokeSample >= 2) {
    out.push(
      `Game 5 after dropping game 4 from 2-1 up: won ${pct(behavior.chokeRate)} of ${behavior.chokeSample}.`,
    );
  }

  if (behavior.deciderRate !== null) {
    if (behavior.deciderRate >= 0.6) out.push(`Clutch in deciders (${pct(behavior.deciderRate)}).`);
    else if (behavior.deciderRate <= 0.4) out.push(`Shaky in deciders (${pct(behavior.deciderRate)}).`);
  }

  if (out.length === 0) out.push('Not enough games yet for a clear behavioural read.');
  return out;
}

/* ------------------------------------------------------------------ */
/* Scouting notices                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Early-game gold tempo                                               */
/* ------------------------------------------------------------------ */

/** Average gold swing below which a team is just even, not early-game strong. */
export const TEMPO_NOTABLE_GOLD = 200;
/** Share of games ahead that separates a habit from an even split. */
export const TEMPO_NOTABLE_RATE = 0.56;
/** Gap between two teams' averages worth calling out as an edge. */
export const TEMPO_EDGE_GOLD = 300;

const goldText = (value: number): string => {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-US')}g`;
};

/** The mark that best describes the early game, preferring 10 minutes. */
export function earlyPoint(tempo: GoldTempo | undefined): GoldTempoPoint | null {
  if (!tempo || tempo.length === 0) return null;
  return tempo.find((point) => point.minute === 10) ?? tempo[0] ?? null;
}

function describeTempo(team: string, point: GoldTempoPoint): string {
  const head = `${team}: ${goldText(point.averageDiff)} on average at ${point.minute} min, ahead in ${pct(
    point.aheadRate,
  )} of ${point.sample} games`;

  const strongLead = point.averageDiff >= TEMPO_NOTABLE_GOLD && point.aheadRate >= TEMPO_NOTABLE_RATE;
  const strongDeficit =
    point.averageDiff <= -TEMPO_NOTABLE_GOLD && point.aheadRate <= 1 - TEMPO_NOTABLE_RATE;

  if (strongLead) return `${head} — tend to lead early.`;
  if (strongDeficit) return `${head} — tend to fall behind early.`;
  // A big average with a middling ahead-rate is a few blowouts, not a pattern.
  if (Math.abs(point.averageDiff) >= TEMPO_NOTABLE_GOLD) {
    return `${head} — swingy starts rather than a consistent one.`;
  }
  return `${head} — even out of the gate.`;
}

/** Share of the early window spent behind that reads as a pattern. */
export const EARLY_LOPSIDED_RATE = 0.55;
/** Win rate from a deficit at or below which a bad start is usually terminal. */
export const EARLY_DEAD_DEFICIT_RATE = 0.15;

/** `10 and 15 min`, or `10 min` — however many marks the window actually has. */
function minuteList(minutes: readonly number[]): string {
  if (minutes.length === 0) return 'the early game';
  if (minutes.length === 1) return `${minutes[0]} min`;
  return `${minutes.slice(0, -1).join(', ')} and ${minutes[minutes.length - 1]} min`;
}

/**
 * The split of the early window into leading, level and behind.
 *
 * Three shares rather than one ahead-rate, because a team that is level half
 * the time reads very differently from one that is behind half the time, and a
 * strict ahead/behind split collapses that distinction.
 */
function describeEarlyShare(team: string, profile: EarlyGoldProfile): string {
  const head =
    `${team} at ${minuteList(profile.minutes)}: leading ${pct(profile.leadRate)}, ` +
    `level ${pct(profile.levelRate)}, behind ${pct(profile.behindRate)} of ${profile.sample} marks`;

  if (profile.leadRate >= EARLY_LOPSIDED_RATE) return `${head} — usually in front early.`;
  if (profile.behindRate >= EARLY_LOPSIDED_RATE) return `${head} — usually playing from behind.`;
  return `${head} — no settled early pattern.`;
}

/**
 * What a bad start has actually turned into for this team.
 *
 * Two numbers, because they answer different questions: how often they win from
 * a real deficit at all, and how often the gold lead itself came back before
 * they did. Wins without a recovered lead are games settled after the last
 * checkpoint at 25 minutes.
 */
function describeComeback(team: string, profile: EarlyGoldProfile): string | null {
  if (profile.deficitWinRate === null || profile.comebackRate === null) return null;
  return (
    `${team} ${goldText(-profile.deficitGold)} or worse by ` +
    `${profile.minutes[profile.minutes.length - 1]} min in ` +
    `${profile.deficitSample} games — won ${pct(profile.deficitWinRate)}, ` +
    `and led again before winning in ${pct(profile.comebackRate)}.`
  );
}

/**
 * Per-team early-game gold reads, plus the head-to-head edge between them.
 *
 * Reported, never scored: this describes how a team usually opens, not how the
 * draft on screen will open, and folding it into the tally would double-count
 * the strength already priced into the win-rate base.
 */
function goldTempoNotices(model: PredictorModel, input: PredictionInput): Notice[] {
  const notices: Notice[] = [];
  const points: Partial<Record<Side, GoldTempoPoint>> = {};

  // One block per side — the average, then how the window splits, then what a
  // bad start became — so a team's three gold reads sit together rather than
  // interleaving with the opponent's.
  for (const side of ['blue', 'red'] as const) {
    const entry = input[side];
    const key = entry.team.toLowerCase();

    const point = earlyPoint(model.goldTempo.get(key));
    if (point) {
      points[side] = point;
      notices.push({
        kind: 'gold',
        side,
        text: describeTempo(entry.team, point),
        warning:
          point.averageDiff <= -TEMPO_NOTABLE_GOLD && point.aheadRate <= 1 - TEMPO_NOTABLE_RATE,
      });
    }

    const profile = model.earlyGold.get(key);
    if (!profile) continue;

    notices.push({
      kind: 'gold',
      side,
      text: describeEarlyShare(entry.team, profile),
      warning: profile.behindRate >= EARLY_LOPSIDED_RATE,
    });

    const comeback = describeComeback(entry.team, profile);
    if (comeback) {
      notices.push({
        kind: 'gold',
        side,
        text: comeback,
        warning:
          profile.deficitWinRate !== null && profile.deficitWinRate <= EARLY_DEAD_DEFICIT_RATE,
      });
    }
  }

  const bluePoint = points.blue;
  const redPoint = points.red;
  if (bluePoint && redPoint && bluePoint.minute === redPoint.minute) {
    const gap = bluePoint.averageDiff - redPoint.averageDiff;
    if (Math.abs(gap) >= TEMPO_EDGE_GOLD) {
      const faster = gap > 0 ? input.blue.team : input.red.team;
      notices.push({
        kind: 'gold',
        side: gap > 0 ? 'blue' : 'red',
        text:
          `Early game at ${bluePoint.minute} min: ${input.blue.team} ${goldText(bluePoint.averageDiff)} vs ` +
          `${input.red.team} ${goldText(redPoint.averageDiff)} — ${faster} open ${goldText(
            Math.abs(gap),
          ).replace('+', '')} stronger.`,
      });
    }
  }

  return notices;
}

function buildNotices(
  model: PredictorModel,
  input: PredictionInput,
  blue: SideScore,
  red: SideScore,
): Notice[] {
  const notices: Notice[] = [];
  const blueBehavior = model.behavior.get(input.blue.team.toLowerCase());
  const redBehavior = model.behavior.get(input.red.team.toLowerCase());

  // Which side is credited with first pick is a deliberate product choice, not
  // a reading of the rulebook: standard tournament draft gives blue the opening
  // pick and red the last one. This app credits red, matching the predictor it
  // was ported from. Flip `FIRST_PICK_SIDE` to change it everywhere.
  const firstPick = FIRST_PICK_SIDE;
  const lastPick: Side = firstPick === 'red' ? 'blue' : 'red';
  const firstPickTeam = input[firstPick].team;
  const lastPickTeam = input[lastPick].team;
  const firstPickBehavior = firstPick === 'blue' ? blueBehavior : redBehavior;
  const sideWinRate =
    firstPick === 'blue' ? firstPickBehavior?.blueWinRate : firstPickBehavior?.redWinRate;

  notices.push({
    kind: 'first-pick',
    side: firstPick,
    text:
      `First pick belongs to ${firstPickTeam} on ${firstPick} side; ` +
      `${lastPickTeam} have last pick on ${lastPick}.` +
      (sideWinRate !== null && sideWinRate !== undefined
        ? ` ${firstPickTeam} win ${pct(sideWinRate)} on ${firstPick}.`
        : ''),
  });

  notices.push(...goldTempoNotices(model, input));

  for (const side of ['blue', 'red'] as const) {
    const entry = input[side];
    const row = standingFor(model, entry.competition, entry.team);
    if (!row) continue;
    notices.push({
      kind: 'standings',
      side,
      text:
        `${entry.team}: standings #${row.rank} — ${row.seriesWon}-${row.seriesLost} series ` +
        `(${pct(row.seriesPct)})${row.streak ? `, streak ${row.streak}` : ''}.`,
    });
  }

  for (const [side, score] of [
    ['blue', blue],
    ['red', red],
  ] as const) {
    if (score.picks.length === 0) continue;
    if (score.offMetaCount === 0) {
      notices.push({ kind: 'draft', side, text: `${score.team}: full-meta draft, no surprise picks.` });
    } else if (score.offMetaCount <= 2) {
      notices.push({
        kind: 'draft',
        side,
        text:
          `${score.team}: ${score.offMetaCount} pocket pick(s) — surprise factor ` +
          `(${signed(score.pocketBonus)}).`,
      });
    } else {
      notices.push({
        kind: 'draft',
        side,
        warning: true,
        text:
          `${score.team}: ${score.offMetaCount} off-meta picks — chaotic, high-risk draft ` +
          `(${signed(score.pocketBonus)}).`,
      });
    }
  }

  for (const [side, score] of [
    ['blue', blue],
    ['red', red],
  ] as const) {
    const band = fraudBand(score.fraudPenalty);
    if (!band) continue;
    notices.push({
      kind: 'reliability',
      side,
      warning: band === 'high',
      text:
        `${score.team}: ${band} fraud rating (${score.fraudPenalty.toFixed(2)}) — ` +
        `reported only, it does not move the score.`,
    });
  }

  for (const [side, entry, score] of [
    ['blue', input.blue, blue],
    ['red', input.red, red],
  ] as const) {
    if (score.darkHorseBonus <= 0) continue;
    const names = entry.champions
      .filter((champion): champion is Champion => champion !== null && DARK_HORSE.has(champion.id))
      .map((champion) => champion.name);
    notices.push({
      kind: 'draft',
      side,
      text: `${score.team}: ${names.join(' and ')} on the board — carry potential (${signed(score.darkHorseBonus)}).`,
    });
  }

  const rankLead = blue.rankBonus > 0 ? 'blue' : red.rankBonus > 0 ? 'red' : null;
  const rankAward = Math.max(blue.rankBonus, red.rankBonus);
  if (rankLead === null) {
    notices.push({ kind: 'rank', side: null, text: 'Ranks are level — no rank edge awarded.' });
  } else {
    const unlisted = (['blue', 'red'] as const).filter(
      (side) => lookupRating(model.ratings, input[side].team)?.globalRank == null,
    );
    notices.push({
      kind: 'rank',
      side: rankLead,
      warning: unlisted.length > 0,
      text:
        `${input[rankLead].team} rank ahead → ${signed(rankAward)}.` +
        (unlisted.length > 0
          ? ` ${unlisted.map((side) => input[side].team).join(' and ')} not in the ratings table, ` +
            `so treated as a minor team — this is the term that stops a strong record ` +
            `against weak opposition reading as a strong team.`
          : ''),
    });
  }

  const target = SERIES_TARGET[input.seriesLength];
  if (target > 1) {
    const { scoreBlue, scoreRed } = input;
    const lead = scoreBlue - scoreRed;
    if (lead !== 0) {
      const ahead = lead > 0 ? input.blue.team : input.red.team;
      const behind = lead > 0 ? input.red.team : input.blue.team;
      const award = Math.min(Math.abs(lead) * SERIES_LEAD_POINT, SERIES_LEAD_CAP);
      notices.push({
        kind: 'series',
        side: lead > 0 ? 'blue' : 'red',
        text:
          `${ahead} lead the series ${Math.max(scoreBlue, scoreRed)}-${Math.min(scoreBlue, scoreRed)} ` +
          `(${signed(award)}). Sides that were behind won 42% of the next game across ` +
          `July–August 2026, so ${behind} are not credited for the pressure.`,
      });
    }
    if (scoreBlue === target - 1 && scoreRed === target - 1) {
      notices.push({
        kind: 'series',
        side: null,
        warning: true,
        text: `Series decider (${scoreBlue}-${scoreRed}) — win or go home for both.`,
      });
    } else if (scoreBlue === target - 1) {
      notices.push({
        kind: 'series',
        side: 'blue',
        text: `${input.blue.team} on match point (${scoreBlue}-${scoreRed}).`,
      });
    } else if (scoreRed === target - 1) {
      notices.push({
        kind: 'series',
        side: 'red',
        text: `${input.red.team} on match point (${scoreRed}-${scoreBlue}).`,
      });
    }
  }

  for (const side of ['blue', 'red'] as const) {
    const entry = input[side];
    if (entry.motivation === 'normal') continue;
    const points = signed(MOTIVATION_POINTS[entry.motivation]);
    if (entry.motivation === 'tank incentive') {
      notices.push({
        kind: 'motivation',
        side,
        warning: true,
        text: `${entry.team}: tank incentive — winning may draw a harder next opponent (${points}).`,
      });
    } else if (entry.motivation === 'must win') {
      notices.push({
        kind: 'motivation',
        side,
        text: `${entry.team}: must-win — expect full effort (${points}).`,
      });
    } else {
      notices.push({
        kind: 'motivation',
        side,
        warning: true,
        text: `${entry.team}: little to play for — coasting risk (${points}).`,
      });
    }
  }

  const blueForm = blueBehavior?.recentForm;
  const redForm = redBehavior?.recentForm;
  if (
    blueForm !== null &&
    blueForm !== undefined &&
    redForm !== null &&
    redForm !== undefined &&
    Math.abs(blueForm - redForm) >= 0.15
  ) {
    const hotter = blueForm > redForm ? input.blue.team : input.red.team;
    notices.push({
      kind: 'form',
      side: blueForm > redForm ? 'blue' : 'red',
      text: `Form edge: ${hotter} enter in better recent form.`,
    });
  }

  return notices;
}

/**
 * Signed point value for prose.
 *
 * Several terms carry quarter- and half-points — a 1.5 pocket bonus, a 0.25
 * fraud rating — so this keeps whatever precision the number actually has
 * rather than rounding it. Rounding to whole points reported a +1.5 bonus as
 * "+2" and a 0.25 penalty as "-0".
 */
function signed(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded)}`;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function predict(model: PredictorModel, input: PredictionInput): Prediction {
  const blue = scoreSide(model, input.blue, input.red);
  const red = scoreSide(model, input.red, input.blue);

  const blueForm = usableForm(model, input.blue.competition, input.blue.team);
  const redForm = usableForm(model, input.red.competition, input.red.team);
  let formNote = 'standings unavailable or too few series — no form edge';
  if (blueForm !== null && redForm !== null) {
    const gap = blueForm - redForm;
    if (gap > 0) blue.formEdge = Math.min(FORM_CAP, gap * FORM_SCALE);
    else if (gap < 0) red.formEdge = Math.min(FORM_CAP, -gap * FORM_SCALE);
    formNote =
      `series form ${pct(blueForm)} vs ${pct(redForm)} → ` +
      `+${Math.max(blue.formEdge, red.formEdge).toFixed(2)} to the better record`;
  }

  // Both need the two sides side by side, so they land after the per-side tally.
  const lead = input.scoreBlue - input.scoreRed;
  if (lead !== 0) {
    const award = Math.min(Math.abs(lead) * SERIES_LEAD_POINT, SERIES_LEAD_CAP);
    if (lead > 0) blue.seriesEdge = award;
    else red.seriesEdge = award;
  }

  const fallback = unratedRank(model);
  const blueListed = lookupRating(model.ratings, input.blue.team)?.globalRank ?? null;
  const redListed = lookupRating(model.ratings, input.red.team)?.globalRank ?? null;
  const blueRank = blueListed ?? fallback;
  const redRank = redListed ?? fallback;

  const gap = redRank - blueRank;
  const award = Math.min(Math.abs(gap) * RANK_POINT, RANK_CAP);
  if (gap > 0) blue.rankBonus = award;
  else if (gap < 0) red.rankBonus = award;

  const describeRank = (team: string, listed: number | null): string =>
    listed === null ? `${team} unrated (treated as ${fallback})` : `${team} #${listed}`;
  let rankNote = `${describeRank(input.blue.team, blueListed)} vs ${describeRank(input.red.team, redListed)}`;
  rankNote +=
    gap === 0
      ? ' — level, no rank edge'
      : ` → ${signed(award)} to ${gap > 0 ? input.blue.team : input.red.team}`;

  blue.total = finalizeTotal(blue);
  red.total = finalizeTotal(red);

  const margin = blue.total - red.total;
  const gameProbBlue = logistic(margin);
  const gameProbRed = 1 - gameProbBlue;

  const seriesTarget = SERIES_TARGET[input.seriesLength];
  const needBlue = Math.max(0, seriesTarget - input.scoreBlue);
  const needRed = Math.max(0, seriesTarget - input.scoreRed);

  const seriesProbBlue =
    seriesTarget === 1 ? gameProbBlue : seriesWinProbability(gameProbBlue, needBlue, needRed);
  const seriesProbRed = 1 - seriesProbBlue;

  const sweepProbBlue = needBlue > 0 ? gameProbBlue ** needBlue : 1;
  const sweepProbRed = needRed > 0 ? gameProbRed ** needRed : 1;

  const EPSILON = 1e-9;
  const favourite: Side | null = margin > EPSILON ? 'blue' : margin < -EPSILON ? 'red' : null;

  return {
    blue,
    red,
    margin,
    favourite,
    gameProbBlue,
    gameProbRed,
    seriesProbBlue,
    seriesProbRed,
    sweepProbBlue,
    sweepProbRed,
    needBlue,
    needRed,
    seriesTarget,
    formNote,
    rankNote,
    tendencyBlue: behaviorTendencies(model.behavior.get(input.blue.team.toLowerCase())),
    tendencyRed: behaviorTendencies(model.behavior.get(input.red.team.toLowerCase())),
    notices: buildNotices(model, input, blue, red),
  };
}
