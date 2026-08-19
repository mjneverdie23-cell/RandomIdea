# RandomIdea — Godot 4 MOBA map prototype

A playable low-poly 3D MOBA prototype in **Godot 4.3**: a Wild Rift-style map
topology plus a working combat loop — champions, minion waves, turrets, damage,
death and respawn. Everything on screen is primitive geometry generated at
runtime; the point of the project is the *gameplay spaces, navigation, combat
loop and architecture*, not the art.

No proprietary assets are used or referenced; all geometry is cubes,
cylinders, spheres and capsules created in code.

---

## Running it

Open the project in Godot 4.3 and press **Play** (`scenes/Main.tscn` is the
main scene). You spawn as Team A in the bottom-left fountain.

| Input | Action |
|---|---|
| `W A S D` | Move (camera relative) |
| Mouse | Aim / camera interaction |
| Left click | Select an enemy and basic attack |
| `Q` | Bolt — ranged projectile damage |
| `E` | Dash — short burst of forced movement |
| `R` | Nova — larger area damage at the aim point |
| `F` | Bulwark — self-buff (damage reduction, speed, heal) |
| `B` | Recall (channel, interrupted by moving) |
| `Space` | Toggle camera lock / free pan |
| Mouse wheel | Zoom |

Abilities deliberately sit on **Q E R F** so no physical key ever means both
"move" and "cast". The slots are indices on the command bus, not keys, so a
mobile joystick plus a four-button bar raises exactly the same
`InputCommands.ability_requested(slot, aim_point)`.

### Developer keys

Development-only, handled by `DevInputController` and wired to nothing else —
deleting that node removes every cheat and leaves the sandbox intact.

| Key | Action |
|---|---|
| `F1` | Spawn an enemy champion |
| `F2` | Spawn a minion wave in every lane |
| `F3` | Reset the champion (position, health, cooldowns) |
| `F4` | Teleport to `TEAM_A_SPAWN` |
| `F5` | Teleport to `TEAM_B_BASE` |
| `F6` | Refill health |
| `F7` | Kill the selected target |
| `F8` | Kill every enemy |
| `F9` | Toggle the map debug view |
| `F10` | Toggle the combat debug overlay |

`F9` goes through the normal command bus (a shipped build may still expose a
debug view); `F1`–`F8` and `F10` do not.

### Headless / offscreen check

```bash
godot --headless --path . tools/SmokeTest.tscn                    # verify
godot --path . tools/SmokeTest.tscn -- --out=/tmp/shots           # + screenshots
```

The smoke test boots the real game scene and asserts that:

* the map builds and every required identifier exists;
* all lanes, jungles, camps, objectives and the enemy base are reachable from
  Team A's spawn over the baked navigation mesh;
* movement commands move the champion and walls stop it;
* both debug views toggle;
* a left click selects a nearby enemy and basic attacks repeat on it;
* an out-of-range target is chased;
* all four abilities cast, start cooldowns and refuse a second cast;
* the champion dies, cannot move while dead, and respawns at its fountain with
  full health;
* a wave spawns and its minions navigate away from the spawn;
* two opposing minions damage each other unaided;
* a minion damages an enemy turret and is shot back;
* a second map configuration builds and passes the same reachability check.

It exits non-zero on failure.

---

## Map topology

The play field is an axis-aligned square. Both bases sit on the `-X/+Z` and
`+X/-Z` corners, so mid lane is one diagonal and the river is the other — the
familiar MOBA read, with the square staying axis-aligned on screen.

```
            TOP lane
   TOP_OBJECTIVE ┌──────────────┐
      (river)    │  B jungle    │  TEAM B base
                 │      ╲   ╱   │   (nexus, fountain,
        river ╲  │ mid ╳ ╱      │    base turrets)
               ╲ │    ╱   ╲     │
                ╲│  ╱  A jungle │
   TEAM A base   └──────────────┘  BOT_OBJECTIVE
                     BOT lane          (river)
```

* **Two bases** — nexus, fountain/spawn, base walls, inner defensive turrets
  and an exit into each of the three lanes.
* **Three lanes** — top and bottom wrap the map corners, mid runs straight
  between the bases. Each lane carries an inhibitor, inner and outer turret
  per team, plus an inhibitor structure inside the base.
* **Four jungle quadrants** — each bounded by an outer lane, mid lane and the
  river, with a solid chunk in the middle and four camps (small, medium,
  large, buff). Each quadrant has four corridors: outer lane, mid lane, river
  and own base.
* **River** — a wide traversable band along the other diagonal, meeting the
  lane corners at both ends.
* **Two neutral objectives** — arenas on the river (`TOP_OBJECTIVE`,
  `BOT_OBJECTIVE`) with a spawn marker, navigation room and a placeholder
  objective mesh. Combat is intentionally not implemented.

