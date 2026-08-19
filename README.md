# RandomIdea — Godot 4 MOBA map prototype

A playable low-poly 3D MOBA prototype in **Godot 4.3**: two game modes sharing
one set of systems — a Wild Rift-style three-lane map and a compact one-lane
arena — with champions, minion waves, turrets, a destructible nexus, damage,
death, respawn and win conditions. Everything on screen is primitive geometry
generated at runtime; the point of the project is the *gameplay spaces,
navigation, combat loop and architecture*, not the art.

## Game modes

| Mode | Map | Players |
|---|---|---|
| **Full MOBA** | three lanes, jungle, river, two neutral objectives | 1 + AI |
| **Solo Lane** | one lane, two towers and one nexus per team | **1v1, both human** |

Pressing Play opens a small menu: pick a mode, then **Play Offline**, **Host
Match** or **Join Match**. A mode is a `GameModeConfig` resource naming a
`MapConfig`, the `MapLayout` subclass that builds it, and a `MatchConfig`;
adding a third mode means adding a resource, not a code path.

```
GameModeConfig -> MapConfig + layout script -> MapLayout -> MapController
               \-> MatchConfig -------------------------> GameDirector
```

Nothing below that line knows which mode is running, or whether the match is
offline, hosted or joined.

## Multiplayer

Solo Lane is a real 1v1: one human champion per team, no AI opponent. The same
scene, map, champion, combat, minion and turret code runs offline, on a host
and on a client — networking is a layer beside gameplay, not inside it.

```
Input -> InputCommands -> [CommandRelay] -> ChampionController -> Components
                              (client sends, authority applies)
```

| Piece | Job |
|---|---|
| `NetworkManager` (autoload `Net`) | owns the peer, role, connection state, latency |
| `NetworkTransport` | how a match reaches the wire; ENet by default |
| `MatchSession` / `PlayerSession` | who is playing, which team, which phase |
| `NetworkSpawner` | replicates champions and minions |
| `NetworkStateSync` | 20 Hz authority snapshots of the units |
| `CommandRelay` | client intent in, validated authority action out |

### Running a match

```bash
godot --path .                                   # menu
godot --path . -- --mode=solo_lane               # offline, straight in
godot --path . -- --mode=solo_lane --host        # host and wait for an opponent
godot --path . -- --mode=solo_lane --join=10.0.0.5 --port=8642
godot --headless --path . -- --mode=solo_lane --dedicated-server
```

**LAN** — one PC hosts and the menu shows its address; the other types that
address and port and joins. Nothing else is needed.

**Online / WAN** — ENet is plain UDP, so a host behind NAT is not reachable
from another network. Rather than pretend otherwise, the same build runs as a
public **dedicated server**: start it headless with `--dedicated-server` on a
host with a reachable address (a small VPS is enough), and both players join
it with `--join=<that address>`. The server seats both teams, simulates
everything and plays no champion of its own. This topology is covered by
`NetDedicatedTest.tscn`.

That is the only external infrastructure required, and it is isolated behind
`NetworkTransport`: a relay or a `WebRTCMultiplayerPeer` plus a signalling
server can be added as another `NetworkTransport` subclass and a `.tres` file,
with no change to any gameplay script.

### Authority

The host (or dedicated server) decides everything: spawning, movement,
damage, health, cooldowns, ability effects, death, respawn, minion and turret
behaviour, nexus damage and victory. Clients send four kinds of request —
movement, ability, attack and recall — and receive results.

Every request passes `CommandRelay._authorise()`, which rejects it unless the
sender is a seated player, the match is running, and that player has a living
champion. Beyond that the request re-enters the ordinary gameplay path, so the
existing components do the rest of the checking: `AbilityComponent` still
tests cooldown and cast validity, `CombatComponent` still tests range, team
and target, `StatsComponent` still supplies the speed. Aim points are clamped
to the play field. A client sends a *point*, never a target — the server picks
the unit itself — so target choice is never client-authored.

On a client every unit has `simulated = false`: it runs no `_think`, no
`move_and_slide`, no timers, and simply interpolates towards the last snapshot.
A client cannot disagree with the server about a result because it never
computes one.

### What is replicated

Position, facing, health and alive flag for every unit at 20 Hz, keyed by a
network id; champion ability cooldowns in the same snapshot; the roster, match
phase and result over reliable RPCs; and one-shot ability flashes as events.
Movement is smoothed between snapshots, and a correction over six metres —
a respawn, recall or dash — snaps instead.

### Connection handling

`Connecting…`, `Waiting for opponent…`, `Connected`, `Opponent disconnected`,
`Host disconnected`, `Connection failed` and `Connection timed out` all appear
in the HUD and the menu. A client that loses its host returns to the menu; a
host whose opponent leaves ends the match rather than continuing into an
invalid state. Reconnect-and-resume is deliberately not implemented.

```
GameModeConfig -> MapConfig + layout script -> MapLayout -> MapController
                \-> MatchConfig -------------------------> GameDirector
```

Nothing below that line knows which mode is running: the same champion,
combat, health, ability, minion, turret, navigation, input and debug systems
serve both maps.

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
| `Enter` | Restart the match |

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
| `F11` | Network debug overlay (role, peer id, latency, roster, snapshots) |
| `F12` | Destroy the enemy nexus (instant win, host only) |
| `Esc` | Back to the multiplayer menu |

`F9` goes through the normal command bus (a shipped build may still expose a
debug view); `F1`–`F8` and `F10` do not.

### Headless / offscreen check

