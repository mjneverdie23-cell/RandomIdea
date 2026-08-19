@tool
class_name SoloLaneConfig
extends MapConfig

## Map data for the compact one-lane arena.
##
## It reuses every [MapConfig] field that still applies — lane width, base
## radius, turret spacing and range, terrain and navigation settings — and adds
## only what a rectangular single-lane map needs. The jungle, river and
## objective fields inherited from [MapConfig] are simply unused here.
##
## [member map_half_size] is the arena's half *width*; [member lane_length] is
## the distance from the centre to each base centre, so the lane is twice that.

## Half length of the arena along the lane axis (Z).
@export_range(20.0, 300.0, 1.0) var map_half_length: float = 72.0

@export_group("Side terrain")
## Walkable pockets flanking the lane, per side. They overlap the lane edge, so
## they are reachable without needing their own corridors.
@export_range(0, 8, 1) var side_clearing_count: int = 3
@export_range(2.0, 20.0, 0.5) var side_clearing_radius: float = 6.5
## How far along the lane the clearings are spread, measured from the centre.
@export_range(5.0, 200.0, 1.0) var side_clearing_span: float = 26.0
## Solid rock chunks dropped into the clearings for cover, per side.
@export_range(0, 8, 1) var rock_count: int = 2
@export_range(0.5, 10.0, 0.25) var rock_radius: float = 2.25

@export_group("Solo spawns")
## Distance from a base centre, towards the lane, where minion waves appear.
@export_range(1.0, 40.0, 0.5) var minion_spawn_offset: float = 9.0
## Sideways offset of the champion fountain. The nexus sits on the lane axis,
## so a spawn directly behind it would leave the player walking into their own
## base structure; this puts the fountain beside it with a clear run out.
@export_range(0.0, 20.0, 0.5) var spawn_side_offset: float = 5.5

@export_group("Solo towers")
## Distance from a base centre to the inner tower.
@export_range(4.0, 100.0, 0.5) var inner_tower_offset: float = 17.0
## Distance from the inner tower to the outer tower.
@export_range(4.0, 100.0, 0.5) var outer_tower_offset: float = 20.0


func _init() -> void:
	# Defaults tuned for a compact arena rather than the full three-lane map.
	map_half_size = 27.0
	map_border = 7.0
	lane_width = 14.0
	lane_length = 54.0
	base_radius = 15.0
	nexus_offset = 6.0
	spawn_offset = 11.0
	turret_range = 13.0
	turret_radius = 1.9
	turret_height = 7.0
	terrain_cell_size = 1.25
	wall_height = 5.0


## Bases sit at the two ends of the lane axis, team A towards +Z.
func base_center(team: int) -> Vector2:
	return Vector2(0.0, lane_length) if team == MapEnums.Team.A else Vector2(0.0, -lane_length)


## "Away from the map centre", used for nexus and fountain offsets.
func team_corner_dir(team: int) -> Vector2:
	return Vector2(0.0, 1.0) if team == MapEnums.Team.A else Vector2(0.0, -1.0)


## Distances from a base centre to its two towers, inner first.
func tower_offsets() -> PackedFloat32Array:
	return PackedFloat32Array([inner_tower_offset, inner_tower_offset + outer_tower_offset])
