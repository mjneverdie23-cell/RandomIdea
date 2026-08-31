/**
 * Class abilities.
 *
 * An ability is data plus two optional hooks. The hooks receive a context
 * object built by AbilityController, so an ability can never reach into a
 * system directly - it only uses the small surface documented below.
 *
 * ctx = {
 *   character,                  // the user
 *   time,                       // simulation time in seconds
 *   bus,                        // EventBus (GameEvents)
 *   world: {
 *     charactersWithin(position, radius, { team, enemyOf, aliveOnly }) -> Character[],
 *     hasLineOfSight(fromCharacter, toCharacter) -> boolean,
 *   },
 *   combat: { applyDamage({ target, attacker, amount, source }) },
 *   random,                     // seeded Random instance
 * }
 *
 * TO ADD AN ABILITY: add an entry here, then list its id in a class's
 * `abilities` array in classes.config.js. Slot order = ability key order
 * (first = Q, second = F by default, see input.config.js).
 */

import * as V3 from '../core/math/vec3.js';

export const ABILITY_DEFINITIONS = Object.freeze({
  // ------------------------------------------------------------------ TANK --
  ability_bulwark: {
    id: 'ability_bulwark',
    displayName: 'Bulwark',
    description: 'Brace behind armoured plates: 50% damage reduction, slower movement.',
    cooldown: 30,
    duration: 8,
    chargesPerRound: Infinity,
    onActivate(ctx) {
      ctx.character.effects.add({
        id: 'bulwark',
        duration: 8,
        modifiers: { damageTakenMultiplier: 0.5, speedMultiplier: 0.75 },
        visual: 'shield',
      });
    },
  },
  ability_tail_slam: {
    id: 'ability_tail_slam',
    displayName: 'Tail Slam',
    description: 'Ground slam damaging and slowing every enemy nearby.',
    cooldown: 22,
    duration: 0,
    radius: 6.5,
    damage: 45,
    onActivate(ctx) {
      const { radius, damage } = ABILITY_DEFINITIONS.ability_tail_slam;
      const enemies = ctx.world.charactersWithin(ctx.character.position, radius, {
        enemyOf: ctx.character, aliveOnly: true,
      });
      for (const enemy of enemies) {
        const falloff = 1 - V3.distance(enemy.position, ctx.character.position) / radius;
        ctx.combat.applyDamage({
          target: enemy, attacker: ctx.character,
          amount: damage * Math.max(0.25, falloff), source: 'ability_tail_slam',
        });
        enemy.effects.add({ id: 'slammed', duration: 2, modifiers: { speedMultiplier: 0.6 } });
      }
    },
  },

  // ---------------------------------------------------------------- SNIPER --
  ability_hawk_eye: {
    id: 'ability_hawk_eye',
    displayName: 'Hawk Eye',
    description: 'Steady the shot and reveal enemies in line of sight for 6 seconds.',
    cooldown: 35,
    duration: 6,
    revealRange: 120,
    onActivate(ctx) {
      const { duration, revealRange } = ABILITY_DEFINITIONS.ability_hawk_eye;
      ctx.character.effects.add({
        id: 'hawk_eye', duration,
        modifiers: { spreadMultiplier: 0.35, speedMultiplier: 0.85 },
        visual: 'focus',
      });
      const enemies = ctx.world.charactersWithin(ctx.character.position, revealRange, {
        enemyOf: ctx.character, aliveOnly: true,
      });
      for (const enemy of enemies) {
        if (ctx.world.hasLineOfSight(ctx.character, enemy)) enemy.revealUntil(ctx.time + duration);
      }
    },
  },
  ability_glide: {
    id: 'ability_glide',
    displayName: 'Glide',
    description: 'Catch the air: reduced gravity and silent landings for 4 seconds.',
    cooldown: 20,
    duration: 4,
    onActivate(ctx) {
      ctx.character.effects.add({
        id: 'glide', duration: 4,
        modifiers: { gravityMultiplier: 0.35, speedMultiplier: 1.1 },
        visual: 'glide',
      });
      // A small upward nudge so the glide is useful even from flat ground.
      ctx.character.velocity.y = Math.max(ctx.character.velocity.y, 4.5);
    },
  },

  // -------------------------------------------------------------- ASSASSIN --
  ability_pounce: {
    id: 'ability_pounce',
    displayName: 'Pounce',
    description: 'Explosive leap in the direction you are looking.',
    cooldown: 12,
    duration: 0,
    forwardImpulse: 16,
    upImpulse: 5.5,
    onActivate(ctx) {
      const def = ABILITY_DEFINITIONS.ability_pounce;
      const forward = V3.dirFromAngles(ctx.character.yaw, 0);
      ctx.character.velocity.x += forward.x * def.forwardImpulse;
      ctx.character.velocity.z += forward.z * def.forwardImpulse;
      ctx.character.velocity.y = def.upImpulse;
      ctx.character.effects.add({ id: 'pounce', duration: 0.6, modifiers: {}, visual: 'dash' });
    },
  },
  ability_camouflage: {
    id: 'ability_camouflage',
    displayName: 'Camouflage',
    description: 'Blend into the environment for 5 seconds. Firing breaks it.',
    cooldown: 30,
    duration: 5,
    onActivate(ctx) {
      ctx.character.effects.add({
        id: 'camouflage', duration: 5,
        modifiers: { invisible: true, speedMultiplier: 0.9 },
        visual: 'camo',
        breakOnFire: true,
      });
    },
  },

  // ---------------------------------------------------------------- RANGER --
  ability_echo_call: {
    id: 'ability_echo_call',
    displayName: 'Echo Call',
    description: 'Sonic pulse revealing every enemy in a wide radius for 4 seconds.',
    cooldown: 30,
    duration: 4,
    radius: 45,
    onActivate(ctx) {
      const def = ABILITY_DEFINITIONS.ability_echo_call;
      const enemies = ctx.world.charactersWithin(ctx.character.position, def.radius, {
        enemyOf: ctx.character, aliveOnly: true,
      });
      for (const enemy of enemies) enemy.revealUntil(ctx.time + def.duration);
    },
  },
  ability_field_dressing: {
    id: 'ability_field_dressing',
    displayName: 'Field Dressing',
    description: 'Heal yourself for 45 and nearby allies for 25.',
    cooldown: 35,
    duration: 0,
    radius: 10,
    selfHeal: 45,
    allyHeal: 25,
    onActivate(ctx) {
      const def = ABILITY_DEFINITIONS.ability_field_dressing;
      ctx.character.health.heal(def.selfHeal);
      const allies = ctx.world.charactersWithin(ctx.character.position, def.radius, {
        team: ctx.character.teamId, aliveOnly: true,
      });
      for (const ally of allies) if (ally !== ctx.character) ally.health.heal(def.allyHeal);
    },
  },

  // --------------------------------------------------------------- BRUISER --
  ability_roar: {
    id: 'ability_roar',
    displayName: 'Terror Roar',
    description: 'Allies nearby deal +20% damage; enemies nearby are slowed.',
    cooldown: 40,
    duration: 6,
    radius: 14,
    onActivate(ctx) {
      const def = ABILITY_DEFINITIONS.ability_roar;
      const allies = ctx.world.charactersWithin(ctx.character.position, def.radius, {
        team: ctx.character.teamId, aliveOnly: true,
      });
      for (const ally of allies) {
        ally.effects.add({
          id: 'roar_buff', duration: def.duration,
          modifiers: { damageDealtMultiplier: 1.2 }, visual: 'buff',
        });
      }
      const enemies = ctx.world.charactersWithin(ctx.character.position, def.radius, {
        enemyOf: ctx.character, aliveOnly: true,
      });
      for (const enemy of enemies) {
        enemy.effects.add({
          id: 'roar_fear', duration: 3,
          modifiers: { speedMultiplier: 0.8 }, visual: 'fear',
        });
      }
    },
  },
  ability_charge: {
    id: 'ability_charge',
    displayName: 'Charge',
    description: 'Barrel forwards, trampling anything in the way.',
    cooldown: 25,
    duration: 1.4,
    speedMultiplier: 1.9,
    trampleDamage: 35,
    trampleRadius: 2.4,
    onActivate(ctx) {
      const def = ABILITY_DEFINITIONS.ability_charge;
      ctx.character.effects.add({
        id: 'charge', duration: def.duration,
        modifiers: { speedMultiplier: def.speedMultiplier, damageTakenMultiplier: 0.85 },
        visual: 'charge',
        /** Per-tick hook: trample enemies the charger runs through. */
        onTick(character, dt, tickCtx) {
          const enemies = tickCtx.world.charactersWithin(character.position, def.trampleRadius, {
            enemyOf: character, aliveOnly: true,
          });
          for (const enemy of enemies) {
            tickCtx.combat.applyDamage({
              target: enemy, attacker: character,
              amount: def.trampleDamage * dt, source: 'ability_charge',
            });
          }
        },
      });
    },
  },
});

export function getAbilityDefinition(abilityId) {
  return ABILITY_DEFINITIONS[abilityId] ?? null;
}
