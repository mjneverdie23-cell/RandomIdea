class_name ObjectiveManager
extends Node3D

## Owns the two large neutral objective areas that sit on the river.
##
## Only the space is built here: arena floor, navigation room around the pit,
## a spawn marker and a placeholder objective mesh. Objective combat, timers
## and buffs are intentionally left to a later system, which can find these
## areas through the registry ids "TOP_OBJECTIVE" and "BOT_OBJECTIVE".

signal objective_area_entered(objective_id: String, body: Node3D)
signal objective_area_exited(objective_id: String, body: Node3D)

var _layout: MapLayout
var _objective_nodes: Dictionary = {}


func build(layout: MapLayout, registry: MapRegistry) -> void:
	_layout = layout
	for child in get_children():
		child.queue_free()
	_objective_nodes.clear()

	for objective in _layout.objectives:
		var node := _build_objective(objective)
		add_child(node)
		_objective_nodes[String(objective["id"])] = node
		registry.register(String(objective["id"]), "objective", objective, node)


func objective_node(objective_id: String) -> Node3D:
	return _objective_nodes.get(objective_id, null)


func objective_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for objective in _layout.objectives:
		out.append(String(objective["id"]))
	return out


func _build_objective(objective: Dictionary) -> Node3D:
	var radius: float = objective["radius"]
	var objective_id := String(objective["id"])
	var is_top: bool = int(objective["side"]) == MapEnums.Side.TOP
	var color := PrototypeMeshes.COLOR_OBJECTIVE if is_top else PrototypeMeshes.COLOR_NEUTRAL

	var root := Node3D.new()
	root.name = objective_id
	root.position = MapShapes.to_world(objective["position"])
	root.add_to_group("objectives")
	root.set_meta("map_id", objective_id)

	var arena := PrototypeMeshes.disk_decal(
		Vector2.ZERO, radius, color.darkened(0.45), PrototypeMeshes.DECAL_Y_OBJECTIVE, 28
	)
	arena.name = "Arena"
	root.add_child(arena)

	var rim := PrototypeMeshes.ring(radius, 0.6, color)
	rim.name = "Rim"
	rim.position.y = PrototypeMeshes.DECAL_Y_OBJECTIVE + 0.02
	root.add_child(rim)

	var spawn := Marker3D.new()
	spawn.name = "SpawnPoint"
	root.add_child(spawn)

	# Placeholder objective body. No collider, so the pit stays fully
	# navigable until a real objective unit is dropped in.
	var mesh := PrototypeMeshes.box(Vector3(4.0, 6.0, 4.0), color)
	mesh.name = "PlaceholderObjective"
	mesh.position = Vector3(0.0, 3.0, 0.0)
	root.add_child(mesh)

	var crest := PrototypeMeshes.cone(2.6, 3.0, color.lightened(0.2), 8)
	crest.name = "PlaceholderCrest"
	crest.position = Vector3(0.0, 7.5, 0.0)
	root.add_child(crest)

	# Detection volume so a later objective system knows who is in the pit.
	var area := Area3D.new()
	area.name = "Zone"
	area.collision_layer = 0
	area.collision_mask = 0b110  # players and enemies
	area.monitoring = true
	var shape := CollisionShape3D.new()
	var cylinder := CylinderShape3D.new()
	cylinder.radius = radius
	cylinder.height = 6.0
	shape.shape = cylinder
	shape.position = Vector3(0.0, 3.0, 0.0)
	area.add_child(shape)
	root.add_child(area)
	area.body_entered.connect(func(body: Node3D) -> void: objective_area_entered.emit(objective_id, body))
	area.body_exited.connect(func(body: Node3D) -> void: objective_area_exited.emit(objective_id, body))

	return root
