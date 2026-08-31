## Bruiser: barrel forwards, trampling anything in the way.
class_name AbilityCharge
extends AbilityData

const TRAMPLE_RADIUS := 2.4

func activate(ctx: AbilityContext) -> void:
	var effect := StatusEffect.new(&"charge", duration, {
		"speed": strength, "damage_taken": 0.85,
	})
	effect.visual = &"charge"
	# Per-tick hook: trample whoever the charger runs through.
	effect.tick_callback = func(character, delta: float, tick_ctx: AbilityContext) -> void:
		for enemy in tick_ctx.characters_within(character.global_position, TRAMPLE_RADIUS, {"enemy_of": character}):
			tick_ctx.combat.apply_damage(enemy, character, damage * delta, &"ability_charge")
	ctx.character.effects.add(effect)
