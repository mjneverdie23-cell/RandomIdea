# RandomIdea — Godot 4 MOBA map prototype

A playable low-poly 3D MOBA prototype in **Godot 4.3**, built around a Wild
Rift-style map topology. Everything on screen is primitive geometry generated
at runtime — the point of the project is the *map topology, gameplay spaces,
navigation and architecture*, not the art.

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
| Left click | Basic attack |
| `Q W E R` | Placeholder abilities |
| `B` | Recall (channel, interrupted by moving) |
| `Space` | Toggle camera lock / free pan |
| Mouse wheel | Zoom |
| `F1` | Toggle the debug view |

`W` is bound to both *move forward* and *ability W*, because the brief asks
for WASD movement and Q/W/E/R abilities on one keyboard. That overlap is a
development-input artefact only: the gameplay side receives two independent
commands and a mobile joystick + button layout can drive them separately.

The HUD lists every gameplay space and ticks each one off as you walk into it,
which is the quickest way to run the acceptance test by hand.

### Headless / offscreen check

```bash
godot --headless --path . tools/SmokeTest.tscn                    # verify
godot --path . tools/SmokeTest.tscn -- --out=/tmp/shots           # + screenshots
```

The smoke test boots the real game scene and asserts that the map builds, that
every required identifier exists, that all lanes/jungles/camps/objectives and
the enemy base are reachable from Team A's spawn over the baked navigation
mesh, that movement commands move the champion, that walls stop it, that the
debug view toggles, and that a second map configuration builds and passes the
same checks. It exits non-zero on failure.

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

## Debug view (`F1`)

Lane centre lines, jungle quadrant outlines and camps, turret ranges, spawn
points and lane/jungle entrances, objective zones, the baked navigation mesh
wireframe, the play field boundary and identifier labels for every feature.

---

## What is deliberately not implemented

Turret, minion, objective and camp *behaviour*; damage, health and abilities
beyond cooldowns plus a placeholder pulse; UI beyond the development HUD; and
audio, animation and networking. The map exposes the spaces and identifiers
those systems will need.
