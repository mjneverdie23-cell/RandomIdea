class_name BaseManager
extends Node3D

## Owns both team bases: the base floor, nexus/core, fountain area, the base
## walls' interior footprint and the markers where each lane leaves the base.
##
## Base defensive turrets are lane structures and are built by [LaneManager];
## this manager only owns what is unique to a base.

var _layout: MapLayout
var _base_nodes: Dictionary = {}


func build(layout: MapLayout, registry: MapRegistry) -> void:
	_layout = layout
	for child in get_children():
		child.queue_free()
	_base_nodes.clear()

	for base in _layout.bases:
		var node := _build_base(base)
		add_child(node)
		_base_nodes[String(base["id"])] = node
		registry.register(String(base["id"]), "base", base, node)

	for nexus in _layout.nexuses:
		var node := _build_nexus(nexus)
		add_child(node)
		registry.register(String(nexus["id"]), "nexus", nexus, node)

	for entrance in _layout.lane_entrances:
		if not entrance.has("team"):
			continue  # jungle corridors are registered by the jungle manager
		var marker := Marker3D.new()
		marker.name = String(entrance["id"])
		marker.position = MapShapes.to_world(entrance["position"])
		add_child(marker)
		registry.register(String(entrance["id"]), "lane_entrance", entrance, marker)


func base_node(base_id: String) -> Node3D:
	return _base_nodes.get(base_id, null)


func _build_base(base: Dictionary) -> Node3D:
	var team: int = base["team"]
	var radius: float = base["radius"]
	var color := PrototypeMeshes.team_color(team)

	var root := Node3D.new()
	root.name = String(base["id"])
	root.position = MapShapes.to_world(base["position"])
	root.add_to_group("bases")
	root.set_meta("map_id", base["id"])
	root.set_meta("team", team)

	var floor_decal := PrototypeMeshes.disk_decal(
		Vector2.ZERO, radius, color.darkened(0.6), PrototypeMeshes.DECAL_Y_BASE, 28
	)
	floor_decal.name = "Floor"
	root.add_child(floor_decal)

	var rim := PrototypeMeshes.ring(radius, 0.8, color)
	rim.name = "Rim"
	rim.position.y = PrototypeMeshes.DECAL_Y_BASE + 0.02
	root.add_child(rim)

	# Fountain / spawn platform, offset towards the map corner.
	var spawn_offset := _layout.config.team_corner_dir(team) * _layout.config.spawn_offset
	var fountain := PrototypeMeshes.disk_decal(
		spawn_offset, radius * 0.28, color.lightened(0.25), PrototypeMeshes.DECAL_Y_BASE + 0.04, 20
	)
	fountain.name = "Fountain"
	root.add_child(fountain)

	return root


func _build_nexus(nexus: Dictionary) -> Node3D:
	var team: int = nexus["team"]
	var color := PrototypeMeshes.team_color(team)

	var root := StaticBody3D.new()
	root.name = String(nexus["id"])
	root.position = MapShapes.to_world(nexus["position"])
	root.collision_layer = 1
	root.collision_mask = 0
	root.add_to_group("nexuses")
	root.set_meta("map_id", nexus["id"])
	root.set_meta("team", team)

	var size := Vector3(6.0, 6.0, 6.0)
	var collision := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	collision.shape = box
	collision.position = Vector3(0.0, size.y * 0.5, 0.0)
	root.add_child(collision)

	var plinth := PrototypeMeshes.box(size, color.darkened(0.4))
	plinth.position = collision.position
	root.add_child(plinth)

	var core := PrototypeMeshes.sphere(2.4, color)
	core.name = "Core"
	core.position = Vector3(0.0, size.y + 2.0, 0.0)
	root.add_child(core)

	return root
