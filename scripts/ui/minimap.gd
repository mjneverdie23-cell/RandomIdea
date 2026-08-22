class_name Minimap
extends Control

## Vision-respecting minimap, drawn from map data rather than from coordinates
## typed into this file.
##
## Everything static — the boundary, the lanes, the river, the bushes, the
## towers, the nexuses and the shops — comes out of the loaded [MapLayout] and
## [MapRegistry], so the three-lane map and the one-lane arena both render from
## the same code with no branch between them. Everything dynamic comes out of
## the [BattleRegistry], filtered through [VisionManager]: an enemy the local
## team cannot see is not drawn here, exactly as it is not targetable and not
## listed anywhere else in the HUD.
##
## No attack ranges are ever drawn on the minimap — not the player's, and
## certainly not an opponent's.

var config: HudConfig
var map: MapController
var champion: ChampionController
var local_team: int = MapEnums.Team.A

var _refresh: float = 0.0
## World-space rectangle the minimap covers, cached from the layout.
var _bounds := Rect2(-100.0, -100.0, 200.0, 200.0)


func setup(hud_config: HudConfig, map_controller: MapController, team: int) -> void:
	config = hud_config
	map = map_controller
	local_team = team
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	custom_minimum_size = Vector2(config.minimap_size, config.minimap_size)
	size = custom_minimum_size
	if map != null and map.layout != null:
		_bounds = map.layout.play_bounds().grow(4.0)
	queue_redraw()


func attach(unit: ChampionController) -> void:
	champion = unit
	if unit != null:
		local_team = unit.team
	queue_redraw()


## World XZ to minimap pixels. The camera looks down +Z, so world +Z is screen
## down and no axis flip is needed for the picture to match the view.
func to_map(point: Vector3) -> Vector2:
	var ratio := Vector2(
		(point.x - _bounds.position.x) / maxf(_bounds.size.x, 0.001),
		(point.z - _bounds.position.y) / maxf(_bounds.size.y, 0.001)
	)
	return Vector2(ratio.x * size.x, ratio.y * size.y)


func _to_map2(point: Vector2) -> Vector2:
	return to_map(Vector3(point.x, 0.0, point.y))


func _process(delta: float) -> void:
	_refresh -= delta
	if _refresh > 0.0:
		return
	_refresh = config.minimap_refresh if config != null else 0.1
	queue_redraw()


func _draw() -> void:
	if config == null or map == null or not map.is_built():
		return
	draw_rect(Rect2(Vector2.ZERO, size), config.minimap_background, true)
	_draw_terrain()
	_draw_bushes()
	_draw_structures()
	_draw_units()
	_draw_wards()
	draw_rect(Rect2(Vector2.ZERO, size), config.panel_border, false, 1.0)


## Lanes and the river, straight from the layout's own paths.
func _draw_terrain() -> void:
	var layout := map.layout
	for lane in layout.lanes:
		var path: PackedVector2Array = lane["path"]
		_draw_path(path, PrototypeMeshes.COLOR_LANE.darkened(0.15), 2.0)
	if not layout.river.is_empty():
		_draw_path(layout.river["path"], PrototypeMeshes.COLOR_RIVER.darkened(0.1), 2.0)


func _draw_path(points: PackedVector2Array, color: Color, width: float) -> void:
	if points.size() < 2:
		return
	var screen := PackedVector2Array()
	for point in points:
		screen.append(_to_map2(point))
	draw_polyline(screen, color, width)


## Bushes are shown to both teams: knowing where cover is, is map knowledge,
## not vision. Who is standing in one is a different question, answered below.
func _draw_bushes() -> void:
	for bush in map.layout.bushes:
		var centre := _to_map2(bush["position"])
		var radius: float = float(bush["radius"]) / maxf(_bounds.size.x, 0.001) * size.x
		draw_circle(centre, maxf(radius, 2.0), config.minimap_bush)


func _draw_structures() -> void:
	for collection in [map.layout.turrets, map.layout.nexuses]:
		for entry in collection:
			var team := int(entry["team"])
			var centre := _to_map2(entry["position"])
			var is_nexus := map.layout.nexuses.has(entry)
			var side := config.minimap_structure_dot * (1.6 if is_nexus else 1.0)
			draw_rect(Rect2(centre - Vector2(side, side) * 0.5, Vector2(side, side)),
				PrototypeMeshes.team_color(team), true)
	for zone in map.registry.ids_of_kind("shop"):
		var data := map.registry.get_data(zone)
		var centre := _to_map2(data["position"])
		draw_arc(centre, config.minimap_structure_dot, 0.0, TAU, 12, config.gold, 1.5)


## Everything the minimap is allowed to show as a moving dot: allies always,
## enemies only when the vision layer says this team can see them. A champion
## sitting in an unwarded bush is simply absent — from here, from target
## acquisition and from the rest of the HUD, all through the same query.
func visible_units() -> Array:
	var out: Array = []
	for unit in Battle.all():
		if not is_instance_valid(unit) or not unit.is_alive():
			continue
		if unit.kind == Unit.Kind.TURRET:
			continue  # already drawn from the layout, and they do not move
		if unit.team != local_team and not Vision.is_visible_to(unit, local_team):
			continue
		out.append(unit)
	return out


func _draw_units() -> void:
	for unit in visible_units():
		var centre := to_map(unit.global_position)
		var color := PrototypeMeshes.team_color(unit.team)
		if unit.kind == Unit.Kind.CHAMPION:
			var radius := config.minimap_champion_dot
			draw_circle(centre, radius, color)
			if unit == champion:
				draw_arc(centre, radius + 2.0, 0.0, TAU, 16, config.text, 1.5)
		else:
			draw_circle(centre, config.minimap_unit_dot, color.darkened(0.2))


## A team sees its own wards and nobody else's.
func _draw_wards() -> void:
	for ward in get_tree().get_nodes_in_group("wards"):
		if not is_instance_valid(ward) or ward.team != local_team:
			continue
		var centre := to_map(ward.global_position)
		draw_arc(centre, config.minimap_unit_dot + 1.0, 0.0, TAU, 10, config.minimap_ward, 1.5)
