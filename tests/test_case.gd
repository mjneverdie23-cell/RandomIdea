## Minimal test framework.
##
## A test file extends TestCase and defines `func test_*()` methods. The runner
## calls each one on a fresh instance, so tests never share state. Every test
## method may `await` - most do, because the simulation advances on physics
## frames.
class_name TestCase
extends Node

var failures: Array[String] = []
var assertions: int = 0
var _current: String = ""

## Seconds of simulation advanced per `step()` call.
const STEP := 1.0 / 64.0

# --------------------------------------------------------------- assertions --
func check(condition: bool, message: String) -> void:
	assertions += 1
	if not condition:
		failures.append("%s: %s" % [_current, message])

func check_equal(actual, expected, message: String) -> void:
	check(actual == expected, "%s (expected %s, got %s)" % [message, expected, actual])

func check_almost(actual: float, expected: float, tolerance: float, message: String) -> void:
	check(absf(actual - expected) <= tolerance,
		"%s (expected %s +/- %s, got %s)" % [message, expected, tolerance, actual])

func check_greater(actual: float, threshold: float, message: String) -> void:
	check(actual > threshold, "%s (expected > %s, got %s)" % [message, threshold, actual])

func check_less(actual: float, threshold: float, message: String) -> void:
	check(actual < threshold, "%s (expected < %s, got %s)" % [message, threshold, actual])

# ------------------------------------------------------------------ helpers --
## Runs `seconds` of simulation. The session ticks itself on physics frames, so
## tests exercise exactly the same path the running game does.
func advance(_session: MatchSession, seconds: float) -> void:
	var ticks := int(round(seconds / STEP))
	for i in ticks:
		await get_tree().physics_frame

## Runs until `predicate` returns true, or the timeout elapses. Returns success.
func advance_until(_session: MatchSession, predicate: Callable, timeout_seconds: float = 30.0) -> bool:
	var ticks := int(round(timeout_seconds / STEP))
	for i in ticks:
		if predicate.call():
			return true
		await get_tree().physics_frame
	return predicate.call()

## Creates a bot-free session for a test. Characters are added by the test.
func make_session(options: Dictionary = {}) -> MatchSession:
	var defaults := {"with_local_player": false, "fill_bots": false, "seed": 4242}
	for key in options:
		defaults[key] = options[key]
	var session := MatchSession.new()
	add_child(session)
	session.configure(defaults)
	return session

## Puts a character at a world position, facing `yaw`.
func place(character: Character, x: float, z: float, y: float = 0.2, yaw: float = 0.0) -> void:
	character.spawn_at(Vector3(x, y, z), yaw)

## Waits until the navigation map is usable. Navigation is synchronised on the
## server's own schedule, so a freshly built map needs a nudge before queries.
## Waits until the navigation map actually answers queries.
##
## A freshly added region is not usable the moment the map reports a sync: the
## iteration counter moves before the region's polygons are live, and queries
## made too early return empty paths with no error. Probing a point we know is
## on the mesh is the only reliable readiness test.
func sync_navigation(session: MatchSession) -> RID:
	var map_rid := session.get_world_3d().navigation_map
	var probe: Vector3 = session.map_definition.attacker_spawns[0].position
	for i in 120:
		await get_tree().physics_frame
		if NavigationServer3D.map_get_iteration_id(map_rid) < 1:
			continue
		if NavigationServer3D.map_get_closest_point(map_rid, probe) != Vector3.ZERO:
			return map_rid
	push_warning("sync_navigation: the navigation map never became queryable")
	return map_rid

## Points `shooter` at `target`'s centre of mass.
func aim_at(shooter: Character, target: Character) -> void:
	var to_target := target.center_position() - shooter.eye_position()
	shooter.intent.yaw = atan2(-to_target.x, -to_target.z)
	shooter.yaw = shooter.intent.yaw
	var flat := Vector2(to_target.x, to_target.z).length()
	shooter.intent.pitch = atan2(to_target.y, flat)
	shooter.pitch = shooter.intent.pitch

## Freezes round logic (no phase changes, no warmup respawns, no elimination
## checks) so a test can study one mechanic in isolation, and starts ticking.
func pause_rounds(session: MatchSession, combat_enabled: bool = true) -> void:
	session.round_manager.paused = true
	session.combat.combat_enabled = combat_enabled
	session.begin_ticking()

## Fast-forwards through warmup and the buy phase into a live round.
func start_live_round(session: MatchSession) -> void:
	session.start()
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.BUY, 30.0)
	session.round_manager.skip_phase()
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.LIVE, 30.0)

## Collects a signal's payloads for later assertions.
func record(target_signal: Signal) -> Array:
	var log: Array = []
	target_signal.connect(func(a = null, b = null, c = null, d = null, e = null, f = null):
		log.append([a, b, c, d, e, f]))
	return log

# --------------------------------------------------------------- runner API --
func run_all() -> Dictionary:
	var results := {"passed": 0, "failed": 0, "names": []}
	for method in get_method_list():
		var name: String = method["name"]
		if not name.begins_with("test_"):
			continue
		_current = name
		var before := failures.size()
		await call(name)
		var ok := failures.size() == before
		results["passed"] += 1 if ok else 0
		results["failed"] += 0 if ok else 1
		results["names"].append({"name": name, "ok": ok})
	return results
