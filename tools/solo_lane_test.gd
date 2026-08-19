extends Node

## Headless/offscreen integration test for the Solo Lane game mode.
##
##   godot --headless --path . tools/SoloLaneTest.tscn
##   godot --path . tools/SoloLaneTest.tscn -- --out=/some/dir
##
## Boots the real game scene in SOLO_LANE and checks the mode's own acceptance
## criteria: the compact one-lane map loads with exactly one lane, two towers
## and one nexus per team and no inhibitors, every required identifier exists,
## the whole lane is navigable from both spawns, waves spawn from both bases,
## the AI drives the enemy champion, and destroying the enemy nexus produces a
## victory.

const MAIN_SCENE := "res://scenes/Main.tscn"
const MODE_ID := "solo_lane"
const SETTLE_FRAMES := 20

const REQUIRED_IDS := [
	"SOLO_LANE",
	"SOLO_SPAWN_A", "SOLO_SPAWN_B",
	"SOLO_MINION_SPAWN_A", "SOLO_MINION_SPAWN_B",
	"SOLO_OUTER_TURRET_A", "SOLO_INNER_TURRET_A",
	"SOLO_OUTER_TURRET_B", "SOLO_INNER_TURRET_B",
	"SOLO_NEXUS_A", "SOLO_NEXUS_B",
]

var _output_dir := ""
var _failures: PackedStringArray = PackedStringArray()
var _root: GameRoot


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			_output_dir = arg.substr(6)
	_run()


func _run() -> void:
	# The scene resolves its mode from the command line; force it here so the
	# test never depends on which mode happens to be the default.
	GameRoot._pending_mode_id = MODE_ID
	_root = load(MAIN_SCENE).instantiate()
	add_child(_root)
	await _settle(SETTLE_FRAMES)

	_check_mode()
	_check_topology()
	await _check_navigation()
	await _check_lane_traversal()
	_check_sandbox()
	await _check_waves()
	_check_no_ai_opponent()
	await _check_nexus_siege()
	await _capture_screenshots()
	await _check_victory()
	await _capture_result()

	if _failures.is_empty():
		print("[SoloTest] PASS")
		get_tree().quit(0)
	else:
		for failure in _failures:
			printerr("[SoloTest] FAIL: ", failure)
		get_tree().quit(1)


func _fail(message: String) -> void:
	_failures.append(message)


func _expect(condition: bool, message: String) -> void:
	if not condition:
		_fail(message)


func _settle(frames: int) -> void:
	for i in frames:
		await get_tree().process_frame


func _settle_physics(frames: int) -> void:
	for i in frames:
		await get_tree().physics_frame


# --- mode and topology -------------------------------------------------------

func _check_mode() -> void:
	_expect(_root.mode != null and _root.mode.id == MODE_ID, "the scene did not start in Solo Lane")
	_expect(_root.map.layout is SoloLaneLayout, "Solo Lane is not using SoloLaneLayout")
	_expect(_root.map.config is SoloLaneConfig, "Solo Lane is not using SoloLaneConfig")


func _check_topology() -> void:
	var layout := _root.map.layout
	print("[SoloTest] map: ", _root.map.describe())
	_expect(layout.lanes.size() == 1, "expected exactly one lane, got %d" % layout.lanes.size())
	_expect(String(layout.lanes[0]["id"]) == "SOLO_LANE", "the lane is not named SOLO_LANE")
	_expect(layout.turrets.size() == 4, "expected four towers, got %d" % layout.turrets.size())
	_expect(layout.nexuses.size() == 2, "expected two nexuses, got %d" % layout.nexuses.size())
	_expect(layout.inhibitors.is_empty(), "Solo Lane must have no inhibitors")
	_expect(layout.jungles.is_empty(), "Solo Lane must have no jungle quadrants")
	_expect(layout.objectives.is_empty(), "Solo Lane must have no neutral objectives")
	_expect(layout.river.is_empty(), "Solo Lane must have no river")

	for team in [MapEnums.Team.A, MapEnums.Team.B]:
		var owned := 0
		for turret in layout.turrets:
			if int(turret["team"]) == team:
				owned += 1
		_expect(owned == 2, "team %s has %d towers, expected 2" % [MapEnums.team_name(team), owned])

	for id in REQUIRED_IDS:
		_expect(_root.map.registry.has(id), "missing map identifier %s" % id)

	# The bases sit at opposite ends of the lane axis.
	var a: Vector2 = layout.base_data(MapEnums.Team.A)["position"]
	var b: Vector2 = layout.base_data(MapEnums.Team.B)["position"]
	_expect(signf(a.y) != signf(b.y), "both bases are on the same side of the map")
	print("[SoloTest] base A %s, base B %s, lane %.0f m" % [a, b, layout.lanes[0]["length"]])


