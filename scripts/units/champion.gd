class_name Champion
extends CharacterBody3D

## Prototype player champion: a capsule that walks the map.
##
## It reads intent from an [InputCommands] bus only, so the same champion works
## with keyboard, a mobile joystick or an AI driver. Abilities and attacks are
## deliberately just cooldowns plus a placeholder pulse — enough to prove the
## command plumbing without pretending to be combat.

signal ability_cast(slot: int)
signal ability_blocked(slot: int, remaining: float)
signal basic_attack(aim_point: Vector3)
signal recall_started(duration: float)
signal recall_finished()
signal recall_interrupted()

const ABILITY_COOLDOWNS := [3.0, 5.0, 4.0, 12.0]
const ABILITY_RADII := [4.5, 6.5, 3.0, 9.0]
const ABILITY_COLORS := [
	Color(0.35, 0.75, 1.0),
	Color(0.45, 1.0, 0.55),
	Color(1.0, 0.85, 0.30),
	Color(1.0, 0.35, 0.85),
]

@export var team: int = MapEnums.Team.A
@export_range(1.0, 30.0, 0.5) var move_speed: float = 11.0
@export_range(1.0, 60.0, 0.5) var acceleration: float = 45.0
@export_range(1.0, 30.0, 0.5) var turn_speed: float = 12.0
@export_range(0.0, 40.0, 0.5) var gravity: float = 24.0
@export_range(0.5, 3.0, 0.05) var body_radius: float = 0.95
@export_range(1.0, 5.0, 0.05) var body_height: float = 2.8
@export_range(0.1, 5.0, 0.05) var attack_cooldown: float = 0.55
@export_range(1.0, 20.0, 0.5) var attack_range: float = 6.0
@export_range(0.1, 6.0, 0.1) var recall_duration: float = 1.6

var commands: InputCommands
## Set by the game root so recall knows where the fountain is.
var recall_target: Vector3 = Vector3.ZERO

var _cooldowns := PackedFloat32Array([0.0, 0.0, 0.0, 0.0])
var _attack_timer: float = 0.0
var _recall_timer: float = 0.0
var _recalling := false
var _facing := Vector3.FORWARD
var _mesh_root: Node3D


func _ready() -> void:
	collision_layer = 0b10  # player
	collision_mask = 0b1101  # world, enemies, structures
	motion_mode = CharacterBody3D.MOTION_MODE_GROUNDED
	floor_snap_length = 0.6
	_build_body()


## Connects the champion to a command bus. Called by the game root.
func bind_commands(bus: InputCommands) -> void:
	commands = bus
	bus.ability_requested.connect(_on_ability_requested)
	bus.basic_attack_requested.connect(_on_basic_attack_requested)
	bus.recall_requested.connect(_on_recall_requested)
	bus.recall_cancelled.connect(_cancel_recall)


func _build_body() -> void:
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = body_radius
	capsule.height = body_height
	shape.shape = capsule
	shape.position = Vector3(0.0, body_height * 0.5, 0.0)
	add_child(shape)

	_mesh_root = Node3D.new()
	_mesh_root.name = "Visual"
	add_child(_mesh_root)

	var color := PrototypeMeshes.team_color(team)
	var body := PrototypeMeshes.capsule(body_radius, body_height, color)
	body.position = Vector3(0.0, body_height * 0.5, 0.0)
	_mesh_root.add_child(body)

	# Nose block so the facing direction is readable at a glance.
	var nose := PrototypeMeshes.box(Vector3(0.5, 0.5, 1.0), color.lightened(0.45))
	nose.position = Vector3(0.0, body_height * 0.62, -body_radius - 0.4)
	_mesh_root.add_child(nose)

	var crest := PrototypeMeshes.sphere(0.35, Color(1.0, 1.0, 1.0))
	crest.position = Vector3(0.0, body_height + 0.35, 0.0)
	_mesh_root.add_child(crest)

	# Ground ring, so the champion stays findable among same-coloured turrets.
	var ring := PrototypeMeshes.ring(body_radius * 2.1, 0.28, color.lightened(0.45))
	ring.name = "SelectionRing"
	ring.position.y = 0.2
	add_child(ring)


