/**
 * Predictor domain types.
 *
 * The engine is deliberately pure: it takes a `PredictorModel` (everything
 * derived from the imported games) plus a `PredictionInput` (what the user
 * composed on screen) and returns a `Prediction` made of structured values —
 * never formatted text. Presentation lives in the page.
 */

import type {
  Champion,
  CompetitionId,
  GoldCheckpoint,
  Role,
  Side,
  StageKind,
} from '../domain/types.ts';

/** Best-of length the series is played to. */
export type SeriesLength = 'BO1' | 'BO3' | 'BO5';

/** Whether a champion gets better or worse the longer the game runs. */
export type ChampionScaling = 'late' | 'balanced' | 'early';

/** A champion's win rate split across short and long games. */
export interface ScalingRead {
  type: ChampionScaling;
  /** Win rate in long games minus win rate in short ones. */
  delta: number;
  shortRate: number;
  longRate: number;
  shortGames: number;
  longGames: number;
}

/** Games a team must still win to take the series. */
export const SERIES_TARGET: Record<SeriesLength, number> = { BO1: 1, BO3: 2, BO5: 3 };

/** Context the model can't read from the data but that changes how a team plays. */
export type Motivation = 'normal' | 'must win' | 'nothing to play for' | 'tank incentive';

export const MOTIVATIONS: Motivation[] = [
  'normal',
  'must win',
  'nothing to play for',
  'tank incentive',
];

export type WinRequirement = 'series' | 'sweep';

/* ------------------------------------------------------------------ */
/* Derived model                                                       */
/* ------------------------------------------------------------------ */

export interface WinLoss {
  wins: number;
  games: number;
}

/** One row of the computed standings table. */
export interface StandingRow {
  team: string;
  rank: number;
  seriesWon: number;
  seriesLost: number;
  seriesPct: number;
  gamesWon: number;
  gamesLost: number;
  gamePct: number;
  /** Current run, e.g. `3W`. Empty when there are no series yet. */
  streak: string;
}

/**
 * Per-team behavioural reads. Every field is `null` when the sample behind it
 * is too small to be worth showing — the engine skips those rather than
 * reporting a rate derived from two games.
 */
export interface TeamBehavior {
  games: number;
  winRate: number | null;
  /** Recency-weighted win rate over the last few games. */
  recentForm: number | null;
  blueWinRate: number | null;
  redWinRate: number | null;
  /** Share of games lost after holding a decisive early lead. */
  throwRate: number | null;
  throwSample: number;
  /** Share of games won after facing a decisive early deficit. */
  comebackRate: number | null;
  comebackSample: number;
  /** Win rate in the game immediately following a loss. */
  bouncebackRate: number | null;
  deciderRate: number | null;
  matchPointCloseRate: number | null;
  /** Game 5 win rate after dropping game 4 from a 2-1 lead. */
  chokeRate: number | null;
  chokeSample: number;
  game1Rate: number | null;
}

/**
 * How a team's gold difference typically looks at one minute mark.
 *
 * `averageDiff` is the headline: it says how far ahead or behind the team
 * usually is. `aheadRate` guards against a single 8k stomp masquerading as a
 * habit — a team can average +400g while only leading in a third of its games.
 */
export interface GoldTempoPoint {
  minute: GoldCheckpoint;
  /** Games that actually reached this mark. */
  sample: number;
  averageDiff: number;
  /** Share of those games entered with a gold lead. */
  aheadRate: number;
}

/** A team's early-game gold pattern, one entry per checkpoint reached. */
export type GoldTempo = GoldTempoPoint[];

/** Hand-maintained ratings; optional, and absent by default. */
export interface TeamRating {
  team: string;
  /**
   * Lower is stronger. Carried through from the ratings file and shown on the
   * Data tab for reference, but no longer scored — the rank edge was removed.
   */
  globalRank: number | null;
  /** Inconsistency penalty subtracted from the team's total. */
  fraud: number;
}

export interface ChampionEdges {
  name: string;
  counters: string[];
  counteredBy: string[];
  synergy: string[];
}

