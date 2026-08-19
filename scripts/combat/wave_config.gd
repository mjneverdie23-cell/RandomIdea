@tool
class_name WaveConfig
extends Resource

## Everything the minion wave spawner needs. Interval, composition and lane
## selection are data, so retuning the sandbox never touches the spawner.

@export var melee_stats: MinionStats
@export var ranged_stats: MinionStats

@export_group("Composition")
@export_range(0, 12, 1) var melee_per_wave: int = 3
@export_range(0, 12, 1) var ranged_per_wave: int = 2
## Spacing between minions inside the spawned column, in metres.
@export_range(0.5, 8.0, 0.1) var formation_spacing: float = 2.0
@export_range(0.5, 8.0, 0.1) var formation_width: float = 1.7

@export_group("Timing")
@export var auto_start: bool = true
@export_range(0.0, 300.0, 0.5) var first_wave_delay: float = 6.0
@export_range(2.0, 600.0, 0.5) var interval: float = 25.0

@export_group("Routing")
## Lanes that receive waves, as [enum MapEnums.Lane] values.
@export var lanes: Array[int] = [MapEnums.Lane.TOP, MapEnums.Lane.MID, MapEnums.Lane.BOT]
## Number of waypoints sampled along a lane between the two bases.
@export_range(2, 40, 1) var route_samples: int = 12
## Lane fraction the column spawns at, measured from its own base.
@export_range(0.02, 0.4, 0.01) var route_start: float = 0.14
## Lane fraction the column marches to, measured from its own base. 1.0 is the
## enemy base centre, which puts the last waypoint inside nexus aggro range so
## a winning push actually finishes the game.
@export_range(0.5, 1.0, 0.01) var route_end: float = 1.0

@export_group("Safety")
## Hard cap so a long unattended run cannot fill the map with minions.
@export_range(4, 400, 1) var max_alive_per_team: int = 48
