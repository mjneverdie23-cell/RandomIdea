@tool
class_name BuffAbility
extends AbilityData

## Defensive placeholder: a timed self-buff applied through [StatsComponent],
## plus an optional instant heal. Nothing here touches the champion script, so
## the same resource works on a minion or a turret.

@export_range(0.0, 0.9, 0.01) var damage_reduction_add: float = 0.4
@export_range(0.1, 4.0, 0.05) var move_speed_multiplier: float = 1.25
@export_range(0.1, 4.0, 0.05) var attack_speed_multiplier: float = 1.0
@export_range(0.0, 2000.0, 1.0) var heal_amount: float = 0.0


func execute(caster: Node3D, _aim_point: Vector3) -> bool:
	var fields := {
		"damage_reduction": {"add": damage_reduction_add},
		"move_speed": {"mult": move_speed_multiplier},
		"attack_speed": {"mult": attack_speed_multiplier},
	}
	caster.stats.add_modifier(id, fields, maxf(duration, 0.1))
	if heal_amount > 0.0:
		caster.health.heal(heal_amount)
	AbilityPulse.spawn(caster.projectile_parent(), caster.global_position, maxf(radius, 2.0), color, 0.4)
	return true
