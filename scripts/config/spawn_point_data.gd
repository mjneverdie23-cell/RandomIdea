## Where a side starts a round. `yaw` in radians: PI faces north (+Z), 0 faces south.
class_name SpawnPointData
extends Resource

@export var position: Vector3 = Vector3.ZERO
@export var yaw: float = 0.0

static func make(x: float, z: float, p_yaw: float) -> SpawnPointData:
	var point := SpawnPointData.new()
	point.position = Vector3(x, 0.0, z)
	point.yaw = p_yaw
	return point
