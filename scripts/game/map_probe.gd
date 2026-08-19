class_name MapProbe
extends RefCounted

## Read-only navigation checks over a built map.
##
## Used by the startup report and by the headless smoke test to prove the
## acceptance criteria: every gameplay space is on the navigation mesh and
## reachable from a team's spawn without any hardcoded route.

## Identifiers a playable map must expose, checked on every run.
const REQUIRED_IDS := [
	"TEAM_A_SPAWN", "TEAM_B_SPAWN",
	"TEAM_A_NEXUS", "TEAM_B_NEXUS",
	"TEAM_A_BASE", "TEAM_B_BASE",
	"TOP_LANE", "MID_LANE", "BOT_LANE", "RIVER",
	"TOP_OUTER_TURRET_A", "TOP_OUTER_TURRET_B",
	"MID_OUTER_TURRET_A", "MID_OUTER_TURRET_B",
	"BOT_OUTER_TURRET_A", "BOT_OUTER_TURRET_B",
	"TOP_OBJECTIVE", "BOT_OBJECTIVE",
	"JUNGLE_A_TOP", "JUNGLE_A_BOT", "JUNGLE_B_TOP", "JUNGLE_B_BOT",
]


## Every destination a champion must be able to walk to from its own spawn.
static func reachability_targets(map: MapController) -> PackedStringArray:
	var ids := PackedStringArray([
		# Structure centres (nexus, turrets) are solid on purpose, so the enemy
		# base is probed through its open ground and fountain.
		"TEAM_B_SPAWN", "TEAM_B_BASE", "TOP_OBJECTIVE", "BOT_OBJECTIVE",
	])
	for lane in [MapEnums.Lane.TOP, MapEnums.Lane.MID, MapEnums.Lane.BOT]:
		ids.append("%s_LANE" % MapEnums.lane_name(lane))
	for jungle in map.layout.jungles:
		ids.append(String(jungle["id"]))
	for camp in map.layout.camps:
		ids.append(String(camp["id"]))
	return ids


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

	for id in REQUIRED_IDS:
		if not map.registry.has(id):
			report["missing_ids"].append(id)
			report["ok"] = false

	var origin: Variant = _navigable_or_null(map, map.position_of("TEAM_A_SPAWN"), tolerance)
	if origin == null:
		report["off_navmesh"].append("TEAM_A_SPAWN")
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

	report["summary"] = "%d/%d destinations reachable from TEAM_A_SPAWN (%d nav polygons)." % [
		report["checked"] - report["unreachable"].size() - report["off_navmesh"].size(),
		report["checked"],
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
