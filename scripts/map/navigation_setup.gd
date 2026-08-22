class_name NavigationSetup
extends NavigationRegion3D

## Owns the 3D navigation mesh for a map.
##
## The mesh is baked at runtime from the navigation floor slabs the
## [TerrainBuilder] emits — the map's walkable footprint minus walls, blocked
## terrain and structure bases. Lanes, jungle paths, the river, base entrances
## and objective arenas are therefore navigable by construction. Nothing
## hardcodes a path: agents query the baked mesh.

signal navigation_baked

## How long [method await_synchronization] will wait before giving up. A bake
## this map size publishes in a handful of frames; the budget only exists so a
## broken map cannot hang a caller forever.
const SYNC_FRAME_BUDGET := 120

var _config: MapConfig
var _baked := false
## The navigation map's iteration id captured just before the last bake.
## "bake_navigation_mesh() returned" and "the server is answering queries
## against the new mesh" are two different moments; this tells them apart.
var _iteration_before_bake: int = -1


func configure(layout: MapLayout) -> void:
	var config := layout.config
	_config = config
	var mesh := NavigationMesh.new()
	mesh.cell_size = config.nav_cell_size
	mesh.cell_height = config.nav_cell_height
	mesh.agent_radius = config.nav_agent_radius
	mesh.agent_height = config.nav_agent_height
	mesh.agent_max_climb = config.nav_agent_max_climb
	mesh.agent_max_slope = config.nav_agent_max_slope
	mesh.region_min_size = 4.0
	mesh.region_merge_size = 12.0
	mesh.edge_max_length = 8.0
	mesh.edge_max_error = 1.3
	mesh.detail_sample_distance = 6.0
	mesh.detail_sample_max_error = 1.0
	mesh.filter_low_hanging_obstacles = true
	mesh.filter_ledge_spans = true
	mesh.filter_walkable_low_height_spans = true
	mesh.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	mesh.geometry_collision_mask = TerrainBuilder.NAV_SOURCE_LAYER
	mesh.geometry_source_geometry_mode = NavigationMesh.SOURCE_GEOMETRY_GROUPS_WITH_CHILDREN
	mesh.geometry_source_group_name = TerrainBuilder.NAV_SOURCE_GROUP

	var extents := layout.outer_half_extents() + Vector2(4.0, 4.0)
	mesh.filter_baking_aabb = AABB(
		Vector3(-extents.x, -4.0, -extents.y), Vector3(extents.x * 2.0, 8.0, extents.y * 2.0)
	)

	navigation_mesh = mesh
	enabled = true
	_align_navigation_map(mesh)


## The navigation map and the mesh must agree on their voxel size or the region
## is rejected, so the map follows whatever the config asks for.
func _align_navigation_map(mesh: NavigationMesh) -> void:
	var map_rid := get_world_3d().navigation_map
	if not map_rid.is_valid():
		return
	NavigationServer3D.map_set_cell_size(map_rid, mesh.cell_size)
	NavigationServer3D.map_set_cell_height(map_rid, mesh.cell_height)


## Bakes synchronously by default so callers can spawn agents right after.
func rebuild(on_thread: bool = false) -> void:
	if navigation_mesh == null:
		push_error("NavigationSetup.rebuild() called before configure().")
		return
	_iteration_before_bake = map_iteration()
	bake_navigation_mesh(on_thread)
	_baked = true
	navigation_baked.emit()


## Resolves once the navigation server is actually answering queries against
## the mesh that was just baked.
##
## Godot 4.4 made map synchronisation asynchronous by default
## (navigation/world/map_use_async_iterations), so "bake_navigation_mesh()
## returned" and "the server serves this mesh" are several frames apart. The
## old two-physics-frame wait was a race the engine won often enough to look
## like a flaky map: the startup probe reported a perfectly good spawn as
## off-navmesh, and a rebuilt map answered against the previous mesh.
##
## Neither counter published by the server is sufficient on its own — the map
## iteration advances once before the region's polygons are merged, and the
## region bounds arrive a frame before the map-level queries work. So this asks
## the map the one question whose answer is known in advance: a point taken
## from the middle of a polygon of the mesh just baked must snap to itself.
func await_synchronization() -> void:
	var tree := get_tree()
	if tree == null:
		return
	await tree.physics_frame
	var sample := mesh_sample_point()
	if not get_world_3d().navigation_map.is_valid() or sample == Vector3.INF:
		return
	var frames := 0
	while frames < SYNC_FRAME_BUDGET and not _map_serves(sample):
		await tree.physics_frame
		frames += 1
	if frames >= SYNC_FRAME_BUDGET:
		push_warning("NavigationSetup: navigation map did not synchronise in %d frames."
			% SYNC_FRAME_BUDGET)


## True when the merged map resolves [param point] back to itself, which it can
## only do once this region's polygons are part of it.
func _map_serves(point: Vector3) -> bool:
	if map_iteration() == _iteration_before_bake:
		return false  # nothing new has been published yet
	var closest := closest_navigable_point(point)
	return closest.distance_to(point) <= maxf(navigation_mesh.cell_size * 2.0, 0.2)


## A point in the middle of one of the baked polygons — on the mesh by
## construction, and read locally so it is available before the server has
## published anything.
func mesh_sample_point() -> Vector3:
	if navigation_mesh == null or navigation_mesh.get_polygon_count() == 0:
		return Vector3.INF
	var vertices := navigation_mesh.get_vertices()
	var indices := navigation_mesh.get_polygon(0)
	if indices.is_empty():
		return Vector3.INF
	var centroid := Vector3.ZERO
	for index in indices:
		centroid += vertices[index]
	return global_transform * (centroid / float(indices.size()))


## The server's published-version counter for this world's navigation map.
func map_iteration() -> int:
	var map_rid := get_world_3d().navigation_map
	return NavigationServer3D.map_get_iteration_id(map_rid) if map_rid.is_valid() else -1


func is_baked() -> bool:
	return _baked


func polygon_count() -> int:
	return 0 if navigation_mesh == null else navigation_mesh.get_polygon_count()


func vertex_count() -> int:
	return 0 if navigation_mesh == null else navigation_mesh.get_vertices().size()


## Closest navigable world position to [param point] on this region's map.
func closest_navigable_point(point: Vector3) -> Vector3:
	var map_rid := get_world_3d().navigation_map
	if not map_rid.is_valid():
		return point
	return NavigationServer3D.map_get_closest_point(map_rid, point)


## True when [param point] is on (or very near) the baked navigation mesh.
func is_navigable(point: Vector3, tolerance: float = 1.5) -> bool:
	var closest := closest_navigable_point(point)
	return Vector2(closest.x - point.x, closest.z - point.z).length() <= tolerance


## Convenience wrapper for tools and tests that want a full path.
func find_path(from: Vector3, to: Vector3, optimize: bool = true) -> PackedVector3Array:
	var map_rid := get_world_3d().navigation_map
	if not map_rid.is_valid():
		return PackedVector3Array()
	return NavigationServer3D.map_get_path(map_rid, from, to, optimize)
