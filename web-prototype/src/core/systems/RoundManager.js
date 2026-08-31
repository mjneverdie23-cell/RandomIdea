/**
 * The round state machine: WARMUP -> BUY -> LIVE -> ROUND_END -> (BUY | MATCH_END).
 *
 * This is the only place that knows *how a round is won*. It listens for bomb
 * events, watches team elimination and the clock, then asks MatchManager to
 * record the result and tells EconomySystem to pay out. Player code, weapons
 * and the bomb know nothing about rounds.
 */
import { RoundPhase, RoundEndReason, RoundConfig, EconomyConfig, Side } from '../../config/gameplay.config.js';
import { GameEvents } from '../events/GameEvents.js';

export class RoundManager {
  constructor({ bus, world, teams, match, economy, bomb, spawn, combat, config = RoundConfig }) {
    this.bus = bus;
    this.world = world;
    this.teams = teams;
    this.match = match;
    this.economy = economy;
    this.bomb = bomb;
    this.spawn = spawn;
    this.combat = combat;
    this.config = config;

    this.phase = RoundPhase.WARMUP;
    this.phaseTimeRemaining = config.warmupDuration;
    this.roundTimeRemaining = 0;
    this.lastRoundResult = null;
    /** Freezes the round clock and phase transitions (debugging, tests, replays). */
    this.paused = false;
    /** Set while a round is being resolved so win checks cannot double-fire. */
    this._resolving = false;
    /** True when the next round starts a new half. */
    this._pendingSideSwitch = false;

    this._subscriptions = [
      bus.on(GameEvents.BOMB_DEFUSED, () => this._onBombDefused()),
      bus.on(GameEvents.BOMB_EXPLODED, () => this._onBombExploded()),
      bus.on(GameEvents.CHARACTER_DIED, () => this._onCharacterDied()),
    ];
  }

  dispose() { for (const off of this._subscriptions) off(); }

  // --------------------------------------------------------------- lifecycle --
  /** Starts the match at the warmup phase. */
  start() {
    this.match.beginMatch();
    this.economy.grantStartingMoney(this.world.characters, EconomyConfig.startingMoney);
    this._enterPhase(RoundPhase.WARMUP);
  }

  /** Skips the remainder of the current phase (debug / "ready up" button). */
  skipPhase() { this.phaseTimeRemaining = 0; }

  update(dt) {
    if (this.paused) return;
    switch (this.phase) {
      case RoundPhase.WARMUP:
        this._updateWarmup(dt);
        break;
      case RoundPhase.BUY:
        this.phaseTimeRemaining -= dt;
        if (this.phaseTimeRemaining <= 0) this._enterPhase(RoundPhase.LIVE);
        break;
      case RoundPhase.LIVE:
        this._updateLive(dt);
        break;
      case RoundPhase.ROUND_END:
        this.phaseTimeRemaining -= dt;
        if (this.phaseTimeRemaining <= 0) this._startNextRound();
        break;
      case RoundPhase.MATCH_END:
      default:
        break;
    }
  }

  _updateWarmup(dt) {
    this.phaseTimeRemaining -= dt;
    if (this.config.respawnDuringWarmup) {
      for (const character of this.world.characters) {
        if (character.health.alive) continue;
        character.respawnTimer -= dt;
        if (character.respawnTimer <= 0) this.spawn.respawn(character);
      }
    }
    if (this.phaseTimeRemaining <= 0) this._enterPhase(RoundPhase.BUY);
  }

  _updateLive(dt) {
    this.roundTimeRemaining -= dt;
    this.bomb.update(dt);
    if (this._resolving) return;

    // The clock only matters until the bomb is planted; after that the fuse rules.
    if (!this.bomb.isPlanted && this.roundTimeRemaining <= 0) {
      this._endRound(this.teams.teamIdOnSide(Side.DEFENDERS), RoundEndReason.TIME_EXPIRED);
      return;
    }
    this._checkElimination();
  }

  // ------------------------------------------------------------------ phases --
  _enterPhase(phase) {
    const previous = this.phase;
    this.phase = phase;

    switch (phase) {
      case RoundPhase.WARMUP: {
        this.phaseTimeRemaining = this.config.warmupDuration;
        this.combat.combatEnabled = true;
        this.bomb.setEnabled(false);
        this.spawn.spawnAll({ keepWeaponsFor: () => false });
        for (const character of this.world.characters) character.frozen = false;
        break;
      }
      case RoundPhase.BUY: {
        this.phaseTimeRemaining = this.config.buyDuration;
        this.roundTimeRemaining = this.config.roundDuration;
        this.match.beginRound();
        this._prepareRound();
        this.combat.combatEnabled = false;
        this.bomb.setEnabled(false);
        for (const character of this.world.characters) character.frozen = true;
        this.bus.emit(GameEvents.ROUND_STARTED, {
          roundNumber: this.match.roundNumber,
          sides: this.teams.describeSides(),
        });
        break;
      }
      case RoundPhase.LIVE: {
        this.phaseTimeRemaining = 0;
        this.combat.combatEnabled = true;
        this.bomb.setEnabled(true);
        for (const character of this.world.characters) character.frozen = false;
        break;
      }
      case RoundPhase.ROUND_END: {
        this.phaseTimeRemaining = this.config.roundEndDuration;
        this.combat.combatEnabled = false;
        this.bomb.setEnabled(false);
        break;
      }
      case RoundPhase.MATCH_END: {
        this.phaseTimeRemaining = Infinity;
        this.combat.combatEnabled = false;
        this.bomb.setEnabled(false);
        for (const character of this.world.characters) character.frozen = true;
        break;
      }
      default: break;
    }

    this.bus.emit(GameEvents.ROUND_PHASE_CHANGED, {
      phase, previousPhase: previous, roundNumber: this.match.roundNumber,
    });
  }

