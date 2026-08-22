class_name ShopZone
extends Node3D

## The circle of a team's base where its shop is open.
##
## Purely spatial: it answers "is this champion allowed to buy?". The catalogue
## and the transaction live in [PurchaseSystem], so a second shop, a mobile
## shop or a shop-anywhere debug mode is a placement change, not a code change.

var zone_id: String = ""
var team: int = MapEnums.Team.A
var radius: float = 8.0


func setup(id: String, shop_team: int, shop_radius: float) -> void:
	zone_id = id
	team = shop_team
	radius = shop_radius
	name = id


func contains(point: Vector3) -> bool:
	var offset := Vector2(point.x - global_position.x, point.z - global_position.z)
	return offset.length() <= radius


func accepts(unit: Node3D) -> bool:
	return unit != null and unit.team == team and contains(unit.global_position)


## Prototype shopfront: a marked circle and a low counter.
func build_visual() -> void:
	var color := PrototypeMeshes.team_color(team).lightened(0.3)
	var pad := PrototypeMeshes.disk_decal(Vector2.ZERO, radius, color.darkened(0.45),
		PrototypeMeshes.DECAL_Y_CAMP + 0.02, 22)
	add_child(pad)
	var rim := PrototypeMeshes.ring(radius, 0.35, color)
	rim.position.y = PrototypeMeshes.DECAL_Y_CAMP + 0.05
	add_child(rim)
	var counter := PrototypeMeshes.box(Vector3(3.2, 1.4, 1.2), color.darkened(0.2))
	counter.position = Vector3(0.0, 0.7, 0.0)
	add_child(counter)
	var awning := PrototypeMeshes.box(Vector3(3.6, 0.25, 2.0), color)
	awning.position = Vector3(0.0, 2.1, 0.0)
	add_child(awning)
