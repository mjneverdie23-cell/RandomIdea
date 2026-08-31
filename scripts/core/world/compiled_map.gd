## The runtime form of a MapDefinition.
##
## Rasterises the authored walkable areas onto a grid, turns every cell that is
## NOT walkable into merged wall boxes, and builds a NavigationMesh from the same
## grid. Because walls are derived from the walkable space, a map cannot contain
## an accidental gap between two rooms - and bots understand any map you author
## without a single hand-placed waypoint.
class_name CompiledMap
extends RefCounted

var definition: MapDefinition
var cell_size: float = 2.0
var cols: int = 0
var rows: int = 0
## World-space (x, z) of cell (0, 0).
var origin: Vector2 = Vector2.ZERO
var bounds: AABB = AABB()
## 1 = inside an authored area.
var open_cells: PackedByteArray = PackedByteArray()
## 1 = walkable by bots (open, minus nav-blocking props).
var nav_cells: PackedByteArray = PackedByteArray()
## Generated walls plus the authored props: everything that gets a mesh.
var solids: Array[MapProp] = []
var generated_wall_count: int = 0

static func compile(map: MapDefinition) -> CompiledMap:
	var compiled := CompiledMap.new()
	compiled.definition = map
	compiled.cell_size = map.cell_size

	# --- bounds ------------------------------------------------------------
	var min_x := INF
	var min_z := INF
	var max_x := -INF
	var max_z := -INF
	for area in map.areas:
		min_x = minf(min_x, area.rect.position.x)
		min_z = minf(min_z, area.rect.position.y)
		max_x = maxf(max_x, area.rect.end.x)
		max_z = maxf(max_z, area.rect.end.y)
	min_x -= map.padding
	min_z -= map.padding
	max_x += map.padding
	max_z += map.padding
	compiled.origin = Vector2(min_x, min_z)
	compiled.bounds = AABB(Vector3(min_x, 0.0, min_z), Vector3(max_x - min_x, 20.0, max_z - min_z))
	compiled.cols = int(ceil((max_x - min_x) / compiled.cell_size))
	compiled.rows = int(ceil((max_z - min_z) / compiled.cell_size))

	# --- rasterise the walkable areas --------------------------------------
	var count := compiled.cols * compiled.rows
	compiled.open_cells = PackedByteArray()
	compiled.open_cells.resize(count)
	for area in map.areas:
		var cx0 := maxi(0, int(floor((area.rect.position.x - min_x) / compiled.cell_size)))
		var cx1 := mini(compiled.cols - 1, int(ceil((area.rect.end.x - min_x) / compiled.cell_size)) - 1)
		var cz0 := maxi(0, int(floor((area.rect.position.y - min_z) / compiled.cell_size)))
		var cz1 := mini(compiled.rows - 1, int(ceil((area.rect.end.y - min_z) / compiled.cell_size)) - 1)
		for cz in range(cz0, cz1 + 1):
			for cx in range(cx0, cx1 + 1):
				compiled.open_cells[cz * compiled.cols + cx] = 1

	compiled._generate_walls(map)
	compiled.solids.append_array(map.props)
	compiled._build_nav_cells(map)
	return compiled

## Merges the closed cells into as few boxes as the renderer can get away with.
func _generate_walls(map: MapDefinition) -> void:
	var consumed := PackedByteArray()
	consumed.resize(cols * rows)
	var index := 0
	for cz in rows:
		for cx in cols:
			var here := cz * cols + cx
			if open_cells[here] == 1 or consumed[here] == 1:
				continue
			# Grow east, then south for as long as the full width stays closed.
			var width := 1
			while cx + width < cols and open_cells[cz * cols + cx + width] == 0 and consumed[cz * cols + cx + width] == 0:
				width += 1
			var height := 1
			var growing := true
			while growing and cz + height < rows:
				for k in width:
					var probe := (cz + height) * cols + cx + k
					if open_cells[probe] == 1 or consumed[probe] == 1:
						growing = false
						break
				if growing:
					height += 1
			for dz in height:
				for dx in width:
					consumed[(cz + dz) * cols + cx + dx] = 1

			var size_x := width * cell_size
			var size_z := height * cell_size
			var wall := MapProp.new()
			wall.id = StringName("wall_%d" % index)
			wall.kind = GameEnums.PropKind.WALL
			wall.shape = MapProp.Shape.BOX
			wall.size = Vector3(size_x, map.wall_height, size_z)
			wall.position = Vector3(
				origin.x + cx * cell_size + size_x * 0.5,
				map.wall_height * 0.5,
				origin.y + cz * cell_size + size_z * 0.5)
			wall.color = map.wall_color
			wall.blocks_nav = true
			solids.append(wall)
			index += 1
	generated_wall_count = index

