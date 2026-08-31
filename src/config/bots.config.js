/**
 * Bot behaviour tuning.
 *
 * Bots drive the exact same `intent` structure a human produces, so anything a
 * bot can do a player can do, and vice versa. Difficulty is a multiplier set,
 * not a separate code path.
 */
export const BotConfig = Object.freeze({
  enabled: true,
  /** Fill both teams up to MatchConfig.teamSize with bots. */
  fillTeams: true,
  defaultDifficulty: 'NORMAL',

  difficulties: {
    EASY:   { aimTurnRate: 2.2, aimError: 4.5, reactionTime: 0.55, fireBurstMin: 0.15, fireBurstMax: 0.4, viewDistance: 55, accuracyMoving: 0.5 },
    NORMAL: { aimTurnRate: 4.5, aimError: 2.2, reactionTime: 0.3,  fireBurstMin: 0.2,  fireBurstMax: 0.6, viewDistance: 75, accuracyMoving: 0.7 },
    HARD:   { aimTurnRate: 7.5, aimError: 1.1, reactionTime: 0.16, fireBurstMin: 0.3,  fireBurstMax: 0.9, viewDistance: 95, accuracyMoving: 0.85 },
  },

  /** Field of view (radians) inside which a bot can notice an enemy. */
  fieldOfView: Math.PI * 0.75,
  /** Bots forget a target this many seconds after losing sight of it. */
  targetMemory: 2.5,
  /** Distance at which a bot stops closing on its objective waypoint. */
  waypointRadius: 2.5,
  /** Chance per round that an attacking bot picks site B instead of A. */
  siteBPreference: 0.5,
  /** Money a bot keeps in reserve rather than spending. */
  saveThreshold: 1500,
  /** Bots re-evaluate their plan this often (seconds). */
  thinkInterval: 0.25,
  /** Strafe amount while fighting, 0 = never strafe. */
  combatStrafe: 0.8,
});
