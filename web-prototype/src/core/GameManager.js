/**
 * Composition root of the simulation.
 *
 * GameManager wires the systems together, owns the fixed-step tick order and
 * exposes a read-only snapshot for presentation layers. It contains as little
 * logic as possible: if something can live in a system, it lives there.
 *
 * The whole class is renderer-free, so it runs identically in the browser and
 * in Node (see tools/headless-match.js and tests/).
 */
import { EventBus } from './events/EventBus.js';
import { GameEvents } from './events/GameEvents.js';
import { Random } from './math/random.js';
import { World } from './world/World.js';
import { Character } from './entities/Character.js';
import { CombatSystem } from './systems/CombatSystem.js';
import { TeamManager } from './systems/TeamManager.js';
import { MatchManager } from './systems/MatchManager.js';
import { EconomySystem } from './systems/EconomySystem.js';
import { ShopSystem } from './systems/ShopSystem.js';
import { SpawnSystem } from './systems/SpawnSystem.js';
import { BombSystem } from './systems/BombSystem.js';
import { RoundManager } from './systems/RoundManager.js';
import { BotBrain } from './ai/BotBrain.js';
import { WeaponSlot } from '../config/weapons.config.js';
import { SimConfig, MatchConfig, TeamId, Side, RoundPhase } from '../config/gameplay.config.js';
import { BotConfig } from '../config/bots.config.js';
import { CLASS_IDS, ClassId } from '../config/classes.config.js';
import { getMap, DEFAULT_MAP_ID } from '../config/maps/index.js';

const BOT_NAMES = [
  'Spike', 'Fang', 'Ridge', 'Thorn', 'Bolt', 'Crag', 'Dash', 'Ember',
  'Gale', 'Husk', 'Iggy', 'Jaws', 'Kite', 'Lash', 'Moss', 'Nyx',
];

export class GameManager {
  /**
   * @param {object} options
   * @param {string} [options.mapId]        id from the map registry (config/maps/index.js)
   * @param {object} [options.mapData]      an explicit map module, overriding mapId
   * @param {number} [options.seed]         RNG seed for a deterministic match
   * @param {boolean} [options.withLocalPlayer] create a human-controlled character
   * @param {string} [options.playerClassId]
   * @param {string} [options.playerTeamId]
   */
  constructor({
    mapId = DEFAULT_MAP_ID,
    mapData = getMap(mapId),
    seed = SimConfig.seed,
    withLocalPlayer = true,
    playerName = 'You',
    playerClassId = ClassId.RANGER,
    playerTeamId = TeamId.TEAM_ONE,
    teamSize = MatchConfig.teamSize,
    botDifficulty = BotConfig.defaultDifficulty,
    fillBots = BotConfig.enabled && BotConfig.fillTeams,
  } = {}) {
    this.bus = new EventBus();
    this.random = new Random(seed);
    this.world = new World(mapData);
    this.teams = new TeamManager({ bus: this.bus });
    this.match = new MatchManager({ bus: this.bus, teams: this.teams });
    this.combat = new CombatSystem({ world: this.world, bus: this.bus, random: this.random });
    this.economy = new EconomySystem({ bus: this.bus, teams: this.teams });
    this.spawn = new SpawnSystem({ world: this.world, teams: this.teams, bus: this.bus, random: this.random });
    this.bomb = new BombSystem({
      world: this.world, bus: this.bus, teams: this.teams, combat: this.combat, random: this.random,
    });
    this.shop = new ShopSystem({
      bus: this.bus, world: this.world, teams: this.teams, economy: this.economy,
      getPhase: () => this.round.phase,
    });
    this.round = new RoundManager({
      bus: this.bus, world: this.world, teams: this.teams, match: this.match,
      economy: this.economy, bomb: this.bomb, spawn: this.spawn, combat: this.combat,
    });

    /** @type {Map<Character, BotBrain>} */
    this.bots = new Map();
    /** @type {Character|null} */
    this.localPlayer = null;
    this.teamSize = teamSize;
    this.botDifficulty = botDifficulty;
    this.fillBots = fillBots;
    this.elapsed = 0;

    if (withLocalPlayer) {
      this.localPlayer = this.addPlayer({ name: playerName, classId: playerClassId, teamId: playerTeamId });
    }
    this.fillWithBots();
  }

  // -------------------------------------------------------------- roster ----
  addPlayer({ name, classId, teamId }) {
    const character = new Character({ name, classId, teamId, isBot: false });
    this._registerCharacter(character, teamId);
    return character;
  }

  addBot({ name, classId, teamId, difficulty = this.botDifficulty }) {
    const character = new Character({ name, classId, teamId, isBot: true, botDifficulty: difficulty });
    this._registerCharacter(character, teamId);
    this.bots.set(character, new BotBrain({
      character, world: this.world, teams: this.teams, bomb: this.bomb,
      shop: this.shop, combat: this.combat, random: this.random,
      getPhase: () => this.round.phase, difficulty,
    }));
    return character;
  }

  _registerCharacter(character, teamId) {
    this.world.addCharacter(character);
    this.teams.addMember(character, teamId);
    character.survivedLastRound = false;
    // Fall damage routed through the normal damage pipeline for consistent events.
    character.onFallDamage = (amount) => this.combat.applyDamage({
      target: character, attacker: null, amount, source: 'fall', armorPenetration: 1,
    });
  }

