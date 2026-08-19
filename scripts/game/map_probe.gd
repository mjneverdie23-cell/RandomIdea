class_name MapProbe
extends RefCounted

## Read-only navigation checks over a built map.
##
## Used by the startup report and by the headless smoke test to prove the
## acceptance criteria: every gameplay space is on the navigation mesh and
## reachable from a team's spawn without any hardcoded route.

## Identifiers a playable map must expose. Each [MapLayout] declares its own,
## so this probe works on any map the layout layer can describe.
static func required_ids(map: MapController) -> PackedStringArray:
	return map.layout.required_ids()


## Every destination a champion must be able to walk to from its own spawn.
static func reachability_targets(map: MapController) -> PackedStringArray:
	return map.layout.reachability_targets()


## Runs the full check. Returns a report dictionary; [code]ok[/code] is true
## when nothing failed.
static func run(map: MapController, tolerance: float = 2.5) -> Dictionary:
	var report := {
		"ok": true,
		"missing_ids": PackedStringArray(),
		"off_navmesh": PackedStringArray(),
		"unreachable": PackedStringArray(),
		"checked": 0,
		"nav_polygons": map.navigation.polygon_count(),
		"summary": "",
	}

	for id in required_ids(map):
		if not map.registry.has(id):
			report["missing_ids"].append(id)
			report["ok"] = false

	var spawn_id := map.spawns.spawn_id_for_team(MapEnums.Team.A)
	var origin: Variant = _navigable_or_null(map, map.position_of(spawn_id), tolerance)
	if origin == null:
		report["off_navmesh"].append(spawn_id)
		report["ok"] = false
		report["summary"] = "Team A spawn is not on the navigation mesh."
		return report

	for id in reachability_targets(map):
		if not map.registry.has(id):
			report["missing_ids"].append(id)
			report["ok"] = false
			continue
		report["checked"] += 1
		var goal = _navigable_or_null(map, map.position_of(id), tolerance)
		if goal == null:
			report["off_navmesh"].append(id)
			report["ok"] = false
			continue
		if not _path_exists(map, origin, goal, tolerance):
			report["unreachable"].append(id)
			report["ok"] = false

	report["summary"] = "%d/%d destinations reachable from %s (%d nav polygons)." % [
		report["checked"] - report["unreachable"].size() - report["off_navmesh"].size(),
		report["checked"],
		spawn_id,
		report["nav_polygons"],
	]
	return report


static func format(report: Dictionary) -> String:
	var lines := PackedStringArray()
	lines.append("[MapProbe] %s" % report["summary"])
	for key in ["missing_ids", "off_navmesh", "unreachable"]:
		var values: PackedStringArray = report[key]
		if not values.is_empty():
			lines.append("  %s: %s" % [key, ", ".join(values)])
	lines.append("  result: %s" % ("OK" if report["ok"] else "FAILED"))
	return "\n".join(lines)


static func _navigable_or_null(map: MapController, point: Vector3, tolerance: float):
	var closest := map.navigation.closest_navigable_point(point)
	if Vector2(closest.x - point.x, closest.z - point.z).length() > tolerance:
		return null
	return closest


## A path is real when it ends near the requested goal; Godot returns a
## truncated path (or just the start point) when no route exists.
static func _path_exists(map: MapController, from: Vector3, to: Vector3, tolerance: float) -> bool:
	var path := map.navigation.find_path(from, to)
	if path.size() < 2:
		return false
	var arrival := path[path.size() - 1]
	return Vector2(arrival.x - to.x, arrival.z - to.z).length() <= tolerance
