## Ranger: heal yourself and nearby allies.
class_name AbilityFieldDressing
extends AbilityData

func activate(ctx: AbilityContext) -> void:
	ctx.character.health.heal(heal_amount)
	var allies: Array = ctx.characters_within(ctx.character.global_position, radius, {
		"team": ctx.character.team_id,
	})
	for ally in allies:
		if ally != ctx.character:
			ally.health.heal(heal_amount * 0.55)
