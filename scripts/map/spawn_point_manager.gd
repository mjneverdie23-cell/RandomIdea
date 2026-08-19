class_name SpawnPointManager
extends Node3D

## Lookup service for every place a unit can enter the world.
##
## It owns no visuals; it turns layout data into concrete spawn transforms so
## champion, minion and monster systems never need to know the map's shape.

var _layout: MapLayout
var _spawns: Dictionary = {}


func build(layout: MapLayout, registry: MapRegistry) -> void:
	_layout = layout
	for child in get_children():
		child.queue_free()
	_spawns.clear()

	for spawn in _layout.spawn_points:
		var marker := Marker3D.new()
		marker.name = String(spawn["id"])
		marker.position = MapShapes.to_world(spawn["position"])
		var facing: Vector2 = spawn["facing"]
		marker.rotation.y = atan2(facing.x, facing.y)
		add_child(marker)
		_spawns[String(spawn["id"])] = marker
		registry.register(String(spawn["id"]), "spawn", spawn, marker)


func spawn_id_for_team(team: int) -> String:
	return "TEAM_%s_SPAWN" % MapEnums.team_name(team)


func spawn_marker(spawn_id: String) -> Marker3D:
	return _spawns.get(spawn_id, null)


## Spawn transform for a team, optionally scattered so several units spawning
## at once do not stack on top of each other.
func spawn_transform(team: int, scatter_radius: float = 0.0, index: int = 0) -> Transform3D:
	var marker := spawn_marker(spawn_id_for_team(team))
	if marker == null:
		return Transform3D.IDENTITY
	var result := marker.transform
	if scatter_radius > 0.0:
		var angle := TAU * (float(index) * 0.618034)
		result.origin += Vector3(cos(angle), 0.0, sin(angle)) * scatter_radius
	return result


func spawn_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for key in _spawns.keys():
		out.append(String(key))
	out.sort()
	return out
