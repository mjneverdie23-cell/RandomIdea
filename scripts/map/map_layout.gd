class_name MapLayout
extends RefCounted

## Turns a [MapConfig] into concrete world-space map data: lane paths, turret
## slots, jungle quadrants, camps, objectives, spawns and the walkable/blocked
## description the terrain and navigation builders consume.
##
## This class only produces numbers and identifiers. It never touches nodes,
## meshes or materials, which is what makes the visual layer replaceable.

var config: MapConfig

## Every entry has at least an "id" key, and a "position" (Vector2, XZ plane).
var lanes: Array[Dictionary] = []
var bases: Array[Dictionary] = []
var turrets: Array[Dictionary] = []
var inhibitors: Array[Dictionary] = []
var nexuses: Array[Dictionary] = []
var spawn_points: Array[Dictionary] = []
var lane_entrances: Array[Dictionary] = []
var jungles: Array[Dictionary] = []
var camps: Array[Dictionary] = []
var objectives: Array[Dictionary] = []
var river: Dictionary = {}

## Union of these is walkable, minus the union of [member blocked_shapes].
var walkable_shapes: Array[Dictionary] = []
var blocked_shapes: Array[Dictionary] = []
## Footprints of solid structures (turrets, inhibitors, nexuses). They are cut
## out of the navigation floor but do not generate terrain walls, because the
## structure's own mesh and collider already occupy the space.
var structure_shapes: Array[Dictionary] = []

## Relative barycentric placement of camps inside a jungle quadrant, expressed
## as weights over (base corner, outer corner, map centre) of the quadrant.
const CAMP_WEIGHTS := {
	MapEnums.CampSize.BUFF: Vector3(0.58, 0.21, 0.21),
	MapEnums.CampSize.LARGE: Vector3(0.21, 0.58, 0.21),
	MapEnums.CampSize.MEDIUM: Vector3(0.21, 0.21, 0.58),
	MapEnums.CampSize.SMALL: Vector3(0.44, 0.44, 0.12),
}


func _init(map_config: MapConfig = null) -> void:
	config = map_config if map_config != null else MapConfig.new()
	rebuild()


func rebuild() -> void:
	lanes.clear()
	bases.clear()
	turrets.clear()
	inhibitors.clear()
	nexuses.clear()
	spawn_points.clear()
	lane_entrances.clear()
	jungles.clear()
	camps.clear()
	objectives.clear()
	walkable_shapes.clear()
	blocked_shapes.clear()
	structure_shapes.clear()

	_build_lanes()
	_build_river()
	_build_bases()
	_build_turrets()
	_build_jungles()
	_build_objectives()


# --- lanes -------------------------------------------------------------------

func _lane_path(lane: int) -> PackedVector2Array:
	var a := config.base_center(MapEnums.Team.A)
	var b := config.base_center(MapEnums.Team.B)
	if lane == MapEnums.Lane.MID:
		return PackedVector2Array([a, b])
	return PackedVector2Array([a, config.lane_corner(lane), b])


func _build_lanes() -> void:
	for lane in [MapEnums.Lane.TOP, MapEnums.Lane.MID, MapEnums.Lane.BOT]:
		var path := _lane_path(lane)
		var entry := {
			"id": "%s_LANE" % MapEnums.lane_name(lane),
			"lane": lane,
			"path": path,
			"length": MapShapes.polyline_length(path),
			"width": config.lane_width,
			"position": MapShapes.point_along_polyline(path, MapShapes.polyline_length(path) * 0.5),
		}
		lanes.append(entry)
		walkable_shapes.append_array(MapShapes.polyline_bands(path, config.lane_half_width()))


func lane_data(lane: int) -> Dictionary:
	for entry in lanes:
		if int(entry["lane"]) == lane:
			return entry
	return {}


## Distance along a lane measured from [param team]'s base.
func _lane_distance_from_base(lane_entry: Dictionary, team: int, distance: float) -> Vector2:
	var path: PackedVector2Array = lane_entry["path"]
	var length: float = lane_entry["length"]
	if team == MapEnums.Team.A:
		return MapShapes.point_along_polyline(path, distance)
	return MapShapes.point_along_polyline(path, length - distance)


# --- river -------------------------------------------------------------------

