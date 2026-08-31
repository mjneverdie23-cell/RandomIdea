## The sandbox an ability runs inside.
##
## Abilities never reach into systems directly; they get one of these, which
## exposes exactly the queries and effects an ability is allowed to use.
class_name AbilityContext
extends RefCounted

var character                 ## Character - the user
var time: float = 0.0         ## simulation time in seconds
var rng: RandomNumberGenerator
var world                     ## WorldQuery
var combat                    ## CombatSystem

func _init(p_character = null, p_world = null, p_combat = null, p_rng: RandomNumberGenerator = null, p_time: float = 0.0) -> void:
	character = p_character
	world = p_world
	combat = p_combat
	rng = p_rng
	time = p_time

## Living characters within `radius` of `origin`.
## `filter` accepts: {"enemy_of": Character, "team": int, "alive_only": bool}
func characters_within(origin: Vector3, radius: float, filter: Dictionary = {}) -> Array:
	return world.characters_within(origin, radius, filter)

func has_line_of_sight(from_character, to_character) -> bool:
	return world.has_line_of_sight(from_character, to_character)

func apply_damage(target, amount: float, source: StringName = &"ability") -> float:
	return combat.apply_damage(target, character, amount, source)
