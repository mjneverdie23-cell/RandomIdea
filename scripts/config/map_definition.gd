## A map, authored as walkable rectangles plus props.
##
## MapCompiler rasterises the areas and turns everything that is NOT walkable into
## merged wall boxes, and builds the navigation mesh from the same grid. You never
## place a wall by hand, and the layout cannot develop an accidental hole between
## two rooms.
##
## Rectangles are Rect2 in the XZ plane: position = (x, z), size = (width, depth).
## +Z is north (defender side), -Z south (attacker side), +X east, Y is up.
class_name MapDefinition
extends Resource

@export var id: StringName = &"map"
@export var display_name: String = "Map"

@export_group("Geometry")
## Rasterisation resolution. Smaller = finer walls, more boxes.
@export var cell_size: float = 2.0
@export var wall_height: float = 8.0
## Solid margin generated around the outermost area.
@export var padding: float = 6.0

@export_group("Colours")
@export var wall_color: Color = Color("9c8d76")
@export var floor_color: Color = Color("c2b280")
@export var sky_color: Color = Color("8fb2d4")
@export var fog_density: float = 0.006

@export_group("Layout")
@export var areas: Array[MapArea] = []
@export var props: Array[MapProp] = []
@export var attacker_spawns: Array[SpawnPointData] = []
@export var defender_spawns: Array[SpawnPointData] = []
@export var attacker_buy_zone: Rect2 = Rect2()
@export var defender_buy_zone: Rect2 = Rect2()
@export var bomb_sites: Array[BombSiteData] = []

func buy_zone_for(side: GameEnums.Side) -> Rect2:
	return attacker_buy_zone if side == GameEnums.Side.ATTACKERS else defender_buy_zone

func spawns_for(side: GameEnums.Side) -> Array[SpawnPointData]:
	return attacker_spawns if side == GameEnums.Side.ATTACKERS else defender_spawns

## Human-readable area under a world position, for callouts and debugging.
func area_at(position: Vector3) -> MapArea:
	for area in areas:
		if area.rect.has_point(Vector2(position.x, position.z)):
			return area
	return null
