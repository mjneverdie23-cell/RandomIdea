class_name Unit
extends CharacterBody3D

## Shared body for everything that can fight: champions, minions and turrets.
##
## A unit is just a team, a [UnitStats] resource and a set of components. All
## of the prototype geometry is built in [method _build_visual], which is the
## only method a subclass has to change to swap placeholder art for real art.

enum Kind { CHAMPION, MINION, TURRET }

signal spawned(unit: Unit)
signal died(unit: Unit, source: Node)
signal revived(unit: Unit)

const KIND_NAMES := ["CHAMPION", "MINION", "TURRET"]

@export var team: int = MapEnums.Team.A
@export var stats_resource: UnitStats

var kind: int = Kind.MINION
## Set false for turrets and anything else that never walks.
var mobile: bool = true
## Enables NavigationAgent3D steering. Champions move directly by default.
var uses_navigation: bool = false
## Kind preference used when this unit looks for something to shoot.
var target_priority: Array = []

var health: HealthComponent
var stats: StatsComponent
var combat: CombatComponent
var targeting: TargetingComponent
var movement: MovementComponent
var visual: Node3D

var gameplay_enabled: bool = true


## Called before the unit enters the tree so components see final values.
func initialize(unit_team: int, unit_stats: UnitStats) -> void:
	team = unit_team
	stats_resource = unit_stats


func _ready() -> void:
	collision_layer = CombatLayers.team_layer(team)
	# Units only collide with terrain; separation between units is handled by
	# navigation avoidance, which cannot deadlock a lane full of minions.
	collision_mask = CombatLayers.WORLD

	stats = StatsComponent.new()
	stats.name = "Stats"
	add_child(stats)
	stats.setup(stats_resource)

	health = HealthComponent.new()
	health.name = "Health"
	add_child(health)
	health.configure(stats.value("max_health"))
	health.damage_reduction = stats.value("damage_reduction")
	health.died.connect(_on_died)
	health.revived.connect(_on_revived)
	stats.stats_changed.connect(_on_stats_changed)

	targeting = TargetingComponent.new()
	targeting.name = "Targeting"
	add_child(targeting)
	targeting.setup(self, target_priority)

	combat = CombatComponent.new()
	combat.name = "Combat"
	add_child(combat)
	combat.setup(self, stats, projectile_parent())

	if mobile:
		movement = MovementComponent.new()
		movement.name = "Movement"
		add_child(movement)
		movement.setup(self, stats, uses_navigation, body_radius())

	visual = Node3D.new()
	visual.name = "Visual"
	add_child(visual)
	_build_collision()
	_build_visual()

	Battle.register(self)
	spawned.emit(self)


func _exit_tree() -> void:
	Battle.unregister(self)


func _physics_process(delta: float) -> void:
	combat.tick(delta)
	if health.is_alive():
		health.regenerate(stats.value("health_regen"), delta)
	if gameplay_enabled and health.is_alive():
		_think(delta)
	if movement != null:
		movement.physics_step(delta)
	_update_facing(delta)


## Per-unit behaviour. Subclasses override this instead of _physics_process.
func _think(_delta: float) -> void:
	pass


# --- geometry (the replaceable part) -----------------------------------------

func body_radius() -> float:
	return stats_resource.body_radius if stats_resource != null else 0.9


func body_height() -> float:
	return stats_resource.body_height if stats_resource != null else 2.4


func _build_collision() -> void:
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = body_radius()
	capsule.height = maxf(body_height(), capsule.radius * 2.0 + 0.05)
	shape.shape = capsule
	shape.position = Vector3(0.0, capsule.height * 0.5, 0.0)
	add_child(shape)


## Prototype geometry only. Replace this to drop in a real model.
func _build_visual() -> void:
	var mesh := PrototypeMeshes.capsule(body_radius(), body_height(), PrototypeMeshes.team_color(team))
	mesh.position = Vector3(0.0, body_height() * 0.5, 0.0)
	visual.add_child(mesh)


func _update_facing(delta: float) -> void:
	if visual == null or movement == null:
		return
	var direction := movement.facing()
	if direction.length_squared() < 0.0001:
		return
	visual.rotation.y = lerp_angle(visual.rotation.y, atan2(direction.x, direction.z), clampf(10.0 * delta, 0.0, 1.0))


# --- combat contract ---------------------------------------------------------

func is_alive() -> bool:
	return health != null and health.is_alive()


func apply_damage(amount: float, source: Node = null) -> float:
	return health.apply_damage(amount, source) if health != null else 0.0


func heal(amount: float) -> float:
	return health.heal(amount) if health != null else 0.0


func is_enemy_of(other_team: int) -> bool:
	return team != other_team


## Radius used for range checks and click selection.
func select_radius() -> float:
	return body_radius()


func get_aim_position() -> Vector3:
	return global_position + Vector3.UP * body_height() * 0.6


func get_muzzle_position() -> Vector3:
	return global_position + Vector3.UP * body_height() * 0.7 + facing_direction() * body_radius()


func facing_direction() -> Vector3:
	if movement != null and movement.facing().length_squared() > 0.0001:
		return movement.facing()
	return Vector3.FORWARD


## Projectiles and effects are parented here so they survive the shooter.
func projectile_parent() -> Node3D:
	var parent := get_parent()
	return parent if parent is Node3D else self


func kind_name() -> String:
	return KIND_NAMES[kind]


## Human-readable identity for debug text. Node names are an implementation
## detail (Godot rewrites duplicates), so nothing user-facing should use them.
func display_label() -> String:
	if stats_resource != null and not stats_resource.display_name.is_empty():
		return "%s %s" % [stats_resource.display_name, MapEnums.team_name(team)]
	return "%s %s" % [kind_name(), MapEnums.team_name(team)]


func set_gameplay_enabled(value: bool) -> void:
	gameplay_enabled = value
	if movement != null:
		movement.enabled = value
		if not value:
			movement.stop()
	# A disabled unit must not be selectable, shot at, or acquired.
	collision_layer = CombatLayers.team_layer(team) if value else 0


func attack_range() -> float:
	return stats.value("attack_range")


func _on_stats_changed() -> void:
	if health == null:
		return
	health.damage_reduction = stats.value("damage_reduction")
	var new_max := stats.value("max_health")
	if not is_equal_approx(new_max, health.maximum):
		health.configure(new_max, true)


func _on_died(source: Node) -> void:
	set_gameplay_enabled(false)
	velocity = Vector3.ZERO
	if targeting != null:
		targeting.clear_target()
	_handle_death(source)
	died.emit(self, source)
	Battle.report_death(self, source)


func _on_revived() -> void:
	set_gameplay_enabled(true)
	_handle_revive()
	revived.emit(self)


## Subclass hook: what happens to the body after the health hits zero.
func _handle_death(_source: Node) -> void:
	if visual != null:
		visual.visible = false


func _handle_revive() -> void:
	if visual != null:
		visual.visible = true
