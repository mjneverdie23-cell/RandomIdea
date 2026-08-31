# Raptor Strike - Modding & Development Handbook

Everything you need to change this prototype without rewriting it.

Each section names **exactly which file to open**, shows a **concrete example**, and
lists **what else (if anything) is affected**. If a section says "nothing else changes",
that is a promise the architecture is meant to keep - if you find otherwise, that's a bug.

---

## Table of contents

1. [Build & run](#1-build--run)
2. [Project structure](#2-project-structure)
3. [Architecture in one page](#3-architecture-in-one-page)
4. [Replacing capsule characters with dinosaur models](#4-replacing-capsule-characters-with-dinosaur-models)
5. [Character classes: add, remove, change](#5-character-classes-add-remove-change)
6. [Class stats](#6-class-stats)
7. [Adding a new dinosaur (end-to-end)](#7-adding-a-new-dinosaur-end-to-end)
8. [Abilities](#8-abilities)
9. [Weapons: creating and adding](#9-weapons-creating-and-adding)
10. [Weapon tuning: damage, fire rate, ammo, reload, range, recoil](#10-weapon-tuning-damage-fire-rate-ammo-reload-range-recoil)
11. [Shop items and prices](#11-shop-items-and-prices)
12. [Starting money and economy rewards](#12-starting-money-and-economy-rewards)
13. [Round settings](#13-round-settings)
14. [Win conditions](#14-win-conditions)
15. [Bomb: timer, plant, defuse](#15-bomb-timer-plant-defuse)
16. [Editing the map](#16-editing-the-map)
17. [Replacing primitive map objects with art](#17-replacing-primitive-map-objects-with-art)
18. [Adding bomb sites](#18-adding-bomb-sites)
19. [Adding a new map](#19-adding-a-new-map)
20. [Team rules](#20-team-rules)
21. [Changing the UI](#21-changing-the-ui)
22. [Sounds, music and VFX](#22-sounds-music-and-vfx)
23. [Bots](#23-bots)
24. [Input & controls](#24-input--controls)
25. [Events reference](#25-events-reference)
26. [Testing](#26-testing)
27. [Troubleshooting](#27-troubleshooting)

---

## 1. Build & run

There is **no build step and no install step**. The project is plain ES modules; three.js
is vendored at `vendor/three.module.js` (MIT, see `vendor/THREE_LICENSE.txt`).

```bash
npm start                 # http://localhost:5173  (tools/dev-server.js, zero dependencies)
npm start -- 8080         # different port
npm test                  # 86 headless tests, ~8 seconds
npm run sim               # simulate a whole bot-vs-bot match in the terminal
npm run sim -- --verbose  # ...with a kill feed and bomb events
npm run sim -- --seed 42  # a different (still deterministic) match
```

Any static file server works instead of `npm start` (e.g. `python3 -m http.server 5173`).
You must serve over HTTP - opening `index.html` from the filesystem breaks ES module imports.

**URL parameters** (`src/main.js`):

| Parameter | Example | Effect |
|---|---|---|
| `seed` | `?seed=7` | deterministic match seed |
| `map` | `?map=dust_proto` | pick a map from the registry |
| `name` | `?name=Rex` | your player name |
| `difficulty` | `?difficulty=hard` | bot difficulty (`easy`/`normal`/`hard`) |
| `debug` | `?debug=1` | on-screen fps, phase, position, bot goals |

**Switching to npm-installed three.js instead of the vendored copy:**
`npm i three`, then edit the import map in `index.html`:

```html
<script type="importmap">
  { "imports": { "three": "./node_modules/three/build/three.module.js" } }
</script>
```

**Controls:** WASD move, Space jump, Ctrl crouch, Shift sprint, LMB fire, RMB aim,
R reload, **E hold** to plant/defuse/pick up the bomb, 1/2/3/4 slots, V grenade,
Q/F abilities, B shop, Tab scoreboard, P overhead debug camera, Esc release mouse.

---

## 2. Project structure

```
index.html                      import map + canvas + #ui-root
vendor/three.module.js          vendored three.js (swap for npm if you prefer)

src/
  main.js                       composition root for the browser build
  config/                       ALL tunable data lives here - start here for balance changes
    gameplay.config.js          match, round, bomb, economy, combat, movement, sim constants
    classes.config.js           the five dinosaur classes
    weapons.config.js           every weapon + equipment item
    abilities.config.js         ability data + behaviour hooks
    shop.config.js              buy-menu layout and purchase rules
    bots.config.js              AI difficulty and behaviour tuning
    input.config.js             key bindings and mouse sensitivity
    audio.config.js             sound cue registry (placeholder tones)
    visuals.config.js           colours, camera, lighting, effect tuning
    maps/index.js               map registry
    maps/dust_proto.map.js      the prototype map (areas + props + spawns + sites)

  core/                         THE SIMULATION - no three.js, no DOM, runs in Node
    GameManager.js              composition root + fixed-step tick order
    entities/Character.js       a player/bot: transform + components
    components/                 Health, Inventory, MovementController,
                                EffectController, AbilityController, Intent
    weapons/                    Weapon (runtime state), WeaponFactory
    systems/                    CombatSystem, BombSystem, RoundManager, MatchManager,
                                TeamManager, EconomySystem, ShopSystem, SpawnSystem
    world/                      World (collision + raycasts), MapData, MapCompiler
    ai/                         BotBrain, NavGrid (A*)
    events/                     EventBus, GameEvents (the event catalogue)
    math/                       vec3, aabb, seeded Random

  render/                       three.js presentation layer (delete it and the game still runs)
    Renderer.js                 scene, lights, camera modes, per-frame sync
    ModelRegistry.js            *** THE MODEL SWAP POINT ***
    CharacterView.js            one visual per character + name/health tag
    MapView.js                  builds map meshes; prop model registry
    ViewModel.js                first-person weapon
    Effects.js                  tracers, impacts, explosions, bomb beacon

  ui/                           DOM HUD and overlays (+ styles.css)
  audio/AudioManager.js         WebAudio; synthesised placeholders
  platform/                     BrowserInput (keyboard/mouse -> Intent), GameLoop

tests/                          86 tests (node --test)
tools/dev-server.js             static server
tools/headless-match.js         full match simulation in the terminal
```

---

## 3. Architecture in one page

```
              input (keyboard/mouse)        BotBrain
                        \                    /
                         v                  v
                      +--------------------------+
                      |        Intent            |   one struct: move, look, fire, use...
                      +--------------------------+
                                   |
                                   v
   +-------------------------------------------------------------+
   |                      GameManager.tick(dt)                    |
   |  bots think -> apply intents -> movement -> systems -> round |
   +-------------------------------------------------------------+
        |            |             |            |            |
     World      CombatSystem   BombSystem   EconomySystem  RoundManager
   (collision,   (hitscan,     (plant/       (money)        (phases,
    raycasts)     damage)       defuse)                      win rules)
        \____________________ EventBus ______________________/
                                   |
                +------------------+------------------+
                v                  v                  v
            Renderer            HUD/UI            AudioManager
```

Rules the codebase follows - keep them and extensions stay cheap:

1. **`src/core` never imports three.js or touches the DOM.** That is why `npm run sim`
   can play a whole match in Node and why the tests are fast.
2. **Systems talk through `EventBus`,** not direct references. Economy does not know
   combat exists; it just listens for `CHARACTER_DIED`.
3. **Players and bots are identical downstream of `Intent`.** Anything a bot can do,
   a player can do.
4. **Data over code.** Weapons, classes, abilities, prices, the map and the round rules
   are objects in `src/config`, not `if` statements in systems.
5. **The renderer is a read-only consumer.** Views read simulation state; they never
   write to it.

---

## 4. Replacing capsule characters with dinosaur models

**File: `src/render/ModelRegistry.js`. This is the only file you need to touch.**

Each class declares a `visual.modelKey` in `src/config/classes.config.js`
(`dino_ankylo`, `dino_ptera`, `dino_raptor`, `dino_para`, `dino_rex`). The registry maps
that key to a factory. With no factory registered you get the placeholder capsule.

A model factory returns an object implementing this interface:

```js
{
  object3D,                 // THREE.Object3D, origin at the character's feet
  setPose?({ yaw, pitch, speed, crouching, airborne, aiming }),
  playAnimation?(name),     // 'idle' | 'run' | 'jump' | 'fire' | 'death'
  update?(dt),              // called every frame (drive your AnimationMixer here)
  setVisible?(v), setOpacity?(o), setTeamColor?(hex), dispose?(),
}
```

Concrete example - a GLTF raptor with animations:

```js
// src/render/ModelRegistry.js (bottom of the file)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

registerModel('dino_raptor', async ({ character, teamColor, THREE }) => {
  if (!cache.has('raptor')) cache.set('raptor', await loader.loadAsync('assets/models/raptor.glb'));
  const source = cache.get('raptor');
  const scene = source.scene.clone(true);
  scene.scale.setScalar(character.visual.scale);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = Object.fromEntries(source.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  let current = actions.idle?.play();

  return {
    object3D: scene,
    setPose({ yaw, speed, crouching }) {
      scene.rotation.y = yaw;                       // gameplay yaw drives the model
      const next = speed > 0.5 ? actions.run : actions.idle;
      if (next && next !== current) { current?.fadeOut(0.15); next.reset().fadeIn(0.15).play(); current = next; }
    },
    playAnimation(name) { actions[name]?.reset().play(); },
    update(dt) { mixer.update(dt); },
    setVisible(v) { scene.visible = v; },
    setOpacity(o) { scene.traverse((c) => { if (c.material) { c.material.transparent = o < 1; c.material.opacity = o; } }); },
    dispose() { mixer.stopAllAction(); },
  };
});
```

Notes:

- `createCharacterModel` is called synchronously by `CharacterView`. If your factory is
  `async`, either preload assets before the match (`await loader.loadAsync(...)` at module
  scope) or return a placeholder group immediately and `.add()` the loaded model into it
  when the promise resolves - the second pattern needs no other changes.
- **The hitbox does not come from the model.** It comes from
  `classes.config.js -> stats.hitboxRadius / hitboxHeight`. Match your model to those
  numbers (or change them - see §6) or players will shoot at air.
- Weapons work the same way: `registerWeaponModel('weapon_rifle', factory)`, keyed by
  `weapons.config.js -> visual.modelKey`.
- **No gameplay file changes.** `CharacterView`, `Renderer`, and all of `src/core` are untouched.

---

## 5. Character classes: add, remove, change

**File: `src/config/classes.config.js`.**

### Add a class

```js
export const ClassId = Object.freeze({
  TANK: 'TANK', SNIPER: 'SNIPER', ASSASSIN: 'ASSASSIN', RANGER: 'RANGER', BRUISER: 'BRUISER',
  SUPPORT: 'SUPPORT',                                  // <- 1. add the id
});

export const CLASS_DEFINITIONS = Object.freeze({
  /* ...existing classes... */
  [ClassId.SUPPORT]: {                                 // <- 2. add the definition
    id: ClassId.SUPPORT,
    displayName: 'Stego',
    species: 'Stegosaurus',
    role: 'Support',
    description: 'Heals and shields the team while holding an angle.',
    stats: {
      maxHealth: 115, maxArmor: 100, startingArmor: 10, hasHelmetByDefault: false,
      moveSpeed: 5.3, jumpVelocity: 6.9,
      damageTakenMultiplier: 0.95, damageDealtMultiplier: 0.95,
      hitboxRadius: 0.55, hitboxHeight: 1.88, eyeHeightFraction: 0.87,
    },
    allowedCategories: ['PISTOL', 'SMG', 'RIFLE', 'MELEE', 'EQUIPMENT'],
    defaultLoadout: { primary: null, secondary: 'pistol_scav', melee: 'melee_claws' },
    abilities: ['ability_field_dressing', 'ability_echo_call'],
    visual: { modelKey: 'dino_stego', color: 0x6f9f4f, scale: 1.05 },
    botPreference: { buyPriority: ['rifle_apex', 'smg_swarm'] },
  },
});
```

That is the whole job. `CLASS_IDS` is derived from the object, so the new class
automatically appears in the class-select UI, gets its own shop filtered by
`allowedCategories`, and enters the bot class rotation.

### Remove a class

Delete its entry (and its `ClassId` key). Check nothing else references the id:

```bash
grep -rn "ASSASSIN" src/ tests/
```

`DEFAULT_CLASS_ID` and `GameManager`'s `playerClassId` default must point at a class
that still exists.

### Change which weapons a class may buy

Edit `allowedCategories` (categories come from `WeaponCategory` in `weapons.config.js`).
For per-weapon control, set `allowedClasses` on the weapon itself:

```js
sniper_longneck: W({ /* ... */ allowedClasses: ['SNIPER'] }),   // only snipers, ever
```

---

## 6. Class stats

**File: `src/config/classes.config.js` -> `CLASS_DEFINITIONS[<id>].stats`.**

| Field | Meaning | Read by |
|---|---|---|
| `maxHealth` | hit points | `Health` |
| `maxArmor` / `startingArmor` | armour cap / free armour each round | `Health` |
| `hasHelmetByDefault` | free helmet | `Health` |
| `moveSpeed` | base walk speed (world units/s) | `MovementController.targetSpeed()` |
| `jumpVelocity` | jump impulse | `MovementController` |
| `damageTakenMultiplier` | <1 = tanky | `CombatSystem.applyDamage` |
| `damageDealtMultiplier` | >1 = hits harder | `CombatSystem.applyDamage` |
| `hitboxRadius` / `hitboxHeight` | the capsule people shoot at | `World`, `CharacterView` |
| `eyeHeightFraction` | camera height as a fraction of hitbox height | `Character.eyeHeight` |

Example - make the Tank slower but tougher:

```js
[ClassId.TANK]: { stats: { maxHealth: 175, moveSpeed: 4.2, damageTakenMultiplier: 0.75, /* ... */ } }
```

Global movement feel (acceleration, friction, gravity, sprint/crouch multipliers, step
height, fall damage) lives in `MovementConfig` in `src/config/gameplay.config.js` and
applies to every class.

Changes take effect on the next `applyClass()` - i.e. next round or next match. Verify with:

```bash
npm test -- # tests/classes.test.js asserts stats reach the character
```

---

## 7. Adding a new dinosaur (end-to-end)

The full checklist for "a new playable dinosaur":

1. **Class data** - add an entry to `CLASS_DEFINITIONS` (§5) with a unique `visual.modelKey`.
2. **Abilities** - either reuse existing ability ids or add new ones (§8).
3. **Model** - register a factory for the `modelKey` in `src/render/ModelRegistry.js` (§4).
   Skip this and it uses a coloured capsule, which is fine for prototyping.
4. **Weapons** - set `allowedCategories`, and add class-specific guns if wanted (§9).
5. **Bot support** - set `botPreference.buyPriority` so bots buy sensibly. Nothing else:
   bots handle any class automatically.
6. **Audio/VFX (optional)** - add cues in `audio.config.js` and play them from an event.

No system file changes at any step.

---

## 8. Abilities

**File: `src/config/abilities.config.js`.**

An ability is data plus two optional hooks. It receives a sandboxed context - it can query
the world, deal damage, and apply effects, and nothing else:

```js
ctx = {
  character,                                  // the user
  time,                                       // simulation seconds
  bus,                                        // EventBus
  world: { charactersWithin(pos, radius, { team, enemyOf, aliveOnly }), hasLineOfSight(a, b) },
  combat: { applyDamage({ target, attacker, amount, source }) },
  random,                                     // seeded RNG - never use Math.random()
}
```

Example - a smoke-like blind that slows and blurs enemies near a point:

```js
ability_ash_cloud: {
  id: 'ability_ash_cloud',
  displayName: 'Ash Cloud',
  description: 'Kick up ash: enemies nearby are slowed and cannot sprint for 5s.',
  cooldown: 28,
  duration: 5,
  radius: 9,
  onActivate(ctx) {
    const def = ABILITY_DEFINITIONS.ability_ash_cloud;
    for (const enemy of ctx.world.charactersWithin(ctx.character.position, def.radius, {
      enemyOf: ctx.character, aliveOnly: true,
    })) {
      enemy.effects.add({
        id: 'ash_blind',
        duration: def.duration,
        modifiers: { speedMultiplier: 0.55, spreadMultiplier: 2.5 },
        visual: 'ash',
      });
    }
  },
  onEnd(ctx) { /* optional cleanup when the duration elapses */ },
}
```

Then list it on a class: `abilities: ['ability_ash_cloud', 'ability_pounce']`.
Slot order = key order: **first = Q, second = F** (rebind in `input.config.js`).

**Available effect modifiers** (`src/core/components/EffectController.js`): `speedMultiplier`,
`damageTakenMultiplier`, `damageDealtMultiplier`, `spreadMultiplier`, `gravityMultiplier`,
`invisible`. To add a new modifier: add it to `NEUTRAL`, fold it in `_recompute()`, and read
it where it matters (e.g. `MovementController.targetSpeed()`).

Extra hooks available on an effect: `onTick(character, dt, ctx)` (see `ability_charge` for a
per-tick trample) and `breakOnFire: true` (see `ability_camouflage`).

Abilities can also be *instant* (`duration: 0`) or *charge-limited* (`chargesPerRound: 1`).

---

## 9. Weapons: creating and adding

**File: `src/config/weapons.config.js`.** Weapons are data; there is no weapon subclassing.

```js
export const WEAPON_DEFINITIONS = Object.freeze({
  /* ...existing... */
  rifle_thagomizer: W({                       // W() merges WEAPON_DEFAULTS for you
    id: 'rifle_thagomizer',                   // must equal the key
    displayName: 'Thagomizer AR',
    category: WeaponCategory.RIFLE,           // gates which classes may buy it
    slot: WeaponSlot.PRIMARY,                 // primary | secondary | melee | grenade
    fireMode: FireMode.AUTO,                  // AUTO | SEMI | BURST | MELEE | THROWN
    price: 3100,
    damage: 36, headshotMultiplier: 4.0, armorPenetration: 0.8,
    fireRate: 600, magSize: 25, reserveAmmo: 75, reloadTime: 2.6, equipTime: 0.8,
    range: 110, falloffStart: 50, falloffEnd: 95, falloffMinMultiplier: 0.6,
    moveSpeedMultiplier: 0.94, killReward: 300,
    spread:  { base: 0.5, moving: 3.8, jumping: 6.5, crouching: -0.3, ads: -0.4 },
    recoil:  { vertical: 0.6, horizontal: 0.25, recovery: 6.5, recoveryDelay: 0.22, maxVertical: 10 },
    visual:  { modelKey: 'weapon_rifle', color: 0x5a6b52 },
    allowedClasses: null,                     // null = any class whose categories allow it
  }),
});
```

Then make it purchasable - `src/config/shop.config.js`:

```js
{ id: 'RIFLE', displayName: 'Rifles', items: ['rifle_apex', 'rifle_bulwark', 'rifle_ranger', 'rifle_thagomizer'] },
```

That's it. `WeaponFactory` instantiates it, the shop lists it for every class with
`RIFLE` in `allowedCategories`, and `tests/weapons.test.js` validates it on the next run.

**Equipment** (non-shooting items) goes in `EQUIPMENT_DEFINITIONS` in the same file, with an
`apply(character)` and an optional `canBuy(character)`:

```js
eq_stim: {
  id: 'eq_stim', displayName: 'Adrenal Gland', category: WeaponCategory.EQUIPMENT,
  price: 500, description: 'Move 20% faster for 12 seconds after the round starts.',
  apply: (character) => character.effects.add({ id: 'stim', duration: 12, modifiers: { speedMultiplier: 1.2 } }),
  canBuy: (character) => !character.effects.has('stim'),
  sideRestriction: 'ATTACKERS',              // optional: ATTACKERS | DEFENDERS
},
```

**Throwables** need a `grenade` block (see `eq_frag`): `fuseTime`, `damage`, `radius`,
`minDamageFraction`, `throwSpeed`, `gravityScale`, `bounce`, `killReward`.

---

## 10. Weapon tuning: damage, fire rate, ammo, reload, range, recoil

All in `src/config/weapons.config.js`. Defaults for every field live in `WEAPON_DEFAULTS`
at the top - change one there and every weapon that doesn't override it follows.

| Want to change | Field(s) | Notes |
|---|---|---|
| Damage | `damage` | before falloff/zone multipliers |
| Headshot damage | `headshotMultiplier` | `HEAD` zone only |
| Armour effectiveness | `armorPenetration` | 0..1, fraction bypassing armour |
| Fire rate | `fireRate` | rounds per minute |
| Burst behaviour | `burstCount`, `burstDelay` | with `fireMode: BURST` |
| Magazine / reserve | `magSize`, `reserveAmmo` | `Infinity` = never reload (melee) |
| Reload time | `reloadTime` | seconds |
| Draw time | `equipTime` | cannot fire while drawing |
| Max range | `range` | rays stop here |
| Damage falloff | `falloffStart`, `falloffEnd`, `falloffMinMultiplier` | linear between start and end |
| Hip/moving accuracy | `spread.base`, `spread.moving`, `spread.jumping` | degrees of cone |
| Crouch/ADS accuracy | `spread.crouching`, `spread.ads` | **added**, so negative = tighter |
| Recoil climb | `recoil.vertical`, `recoil.horizontal`, `recoil.maxVertical` | degrees per shot |
| Recoil recovery | `recoil.recovery`, `recoil.recoveryDelay` | recovery starts `recoveryDelay` after the last shot |
| Shotgun pellets | `pellets` | each pellet is a separate ray |
| Scope | `adsZoom`, `adsTime` | FOV divisor; `>= 2` also hides the crosshair |
| Carry speed | `moveSpeedMultiplier` | multiplies class `moveSpeed` |
| Kill money | `killReward` | paid by `EconomySystem` |

Damage actually applied is:

```
damage
  x range falloff                       (CombatSystem._falloffMultiplier)
  x hit-zone multiplier                 (CombatConfig.hitZones, gameplay.config.js)
  x weapon headshotMultiplier           (head only)
  x attacker damageDealtMultiplier      (class + active effects)
  x target damageTakenMultiplier        (class + active effects)
  -> armour model                       (Health.takeDamage, armorPenetration)
```

Hit zones and their sizes are in `CombatConfig` (`headZoneFraction`, `stomachZoneFraction`,
`legsZoneFraction`) in `src/config/gameplay.config.js`.

---

## 11. Shop items and prices

- **Price**: on the item itself in `weapons.config.js` (`price:`). One number, one place.
- **Which items appear and in what order**: `SHOP_CATEGORIES` in `src/config/shop.config.js`.
- **Purchase rules**: `ShopConfig` in the same file.

```js
export const ShopConfig = Object.freeze({
  allowedPhases: ['BUY', 'WARMUP'],  // add 'LIVE' for buy-anytime
  requireSpawnZone: true,            // false = buy anywhere on the map
  refundWindow: 0,
  dropWeaponOnDeath: true,
});
```

Rejections are reported with a reason code (`PurchaseRejection` in
`src/core/systems/ShopSystem.js`): `WRONG_PHASE`, `NOT_IN_BUY_ZONE`, `NOT_ENOUGH_MONEY`,
`CLASS_RESTRICTED`, `SIDE_RESTRICTED`, `ALREADY_OWNED`, `UNKNOWN_ITEM`, `DEAD`. The buy
menu greys items out and shows the reason as a tooltip; items a class can *never* use are
hidden entirely.

To change how the menu *looks*, edit `src/ui/ShopUI.js` and the `#shop` rules in
`src/ui/styles.css`.

---

## 12. Starting money and economy rewards

**File: `src/config/gameplay.config.js` -> `EconomyConfig`.**

```js
export const EconomyConfig = Object.freeze({
  startingMoney: 800,          // per player at match start and after the side switch
  maxMoney: 16000,
  resetOnSideSwitch: true,     // false = carry money into the second half

  roundWinReward: 3250,
  bombDetonatedBonus: 300,     // on top of the win reward
  bombDefusedBonus: 300,

  lossBonusBase: 1400,         // 1st loss
  lossBonusIncrement: 500,     // per additional consecutive loss
  lossBonusMax: 3400,
  lossWithPlantBonus: 800,     // lost the round but planted

  plantReward: 300,            // to the planter
  defuseReward: 300,           // to the defuser
  teamKillPenalty: -300,
  suicidePenalty: -300,
});
```

Per-kill money is the **weapon's** `killReward` (`weapons.config.js`) - that is how a
knife kill can pay 1200 while an AWP kill pays 100.

`tests/economy.test.js` covers every one of these numbers; run `npm test` after edits.

---

## 13. Round settings

**File: `src/config/gameplay.config.js` -> `RoundConfig`.**

```js
export const RoundConfig = Object.freeze({
  warmupDuration: 6,        // free roam before round 1
  buyDuration: 15,          // freeze time; players rooted, shop open
  roundDuration: 115,       // live time before defenders win on the clock
  roundEndDuration: 5,      // pause between rounds
  buyGraceDuration: 0,
  respawnDuringWarmup: true,
  warmupRespawnDelay: 3,
});
```

The state machine is `src/core/systems/RoundManager.js`:

```
WARMUP -> BUY -> LIVE -> ROUND_END -> BUY (next round) ... -> MATCH_END
```

- **Freeze time**: `_enterPhase(BUY)` sets `character.frozen = true` and
  `combat.combatEnabled = false`.
- **Skipping a phase** (a "ready up" button, or tests): `game.round.skipPhase()`.
- **Pausing** (debugging): `game.round.paused = true`.
- **Adding a phase**: add it to `RoundPhase` in the config, handle it in `update()` and
  `_enterPhase()`. The UI reads `game.round.phase` and will show the raw name until you add
  a label in `phaseLabel()` in `src/ui/HUD.js`.

---

## 14. Win conditions

**File: `src/config/gameplay.config.js` -> `MatchConfig`.**

```js
export const MatchConfig = Object.freeze({
  roundsToWin: 13,             // first team to this many round wins takes the match
  switchSidesAfterRound: 12,   // sides swap once this many rounds are complete
  maxRounds: 24,               // regulation cap (2 x switchSidesAfterRound)
  overtime: { enabled: false, roundsPerHalf: 3, startingMoney: 12500 },
  teamSize: 5,
});
```

Examples:

- **Short scrim (first to 5, switch at 4):** `{ roundsToWin: 5, switchSidesAfterRound: 4, maxRounds: 8 }`
- **MR15 (first to 16, switch at 15):** `{ roundsToWin: 16, switchSidesAfterRound: 15, maxRounds: 30 }`
- **Enable overtime instead of draws:** `overtime.enabled: true` - sides then switch every
  `roundsPerHalf` overtime rounds and everyone gets `overtime.startingMoney`.

**Round** win conditions live in `RoundManager` and are deliberately explicit:

| Condition | Winner | Implemented in |
|---|---|---|
| Bomb detonates | attackers | `_onBombExploded` |
| Bomb defused | defenders | `_onBombDefused` |
| All defenders dead | attackers | `_checkElimination` |
| All attackers dead **and bomb not planted** | defenders | `_checkElimination` |
| Round timer expires with no plant | defenders | `_updateLive` |

Note the deliberate CS rule: once the bomb is planted, wiping the attackers does **not**
end the round - the defenders must defuse. Change that by removing the `!this.bomb.isPlanted`
guard in `_checkElimination`.

---

## 15. Bomb: timer, plant, defuse

**File: `src/config/gameplay.config.js` -> `BombConfig`.**

```js
export const BombConfig = Object.freeze({
  fuseDuration: 40,               // plant -> detonation
  plantDuration: 3.2,             // uninterrupted hold to plant
  defuseDuration: 10,             // without a kit
  defuseDurationWithKit: 5,       // with eq_defuser
  plantMaxHeightAboveSite: 2.5,   // stops planting on top of tall cover
  interactRadius: 2.2,            // defuse/interact distance
  explosionRadius: 28,
  explosionDamage: 500,
  explosionMinDamageFraction: 0.15,
  carrierSide: Side.ATTACKERS,
  pickupRadius: 1.8,
});
```

Behaviour lives in `src/core/systems/BombSystem.js` (state machine:
`CARRIED -> DROPPED/PLANTED -> DEFUSED/EXPLODED`). It emits events and never decides who
wins - `RoundManager` does that.

Common tweaks:

- **Plant anywhere (no sites):** make `siteAt()` return a dummy site.
- **Require standing still to plant:** in `update()`, add
  `if (character.movement.horizontalSpeed > 0.5) this.cancelPlant();`
- **Defuse without a kit only within the last 10s:** guard inside `canDefuse()`.
- **The bomb never drops:** remove the `_onCharacterDied` -> `drop()` call.

The HUD's plant/defuse prompt and progress bar come from `bomb.canPlant/canDefuse/
plantProgress/defuseProgress` in `src/ui/HUD.js -> _updateInteraction`.

---

## 16. Editing the map

**File: `src/config/maps/dust_proto.map.js`.**

The map is authored as **walkable rectangles** ("areas") plus **props**. `MapCompiler`
(`src/core/world/MapCompiler.js`) rasterises the areas on a grid, turns all the *non*-walkable
space into merged wall boxes, and builds the bot navigation grid. **You never place a wall
by hand, and you cannot leave an accidental hole between two rooms.**

Orientation: `+Z` is north (defender side), `-Z` south (attacker side), `+X` east (A side),
`-X` west (B side), `Y` up, floor at 0. Rectangles are `[x0, z0, x1, z1]`.

### Add a room or corridor

```js
area('A_BALCONY', [58, 24, 70, 40], { label: 'A Balcony' }),
```

Two areas connect wherever their rectangles **touch or overlap**. `A_BALCONY` starts at
x=58, which is where `A_SITE` ends, so they are connected. Walls are regenerated around it
automatically.

### Add cover

```js
box('a_balcony_crate', { at: [64, 32], size: [3, 2.2, 3], color: 0xa8792f }),
cylinder('a_balcony_pillar', { at: [60, 36], radius: 1.1, height: 5 }),
...stairs('a_balcony_steps', { at: [58, 22], width: 5, length: 3, height: 1.2, steps: 3, direction: '+z' }),
```

- `at` is the **footprint centre** `[x, z]`; `size` is `[width, height, depth]`; `y` is the base (default 0).
- Props taller than **1.4** units block bot navigation by default. Override with `blocksNav: false`
  (do this for platforms and low crates bots should walk over) or `blocksNav: true`.
- `stairs(...)` returns an **array**, so spread it: `...stairs(...)`.
- Anything a character can step onto must rise in increments under
  `MovementConfig.stepHeight` (0.6) - that is what `stairs()` guarantees.

### Move spawns / buy zones

```js
spawns: {
  ATTACKERS: [spawn([-16, -66], Math.PI), /* ... */],   // yaw: PI faces north, 0 faces south
  DEFENDERS: [spawn([-10, 68], 0), /* ... */],
},
buyZones: { ATTACKERS: [-30, -72, 30, -56], DEFENDERS: [-14, 56, 14, 72] },
```

Give each side at least `MatchConfig.teamSize` spawn points; extras are scattered nearby.

### Verify your edit

```bash
npm test -- # tests/map.test.js flood-fills the nav grid and fails on unreachable pockets
```

`tests/map.test.js` checks: everything is reachable, every spawn is walkable and inside its
buy zone, and both bomb sites are pathable from both spawns. Then look at it in-game and
press **P** for the overhead camera.

Map-level knobs: `cellSize` (grid resolution, default 2 - lower it for finer walls at the
cost of more boxes), `wallHeight`, `padding`, `wallColor`, `floorColor`, `skyColor`, `fogDensity`.

---

## 17. Replacing primitive map objects with art

**File: `src/render/MapView.js`.** Two options:

**A. Change how all primitives look** - edit `createSolidMesh(solid)`:

```js
createSolidMesh(solid) {
  const material = this._material(solid.color, { map: this.crateTexture });
  /* ...your geometry... */
}
```

**B. Give one prop (or one prop kind) a real model** - register a factory:

```js
// anywhere that runs before the Renderer is constructed (e.g. top of src/main.js)
import { registerPropModel } from './render/MapView.js';
import { PropKind } from './core/world/MapData.js';

registerPropModel('a_platform', ({ solid, THREE }) => {
  const mesh = crateModel.clone();          // your loaded GLTF
  mesh.scale.set(solid.size.x, solid.size.y, solid.size.z);
  return mesh;
});
registerPropModel(PropKind.PILLAR, ({ solid, THREE }) => pillarModel.clone());
```

The key is the prop `id` (exact match wins) or its `kind`
(`WALL`, `COVER`, `PLATFORM`, `STAIRS`, `PILLAR`, `DECOR`).

**Collision does not change.** Physics always uses the authored box/cylinder bounds, so a
prettier crate never becomes a different obstacle. If you want art that is *not* solid, set
`collidable: false` on the prop (it is then purely decorative).

---

## 18. Adding bomb sites

**File: `src/config/maps/<map>.map.js`.**

```js
bombSites: [
  bombSite('A', [34, 28, 52, 42], { label: 'Bomb Site A', plantPoint: { x: 42, y: 0, z: 32 } }),
  bombSite('B', [-52, 28, -34, 42], { label: 'Bomb Site B', plantPoint: { x: -42, y: 0, z: 32 } }),
  bombSite('C', [-9, -46, 9, -30], { label: 'Bomb Site C', plantPoint: { x: 0, y: 0, z: -38 } }),
],
```

- `rect` is the plantable footprint; it must sit inside walkable areas.
- `plantPoint` is where bots head to plant (defaults to the rect centre) - make sure it is
  not inside a prop.
- Everything adapts automatically: `BombSystem.siteAt()` scans all sites, the HUD prints
  whichever `siteId` was planted, `MapView` draws a marker and a floor letter, and bots
  distribute across sites (`BotBrain._planRound` picks uniformly for 3+ sites; for exactly
  two it uses `BotConfig.siteBPreference`).
- Removing a site is just deleting its entry - a one-site map works fine.

---

## 19. Adding a new map

1. Copy `src/config/maps/dust_proto.map.js` to `src/config/maps/my_map.map.js`.
2. Change `id` and `displayName`, then edit areas/props/spawns/sites (§16).
3. Register it in `src/config/maps/index.js`:

```js
import MyMap from './my_map.map.js';
export const MAPS = Object.freeze({ [DustProtoMap.id]: DustProtoMap, [MyMap.id]: MyMap });
```

4. Play it: `http://localhost:5173/?map=my_map`, or `new GameManager({ mapId: 'my_map' })`.
5. Point `tests/map.test.js` at it (or parameterise the test over `listMaps()`) to get
   connectivity checks for free.

---

## 20. Team rules

**Files: `src/config/gameplay.config.js` (ids and sides) and
`src/core/systems/TeamManager.js` (behaviour).**

The important distinction: a **team** (`TEAM_ONE`, `TEAM_TWO`) is permanent and owns the
score; a **side** (`ATTACKERS`, `DEFENDERS`) is a role that swaps at halftime. Never assume
"team one attacks" - ask `teams.sideOf(teamId)`.

Common changes:

```js
// Team names (src/core/GameManager.js, where TeamManager is constructed)
new TeamManager({ bus: this.bus, names: { TEAM_ONE: 'Sauropods', TEAM_TWO: 'Theropods' } })

// Team size (src/config/gameplay.config.js)
MatchConfig.teamSize = 3;

// Friendly fire (src/config/gameplay.config.js -> CombatConfig)
friendlyFire: true, friendlyFireMultiplier: 0.35,
```

Adding a **third team** would need more: `TeamManager` assumes two teams in `switchSides()`
and `MatchManager` compares two scores. The rest (spawns, sides, rounds) is already keyed by
id, so it is contained work.

Team colours are `VisualsConfig.teamColors` in `src/config/visuals.config.js`.

---

## 21. Changing the UI

| Element | File |
|---|---|
| HUD (health, armour, ammo, money, timer, score, objective, killfeed, crosshair, banners) | `src/ui/HUD.js` |
| Buy menu | `src/ui/ShopUI.js` |
| Scoreboard (Tab) | `src/ui/Scoreboard.js` |
| Class picker | `src/ui/ClassSelectUI.js` |
| Start screen / match-end screen | `src/ui/Overlays.js` |
| All styling | `src/ui/styles.css` |

The HUD builds its DOM from the `TEMPLATE` string at the bottom of `HUD.js` and refreshes
it in `update(dt)`. To add a widget:

```js
// 1. add markup to TEMPLATE
<div class="hud-panel" id="hud-streak"><span class="value">0</span><span class="label">STREAK</span></div>

// 2. update it in update(dt)
this.$('#hud-streak .value').textContent = this.game.localPlayer.score.kills;

// 3. style it in styles.css
#hud-streak { position: absolute; right: 18px; top: 120px; }
```

The UI is a **read-only consumer**: it reads `game.localPlayer`, `game.round`, `game.bomb`,
`game.teams`, `game.match` and listens to events. Never mutate simulation state from the UI -
route it through an intent or a system call (the shop's `game.shop.buy(...)` is the model).

For a machine-readable snapshot (useful for a different UI framework, or for a spectator
view) call `game.snapshot()`.

Colours/theme: the CSS custom properties at the top of `styles.css`.

---

## 22. Sounds, music and VFX

### Sound

**File: `src/config/audio.config.js`.** The prototype ships **no audio files** - every cue is
a synthesised tone. Replace one by giving it a `src`:

```js
'weapon.fire.RIFLE': { src: 'assets/audio/rifle_fire.ogg', category: 'sfx', volume: 0.4 },
```

Files are preloaded and decoded on `AudioManager.unlock()` (first click). Cue ids are looked
up by name; weapon fire uses `weapon.fire.<CATEGORY>`, so a new weapon category needs a new
cue - a missing cue logs one warning and is silent, it never throws.

Add a *new* cue and play it from an event - `src/audio/AudioManager.js -> _bindEvents`:

```js
bus.on(GameEvents.ABILITY_USED, ({ character, abilityId }) =>
  this.play(`ability.${abilityId}`, { position: character.position }));
```

Music: `AudioConfig.music = { enabled: true, src: 'assets/audio/theme.ogg', volume: 0.3 }`
(hook it up in `unlock()` - one `createBufferSource` with `loop = true`).

Positional audio here is a simple distance attenuation (`_distanceAttenuation`). For real 3D
audio, swap the gain node for a `PannerNode` - the call sites already pass `position`.

### VFX

**File: `src/render/Effects.js`.** Tracers, impacts, muzzle flashes, explosions, the bomb
beacon and grenade meshes all live here, all driven by events. Tuning is in
`VisualsConfig.effects` (`src/config/visuals.config.js`).

Add an effect:

```js
// in the constructor's subscription list
bus.on(GameEvents.ABILITY_USED, ({ character, abilityId }) => {
  if (abilityId === 'ability_roar') this.spawnExplosion(character.position, 14);
});
```

Because effects are event-driven, **no gameplay system needs to know they exist**. The same
applies to a particle library: import it in `Effects.js` and nowhere else.

---

## 23. Bots

**Files: `src/config/bots.config.js` (tuning), `src/core/ai/BotBrain.js` (behaviour),
`src/core/ai/NavGrid.js` (A* pathfinding).**

```js
export const BotConfig = Object.freeze({
  enabled: true,
  fillTeams: true,                    // top both teams up to MatchConfig.teamSize
  defaultDifficulty: 'NORMAL',
  difficulties: {
    EASY:   { aimTurnRate: 2.2, aimError: 4.5, reactionTime: 0.55, viewDistance: 55, /* ... */ },
    NORMAL: { aimTurnRate: 4.5, aimError: 2.2, reactionTime: 0.3,  viewDistance: 75, /* ... */ },
    HARD:   { aimTurnRate: 7.5, aimError: 1.1, reactionTime: 0.16, viewDistance: 95, /* ... */ },
  },
  fieldOfView: Math.PI * 0.75,
  targetMemory: 2.5, waypointRadius: 2.5, siteBPreference: 0.5,
  saveThreshold: 1500, thinkInterval: 0.25, combatStrafe: 0.8,
});
```

### Add / remove bots

```js
// bots off entirely
new GameManager({ fillBots: false });

// a specific bot
game.addBot({ name: 'Spike', classId: 'TANK', teamId: 'TEAM_TWO', difficulty: 'HARD' });

// a new difficulty tier
difficulties: { NIGHTMARE: { aimTurnRate: 12, aimError: 0.4, reactionTime: 0.08, viewDistance: 120, fireBurstMin: 0.4, fireBurstMax: 1.2, accuracyMoving: 0.95 } }
```

Bot names come from `BOT_NAMES` in `src/core/GameManager.js`; classes are cycled from `CLASS_IDS`.

### Add a behaviour

Goals are in `BotGoal` (`BotBrain.js`); the decision is `_chooseGoal()`, movement is
`_updateMovement()`, shooting is `_updateCombat()`. Example - defenders rotate to a teammate
who called for help:

```js
// in _chooseGoal(), defenders branch
const ally = this.teams.membersOnSide(Side.DEFENDERS, { aliveOnly: true })
  .find((mate) => mate !== me && this.world.time - mate.lastDamageTime < 2);
if (ally) { goal = BotGoal.RETAKE; goalPosition = this._positionNear(ally.position, 6); }
```

Bots use abilities by setting `intent.useAbility = 0 | 1` - the same path a player uses.
They currently do not; adding it is a couple of lines in `_updateCombat`.

**Bots need no navigation authoring.** `NavGrid` runs A* on the grid `MapCompiler` produced,
so they path correctly on any map you draw.

---

## 24. Input & controls

**File: `src/config/input.config.js`.** Keys are `KeyboardEvent.code` values (layout independent).

```js
bindings: { jump: ['Space'], crouch: ['ControlLeft', 'KeyC'], use: ['KeyE'], /* ... */ },
mouse: { sensitivity: 0.0022, adsSensitivityMultiplier: 0.6, invertY: false, fireButton: 0, aimButton: 2 },
pitchLimit: Math.PI / 2 - 0.05,
```

Multiple codes per action are alternatives. The HUD prints key hints from these bindings, so
a rebind updates the prompts too.

To add an action: add a binding, handle it in `BrowserInput._handleActionKey` (one-shot) or
`update()` (held), and add the field to `createIntent()` in
`src/core/components/Intent.js` so bots can express it as well.

**Adding a gamepad or a network client** means writing another producer of `Intent` - nothing
in `src/core` changes.

---

## 25. Events reference

**File: `src/core/events/GameEvents.js`** - the full catalogue, with payloads documented
inline. Subscribe from anywhere:

```js
game.bus.on(GameEvents.BOMB_PLANTED, ({ character, siteId, position }) => { /* ... */ });
const off = game.bus.onAny((name, payload) => console.log(name, payload));  // debug firehose
game.bus.debug = true;                                                      // log everything
```

Groups: match/round lifecycle, characters, weapons/combat, abilities, economy/shop, bomb,
and presentation hooks (`NOTIFICATION`, `KILL_FEED`).

This is the seam to use for anything additive - stats tracking, a demo recorder, an
achievement system, a spectator overlay - without touching gameplay code.

---

## 26. Testing

```bash
npm test              # everything (86 tests, ~8s)
npm run test:watch    # re-run on save
node --test tests/bomb.test.js
npm run sim -- --seed 3 --verbose   # eyeball a whole match
```

| File | Covers |
|---|---|
| `tests/map.test.js` | compilation, full connectivity, spawns, site pathing |
| `tests/movement.test.js` | gravity, walls, step-up, crouch, jump, bounds |
| `tests/weapons.test.js` | definitions, fire modes, fire rate, reload, recoil, spread, switching |
| `tests/combat.test.js` | damage model, headshots, armour, falloff, LOS, grenades |
| `tests/economy.test.js` | starting money, kill rewards, win/loss bonuses, cap |
| `tests/shop.test.js` | phase/zone/class/side restrictions, equipment |
| `tests/bomb.test.js` | plant, interrupt, fuse, defuse (+kit), drop/pickup, both sites |
| `tests/round.test.js` | phase machine, freeze, all five win conditions, round reset |
| `tests/match.test.js` | scoring, side switch at 12, match win at 13, halftime reset |
| `tests/classes.test.js` | class data integrity, stats, abilities, effects |
| `tests/bots.test.js` | buying, pathing, fighting, a full match, determinism |

Helpers in `tests/helpers.js`: `createTestGame`, `advance`, `advanceUntil`,
`startLiveRound`, `pauseRounds`, `place`, `aimAt`, `collectEvents`.

**Matches are deterministic per seed** (`Random` in `src/core/math/random.js`) - never call
`Math.random()` inside `src/core` or you lose reproducibility.

---

## 27. Troubleshooting

**Blank page / "Failed to resolve module specifier 'three'"**
You opened `index.html` from the filesystem. Serve it: `npm start`. Check the import map in
`index.html` points at an existing `vendor/three.module.js`.

**Black screen, no errors**
The canvas has zero size (a CSS regression), or the camera is inside a wall. Press **P** for
the overhead camera and add `?debug=1` to see position and phase.

**"Cannot find module '/…/tests'" when running tests**
Use the quoted glob: `node --test "tests/*.test.js"` (that is what `npm test` does).

**Mouse look does nothing**
Pointer lock is not held. Click the canvas. Overlays (shop, class select) intentionally
release it - Esc closes them.

**I fall through the floor / get stuck in a wall**
A prop was authored overlapping a wall, or a spawn point sits inside geometry.
`World.findFreePositionNear` recovers spawns; run `npm test` - `tests/map.test.js` fails on
unwalkable spawns. Adjust the prop's `at`/`size` in the map file.

**Bots stand still or bunch up in spawn**
Their goal is unreachable: a nav-blocking prop is covering a `plantPoint` or a corridor.
Set `blocksNav: false` on walkable-over props, or move the prop. `?debug=1` prints each
bot's goal; `tests/map.test.js` proves the sites are pathable.

**Bots never plant**
The bomb carrier died and nobody picked it up (check `game.bomb.state`), or the site's
`plantPoint` is inside a prop, or `plantMaxHeightAboveSite` is too small for a raised site.

**Shots pass through enemies**
`hitboxRadius`/`hitboxHeight` in the class config no longer match your model. Collision uses
the *config*, not the mesh.

**A weapon fires far too fast/slow**
`fireRate` is **rounds per minute**, not per second.

**Recoil does nothing**
`recoil.recovery` is high relative to `recoil.vertical`, or `recoveryDelay` is 0 - recovery
only starts `recoveryDelay` seconds after the last shot and never while the trigger is held.

**Nothing happens when I buy**
You are outside the buy phase or outside your spawn zone. The rejection reason is shown in
the HUD banner and returned by `game.shop.buy()`; see `PurchaseRejection`.

**Round never ends**
A team has an alive member you did not expect (`game.teams.aliveCount(id)`), or
`game.round.paused` is still true from a debugging session.

**The match ends too early/late**
`MatchConfig.roundsToWin` vs `switchSidesAfterRound` vs `maxRounds` are inconsistent.
`maxRounds` should normally be `2 x switchSidesAfterRound`, and `roundsToWin` should be
`switchSidesAfterRound + 1` for a standard format.

**The game runs in slow motion on a weak machine**
`SimConfig.maxTicksPerFrame` (default 5) caps catch-up ticks per frame on purpose so a
stalled tab cannot fast-forward. Lower `SimConfig.tickRate` (64) if you need headroom.

**No sound**
Browsers block audio until a gesture: click the start screen. Cues without a `src` are
synthesised tones by design.

**Changes to a config file do nothing**
Most config is read when a character/weapon is *created*. Class stat changes apply on the
next `applyClass()` (next round); match/round config applies to the next match. Hard-refresh
to clear the module cache.
