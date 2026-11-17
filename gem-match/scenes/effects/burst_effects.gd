class_name BurstEffects
extends Node2D
## A pool of one-shot particle bursts, reused round-robin, so nothing is created or freed
## during play. The first child (a GPUParticles2D) is the template that gets copied.

@export var pool_size: int = 24

var _emitters: Array[GPUParticles2D] = []
var _next: int = 0


func _ready() -> void:
	var template := get_child(0) as GPUParticles2D
	_emitters.append(template)
	for _i in pool_size - 1:
		var copy := template.duplicate() as GPUParticles2D
		add_child(copy)
		_emitters.append(copy)


## Fires a burst of `color` particles at a global position.
func burst(at: Vector2, color: Color) -> void:
	var emitter := _emitters[_next]
	_next = (_next + 1) % _emitters.size()
	emitter.global_position = at
	emitter.modulate = color
	emitter.restart()
