/**
 * Match-level rules: the score, the halftime side switch and the win condition.
 *
 * RoundManager tells MatchManager who won a round; MatchManager decides whether
 * that ends the match, whether sides swap next round, and nothing else. All the
 * thresholds come from MatchConfig - see gameplay.config.js.
 */
import { MatchConfig, RoundEndReason } from '../../config/gameplay.config.js';
import { GameEvents } from '../events/GameEvents.js';

export class MatchManager {
  constructor({ bus, teams, config = MatchConfig }) {
    this.bus = bus;
    this.teams = teams;
    this.config = config;

    this.roundNumber = 0;        // 1-based; incremented when a round starts
    this.completedRounds = 0;
    this.isOver = false;
    this.winningTeamId = null;
    this.endReason = null;
    this.inOvertime = false;
    this.overtimeHalf = 0;
    this._pendingMatchEnd = null;
    /** History of finished rounds, handy for UI and debugging. */
    this.history = [];
  }

  get scores() {
    return Object.fromEntries(this.teams.all.map((team) => [team.id, team.score]));
  }

  get roundsToWin() { return this.config.roundsToWin; }

  beginMatch() {
    this.roundNumber = 0;
    this.completedRounds = 0;
    this.isOver = false;
    this.winningTeamId = null;
    for (const team of this.teams.all) { team.score = 0; team.lossStreak = 0; }
    this.bus.emit(GameEvents.MATCH_STARTED, { config: this.config });
  }

  beginRound() {
    this.roundNumber += 1;
    return this.roundNumber;
  }

  /**
   * Records a round result and evaluates the match state.
   * @returns {{matchOver: boolean, switchSides: boolean, winningTeamId: string|null}}
   */
  recordRoundResult(winningTeamId, reason = RoundEndReason.TIME_EXPIRED) {
    const winner = this.teams.get(winningTeamId);
    if (winner) {
      winner.score += 1;
      winner.lossStreak = 0;
    }
    for (const team of this.teams.all) {
      if (team.id !== winningTeamId) team.lossStreak += 1;
    }

    this.completedRounds += 1;
    this.history.push({
      round: this.roundNumber, winningTeamId, reason, scores: this.scores,
      sides: this.teams.describeSides(),
    });
    this.bus.emit(GameEvents.SCORE_CHANGED, { score: this.scores, roundNumber: this.roundNumber });

    const matchOver = this._evaluateMatchEnd();
    const switchSides = !matchOver && this._shouldSwitchSides();

    return { matchOver, switchSides, winningTeamId };
  }

  _evaluateMatchEnd() {
    const winner = this.teams.all.find((team) => team.score >= this.config.roundsToWin);
    if (winner) {
      this._endMatch(winner.id, 'ROUNDS_REACHED');
      return true;
    }
    if (this.completedRounds >= this.config.maxRounds) {
      if (this.config.overtime.enabled) {
        this.inOvertime = true;
        return false;
      }
      // Regulation exhausted with nobody at the target: draw.
      const [a, b] = this.teams.all;
      const drawWinner = a.score === b.score ? null : (a.score > b.score ? a.id : b.id);
      this._endMatch(drawWinner, drawWinner ? 'ROUNDS_EXHAUSTED' : 'DRAW');
      return true;
    }
    return false;
  }

  _endMatch(winningTeamId, reason) {
    this.isOver = true;
    this.winningTeamId = winningTeamId;
    this.endReason = reason;
    // Queued rather than emitted here so listeners always see ROUND_ENDED for
    // the deciding round before MATCH_ENDED. RoundManager flushes it.
    this._pendingMatchEnd = {
      winningTeamId, reason, score: this.scores, teams: this.teams.describe(),
    };
  }

  /** Emits a queued MATCH_ENDED, if any. Called by RoundManager. */
  flushMatchEnd() {
    if (!this._pendingMatchEnd) return false;
    const payload = this._pendingMatchEnd;
    this._pendingMatchEnd = null;
    this.bus.emit(GameEvents.MATCH_ENDED, payload);
    return true;
  }

  _shouldSwitchSides() {
    if (this.inOvertime) {
      const overtimeRounds = this.completedRounds - this.config.maxRounds;
      return overtimeRounds > 0 && overtimeRounds % this.config.overtime.roundsPerHalf === 0;
    }
    return this.completedRounds === this.config.switchSidesAfterRound;
  }

  /** True when the next round could decide the match for either team. */
  isMatchPoint() {
    return this.teams.all.some((team) => team.score === this.config.roundsToWin - 1);
  }

  describe() {
    return {
      roundNumber: this.roundNumber,
      completedRounds: this.completedRounds,
      scores: this.scores,
      roundsToWin: this.config.roundsToWin,
      switchSidesAfterRound: this.config.switchSidesAfterRound,
      maxRounds: this.config.maxRounds,
      isOver: this.isOver,
      winningTeamId: this.winningTeamId,
      endReason: this.endReason,
      inOvertime: this.inOvertime,
      isMatchPoint: this.isMatchPoint(),
    };
  }
}
