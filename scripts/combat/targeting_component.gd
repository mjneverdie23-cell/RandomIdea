class_name TargetingComponent
extends Node

## Holds and validates a unit's current target, and re-acquires one when it is
## missing. Kept independent of any UI: it only exposes the target and signals.

signal target_changed(target: Node3D)

var unit: Node3D
## Kinds earlier in this list are always preferred, e.g. minions before
## champions for turrets.
var kind_priority: Array = []
var auto_acquire: bool = true
@export_range(0.05, 2.0, 0.05) var acquire_interval: float = 0.25

var current_target: Node3D = null

var _timer: float = 0.0


func setup(owner_unit: Node3D, priority: Array = []) -> void:
	unit = owner_unit
	kind_priority = priority


func set_target(target: Node3D) -> void:
	if target == current_target:
		return
	_release_current()
	current_target = target
	# Following the node out of the tree is what keeps every other system from
	# ever seeing a freed target.
	if target != null and is_instance_valid(target):
		target.tree_exiting.connect(_on_target_exiting)
	target_changed.emit(target)


func clear_target() -> void:
	if current_target == null:
		return
	_release_current()
	current_target = null
	target_changed.emit(null)


func _release_current() -> void:
	if current_target != null and is_instance_valid(current_target) \
			and current_target.tree_exiting.is_connected(_on_target_exiting):
		current_target.tree_exiting.disconnect(_on_target_exiting)


func _on_target_exiting() -> void:
	current_target = null
	target_changed.emit(null)


func has_target() -> bool:
	return is_target_valid(INF)


func is_target_valid(max_range: float = INF) -> bool:
	if current_target == null or not is_instance_valid(current_target):
		return false
	if not current_target.is_alive():
		return false
	if current_target.team == unit.team:
		return false
	return distance_to_target() <= max_range


func distance_to_target() -> float:
	if current_target == null or not is_instance_valid(current_target):
		return INF
	return unit.global_position.distance_to(current_target.global_position) - current_target.select_radius()


## Called every physics frame by the owning unit. Drops dead or invalid
## targets and, when [member auto_acquire] is on, picks a new one in range.
func tick(delta: float, acquire_range: float) -> void:
	if current_target != null and not is_target_valid(INF):
		clear_target()
	_timer -= delta
	if _timer > 0.0:
		return
	_timer = acquire_interval
	if not auto_acquire or current_target != null or unit == null or not unit.is_alive():
		return
	var found := acquire(acquire_range)
	if found != null:
		set_target(found)


func acquire(max_range: float) -> Node3D:
	return Battle.find_target(unit.global_position, unit.team, max_range, kind_priority)
