class_name MinionController
extends Unit

## Lane minion driven by a four-state machine:
## MOVE -> SEARCH -> ATTACK -> MOVE.
##
## Movement always goes through the baked navigation mesh, so a minion that
## cannot reach the enemy base is a map problem, not a scripted-path problem.

enum State { MOVE, SEARCH, ATTACK, DEAD }

const STATE_NAMES := ["MOVE", "SEARCH", "ATTACK", "DEAD"]

signal state_changed(state: int)
signal reached_end_of_lane()

## Lane this minion belongs to, for debug and wave bookkeeping.
var lane: int = MapEnums.Lane.MID

var state: int = State.MOVE

var _waypoints: PackedVector3Array = PackedVector3Array()
var _waypoint_index: int = 0
var _search_timer: float = 0.0
var _engage_anchor: Vector3 = Vector3.ZERO
var _corpse_timer: float = 0.0


func _init() -> void:
	kind = Kind.MINION
	mobile = true
	uses_navigation = true
	target_priority = [Kind.MINION, Kind.CHAMPION, Kind.TURRET]


func _ready() -> void:
	super._ready()
	targeting.auto_acquire = false  # the state machine drives acquisition


func minion_stats() -> MinionStats:
	return stats_resource as MinionStats


func aggro_range() -> float:
	var data := minion_stats()
	return data.aggro_range if data != null else 9.0


func leash_distance() -> float:
	var data := minion_stats()
	return data.leash_distance if data != null else 12.0


func _build_visual() -> void:
	var data := minion_stats()
	var shape: int = data.body_shape if data != null else MinionStats.BodyShape.BOX
	var color := PrototypeMeshes.team_color(team).darkened(0.12)
	var height := body_height()
	var mesh: MeshInstance3D
	match shape:
		MinionStats.BodyShape.SPHERE:
			mesh = PrototypeMeshes.sphere(body_radius(), color)
		MinionStats.BodyShape.CAPSULE:
			mesh = PrototypeMeshes.capsule(body_radius(), height, color)
		_:
			mesh = PrototypeMeshes.box(Vector3(body_radius() * 1.7, height, body_radius() * 1.7), color)
	mesh.position = Vector3(0.0, height * 0.5, 0.0)
	visual.add_child(mesh)

	# Ranged minions get a light cap so the two kinds read apart at a glance.
	if stats.value("projectile_speed") > 0.0:
		var cap := PrototypeMeshes.cone(body_radius() * 0.9, height * 0.4, color.lightened(0.4), 8)
		cap.position = Vector3(0.0, height + height * 0.18, 0.0)
		visual.add_child(cap)


## Lane route in world space, from this minion's own base to the enemy base.
func set_lane_route(lane_id: int, points: PackedVector3Array) -> void:
	lane = lane_id
	_waypoints = points
	_waypoint_index = 0
	_advance_to_waypoint()


func current_waypoint() -> int:
	return _waypoint_index


func waypoint_count() -> int:
	return _waypoints.size()


func state_name() -> String:
	return STATE_NAMES[state]


func navigation_target() -> Vector3:
	return movement.destination() if movement != null else Vector3.ZERO


func _think(delta: float) -> void:
	_search_timer -= delta
	match state:
		State.MOVE:
			_tick_move()
		State.SEARCH:
			_tick_search()
		State.ATTACK:
			_tick_attack()


func _set_state(next: int) -> void:
	if state == next:
		return
	state = next
	state_changed.emit(state)


func _tick_move() -> void:
	if _search_timer <= 0.0:
		_set_state(State.SEARCH)
		return
	if movement.is_navigating():
		return
	_advance_to_waypoint()


func _tick_search() -> void:
	_search_timer = targeting.acquire_interval
	var found := targeting.acquire(aggro_range())
	if found != null:
		targeting.set_target(found)
		_engage_anchor = global_position
		_set_state(State.ATTACK)
		return
	_set_state(State.MOVE)
	if not movement.is_navigating():
		_advance_to_waypoint()


func _tick_attack() -> void:
	if not targeting.is_target_valid(INF):
		targeting.clear_target()
		_set_state(State.SEARCH)
		return
	var target := targeting.current_target
	if global_position.distance_to(_engage_anchor) > leash_distance():
		targeting.clear_target()
		_set_state(State.MOVE)
		_advance_to_waypoint()
		return
	if targeting.distance_to_target() <= attack_range():
		movement.stop()
		movement.face_towards(target.global_position)
		combat.try_attack(target)
	else:
		movement.move_to(target.global_position)


func _advance_to_waypoint() -> void:
	if _waypoints.is_empty():
		movement.stop()
		return
	var data := minion_stats()
	var tolerance: float = data.waypoint_tolerance if data != null else 3.0
	while _waypoint_index < _waypoints.size() \
			and global_position.distance_to(_waypoints[_waypoint_index]) <= tolerance:
		_waypoint_index += 1
	if _waypoint_index >= _waypoints.size():
		reached_end_of_lane.emit()
		_waypoint_index = _waypoints.size() - 1
	movement.move_to(_waypoints[_waypoint_index])


func _handle_death(_source: Node) -> void:
	_set_state(State.DEAD)
	visual.visible = false
	var data := minion_stats()
	_corpse_timer = data.corpse_seconds if data != null else 1.2
	set_process(true)


func _process(delta: float) -> void:
	# Replicated corpses are freed by the authority through the spawner.
	if not simulated or is_alive() or _corpse_timer <= 0.0:
		return
	_corpse_timer -= delta
	if _corpse_timer <= 0.0:
		queue_free()
