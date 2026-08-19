class_name InputCommands
extends Node

## Device-independent command bus between an input source and gameplay.
##
## Gameplay code (champion, camera) only ever reads this node. A PC keyboard,
## a mobile virtual joystick or a replay/AI driver can all feed it, which is
## why nothing below mentions keys, buttons or touch.

enum AbilitySlot { Q, W, E, R }

const ABILITY_NAMES := ["Q", "W", "E", "R"]

signal ability_requested(slot: int, aim_point: Vector3)
signal basic_attack_requested(aim_point: Vector3)
signal recall_requested()
signal recall_cancelled()
signal debug_toggle_requested()
signal camera_lock_toggle_requested()
signal camera_zoom_requested(delta: float)

## Desired movement on the XZ plane in world space, length 0..1.
var move_direction: Vector2 = Vector2.ZERO
## Where the player is currently pointing, on the ground plane.
var aim_point: Vector3 = Vector3.ZERO


func set_move_direction(direction: Vector2) -> void:
	move_direction = direction if direction.length_squared() <= 1.0 else direction.normalized()


func set_aim_point(point: Vector3) -> void:
	aim_point = point


func request_ability(slot: int) -> void:
	ability_requested.emit(slot, aim_point)


func request_basic_attack() -> void:
	basic_attack_requested.emit(aim_point)


func request_recall() -> void:
	recall_requested.emit()


func cancel_recall() -> void:
	recall_cancelled.emit()


func request_debug_toggle() -> void:
	debug_toggle_requested.emit()


func request_camera_lock_toggle() -> void:
	camera_lock_toggle_requested.emit()


func request_camera_zoom(delta: float) -> void:
	camera_zoom_requested.emit(delta)


static func ability_name(slot: int) -> String:
	return ABILITY_NAMES[slot] if slot >= 0 and slot < ABILITY_NAMES.size() else "?"