/** Everything the engine needs, derived once from the enabled games. */
export interface PredictorModel {
  /** `player|role|championId` -> record inside the current split. */
  playerSplitRecord: Map<string, WinLoss>;
  /** `player|role|championId` -> record across everything loaded. */
  playerCareerRecord: Map<string, WinLoss>;
  /** Same, keyed by team — used only when the roster is unknown. */
  teamSplitRecord: Map<string, WinLoss>;
  teamCareerRecord: Map<string, WinLoss>;
  /** `season|split` the scoped data ends in, or `null` when empty. */
  /** Split key (`season|split`) each player and team is currently in. */
  currentSplitOf: Map<string, string>;
  /** Champion ids that cleared the pick-rate bar on the newest patches. */
  metaByRole: Map<Role, Set<string>>;
  /** Per-role pick rate over the meta window, for every champion seen in it. */
  pickRateByRole: Map<Role, Map<string, number>>;
  /** Picks plus bans over window games — the number the meta test uses. */
  presenceRateByRole: Map<Role, Map<string, number>>;
  metaPatches: string[];
  /** Games the meta window covers, so a thin read can be spotted. */
  metaWindowGames: number;
  metaPickRateThreshold: number;
  /** Whether each champion gets better or worse as the game runs long. */
  scalingByChampion: Map<string, ScalingRead>;
  /** The game lengths the short and long buckets were cut at. */
  scalingShortSeconds: number | null;
  scalingLongSeconds: number | null;
  behavior: Map<string, TeamBehavior>;
  /** Gold difference by minute mark, per team. */
  goldTempo: Map<string, GoldTempo>;
  standingsByCompetition: Map<CompetitionId, Map<string, StandingRow>>;
  standingsOverall: Map<string, StandingRow>;
  /** Season the standings and behaviour reads describe. */
  formSeason: string | null;
  rosters: Map<string, Partial<Record<Role, string>>>;
  teamsByCompetition: Map<CompetitionId, string[]>;
  allTeams: string[];
  /** Champions actually played in each role, for the pick dropdowns. */
  championsByRole: Map<Role, Champion[]>;
  ratings: Map<string, TeamRating>;
  gamesAnalyzed: number;
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface SideInput {
  /** Scope for the champion win-rate lookup. */
  competition: CompetitionId | null;
  team: string;
  /** Five slots in role order; `null` means the slot is still empty. */
  champions: (Champion | null)[];
  motivation: Motivation;
}

export interface PredictionInput {
  blue: SideInput;
  red: SideInput;
  stage: StageKind;
  seriesLength: SeriesLength;
  gameNumber: number;
  scoreBlue: number;
  scoreRed: number;
  previousWinner: Side | null;
  winRequirement: WinRequirement;
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

/** One champion's contribution to a team's win-rate base. */
export interface PickLine {
  role: Role;
  champion: Champion;
  player: string | null;
  winRate: number;
  /** How the win rate was arrived at, e.g. `7W/11 (64%)`. */
  note: string;
  /** Which record produced the number, narrowest first. */
  scope: 'blend' | 'split' | 'career' | 'team' | 'none' | 'unknown';
  /** This player on this champion in the current split, when they have played it. */
  splitRecord: WinLoss | null;
  /** The same across every loaded season. */
  careerRecord: WinLoss | null;
  /** Which split "this split" is for this player, e.g. `Summer`. */
  splitLabel: string | null;
  /** Share of meta-window games this champion was picked in this role. */
  pickRate: number | null;
  /** The same counting bans, which is what decided meta or off-meta. */
  presenceRate: number | null;
  meta: boolean;
  /** How the champion trends with game length; `null` when too few games. */
  scaling: ScalingRead | null;
  counters: Champion[];
  counteredBy: Champion[];
  synergy: Champion[];
}

/** The additive point tally for one side. */
export interface SideScore {
  team: string;
  picks: PickLine[];
  winRateBase: number;
  metaCount: number;
  metaBonus: number;
  offMetaCount: number;
  pocketBonus: number;
  formEdge: number;
  /** What the stated motivation is worth; zero for a normal game. */
  motivationBonus: number;
  /** Credit for leading the series going into this game. */
  seriesEdge: number;
  /** Credit for the better GlobalRank, when the gap is wide enough. */
  rankBonus: number;
  /** Credit for hand-listed high-ceiling champions on the board. */
  darkHorseBonus: number;
  fraudPenalty: number;
  total: number;
}

export type NoticeKind =
  | 'first-pick'
  | 'rank'
  | 'gold'
  | 'standings'
  | 'draft'
  | 'reliability'
  | 'series'
  | 'motivation'
  | 'form';

export interface Notice {
  kind: NoticeKind;
  text: string;
  /** Which side the notice is about, when it is about one. */
  side: Side | null;
  /** Flags a notice that cuts against the favourite. */
  warning?: boolean;
}

export interface Prediction {
  blue: SideScore;
  red: SideScore;
  /** Positive means blue leads. */
  margin: number;
  /** Predicted winner of this game; `null` when the totals are level. */
  favourite: Side | null;
  gameProbBlue: number;
  gameProbRed: number;
  seriesProbBlue: number;
  seriesProbRed: number;
  sweepProbBlue: number;
  sweepProbRed: number;
  needBlue: number;
  needRed: number;
  seriesTarget: number;
  formNote: string;
  /** How the rank edge was decided, or why none was awarded. */
  rankNote: string;
  tendencyBlue: string[];
  tendencyRed: string[];
  notices: Notice[];
}
