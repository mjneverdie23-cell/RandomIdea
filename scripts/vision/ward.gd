class_name Ward
extends Node3D

## A placed eye: grants its team vision in a radius for a while, and sees into
## bushes. Server-authoritative — a client asks for one, the authority decides
## whether it appears.

signal expired(ward: Ward)

var team: int = MapEnums.Team.A
var lifetime: float = 60.0
var radius: float = 14.0
var ward_id: int = 0
## Champion that placed it, by net id, so the per-champion limit survives a
## respawn and works the same on a host and offline.
var owner_net_id: int = 0

var _remaining: float = 0.0
var _source: VisionSource


static func create(ward_team: int, config: WardConfig, at: Vector3, id: int,
		placed_by: int = 0) -> Ward:
	var ward := Ward.new()
	ward.team = ward_team
	ward.lifetime = config.lifetime
	ward.radius = config.vision_radius
	ward.ward_id = id
	ward.owner_net_id = placed_by
	ward.position = at
	ward.name = "Ward_%s_%d" % [MapEnums.team_name(ward_team), id]
	return ward


func _ready() -> void:
	_remaining = lifetime
	add_to_group("wards")

	_source = VisionSource.new()
	_source.name = "Vision"
	_source.setup(team, radius, true, VisionTypes.SourceKind.WARD)
	add_child(_source)

	var body := PrototypeMeshes.cone(0.5, 1.6, PrototypeMeshes.team_color(team).lightened(0.35), 6)
	body.position.y = 0.8
	add_child(body)
	var eye := PrototypeMeshes.sphere(0.28, Color(1.0, 0.95, 0.7))
	eye.position.y = 1.8
	add_child(eye)


func time_remaining() -> float:
	return maxf(_remaining, 0.0)


func _process(delta: float) -> void:
	# Only the authority retires a ward; clients see it removed by replication.
	if not Net.is_authority():
		return
	_remaining -= delta
	if _remaining <= 0.0:
		expired.emit(self)
		queue_free()