func _physics_process(delta: float) -> void:
	_tick_timers(delta)
	var desired := Vector3.ZERO
	if commands != null and not _recalling:
		desired = Vector3(commands.move_direction.x, 0.0, commands.move_direction.y)

	var target_velocity := desired * move_speed
	velocity.x = move_toward(velocity.x, target_velocity.x, acceleration * delta)
	velocity.z = move_toward(velocity.z, target_velocity.z, acceleration * delta)
	velocity.y = 0.0 if is_on_floor() else velocity.y - gravity * delta

	if _recalling and desired.length_squared() > 0.01:
		_cancel_recall()

	if desired.length_squared() > 0.001:
		_facing = desired.normalized()
	if _mesh_root != null:
		var target_yaw := atan2(_facing.x, _facing.z)
		_mesh_root.rotation.y = lerp_angle(_mesh_root.rotation.y, target_yaw, clampf(turn_speed * delta, 0.0, 1.0))

	move_and_slide()


func _tick_timers(delta: float) -> void:
	for i in _cooldowns.size():
		_cooldowns[i] = maxf(_cooldowns[i] - delta, 0.0)
	_attack_timer = maxf(_attack_timer - delta, 0.0)
	if _recalling:
		_recall_timer -= delta
		if _recall_timer <= 0.0:
			_finish_recall()


func cooldown_remaining(slot: int) -> float:
	return _cooldowns[slot] if slot >= 0 and slot < _cooldowns.size() else 0.0


func is_recalling() -> bool:
	return _recalling


func recall_progress() -> float:
	if not _recalling or recall_duration <= 0.0:
		return 0.0
	return clampf(1.0 - _recall_timer / recall_duration, 0.0, 1.0)


func ground_position() -> Vector2:
	return Vector2(global_position.x, global_position.z)


func _on_ability_requested(slot: int, aim_point: Vector3) -> void:
	if slot < 0 or slot >= _cooldowns.size():
		return
	if _cooldowns[slot] > 0.0:
		ability_blocked.emit(slot, _cooldowns[slot])
		return
	_cooldowns[slot] = ABILITY_COOLDOWNS[slot]
	_cancel_recall()
	var radius: float = ABILITY_RADII[slot]
	# R is a point-target placeholder, the rest are self-centred.
	var at := global_position
	if slot == InputCommands.AbilitySlot.R:
		var offset := aim_point - global_position
		offset.y = 0.0
		at = global_position + offset.limit_length(18.0)
	AbilityPulse.spawn(get_parent(), at, radius, ABILITY_COLORS[slot])
	_facing = _flat_direction_to(aim_point)
	ability_cast.emit(slot)


func _on_basic_attack_requested(aim_point: Vector3) -> void:
	if _attack_timer > 0.0:
		return
	_attack_timer = attack_cooldown
	_cancel_recall()
	_facing = _flat_direction_to(aim_point)
	var at := global_position + _facing * attack_range * 0.6
	AbilityPulse.spawn(get_parent(), at, attack_range * 0.35, Color(1.0, 1.0, 1.0), 0.2)
	basic_attack.emit(aim_point)


func _on_recall_requested() -> void:
	if _recalling:
		_cancel_recall()
		return
	_recalling = true
	_recall_timer = recall_duration
	recall_started.emit(recall_duration)


func _cancel_recall() -> void:
	if not _recalling:
		return
	_recalling = false
	_recall_timer = 0.0
	recall_interrupted.emit()


func _finish_recall() -> void:
	_recalling = false
	_recall_timer = 0.0
	velocity = Vector3.ZERO
	global_position = recall_target + Vector3.UP * 0.1
	AbilityPulse.spawn(get_parent(), global_position, 3.0, PrototypeMeshes.team_color(team), 0.5)
	recall_finished.emit()


func _flat_direction_to(point: Vector3) -> Vector3:
	var offset := point - global_position
	offset.y = 0.0
	return offset.normalized() if offset.length_squared() > 0.0001 else _facing
