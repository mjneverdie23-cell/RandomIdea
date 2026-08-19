@tool
class_name ProjectileAbility
extends AbilityData

## Ranged placeholder: homes on the caster's selected enemy when one is in
## range, otherwise flies to the aim point and detonates.

@export_range(1.0, 200.0, 1.0) var projectile_speed: float = 45.0
@export_range(0.0, 20.0, 0.5) var impact_radius: float = 2.5
@export_range(0.1, 2.0, 0.05) var projectile_size: float = 0.5


func execute(caster: Node3D, aim_point: Vector3) -> bool:
	var goal := clamp_aim(caster, aim_point)
	var target: Node3D = null
	if caster.targeting != null and caster.targeting.is_target_valid(cast_range):
		target = caster.targeting.current_target
	Projectile.launch(
		caster.projectile_parent(), caster.get_muzzle_position(), target, goal,
		projectile_speed, damage, caster, color, projectile_size, impact_radius
	)
	return true