### Stable identifiers

Every feature is registered in `MapRegistry` under a stable string id, so
future systems address the map by name rather than by node path:

```
TEAM_A_SPAWN            TEAM_B_SPAWN
TEAM_A_BASE             TEAM_A_NEXUS            TEAM_A_TOP_LANE_ENTRANCE
TOP_LANE  MID_LANE  BOT_LANE  RIVER
TOP_OUTER_TURRET_A      TOP_INNER_TURRET_A      TOP_INHIB_TURRET_A
TEAM_A_NEXUS_TURRET_1   TOP_INHIBITOR_A
JUNGLE_A_TOP            JUNGLE_A_TOP_BUFF_CAMP  JUNGLE_A_TOP_ENTRANCE_RIVER
TOP_OBJECTIVE           BOT_OBJECTIVE
```

```gdscript
var pit := map.position_of("BOT_OBJECTIVE")
var turret := map.registry.get_node_for("MID_OUTER_TURRET_B")
```

---

## Combat sandbox

Built on top of the map, never inside it. `GameDirector` is the only node that
sees both sides: it reads the map's stable turret identifiers and attaches a
`TurretController` to each existing turret node, so the map layer stays free of
combat code and the map's topology, navigation and debug renderer are untouched.

```
GameDirector          spawns champions, attaches turret controllers, dev commands
 ├── MinionWaveSpawner  waves per lane, routes sampled from MapLayout
 └── Battle (autoload)  registry of live units; the only way units find each other

Unit (CharacterBody3D)         team + UnitStats + components
 ├── ChampionController        player (command bus) or AI (chase and shoot)
 ├── MinionController          MOVE -> SEARCH -> ATTACK -> MOVE
 └── TurretController          static, prefers minions over champions

components: HealthComponent, StatsComponent, MovementComponent,
            TargetingComponent, CombatComponent, AbilityComponent
```

**Health** clamps to `0..max`, emits `health_changed`, `damaged`, `healed`,
`died` and `revived`, and applies a damage-reduction fraction that abilities can
raise. A dead unit leaves every physics layer, so it cannot be selected,
targeted or shot at, and it cannot move or attack.

**Targeting** validates the current target every frame (team, alive, distance)
and follows it out of the tree, so no system ever holds a freed unit. Turrets
and minions auto-acquire with a kind priority — minions before champions for
turrets. The player selects manually: a click picks the enemy nearest the aim
point, and if the click lands on empty ground the nearest enemy already in range
is used. A ring marks the selection. An out-of-range selected target is chased
up to a leash distance, but only while you are not steering with WASD.

**Basic attacks** run one pipeline for everyone —
*request → cooldown → target validation → damage → health update* — and choose
between an instant hit and a travelling `Projectile` purely from
`UnitStats.projectile_speed`. No animation is involved.

**Abilities** are resources, not code paths: `AbilityComponent` owns slots and
cooldowns and calls `AbilityData.execute()`. `ProjectileAbility`, `DashAbility`,
`AreaAbility` and `BuffAbility` each live in one small script with one `.tres`
per ability, so adding a fifth kind never touches the champion.

**Death and respawn**: a champion disables itself, hides, counts down a
configurable `respawn_time`, then reappears at its team spawn point with health
restored, modifiers dropped and cooldowns cleared. Minions leave a short-lived
corpse and free themselves; a destroyed turret sinks, greys out and stops
firing, keeping its collider so the baked navigation mesh stays valid.

**Lane interaction** falls out of the above: waves spawn from each base's lane
entrance, walk lane waypoints sampled from `MapLayout`, meet in the middle,
fight each other, push into enemy turret range, damage the turret and get shot
back. Wave interval and composition are data.

### Combat data

Everything a designer tunes lives in `resources/`:

| Resource | What it drives |
|---|---|
| `units/champion_stats.tres` | champion health, damage, range, attack speed, move speed |
| `units/champion_loadout.tres` | champion stats + its four abilities + respawn time |
| `units/enemy_loadout.tres` | the AI champion variant |
| `units/minion_melee.tres`, `minion_ranged.tres` | minion stats, aggro and leash ranges, body shape |
| `units/turret_lane.tres`, `turret_nexus.tres` | turret health, damage, projectile speed |
| `abilities/q_bolt.tres`, `e_dash.tres`, `r_nova.tres`, `f_bulwark.tres` | one file per ability |
| `game/wave_config.tres` | wave interval, composition, lanes, routes, safety cap |
| `game/match_config.tres` | which loadouts, turret tuning, starting enemies |

Turret attack range is the one value the *map* owns rather than the resource,
so the debug range rings and the turrets that draw them can never disagree.

