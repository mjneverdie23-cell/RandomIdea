## A walkable rectangle. Two areas connect wherever their rectangles touch.
class_name MapArea
extends Resource

@export var id: StringName = &""
@export var label: String = ""
## XZ footprint: position = (x, z), size = (width, depth).
@export var rect: Rect2 = Rect2()
@export var tags: Array[StringName] = []

static func make(p_id: StringName, x0: float, z0: float, x1: float, z1: float, p_label: String = "", p_tags: Array[StringName] = []) -> MapArea:
	var area := MapArea.new()
	area.id = p_id
	area.label = p_label if p_label != "" else String(p_id).capitalize()
	area.rect = Rect2(Vector2(minf(x0, x1), minf(z0, z1)), Vector2(absf(x1 - x0), absf(z1 - z0)))
	area.tags = p_tags
	return area

func center() -> Vector3:
	var c := rect.get_center()
	return Vector3(c.x, 0.0, c.y)
