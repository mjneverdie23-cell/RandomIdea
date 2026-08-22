@tool
class_name AbilityData
extends Resource

## Base class for a placeholder ability. One .tres per ability keeps every
## number out of the behaviour scripts.
##
## Subclasses implement [method execute]; [AbilityComponent] only knows about
## this interface, so adding a new ability kind means adding a resource script,
## not editing the champion.

@export var id: String = "ability"
@export var display_name: String = "Ability"
## 0..3, matching [enum InputCommands.AbilitySlot] (Q, E, R, F).
@export_range(0, 3, 1) var slot: int = 0
@export_range(0.0, 120.0, 0.1) var cooldown: float = 5.0
## Ability resource this cast spends. Zero makes the ability free, which is
## what every unit without a resource pool sees.
@export_range(0.0, 1000.0, 1.0) var resource_cost: float = 0.0
## 0 means self-cast; anything higher clamps the aim point to this distance.
@export_range(0.0, 80.0, 0.5) var cast_range: float = 0.0
@export_range(0.0, 2000.0, 1.0) var damage: float = 0.0
@export_range(0.0, 40.0, 0.5) var radius: float = 0.0
@export_range(0.0, 60.0, 0.1) var duration: float = 0.0
@export var color: Color = Color(0.4, 0.8, 1.0)


## Extra gate on top of the cooldown. Overridden by abilities that need a
## target or a direction.
func can_cast(caster: Node3D, _aim_point: Vector3) -> bool:
	return caster != null and caster.is_alive()


## Performs the ability. Returning false leaves the cooldown untouched.
func execute(_caster: Node3D, _aim_point: Vector3) -> bool:
	push_warning("AbilityData.execute() not implemented for '%s'." % id)
	return false


## Damage for one cast: the resource value, scaled by rank, plus the caster's
## ability power. Every ability kind uses this instead of [member damage] so
## items and skill points reach all of them.
func effective_damage(caster: Node3D) -> float:
	if damage <= 0.0 or caster == null:
		return damage
	var scale: float = 1.0
	if caster.abilities != null:
		scale = caster.abilities.damage_scale(slot)
	var power: float = caster.stats.value("ability_power") if caster.stats != null else 0.0
	return damage * scale + power


## Aim point pulled back onto the ability's maximum range.
func clamp_aim(caster: Node3D, aim_point: Vector3) -> Vector3:
	var origin := caster.global_position
	var offset := aim_point - origin
	offset.y = 0.0
	if cast_range > 0.0:
		offset = offset.limit_length(cast_range)
	if offset.length_squared() < 0.0001:
		offset = caster.facing_direction() * maxf(cast_range, 1.0)
	return origin + offset


func describe() -> String:
	return "%s (%.0fs)" % [display_name, cooldown]
