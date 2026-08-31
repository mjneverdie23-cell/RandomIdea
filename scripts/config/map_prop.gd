## A piece of cover, a platform, a pillar or a generated wall.
##
## `position` is the CENTRE of the box, so it maps straight onto a Node3D
## transform. Use the static helpers to author with footprint coordinates.
class_name MapProp
extends Resource

enum Shape { BOX, CYLINDER }

@export var id: StringName = &""
@export var kind: GameEnums.PropKind = GameEnums.PropKind.COVER
@export var shape: Shape = Shape.BOX
## Centre of the solid, in world space.
@export var position: Vector3 = Vector3.ZERO
## Full extents. For cylinders x and z are the diameter.
@export var size: Vector3 = Vector3.ONE
@export var rotation_degrees_axis: Vector3 = Vector3.ZERO
@export var color: Color = Color("a8792f")
@export var collidable: bool = true
## Blocks bot navigation. Defaults to "anything taller than 1.4 metres".
@export var blocks_nav: bool = true

## Box authored by footprint: `at` is (x, z) of the centre, `y` is the base height.
static func box(p_id: StringName, at: Vector2, p_size: Vector3, y: float = 0.0,
		p_color: Color = Color("a8792f"), p_kind: GameEnums.PropKind = GameEnums.PropKind.COVER,
		p_blocks_nav: int = -1) -> MapProp:
	var prop := MapProp.new()
	prop.id = p_id
	prop.kind = p_kind
	prop.shape = Shape.BOX
	prop.size = p_size
	prop.position = Vector3(at.x, y + p_size.y * 0.5, at.y)
	prop.color = p_color
	prop.blocks_nav = (p_size.y > 1.4) if p_blocks_nav < 0 else bool(p_blocks_nav)
	return prop

static func cylinder(p_id: StringName, at: Vector2, radius: float, height: float, y: float = 0.0,
		p_color: Color = Color("b0a894"), p_blocks_nav: int = -1) -> MapProp:
	var prop := MapProp.new()
	prop.id = p_id
	prop.kind = GameEnums.PropKind.PILLAR
	prop.shape = Shape.CYLINDER
	prop.size = Vector3(radius * 2.0, height, radius * 2.0)
	prop.position = Vector3(at.x, y + height * 0.5, at.y)
	prop.color = p_color
	prop.blocks_nav = (height > 1.4) if p_blocks_nav < 0 else bool(p_blocks_nav)
	return prop

## A slope characters can walk up. `direction` is the compass axis it climbs
## towards: "+x", "-x", "+z" or "-z".
static func ramp(p_id: StringName, at: Vector2, width: float, length: float, height: float,
		direction: String = "+z", p_color: Color = Color("7d7d7d")) -> MapProp:
	var prop := MapProp.new()
	prop.id = p_id
	prop.kind = GameEnums.PropKind.RAMP
	prop.shape = Shape.BOX
	var angle := atan2(height, length)
	var slab := 0.5
	var along := sqrt(length * length + height * height)
	if direction == "+z" or direction == "-z":
		prop.size = Vector3(width, slab, along)
		prop.rotation_degrees_axis = Vector3(rad_to_deg(angle) * (-1.0 if direction == "+z" else 1.0), 0, 0)
	else:
		prop.size = Vector3(along, slab, width)
		prop.rotation_degrees_axis = Vector3(0, 0, rad_to_deg(angle) * (1.0 if direction == "+x" else -1.0))
	prop.position = Vector3(at.x, height * 0.5 - slab * 0.25, at.y)
	prop.color = p_color
	prop.blocks_nav = false
	return prop

func aabb() -> AABB:
	return AABB(position - size * 0.5, size)
