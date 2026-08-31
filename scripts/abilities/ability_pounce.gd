## Assassin: explosive leap in the direction the character is looking.
class_name AbilityPounce
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	var forward := Vector3(-sin(ctx.character.yaw), 0.0, -cos(ctx.character.yaw))
	ctx.character.velocity += forward * strength
	ctx.character.velocity.y = 5.5
	ctx.character.effects.add(StatusEffect.new(&"pounce", 0.6, {}))