func _build_nav_cells(map: MapDefinition) -> void:
	nav_cells = open_cells.duplicate()
	for prop in map.props:
		if not prop.blocks_nav or not prop.collidable:
			continue
		var half := Vector2(prop.size.x, prop.size.z) * 0.5
		var cx0 := maxi(0, int(floor((prop.position.x - half.x - origin.x) / cell_size)))
		var cx1 := mini(cols - 1, int(floor((prop.position.x + half.x - origin.x) / cell_size)))
		var cz0 := maxi(0, int(floor((prop.position.z - half.y - origin.y) / cell_size)))
		var cz1 := mini(rows - 1, int(floor((prop.position.z + half.y - origin.y) / cell_size)))
		for cz in range(cz0, cz1 + 1):
			for cx in range(cx0, cx1 + 1):
				nav_cells[cz * cols + cx] = 0

# ------------------------------------------------------------------ queries --
func is_nav_open(cx: int, cz: int) -> bool:
	if cx < 0 or cz < 0 or cx >= cols or cz >= rows:
		return false
	return nav_cells[cz * cols + cx] == 1

func to_cell(position: Vector3) -> Vector2i:
	return Vector2i(
		int(floor((position.x - origin.x) / cell_size)),
		int(floor((position.z - origin.y) / cell_size)))

func to_world(cx: int, cz: int) -> Vector3:
	return Vector3(origin.x + (cx + 0.5) * cell_size, 0.0, origin.y + (cz + 0.5) * cell_size)

func is_navigable(position: Vector3) -> bool:
	var cell := to_cell(position)
	return is_nav_open(cell.x, cell.y)

## Nearest navigable position, searched in rings. Used to sanitise bot goals.
func nearest_navigable(position: Vector3, max_radius: int = 12) -> Vector3:
	var cell := to_cell(position)
	if is_nav_open(cell.x, cell.y):
		return to_world(cell.x, cell.y)
	for r in range(1, max_radius + 1):
		for dx in range(-r, r + 1):
			for dz in range(-r, r + 1):
				if maxi(absi(dx), absi(dz)) != r:
					continue
				if is_nav_open(cell.x + dx, cell.y + dz):
					return to_world(cell.x + dx, cell.y + dz)
	return position

func navigable_cell_count() -> int:
	var total := 0
	for value in nav_cells:
		total += value
	return total

## Builds a flat NavigationMesh from the walkable cells - one quad per cell, with
## shared vertices so neighbouring polygons always connect.
func build_navigation_mesh(agent_radius: float = 0.55) -> NavigationMesh:
	var nav := NavigationMesh.new()
	nav.agent_radius = agent_radius
	nav.agent_height = 2.0
	# NavigationMesh.cell_size must match the navigation map's cell size or the
	# region is rejected at registration - leave both at the engine default.
	var vertices := PackedVector3Array()
	var lookup := {}
	var polygons: Array[PackedInt32Array] = []

	var vertex_index := func(cx: int, cz: int) -> int:
		var key := cz * (cols + 1) + cx
		if lookup.has(key):
			return lookup[key]
		var id := vertices.size()
		vertices.append(Vector3(origin.x + cx * cell_size, 0.02, origin.y + cz * cell_size))
		lookup[key] = id
		return id

	for cz in rows:
		for cx in cols:
			if nav_cells[cz * cols + cx] == 0:
				continue
			polygons.append(PackedInt32Array([
				vertex_index.call(cx, cz),
				vertex_index.call(cx + 1, cz),
				vertex_index.call(cx + 1, cz + 1),
				vertex_index.call(cx, cz + 1),
			]))
	nav.vertices = vertices
	for polygon in polygons:
		nav.add_polygon(polygon)
	return nav
