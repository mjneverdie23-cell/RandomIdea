/**
 * Match, round, bomb and economy tuning.
 *
 * EVERY number that defines the shape of a match lives here. Nothing in
 * src/core hard-codes a duration, a price or a win condition - systems read
 * them from this object, so a designer can rebalance the game without opening
 * a single system file.
 */

/** The two sides. Sides are swapped between the two persistent teams at halftime. */
export const Side = Object.freeze({
  ATTACKERS: 'ATTACKERS', // must plant + defend the bomb, or eliminate defenders
  DEFENDERS: 'DEFENDERS', // must defuse the bomb, or eliminate attackers
});

/** The two persistent teams. A team keeps its score across the side switch. */
export const TeamId = Object.freeze({
  TEAM_ONE: 'TEAM_ONE',
  TEAM_TWO: 'TEAM_TWO',
});

/** Round state machine phases. */
export const RoundPhase = Object.freeze({
  WARMUP: 'WARMUP',       // pre-match; free roam, no scoring
  BUY: 'BUY',             // freeze time - players rooted, shop open
  LIVE: 'LIVE',           // the actual round
  ROUND_END: 'ROUND_END', // post-round delay before the next buy phase
  MATCH_END: 'MATCH_END', // final scoreboard
});

/** Why a round ended - used for scoring, rewards, UI text and audio cues. */
export const RoundEndReason = Object.freeze({
  BOMB_DETONATED: 'BOMB_DETONATED',
  BOMB_DEFUSED: 'BOMB_DEFUSED',
  ATTACKERS_ELIMINATED: 'ATTACKERS_ELIMINATED',
  DEFENDERS_ELIMINATED: 'DEFENDERS_ELIMINATED',
  TIME_EXPIRED: 'TIME_EXPIRED',
});

export const MatchConfig = Object.freeze({
  /** First team to this many round wins takes the match. */
  roundsToWin: 13,
  /** Teams swap sides once this many rounds have been completed. */
  switchSidesAfterRound: 12,
  /** Hard cap on regulation rounds (2 x switchSidesAfterRound). */
  maxRounds: 24,
  /** When both teams reach roundsToWin - 1 and maxRounds is hit: draw or overtime. */
  overtime: {
    enabled: false,
    roundsPerHalf: 3,      // switch sides every N overtime rounds
    startingMoney: 12500,  // money granted at the start of each overtime half
  },
  /** Team sizes. Empty slots are filled with bots when bots are enabled. */
  teamSize: 5,
});

export const RoundConfig = Object.freeze({
  warmupDuration: 6,      // seconds of free roam before round 1
  buyDuration: 15,        // freeze time; the shop is open for this long
  roundDuration: 115,     // live time before the defenders win on the clock
  roundEndDuration: 5,    // post-round pause
  /**
   * Players may keep buying for this long after the buy phase ends (0 disables).
   * Movement is unfrozen the moment LIVE starts regardless.
   */
  buyGraceDuration: 0,
  /** Respawn is disabled in the objective mode; set true for a deathmatch-style warmup. */
  respawnDuringWarmup: true,
  warmupRespawnDelay: 3,
});

export const BombConfig = Object.freeze({
  fuseDuration: 40,       // seconds from plant to detonation
  plantDuration: 3.2,     // uninterrupted seconds needed to plant
  defuseDuration: 10,     // without a defuse kit
  defuseDurationWithKit: 5,
  /** How close the planter must be to the site's floor to start planting. */
  plantMaxHeightAboveSite: 2.5,
  /** Interaction radius for defusing / picking the bomb back up. */
  interactRadius: 2.2,
  /** Radius and peak damage of the detonation. */
  explosionRadius: 28,
  explosionDamage: 500,
  /** Damage falls off linearly to this fraction at the edge of the radius. */
  explosionMinDamageFraction: 0.15,
  /** Bomb carrier is picked at spawn from this side. */
  carrierSide: Side.ATTACKERS,
  /** A dropped bomb can be picked up by any attacker within this radius. */
  pickupRadius: 1.8,
});

export const EconomyConfig = Object.freeze({
  startingMoney: 800,
  maxMoney: 16000,
  /** Money is reset to startingMoney when sides switch (pistol round again). */
  resetOnSideSwitch: true,

  roundWinReward: 3250,
  /** Bomb-related win bonuses stack on top of roundWinReward. */
  bombDetonatedBonus: 300,
  bombDefusedBonus: 300,

  /** Consecutive-loss bonus: base + increment per loss, capped. */
  lossBonusBase: 1400,
  lossBonusIncrement: 500,
  lossBonusMax: 3400,
  /** Losing but planting the bomb still pays this much extra. */
  lossWithPlantBonus: 800,

  /** Individual objective rewards. */
  plantReward: 300,
  defuseReward: 300,
  /** Per-kill money comes from the weapon's `killReward` field. */
  teamKillPenalty: -300,
  suicidePenalty: -300,
});

export const CombatConfig = Object.freeze({
  /** Hit zone multipliers applied on top of the weapon's own headshot multiplier. */
  hitZones: {
    HEAD: { damageMultiplier: 1.0, useWeaponHeadshotMultiplier: true },
    CHEST: { damageMultiplier: 1.0, useWeaponHeadshotMultiplier: false },
    STOMACH: { damageMultiplier: 1.15, useWeaponHeadshotMultiplier: false },
    LEGS: { damageMultiplier: 0.75, useWeaponHeadshotMultiplier: false },
  },
  /** Fraction of the character height that counts as the head hitbox. */
  headZoneFraction: 0.86,
  stomachZoneFraction: 0.55,
  legsZoneFraction: 0.42,

  /** Armor soaks part of the damage; `armorPenetration` on the weapon lets damage through. */
  armorDamageFraction: 0.5, // how much of the absorbed damage is taken off the armor value
  helmetHeadshotReduction: 0.4, // headshot damage multiplier reduction while a helmet is worn

  friendlyFire: false,
  /** Extra damage multiplier when shooting a teammate (only if friendlyFire is on). */
  friendlyFireMultiplier: 0.35,
});

export const MovementConfig = Object.freeze({
  gravity: -22,
  /** Ground/air acceleration in units/s^2 (higher = snappier). */
  groundAcceleration: 70,
  airAcceleration: 14,
  groundFriction: 9,
  /** Max height the controller steps up automatically (stairs, low crates). */
  stepHeight: 0.6,
  /** Multipliers applied to the class base speed. */
  sprintMultiplier: 1.35,
  crouchMultiplier: 0.5,
  adsMultiplier: 0.55,
  airControlMultiplier: 0.4,
  /** Vertical size change while crouching. */
  crouchHeightFraction: 0.62,
  /** Fall damage starts above this impact speed. */
  fallDamageMinSpeed: 18,
  fallDamagePerUnitSpeed: 4.5,
  /** Characters below this speed are considered "still" for accuracy purposes. */
  stillSpeedThreshold: 0.6,
});

/** Simulation tick rate for the fixed-step core loop. */
export const SimConfig = Object.freeze({
  tickRate: 64,
  get fixedDelta() { return 1 / this.tickRate; },
  /** Hard cap on catch-up ticks per frame so a stalled tab cannot spiral. */
  maxTicksPerFrame: 5,
  /** Default RNG seed; change for a different (still deterministic) match. */
  seed: 20260831,
});
