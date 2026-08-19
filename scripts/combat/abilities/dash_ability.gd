@tool
class_name DashAbility
extends AbilityData

## Mobility placeholder: a short burst of forced movement towards the aim
## point. Collision still applies, so a dash cannot cross terrain walls.

@export_range(5.0, 120.0, 1.0) var dash_speed: float = 34.0


func can_cast(caster: Node3D, aim_point: Vector3) -> bool:
	return super.can_cast(caster, aim_point) and caster.movement != null


func execute(caster: Node3D, aim_point: Vector3) -> bool:
	var goal := clamp_aim(caster, aim_point)
	var direction := goal - caster.global_position
	direction.y = 0.0
	if direction.length_squared() < 0.0001:
		direction = caster.facing_direction()
	var travel: float = minf(direction.length(), maxf(cast_range, 1.0))
	caster.movement.start_dash(direction, dash_speed, travel / dash_speed)
	AbilityPulse.spawn(caster.projectile_parent(), caster.global_position, maxf(radius, 1.5), color, 0.25)
	return true
