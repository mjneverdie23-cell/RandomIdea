class_name VisionSource
extends Node3D

## Something that grants sight to a team.
##
## Champions, minions, turrets, nexuses and wards all attach one. The manager
## reads only these four fields, so anything that should reveal the map — a
## scan ability, a control ward, a scripted reveal — just adds one.

@export var team: int = MapEnums.Team.A
@export_range(0.0, 200.0, 0.5) var radius: float = 18.0
## Wards and scans see units standing in a bush; ordinary units do not.
@export var reveals_bushes: bool = false
@export var kind: VisionTypes.SourceKind = VisionTypes.SourceKind.UNIT
@export var active: bool = true


func setup(source_team: int, sight_radius: float, bush_sight: bool = false,
		source_kind: int = VisionTypes.SourceKind.UNIT) -> void:
	team = source_team
	radius = sight_radius
	reveals_bushes = bush_sight
	kind = source_kind


func _enter_tree() -> void:
	Vision.register_source(self)


func _exit_tree() -> void:
	Vision.unregister_source(self)


func ground_position() -> Vector2:
	return Vector2(global_position.x, global_position.z)
