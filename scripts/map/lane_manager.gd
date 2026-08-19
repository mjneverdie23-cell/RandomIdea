class_name LaneManager
extends Node3D

## Owns the map's primary traversal corridors: the three lanes and the river,
## plus the lane structures (turrets and inhibitors) that sit on them.

signal lanes_built

var _layout: MapLayout
var _turret_nodes: Dictionary = {}


func build(layout: MapLayout, registry: MapRegistry) -> void:
	_layout = layout
	for child in get_children():
		child.queue_free()
	_turret_nodes.clear()

	var decals := Node3D.new()
	decals.name = "LaneDecals"
	add_child(decals)

	for lane_entry in _layout.lanes:
		var path: PackedVector2Array = lane_entry["path"]
		var holder := Node3D.new()
		holder.name = String(lane_entry["id"])
		holder.position = MapShapes.to_world(lane_entry["position"])
		decals.add_child(holder)
		for i in range(path.size() - 1):
			var strip := PrototypeMeshes.band_decal(
				path[i], path[i + 1], _layout.config.lane_width,
				PrototypeMeshes.COLOR_LANE, PrototypeMeshes.DECAL_Y_LANE
			)
			strip.name = "Segment%d" % i
			decals.add_child(strip)
		# Rounded corner so the L-shaped lanes read as one continuous space.
		for i in range(1, path.size() - 1):
			var joint := PrototypeMeshes.disk_decal(
				path[i], _layout.config.lane_half_width(),
				PrototypeMeshes.COLOR_LANE, PrototypeMeshes.DECAL_Y_LANE
			)
			joint.name = "%s_Corner%d" % [lane_entry["id"], i]
			decals.add_child(joint)
		registry.register(String(lane_entry["id"]), "lane", lane_entry, holder)

	_build_river(decals, registry)

	var structures := Node3D.new()
	structures.name = "LaneStructures"
	add_child(structures)

	for turret in _layout.turrets:
		var node := _build_turret(turret)
		structures.add_child(node)
		_turret_nodes[String(turret["id"])] = node
		registry.register(String(turret["id"]), "turret", turret, node)

	for inhibitor in _layout.inhibitors:
		var node := _build_inhibitor(inhibitor)
		structures.add_child(node)
		registry.register(String(inhibitor["id"]), "inhibitor", inhibitor, node)

	lanes_built.emit()


func _build_river(parent: Node3D, registry: MapRegistry) -> void:
	var river: Dictionary = _layout.river
	if river.is_empty():
		return
	var path: PackedVector2Array = river["path"]
	var holder := Node3D.new()
	holder.name = String(river["id"])
	holder.position = MapShapes.to_world(river["position"])
	parent.add_child(holder)
	for i in range(path.size() - 1):
		var strip := PrototypeMeshes.band_decal(
			path[i], path[i + 1], float(river["width"]),
			PrototypeMeshes.COLOR_RIVER, PrototypeMeshes.DECAL_Y_RIVER
		)
		strip.name = "RiverSegment%d" % i
		parent.add_child(strip)
	registry.register(String(river["id"]), "river", river, holder)


func turret_node(turret_id: String) -> Node3D:
	return _turret_nodes.get(turret_id, null)


func turret_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for turret in _layout.turrets:
		out.append(String(turret["id"]))
	return out


func _build_turret(turret: Dictionary) -> Node3D:
	var config := _layout.config
	var team: int = turret["team"]
	var is_nexus_turret := String(turret.get("kind", "lane")) == "nexus"
	var height: float = config.turret_height * (1.15 if is_nexus_turret else 1.0)
	var radius: float = config.turret_radius * (1.2 if is_nexus_turret else 1.0)
	var color := PrototypeMeshes.team_color(team)

	var root := StaticBody3D.new()
	root.name = String(turret["id"])
	root.position = MapShapes.to_world(turret["position"])
	root.collision_layer = 1
	root.collision_mask = 0
	root.add_to_group("turrets")
	root.set_meta("map_id", turret["id"])
	root.set_meta("team", team)
	root.set_meta("attack_range", turret["range"])

	var collision := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = radius
	shape.height = height
	collision.shape = shape
	collision.position = Vector3(0.0, height * 0.5, 0.0)
	root.add_child(collision)

	var body := PrototypeMeshes.cylinder(radius, height, color.darkened(0.35))
	body.position = Vector3(0.0, height * 0.5, 0.0)
	root.add_child(body)

	var head := PrototypeMeshes.cone(radius * 1.25, height * 0.35, color)
	head.position = Vector3(0.0, height + height * 0.15, 0.0)
	root.add_child(head)

	return root


func _build_inhibitor(inhibitor: Dictionary) -> Node3D:
	var color := PrototypeMeshes.team_color(inhibitor["team"])
	var size := Vector3(3.0, 3.6, 3.0)

	var root := StaticBody3D.new()
	root.name = String(inhibitor["id"])
	root.position = MapShapes.to_world(inhibitor["position"])
	root.collision_layer = 1
	root.collision_mask = 0
	root.add_to_group("inhibitors")
	root.set_meta("map_id", inhibitor["id"])
	root.set_meta("team", inhibitor["team"])

	var collision := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	collision.shape = box
	collision.position = Vector3(0.0, size.y * 0.5, 0.0)
	root.add_child(collision)

	var mesh := PrototypeMeshes.box(size, color.lightened(0.15))
	mesh.position = collision.position
	root.add_child(mesh)
	return root
