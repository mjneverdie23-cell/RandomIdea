extends Node

## Host half of the networked Solo Lane integration test, and its runner.
##
##   godot --headless --path . tools/NetMatchTest.tscn
##
## It hosts a match, launches a second headless process as the client, plays a
## scripted 1v1 and checks both halves: team assignment, ownership, client input
## reaching the authority, and replication of movement, damage, death, respawn,
## minions, turrets, the nexus and the result. The client's observations come
## back through a file and are asserted here, so one command covers both sides.

const MAIN_SCENE := "res://scenes/Main.tscn"
const CLIENT_SCENE := "res://tools/NetClientTest.tscn"
const CLIENT_RESULT := "user://net_client_result.json"
const PORT := 8711
const TIMEOUT := 60.0

var _root: GameRoot
var _failures: PackedStringArray = PackedStringArray()
var _client_pid: int = -1
var _client_report: Dictionary = {}
var _done := false


func _ready() -> void:
	if FileAccess.file_exists(CLIENT_RESULT):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(CLIENT_RESULT))
	GameRoot._pending_launch = {"mode_id": "solo_lane", "net": "host", "port": PORT}
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


func _now() -> float:
	return float(Time.get_ticks_msec()) / 1000.0


# --- the scripted match ------------------------------------------------------

func _run() -> void:
	await _wait(0.5)
	_expect(Net.role == NetTypes.Role.HOST, "the host did not start")
	_expect(Net.is_connected_now(), "the host is not listening")
	_expect(_root.session.phase == NetTypes.MatchPhase.WAITING_FOR_PLAYERS,
		"a networked match should wait for its opponent before starting")
	_expect(_root.director.enemy_champions.is_empty(), "Solo Lane must not spawn an AI opponent")

	_launch_client()
	if not await _wait_until(func() -> bool: return Net.peer_count() > 0, 25.0, "the client to connect"):
		_finish()
		return
	print("[NetHost] client connected, peer count %d" % Net.peer_count())

	if not await _wait_until(func() -> bool: return _root.session.is_running(), 10.0, "the match to start"):
		_finish()
		return
	await _check_seating()
	await _check_client_input()
	await _check_damage_and_respawn()
	await _check_minions()
	await _check_victory()
	await _check_client_report()
	await _check_disconnect()
	_finish()


func _launch_client() -> void:
	var project := ProjectSettings.globalize_path("res://")
	_client_pid = OS.create_process(OS.get_executable_path(), [
		"--headless", "--path", project, CLIENT_SCENE, "--",
		"--port=%d" % PORT, "--result=%s" % CLIENT_RESULT
	])
	_expect(_client_pid > 0, "could not launch the client process")


func _check_seating() -> void:
	var session: MatchSession = _root.session
	_expect(session.player_count() == 2, "expected two seated players, got %d" % session.player_count())
	var team_a := session.session_for_team(MapEnums.Team.A)
	var team_b := session.session_for_team(MapEnums.Team.B)
	_expect(team_a != null and team_b != null, "teams were not assigned one per player")
	if team_a == null or team_b == null:
		return
	_expect(team_a.peer_id == NetTypes.SERVER_PEER_ID, "the host should hold team A")
	_expect(team_b.peer_id != NetTypes.SERVER_PEER_ID, "the client should hold team B")

	await _wait_until(func() -> bool: return team_a.has_champion() and team_b.has_champion(),
		10.0, "both champions to spawn")
	_expect(team_a.champion.owner_peer_id == team_a.peer_id, "team A champion has the wrong owner")
	_expect(team_b.champion.owner_peer_id == team_b.peer_id, "team B champion has the wrong owner")
	_expect(team_a.champion.team == MapEnums.Team.A and team_b.champion.team == MapEnums.Team.B,
		"champions were spawned on the wrong teams")
	# Each champion has its own bus; only the owner's commands reach it.
	_expect(team_a.commands != team_b.commands, "both players share one command bus")
	# Drive the host's own champion too, so the client has remote movement to
	# replicate rather than a stationary opponent.
	_root.pc_input.set_process(false)
	_root.commands.set_move_direction(Vector2(0.0, -1.0))
	print("[NetHost] seated peer %d as team A and peer %d as team B" % [team_a.peer_id, team_b.peer_id])


## The client holds a movement command; the host must be the one that moves it.
func _check_client_input() -> void:
	var remote := _root.session.session_for_team(MapEnums.Team.B)
	if remote == null or not remote.has_champion():
		_fail("no remote champion to drive")
		return
	var start: Vector3 = remote.champion.global_position
	await _wait(2.5)
	var travelled := start.distance_to(remote.champion.global_position)
	print("[NetHost] client-driven champion moved %.1f m on the host" % travelled)
	_expect(travelled > 15.0, "the client's movement command never reached the host")
	_expect(remote.champion.simulated, "the host must simulate every champion")

	# A request from an unseated peer must be refused outright.
	var before := _root.relay.rejected_count()
	_root.relay._request_ability(0, Vector3.ZERO)
	_expect(_root.relay.rejected_count() > before,
		"a command from an unseated peer was not rejected")


