/**
 * Every event name the simulation can emit.
 *
 * Systems talk to each other through these, never by direct reference, so a new
 * consumer (UI widget, audio cue, analytics, bot behaviour) can be bolted on
 * without touching the system that produces the event.
 *
 * Payloads are documented next to each name; keep them plain data.
 */
export const GameEvents = Object.freeze({
  // --- Match / round lifecycle -------------------------------------------
  MATCH_STARTED: 'match:started',            // { }
  MATCH_ENDED: 'match:ended',                // { winningTeamId, score, reason }
  ROUND_PHASE_CHANGED: 'round:phase',        // { phase, previousPhase, roundNumber }
  ROUND_STARTED: 'round:started',            // { roundNumber }
  ROUND_ENDED: 'round:ended',                // { roundNumber, winningTeamId, reason }
  SIDES_SWITCHED: 'round:sidesSwitched',     // { roundNumber }
  SCORE_CHANGED: 'match:score',              // { score: { [teamId]: wins } }

  // --- Characters ---------------------------------------------------------
  CHARACTER_SPAWNED: 'character:spawned',    // { character }
  CHARACTER_DAMAGED: 'character:damaged',    // { target, attacker, amount, hitZone, weaponId }
  CHARACTER_DIED: 'character:died',          // { victim, attacker, weaponId, hitZone }
  CHARACTER_CLASS_CHANGED: 'character:class',// { character, classId }

  // --- Weapons / combat ---------------------------------------------------
  WEAPON_FIRED: 'weapon:fired',              // { character, weapon, origin, direction }
  WEAPON_HIT: 'weapon:hit',                  // { character, weapon, point, normal, target, hitZone }
  WEAPON_RELOAD_STARTED: 'weapon:reloadStart', // { character, weapon }
  WEAPON_RELOAD_FINISHED: 'weapon:reloadEnd',  // { character, weapon }
  WEAPON_SWITCHED: 'weapon:switched',        // { character, weapon, slot }
  WEAPON_DRY_FIRE: 'weapon:dryFire',         // { character, weapon }
  GRENADE_THROWN: 'grenade:thrown',          // { character, grenade }
  GRENADE_EXPLODED: 'grenade:exploded',      // { grenade, position }

  // --- Abilities ----------------------------------------------------------
  ABILITY_USED: 'ability:used',              // { character, abilityId }
  ABILITY_ENDED: 'ability:ended',            // { character, abilityId }

  // --- Economy / shop -----------------------------------------------------
  MONEY_CHANGED: 'economy:money',            // { character, amount, delta, reason }
  ITEM_PURCHASED: 'shop:purchased',          // { character, itemId, price }
  PURCHASE_REJECTED: 'shop:rejected',        // { character, itemId, reason }

  // --- Bomb / objective ---------------------------------------------------
  BOMB_PICKED_UP: 'bomb:pickedUp',           // { character }
  BOMB_DROPPED: 'bomb:dropped',              // { position, character }
  BOMB_PLANT_STARTED: 'bomb:plantStart',     // { character, siteId }
  BOMB_PLANT_ABORTED: 'bomb:plantAbort',     // { character }
  BOMB_PLANTED: 'bomb:planted',              // { character, siteId, position }
  BOMB_DEFUSE_STARTED: 'bomb:defuseStart',   // { character, duration }
  BOMB_DEFUSE_ABORTED: 'bomb:defuseAbort',   // { character }
  BOMB_DEFUSED: 'bomb:defused',              // { character }
  BOMB_EXPLODED: 'bomb:exploded',            // { position }

  // --- Presentation hooks (consumed by UI / audio / VFX) ------------------
  NOTIFICATION: 'ui:notification',           // { text, level }
  KILL_FEED: 'ui:killFeed',                  // { attackerName, victimName, weaponId, headshot }
});
