class_name Projectile
extends Node3D

## Simple travelling shot. Homes on a unit while it is alive, otherwise flies
## to the last known point and fizzles. Purely a stand-in: nothing depends on
## it existing, and an instant-hit attack skips it entirely.

var speed: float = 40.0
var damage: float = 0.0
var source: Node = null
var splash_radius: float = 0.0
var source_team: int = MapEnums.Team.A

var _target: Node3D
var _destination: Vector3
var _life: float = 4.0


static func launch(parent: Node3D, from: Vector3, target: Node3D, fallback_point: Vector3,
		projectile_speed: float, projectile_damage: float, shooter: Node3D,
		color: Color, radius: float = 0.35, splash: float = 0.0) -> Projectile:
	var shot := Projectile.new()
	shot.speed = maxf(projectile_speed, 1.0)
	shot.damage = projectile_damage
	shot.source = shooter
	shot.source_team = shooter.team
	shot.splash_radius = splash
	shot._target = target
	shot._destination = fallback_point
	shot.position = from
	var mesh := PrototypeMeshes.sphere(radius, color)
	shot.add_child(mesh)
	parent.add_child(shot)
	return shot


func _physics_process(delta: float) -> void:
	_life -= delta
	if _life <= 0.0:
		queue_free()
		return

	var goal := _destination
	if _target != null and is_instance_valid(_target) and _target.is_alive():
		goal = _target.get_aim_position()
		_destination = goal

	var offset := goal - global_position
	var step := speed * delta
	if offset.length() <= step:
		global_position = goal
		_impact()
		return
	global_position += offset.normalized() * step


func _impact() -> void:
	if splash_radius > 0.0:
		for unit in Battle.enemies_in_radius(global_position, source_team, splash_radius):
			unit.apply_damage(damage, source)
	elif _target != null and is_instance_valid(_target) and _target.is_alive():
		_target.apply_damage(damage, source)
	queue_free()
