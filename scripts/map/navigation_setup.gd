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

var _config: MapConfig
var _baked := false


func configure(config: MapConfig) -> void:
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

	var extent := config.map_half_size + config.map_border + 4.0
	mesh.filter_baking_aabb = AABB(
		Vector3(-extent, -4.0, -extent), Vector3(extent * 2.0, 8.0, extent * 2.0)
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
	bake_navigation_mesh(on_thread)
	_baked = true
	navigation_baked.emit()


## Resolves once the navigation server has published the freshly baked map.
## Queries made before this point fail with "before first map synchronization".
func await_synchronization() -> void:
	var tree := get_tree()
	if tree == null:
		return
	await tree.physics_frame
	await tree.physics_frame


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
