## Map compilation, connectivity and navigation.
extends TestCase

const NEIGHBOURS: Array[Vector2i] = [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]

func test_map_compiles_into_geometry_and_navigation() -> void:
	var session := make_session()
	await get_tree().physics_frame
	var compiled := session.compiled_map
	check_greater(compiled.generated_wall_count, 10.0, "walls were generated from the authored areas")
	check_greater(compiled.solids.size(), 30.0, "solids include walls and props")
	check_greater(compiled.navigable_cell_count(), 500.0, "the map has a navigable area")
	check_equal(session.map_definition.bomb_sites.size(), 2, "two bomb sites")
	session.queue_free()

func test_every_walkable_cell_is_reachable_from_the_attacker_spawn() -> void:
	var session := make_session()
	await get_tree().physics_frame
	var compiled := session.compiled_map
	var start := compiled.to_cell(session.map_definition.attacker_spawns[0].position)

	var seen := {}
	var queue: Array[Vector2i] = [start]
	seen[start] = true
	while not queue.is_empty():
		var cell: Vector2i = queue.pop_back()
		for offset in NEIGHBOURS:
			var next: Vector2i = cell + offset
			if seen.has(next) or not compiled.is_nav_open(next.x, next.y):
				continue
			seen[next] = true
			queue.append(next)

	check_equal(seen.size(), compiled.navigable_cell_count(), "the layout has no unreachable pockets")
	session.queue_free()

func test_spawns_are_walkable_and_inside_their_buy_zones() -> void:
	var session := make_session()
	await get_tree().physics_frame
	var map := session.map_definition
	for side in [GameEnums.Side.ATTACKERS, GameEnums.Side.DEFENDERS]:
		var points := map.spawns_for(side)
		check_greater(points.size(), 4.0, "%s has enough spawn points" % GameEnums.side_name(side))
		var zone := map.buy_zone_for(side)
		for point in points:
			check(session.compiled_map.is_navigable(point.position),
				"%s spawn %v is walkable" % [GameEnums.side_name(side), point.position])
			check(zone.has_point(Vector2(point.position.x, point.position.z)),
				"%s spawn is inside its buy zone" % GameEnums.side_name(side))
	session.queue_free()

func test_navigation_paths_exist_from_both_spawns_to_both_sites() -> void:
	var session := make_session()
	var map_rid: RID = await sync_navigation(session)
	for side in [GameEnums.Side.ATTACKERS, GameEnums.Side.DEFENDERS]:
		var origin: Vector3 = session.map_definition.spawns_for(side)[0].position
		for site in session.map_definition.bomb_sites:
			var path := NavigationServer3D.map_get_path(map_rid, origin, site.plant_point, true)
			check_greater(path.size(), 1.0, "%s can path to site %s" % [GameEnums.side_name(side), site.id])
			if path.size() > 1:
				var arrival: Vector3 = path[path.size() - 1]
				check_less(Vector2(arrival.x - site.plant_point.x, arrival.z - site.plant_point.z).length(),
					4.0, "the path to site %s actually arrives" % site.id)
	session.queue_free()

func test_bomb_site_plant_points_are_clear_of_props() -> void:
	var session := make_session()
	await get_tree().physics_frame
	for site in session.map_definition.bomb_sites:
		check(session.compiled_map.is_navigable(site.plant_point),
			"site %s plant point is not blocked by a prop" % site.id)
	session.queue_free()
