## Keyboard and mouse -> Intent, plus the player camera.
##
## The only file that reads input. It writes the same Intent a bot produces, so
## gameplay code stays input-agnostic (a gamepad or a network client would slot
## in right here).
##
## Bindings live in Project Settings -> Input Map, not in this script.
class_name PlayerController
extends Node

@export var mouse_sensitivity: float = 0.0022
@export var ads_sensitivity_multiplier: float = 0.6
@export var invert_y: bool = false
@export var pitch_limit: float = 1.52

var character: Character
var camera: Camera3D
var view_model: ViewModel
## Set false while a menu owns the mouse.
var input_enabled: bool = true

var _base_fov: float = 90.0
var _free_camera: bool = false
var _spectate_target: Character

func setup(p_character: Character) -> void:
	character = p_character
	camera = Camera3D.new()
	camera.name = "PlayerCamera"
	camera.fov = _base_fov
	camera.near = 0.05
	camera.far = 400.0
	camera.current = true
	character.head.add_child(camera)

	view_model = ViewModel.new()
	view_model.name = "ViewModel"
	camera.add_child(view_model)

	# First person: you never see your own body or name tag.
	character.visual.visible = false
	character.name_tag.visible = false

func _ready() -> void:
	set_process_unhandled_input(true)

func _unhandled_input(event: InputEvent) -> void:
	var motion := event as InputEventMouseMotion
	if motion != null and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and input_enabled:
		var weapon := character.inventory.active_weapon()
		var aiming: bool = character.intent.aim and weapon != null and weapon.data.ads_zoom > 1.0
		var sensitivity := mouse_sensitivity
		if aiming:
			sensitivity *= ads_sensitivity_multiplier / maxf(1.0, weapon.data.ads_zoom * 0.5)
		character.intent.yaw -= motion.relative.x * sensitivity
		var pitch_delta := motion.relative.y * sensitivity * (1.0 if invert_y else -1.0)
		character.intent.pitch = clampf(character.intent.pitch + pitch_delta, -pitch_limit, pitch_limit)

func _process(delta: float) -> void:
	if character == null or not is_instance_valid(character):
		return
	# reset_for_round() makes the visual visible again for everyone; the local
	# player's own body stays hidden.
	character.visual.visible = false
	character.name_tag.visible = false
	_poll_actions()
	_update_camera(delta)
	if view_model != null:
		if _free_camera:
			view_model.visible = false
		else:
			view_model.update(delta, character)

func _poll_actions() -> void:
	var intent := character.intent
	if not input_enabled or not character.health.alive:
		intent.move_forward = 0.0
		intent.move_right = 0.0
		intent.fire = false
		intent.jump = false
		intent.use = false
		intent.sprint = false
		return

	intent.move_forward = Input.get_action_strength("move_forward") - Input.get_action_strength("move_backward")
	intent.move_right = Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
	intent.jump = Input.is_action_pressed("jump")
	intent.crouch = Input.is_action_pressed("crouch")
	intent.sprint = Input.is_action_pressed("sprint")
	intent.use = Input.is_action_pressed("use")
	intent.fire = Input.is_action_pressed("fire")
	intent.aim = Input.is_action_pressed("aim")

	if Input.is_action_just_pressed("reload"):
		intent.reload = true
	if Input.is_action_just_pressed("throw_grenade"):
		intent.throw_grenade = true
	if Input.is_action_just_pressed("drop_bomb"):
		intent.drop = true
	if Input.is_action_just_pressed("ability_primary"):
		intent.use_ability = 0
	if Input.is_action_just_pressed("ability_secondary"):
		intent.use_ability = 1
	if Input.is_action_just_pressed("slot_primary"):
		intent.switch_to_slot = GameEnums.WeaponSlot.PRIMARY
	if Input.is_action_just_pressed("slot_secondary"):
		intent.switch_to_slot = GameEnums.WeaponSlot.SECONDARY
	if Input.is_action_just_pressed("slot_melee"):
		intent.switch_to_slot = GameEnums.WeaponSlot.MELEE
	if Input.is_action_just_pressed("toggle_freecam"):
		toggle_free_camera()

func _update_camera(delta: float) -> void:
	if camera == null:
		return

	if _free_camera:
		return

	if character.health.alive:
		if camera.top_level:
			camera.top_level = false
			camera.transform = Transform3D.IDENTITY
		camera.global_rotation = Vector3(character.pitch, character.yaw, 0.0)

		var weapon := character.inventory.active_weapon()
		var aiming: bool = character.intent.aim and weapon != null and weapon.data.ads_zoom > 1.0
		var target_fov := _base_fov
		if aiming:
			target_fov = _base_fov / weapon.data.ads_zoom
		elif character.intent.sprint and character.horizontal_speed() > 4.0:
			target_fov = _base_fov + 6.0
		camera.fov = lerpf(camera.fov, target_fov, minf(1.0, delta * 12.0))
		return

	# Dead: follow a living teammate, otherwise hover over the body.
	if _spectate_target == null or not is_instance_valid(_spectate_target) or not _spectate_target.health.alive:
		_spectate_target = null
		for mate in Game.session.characters:
			if mate.team_id == character.team_id and mate.health.alive:
				_spectate_target = mate
				break
	var focus: Character = _spectate_target if _spectate_target != null else character
	camera.top_level = true
	var behind := focus.global_position + Vector3(sin(focus.yaw) * 7.0, 3.5, cos(focus.yaw) * 7.0)
	camera.global_position = camera.global_position.lerp(behind, minf(1.0, delta * 4.0))
	camera.look_at(focus.global_position + Vector3(0, 1.2, 0))

## Overhead debug camera - useful for reading the map layout.
func toggle_free_camera() -> bool:
	_free_camera = not _free_camera
	camera.top_level = _free_camera
	if view_model != null:
		view_model.visible = not _free_camera
	# Distance fog would turn the whole map into haze from up there.
	var world_environment := get_tree().get_first_node_in_group("world_environment")
	if world_environment != null and world_environment.environment != null:
		world_environment.environment.fog_enabled = not _free_camera
	if _free_camera:
		var bounds: AABB = Game.session.compiled_map.bounds
		var span := maxf(bounds.size.x, bounds.size.z)
		camera.global_position = bounds.get_center() + Vector3(0, span * 1.15, 0.001)
		camera.look_at(bounds.get_center())
	return _free_camera

func set_input_enabled(enabled: bool) -> void:
	input_enabled = enabled
	if not enabled and character != null:
		character.intent.fire = false
		character.intent.move_forward = 0.0
		character.intent.move_right = 0.0
