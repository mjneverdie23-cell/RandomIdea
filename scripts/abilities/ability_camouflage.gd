## Assassin: blend into the environment. Firing breaks it.
class_name AbilityCamouflage
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	var effect := StatusEffect.new(&"camouflage", duration, {"invisible": true, "speed": 0.9})
	effect.break_on_fire = true
	effect.visual = &"camo"
	ctx.character.effects.add(effect)
