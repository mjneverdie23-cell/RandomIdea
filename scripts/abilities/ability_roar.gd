## Bruiser: allies nearby hit harder, enemies nearby are slowed.
class_name AbilityRoar
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	for ally in ctx.characters_within(ctx.character.global_position, radius, {"team": ctx.character.team_id}):
		ally.effects.add(StatusEffect.new(&"roar_buff", duration, {"damage_dealt": 1.2}))
	for enemy in ctx.characters_within(ctx.character.global_position, radius, {"enemy_of": ctx.character}):
		enemy.effects.add(StatusEffect.new(&"roar_fear", 3.0, {"speed": 0.8}))