func _check_navigation() -> void:
	await _root.map.navigation.await_synchronization()
	var report := MapProbe.run(_root.map)
	print(MapProbe.format(report))
	_expect(bool(report["ok"]), "Solo Lane failed the reachability check")
	_expect(int(report["nav_polygons"]) > 0, "the Solo Lane navigation mesh is empty")


## Walks the full lane end to end over the baked mesh, in both directions.
func _check_lane_traversal() -> void:
	var navigation := _root.map.navigation
	var a := _root.map.position_of("SOLO_SPAWN_A")
	var b := _root.map.position_of("SOLO_SPAWN_B")
	for pair in [[a, b], [b, a]]:
		var from: Vector3 = pair[0]
		var to: Vector3 = pair[1]
		var path := navigation.find_path(from, to)
		var arrival: Vector3 = path[path.size() - 1] if path.size() > 0 else from
		var gap := Vector2(arrival.x - to.x, arrival.z - to.z).length()
		_expect(path.size() >= 2 and gap <= 2.5, "no navigable path between the two spawns")
	# Every tower and nexus must be approachable from the player's spawn.
	for id in REQUIRED_IDS:
		var point := _root.map.position_of(id)
		var closest := navigation.closest_navigable_point(point)
		var offset := Vector2(closest.x - point.x, closest.z - point.z).length()
		_expect(offset < 6.0, "%s is not reachable from the lane (%.1f m off mesh)" % [id, offset])
	print("[SoloTest] lane traversable in both directions")


# --- match -------------------------------------------------------------------

func _check_sandbox() -> void:
	var director := _root.director
	print("[SoloTest] sandbox: ", director.describe())
	_expect(director.player != null and director.player.is_alive(), "the player champion did not spawn")
	_expect(director.turrets.size() == 4, "expected four turret controllers")
	_expect(director.nexuses.size() == 2, "expected two nexus controllers")
	for id in ["SOLO_OUTER_TURRET_A", "SOLO_INNER_TURRET_A", "SOLO_OUTER_TURRET_B", "SOLO_INNER_TURRET_B"]:
		_expect(director.turret_for(id) != null, "%s has no controller" % id)
	for id in ["SOLO_NEXUS_A", "SOLO_NEXUS_B"]:
		var nexus := director.nexus_for(id)
		_expect(nexus != null and nexus.is_alive(), "%s has no living controller" % id)
	# Solo Lane is 1v1 between humans: offline seats one player and nobody else.
	_expect(director.enemy_champions.is_empty(), "Solo Lane must not spawn an AI opponent")
	_expect(director.session != null and director.session.player_count() == 1,
		"offline Solo Lane should seat exactly one local player")
	_expect(director.session.is_running(), "the offline match did not start")

	var spawn := _root.map.position_of("SOLO_SPAWN_A")
	_expect(director.player.global_position.distance_to(spawn) < 3.0,
		"the player did not spawn at SOLO_SPAWN_A")


func _check_waves() -> void:
	var spawned := _root.director.dev_spawn_wave()
	print("[SoloTest] manual wave spawned %d minions" % spawned)
	_expect(spawned > 0, "the solo wave spawner produced no minions")

	var per_team := {MapEnums.Team.A: 0, MapEnums.Team.B: 0}
	var sample: MinionController = null
	for unit in Battle.all():
		if unit.kind == Unit.Kind.MINION and unit.is_alive():
			per_team[unit.team] += 1
			if unit.team == MapEnums.Team.A:
				sample = unit
	_expect(per_team[MapEnums.Team.A] > 0, "team A spawned no minions")
	_expect(per_team[MapEnums.Team.B] > 0, "team B spawned no minions")

	var minion_spawn := _root.map.position_of("SOLO_MINION_SPAWN_A")
	_expect(sample != null and sample.global_position.distance_to(minion_spawn) < 8.0,
		"team A minions did not appear at SOLO_MINION_SPAWN_A")

	var start := sample.global_position
	await _settle_physics(150)
	var travelled := sample.global_position.distance_to(start)
	print("[SoloTest] sample minion walked %.1f m down the lane (state %s)" % [travelled, sample.state_name()])
	_expect(travelled > 1.5, "solo minions did not navigate down the lane")