func _build_river() -> void:
	var reach := config.lane_length + config.river_width * 0.5
	var path := PackedVector2Array([Vector2(-reach, -reach), Vector2(reach, reach)])
	river = {
		"id": "RIVER",
		"path": path,
		"width": config.river_width,
		"position": Vector2.ZERO,
	}
	walkable_shapes.append_array(MapShapes.polyline_bands(path, config.river_half_width()))


func river_direction() -> Vector2:
	return Vector2(1.0, 1.0).normalized()


# --- bases -------------------------------------------------------------------

func _build_bases() -> void:
	for team in [MapEnums.Team.A, MapEnums.Team.B]:
		var team_id := MapEnums.team_name(team)
		var center := config.base_center(team)
		var corner_dir := config.team_corner_dir(team)
		var nexus_pos := center + corner_dir * config.nexus_offset
		var spawn_pos := center + corner_dir * config.spawn_offset
		var entrances: Dictionary = {}

		for lane_entry in lanes:
			var lane: int = lane_entry["lane"]
			var pos := _lane_distance_from_base(lane_entry, team, config.base_radius)
			var entrance_id := "TEAM_%s_%s_LANE_ENTRANCE" % [team_id, MapEnums.lane_name(lane)]
			var entrance := {
				"id": entrance_id,
				"team": team,
				"lane": lane,
				"position": pos,
			}
			lane_entrances.append(entrance)
			entrances[lane] = entrance_id

		bases.append({
			"id": "TEAM_%s_BASE" % team_id,
			"team": team,
			"position": center,
			"radius": config.base_radius,
			"lane_entrances": entrances,
		})
		nexuses.append({
			"id": "TEAM_%s_NEXUS" % team_id,
			"team": team,
			"position": nexus_pos,
		})
		structure_shapes.append(MapShapes.disk(nexus_pos, 4.6))
		spawn_points.append({
			"id": "TEAM_%s_SPAWN" % team_id,
			"team": team,
			"position": spawn_pos,
			# Face the map centre so a champion spawns looking down mid.
			"facing": (Vector2.ZERO - spawn_pos).normalized(),
			"radius": config.base_radius * 0.35,
		})
		walkable_shapes.append(MapShapes.disk(center, config.base_radius))


func base_data(team: int) -> Dictionary:
	for entry in bases:
		if int(entry["team"]) == team:
			return entry
	return {}


func spawn_position(team: int) -> Vector2:
	for entry in spawn_points:
		if int(entry["team"]) == team:
			return entry["position"]
	return Vector2.ZERO


# --- turrets and inhibitors --------------------------------------------------

func _build_turrets() -> void:
	var fractions := config.turret_offsets()
	for team in [MapEnums.Team.A, MapEnums.Team.B]:
		for lane_entry in lanes:
			var lane: int = lane_entry["lane"]
			var half_length: float = float(lane_entry["length"]) * 0.5
			var inhib_distance := 0.0
			for tier in fractions.size():
				var distance: float = fractions[tier] * half_length
				if tier == MapEnums.TurretTier.INHIBITOR:
					inhib_distance = distance
				structure_shapes.append(MapShapes.disk(
					_lane_distance_from_base(lane_entry, team, distance), config.turret_radius + 0.4
				))
				turrets.append({
					"id": MapEnums.turret_id(lane, tier, team),
					"kind": "lane",
					"team": team,
					"lane": lane,
					"tier": tier,
					"position": _lane_distance_from_base(lane_entry, team, distance),
					"range": config.turret_range,
				})
			var inhibitor_position := _lane_distance_from_base(lane_entry, team, inhib_distance * 0.55)
			structure_shapes.append(MapShapes.disk(inhibitor_position, 2.4))
			inhibitors.append({
				"id": "%s_INHIBITOR_%s" % [MapEnums.lane_name(lane), MapEnums.team_name(team)],
				"team": team,
				"lane": lane,
				"position": inhibitor_position,
			})
		_build_nexus_turrets(team)