  /** Tops both teams up to `teamSize` with bots of assorted classes. */
  fillWithBots() {
    if (!this.fillBots) return;
    let nameIndex = 0;
    for (const teamId of [TeamId.TEAM_ONE, TeamId.TEAM_TWO]) {
      const current = this.teams.membersOf(teamId).length;
      for (let i = current; i < this.teamSize; i++) {
        const classId = CLASS_IDS[(nameIndex + i) % CLASS_IDS.length];
        const name = `${BOT_NAMES[nameIndex % BOT_NAMES.length]}${teamId === TeamId.TEAM_ONE ? '' : '.2'}`;
        nameIndex += 1;
        this.addBot({ name, classId, teamId });
      }
    }
  }

  /** Swaps the local player's dinosaur class (buy phase / warmup only). */
  setLocalPlayerClass(classId) {
    if (!this.localPlayer) return false;
    const phase = this.round.phase;
    if (phase !== RoundPhase.BUY && phase !== RoundPhase.WARMUP) return false;
    this.localPlayer.applyClass(classId);
    this.bus.emit(GameEvents.CHARACTER_CLASS_CHANGED, { character: this.localPlayer, classId });
    return true;
  }

  start() { this.round.start(); }

  // ---------------------------------------------------------------- tick ----
  /**
   * Advances the simulation by one fixed step.
   * Order matters: think -> act -> move -> resolve -> round rules.
   */
  tick(dt) {
    this.elapsed += dt;
    this.world.update(dt);

    // 1. Bots decide what they want to do this tick.
    for (const brain of this.bots.values()) brain.update(dt);

    // 2. Apply everyone's intent (identical path for players and bots).
    for (const character of this.world.characters) {
      this._applyIntent(character, dt);
    }

    // 3. Movement + timed state.
    const abilityContext = this._abilityContext();
    for (const character of this.world.characters) {
      character.movement.update(dt, this.world);
      character.effects.update(dt, abilityContext);
      character.abilities.update(dt, abilityContext);
      const weapon = character.inventory.activeWeapon;
      if (weapon) {
        const event = weapon.update(dt, { triggerHeld: character.intent.fire });
        if (event === 'reloadFinished') {
          this.bus.emit(GameEvents.WEAPON_RELOAD_FINISHED, { character, weapon });
        }
      }
    }

    // 4. Projectiles, then the round rules (which may end the round).
    this.combat.updateProjectiles(dt);
    this.round.update(dt);
  }

  _abilityContext() {
    return {
      bus: this.bus,
      time: this.world.time,
      random: this.random,
      world: this.world,
      combat: this.combat,
    };
  }

  /** Translates one character's intent into actions. */
  _applyIntent(character, dt) {
    const intent = character.intent;
    if (!character.health.alive) return;

    // Look direction is authoritative from the intent (mouse or bot aim).
    character.yaw = intent.yaw;
    character.pitch = intent.pitch;

    if (character.frozen) {
      intent.fire = false;
      intent.jump = false;
    }

    // Weapon switching
    if (intent.switchToSlot) {
      const slot = intent.switchToSlot;
      intent.switchToSlot = null;
      if (slot === WeaponSlot.GRENADE) {
        if (character.inventory.totalGrenades() > 0) character.inventory.activeSlot = WeaponSlot.GRENADE;
      } else if (character.inventory.equipSlot(slot)) {
        this.bus.emit(GameEvents.WEAPON_SWITCHED, {
          character, weapon: character.inventory.activeWeapon, slot,
        });
      }
    }

    if (intent.reload) {
      this.combat.startReload(character);
      intent.reload = false;
    }

    if (intent.useAbility != null) {
      const index = intent.useAbility;
      intent.useAbility = null;
      character.abilities.activate(index, this._abilityContext());
    }

    if (intent.throwGrenade) {
      intent.throwGrenade = false;
      this.combat.throwGrenade(character);
    }

    if (intent.drop) {
      intent.drop = false;
      if (character.inventory.hasBomb) this.bomb.drop(character);
    }

    if (intent.fire) this.combat.tryFire(character);

    // Bomb interactions are evaluated every tick so progress can be interrupted.
    this.bomb.handleUse(character, intent.use);
  }

  // ------------------------------------------------------------ snapshot ----
  /**
   * Read-only view of the whole game for UI and debugging.
   * Presentation layers should never reach into systems directly.
   */
  snapshot() {
    return {
      elapsed: this.elapsed,
      round: this.round.describe(),
      match: this.match.describe(),
      teams: this.teams.describe(),
      bomb: this.bomb.describe(),
      localPlayer: this.localPlayer ? this.localPlayer.describe() : null,
      localPlayerSide: this.localPlayer ? this.teams.sideOf(this.localPlayer.teamId) : null,
      characters: this.world.characters.map((c) => c.describe()),
      sides: { ATTACKERS: this.teams.teamIdOnSide(Side.ATTACKERS), DEFENDERS: this.teams.teamIdOnSide(Side.DEFENDERS) },
    };
  }
}
