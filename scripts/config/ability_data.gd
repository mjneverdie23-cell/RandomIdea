## Base class for class abilities.
##
## An ability is data plus two hooks. It receives an AbilityContext, which is the
## only surface it is allowed to touch - it can query the world, deal damage and
## apply effects, and nothing else.
##
## TO ADD AN ABILITY: extend this script, override `activate()`, save a .tres in
## `data/abilities/`, then list its id in a class's `abilities` array.
class_name AbilityData
extends Resource

@export var id: StringName = &""
@export var display_name: String = "Ability"
@export_multiline var description: String = ""
## Seconds before it can be used again.
@export var cooldown: float = 20.0
## Seconds the ability stays active (0 = instant).
@export var duration: float = 0.0
## Uses per round. -1 means unlimited.
@export var charges_per_round: int = -1

@export_group("Common tuning (used by the subclasses that need it)")
@export var radius: float = 0.0
@export var damage: float = 0.0
@export var heal_amount: float = 0.0
@export var strength: float = 1.0

## Called when the player triggers the ability.
func activate(_ctx: AbilityContext) -> void:
	pass

## Called when `duration` elapses.
func on_end(_ctx: AbilityContext) -> void:
	pass