## The second champion comes from a second human, never from a brain.
func _check_no_ai_opponent() -> void:
	var champions := 0
	for unit in Battle.all():
		if unit.kind == Unit.Kind.CHAMPION:
			champions += 1
			_expect(unit.ai == null, "%s has an AI brain attached" % unit.display_label())
	print("[SoloTest] champions in an offline solo match: %d" % champions)
	_expect(champions == 1, "expected exactly the local champion offline, found %d" % champions)


## A minion parked next to the enemy nexus must damage it. The lane is cleared
## first so the result is about the nexus and not about passing traffic.
func _check_nexus_siege() -> void:
	var nexus := _root.director.nexus_for("SOLO_NEXUS_B")
	_expect(nexus != null, "no controller for SOLO_NEXUS_B")
	if nexus == null:
		return
	await _clear_lane()

	var before := nexus.health.current
	var stats: MinionStats = _root.director.config.wave.melee_stats.duplicate()
	stats.max_health = 2000.0
	var attacker := MinionController.new()
	attacker.initialize(MapEnums.Team.A, stats)
	attacker.name = "NexusSiegeDummy"
	_root.units.add_child(attacker)
	attacker.global_position = nexus.global_position + Vector3(0.0, 0.2, 5.0)

	await _settle_physics(240)
	print("[SoloTest] nexus %.0f -> %.0f HP under siege (attacker target %s)" % [
		before, nexus.health.current,
		"none" if attacker.targeting.current_target == null else attacker.targeting.current_target.display_label()
	])
	_expect(attacker.targeting.current_target == nexus, "the minion did not target the enemy nexus")
	_expect(nexus.health.current < before, "minions did not damage the enemy nexus")
	if is_instance_valid(attacker):
		attacker.queue_free()
	await _settle_physics(4)


## Removes lane traffic and parks the AI so a check observes one interaction.
func _clear_lane() -> void:
	if _root.director.waves != null:
		_root.director.waves.stop()
	for unit in Battle.all():
		if unit.kind == Unit.Kind.MINION:
			unit.queue_free()
	await _settle_physics(4)


## Destroying the enemy nexus must end the match as a victory.
func _check_victory() -> void:
	var director := _root.director
	_expect(director.match_state.is_running(), "the match ended before the nexus was destroyed")
	_expect(director.dev_destroy_enemy_nexus(), "could not destroy the enemy nexus")
	await _settle_physics(6)
	_expect(director.match_state.outcome == MatchState.Outcome.VICTORY,
		"destroying the enemy nexus did not produce VICTORY (got %s)" % director.match_state.outcome_name())
	_expect(director.match_state.winner == director.player_team, "the wrong team was recorded as the winner")
	_expect(not director.nexus_for("SOLO_NEXUS_B").is_alive(), "the enemy nexus survived")
	print("[SoloTest] outcome: %s" % director.match_state.outcome_name())


# --- screenshots -------------------------------------------------------------

func _capture_screenshots() -> void:
	if _output_dir.is_empty():
		return
	var camera := _root.camera
	camera.locked_to_target = false
	camera.max_distance = 260.0
	camera.pitch_degrees = -70.0
	camera.set_distance(165.0)
	camera.set_focus(Vector3.ZERO)
	await _save_frame("solo_overview.png")

	_root.map.set_debug_visible(true)
	await _save_frame("solo_overview_debug.png")
	_root.map.set_debug_visible(false)

	if _root.director.waves != null:
		_root.director.waves.start()
	_root.director.dev_spawn_wave()
	var lane_point := _root.map.layout.lane_point(SoloLaneLayout.SOLO_LANE, 0.38)
	_root.champion.teleport_to(Vector3(lane_point.x, 0.0, lane_point.y))
	camera.pitch_degrees = -52.0
	camera.set_distance(40.0)
	camera.locked_to_target = true
	camera.set_follow_target(_root.champion)
	await _settle_physics(200)
	await _save_frame("solo_lane_fight.png")


## The result banner, proving the win condition reaches the screen.
func _capture_result() -> void:
	if _output_dir.is_empty():
		return
	_root.camera.locked_to_target = false
	_root.camera.pitch_degrees = -60.0
	_root.camera.set_distance(70.0)
	_root.camera.set_focus(_root.map.position_of("SOLO_NEXUS_B"))
	await _settle(10)
	await _save_frame("solo_victory.png")


func _save_frame(file_name: String) -> void:
	await _settle(4)
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	if image == null:
		_fail("could not capture %s" % file_name)
		return
	var path := _output_dir.path_join(file_name)
	var error := image.save_png(path)
	if error != OK:
		_fail("could not write %s (error %d)" % [path, error])
	else:
		print("[SoloTest] wrote ", path)
