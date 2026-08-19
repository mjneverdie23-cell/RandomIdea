class_name TargetIndicator
extends Node3D

## Ground ring that follows whatever the player currently has selected.
##
## This is gameplay feedback rather than debug output, so it stays visible with
## the debug overlays turned off. It is deliberately a ring built from the
## prototype mesh factory, replaceable with a real decal later.

var _ring: MeshInstance3D
var _target: Node3D


func _ready() -> void:
	_ring = PrototypeMeshes.ring(1.0, 0.16, Color(1.0, 0.85, 0.25))
	add_child(_ring)
	visible = false


func follow(target: Node3D) -> void:
	_target = target
	visible = target != null and is_instance_valid(target)
	if visible:
		var radius: float = maxf(target.select_radius() * 1.7, 0.8)
		_ring.scale = Vector3(radius, 1.0, radius)


func _process(_delta: float) -> void:
	if _target == null or not is_instance_valid(_target) or not _target.is_alive():
		visible = false
		_target = null
		return
	global_position = _target.global_position + Vector3.UP * 0.25
