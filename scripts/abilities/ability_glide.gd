## Sniper: catch the air - reduced gravity and a small boost upwards.
class_name AbilityGlide
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	ctx.character.effects.add(StatusEffect.new(&"glide", duration, {
		"gravity": 0.35, "speed": 1.1,
	}))
	# A nudge upwards so the glide is useful even from flat ground.
	ctx.character.velocity.y = maxf(ctx.character.velocity.y, 4.5)
