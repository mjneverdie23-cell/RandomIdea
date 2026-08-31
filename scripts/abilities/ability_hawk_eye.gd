## Sniper: steady the shot and reveal enemies in line of sight.
class_name AbilityHawkEye
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	ctx.character.effects.add(StatusEffect.new(&"hawk_eye", duration, {
		"spread": 0.35, "speed": 0.85,
	}))
	for enemy in ctx.characters_within(ctx.character.global_position, radius, {"enemy_of": ctx.character}):
		if ctx.has_line_of_sight(ctx.character, enemy):
			enemy.reveal_until(ctx.time + duration)
