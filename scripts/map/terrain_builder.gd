class_name TerrainBuilder
extends Node3D

## Turns the walkable description in [MapLayout] into terrain.
##
## One rasterisation pass over the map produces two merged box sets:
##   * walls — every cell that is not walkable, given collision and a mesh;
##   * navigation floor — every walkable cell that no structure occupies.
##
## The navigation mesh is baked from the floor boxes alone, so it is exactly
## the designed walkable footprint: no polygons on top of walls, and collision,
## visuals and navigation can never drift apart. Describing a new map means
## describing where it is walkable, not hand-placing walls.

## Nodes in this group are the only geometry the navigation bake sees.
const NAV_SOURCE_GROUP := "navmesh_source"
## Physics layer used exclusively as navigation bake input (layer 5).
const NAV_SOURCE_LAYER := 1 << 4
## Physics layer for solid world geometry (layer 1).
const WORLD_LAYER := 1

var _layout: MapLayout
var _wall_rects: Array[Rect2] = []
var _floor_rects: Array[Rect2] = []


func build(layout: MapLayout) -> void:
	_layout = layout
	for child in get_children():
		child.queue_free()
	_build_ground()
	_rasterise()
	_build_walls()
	_build_navigation_floor()
	_build_decor()


func wall_rects() -> Array[Rect2]:
	return _wall_rects


func floor_rects() -> Array[Rect2]:
	return _floor_rects


func _build_ground() -> void:
	var extents := _layout.outer_half_extents()
	var play := _layout.play_half_extents()
	var thickness := 2.0

	var body := StaticBody3D.new()
	body.name = "Ground"
	body.collision_layer = WORLD_LAYER
	body.collision_mask = 0
	add_child(body)

	var collision := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(extents.x * 2.0, thickness, extents.y * 2.0)
	collision.shape = box
	collision.position = Vector3(0.0, -thickness * 0.5, 0.0)
	body.add_child(collision)

	var mesh := PrototypeMeshes.box(box.size, PrototypeMeshes.COLOR_GROUND)
	mesh.name = "GroundMesh"
	mesh.position = collision.position
	body.add_child(mesh)

	# Marks the playable area so the unreachable border reads as out of play.
	var field := PrototypeMeshes.box(
		Vector3(play.x * 2.0, 0.02, play.y * 2.0),
		PrototypeMeshes.COLOR_GROUND.lightened(0.06)
	)
	field.name = "PlayFieldMesh"
	field.position = Vector3(0.0, 0.02, 0.0)
	add_child(field)


## Samples the walkable description once and merges both cell sets into as few
## boxes as possible.
func _rasterise() -> void:
	var config := _layout.config
	var cell: float = maxf(config.terrain_cell_size, 0.25)
	var extents := _layout.outer_half_extents()
	var cols := int(ceil(extents.x * 2.0 / cell))
	var rows := int(ceil(extents.y * 2.0 / cell))
	var origin := Vector2(-extents.x, -extents.y)

	var walkable := MapShapes.with_bounds(_layout.walkable_shapes)
	var blocked := MapShapes.with_bounds(_layout.blocked_shapes)
	var structures := MapShapes.with_bounds(_layout.structure_shapes)

	var solid := PackedByteArray()
	var open := PackedByteArray()
	solid.resize(cols * rows)
	open.resize(cols * rows)

	for j in rows:
		for i in cols:
			var p := origin + Vector2((float(i) + 0.5) * cell, (float(j) + 0.5) * cell)
			var walkable_here := MapShapes.bounded_contains_any(walkable, p)
			if walkable_here and MapShapes.bounded_contains_any(blocked, p):
				walkable_here = false
			var index := j * cols + i
			solid[index] = 0 if walkable_here else 1
			var navigable := walkable_here and not MapShapes.bounded_contains_any(structures, p)
			open[index] = 1 if navigable else 0

	_wall_rects = _merge_cells(solid, cols, rows, origin, cell)
	_floor_rects = _merge_cells(open, cols, rows, origin, cell)


