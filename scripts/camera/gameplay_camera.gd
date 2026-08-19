class_name GameplayCamera
extends Camera3D

## Elevated, MOBA-style gameplay camera.
##
## It knows nothing about the map or the champion beyond "a node to follow" and
## "a rectangle to stay inside", both handed to it from outside, so it can be
## reused unchanged on a different map or attached to a different unit.

signal lock_changed(is_locked: bool)

@export_range(10.0, 200.0, 1.0) var distance: float = 36.0
@export_range(10.0, 200.0, 1.0) var min_distance: float = 22.0
@export_range(10.0, 300.0, 1.0) var max_distance: float = 85.0
@export_range(1.0, 40.0, 0.5) var zoom_step: float = 6.0
## Degrees. -90 looks straight down; around -52 reads as isometric.
@export_range(-89.0, -10.0, 0.5) var pitch_degrees: float = -52.0
## Degrees. 0 keeps the square play field axis-aligned on screen, which makes
## the diagonal mid lane and river read the way a MOBA minimap does.
@export_range(-180.0, 180.0, 1.0) var yaw_degrees: float = 0.0
@export_range(0.5, 20.0, 0.1) var follow_smoothing: float = 6.0
@export_range(0.5, 20.0, 0.1) var zoom_smoothing: float = 8.0
@export_range(0.0, 120.0, 1.0) var pan_speed: float = 55.0
## Fraction of the viewport that acts as an edge-pan hot zone when unlocked.
@export_range(0.0, 0.25, 0.005) var edge_pan_margin: float = 0.03
@export var locked_to_target: bool = true

var follow_target: Node3D

var _focus := Vector3.ZERO
var _target_distance: float = 36.0
## Playable rectangle on the XZ plane the focus point may never leave.
var _bounds := Rect2(-1000.0, -1000.0, 2000.0, 2000.0)


func _ready() -> void:
	_target_distance = distance
	rotation_degrees = Vector3(pitch_degrees, yaw_degrees, 0.0)
	if follow_target != null:
		_focus = follow_target.global_position
	_apply_transform()


## The camera may not look outside this rectangle (map XZ bounds).
func set_bounds(bounds: Rect2, margin: float = 0.0) -> void:
	_bounds = bounds.grow(-margin) if margin != 0.0 else bounds


func bind_commands(commands: InputCommands) -> void:
	commands.camera_zoom_requested.connect(_on_zoom_requested)
	commands.camera_lock_toggle_requested.connect(toggle_lock)


func set_follow_target(target: Node3D) -> void:
	follow_target = target
	if target != null:
		_focus = _clamp_focus(target.global_position)
		_apply_transform()


func toggle_lock() -> void:
	locked_to_target = not locked_to_target
	lock_changed.emit(locked_to_target)


func is_locked() -> bool:
	return locked_to_target


func focus_point() -> Vector3:
	return _focus


## Sets the zoom distance without waiting for the smoothing to catch up.
func set_distance(value: float) -> void:
	distance = clampf(value, min_distance, max_distance)
	_target_distance = distance
	_apply_transform()


## Snaps the camera to a point immediately, bypassing the follow smoothing.
func set_focus(point: Vector3) -> void:
	_focus = _clamp_focus(point)
	_apply_transform()


func _on_zoom_requested(delta: float) -> void:
	_target_distance = clampf(_target_distance + delta * zoom_step, min_distance, max_distance)


func _process(delta: float) -> void:
	var desired := _focus
	if locked_to_target and follow_target != null and is_instance_valid(follow_target):
		desired = follow_target.global_position
	elif pan_speed > 0.0:
		desired += _edge_pan_offset() * pan_speed * delta

	var weight := clampf(follow_smoothing * delta, 0.0, 1.0)
	_focus = _clamp_focus(_focus.lerp(desired, weight))
	distance = lerpf(distance, _target_distance, clampf(zoom_smoothing * delta, 0.0, 1.0))
	_apply_transform()


func _clamp_focus(point: Vector3) -> Vector3:
	return Vector3(
		clampf(point.x, _bounds.position.x, _bounds.end.x),
		0.0,
		clampf(point.z, _bounds.position.y, _bounds.end.y)
	)


## Screen-edge panning, expressed in world XZ and aligned with the camera yaw.
func _edge_pan_offset() -> Vector3:
	var viewport := get_viewport()
	if viewport == null or edge_pan_margin <= 0.0:
		return Vector3.ZERO
	var size := Vector2(viewport.get_visible_rect().size)
	if size.x <= 0.0 or size.y <= 0.0:
		return Vector3.ZERO
	var mouse := viewport.get_mouse_position()
	var normalized := Vector2(mouse.x / size.x, mouse.y / size.y)
	var push := Vector2.ZERO
	if normalized.x <= edge_pan_margin:
		push.x = -1.0
	elif normalized.x >= 1.0 - edge_pan_margin:
		push.x = 1.0
	if normalized.y <= edge_pan_margin:
		push.y = -1.0
	elif normalized.y >= 1.0 - edge_pan_margin:
		push.y = 1.0
	if push == Vector2.ZERO:
		return Vector3.ZERO
	var rotated := push.normalized().rotated(-deg_to_rad(yaw_degrees))
	return Vector3(rotated.x, 0.0, rotated.y)


func _apply_transform() -> void:
	var basis_rotation := Basis.from_euler(Vector3(deg_to_rad(pitch_degrees), deg_to_rad(yaw_degrees), 0.0))
	# A camera looks down its local -Z, so pull back along +Z to frame the focus.
	global_position = _focus + basis_rotation.z * distance
	global_rotation = Vector3(deg_to_rad(pitch_degrees), deg_to_rad(yaw_degrees), 0.0)
