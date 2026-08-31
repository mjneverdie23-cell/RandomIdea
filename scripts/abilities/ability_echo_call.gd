## Ranger: sonic pulse revealing every enemy in a wide radius.
class_name AbilityEchoCall
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	for enemy in ctx.characters_within(ctx.character.global_position, radius, {"enemy_of": ctx.character}):
		enemy.reveal_until(ctx.time + duration)
