class_name MapRegistry
extends RefCounted

## Stable-identifier lookup for everything the map builds.
##
## Gameplay systems (turret logic, minion waves, objective timers, AI) address
## map features by string id such as "TOP_OUTER_TURRET_A" or "TEAM_A_SPAWN"
## instead of by node path, so the map can be rebuilt or replaced underneath
## them without breaking references.

var _entries: Dictionary = {}


## [param data] is the layout dictionary for the feature; [param node] is the
## optional node that represents it in the world.
func register(id: String, kind: String, data: Dictionary, node: Node3D = null) -> void:
	if id.is_empty():
		push_warning("MapRegistry: refusing to register an empty identifier.")
		return
	if _entries.has(id):
		push_warning("MapRegistry: duplicate identifier '%s'." % id)
	_entries[id] = {"id": id, "kind": kind, "data": data, "node": node}


func clear() -> void:
	_entries.clear()


func has(id: String) -> bool:
	return _entries.has(id)


func get_entry(id: String) -> Dictionary:
	return _entries.get(id, {})


func get_data(id: String) -> Dictionary:
	var entry: Dictionary = _entries.get(id, {})
	return entry.get("data", {})


func get_node_for(id: String) -> Node3D:
	var entry: Dictionary = _entries.get(id, {})
	return entry.get("node", null)


## World position of a registered feature, or [param fallback] when unknown.
func get_position(id: String, fallback: Vector3 = Vector3.ZERO) -> Vector3:
	var entry: Dictionary = _entries.get(id, {})
	if entry.is_empty():
		return fallback
	var node: Node3D = entry.get("node", null)
	if node != null and is_instance_valid(node):
		return node.global_position
	var data: Dictionary = entry.get("data", {})
	if data.has("position"):
		var p = data["position"]
		if p is Vector2:
			return Vector3(p.x, 0.0, p.y)
		if p is Vector3:
			return p
	return fallback


func ids() -> PackedStringArray:
	var out := PackedStringArray()
	for key in _entries.keys():
		out.append(key)
	out.sort()
	return out


func ids_of_kind(kind: String) -> PackedStringArray:
	var out := PackedStringArray()
	for key in _entries.keys():
		if String(_entries[key]["kind"]) == kind:
			out.append(key)
	out.sort()
	return out


func size() -> int:
	return _entries.size()
