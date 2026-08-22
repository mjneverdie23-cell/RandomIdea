class_name VisionZone
extends Node3D

## A bush: a circle of ground that hides whoever stands in it.
##
## The zone is gameplay state first — [VisionManager] asks it who is inside —
## and a low-poly visual second. Its geometry comes from map data, so bushes
## are placed by a [MapLayout] with a stable id and never hardcoded here.

## Stable map identifier, e.g. "TOP_BUSH_1".
var zone_id: String = ""
var radius: float = 5.0

var _visual: Node3D


func setup(id: String, zone_radius: float) -> void:
	zone_id = id
	radius = zone_radius
	name = id if not id.is_empty() else "Bush"


func _enter_tree() -> void:
	Vision.register_zone(self)


func _exit_tree() -> void:
	Vision.unregister_zone(self)


func ground_position() -> Vector2:
	return Vector2(global_position.x, global_position.z)


func contains(point: Vector3) -> bool:
	var offset := Vector2(point.x - global_position.x, point.z - global_position.z)
	return offset.length() <= radius


## Prototype foliage: a flat patch plus a few blobs, built from the shared mesh
## factory so replacing it with real art is one edit there.
func build_visual() -> void:
	if _visual != null:
		return
	_visual = Node3D.new()
	_visual.name = "Foliage"
	add_child(_visual)

	var patch := PrototypeMeshes.disk_decal(Vector2.ZERO, radius,
		PrototypeMeshes.COLOR_BUSH.darkened(0.25), PrototypeMeshes.DECAL_Y_CAMP + 0.01, 18)
	_visual.add_child(patch)

	var blobs := maxi(int(radius * 1.4), 3)
	for i in blobs:
		var angle := TAU * float(i) / float(blobs)
		var distance := radius * (0.35 + 0.45 * fmod(float(i) * 0.37, 1.0))
		var blob := PrototypeMeshes.sphere(radius * 0.34, PrototypeMeshes.COLOR_BUSH)
		blob.position = Vector3(cos(angle) * distance, radius * 0.22, sin(angle) * distance)
		blob.scale = Vector3(1.0, 0.62, 1.0)
		_visual.add_child(blob)
