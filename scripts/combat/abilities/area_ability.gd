@tool
class_name AreaAbility
extends AbilityData

## Ultimate placeholder: instant damage to every enemy inside a circle centred
## on the aim point.

@export_range(0.0, 5.0, 0.05) var effect_duration: float = 0.45


func execute(caster: Node3D, aim_point: Vector3) -> bool:
	var center := clamp_aim(caster, aim_point)
	for unit in Battle.enemies_in_radius(center, caster.team, radius):
		unit.apply_damage(damage, caster)
	AbilityPulse.spawn(caster.projectile_parent(), center, maxf(radius, 1.0), color, effect_duration)
	return true