  /** Everything that has to happen between two rounds. */
  _prepareRound() {
    this._resolving = false;
    this.combat.clearProjectiles();
    this.world.clearPickups();
    this.bomb.reset();
    this.spawn.spawnAll({
      // Survivors of the previous round keep their gear; the dead start over.
      keepWeaponsFor: (character) => character.survivedLastRound !== false,
    });
    this.bomb.assignToRandomAttacker();
    for (const character of this.world.characters) character.survivedLastRound = true;
  }

  _startNextRound() {
    if (this.match.isOver) {
      this._enterPhase(RoundPhase.MATCH_END);
      return;
    }
    if (this._pendingSideSwitch) {
      this._pendingSideSwitch = false;
      this.teams.switchSides(this.match.completedRounds);
      if (EconomyConfig.resetOnSideSwitch) {
        const startingMoney = this.match.inOvertime
          ? this.match.config.overtime.startingMoney
          : EconomyConfig.startingMoney;
        this.economy.grantStartingMoney(this.world.characters, startingMoney);
        // A fresh half means a fresh pistol round: gear is wiped.
        for (const character of this.world.characters) character.survivedLastRound = false;
      }
      for (const team of this.teams.all) team.lossStreak = 0;
    }
    this._enterPhase(RoundPhase.BUY);
  }

  // ------------------------------------------------------- win conditions ---
  _checkElimination() {
    const attackerTeamId = this.teams.teamIdOnSide(Side.ATTACKERS);
    const defenderTeamId = this.teams.teamIdOnSide(Side.DEFENDERS);
    const attackersAlive = this.teams.aliveCount(attackerTeamId);
    const defendersAlive = this.teams.aliveCount(defenderTeamId);

    if (defendersAlive === 0) {
      this._endRound(attackerTeamId, RoundEndReason.DEFENDERS_ELIMINATED);
      return;
    }
    // Wiping the attackers only wins the round while the bomb is not ticking.
    if (attackersAlive === 0 && !this.bomb.isPlanted) {
      this._endRound(defenderTeamId, RoundEndReason.ATTACKERS_ELIMINATED);
    }
  }

  _onCharacterDied() {
    if (this.phase === RoundPhase.LIVE && !this._resolving) this._checkElimination();
  }

  _onBombDefused() {
    if (this.phase !== RoundPhase.LIVE) return;
    this._endRound(this.teams.teamIdOnSide(Side.DEFENDERS), RoundEndReason.BOMB_DEFUSED);
  }

  _onBombExploded() {
    if (this.phase !== RoundPhase.LIVE) return;
    this._endRound(this.teams.teamIdOnSide(Side.ATTACKERS), RoundEndReason.BOMB_DETONATED);
  }

  /** Single exit point for a round: score, money, events, next phase. */
  _endRound(winningTeamId, reason) {
    if (this._resolving || this.phase === RoundPhase.ROUND_END || this.phase === RoundPhase.MATCH_END) return;
    this._resolving = true;

    for (const character of this.world.characters) {
      character.survivedLastRound = character.health.alive;
    }

    const bombPlanted = this.bomb.isPlanted || this.bomb.state === 'EXPLODED' || this.bomb.state === 'DEFUSED';
    const plantingTeamId = this.bomb.planter?.teamId ?? null;

    const result = this.match.recordRoundResult(winningTeamId, reason);
    this.economy.awardRoundEnd({ winningTeamId, bombPlanted, plantingTeamId });
    this.economy.awardObjectiveBonus(winningTeamId, reason);

    this.lastRoundResult = {
      roundNumber: this.match.roundNumber,
      winningTeamId,
      winningTeamName: this.teams.get(winningTeamId)?.name ?? 'Nobody',
      reason,
      scores: this.match.scores,
    };
    this._pendingSideSwitch = result.switchSides;

    this.bus.emit(GameEvents.ROUND_ENDED, {
      roundNumber: this.match.roundNumber, winningTeamId, reason,
      scores: this.match.scores, matchOver: result.matchOver, switchSides: result.switchSides,
    });

    this.match.flushMatchEnd();
    // MATCH_END is entered after the post-round pause, in _startNextRound().
    this._enterPhase(RoundPhase.ROUND_END);
  }

  // --------------------------------------------------------------- snapshot --
  get timeRemaining() {
    if (this.phase === RoundPhase.LIVE) {
      return this.bomb.isPlanted ? this.bomb.fuseRemaining : Math.max(0, this.roundTimeRemaining);
    }
    return Math.max(0, this.phaseTimeRemaining);
  }

  describe() {
    return {
      phase: this.phase,
      timeRemaining: this.timeRemaining,
      roundTimeRemaining: Math.max(0, this.roundTimeRemaining),
      phaseTimeRemaining: Math.max(0, this.phaseTimeRemaining),
      roundNumber: this.match.roundNumber,
      lastRoundResult: this.lastRoundResult,
      buyPhase: this.phase === RoundPhase.BUY || this.phase === RoundPhase.WARMUP,
    };
  }
}
