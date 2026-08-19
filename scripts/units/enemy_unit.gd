class_name EnemyUnit
extends CharacterBody3D

## Placeholder hostile unit used to sanity-check scale, navigation and how
## readable the combat spaces are.
##
## It walks a patrol route with a [NavigationAgent3D], so its path comes from
## the baked navigation mesh rather than from hardcoded waypoint motion: if a
## route is not navigable, the unit visibly fails to reach it.

enum BodyShape { BOX, SPHERE }

signal waypoint_reached(index: int)

@export var team: int = MapEnums.Team.B
@export var body_shape: BodyShape = BodyShape.BOX
@export_range(0.3, 3.0, 0.05) var body_size: float = 0.9
@export_range(1.0, 20.0, 0.5) var move_speed: float = 6.5
@export_range(1.0, 30.0, 0.5) var acceleration: float = 20.0
@export_range(0.0, 40.0, 0.5) var gravity: float = 24.0
@export var loop_patrol: bool = true

var agent: NavigationAgent3D

var _waypoints: PackedVector3Array = PackedVector3Array()
var _index: int = 0
var _ready_to_navigate := false
var _vertical_velocity: float = 0.0


func _ready() -> void:
	collision_layer = 0b100  # enemies
	collision_mask = 0b1011  # world, player, structures
	motion_mode = CharacterBody3D.MOTION_MODE_GROUNDED
	floor_snap_length = 0.6
	_build_body()
	_build_agent()
	_begin_navigation()


func _build_body() -> void:
	var height := body_size * 2.0
	var shape := CollisionShape3D.new()
	if body_shape == BodyShape.SPHERE:
		var sphere := SphereShape3D.new()
		sphere.radius = body_size
		shape.shape = sphere
	else:
		var box := BoxShape3D.new()
		box.size = Vector3(body_size * 1.6, height, body_size * 1.6)
		shape.shape = box
	shape.position = Vector3(0.0, height * 0.5, 0.0)
	add_child(shape)

	var color := PrototypeMeshes.team_color(team).darkened(0.15)
	var mesh: MeshInstance3D
	if body_shape == BodyShape.SPHERE:
		mesh = PrototypeMeshes.sphere(body_size, color)
	else:
		mesh = PrototypeMeshes.box(Vector3(body_size * 1.6, height, body_size * 1.6), color)
	mesh.position = Vector3(0.0, height * 0.5, 0.0)
	add_child(mesh)

	var ring := PrototypeMeshes.ring(body_size * 1.9, 0.22, color.lightened(0.4))
	ring.name = "SelectionRing"
	ring.position.y = 0.2
	add_child(ring)


func _build_agent() -> void:
	agent = NavigationAgent3D.new()
	agent.name = "NavigationAgent3D"
	agent.radius = body_size
	agent.height = body_size * 2.0
	agent.path_desired_distance = 1.0
	agent.target_desired_distance = 1.5
	agent.path_max_distance = 6.0
	agent.avoidance_enabled = true
	agent.neighbor_distance = 8.0
	agent.max_neighbors = 6
	agent.max_speed = move_speed
	add_child(agent)
	agent.velocity_computed.connect(_on_velocity_computed)


## Assigns a patrol route in world space. Points do not need to be navigable
## exactly; the agent snaps to the closest navigable position.
func set_patrol(points: PackedVector3Array) -> void:
	_waypoints = points
	_index = 0
	if _ready_to_navigate:
		_seek_current()


func waypoint_count() -> int:
	return _waypoints.size()


func current_waypoint() -> int:
	return _index


## The navigation map needs a server sync before paths can be queried.
func _begin_navigation() -> void:
	var tree := get_tree()
	if tree != null:
		await tree.physics_frame
		await tree.physics_frame
	_ready_to_navigate = true
	_seek_current()


func _seek_current() -> void:
	if _waypoints.is_empty():
		return
	agent.target_position = _waypoints[_index % _waypoints.size()]


func _advance_waypoint() -> void:
	waypoint_reached.emit(_index)
	if _index + 1 >= _waypoints.size() and not loop_patrol:
		return
	_index = (_index + 1) % _waypoints.size()
	_seek_current()


func _physics_process(delta: float) -> void:
	_vertical_velocity = 0.0 if is_on_floor() else _vertical_velocity - gravity * delta

	var desired := Vector3.ZERO
	if _ready_to_navigate and not _waypoints.is_empty():
		if agent.is_navigation_finished():
			_advance_waypoint()
		var to_next := agent.get_next_path_position() - global_position
		to_next.y = 0.0
		if to_next.length() > 0.05:
			desired = to_next.normalized() * move_speed

	if desired.length_squared() > 0.01:
		rotation.y = lerp_angle(rotation.y, atan2(desired.x, desired.z), clampf(8.0 * delta, 0.0, 1.0))

	# With avoidance on, the server hands back a collision-free velocity through
	# velocity_computed; otherwise steer straight at the path.
	if agent.avoidance_enabled:
		agent.velocity = desired
	else:
		_apply_velocity(desired, delta)


func _on_velocity_computed(safe_velocity: Vector3) -> void:
	_apply_velocity(safe_velocity, get_physics_process_delta_time())


func _apply_velocity(horizontal: Vector3, delta: float) -> void:
	velocity.x = move_toward(velocity.x, horizontal.x, acceleration * delta)
	velocity.z = move_toward(velocity.z, horizontal.z, acceleration * delta)
	velocity.y = _vertical_velocity
	move_and_slide()
