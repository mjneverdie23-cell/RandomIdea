/**
 * Places characters at their side's spawn points at the start of every round.
 *
 * Spawn points come from the map, so a new map needs no code changes; if a team
 * is bigger than the authored spawn list, extra members are scattered around
 * the last point using the world's free-position search.
 */
import { Side } from '../../config/gameplay.config.js';
import { GameEvents } from '../events/GameEvents.js';

export class SpawnSystem {
  constructor({ world, teams, bus, random }) {
    this.world = world;
    this.teams = teams;
    this.bus = bus;
    this.random = random;
  }

  spawnPointsFor(side) {
    return this.world.map.spawns[side] ?? [];
  }

  /**
   * Spawns every member of both teams and resets their round state.
   * @param {{keepWeaponsFor?: (character) => boolean}} options
   *   `keepWeaponsFor` decides per character whether gear carries over
   *   (survivors keep theirs, the dead re-buy - the usual CS convention).
   */
  spawnAll({ keepWeaponsFor = () => true } = {}) {
    for (const side of [Side.ATTACKERS, Side.DEFENDERS]) {
      const members = this.teams.membersOnSide(side);
      const points = this.spawnPointsFor(side);
      members.forEach((character, index) => {
        const point = points[index % points.length] ?? points[0];
        this.spawnCharacter(character, point, {
          keepWeapons: keepWeaponsFor(character),
          spreadIndex: Math.floor(index / points.length),
        });
      });
    }
  }

  spawnCharacter(character, point, { keepWeapons = true, spreadIndex = 0 } = {}) {
    character.resetForRound({ keepWeapons });
    const jitter = spreadIndex === 0 ? 0 : 1.6 * spreadIndex;
    const desired = {
      x: point.position.x + (jitter ? this.random.symmetric(jitter) : 0),
      y: point.position.y + 0.05,
      z: point.position.z + (jitter ? this.random.symmetric(jitter) : 0),
    };
    const free = this.world.findFreePositionNear(desired, character, 4, this.random);
    character.spawnAt(free, point.yaw);
    this.bus.emit(GameEvents.CHARACTER_SPAWNED, { character });
    return character;
  }

  /** Used by the warmup phase, where death is not permanent. */
  respawn(character) {
    const side = this.teams.sideOf(character.teamId);
    const points = this.spawnPointsFor(side);
    const point = points[this.random.int(0, points.length - 1)];
    return this.spawnCharacter(character, point, { keepWeapons: true });
  }
}
