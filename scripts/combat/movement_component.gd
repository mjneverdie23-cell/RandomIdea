class_name MovementComponent
extends Node

## Drives a [CharacterBody3D] either directly (a movement command from the
## input bus) or along the baked navigation mesh (a destination).
##
## Nothing above this component knows whether a unit is player-driven or
## AI-driven; both just hand it an intent.

enum Mode { IDLE, DIRECT, NAVIGATE }

signal destination_reached()

var body: CharacterBody3D
var stats: StatsComponent
var agent: NavigationAgent3D
var mode: int = Mode.IDLE
var enabled: bool = true

@export_range(0.0, 40.0, 0.5) var gravity: float = 24.0
@export_range(1.0, 200.0, 1.0) var acceleration: float = 60.0
@export_range(1.0, 30.0, 0.5) var turn_speed: float = 12.0

var _direction: Vector2 = Vector2.ZERO
var _vertical: float = 0.0
var _facing: Vector3 = Vector3.FORWARD
var _avoid_velocity: Vector3 = Vector3.ZERO
var _dash_direction: Vector3 = Vector3.ZERO
var _dash_speed: float = 0.0
var _dash_time: float = 0.0


func setup(target_body: CharacterBody3D, stats_component: StatsComponent, use_agent: bool, radius: float = 1.0) -> void:
	body = target_body
	stats = stats_component
	body.motion_mode = CharacterBody3D.MOTION_MODE_GROUNDED
	body.floor_snap_length = 0.6
	if use_agent:
		agent = NavigationAgent3D.new()
		agent.name = "NavigationAgent3D"
		agent.radius = radius
		agent.height = radius * 2.0
		agent.path_desired_distance = 1.0
		agent.target_desired_distance = 1.2
		agent.path_max_distance = 8.0
		agent.avoidance_enabled = true
		agent.neighbor_distance = 10.0
		agent.max_neighbors = 8
		agent.max_speed = maxf(stats_component.value("move_speed"), 1.0)
		body.add_child(agent)
		agent.velocity_computed.connect(func(safe: Vector3) -> void: _avoid_velocity = safe)


func speed() -> float:
	return stats.value("move_speed") if stats != null else 0.0


## Movement intent on the XZ plane, length 0..1. Cancels any destination.
func set_direction(direction: Vector2) -> void:
	_direction = direction
	mode = Mode.DIRECT if direction.length_squared() > 0.0001 else Mode.IDLE


func move_to(point: Vector3) -> void:
	if agent == null:
		return
	agent.target_position = point
	mode = Mode.NAVIGATE


func stop() -> void:
	_direction = Vector2.ZERO
	mode = Mode.IDLE


func is_navigating() -> bool:
	return mode == Mode.NAVIGATE


func destination() -> Vector3:
	return agent.target_position if agent != null else Vector3.ZERO


func distance_to_destination() -> float:
	if agent == null or mode != Mode.NAVIGATE:
		return 0.0
	return body.global_position.distance_to(agent.target_position)


## Short burst of forced movement, used by the dash ability.
func start_dash(direction: Vector3, dash_speed: float, duration: float) -> void:
	_dash_direction = direction.normalized()
	_dash_speed = dash_speed
	_dash_time = duration
	if _dash_direction.length_squared() > 0.0:
		_facing = _dash_direction


func is_dashing() -> bool:
	return _dash_time > 0.0


func facing() -> Vector3:
	return _facing


func face_towards(point: Vector3) -> void:
	var offset := point - body.global_position
	offset.y = 0.0
	if offset.length_squared() > 0.0001:
		_facing = offset.normalized()


## Called from the owner's _physics_process; performs the single move_and_slide.
func physics_step(delta: float) -> void:
	if body == null:
		return
	_vertical = 0.0 if body.is_on_floor() else _vertical - gravity * delta

	var desired := Vector3.ZERO
	if not enabled:
		_direction = Vector2.ZERO
		mode = Mode.IDLE
	elif _dash_time > 0.0:
		_dash_time -= delta
		desired = _dash_direction * _dash_speed
	elif mode == Mode.DIRECT:
		desired = Vector3(_direction.x, 0.0, _direction.y) * speed()
	elif mode == Mode.NAVIGATE and agent != null:
		if agent.is_navigation_finished():
			mode = Mode.IDLE
			destination_reached.emit()
		else:
			var to_next := agent.get_next_path_position() - body.global_position
			to_next.y = 0.0
			if to_next.length() > 0.05:
				desired = to_next.normalized() * speed()

	if mode == Mode.NAVIGATE and agent != null and agent.avoidance_enabled:
		agent.max_speed = maxf(speed(), 1.0)
		# The server answers on velocity_computed, so steer with last frame's
		# collision-free result and never move twice in one physics step.
		agent.velocity = desired
		desired = _avoid_velocity

	if desired.length_squared() > 0.01:
		_facing = desired.normalized()

	body.velocity.x = move_toward(body.velocity.x, desired.x, acceleration * delta)
	body.velocity.z = move_toward(body.velocity.z, desired.z, acceleration * delta)
	body.velocity.y = _vertical
	body.move_and_slide()
