class_name NexusController
extends Unit

## Gameplay behaviour for a team's nexus.
##
## Like [TurretController], it attaches alongside the structure the map already
## built rather than replacing it, so the map layer stays free of combat code.
## A nexus never attacks; it exists to be destroyed, and its death is what a
## game mode turns into a win or a loss.

signal destroyed(nexus: NexusController)

## Stable map identifier, e.g. "SOLO_NEXUS_A".
var map_id: String = ""

var _structure: Node3D


func _init() -> void:
	kind = Kind.TURRET  # a static, targetable structure as far as combat cares
	mobile = false
	uses_navigation = false


func _ready() -> void:
	super._ready()
	# Nothing to acquire: the nexus has no weapon.
	targeting.auto_acquire = false


func bind_structure(structure: Node3D, data: Dictionary) -> void:
	_structure = structure
	map_id = String(data.get("id", ""))
	name = "%s_Controller" % map_id if not map_id.is_empty() else "NexusController"


func display_label() -> String:
	return map_id if not map_id.is_empty() else super.display_label()


## The map already drew the nexus.
func _build_visual() -> void:
	pass


func _build_collision() -> void:
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(body_radius() * 2.0, body_height(), body_radius() * 2.0)
	shape.shape = box
	shape.position = Vector3(0.0, body_height() * 0.5, 0.0)
	add_child(shape)


func get_aim_position() -> Vector3:
	return global_position + Vector3.UP * body_height() * 0.5


## A nexus makes no decisions.
func _think(_delta: float) -> void:
	pass


func _handle_death(_source: Node) -> void:
	destroyed.emit(self)
	if _structure == null or not is_instance_valid(_structure):
		return
	_structure.position.y -= body_height() * 0.6
	for child in _structure.get_children():
		if child is MeshInstance3D:
			child.material_override = PrototypeMeshes.material(PrototypeMeshes.COLOR_WALL.darkened(0.3))
