# Customization handbook

How to change this prototype without fighting it. Every section names the
files you touch and the ones you should not have to.

The guiding rule of the codebase: **data describes the game, code runs it.**
Numbers live in `.tres` resources, geometry lives in one mesh factory, and each
system talks to its neighbours through a narrow interface. If a change makes
you edit five unrelated scripts, you are probably fighting the grain — check
the [Invariants](#invariants) section before going further.

---

## Where do I change…?

| I want to… | Edit | Code needed |
|---|---|---|
| Retune champion/minion/turret numbers | `resources/units/*.tres` | no |
| Retune an ability | `resources/abilities/*.tres` | no |
| Change wave size or interval | `resources/game/*wave_config.tres` | no |
| Resize a map, move towers, widen a lane | `resources/maps/*.tres` | no |
| Change who spawns and the win rule | `resources/game/*match_config.tres` | no |
| Turn the offline bot on/off | menu checkbox, or `--no-ai` | no |
| Change the network address/port | `resources/net/enet_transport.tres` | no |
| Add a new ability kind | one script in `scripts/combat/abilities/` + a `.tres` | small |
| Add a new map shape | one `MapLayout` subclass + a `MapConfig` subclass | medium |
| Add a game mode | a `GameModeConfig` `.tres` (+ the above if it is a new map) | small |
| Replace the prototype art | `scripts/map/prototype_meshes.gd` + `_build_visual()` | medium |
| Rebind keys | `project.godot` `[input]`, then `PCInputController` | small |
| Add a mobile control scheme | a new node that drives `InputCommands` | small |
| Change AI behaviour | `scripts/units/champion_ai.gd` | small |
| Replicate a new field | `scripts/net/network_state_sync.gd` + `Unit` | small |
| Swap the network transport | a `NetworkTransport` subclass + a `.tres` | small |

---

## 1. Running it

```bash
godot --path .                                          # launch menu
godot --path . -- --mode=solo_lane                      # offline, bot opponent
godot --path . -- --mode=solo_lane --no-ai              # offline, empty lane
godot --path . -- --mode=full_moba                      # three-lane sandbox
godot --path . -- --mode=solo_lane --host               # host a 1v1
godot --path . -- --mode=solo_lane --join=10.0.0.5      # join one
godot --headless --path . -- --mode=solo_lane --dedicated-server
```

The menu is `scripts/ui/multiplayer_menu.gd`. It only emits a launch request
dictionary (`mode_id`, `net`, `address`, `port`, `ai_opponent`) — it never
touches the map or the director, so you can replace it wholesale.

### Tests

```bash
godot --headless --path . tools/SmokeTest.tscn         # full MOBA
godot --headless --path . tools/SoloLaneTest.tscn      # solo lane, offline + bot
godot --headless --path . tools/NetMatchTest.tscn      # host + client 1v1
godot --headless --path . tools/NetDedicatedTest.tscn  # dedicated server + 2 clients
```

Add `-- --out=/tmp/shots` to the first two for screenshots. The two network
tests launch real extra Godot processes; one command covers both sides.

Run all four before committing a change to anything shared.

---

## 2. Tuning numbers (no code)

Everything below is a `.tres` you can open in the inspector.

### Units — `resources/units/`

`UnitStats` (`champion_stats`, `turret_lane`, `turret_nexus`, `nexus`):

| Field | Meaning |
|---|---|
| `max_health`, `health_regen` | health pool and regeneration per second |
| `damage_reduction` | fraction of incoming damage ignored, `0..0.9` |
| `attack_damage`, `attack_range` | per basic attack |
| `attack_speed` | attacks per second (interval is `1 / attack_speed`) |
| `projectile_speed` | **0 = instant hit**, above 0 spawns a travelling shot |
| `move_speed` | metres per second |
| `body_radius`, `body_height` | collider and prototype mesh size |

`MinionStats` adds `body_shape` (BOX/SPHERE/CAPSULE), `aggro_range` (how far it
looks for a fight while marching), `leash_distance` (how far it strays before
disengaging), `corpse_seconds` and `waypoint_tolerance`.

`ChampionLoadout` bundles a `UnitStats` with four abilities and adds
`respawn_time`, `respawn_health_ratio`, `selection_radius` (how close a click
must land to pick an enemy), `chase_selected_target`, `max_chase_distance`,
`recall_duration` and `ai_aggro_range`.

### Abilities — `resources/abilities/`

Shared fields: `id`, `display_name`, `slot` (0–3 = Q, E, R, F), `cooldown`,
`cast_range`, `damage`, `radius`, `duration`, `color`. Then per kind:

| Resource script | Extra fields |
|---|---|
| `ProjectileAbility` | `projectile_speed`, `impact_radius`, `projectile_size` |
| `DashAbility` | `dash_speed` |
| `AreaAbility` | `effect_duration` |
| `BuffAbility` | `damage_reduction_add`, `move_speed_multiplier`, `attack_speed_multiplier`, `heal_amount` |

Slot is carried by the ability, not by its position in the loadout array —
reordering the array changes nothing.

### Waves — `resources/game/wave_config.tres`, `solo_wave_config.tres`

`melee_per_wave` / `ranged_per_wave`, `formation_spacing` / `formation_width`
(the marching column), `first_wave_delay`, `interval`, `auto_start`,
`lanes` (which `MapEnums.Lane` values get waves — `[1]` is mid only),
`route_samples`, `route_start`, `route_end` and `max_alive_per_team`.

> `route_end = 1.0` puts the last waypoint on the enemy base centre, which is
> inside nexus aggro range. Lower it and a winning push can never close out the
> game — minions will stop short of the nexus.

### Match — `resources/game/match_config.tres`, `solo_match_config.tres`

Which loadouts and wave config to use; `nexus_stats`,
`spawn_nexus_controllers`, `nexus_destruction_ends_match`;
`lane_turret_stats`, `nexus_turret_stats`, `turret_tier_health` (per
`MapEnums.TurretTier`: inhibitor, inner, outer), `spawn_turret_controllers`;
`enemy_champion_ai`, `starting_enemy_champions`, `ai_push_target`; and
`combat_debug_on_start`.

`starting_enemy_champions` is how many bots fill the empty seats **offline**.
A networked match always ignores it — those seats belong to humans. See
`GameDirector.ai_opponent_count()`.

### Maps — `resources/maps/`

`MapConfig` covers both maps: `map_half_size`, `map_border`, `lane_width`,
`lane_length`, `river_width`, the `jungle_*` and `camp_*` group, `base_radius`,
`nexus_offset`, `spawn_offset`, the `turret_*` group, `objective_*`,
`terrain_cell_size`, `wall_height` and the `nav_*` group.

`SoloLaneConfig` extends it with `map_half_length`, the `side_clearing_*` and
`rock_*` group, `minion_spawn_offset`, `spawn_side_offset` and the two tower
offsets.

Two navigation values are worth knowing: `nav_agent_radius` must be a multiple
of `nav_cell_size`, and `nav_agent_max_climb` a multiple of `nav_cell_height`,
or the bake rounds them and warns.

`compact_map.tres` exists to prove the architecture is data-driven — the solo
test rebuilds the three-lane map from it and re-runs every reachability check.
Keep it working; it is the canary for hardcoded dimensions.

---

## 3. Changing a map's shape

### Same topology, different size

Edit the `.tres`. `MapLayout` recomputes lane paths, turret positions, jungle
quadrants, spawn points and the walkable description; `TerrainBuilder`
re-rasterises the walls and the navigation floor; `NavigationSetup` re-bakes.
Nothing else needs to know.

### A genuinely new layout

Two files:

**1. A config** — subclass `MapConfig` if you need fields it does not have.
Override `base_center(team)` and `team_corner_dir(team)` if your bases are not
on the default diagonal (see `SoloLaneConfig`).

**2. A layout** — subclass `MapLayout` and override `rebuild()`. Fill these
arrays; leave the ones your map does not use empty and the managers that own
them build nothing:

| Array | Entry keys |
|---|---|
| `lanes` | `id`, `lane`, `path` (`PackedVector2Array`), `length`, `width`, `position` |
| `bases` | `id`, `team`, `position`, `radius`, `lane_entrances` |
| `turrets` | `id`, `kind`, `team`, `lane`, `tier`, `position`, `range` |
| `nexuses` | `id`, `team`, `position` |
| `spawn_points` | `id`, `team`, `role`, `position`, `facing`, `radius` |
| `lane_entrances` | `id`, `team`, `lane`, `position` |
| `jungles`, `camps`, `objectives`, `river` | see `MapLayout` |
| `decor` | `kind` (`floor`/`box`/`cylinder`), `position`, `radius`, `height` |

And describe where the map is walkable:

```gdscript
walkable_shapes.append(MapShapes.disk(centre, radius))
walkable_shapes.append_array(MapShapes.polyline_bands(path, half_width))
blocked_shapes.append(MapShapes.disk(rock, rock_radius))      # carves terrain
structure_shapes.append(MapShapes.disk(turret_pos, radius))   # no wall, no navmesh
```

The difference matters: `blocked_shapes` become solid wall boxes;
`structure_shapes` are cut out of the navigation floor but generate no wall,
because the turret's own mesh and collider already occupy the space.

Override these if your map is not a square:

```gdscript
func play_half_extents() -> Vector2      # half width (X), half length (Z)
func required_ids() -> PackedStringArray # what MapProbe insists exists
func reachability_targets() -> PackedStringArray
func minion_spawn_point(team, lane, fallback_fraction) -> Vector2
```

`SoloLaneLayout` is ~200 lines and does all of the above; copy it as a
starting point.

---

## 4. Adding a game mode

A mode is one `.tres`:

```
id            "my_mode"          # matches --mode=my_mode
display_name  "My Mode"          # shown in the menu
kind          FULL_MOBA | SOLO_LANE
map_config    res://resources/maps/my_map.tres
layout_script res://scripts/map/my_layout.gd   # empty = three-lane default
match_config  res://resources/game/my_match.tres
```

Add it to the `modes` array on the `Main` node in `scenes/Main.tscn`. It
appears in the menu and answers to `--mode=my_mode`. No code changes.

---

## 5. Adding an ability kind

One script and one resource. Subclass `AbilityData`:

```gdscript
@tool
class_name ChainAbility
extends AbilityData

@export_range(1, 10, 1) var bounces: int = 3

func execute(caster: Node3D, aim_point: Vector3) -> bool:
    var centre := clamp_aim(caster, aim_point)
    for unit in Battle.enemies_in_radius(centre, caster.team, radius):
        unit.apply_damage(damage, caster)
    AbilityPulse.spawn(caster.projectile_parent(), centre, radius, color, 0.3)
    return true
```

Save a `.tres` with `slot` set, drop it into a `ChampionLoadout`'s `abilities`
array. `AbilityComponent` handles the slot, the cooldown and the cast gate;
returning `false` leaves the cooldown untouched.

Override `can_cast(caster, aim_point)` for an extra precondition (see
`DashAbility`, which needs a movement component).

---

## 6. Replacing the prototype art

Everything on screen comes from `scripts/map/prototype_meshes.gd`. It is the
only file that knows what a cube is.

**Terrain, lanes, decals, walls** — change the factory functions and the
`COLOR_*` constants. `TerrainBuilder` and the map managers call them and never
build geometry themselves.

**Units** — each controller has one `_build_visual()`:

```gdscript
func _build_visual() -> void:
    var model := preload("res://art/champion.tscn").instantiate()
    visual.add_child(model)
```

`visual` is a plain `Node3D` the unit rotates to face its movement direction;
put your model under it and nothing else changes. Collision comes from
`_build_collision()` and `UnitStats.body_radius`/`body_height`, so keep those
matching your model's footprint.

`TurretController` and `NexusController` deliberately build **no** visual —
the map already drew the structure. They only reach into it on death, to sink
it and grey it out. If your art replaces those structures, update
`_handle_death()` in those two files.

**What you must not do**: give a unit's model a collider on the world layer, or
add colliders to camp monsters and objective placeholders. The navigation mesh
is baked from the map's own floor slabs, and unexpected static colliders will
not match it.

---

## 7. Input

Three layers, and you almost always want the middle one.

```
device            InputCommands (the bus)        gameplay
PCInputController → move_direction, aim_point → ChampionController
mobile joystick  → ability/attack/recall       → GameplayCamera
CommandRelay     → (same signals, from a peer)
```

**Rebinding** — `project.godot` `[input]`, then the action name in
`PCInputController.ABILITY_ACTIONS` or its `_unhandled_input`.

**A new control scheme** (touch, gamepad, a replay driver) — write a node that
calls `set_move_direction`, `set_aim_point`, `request_ability(slot)`,
`request_basic_attack()`, `request_recall()`. Nothing downstream changes; this
is exactly how the network relay works.

**Never** read `Input` from a champion, a camera or an ability. If you do, the
mobile port and the network layer both break.

Current bindings: `WASD` move, `Q E R F` abilities, left click select+attack,
`B` recall, `Space` camera lock, wheel zoom, `Enter` restart, `Esc` menu,
`F1`–`F8` developer commands, `F9` map debug, `F10` combat debug, `F11` network
debug, `F12` destroy the enemy nexus.

Abilities deliberately avoid `WASD` so no key ever means both "move" and
"cast".

---

## 8. The AI opponent

`scripts/units/champion_ai.gd` is a ~150-line state machine attached to a
champion by `GameDirector.spawn_enemy_champion()`. It only reads and writes the
champion's existing components, so the same `ChampionController` runs under a
player's command bus or under a brain.

```
PUSH_LANE → ATTACK_MINIONS → ATTACK_CHAMPION → RETREAT → DEFEND → DEAD
```

Tuning without code: `retreat_health_ratio`, `recover_health_ratio`,
`defend_radius`, `think_interval` on the node; `ai_aggro_range` on the loadout;
`ai_push_target` (lane fraction it walks to) and `starting_enemy_champions` on
the match config.

**Adding a state**: add it to the `State` enum and `STATE_NAMES`, decide it in
`_choose_state()`, act on it in `_act()`. The name shows up in the combat debug
overlay automatically.

**Turning it off**: uncheck *AI opponent* in the menu, pass `--no-ai`, or set
`starting_enemy_champions = 0`. `ai_opponents_enabled` on the director is the
runtime switch; `ai.enabled = false` freezes a single bot in place, which is
what the tests use to isolate a check.

The AI is offline-only by construction — `ai_opponent_count()` returns 0 for
any networked match, because those seats are held for humans.

---

## 9. Networking

### The shape of it

```
Input → InputCommands → [CommandRelay] → ChampionController → Components
                          client sends, authority applies
```

| File | Job |
|---|---|
| `scripts/net/network_manager.gd` | autoload `Net`: peer, role, connection state, latency |
| `scripts/net/network_transport.gd` | config → `MultiplayerPeer` |
| `scripts/net/match_session.gd` | roster, team assignment, match phase |
| `scripts/net/player_session.gd` | one player: peer, team, champion, command bus |
| `scripts/net/network_spawner.gd` | replicates champions and minions |
| `scripts/net/network_state_sync.gd` | 20 Hz authority snapshots |
| `scripts/net/command_relay.gd` | client intent in, validated action out |

### Authority

The host (or dedicated server) decides everything. A client sends four kinds of
request and receives results. `Unit.simulated` is `false` on a client: no
`_think`, no `move_and_slide`, no timers — it interpolates towards the last
snapshot. **A client cannot disagree with the server about a result because it
never computes one.**

If you add gameplay that mutates state, put it behind `simulated` or behind
`Net.is_authority()`. The pattern to copy is `ChampionController._process()`,
which will not run a respawn timer on a client.

### Replicating a new field

Three edits:

1. On `Unit` (or a subclass), add the field and apply it in
   `apply_network_state()`.
2. In `NetworkStateSync._broadcast()`, append it to `values`.
3. In `_receive_snapshot()`, read it back at the same stride.

Keep the stride constant and update both sides together. Cosmetic one-shots
(flashes, sounds) should use `broadcast_effect()` instead — they do not belong
in a per-tick snapshot.

### Accepting a new client command

Add a signal to `InputCommands`, an RPC to `CommandRelay`, and route it through
`_authorise()`:

```gdscript
@rpc("any_peer", "call_remote", "reliable")
func _request_ping_map(point: Vector3) -> void:
    var player := _authorise()
    if player == null:
        return
    player.commands.set_aim_point(_sanitise_aim(point))
    player.commands.request_map_ping()
```

`_authorise()` rejects anything from an unseated peer, a peer with no living
champion, or a match that is not running. Past that, the existing components do
the real checking — cooldown, range, team, target. Keep it that way: **a client
sends a point, never a target**, so target choice stays server-side.

### Swapping the transport

`NetworkTransport` is a `Resource` with `create_server()` and
`create_client()`. Subclass it, save a `.tres`, and assign it to the `Main`
node's `transport` property. Nothing in gameplay changes.

That is the extension point for a relay or a `WebRTCMultiplayerPeer` plus a
signalling server.

### WAN today

ENet is plain UDP, so a host behind NAT is unreachable. The supported path is
to run the same build as a public dedicated server:

```bash
# on a host with a reachable address (a small VPS is enough)
godot --headless --path . -- --mode=solo_lane --dedicated-server --port=8642
# both players
godot --path . -- --mode=solo_lane --join=<that address> --port=8642
```

The server seats both teams, simulates everything and plays no champion. This
is the topology `NetDedicatedTest.tscn` covers.

---

## 10. Debug tooling

| Key | Overlay | Source |
|---|---|---|
| `F9` | map: lane lines, camps, turret ranges, spawns, navmesh, bounds, ids | `map_debug_renderer.gd` |
| `F10` | combat: health bars, ranges, target lines, minion state, cooldowns | `combat_debug_overlay.gd` |
| `F11` | network: role, peer id, state, latency, roster, snapshots | `network_debug_overlay.gd` |

All three are read-only. Turning them off changes nothing but the picture.

The combat overlay draws range rings for champions and turrets only — a ring on
each of thirty minions buries the map it is meant to explain. Change
`_wants_range_ring()` if you disagree.

Developer keys `F1`–`F8` live in `dev_input_controller.gd`, deliberately apart
from gameplay: deleting that node removes every cheat and leaves the sandbox
intact. Cheats that pick a winner are gated on `Net.has_local_player()`, so a
dedicated server refuses them.

---

## 11. Tests

| Suite | Covers |
|---|---|
| `SmokeTest.tscn` | three-lane map, navigation, movement, collision, selection, attacks, abilities, death/respawn, waves, minion and turret combat, both debug views, and a rebuild from a second `MapConfig` |
| `SoloLaneTest.tscn` | solo topology and ids, lane traversal both ways, spawns, waves, the offline bot, minions damaging the nexus, victory |
| `NetMatchTest.tscn` | host + client: seating, ownership, rejection of unseated peers, input reaching the host, replication of movement/damage/death/respawn/minions/turrets/nexus/result, disconnect |
| `NetDedicatedTest.tscn` | dedicated server + two clients, one team each, opposite outcomes |

Writing a new one: copy the shape of `solo_lane_test.gd` — instantiate
`scenes/Main.tscn` with `GameRoot._pending_mode_id` set (this skips the menu),
`await` physics frames rather than process frames when you need deterministic
movement, and assert with `_expect()` so every failure is reported at once.

For anything involving two peers, copy `net_match_test.gd`: it launches a real
second Godot process with `OS.create_process()` and reads its report back from
a file, so one command covers both sides.

Isolate before you assert. Lane traffic and a wandering bot will invalidate a
timing-sensitive check; `_isolate_arena()` / `_clear_lane()` stop the waves,
free the minions and park the AI first.

---

## Invariants

Things that keep the architecture from collapsing. Break one and the symptom
usually shows up somewhere far away.

1. **The map layer never imports combat.** `MapController` and its managers
   build geometry and register identifiers. `GameDirector` attaches behaviour
   to what the map placed — that is why `TurretController` and
   `NexusController` bind to a structure instead of replacing it.
2. **Gameplay never reads `Input`.** It reads `InputCommands`. This is what
   makes the mobile port, the network relay and the headless tests possible.
3. **Numbers live in resources.** If you find yourself typing a damage value
   into a behaviour script, it belongs in a `.tres`.
4. **One mesh factory.** `PrototypeMeshes` plus each unit's `_build_visual()`.
   No other file creates geometry.
5. **Identifiers, not node paths.** Gameplay finds map features through
   `MapRegistry` by stable id (`SOLO_NEXUS_B`, `TOP_OUTER_TURRET_A`). Node
   paths are an implementation detail — Godot rewrites duplicate names, which
   is why `Unit.display_label()` exists.
6. **The walkable description is the single source of truth for terrain.**
   Collision, wall meshes and the navigation mesh are all rasterised from it,
   so they cannot drift apart. Do not hand-place a wall.
7. **The authority decides; clients render.** Any new state that affects a
   result must be computed on the authority and replicated.
8. **Every unit is a `Unit`.** No parallel hierarchy for networked, AI or
   player-controlled units — those are flags and attached nodes, not classes.

---

## Gotchas found the hard way

These all cost real debugging time; they are written down so they only cost it
once.

- **Navigation on top of walls.** Baking a navmesh from wall colliders puts
  polygons on their roofs. The fix in place: bake only from invisible floor
  slabs emitted by `TerrainBuilder`, never from the walls.
- **Navigation queries before the first server sync** fail with a confusing
  error. `MovementComponent` holds a destination until the map is live; if you
  add another agent, do the same.
- **`HealthComponent.kill()` bypasses damage reduction** on purpose. Applying
  `current` as damage leaves a 15%-reduction turret alive at 15%.
- **Freed targets.** `TargetingComponent` follows its target's `tree_exiting`
  so nothing ever holds a freed node. Copy that if you cache a unit reference.
- **A structure on the lane axis blocks the spawn.** The solo fountain had to
  move sideways because the nexus sat between it and the lane. Walk the route
  out of every base after you move anything.
- **Minions must reach the nexus.** `route_end` below `1.0` leaves them outside
  aggro range and no push can ever win.
- **Test isolation.** A check that measures damage over 1 second while the
  champion's attack interval is 1.11 s measures nothing. Match the window to
  the mechanic.
- **Godot renames duplicate node names** to `@Name@id`. Never show a node name
  in UI or match on it; use `display_label()` and net ids.
- **RPCs route by node path**, so a scene instanced under differently-named
  parents on two peers will silently fail to talk. Both network tests name
  their root `NetTest` for exactly this reason.
