extends Node

## Dedicated-server integration test: the WAN topology.
##
##   godot --headless --path . tools/NetDedicatedTest.tscn
##
## This process runs the project with no local player — the same thing a public
## host runs with `--dedicated-server` — and launches two client processes that
## both join it. That is the arrangement two players on different networks use,
## with the server standing in for the public endpoint. It proves the server
## seats both teams, starts the match and stays authoritative with nobody
## playing locally.

const MAIN_SCENE := "res://scenes/Main.tscn"
const CLIENT_SCENE := "res://tools/NetClientTest.tscn"
const RESULTS := ["user://net_dedicated_a.json", "user://net_dedicated_b.json"]
const PORT := 8713
const TIMEOUT := 60.0

var _root: GameRoot
var _failures: PackedStringArray = PackedStringArray()
var _pids: Array[int] = []
var _done := false


func _ready() -> void:
	for path in RESULTS:
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	GameRoot._pending_launch = {"mode_id": "solo_lane", "net": "dedicated", "port": PORT}
	_root = load(MAIN_SCENE).instantiate()
	_root.name = "Main"
	_root.print_startup_report = false
	add_child(_root)
	_run()


func _fail(message: String) -> void:
	_failures.append(message)


func _expect(condition: bool, message: String) -> void:
	if not condition:
		_fail(message)


func _now() -> float:
	return float(Time.get_ticks_msec()) / 1000.0


func _wait(seconds: float) -> void:
	var deadline := _now() + seconds
	while _now() < deadline:
		await get_tree().process_frame


func _wait_until(check: Callable, seconds: float, label: String) -> bool:
	var deadline := _now() + seconds
	while _now() < deadline:
		if check.call():
			return true
		await get_tree().process_frame
	_fail("timed out waiting for %s" % label)
	return false


func _run() -> void:
	await _wait(0.5)
	_expect(Net.role == NetTypes.Role.DEDICATED_SERVER, "the dedicated server did not start")
	_expect(Net.is_authority(), "a dedicated server must be the authority")
	_expect(not Net.has_local_player(), "a dedicated server must not seat a local player")
	_expect(_root.session.player_count() == 0, "the server seated itself as a player")
	_expect(_root.champion == null, "the server built a local champion")

	for i in 2:
		_launch_client(RESULTS[i])
	if not await _wait_until(func() -> bool: return Net.peer_count() == 2, 30.0, "both clients"):
		_finish()
		return
	if not await _wait_until(func() -> bool: return _root.session.is_running(), 15.0, "the match to start"):
		_finish()
		return

	var teams: Array[int] = []
	for player in _root.session.sessions():
		teams.append(player.team)
		_expect(player.peer_id != NetTypes.SERVER_PEER_ID, "the server seated itself")
	_expect(teams.has(MapEnums.Team.A) and teams.has(MapEnums.Team.B),
		"the two clients were not given one team each")
	print("[Dedicated] two clients seated as teams %s" % [teams])

	await _wait_until(func() -> bool:
		for player in _root.session.sessions():
			if not player.has_champion():
				return false
		return _root.session.player_count() == 2, 15.0, "both champions to spawn")
	for player in _root.session.sessions():
		_expect(player.has_champion(), "team %s has no champion" % MapEnums.team_name(player.team))
		if player.has_champion():
			_expect(player.champion.simulated, "the server must simulate every champion")

	# The server keeps running the match with nobody playing on this machine.
	_root.director.dev_spawn_wave()
	await _wait(2.0)
	var minions := Battle.count_of(MapEnums.Team.A, Unit.Kind.MINION) \
		+ Battle.count_of(MapEnums.Team.B, Unit.Kind.MINION)
	print("[Dedicated] server is simulating %d minions for two remote players" % minions)
	_expect(minions > 0, "the dedicated server did not simulate minions")

	_expect(_root.director.dev_destroy_enemy_nexus() == false,
		"a dedicated server has no team, so it must not pick a winner by itself")
	var nexus := _root.director.nexus_for("SOLO_NEXUS_B")
	_expect(nexus != null, "SOLO_NEXUS_B is missing")
	if nexus != null:
		nexus.health.kill(null)
	await _wait(1.0)
	_expect(_root.session.phase == NetTypes.MatchPhase.ENDED,
		"destroying a nexus did not end the match on the dedicated server")
	print("[Dedicated] match ended with winner team %s" % MapEnums.team_name(MapEnums.Team.A))

	await _check_reports()
	_finish()


func _launch_client(result_path: String) -> void:
	var project := ProjectSettings.globalize_path("res://")
	var pid := OS.create_process(OS.get_executable_path(), [
		"--headless", "--path", project, CLIENT_SCENE, "--",
		"--port=%d" % PORT, "--result=%s" % result_path
	])
	_expect(pid > 0, "could not launch a client process")
	if pid > 0:
		_pids.append(pid)


## Both clients must have seen a full match through the server.
func _check_reports() -> void:
	await _wait_until(func() -> bool:
		for path in RESULTS:
			if not FileAccess.file_exists(path):
				return false
		return true, 25.0, "both clients to report")
	var seen_teams: Array = []
	for path in RESULTS:
		if not FileAccess.file_exists(path):
			continue
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
		if parsed == null:
			_fail("client report %s could not be parsed" % path)
			continue
		var report: Dictionary = parsed
		print("[Dedicated] report: ", JSON.stringify(report))
		_expect(String(report["role"]) == "CLIENT", "a client did not take the CLIENT role")
		_expect(int(report["roster_size"]) == 2, "a client saw the wrong roster size")
		_expect(int(report["owned_champions"]) == 1, "a client did not own exactly one champion")
		_expect(int(report["simulated_units"]) == 0, "a client simulated units")
		_expect(int(report["turrets_seen"]) == 4, "turrets did not replicate to a client")
		_expect(bool(report["upgrade_call_blocked"]) and bool(report["purchase_call_blocked"])
			and bool(report["ward_call_blocked"]),
			"a client could grant itself progression against a dedicated server")
		_expect(bool(report["gold_forgery_reverted"]), "forged gold survived on a client")
		_expect(int(report["client_rank_q"]) == 0, "a forged ability rank survived on a client")
		seen_teams.append(int(report["local_team"]))
	_expect(seen_teams.has(MapEnums.Team.A) and seen_teams.has(MapEnums.Team.B),
		"the two clients did not report one team each")


func _finish() -> void:
	if _done:
		return
	_done = true
	for pid in _pids:
		OS.kill(pid)
	if _failures.is_empty():
		print("[NetTest] PASS")
		get_tree().quit(0)
	else:
		for failure in _failures:
			printerr("[NetTest] FAIL: ", failure)
		get_tree().quit(1)