func _build_nexus_turrets(team: int) -> void:
	var center := config.base_center(team)
	var corner_dir := config.team_corner_dir(team)
	var side_dir := Vector2(-corner_dir.y, corner_dir.x)
	var flank := config.base_radius * 0.55
	var forward := config.nexus_offset * 0.5
	for i in 2:
		var sign_i := 1.0 if i == 0 else -1.0
		var position := center + corner_dir * forward + side_dir * flank * sign_i
		structure_shapes.append(MapShapes.disk(position, config.turret_radius * 1.2 + 0.4))
		turrets.append({
			"id": "TEAM_%s_NEXUS_TURRET_%d" % [MapEnums.team_name(team), i + 1],
			"kind": "nexus",
			"team": team,
			"lane": -1,
			"tier": MapEnums.TurretTier.INHIBITOR,
			"position": position,
			"range": config.turret_range,
		})


func turret_data(turret_id: String) -> Dictionary:
	for entry in turrets:
		if String(entry["id"]) == turret_id:
			return entry
	return {}


# --- jungle ------------------------------------------------------------------

## Each jungle quadrant is the triangle bounded by an outer lane, mid lane and
## the river, inset by [member MapConfig.jungle_width] so solid terrain remains
## between the quadrant and the lanes around it.
func _build_jungles() -> void:
	for team in [MapEnums.Team.A, MapEnums.Team.B]:
		for side in [MapEnums.Side.TOP, MapEnums.Side.BOT]:
			_build_jungle_quadrant(team, side)


func _build_jungle_quadrant(team: int, side: int) -> void:
	var lane: int = MapEnums.Lane.TOP if side == MapEnums.Side.TOP else MapEnums.Lane.BOT
	var base_corner := config.base_center(team)
	var outer_corner := config.lane_corner(lane)
	var center_corner := Vector2.ZERO
	var polygon := MapShapes.inset_triangle(base_corner, outer_corner, center_corner, config.jungle_width)
	var centroid := MapShapes.polygon_centroid(polygon)
	var jungle_id := MapEnums.jungle_id(team, side)
	# The quadrant's representative point has to stay walkable, so nudge it off
	# the solid chunk that sits in the middle of the pocket.
	var hub := centroid
	if config.jungle_wall_radius > 0.0:
		var away := (polygon[0] - centroid).normalized()
		hub = centroid + away * (config.jungle_wall_radius + config.camp_radius * 0.8)

	var entry := {
		"id": jungle_id,
		"team": team,
		"side": side,
		"lane": lane,
		"polygon": polygon,
		"position": hub,
		"centroid": centroid,
		"camps": PackedStringArray(),
		"entrances": [],
	}
	walkable_shapes.append(MapShapes.poly(polygon))
	if config.jungle_wall_radius > 0.0:
		blocked_shapes.append(MapShapes.disk(centroid, config.jungle_wall_radius))

	for size in [MapEnums.CampSize.SMALL, MapEnums.CampSize.MEDIUM, MapEnums.CampSize.LARGE, MapEnums.CampSize.BUFF]:
		var w: Vector3 = CAMP_WEIGHTS[size]
		var pos: Vector2 = polygon[0] * w.x + polygon[1] * w.y + polygon[2] * w.z
		var camp_id := MapEnums.camp_id(team, side, size)
		camps.append({
			"id": camp_id,
			"jungle": jungle_id,
			"team": team,
			"side": side,
			"size": size,
			"position": pos,
			"radius": config.camp_radius,
		})
		entry["camps"].append(camp_id)
		walkable_shapes.append(MapShapes.disk(pos, config.camp_radius))

	# Corridors out of the quadrant: outer lane, mid lane, river and own base.
	var half_entrance := config.jungle_entrance_width * 0.5
	var targets := {
		"LANE": _closest_point_on_lane(lane, (polygon[0] + polygon[1]) * 0.5),
		"MID": _closest_point_on_lane(MapEnums.Lane.MID, (polygon[0] + polygon[2]) * 0.5),
		"RIVER": MapShapes.project_on_line((polygon[1] + polygon[2]) * 0.5, Vector2.ZERO, river_direction()),
		"BASE": base_corner,
	}
	var sources := {
		"LANE": (polygon[0] + polygon[1]) * 0.5,
		"MID": (polygon[0] + polygon[2]) * 0.5,
		"RIVER": (polygon[1] + polygon[2]) * 0.5,
		"BASE": polygon[0],
	}
	for key in ["LANE", "MID", "RIVER", "BASE"]:
		var from: Vector2 = sources[key]
		var to: Vector2 = targets[key]
		var entrance := {
			"id": "%s_ENTRANCE_%s" % [jungle_id, key],
			"jungle": jungle_id,
			"kind": key,
			"position": from.lerp(to, 0.5),
			"from": from,
			"to": to,
		}
		entry["entrances"].append(entrance)
		lane_entrances.append(entrance)
		walkable_shapes.append(MapShapes.band(from, to, half_entrance))

	jungles.append(entry)


