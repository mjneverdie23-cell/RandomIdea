class_name PCInputController
extends Node

## PC input source: keyboard + mouse driving an [InputCommands] bus.
##
## Swap this node for a touch controller and every gameplay system keeps
## working, because none of them read [Input] directly.
##
## WASD          movement (camera relative)
## Mouse         aim / camera interaction
## Left click    select an enemy and basic attack
## Q E R F       placeholder abilities
## Ctrl + Q/E/R/F  spend a skill point on that ability
## B             recall
## C (held)      show my own attack range while it is down
## Shift + Q/E/R/F (held)  aim the ability, cast it on release
## Tab (held)     scoreboard
## P             open/close the shop (buying still needs the base zone)
## O             settings
## Space         toggle camera lock
## Mouse wheel   zoom
## Enter         restart the match
## F9            toggle the map debug view
##
## Abilities deliberately avoid W, A, S and D so no key ever means both "move"
## and "cast". Development-only keys live in [DevInputController].

const ABILITY_ACTIONS := {
	InputCommands.AbilitySlot.Q: "ability_q",
	InputCommands.AbilitySlot.E: "ability_e",
	InputCommands.AbilitySlot.R: "ability_r",
	InputCommands.AbilitySlot.F: "ability_f",
}

## Ctrl + the same key spends a skill point on that slot — the binding every
## MOBA player already has in their hands. Matched exactly, and checked before
## the cast, so Ctrl+Q upgrades without also casting and plain Q never upgrades.
const UPGRADE_ACTIONS := {
	InputCommands.AbilitySlot.Q: "upgrade_q",
	InputCommands.AbilitySlot.E: "upgrade_e",
	InputCommands.AbilitySlot.R: "upgrade_r",
	InputCommands.AbilitySlot.F: "upgrade_f",
}

## Movement is expressed relative to this camera's yaw so "W" always means
## "away from the viewer" on an angled camera.
@export var camera_path: NodePath
@export var commands_path: NodePath

var _camera: Camera3D
var _commands: InputCommands
## Ground plane the mouse is projected onto to produce an aim point.
var _ground := Plane(Vector3.UP, 0.0)
## Ability slot the player is currently aiming with the modifier held, or -1.
var _aiming: int = -1


func _ready() -> void:
	if not camera_path.is_empty():
		_camera = get_node_or_null(camera_path) as Camera3D
	if not commands_path.is_empty():
		_commands = get_node_or_null(commands_path) as InputCommands


func setup(commands: InputCommands, camera: Camera3D) -> void:
	_commands = commands
	_camera = camera


func _unhandled_input(event: InputEvent) -> void:
	if _commands == null:
		return
	if event.is_action_pressed("basic_attack"):
		_commands.request_basic_attack()
	elif event.is_action_pressed("recall"):
		_commands.request_recall()
	elif event.is_action_pressed("toggle_debug"):
		_commands.request_debug_toggle()
	elif event.is_action_pressed("camera_lock"):
		_commands.request_camera_lock_toggle()
	elif event.is_action_pressed("camera_zoom_in"):
		_commands.request_camera_zoom(-1.0)
	elif event.is_action_pressed("camera_zoom_out"):
		_commands.request_camera_zoom(1.0)
	elif event.is_action_pressed("toggle_shop"):
		_commands.request_shop_toggle()
	elif event.is_action_pressed("open_settings"):
		_commands.request_settings_toggle()
	elif event.is_action_pressed("restart_match"):
		_commands.request_restart()
	elif Input.is_action_pressed("aim_ability"):
		pass  # Shift + an ability key aims it; the cast is handled on release.
	else:
		for slot in UPGRADE_ACTIONS:
			if event.is_action_pressed(UPGRADE_ACTIONS[slot], false, true):
				_commands.request_ability_upgrade(slot)
				return
		for slot in ABILITY_ACTIONS:
			if event.is_action_pressed(ABILITY_ACTIONS[slot]):
				_commands.request_ability(slot)
				break


func _process(_delta: float) -> void:
	if _commands == null:
		return
	_commands.set_move_direction(_camera_relative_move())
	_commands.set_aim_point(_mouse_ground_point())
	# Polled rather than driven by press/release events: a key-up swallowed by
	# a panel or lost to a window focus change would otherwise strand the ring
	# on screen. Reading the held state every frame is self-correcting.
	_commands.set_range_display(Input.is_action_pressed("show_range"))
	_commands.set_scoreboard(Input.is_action_pressed("show_scoreboard"))
	_update_ability_aim()


## Holding the aim modifier with an ability key down shows that ability's range
## and where it would go; letting the ability key go casts it. Polled for the
## same reason the range ring is: a swallowed key-up must not leave the player
## stuck in an aim they cannot cancel.
func _update_ability_aim() -> void:
	var wanted := -1
	if Input.is_action_pressed("aim_ability"):
		for slot in ABILITY_ACTIONS:
			if Input.is_action_pressed(ABILITY_ACTIONS[slot]):
				wanted = slot
				break
	if wanted == _aiming:
		return
	var released := _aiming
	_aiming = wanted
	_commands.set_ability_aim(wanted)
	# Letting go of the ability key commits the cast; letting go of the
	# modifier first cancels it, which is the escape hatch.
	if released >= 0 and wanted < 0 and Input.is_action_pressed("aim_ability"):
		_commands.request_ability(released)


func _camera_relative_move() -> Vector2:
	var raw := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if raw.length_squared() <= 0.0001:
		return Vector2.ZERO
	var yaw := _camera.global_rotation.y if _camera != null else 0.0
	return raw.rotated(-yaw)


## Projects the mouse onto the ground plane; falls back to the champion's own
## position when the ray is parallel to the ground.
func _mouse_ground_point() -> Vector3:
	if _camera == null:
		return _commands.aim_point
	var viewport := get_viewport()
	if viewport == null:
		return _commands.aim_point
	var mouse := viewport.get_mouse_position()
	var from := _camera.project_ray_origin(mouse)
	var direction := _camera.project_ray_normal(mouse)
	var hit = _ground.intersects_ray(from, direction)
	return hit if hit != null else _commands.aim_point
