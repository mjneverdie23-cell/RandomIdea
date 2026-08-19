class_name PCInputController
extends Node

## PC input source: keyboard + mouse driving an [InputCommands] bus.
##
## Swap this node for a touch controller and every gameplay system keeps
## working, because none of them read [Input] directly.
##
## WASD          movement (camera relative)
## Mouse         aim / camera interaction
## Left click    basic attack
## Q W E R       placeholder abilities
## B             recall
## Space         toggle camera lock
## Mouse wheel   zoom
## F1            toggle debug view
##
## Note: W is deliberately bound to both "move forward" and "ability W" because
## the design brief asks for WASD movement and Q/W/E/R abilities on the same
## keyboard. F is provided as a movement-free alias for ability W.

const ABILITY_ACTIONS := {
	InputCommands.AbilitySlot.Q: "ability_q",
	InputCommands.AbilitySlot.W: "ability_w",
	InputCommands.AbilitySlot.E: "ability_e",
	InputCommands.AbilitySlot.R: "ability_r",
}

## Movement is expressed relative to this camera's yaw so "W" always means
## "away from the viewer" on an angled camera.
@export var camera_path: NodePath
@export var commands_path: NodePath

var _camera: Camera3D
var _commands: InputCommands
## Ground plane the mouse is projected onto to produce an aim point.
var _ground := Plane(Vector3.UP, 0.0)


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
	else:
		for slot in ABILITY_ACTIONS:
			if event.is_action_pressed(ABILITY_ACTIONS[slot]):
				_commands.request_ability(slot)
				break


func _process(_delta: float) -> void:
	if _commands == null:
		return
	_commands.set_move_direction(_camera_relative_move())
	_commands.set_aim_point(_mouse_ground_point())


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
