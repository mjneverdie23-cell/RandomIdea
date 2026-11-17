class_name ShakeCamera
extends Camera2D
## Screen shake driven by "trauma". add_trauma() raises it, it decays every frame, and the
## camera offset is random noise scaled by trauma squared, so small hits stay subtle.

@export var max_offset: float = 18.0
@export var decay_per_second: float = 1.6

var _trauma: float = 0.0


func add_trauma(amount: float) -> void:
	_trauma = minf(_trauma + amount, 1.0)


func _process(delta: float) -> void:
	if _trauma <= 0.0:
		return
	_trauma = maxf(_trauma - decay_per_second * delta, 0.0)
	var strength := _trauma * _trauma * max_offset
	offset = Vector2(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)) * strength
