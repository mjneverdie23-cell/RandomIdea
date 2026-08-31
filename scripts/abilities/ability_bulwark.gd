## Tank: brace behind armoured plates - heavy damage reduction, slower movement.
class_name AbilityBulwark
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	ctx.character.effects.add(StatusEffect.new(&"bulwark", duration, {
		"damage_taken": 0.5, "speed": 0.75,
	}))
