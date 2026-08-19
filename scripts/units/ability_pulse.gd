class_name AbilityPulse
extends Node3D

## Throwaway placeholder effect for abilities and attacks: a flat ring that
## expands and fades, then frees itself.
##
## Gameplay never depends on it — it is spawned and forgotten, so replacing it
## with real VFX is a one-line change at the call site.

static func spawn(parent: Node3D, at: Vector3, radius: float, color: Color, duration: float = 0.35) -> AbilityPulse:
	var pulse := AbilityPulse.new()
	pulse.position = at
	parent.add_child(pulse)
	pulse._play(radius, color, duration)
	return pulse


func _play(radius: float, color: Color, duration: float) -> void:
	var ring := PrototypeMeshes.ring(radius, maxf(radius * 0.18, 0.15), color)
	ring.position.y = 0.35
	add_child(ring)
	scale = Vector3(0.2, 1.0, 0.2)
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(self, "scale", Vector3(1.0, 1.0, 1.0), duration)
	tween.tween_property(ring, "transparency", 1.0, duration)
	tween.chain().tween_callback(queue_free)
