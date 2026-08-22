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
## Champions fill these in; everything else leaves them null.
var abilities: AbilityComponent
## Spendable ability resource. Null on anything whose stats leave it at zero.
var resource_pool: ResourceComponent
var wallet: WalletComponent
var experience: ExperienceComponent
var level: LevelComponent
var inventory: InventoryComponent
var score: ScoreComponent
## Sight this unit grants its team.
var vision: VisionSource

var gameplay_enabled: bool = true

## --- networking --------------------------------------------------------------
## Stable id used by [NetworkStateSync]. 0 means "not replicated".
var net_id: int = 0
## True on the process that decides this unit's behaviour. Offline and host
## simulate; clients only render what the authority sends.
var simulated: bool = true
## Last state received from the authority, interpolated towards on clients.
var net_position: Vector3 = Vector3.ZERO
var net_facing: float = 0.0
## How quickly a puppet catches up with the authority, in units of 1/second.
const NET_SMOOTHING := 14.0


## Called before the unit enters the tree so components see final values.
func initialize(unit_team: int, unit_stats: UnitStats) -> void:
	team = unit_team
	stats_resource = unit_stats


func _ready() -> void:
	simulated = Net.is_authority()
	net_position = global_position
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
		movement.setup(self, stats, uses_navigation and simulated, body_radius())

	if stats.value("max_resource") > 0.0:
		resource_pool = ResourceComponent.new()
		resource_pool.name = "ResourcePool"
		add_child(resource_pool)
		resource_pool.setup(stats)

	vision = VisionSource.new()
	vision.name = "Vision"
	vision.setup(team, stats.value("vision_radius"))
	add_child(vision)

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
	if not simulated:
		_follow_network_state(delta)
		return
	combat.tick(delta)
	if health.is_alive():
		health.regenerate(stats.value("health_regen"), delta)
		if resource_pool != null:
			resource_pool.regenerate(delta)
	if gameplay_enabled and health.is_alive():
		_think(delta)
	if movement != null:
		movement.physics_step(delta)
	_update_facing(delta)


## Per-unit behaviour. Subclasses override this instead of _physics_process.
func _think(_delta: float) -> void:
	pass


# --- network puppetry --------------------------------------------------------

## Facing the authority replicates, so a client sees units turn.
func facing_angle() -> float:
	return visual.rotation.y if visual != null else 0.0


## Applies one authority snapshot. Health and life are set outright because a
## client must never disagree with the server about them; position and facing
## are smoothed towards instead of snapped, so movement stays readable between
## the twenty snapshots a second.
func apply_network_state(position: Vector3, facing: float, current_health: float, alive: bool) -> void:
	net_position = position
	net_facing = facing
	if health != null:
		health.apply_replicated(current_health, alive)
	if not alive and visual != null:
		visual.visible = false
	elif alive and visual != null and not visual.visible:
		visual.visible = true


func _follow_network_state(delta: float) -> void:
	var weight := clampf(NET_SMOOTHING * delta, 0.0, 1.0)
	# A large correction means a teleport (respawn, recall, dash), so snap.
	if global_position.distance_to(net_position) > 6.0:
		global_position = net_position
	else:
		global_position = global_position.lerp(net_position, weight)
	if visual != null:
		visual.rotation.y = lerp_angle(visual.rotation.y, net_facing, weight)


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


## Can [param team] see this unit right now? Targeting, the minimap and the
## renderer all route through here so they cannot disagree.
func is_visible_to(other_team: int) -> bool:
	return Vision.is_visible_to(self, other_team)


## True while standing in a bush, whoever is looking.
func is_concealed() -> bool:
	return Vision.is_in_bush(self)


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
