class_name SpawnPointManager
extends Node3D

## Lookup service for every place a unit can enter the world.
##
## It owns no visuals; it turns layout data into concrete spawn transforms so
## champion, minion and monster systems never need to know the map's shape.

## Spawn roles. A layout may define one of each per team.
const ROLE_CHAMPION := "champion"
const ROLE_MINION := "minion"

var _layout: MapLayout
var _spawns: Dictionary = {}
## "<role>:<team>" -> Marker3D, so gameplay never guesses an identifier.
var _by_role: Dictionary = {}


func build(layout: MapLayout, registry: MapRegistry) -> void:
	_layout = layout
	for child in get_children():
		child.queue_free()
	_spawns.clear()
	_by_role.clear()

	for spawn in _layout.spawn_points:
		var marker := Marker3D.new()
		marker.name = String(spawn["id"])
		marker.position = MapShapes.to_world(spawn["position"])
		var facing: Vector2 = spawn["facing"]
		marker.rotation.y = atan2(facing.x, facing.y)
		add_child(marker)
		_spawns[String(spawn["id"])] = marker
		_by_role[_key(String(spawn.get("role", ROLE_CHAMPION)), int(spawn["team"]))] = marker
		registry.register(String(spawn["id"]), "spawn", spawn, marker)


func _key(role: String, team: int) -> String:
	return "%s:%d" % [role, team]


## Identifier the layout gave this team's champion spawn, whatever it is named.
func spawn_id_for_team(team: int, role: String = ROLE_CHAMPION) -> String:
	for spawn in _layout.spawn_points:
		if int(spawn["team"]) == team and String(spawn.get("role", ROLE_CHAMPION)) == role:
			return String(spawn["id"])
	return ""


func spawn_marker(spawn_id: String) -> Marker3D:
	return _spawns.get(spawn_id, null)


func role_marker(team: int, role: String) -> Marker3D:
	return _by_role.get(_key(role, team), null)


## Spawn transform for a team, optionally scattered so several units spawning
## at once do not stack on top of each other.
func spawn_transform(team: int, scatter_radius: float = 0.0, index: int = 0) -> Transform3D:
	var marker := role_marker(team, ROLE_CHAMPION)
	if marker == null:
		return Transform3D.IDENTITY
	var result := marker.transform
	if scatter_radius > 0.0:
		var angle := TAU * (float(index) * 0.618034)
		result.origin += Vector3(cos(angle), 0.0, sin(angle)) * scatter_radius
	return result


## Where this team's minion waves enter the world, when the layout declares one.
func minion_spawn_position(team: int) -> Vector3:
	var marker := role_marker(team, ROLE_MINION)
	return marker.global_position if marker != null else Vector3.ZERO


func has_minion_spawn(team: int) -> bool:
	return role_marker(team, ROLE_MINION) != null


func spawn_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for key in _spawns.keys():
		out.append(String(key))
	out.sort()
	return out
