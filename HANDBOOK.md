# Raptor Strike - Modding & Development Handbook (Godot 4.7)

Everything you need to change this prototype without rewriting it.

Each section names **exactly which file to open**, shows a **concrete example**, and says
what else (if anything) is affected. Where a section says "nothing else changes", that is a
promise the architecture is meant to keep - if you find otherwise, that's a bug.

---

## Table of contents

1. [Open, run and test](#1-open-run-and-test)
2. [Project structure](#2-project-structure)
3. [Architecture in one page](#3-architecture-in-one-page)
4. [Replacing capsule characters with dinosaur models](#4-replacing-capsule-characters-with-dinosaur-models)
5. [Character classes: add, remove, change](#5-character-classes-add-remove-change)
6. [Class stats](#6-class-stats)
7. [Adding a new dinosaur (end to end)](#7-adding-a-new-dinosaur-end-to-end)
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
24. [Input and controls](#24-input-and-controls)
25. [Events reference](#25-events-reference)
26. [Testing](#26-testing)
27. [Exporting a build](#27-exporting-a-build)
28. [Troubleshooting](#28-troubleshooting)

---

## 1. Open, run and test

**Requires Godot 4.7** (developed and verified against 4.7.2-stable). No addons, no C#,
no external dependencies.

- **Play:** open this folder with the Godot project manager and press **F5**.
- **From the command line:**

```bash
godot --path .                                   # play
godot --path . -- --seed 7 --difficulty hard     # options go after the bare --
godot --headless --path . res://tests/test_main.tscn        # 83 tests, ~75s, exit code 0/1
godot --headless --path . res://tools/headless_match.tscn -- --verbose   # simulate a whole match
godot --path . res://tools/screenshot.tscn -- --out shot.png --autostart # capture a frame
```

**Command-line options** (always after a bare `--`):

| Option | Example | Effect |
|---|---|---|
| `--seed` | `--seed 7` | deterministic match seed |
| `--map` | `--map dust_proto` | map id from `Config.get_map()` |
| `--difficulty` | `--difficulty hard` | bot difficulty (`easy`/`normal`/`hard`) |
| `--class` | `--class TANK` | your starting class |
| `--debug` | `--debug` | on-screen readout: fps, phase, position, bot goals |

**Controls:** WASD move, Space jump, Ctrl crouch, Shift sprint, LMB fire, RMB aim,
R reload, **E hold** to plant/defuse/pick up the bomb, 1/2/3 weapon slots, V grenade,
Q/F abilities, B buy menu, Tab scoreboard, P overhead debug camera, Esc release the mouse.

---

## 2. Project structure

```
project.godot                 autoloads, input map, physics (64 Hz), layers
icon.svg

autoload/                     singletons, loaded before everything else
  events.gd                   Events   - the global signal hub
  config.gd                   Config   - loads every data resource once
  game.gd                     Game     - points at the current MatchSession
  audio_manager.gd            AudioManager - event-driven cues

data/                         *** ALL TUNING LIVES HERE *** (.tres, inspector-editable)
  config/game_config.tres     match, round, bomb, economy, combat, movement
  config/bot_config.tres      bot difficulty and behaviour
  weapons/*.tres              13 weapons
  equipment/*.tres            5 pieces of gear
  classes/*.tres              5 dinosaur classes
  abilities/*.tres            10 abilities

scripts/
  config/                     the Resource *types* behind those .tres files
    game_config.gd  weapon_data.gd  equipment_data.gd  character_class_data.gd
    ability_data.gd  bot_config.gd
    map_definition.gd  map_area.gd  map_prop.gd  spawn_point_data.gd  bomb_site_data.gd
  core/                       the simulation
    match_session.gd          composition root: builds the world, owns the systems, ticks
    character.gd              CharacterBody3D: transform + components, no input, no rules
    character_models.gd       *** THE MODEL SWAP POINT ***
    placeholder_capsule.gd    the stand-in dinosaur
    character_visual.gd       mirrors simulation state onto whatever model is loaded
    intent.gd                 the one input contract players and bots share
    player_controller.gd      keyboard/mouse -> Intent, plus the camera
    view_model.gd             first-person weapon
    world_query.gd            "who is near?", "can A see B?", "what does this ray hit?"
    ability_context.gd        the sandbox an ability runs inside
    status_effect.gd          one timed modifier
    game_enums.gd             every shared enum
    components/               health, inventory, effects, abilities
    weapons/                  weapon.gd (runtime state), grenade.gd
    world/                    compiled_map.gd (rasteriser), map_builder.gd (nodes)
    systems/                  combat, bomb, round, match, team, economy, shop, spawn
    ai/bot_brain.gd           perceive -> pick a goal -> path -> shoot
  abilities/                  one script per ability
  ui/                         hud, shop, scoreboard, class select, screens, ui_root
  maps/dust_proto_map.gd      the prototype map layout

scenes/
  main.tscn                   entry point: environment, sun, UI, spawns the MatchSession
  character.tscn              body, collider, visual holder, head, name tag
  ui/hud.tscn                 the HUD layout (edit this to restyle)
  ui/ui_root.tscn             HUD + overlay screens

tests/                        83 tests, run headless (see §26)
tools/                        headless_match, screenshot, generate_data
web-prototype/                the earlier three.js prototype, kept for reference
```

---

## 3. Architecture in one page

```
        input (keyboard/mouse)                 BotBrain
                    \                            /
                     v                          v
                  +--------------------------------+
                  |            Intent              |   move, look, fire, use, abilities
                  +--------------------------------+
                                 |
                                 v
   +-------------------------------------------------------------------+
   |                MatchSession._physics_process(delta)                |
   |  bots think -> apply intents -> move bodies -> systems -> round    |
   +-------------------------------------------------------------------+
        |             |              |             |              |
    WorldQuery   CombatSystem   BombSystem   EconomySystem   RoundManager
   (raycasts,     (hitscan,     (plant/       (money)        (phases,
    proximity)     damage)       defuse)                      win rules)
        \_________________ Events (global signals) _________________/
                                 |
             +-------------------+--------------------+
             v                   v                    v
           HUD/UI          AudioManager        CharacterVisual
```

Rules the codebase follows - keep them and extensions stay cheap:

1. **One tick order, written down once.** `MatchSession.tick()` runs think -> act -> move ->
   resolve -> round rules, every physics frame. No system schedules itself.
2. **Systems talk through `Events`,** not direct references. `EconomySystem` does not know
   `CombatSystem` exists; it listens for `character_died`.
3. **Players and bots are identical downstream of `Intent`.** Anything a bot can do, a
   player can do, and vice versa.
4. **Data over code.** Weapons, classes, abilities, prices, round rules and the map are
   resources and data, not `if` statements inside systems.
5. **The visual layer only reads.** `CharacterVisual`, the HUD and the audio never write
   simulation state.
6. **`data/*.tres` is the source of truth for tuning.** `tools/generate_data.gd` can
   regenerate the defaults, but it is a "restore defaults" button, not a build step.

---

## 4. Replacing capsule characters with dinosaur models

**File: `scripts/core/character_models.gd`. This is the only file you need to touch.**

Each class declares a `model_key` in its class resource (`data/classes/*.tres`):
`dino_ankylo`, `dino_ptera`, `dino_raptor`, `dino_para`, `dino_rex`. The registry maps that
key to a factory. With no factory registered you get the placeholder capsule.

A factory is `func(class_data: CharacterClassData, team_color: Color) -> Node3D`. The node
it returns may implement any of these optional methods - `CharacterVisual` calls them only
if they exist:

```gdscript
set_pose(pose: Dictionary)        # {yaw, pitch, speed, crouching, airborne, aiming}
play_animation(name: StringName)  # &"idle" | &"run" | &"jump" | &"fire" | &"death"
set_team_color(color: Color)
set_opacity(value: float)         # used by camouflage
```

Register your factories once at startup - anywhere that runs early, for example a new
autoload or the top of `scripts/main.gd`:

```gdscript
# scripts/render/dino_models.gd  (call register_all() from main.gd _ready)
const RAPTOR := preload("res://assets/models/raptor.glb")

static func register_all() -> void:
    CharacterModels.register(&"dino_raptor", func(class_data, team_color):
        var model: Node3D = RAPTOR.instantiate()
        model.scale = Vector3.ONE * class_data.model_scale
        model.set_script(preload("res://scripts/render/raptor_model.gd"))
        model.setup(team_color)
        return model)
```

```gdscript
# scripts/render/raptor_model.gd
extends Node3D
@onready var animation: AnimationPlayer = $AnimationPlayer

func setup(team_color: Color) -> void:
    $Body.material_override = ... # tint however you like

func set_pose(pose: Dictionary) -> void:
    rotation.y = pose["yaw"]
    var clip := &"run" if pose["speed"] > 0.5 else &"idle"
    if animation.current_animation != clip:
        animation.play(clip)

func play_animation(name: StringName) -> void:
    animation.play(name)
```

Notes:

- **The hitbox does not come from the model.** It comes from `hitbox_radius` /
  `hitbox_height` in the class resource. Match your model to those numbers (or change
  them - see §6) or players will be shooting at air.
- The capsule placeholder lives in `scripts/core/placeholder_capsule.gd`; read it as a
  worked example of the model interface.
- Weapons work the same way: `ViewModel.register_weapon_model(&"weapon_rifle", factory)`,
  keyed by `WeaponData.model_key`.
- **No gameplay file changes.** `Character`, `MatchSession` and every system stay untouched.

---

## 5. Character classes: add, remove, change

### Add a class

1. **Duplicate a class resource.** In the FileSystem dock, right-click
   `data/classes/RANGER.tres` -> Duplicate -> `SUPPORT.tres`.
2. **Edit it in the inspector**: set `id` to `SUPPORT` (it must match the file name's intent
   and be unique), pick stats, allowed categories, abilities, and a `model_key`.
3. That's it. `Config` scans `data/classes/` at startup, so the new class appears in the
   class picker, gets its own filtered shop, and enters the bot class rotation.

To do the same in code (for example in `tools/generate_data.gd`):

```gdscript
var support := CharacterClassData.new()
support.id = &"SUPPORT"
support.display_name = "Stego"
support.species = "Stegosaurus"
support.role = "Support"
support.max_health = 115.0
support.move_speed = 5.3
support.hitbox_radius = 0.55
support.hitbox_height = 1.88
support.allowed_categories = [
    GameEnums.WeaponCategory.PISTOL, GameEnums.WeaponCategory.SMG,
    GameEnums.WeaponCategory.RIFLE, GameEnums.WeaponCategory.MELEE,
    GameEnums.WeaponCategory.EQUIPMENT] as Array[int]
support.abilities = [&"ability_field_dressing", &"ability_echo_call"] as Array[StringName]
support.bot_buy_priority = [&"rifle_apex", &"smg_swarm"] as Array[StringName]
support.model_key = &"dino_stego"
ResourceSaver.save(support, "res://data/classes/SUPPORT.tres")
```

### Remove a class

Delete its `.tres`. Then check nothing still references the id:

```bash
grep -rn "ASSASSIN" scripts/ tests/ data/
```

`Config.default_class_id()` falls back to `RANGER`, then to the first class found - make
sure at least one class survives.

### Change which weapons a class may buy

Edit `allowed_categories` on the class resource. For per-weapon control, set
`allowed_classes` on the weapon itself (empty = "any class whose categories allow it"):

```gdscript
sniper_longneck.allowed_classes = [&"SNIPER"]   # only snipers, ever
```

---

## 6. Class stats

**File: `data/classes/<CLASS>.tres`** (inspector), typed by
`scripts/config/character_class_data.gd`.

| Property | Meaning | Read by |
|---|---|---|
| `max_health` | hit points | `HealthComponent` |
| `max_armor` / `starting_armor` | armour cap / free armour each round | `HealthComponent` |
| `has_helmet_by_default` | free helmet | `HealthComponent` |
| `move_speed` | base walk speed (m/s) | `Character.target_speed()` |
| `jump_velocity` | jump impulse | `Character.tick_movement()` |
| `damage_taken_multiplier` | below 1.0 = tanky | `CombatSystem.apply_damage()` |
| `damage_dealt_multiplier` | above 1.0 = hits harder | `CombatSystem.apply_damage()` |
| `hitbox_radius` / `hitbox_height` | the capsule people shoot at | `Character.apply_class()` |
| `eye_height_fraction` | camera height as a fraction of hitbox height | `Character.eye_position()` |

Example - make the Tank slower but tougher: open `data/classes/TANK.tres` and set
`max_health = 175`, `move_speed = 4.2`, `damage_taken_multiplier = 0.75`.

Global movement feel (gravity, acceleration, friction, sprint/crouch multipliers, fall
damage) is in `data/config/game_config.tres` under **Movement** and applies to every class.

Changes take effect the next time `apply_class()` runs - that is, the next round or the
next match.

---

## 7. Adding a new dinosaur (end to end)

1. **Class data** - add `data/classes/<ID>.tres` with a unique `model_key` (§5).
2. **Abilities** - reuse existing ability ids or add new ones (§8).
3. **Model** - register a factory for the `model_key` (§4). Skip this and it gets a coloured
   capsule, which is fine while you prototype.
4. **Weapons** - set `allowed_categories`, and add class-specific guns if you want (§9).
5. **Bots** - set `bot_buy_priority` so bots buy sensibly. Nothing else: bots handle any
   class automatically.
6. **Audio/VFX (optional)** - add cues in `autoload/audio_manager.gd` and play them from an
   event.

No system file changes at any step.

---

## 8. Abilities

**Data: `data/abilities/*.tres`. Behaviour: `scripts/abilities/*.gd`.**

An ability is a Resource that extends `AbilityData` and overrides `activate()`. It receives
an `AbilityContext` - the only surface it may touch:

```gdscript
ctx.character                                   # the user
ctx.time                                        # simulation seconds
ctx.rng                                         # seeded RNG - never use randf() directly
ctx.characters_within(origin, radius, filter)   # filter: {"enemy_of":, "team":, "alive_only":}
ctx.has_line_of_sight(from_character, to_character)
ctx.apply_damage(target, amount, source)
```

Adding one:

```gdscript
# scripts/abilities/ability_ash_cloud.gd
class_name AbilityAshCloud
extends AbilityData

func activate(ctx: AbilityContext) -> void:
    for enemy in ctx.characters_within(ctx.character.global_position, radius, {"enemy_of": ctx.character}):
        enemy.effects.add(StatusEffect.new(&"ash_blind", duration, {
            "speed": 0.55, "spread": 2.5,
        }))
```

Then create the resource (inspector: New Resource -> AbilityAshCloud, save as
`data/abilities/ability_ash_cloud.tres`, set `id`, `cooldown`, `duration`, `radius`), and
list its id in a class's `abilities` array. Slot order is Q, then F (rebind in §24).

**Effect modifier keys** (`scripts/core/components/effect_component.gd`): `speed`,
`damage_taken`, `damage_dealt`, `spread`, `gravity`, `invisible`. To add a new one: add it
to `NEUTRAL`, fold it in `_recompute()`, and read it where it matters (for example
`Character.target_speed()`).

Extra hooks on a `StatusEffect`: `tick_callback` (see `ability_charge.gd` for a per-tick
trample) and `break_on_fire` (see `ability_camouflage.gd`). Abilities can be instant
(`duration = 0`) or charge-limited (`charges_per_round`).

---

## 9. Weapons: creating and adding

**Data: `data/weapons/*.tres`, typed by `scripts/config/weapon_data.gd`.**

Weapons are data, not subclasses: `Weapon` (`scripts/core/weapons/weapon.gd`) holds only
mutable state (ammo, cooldowns, recoil) and reads every stat from the resource.

**In the editor:** duplicate `data/weapons/rifle_ranger.tres`, rename it
`rifle_thagomizer.tres`, set `id = rifle_thagomizer`, and tune it in the inspector.

**In code** (for example inside `tools/generate_data.gd`, next to the others):

```gdscript
_weapon({
    "id": &"rifle_thagomizer", "display_name": "Thagomizer AR",
    "category": GameEnums.WeaponCategory.RIFLE, "slot": GameEnums.WeaponSlot.PRIMARY,
    "fire_mode": GameEnums.FireMode.AUTO, "price": 3100,
    "damage": 36.0, "fire_rate": 600.0, "mag_size": 25, "reserve_ammo": 75,
    "reload_time": 2.6, "range": 110.0, "falloff_start": 50.0, "falloff_end": 95.0,
    "armor_penetration": 0.8, "move_speed_multiplier": 0.94,
    "spread_base": 0.5, "spread_moving": 3.8,
    "recoil_vertical": 0.6, "recoil_max_vertical": 10.0,
    "model_key": &"weapon_rifle", "color": Color("5a6b52"),
})
```

It appears in the shop automatically for every class whose `allowed_categories` include
`RIFLE` - the buy menu is generated from the data, not from a list (§11).

**Equipment** (`data/equipment/*.tres`, typed by `scripts/config/equipment_data.gd`) has an
`effect` enum instead of stats: `ARMOR`, `ARMOR_HELMET`, `DEFUSE_KIT`, `GRENADE`, `HEAL`.
Adding a new *kind* of gear means adding an enum value and one branch in
`EquipmentData.apply()` - never a change in `ShopSystem`.

---

## 10. Weapon tuning: damage, fire rate, ammo, reload, range, recoil

All in `data/weapons/<weapon>.tres` (inspector), grouped exactly as listed here.

| Want to change | Property | Notes |
|---|---|---|
| Damage | `damage` | before falloff and hit-zone multipliers |
| Headshot damage | `headshot_multiplier` | HEAD zone only |
| Armour effectiveness | `armor_penetration` | 0..1, fraction that bypasses armour |
| Fire rate | `fire_rate` | **rounds per minute** |
| Burst behaviour | `burst_count`, `burst_delay` | with `fire_mode = BURST` |
| Magazine / reserve | `mag_size`, `reserve_ammo` | `-1` = never reloads (melee) |
| Reload time | `reload_time` | seconds |
| Draw time | `equip_time` | cannot fire while drawing |
| Max range | `range` | rays stop here |
| Damage falloff | `falloff_start`, `falloff_end`, `falloff_min_multiplier` | linear between start and end |
| Hip/moving accuracy | `spread_base`, `spread_moving`, `spread_jumping` | degrees of cone |
| Crouch/ADS accuracy | `spread_crouching`, `spread_ads` | **added**, so negative = tighter |
| Recoil climb | `recoil_vertical`, `recoil_horizontal`, `recoil_max_vertical` | degrees per shot |
| Recoil recovery | `recoil_recovery`, `recoil_recovery_delay` | recovery starts this long after the last shot, never mid-burst |
| Shotgun pellets | `pellets` | each pellet is its own ray |
| Scope | `ads_zoom`, `ads_time` | FOV divisor; `>= 2` also hides the crosshair |
| Carry speed | `move_speed_multiplier` | multiplies the class `move_speed` |
| Kill money | `kill_reward` | paid by `EconomySystem` |

The damage actually applied is:

```
damage
  x range falloff                    (WeaponData.falloff_multiplier)
  x hit-zone multiplier              (GameConfig.hit_zone_multiplier)
  x weapon headshot_multiplier       (head only)
  x attacker damage_dealt_multiplier (class + active effects)
  x target damage_taken_multiplier   (class + active effects)
  -> armour model                    (HealthComponent.take_damage, armor_penetration)
```

Hit-zone sizes are `head_zone_fraction`, `stomach_zone_fraction` and `legs_zone_fraction`
in `data/config/game_config.tres`.

---

## 11. Shop items and prices

- **Price:** the `price` property on the item resource itself. One number, one place.
- **What appears and in what order:** `ShopSystem.CATEGORY_ORDER` and `CATEGORY_NAMES` in
  `scripts/core/systems/shop_system.gd`. The *items* inside each category are collected
  from the data, filtered by class, and sorted by price - you never maintain a list.
- **Purchase rules:** `shop_require_spawn_zone` and `shop_allowed_phases` in
  `data/config/game_config.tres`.

Rejections are reported as `GameEnums.PurchaseResult` values (`WRONG_PHASE`,
`NOT_IN_BUY_ZONE`, `NOT_ENOUGH_MONEY`, `CLASS_RESTRICTED`, `SIDE_RESTRICTED`,
`ALREADY_OWNED`, `UNKNOWN_ITEM`, `DEAD`). The buy menu greys out what you cannot afford and
shows the reason as a tooltip; items your class can *never* use are hidden entirely.

To restyle the menu, edit `scripts/ui/shop_ui.gd` (and `scripts/ui/overlay_panel.gd` for
the shared frame).

---

## 12. Starting money and economy rewards

**File: `data/config/game_config.tres` -> Economy group.**

| Property | Default | Meaning |
|---|---|---|
| `starting_money` | 800 | per player at match start and after the side switch |
| `max_money` | 16000 | wallet cap |
| `reset_money_on_side_switch` | true | false = carry money into the second half |
| `round_win_reward` | 3250 | to every member of the winning team |
| `bomb_detonated_bonus` / `bomb_defused_bonus` | 300 | on top of the win reward |
| `loss_bonus_base` / `loss_bonus_increment` / `loss_bonus_max` | 1400 / 500 / 3400 | consecutive-loss bonus |
| `loss_with_plant_bonus` | 800 | lost the round but planted |
| `plant_reward` / `defuse_reward` | 300 | to the individual |
| `team_kill_penalty` / `suicide_penalty` | -300 | |

Per-kill money is the **weapon's** `kill_reward` - that is how a claw kill pays 1200 while
a sniper kill pays 100.

`tests/test_economy.gd` covers every one of these numbers; run the suite after editing.

---

## 13. Round settings

**File: `data/config/game_config.tres` -> Round group.**

| Property | Default | Meaning |
|---|---|---|
| `warmup_duration` | 6 | free roam before round 1 |
| `buy_duration` | 15 | freeze time; players rooted, shop open |
| `round_duration` | 115 | live time before the defenders win on the clock |
| `round_end_duration` | 5 | pause between rounds |
| `respawn_during_warmup` | true | warmup deathmatch |

The state machine is `scripts/core/systems/round_manager.gd`:

```
WARMUP -> BUY -> LIVE -> ROUND_END -> BUY (next round) ... -> MATCH_END
```

- **Freeze time** is `_enter_phase(BUY)` setting `character.frozen = true` and
  `combat.combat_enabled = false`.
- **Skip a phase** (a "ready up" button, or a test): `session.round_manager.skip_phase()`.
- **Pause everything** (debugging): `session.round_manager.paused = true`.
- **Add a phase:** add it to `GameEnums.RoundPhase`, handle it in `update()` and
  `_enter_phase()`, and give it a label in `HUD._phase_label()`.

---

## 14. Win conditions

**File: `data/config/game_config.tres` -> Match group.**

| Property | Default | Meaning |
|---|---|---|
| `rounds_to_win` | 13 | first team to this many round wins takes the match |
| `switch_sides_after_round` | 12 | sides swap once this many rounds are complete |
| `max_rounds` | 24 | regulation cap (normally 2 x the switch round) |
| `team_size` | 5 | players per team; empty slots become bots |
| `overtime_enabled` | false | when false, an exhausted regulation is a draw |

Examples:

- **Short scrim (first to 5, switch at 4):** `rounds_to_win = 5`,
  `switch_sides_after_round = 4`, `max_rounds = 8`.
- **MR15 (first to 16, switch at 15):** `16 / 15 / 30`.
- **Overtime instead of draws:** `overtime_enabled = true`; sides then switch every
  `overtime_rounds_per_half` rounds and everyone gets `overtime_starting_money`.

**Round** win conditions live in `RoundManager` and are deliberately explicit:

| Condition | Winner | Implemented in |
|---|---|---|
| Bomb detonates | attackers | `_on_bomb_exploded()` |
| Bomb defused | defenders | `_on_bomb_defused()` |
| All defenders dead | attackers | `_check_elimination()` |
| All attackers dead **and the bomb is not planted** | defenders | `_check_elimination()` |
| Round timer expires with no plant | defenders | `_update_live()` |

Note the deliberate CS rule: once the bomb is planted, wiping the attackers does **not** end
the round - the defenders have to defuse. Remove the `not bomb.is_planted()` guard in
`_check_elimination()` to change that.

---

## 15. Bomb: timer, plant, defuse

**File: `data/config/game_config.tres` -> Bomb group.**

| Property | Default | Meaning |
|---|---|---|
| `bomb_fuse_duration` | 40 | plant to detonation |
| `plant_duration` | 3.2 | uninterrupted hold to plant |
| `defuse_duration` / `defuse_duration_with_kit` | 10 / 5 | |
| `plant_max_height_above_site` | 2.5 | stops planting from on top of tall cover |
| `bomb_interact_radius` | 2.2 | defuse distance |
| `bomb_pickup_radius` | 1.8 | pick a dropped bomb back up |
| `explosion_radius` / `explosion_damage` / `explosion_min_damage_fraction` | 28 / 500 / 0.15 | |

Behaviour is `scripts/core/systems/bomb_system.gd`
(`CARRIED -> DROPPED/PLANTED -> DEFUSED/EXPLODED`). It emits events and never decides who
wins - `RoundManager` does that.

Common tweaks:

- **Plant anywhere:** make `site_at()` return a dummy site.
- **Require standing still to plant:** in `update()`, add
  `if planting.horizontal_speed() > 0.5: cancel_plant()`.
- **Defuse only in the last 10 seconds:** guard inside `can_defuse()`.
- **The bomb never drops:** remove the `drop()` call in `_on_character_died()`.

The plant/defuse prompt and progress bar come from `can_plant` / `can_defuse` /
`plant_progress` / `defuse_progress` in `HUD._update_interaction()`.

---

## 16. Editing the map

**File: `scripts/maps/dust_proto_map.gd`.**

The map is authored as **walkable rectangles** ("areas") plus **props**.
`CompiledMap.compile()` rasterises the areas onto a grid, turns every cell that is *not*
walkable into merged wall boxes, and builds the navigation mesh from the same grid.
**You never place a wall by hand, and the layout cannot develop a hole between two rooms.**

Orientation: `+Z` north (defenders), `-Z` south (attackers), `+X` east (A side), `-X` west
(B side), `Y` up, floor at 0.

### Add a room or corridor

```gdscript
MapArea.make(&"A_BALCONY", 58, 24, 70, 40, "A Balcony"),
```

Areas connect wherever their rectangles touch or overlap: `A_BALCONY` starts at x=58, which
is where `A_SITE` ends, so they are joined and the walls regenerate around it.

### Add cover

```gdscript
MapProp.box(&"a_balcony_crate", Vector2(64, 32), Vector3(3, 2.2, 3), 0.0, CRATE),
MapProp.cylinder(&"a_balcony_pillar", Vector2(60, 36), 1.1, 5.0, 0.0, PILLAR),
MapProp.ramp(&"a_balcony_ramp", Vector2(58, 22), 5.0, 3.0, 1.2, "+z", RAMPC),
```

- `Vector2(x, z)` is the **footprint centre**; `Vector3(w, h, d)` is the size; the next
  argument is the base height.
- Props taller than **1.4** block bot navigation by default. Pass `0` as the last argument
  to keep a low crate navigable, or `1` to force blocking.
- `MapProp.ramp(id, at, width, length, height, direction, color)` builds a walkable slope -
  that is how characters reach the raised platforms.

### Move spawns, buy zones and sites

```gdscript
map.attacker_spawns = [SpawnPointData.make(-16, -66, PI), ...]   # PI faces north, 0 faces south
map.attacker_buy_zone = Rect2(Vector2(-30, -72), Vector2(60, 16))
map.bomb_sites = [BombSiteData.make(&"A", 34, 28, 52, 42, Vector3(42, 0, 32)), ...]
```

Give each side at least `team_size` spawn points; extras are scattered nearby.

### Verify your edit

```bash
godot --headless --path . res://tests/test_main.tscn
```

`tests/test_map.gd` flood-fills the navigation grid and fails on unreachable pockets, checks
every spawn is walkable and inside its buy zone, and proves both sites are pathable from
both spawns. Then look at it: press **P** in game for the overhead camera.

Map-level knobs on the `MapDefinition`: `cell_size` (grid resolution, default 2 - lower it
for finer walls at the cost of more boxes), `wall_height`, `padding`, and the colours.

---

## 17. Replacing primitive map objects with art

**File: `scripts/core/world/map_builder.gd`.** Two options:

**A. Change how all primitives look** - edit `_create_solid_mesh()`.

**B. Give one prop (or one kind) a real model** - register a factory before the map is
built. `MapBuilder.prop_models` is keyed by prop id (exact match wins) or by
`GameEnums.PropKind` (`WALL`, `COVER`, `PLATFORM`, `RAMP`, `PILLAR`, `DECOR`):

```gdscript
# in MatchSession.configure(), before map_builder.build(...)
map_builder.prop_models[&"a_platform"] = func(prop: MapProp) -> Node3D:
    var model: Node3D = preload("res://assets/props/platform.glb").instantiate()
    model.scale = prop.size / Vector3(10, 1.2, 7)   # the size the art was made at
    return model
map_builder.prop_models[GameEnums.PropKind.PILLAR] = func(prop): return pillar_scene.instantiate()
```

**Collision never changes.** Physics always uses the authored box/cylinder bounds, so nicer
art can never become a different obstacle. For purely decorative art, set
`collidable = false` on the prop.

---

## 18. Adding bomb sites

**File: `scripts/maps/<map>_map.gd`.**

```gdscript
map.bomb_sites = [
    BombSiteData.make(&"A", 34, 28, 52, 42, Vector3(42, 0, 32)),
    BombSiteData.make(&"B", -52, 28, -34, 42, Vector3(-42, 0, 32)),
    BombSiteData.make(&"C", -9, -46, 9, -30, Vector3(0, 0, -38)),
]
```

- The rect is the plantable footprint and must sit inside walkable areas.
- The plant point is where bots head to plant - keep it clear of props
  (`tests/test_map.gd` checks this).
- Everything adapts: `BombSystem.site_at()` scans all sites, the HUD prints whichever
  `site_id` was planted, `MapBuilder` draws a marker and a floor letter, and bots spread
  across sites (`BotBrain._plan_round()` picks uniformly for three or more; with exactly
  two it uses `site_b_preference`).
- Removing a site is just deleting its entry - a one-site map works.

---

## 19. Adding a new map

1. Copy `scripts/maps/dust_proto_map.gd` to `scripts/maps/my_map.gd`, rename the class, and
   change `id` / `display_name`.
2. Edit its areas, props, spawns and sites (§16).
3. Register it in `autoload/config.gd`:

```gdscript
func get_map(map_id: StringName = &"dust_proto") -> MapDefinition:
    match map_id:
        &"dust_proto": return DustProtoMap.build()
        &"my_map": return MyMap.build()
    ...

func map_ids() -> Array[StringName]:
    return [&"dust_proto", &"my_map"]
```

4. Play it: `godot --path . -- --map my_map`, or `MatchSession.configure({"map_id": &"my_map"})`.

---

## 20. Team rules

**Files: `scripts/core/systems/team_manager.gd` and `data/config/game_config.tres`.**

The distinction that matters: a **team** (`TEAM_ONE`, `TEAM_TWO`) is permanent and owns the
score; a **side** (`ATTACKERS`, `DEFENDERS`) is a role that swaps at halftime. Never assume
"team one attacks" - ask `teams.side_of(team_id)`.

```gdscript
# team names: scripts/core/match_session.gd, where TeamManager is constructed
teams = TeamManager.new("Sauropods", "Theropods")

# team size: data/config/game_config.tres -> team_size
# friendly fire: data/config/game_config.tres -> friendly_fire, friendly_fire_multiplier
```

Team colours come from `Character.team_color()` and the HUD's theme overrides.

A **third team** would need more work: `switch_sides()` assumes two, and `MatchManager`
compares two scores. Everything else is keyed by id already, so it is contained.

---

## 21. Changing the UI

| Element | File |
|---|---|
| HUD layout (score bar, clock, vitals, weapon, abilities, killfeed, crosshair, banner) | `scenes/ui/hud.tscn` - **edit this in the editor** |
| HUD behaviour (what text goes where) | `scripts/ui/hud.gd` |
| Buy menu | `scripts/ui/shop_ui.gd` |
| Scoreboard (Tab) | `scripts/ui/scoreboard.gd` |
| Class picker | `scripts/ui/class_select.gd` |
| Title card / match end | `scripts/ui/start_screen.gd`, `scripts/ui/match_end_screen.gd` |
| Shared menu frame (dim, panel, title, buttons) | `scripts/ui/overlay_panel.gd` |
| Screen ownership and mouse capture | `scripts/ui/ui_root.gd` |

The HUD is a normal Godot scene: move nodes, change fonts and colours in the inspector, and
`hud.gd` keeps filling them in - it only ever sets `text`, `value`, `visible` and `modulate`.
To add a widget: add the node in `hud.tscn`, add an `@onready` reference, and set it in
`_process()`.

The UI is a **read-only consumer**: it reads `Game.session`, `Game.local_player()` and the
systems, and listens to `Events`. Never mutate simulation state from the UI - route it
through an intent or a system call (`Game.session.shop.buy(...)` is the model).
`MatchSession.snapshot()` gives a plain-data view if you want to build a different UI.

---

## 22. Sounds, music and VFX

### Sound

**File: `autoload/audio_manager.gd`.** No audio files ship with the prototype: every cue in
the `CUES` dictionary is synthesised as a short tone at runtime. To use a real file, give
the cue a `path`:

```gdscript
&"weapon.fire.RIFLE": {"path": "res://assets/audio/rifle_fire.ogg", "volume": 0.4},
```

Cue ids are looked up by name; weapon fire uses `weapon.fire.<CATEGORY>`, so a new weapon
category needs a new cue. A missing cue logs one warning and stays silent - it never throws.

Adding a *new* cue means adding an entry to `CUES` and one line in `_bind_events()`:

```gdscript
Events.ability_used.connect(func(character, ability_id):
    play(StringName("ability.%s" % ability_id), character.global_position))
```

Positional audio is currently a simple distance attenuation (`_attenuation`). For true 3D
sound, swap the `AudioStreamPlayer` pool for `AudioStreamPlayer3D` nodes - the call sites
already pass a position.

Music: add an `AudioStreamPlayer` with your track in `scenes/main.tscn` and set it looping,
or extend `AudioManager` with a music bus.

### VFX

The prototype's effects are deliberately minimal (muzzle-free hitscan, a bomb marker,
grenade meshes). Because everything is event-driven, adding effects touches nothing else:

```gdscript
# a new autoload or a Node in main.tscn
func _ready() -> void:
    Events.weapon_fired.connect(_spawn_tracer)
    Events.grenade_exploded.connect(_spawn_explosion)
    Events.character_damaged.connect(_spawn_blood)
```

Use `GPUParticles3D` for impacts, `MeshInstance3D` with an emissive material for tracers,
and `OmniLight3D` with a tween for muzzle flashes.

---

## 23. Bots

**Tuning: `data/config/bot_config.tres`. Behaviour: `scripts/core/ai/bot_brain.gd`.**

| Property | Meaning |
|---|---|
| `enabled`, `fill_teams` | whether bots exist and top both teams up to `team_size` |
| `default_difficulty` | `EASY` / `NORMAL` / `HARD` (see `with_difficulty()`) |
| `aim_turn_rate`, `aim_error`, `reaction_time` | how fast and how accurately they track |
| `fire_burst_min` / `fire_burst_max` | trigger discipline |
| `view_distance`, `field_of_view`, `target_memory` | perception |
| `site_b_preference` | attack split on a two-site map |
| `save_threshold`, `think_interval`, `combat_strafe` | economy and movement |

### Add or remove bots

```gdscript
MatchSession.configure({"fill_bots": false})                  # no bots at all
session.add_bot("Spike", &"TANK", GameEnums.Team.TEAM_TWO, &"HARD")   # one specific bot
```

A new difficulty tier is a branch in `BotConfig.with_difficulty()`. Bot names come from
`MatchSession.BOT_NAMES`; classes cycle through `Config.class_ids`.

### Add a behaviour

Goals are `BotBrain.Goal`; the decision is `_choose_goal()`, movement is
`_update_movement()`, shooting is `_update_combat()`. Example - defenders rotating to a
teammate under fire:

```gdscript
# inside _choose_goal(), the defender branch
for mate in session.teams.members_on_side(GameEnums.Side.DEFENDERS, true):
    if mate != character and session.elapsed - mate.last_damage_time < 2.0:
        chosen = Goal.HOLD_SITE
        destination = _position_near(mate.global_position, 6.0)
        break
```

Bots use abilities by setting `intent.use_ability = 0` or `1` - the same path a player uses.
They currently do not; wiring it up is a couple of lines in `_update_combat()`.

**Bots need no navigation authoring.** They use `NavigationAgent3D` against the navigation
mesh `CompiledMap` generates, so they path correctly on any map you draw.

---

## 24. Input and controls

**Project Settings -> Input Map** (stored in `project.godot`). Actions:
`move_forward/backward/left/right`, `jump`, `crouch`, `sprint`, `fire`, `aim`, `reload`,
`use`, `drop_bomb`, `ability_primary`, `ability_secondary`, `throw_grenade`, `toggle_shop`,
`scoreboard`, `slot_primary/secondary/melee`, `toggle_freecam`.

Rebinding in the editor is enough - `PlayerController` and the HUD read the action names,
not key codes.

Mouse sensitivity and inversion are exported properties on `PlayerController`
(`mouse_sensitivity`, `ads_sensitivity_multiplier`, `invert_y`, `pitch_limit`).

To add an action: add it to the Input Map, handle it in `PlayerController._poll_actions()`,
and add the field to `Intent` so bots can express it too. **Adding a gamepad or a network
client means writing another producer of `Intent` - nothing in the simulation changes.**

---

## 25. Events reference

**File: `autoload/events.gd`** - the full catalogue, with payload documentation inline.
Subscribe from anywhere:

```gdscript
Events.bomb_planted.connect(func(character, site_id, position): ...)
Events.round_ended.connect(_on_round_ended)
```

Groups: match/round lifecycle, characters, weapons/combat, abilities, economy/shop, bomb,
and presentation hooks (`notification_posted`, `kill_feed`).

This is the seam for anything additive - stats tracking, a demo recorder, achievements, a
spectator overlay - with no changes to gameplay code. `Events.reset()` disconnects
everything; the test runner calls it between files.

---

## 26. Testing

```bash
godot --headless --path . res://tests/test_main.tscn      # 83 tests, ~75s, exit code 0 or 1
godot --headless --path . res://tools/headless_match.tscn -- --seed 3 --verbose
```

| File | Covers |
|---|---|
| `tests/test_map.gd` | compilation, full connectivity, spawns, buy zones, navigation paths |
| `tests/test_movement.gd` | gravity, walls, crouch, jump, ramps, class speed |
| `tests/test_weapons.gd` | resources, fire modes, fire rate, reload, recoil, spread, switching |
| `tests/test_combat.gd` | damage model, headshots, armour, falloff, line of sight, grenades |
| `tests/test_economy.gd` | starting money, kill rewards, win/loss income, caps |
| `tests/test_shop.gd` | phase/zone/class/side restrictions, gear limits |
| `tests/test_bomb.gd` | plant, interrupt, fuse, defuse (+kit), drop/pickup, both sites |
| `tests/test_round.gd` | phase machine, freeze time, all five win conditions, round reset |
| `tests/test_match.gd` | scoring, side switch at 12, match win at 13, halftime reset |
| `tests/test_classes.gd` | class data, stats, abilities, effects, class switching |
| `tests/test_bots.gd` | buying, navigation, fighting, a full match, determinism |

Writing a test: create `tests/test_<thing>.gd` extending `TestCase` with `test_*` methods.
The runner discovers it automatically. Helpers in `tests/test_case.gd`: `make_session`,
`advance`, `advance_until`, `start_live_round`, `pause_rounds`, `place`, `aim_at`, `record`,
`sync_navigation`, and the `check_*` assertions.

Two things worth knowing before you write one:

- **The runner speeds time up** by raising `Engine.physics_ticks_per_second` and
  `Engine.time_scale` together, so each tick still advances 1/64 s. `advance(session, 2.0)`
  means two *game* seconds.
- **GDScript lambdas capture by value.** To record something from inside a signal handler,
  mutate a Dictionary or Array, never a plain local.

---

## 27. Exporting a build

Nothing in the project blocks exporting: no editor-only APIs at runtime, no absolute paths.

1. Editor -> Project -> Export -> add a preset (Windows/Linux/macOS/Web).
2. Export. `Config` loads `data/**.tres` through `ResourceLoader`, and its directory scan
   already strips the `.remap` suffix exported builds add.
3. `tools/` and `tests/` are dev-only; add `res://tools/*` and `res://tests/*` to the
   preset's exclude filter if you want them out of the shipped build.

---

## 28. Troubleshooting

**"Cannot infer the type of X" when you add code**
GDScript refuses `:=` when the right-hand side is untyped. Either annotate
(`var weapon: Weapon = ...`) or use `=`. Fields like `Character.damage_sink` are untyped on
purpose to avoid cyclic class references.

**Nothing happens when I press Play / the mouse is not captured**
Click "Click to play" on the title card first - the match starts and the mouse is captured
there. Esc releases it; opening the shop or class picker releases it too.

**The camera is inside a capsule**
The local player's own visual is hidden by `PlayerController`. If you replaced the model,
make sure your factory's root is a `Node3D` under `Character/Visual` so hiding still works.

**Bots stand still**
Their goal is unreachable, or navigation is not synced yet. `--debug` prints each bot's
goal. Navigation needs two server sync iterations after the map is built; in game the
warmup covers it, and in tests use `sync_navigation()`. If a bot's goal is on a
nav-blocking prop, `CompiledMap.nearest_navigable()` should have fixed it - check the prop
sizes in the map file.

**Bots never plant**
The carrier died and nobody picked the bomb up (check `session.bomb.state`), the site's
`plant_point` is inside a prop (`tests/test_map.gd` catches this), or
`plant_max_height_above_site` is too small for a raised site.

**Shots pass through enemies**
`hitbox_radius` / `hitbox_height` in the class resource no longer match your model.
Collision uses the *resource*, not the mesh.

**A weapon fires far too fast or slow**
`fire_rate` is **rounds per minute**, not per second.

**Recoil does nothing**
`recoil_recovery` is high relative to `recoil_vertical`, or `recoil_recovery_delay` is 0.
Recovery only starts that long after the last shot and never while the trigger is held.

**Nothing happens when I buy**
You are outside the buy phase or outside your spawn zone. The reason is shown in the HUD
banner and returned by `shop.buy()`.

**The round never ends**
A team has an alive member you did not expect (`session.teams.alive_count(id)`), or
`round_manager.paused` is still true from a debugging session.

**The match ends too early or too late**
`rounds_to_win`, `switch_sides_after_round` and `max_rounds` are inconsistent. Normally
`max_rounds = 2 x switch_sides_after_round` and `rounds_to_win = switch_sides_after_round + 1`.

**Changes to a .tres do nothing**
Most data is read when a character or weapon is *created*. Class stat changes apply next
round; match and round settings apply to the next match. `Config.reload()` re-reads
everything at runtime.

**Audio is silent**
Expected in `--headless` (the manager disables itself). In a normal run, the cues are
synthesised tones - quiet by design. Check the Master bus volume.

**"map_get_path returned empty" in your own code**
Query the navigation map only after it has synced twice. Copy the readiness probe in
`tests/test_case.gd -> sync_navigation()`.
