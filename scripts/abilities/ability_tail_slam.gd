## Tank: ground slam that damages and slows every enemy nearby.
class_name AbilityTailSlam
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	var origin: Vector3 = ctx.character.global_position
	for enemy in ctx.characters_within(origin, radius, {"enemy_of": ctx.character}):
		var falloff: float = 1.0 - origin.distance_to(enemy.global_position) / maxf(0.01, radius)
		ctx.apply_damage(enemy, damage * maxf(0.25, falloff), &"ability_tail_slam")
		enemy.effects.add(StatusEffect.new(&"slammed", 2.0, {"speed": 0.6}))