## Greedy row/column sweep: grow each unused set cell right, then down.
func _merge_cells(cells: PackedByteArray, cols: int, rows: int, origin: Vector2,
		cell: float) -> Array[Rect2]:
	var used := PackedByteArray()
	used.resize(cols * rows)
	var rects: Array[Rect2] = []
	for j in rows:
		for i in cols:
			var index := j * cols + i
			if cells[index] == 0 or used[index] == 1:
				continue
			var width := 1
			while i + width < cols:
				var next := j * cols + i + width
				if cells[next] == 0 or used[next] == 1:
					break
				width += 1
			var height := 1
			while j + height < rows:
				var row_ok := true
				for k in width:
					var probe := (j + height) * cols + i + k
					if cells[probe] == 0 or used[probe] == 1:
						row_ok = false
						break
				if not row_ok:
					break
				height += 1
			for dj in height:
				for di in width:
					used[(j + dj) * cols + i + di] = 1
			rects.append(Rect2(
				origin + Vector2(float(i) * cell, float(j) * cell),
				Vector2(float(width) * cell, float(height) * cell)
			))
	return rects


func _build_walls() -> void:
	var height := _layout.config.wall_height

	var body := StaticBody3D.new()
	body.name = "Walls"
	body.collision_layer = WORLD_LAYER
	body.collision_mask = 0
	add_child(body)

	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	var unit := BoxMesh.new()
	unit.size = Vector3.ONE
	multi.mesh = unit
	multi.instance_count = _wall_rects.size()

	for i in _wall_rects.size():
		var rect := _wall_rects[i]
		var center := rect.get_center()
		var size := Vector3(rect.size.x, height, rect.size.y)
		var at := Vector3(center.x, height * 0.5, center.y)
		multi.set_instance_transform(i, Transform3D(Basis().scaled(size), at))

		var collision := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = size
		collision.shape = box
		collision.position = at
		body.add_child(collision)

	var view := MultiMeshInstance3D.new()
	view.name = "WallMeshes"
	view.multimesh = multi
	view.material_override = PrototypeMeshes.material(PrototypeMeshes.COLOR_WALL)
	body.add_child(view)


## Collision-free props the layout asked for, standing on the solid terrain.
func _build_decor() -> void:
	if _layout.decor.is_empty():
		return
	var holder := Node3D.new()
	holder.name = "Decor"
	add_child(holder)
	for prop in _layout.decor:
		var radius: float = float(prop.get("radius", 1.5))
		var height: float = float(prop.get("height", 4.0))
		var position: Vector2 = prop["position"]
		var kind := String(prop.get("kind", "cylinder"))
		var mesh: MeshInstance3D
		match kind:
			"floor":
				# Flat ground marker for a walkable pocket the lane decals miss.
				mesh = PrototypeMeshes.disk_decal(
					position, radius, prop.get("color", PrototypeMeshes.COLOR_ENTRANCE),
					PrototypeMeshes.DECAL_Y_ENTRANCE, 20
				)
				holder.add_child(mesh)
				continue
			"box":
				mesh = PrototypeMeshes.box(
					Vector3(radius * 1.8, height, radius * 1.8), PrototypeMeshes.COLOR_WALL.lightened(0.12)
				)
			_:
				mesh = PrototypeMeshes.cylinder(radius, height, PrototypeMeshes.COLOR_WALL.lightened(0.12), 8)
		mesh.position = Vector3(position.x, height * 0.5, position.y)
		holder.add_child(mesh)


## Invisible, physics-inert slabs that exist purely as navigation bake input.
func _build_navigation_floor() -> void:
	var body := StaticBody3D.new()
	body.name = "NavigationFloor"
	body.collision_layer = NAV_SOURCE_LAYER
	body.collision_mask = 0
	body.add_to_group(NAV_SOURCE_GROUP)
	add_child(body)

	var thickness := 0.4
	for rect in _floor_rects:
		var center := rect.get_center()
		var collision := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(rect.size.x, thickness, rect.size.y)
		collision.shape = box
		collision.position = Vector3(center.x, -thickness * 0.5, center.y)
		body.add_child(collision)
