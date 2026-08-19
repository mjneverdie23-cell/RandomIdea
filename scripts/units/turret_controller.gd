class_name TurretController
extends Unit

## Gameplay behaviour for one of the map's turret positions.
##
## The map still owns the turret's geometry and its stable identifier; this
## controller is attached alongside it and only borrows the structure node to
## grey it out when the turret dies. That keeps the map layer free of combat
## code, and means retuning or replacing turret visuals changes nothing here.

signal destroyed(turret: TurretController)

## Stable map identifier, e.g. "TOP_OUTER_TURRET_A".
var map_id: String = ""
var lane: int = -1
var tier: int = -1

## The map's StaticBody3D for this turret position.
var _structure: Node3D


func _init() -> void:
	kind = Kind.TURRET
	mobile = false
	uses_navigation = false
	# Minions are shot before champions, matching the usual MOBA rule.
	target_priority = [Kind.MINION, Kind.CHAMPION]


func _ready() -> void:
	super._ready()
	targeting.auto_acquire = true
	targeting.acquire_interval = 0.3


## Links the controller to the map structure it defends.
func bind_structure(structure: Node3D, data: Dictionary) -> void:
	_structure = structure
	map_id = String(data.get("id", ""))
	lane = int(data.get("lane", -1))
	tier = int(data.get("tier", -1))
	name = "%s_Controller" % map_id if not map_id.is_empty() else "TurretController"


## Turrets are already drawn by the map; the controller stays invisible.
func _build_visual() -> void:
	pass


## A thin capsule so clicks and range checks have something to hit. The
## structure itself keeps blocking movement on the world layer.
func _build_collision() -> void:
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = body_radius()
	capsule.height = maxf(body_height(), capsule.radius * 2.0 + 0.05)
	shape.shape = capsule
	shape.position = Vector3(0.0, capsule.height * 0.5, 0.0)
	add_child(shape)


func display_label() -> String:
	return map_id if not map_id.is_empty() else super.display_label()


func get_muzzle_position() -> Vector3:
	return global_position + Vector3.UP * body_height()


func _think(delta: float) -> void:
	targeting.tick(delta, attack_range())
	if targeting.is_target_valid(attack_range()):
		combat.try_attack(targeting.current_target)


func _handle_death(_source: Node) -> void:
	destroyed.emit(self)
	if _structure == null or not is_instance_valid(_structure):
		return
	# Prototype "rubble": sink the structure and drain its colour. The collider
	# stays so the navigation mesh baked around it remains valid.
	_structure.position.y -= body_height() * 0.55
	for child in _structure.get_children():
		if child is MeshInstance3D:
			child.material_override = PrototypeMeshes.material(PrototypeMeshes.COLOR_WALL.darkened(0.25))


func _handle_revive() -> void:
	if _structure == null or not is_instance_valid(_structure):
		return
	_structure.position.y += body_height() * 0.55
	var color := PrototypeMeshes.team_color(team)
	var index := 0
	for child in _structure.get_children():
		if child is MeshInstance3D:
			child.material_override = PrototypeMeshes.material(color if index > 0 else color.darkened(0.35))
			index += 1