func _closest_point_on_lane(lane: int, from: Vector2) -> Vector2:
	var entry := lane_data(lane)
	if entry.is_empty():
		return from
	var path: PackedVector2Array = entry["path"]
	var best := path[0]
	var best_distance := INF
	for i in range(path.size() - 1):
		var candidate := Geometry2D.get_closest_point_to_segment(from, path[i], path[i + 1])
		var d := from.distance_squared_to(candidate)
		if d < best_distance:
			best_distance = d
			best = candidate
	return best


# --- objectives --------------------------------------------------------------

func _build_objectives() -> void:
	var dir := river_direction()
	for side in [MapEnums.Side.TOP, MapEnums.Side.BOT]:
		var sign_side := -1.0 if side == MapEnums.Side.TOP else 1.0
		var pos := dir * config.objective_offset * sign_side
		objectives.append({
			"id": "%s_OBJECTIVE" % MapEnums.SIDE_NAMES[side],
			"side": side,
			"position": pos,
			"radius": config.objective_radius,
			"spawn": pos,
		})
		walkable_shapes.append(MapShapes.disk(pos, config.objective_radius))


# --- queries -----------------------------------------------------------------

## Point at fraction [param t] (0 = team A base, 1 = team B base) along a lane.
func lane_point(lane: int, t: float) -> Vector2:
	var entry := lane_data(lane)
	if entry.is_empty():
		return Vector2.ZERO
	return MapShapes.point_along_polyline(entry["path"], float(entry["length"]) * clampf(t, 0.0, 1.0))


## Point at fraction [param t] (0 = top objective end, 1 = bot objective end)
## along the river.
func river_point(t: float) -> Vector2:
	var path: PackedVector2Array = river["path"]
	return MapShapes.point_along_polyline(path, MapShapes.polyline_length(path) * clampf(t, 0.0, 1.0))


func is_walkable(point: Vector2) -> bool:
	if not MapShapes.contains_any(walkable_shapes, point):
		return false
	return not MapShapes.contains_any(blocked_shapes, point)


## Identifier of the gameplay space a point sits in, most specific first.
## Returns an empty string for solid terrain outside every space.
func area_at(point: Vector2) -> String:
	for camp in camps:
		if point.distance_to(camp["position"]) <= float(camp["radius"]):
			return String(camp["id"])
	for base in bases:
		if point.distance_to(base["position"]) <= float(base["radius"]):
			return String(base["id"])
	for objective in objectives:
		if point.distance_to(objective["position"]) <= float(objective["radius"]):
			return String(objective["id"])
	for jungle in jungles:
		if Geometry2D.is_point_in_polygon(point, jungle["polygon"]):
			return String(jungle["id"])
	if not river.is_empty():
		var path: PackedVector2Array = river["path"]
		if MapShapes.distance_to_segment(point, path[0], path[path.size() - 1]) <= river_half_width_value():
			return String(river["id"])
	for lane_entry in lanes:
		var lane_path: PackedVector2Array = lane_entry["path"]
		for i in range(lane_path.size() - 1):
			if MapShapes.distance_to_segment(point, lane_path[i], lane_path[i + 1]) <= config.lane_half_width():
				return String(lane_entry["id"])
	return ""


func river_half_width_value() -> float:
	return float(river["width"]) * 0.5 if not river.is_empty() else 0.0


func play_field_half_size() -> float:
	return config.map_half_size


func outer_half_size() -> float:
	return config.map_half_size + config.map_border


## Axis-aligned bounds of the playable square on the XZ plane.
func play_bounds() -> Rect2:
	var h := play_field_half_size()
	return Rect2(-h, -h, h * 2.0, h * 2.0)