## Architecture

```
MapConfig (Resource)      pure numbers — the only thing a new map must change
   ↓
MapLayout                 numbers → world-space lanes, turrets, camps,
                          objectives, spawns, walkable/blocked/structure shapes
   ↓
MapController             creates the managers, hands each the layout
   ├── NavigationSetup     NavigationRegion3D + runtime NavigationMesh bake
   │    ├── TerrainBuilder ground, merged wall boxes, navigation floor
   │    ├── BaseManager    base floors, nexuses, fountains, lane exits
   │    ├── LaneManager    lane + river footprints, turrets, inhibitors
   │    ├── JungleManager  quadrants, corridors, camps, placeholder monsters
   │    └── ObjectiveManager  arenas, spawn markers, placeholder objectives
   ├── SpawnPointManager   spawn transforms for any unit
   └── MapDebugRenderer    toggleable debug overlay
```

Supporting pieces: `MapShapes` (2D shape vocabulary), `MapEnums` (shared
identifiers), `MapRegistry` (id → data/node), `PrototypeMeshes` (the single
visual factory), `MapProbe` (navigation reachability checks).

### Data-driven, so the map is replaceable

`resources/maps/default_map.tres` holds the tunables; assign a different
`MapConfig` to the `Map` node and everything rebuilds. `compact_map.tres` is a
second, much smaller map used by the smoke test to prove no code assumes the
default dimensions.

Tunables: `lane_width`, `lane_length`, `jungle_width`,
`jungle_entrance_width`, `river_width`, `base_radius`, `nexus_offset`,
`spawn_offset`, `objective_radius`, `objective_offset`, `turret_spacing`,
`turret_base_offset`, `turret_range`, `camp_radius`, `map_half_size`,
`wall_height`, `terrain_cell_size` and the navigation agent settings.

### Terrain and navigation are generated from one description

`MapLayout` describes *where the map is walkable* as a union of bands, disks
and polygons, minus blocked chunks and structure footprints. `TerrainBuilder`
rasterises that description once and greedily merges the cells into two box
sets:

* **walls** — every non-walkable cell, given collision and a `MultiMesh`;
* **navigation floor** — every walkable cell no structure occupies, emitted as
  invisible, physics-inert slabs on a dedicated layer.

`NavigationSetup` bakes the `NavigationMesh` from the navigation floor alone,
so the mesh is exactly the designed walkable footprint: no polygons stranded
on top of walls, and collision, visuals and navigation cannot drift apart.
Enemy units path with `NavigationAgent3D` against that baked mesh — there are
no hardcoded routes anywhere.

### Replacing the placeholder visuals

Every mesh and colour comes from `PrototypeMeshes`. Swapping
`prototype cube terrain → final terrain`, `prototype cylinder turret → final
turret` or `prototype sphere champion → final champion` means changing that
factory (or the handful of call sites that ask it for a mesh); no map,
navigation, input or camera logic refers to a mesh, material, animation, VFX,
UI, audio or networking type.

### Input is separated from gameplay

`PCInputController` reads the keyboard and mouse and drives an
`InputCommands` bus (`move_direction`, `aim_point`, ability/attack/recall
signals). `Champion` and `GameplayCamera` only ever read the bus, so a mobile
joystick and on-screen buttons can replace the PC controller without touching
gameplay. The smoke test relies on exactly this: it drives the bus directly.

### Camera

`GameplayCamera` is an elevated, smoothed, zoomable camera that follows a node
and is clamped to a rectangle handed to it from outside. It has no reference
to the map or the champion beyond those two inputs.

---

## Debug views

**Map debug (`F9`)** — lane centre lines, jungle quadrant outlines and camps,
turret ranges, spawn points and lane/jungle entrances, objective zones, the
baked navigation mesh wireframe, the play field boundary and identifier labels.

**Combat debug (`F10`, on by default)** — per-unit health bars, attack-range
rings for champions and turrets, a line to the current target, and a state line
carrying the minion state machine (`MOVE`/`SEARCH`/`ATTACK`) with its waypoint,
the current movement command, the navigation destination, champion ability
cooldowns and the respawn countdown. Both overlays are read-only: turning them
off changes nothing but the picture.

---

## What is deliberately not implemented

Objective and jungle-camp *behaviour* (the spaces, spawn points and identifiers
are there, the fights are not); win conditions, inhibitor and nexus destruction
rules, waves scaling over time, gold, levels and items; the full Wild Rift
turret rule set (fortification, aggro switching on champion attacks); UI beyond
the development HUD; and audio, animation, VFX and networking.

Camp monsters and objective placeholder meshes still have no colliders, because
nothing in this milestone needs them to.
