## A plantable bomb site.
class_name BombSiteData
extends Resource

@export var id: StringName = &"A"
@export var label: String = "Bomb Site"
## Plantable XZ footprint.
@export var rect: Rect2 = Rect2()
## Where bots head to plant. Keep it clear of props.
@export var plant_point: Vector3 = Vector3.ZERO
@export var color: Color = Color("d2a24c")

static func make(p_id: StringName, x0: float, z0: float, x1: float, z1: float, p_plant: Vector3) -> BombSiteData:
	var site := BombSiteData.new()
	site.id = p_id
	site.label = "Bomb Site %s" % p_id
	site.rect = Rect2(Vector2(minf(x0, x1), minf(z0, z1)), Vector2(absf(x1 - x0), absf(z1 - z0)))
	site.plant_point = p_plant
	return site

func contains(position: Vector3) -> bool:
	return rect.has_point(Vector2(position.x, position.z))