```bash
godot --headless --path . tools/SmokeTest.tscn         # full MOBA
godot --headless --path . tools/SoloLaneTest.tscn      # solo lane, offline
godot --headless --path . tools/NetMatchTest.tscn      # host + client 1v1
godot --headless --path . tools/NetDedicatedTest.tscn  # dedicated server + 2 clients
godot --path . tools/SmokeTest.tscn -- --out=/tmp/shots    # + screenshots
```

The two networking tests launch real extra Godot processes and play a scripted
match over a live ENet connection, so one command covers both sides.

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

`SoloLaneTest.tscn` boots the same scene in Solo Lane and checks the mode's own
criteria: it is running `SoloLaneLayout`/`SoloLaneConfig`; there is exactly one
lane, two towers and one nexus per team and no inhibitors, jungle, river or
objectives; every `SOLO_*` identifier is registered; the bases sit at opposite
ends; the full lane is navigable in both directions and every tower and nexus
is approachable; waves spawn from both minion spawns and march; the enemy
champion's AI brain drives it down the lane; a minion damages the enemy nexus;
and destroying that nexus produces `VICTORY`.

`NetMatchTest.tscn` hosts a Solo Lane match, launches a client process and
checks: the host waits for its opponent instead of starting alone; teams are
assigned one per peer with the host on A; each champion is owned by its own
peer and has its own command bus; a command from an unseated peer is rejected;
the client's movement command reaches the host and moves its champion there;
damage, death and respawn replicate; minions, all four turrets and both
nexuses replicate; the client simulates nothing; the result arrives as
`VICTORY` on the host and `DEFEAT` on the client; and the disconnect unseats
the player.

`NetDedicatedTest.tscn` runs the same build as a dedicated server with no local
player and two client processes, checking that the server seats one team each,
spawns and simulates both champions and the minions, refuses the local-player
cheats it has no business running, and ends the match for both clients.

All exit non-zero on failure.

---

## Solo Lane arena

A compact rectangular map, 54 m wide and 144 m long, built by `SoloLaneLayout`
from `resources/maps/solo_lane_map.tres`:

```
TEAM A BASE  --  INNER  --  OUTER  --  open lane  --  OUTER  --  INNER  --  TEAM B BASE
 nexus, fountain,   z=37     z=17        z=0          z=-17     z=-37      nexus, fountain,
 minion spawn                                                              minion spawn
   z=+54                                                                      z=-54
```

One straight lane runs the whole length. Each base holds a nexus, a fountain,
a champion spawn, a minion spawn and a lane entrance; each team has exactly two
towers and one nexus, and there are no inhibitors, jungle, river or neutral
objectives. Walkable pockets flank the lane with rock cover, and everything
outside them is solid terrain, so the arena funnels play back into the single
lane. Identifiers:

```
SOLO_LANE
SOLO_SPAWN_A            SOLO_SPAWN_B
SOLO_MINION_SPAWN_A     SOLO_MINION_SPAWN_B
SOLO_INNER_TURRET_A     SOLO_INNER_TURRET_B
SOLO_OUTER_TURRET_A     SOLO_OUTER_TURRET_B
SOLO_NEXUS_A            SOLO_NEXUS_B
SOLO_LANE_ENTRANCE_A    SOLO_LANE_ENTRANCE_B
```

`SoloLaneConfig` extends `MapConfig` rather than replacing it, so lane width,
base radius, tower spacing and range, terrain cell size, wall height and every
navigation setting are the same fields the three-lane map uses. It adds only
what a rectangular one-lane map needs: `map_half_length`, the side-clearing and
rock counts, the minion spawn offset and the two tower offsets.

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
gameplay. The tests rely on exactly this: they drive the bus directly.

Networking slots into the same seam. On a client, `CommandRelay` forwards the
local bus to the authority instead of letting it drive anything; on the
authority, each player has their own bus that the relay fills from validated
requests. The champion cannot tell which one it is listening to, which is why
there is no networked champion class.

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

## Win conditions and the enemy AI

Each nexus carries a `NexusController` — the same `Unit` base as everything
else, attached to the structure the map already placed. It has health, takes
damage from minions and champions, and destroying one ends the match: the
director records the outcome, stops the wave spawner, freezes every unit and
raises `match_ended`. The HUD shows a `VICTORY`/`DEFEAT` banner with the match
time and the restart hint. `Enter` reloads the mode, `F11` reloads into the
other one.

`ChampionAi` is still available and still drives the Full MOBA's enemy
champions, but **Solo Lane never uses it** — that mode is 1v1 between humans.
It is a small state machine that only reads and writes the champion's existing
components:

```
PUSH_LANE -> ATTACK_MINIONS -> ATTACK_CHAMPION -> RETREAT -> DEFEND -> DEAD
```

It walks the lane when nothing is happening, prefers an enemy champion over
minions, drops everything to defend a friendly structure that has enemies
standing on it, retreats to its fountain below a health threshold and comes
back out once healed. The same `ChampionController` runs under a player's
command bus or under this brain with no branching inside the champion.

## What is deliberately not implemented

Objective and jungle-camp *behaviour* (the spaces, spawn points and identifiers
are there, the fights are not); inhibitor rules, waves scaling over time, gold,
levels and items; the full Wild Rift turret rule set (fortification, aggro
switching on champion attacks); a front end beyond the launch menu; and audio,
animation and VFX.

On the networking side: no reconnect-and-resume, no client-side prediction or
rollback (a client shows the authority's state a snapshot behind), no lobby
browser or matchmaking service, no NAT traversal of its own — WAN play goes
through the dedicated server described above — and no encryption or
authentication on the wire.

Camp monsters and objective placeholder meshes still have no colliders, because
nothing in this milestone needs them to.
