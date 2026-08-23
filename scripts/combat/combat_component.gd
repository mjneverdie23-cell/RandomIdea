class_name CombatComponent
extends Node

## The basic-attack pipeline:
## request -> cooldown check -> target validation -> damage -> health update.
##
## Instant hits and travelling projectiles are the same code path; a unit picks
## between them by setting [member UnitStats.projectile_speed].

signal attack_started(target: Node3D, damage: float)
signal attack_hit(target: Node3D, damage: float)
signal attack_rejected(reason: String)

var unit: Node3D
var stats: StatsComponent
## Where projectiles are parented, so they outlive the shooter's death.
var projectile_parent: Node3D

var cooldown_left: float = 0.0


func setup(owner_unit: Node3D, stats_component: StatsComponent, shot_parent: Node3D = null) -> void:
	unit = owner_unit
	stats = stats_component
	projectile_parent = shot_parent if shot_parent != null else owner_unit.get_parent()


func tick(delta: float) -> void:
	cooldown_left = maxf(cooldown_left - delta, 0.0)


func is_ready() -> bool:
	return cooldown_left <= 0.0


func cooldown_ratio() -> float:
	var interval := stats.attack_interval()
	return 0.0 if interval <= 0.0 else clampf(cooldown_left / interval, 0.0, 1.0)


func attack_range() -> float:
	return stats.value("attack_range")


func in_range(target: Node3D) -> bool:
	if target == null or not is_instance_valid(target):
		return false
	var gap: float = unit.global_position.distance_to(target.global_position) - target.select_radius()
	return gap <= attack_range()


func can_attack(target: Node3D) -> bool:
	if not unit.is_alive():
		return false
	if target == null or not is_instance_valid(target) or not target.is_alive():
		return false
	if target.team == unit.team:
		return false
	return is_ready() and in_range(target)


## Returns true when the attack actually went out.
func try_attack(target: Node3D) -> bool:
	if not unit.is_alive():
		attack_rejected.emit("dead")
		return false
	if target == null or not is_instance_valid(target) or not target.is_alive():
		attack_rejected.emit("no_target")
		return false
	if target.team == unit.team:
		attack_rejected.emit("friendly")
		return false
	if not is_ready():
		attack_rejected.emit("cooldown")
		return false
	if not in_range(target):
		attack_rejected.emit("out_of_range")
		return false

	cooldown_left = stats.attack_interval()
	var damage := stats.value("attack_damage")
	attack_started.emit(target, damage)

	var projectile_speed := stats.value("projectile_speed")
	if projectile_speed > 0.0:
		Projectile.launch(
			projectile_parent, unit.get_muzzle_position(), target, target.get_aim_position(),
			projectile_speed, damage, unit,
			PrototypeMeshes.team_color(unit.team).lightened(0.3), _projectile_size()
		)
	else:
		target.apply_damage(damage, unit)
		_spawn_tracer(target)
	attack_hit.emit(target, damage)
	return true


func _projectile_size() -> float:
	var size := stats.value("projectile_size")
	return size if size > 0.0 else 0.3


## Cheap instant-hit feedback: a short-lived line from muzzle to target.
func _spawn_tracer(target: Node3D) -> void:
	if projectile_parent == null or not is_instance_valid(projectile_parent):
		return
	var from: Vector3 = unit.get_muzzle_position()
	var to: Vector3 = target.get_aim_position()
	var tracer := PrototypeMeshes.polyline(
		PackedVector2Array([Vector2(from.x, from.z), Vector2(to.x, to.z)]),
		PrototypeMeshes.team_color(unit.team).lightened(0.5), 0.0
	)
	tracer.position.y = (from.y + to.y) * 0.5
	projectile_parent.add_child(tracer)
	var tween := tracer.create_tween()
	tween.tween_property(tracer, "transparency", 1.0, 0.12)
	tween.tween_callback(tracer.queue_free)
