@tool
class_name MapConfig
extends Resource

## Pure data description of a MOBA map.
##
## Nothing in here knows about meshes, materials, scenes or gameplay systems.
## [MapLayout] turns these numbers into concrete world-space geometry, and the
## map builders turn that geometry into nodes. Swapping this resource (or
## editing the values below) is enough to produce a differently shaped map.

## Half the side length of the square play field, in metres.
## The map is an axis-aligned square from (-size, -size) to (size, size) whose
## two team corners sit on the -X/+Z and +X/-Z diagonals.
@export_range(30.0, 200.0, 1.0) var map_half_size: float = 65.0

## Extra solid border generated outside the play field.
@export_range(0.0, 30.0, 0.5) var map_border: float = 8.0

@export_group("Lanes")
## Walkable width of every lane. Should comfortably fit several units abreast.
@export_range(4.0, 40.0, 0.5) var lane_width: float = 13.0
## Distance from the map centre to the outer lane legs (top/bot lane corners).
## Also fixes the base centres, which sit on the same offset.
@export_range(10.0, 200.0, 1.0) var lane_length: float = 46.0

@export_group("River")
@export_range(4.0, 40.0, 0.5) var river_width: float = 15.0

@export_group("Jungle")
## Solid terrain kept between a jungle quadrant and the lanes/river bounding it.
@export_range(0.0, 30.0, 0.5) var jungle_width: float = 11.0
## Width of the corridors that connect a jungle quadrant to lanes/river/base.
@export_range(2.0, 20.0, 0.5) var jungle_entrance_width: float = 7.0
## Radius of a jungle camp clearing.
@export_range(1.0, 15.0, 0.5) var camp_radius: float = 4.0
## Radius of the solid terrain chunk in the middle of each jungle quadrant.
@export_range(0.0, 15.0, 0.5) var jungle_wall_radius: float = 2.5

@export_group("Bases")
@export_range(5.0, 60.0, 0.5) var base_radius: float = 18.0
## How far the nexus sits from the base centre, towards the map corner.
@export_range(0.0, 30.0, 0.5) var nexus_offset: float = 7.0
## How far the fountain/spawn sits from the base centre, towards the map corner.
@export_range(0.0, 40.0, 0.5) var spawn_offset: float = 13.0

@export_group("Turrets")
## Distance from the base centre to the first (inhibitor) turret of a lane,
## measured along the lane and expressed against [member turret_reference_length].
@export_range(4.0, 60.0, 0.5) var turret_base_offset: float = 20.0
## Distance between consecutive turrets of the same lane.
@export_range(4.0, 60.0, 0.5) var turret_spacing: float = 22.0
## Lane half-length the two values above are authored against. Shorter lanes
## scale their turret distances down so the two teams never overlap.
@export_range(10.0, 200.0, 1.0) var turret_reference_length: float = 92.0
@export_range(1.0, 30.0, 0.5) var turret_range: float = 14.0
@export_range(0.5, 6.0, 0.1) var turret_radius: float = 1.9
@export_range(1.0, 12.0, 0.1) var turret_height: float = 7.0

@export_group("Objectives")
## Radius of the neutral objective arenas that sit on the river.
@export_range(4.0, 30.0, 0.5) var objective_radius: float = 11.0
## Distance of each objective arena from the map centre, along the river.
@export_range(5.0, 120.0, 0.5) var objective_offset: float = 42.0

@export_group("Bushes")
## Radius of every bush this map places.
@export_range(1.0, 20.0, 0.5) var bush_radius: float = 5.0
## How far a lane bush sits from the lane centre line.
@export_range(0.0, 40.0, 0.5) var bush_lane_offset: float = 9.0

@export_group("Terrain")
## Rasterisation cell size used to turn the walkable description into walls.
@export_range(0.5, 4.0, 0.25) var terrain_cell_size: float = 1.5
@export_range(1.0, 12.0, 0.5) var wall_height: float = 5.0

@export_group("Navigation")
@export_range(0.05, 1.0, 0.05) var nav_cell_size: float = 0.25
@export_range(0.05, 1.0, 0.05) var nav_cell_height: float = 0.25
## Kept a multiple of [member nav_cell_size] so baking does not round it.
@export_range(0.2, 4.0, 0.05) var nav_agent_radius: float = 1.25
@export_range(0.5, 4.0, 0.1) var nav_agent_height: float = 2.0
## Kept a multiple of [member nav_cell_height].
@export_range(0.0, 2.0, 0.05) var nav_agent_max_climb: float = 0.5
@export_range(1.0, 60.0, 1.0) var nav_agent_max_slope: float = 30.0


func lane_half_width() -> float:
	return lane_width * 0.5


func river_half_width() -> float:
	return river_width * 0.5


## Team corner directions on the XZ plane. Team A owns -X/+Z, team B owns +X/-Z.
func team_corner_dir(team: int) -> Vector2:
	return Vector2(-1.0, 1.0).normalized() if team == MapEnums.Team.A else Vector2(1.0, -1.0).normalized()


## World-space centre of a team base.
func base_center(team: int) -> Vector2:
	return Vector2(-lane_length, lane_length) if team == MapEnums.Team.A else Vector2(lane_length, -lane_length)


## The two off-mid map corners the outer lanes wrap around.
## TOP wraps the -X/-Z corner, BOT wraps the +X/+Z corner.
func lane_corner(lane: int) -> Vector2:
	return Vector2(-lane_length, -lane_length) if lane == MapEnums.Lane.TOP else Vector2(lane_length, lane_length)


## Distances from a base centre at which the three lane turrets are placed,
## normalised against [member turret_reference_length].
func turret_offsets() -> PackedFloat32Array:
	var out := PackedFloat32Array()
	for i in 3:
		out.append((turret_base_offset + float(i) * turret_spacing) / turret_reference_length)
	return out