func _check_damage_and_respawn() -> void:
	var remote := _root.session.session_for_team(MapEnums.Team.B)
	if remote == null or not remote.has_champion():
		return
	var champion: ChampionController = remote.champion
	# Shorten this champion's respawn without touching the shared resource.
	champion.loadout = champion.loadout.duplicate()
	champion.loadout.respawn_time = 1.5

	var before := champion.health.current
	champion.apply_damage(220.0, null)
	_expect(champion.health.current < before, "damage did not apply on the host")
	await _wait(0.6)

	champion.health.kill(null)
	_expect(not champion.is_alive(), "the host could not kill the client's champion")
	await _wait_until(func() -> bool: return champion.is_alive(), 8.0, "the champion to respawn")
	print("[NetHost] client champion died and respawned at %.0f HP" % champion.health.current)


func _check_minions() -> void:
	var spawned := _root.director.dev_spawn_wave()
	_expect(spawned > 0, "the host spawned no minions")
	await _wait(1.5)
	var alive := Battle.count_of(MapEnums.Team.A, Unit.Kind.MINION) \
		+ Battle.count_of(MapEnums.Team.B, Unit.Kind.MINION)
	print("[NetHost] %d minions spawned, %d alive on the host" % [spawned, alive])
	_expect(alive > 0, "minions did not survive on the host")


func _check_victory() -> void:
	_expect(_root.director.nexuses.size() == 2, "expected two nexus controllers")
	_expect(_root.director.dev_destroy_enemy_nexus(), "the host could not destroy the enemy nexus")
	await _wait(0.5)
	_expect(_root.director.match_state.outcome == MatchState.Outcome.VICTORY,
		"the host did not record a victory")
	_expect(_root.session.phase == NetTypes.MatchPhase.ENDED, "the match phase did not end")
	var host_champion := _root.session.session_for_team(MapEnums.Team.A)
	if host_champion != null and host_champion.has_champion():
		print("[NetHost] host champion at %s (spawned at %s)" % [
			host_champion.champion.global_position, host_champion.champion.spawn_point
		])
	print("[NetHost] outcome %s" % _root.director.match_state.outcome_name())


## Reads what the client saw and asserts replication from its point of view.
func _check_client_report() -> void:
	await _wait_until(func() -> bool: return FileAccess.file_exists(CLIENT_RESULT),
		20.0, "the client to report")
	if not FileAccess.file_exists(CLIENT_RESULT):
		return
	var text := FileAccess.get_file_as_string(CLIENT_RESULT)
	var parsed: Variant = JSON.parse_string(text)
	if parsed == null:
		_fail("the client report could not be parsed")
		return
	_client_report = parsed
	print("[NetHost] client report: ", text)

	_expect(bool(_client_report["connected"]), "the client never reported a connection")
	_expect(String(_client_report["role"]) == "CLIENT", "the client did not take the CLIENT role")
	_expect(int(_client_report["local_team"]) == MapEnums.Team.B, "the client was not assigned team B")
	_expect(int(_client_report["roster_size"]) == 2, "the client saw the wrong roster size")
	_expect(int(_client_report["owned_champions"]) == 1, "the client did not own exactly one champion")
	_expect(int(_client_report["foreign_champions"]) == 1, "the client did not see the host's champion")
	_expect(int(_client_report["simulated_units"]) == 0,
		"the client simulated units instead of rendering replicated state")
	_expect(float(_client_report["remote_champion_moved"]) > 20.0,
		"the host's champion did not move on the client")
	_expect(float(_client_report["own_champion_moved"]) > 10.0,
		"the client's own champion did not move on the client")
	_expect(float(_client_report["own_health_min"]) < float(_client_report["own_health_max"]),
		"damage did not replicate to the client")
	_expect(bool(_client_report["saw_own_death"]), "death did not replicate to the client")
	_expect(bool(_client_report["saw_own_respawn"]), "respawn did not replicate to the client")
	_expect(int(_client_report["minions_seen"]) > 0, "minions did not replicate to the client")
	_expect(int(_client_report["turrets_seen"]) == 4, "turrets did not replicate to the client")
	_expect(int(_client_report["nexuses_seen"]) == 2, "nexuses did not replicate to the client")
	_expect(float(_client_report["nexus_b_min_health"]) <= 0.0,
		"the destroyed nexus did not replicate to the client")
	_expect(String(_client_report["outcome"]) == "DEFEAT",
		"the client scored the result as %s instead of DEFEAT" % _client_report.get("outcome", "?"))


## The client exits after reporting; the host must notice and clean up.
func _check_disconnect() -> void:
	await _wait_until(func() -> bool: return Net.peer_count() == 0, 20.0, "the client to disconnect")
	_expect(Net.peer_count() == 0, "the host still thinks a peer is connected")
	_expect(_root.session.session_for_team(MapEnums.Team.B) == null,
		"the disconnected player was not unseated")
	print("[NetHost] client disconnected cleanly")


func _finish() -> void:
	if _done:
		return
	_done = true
	if _client_pid > 0:
		OS.kill(_client_pid)
	if _failures.is_empty():
		print("[NetTest] PASS")
		get_tree().quit(0)
	else:
		for failure in _failures:
			printerr("[NetTest] FAIL: ", failure)
		get_tree().quit(1)
