## The visual half of a character.
##
## Owns whatever CharacterModels produced and mirrors simulation state onto it.
## It reads the character; it never writes to it - all state lives in the
## simulation, which is what keeps the renderer replaceable.
class_name CharacterVisual
extends Node3D

var model: Node3D
var _was_alive: bool = true

func apply_class(class_data: CharacterClassData, team_color: Color) -> void:
	if model != null:
		model.queue_free()
	model = CharacterModels.create(class_data, team_color)
	add_child(model)

func set_team_color(color: Color) -> void:
	if model != null and model.has_method("set_team_color"):
		model.set_team_color(color)

## Called every frame by Character with its current state.
func sync(character) -> void:
	if model == null:
		return
	if model.has_method("set_pose"):
		model.set_pose({
			"yaw": character.yaw,
			"pitch": character.pitch,
			"speed": Vector2(character.velocity.x, character.velocity.z).length(),
			"crouching": character.is_crouching,
			"airborne": not character.is_on_floor(),
			"aiming": character.intent.aim,
		})
	var alive: bool = character.health.alive
	if alive != _was_alive:
		if model.has_method("play_animation"):
			model.play_animation(&"death" if not alive else &"idle")
		_was_alive = alive
	if model.has_method("set_opacity"):
		model.set_opacity(0.08 if character.effects.is_invisible() else 1.0)
