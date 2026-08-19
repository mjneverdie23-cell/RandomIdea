class_name MapDebugRenderer
extends Node3D

## Toggleable debug view of the map's gameplay spaces.
##
## Everything drawn here is derived from [MapLayout] and the baked navigation
## mesh, never from the prototype visuals, so the debug view keeps working
## after the placeholder art is replaced.

enum Layer { LANES, CAMPS, TURRET_RANGES, SPAWNS, OBJECTIVES, NAVMESH, BOUNDS, LABELS }

const LAYER_NAMES := {
	Layer.LANES: "Lane centre lines",
	Layer.CAMPS: "Jungle camps",
	Layer.TURRET_RANGES: "Turret ranges",
	Layer.SPAWNS: "Spawn points",
	Layer.OBJECTIVES: "Objective zones",
	Layer.NAVMESH: "Navigation mesh",
	Layer.BOUNDS: "Map boundaries",
	Layer.LABELS: "Identifiers",
}

const COLOR_LANE_LINE := Color(1.0, 0.85, 0.25)
const COLOR_RIVER_LINE := Color(0.35, 0.8, 1.0)
const COLOR_CAMP := Color(1.0, 0.55, 0.15)
const COLOR_RANGE := Color(1.0, 0.35, 0.35, 0.9)
const COLOR_SPAWN := Color(0.4, 1.0, 0.5)
const COLOR_OBJECTIVE := Color(0.85, 0.4, 1.0)
const COLOR_NAVMESH := Color(0.2, 1.0, 0.7, 0.8)
const COLOR_BOUNDS := Color(1.0, 1.0, 1.0, 0.9)

signal debug_visibility_changed(is_visible: bool)

var _layers: Dictionary = {}
var _layout: MapLayout
var _navigation: NavigationSetup


func _ready() -> void:
	visible = false


func build(layout: MapLayout, navigation: NavigationSetup) -> void:
	_layout = layout
	_navigation = navigation
	for child in get_children():
		child.queue_free()
	_layers.clear()

	for layer in Layer.values():
		var holder := Node3D.new()
		holder.name = StringName(LAYER_NAMES[layer].replace(" ", ""))
		add_child(holder)
		_layers[layer] = holder

	_draw_lanes()
	_draw_structures()
	_draw_camps()
	_draw_turret_ranges()
	_draw_spawns()
	_draw_objectives()
	_draw_bounds()
	refresh_navmesh()


func set_debug_visible(value: bool) -> void:
	visible = value
	debug_visibility_changed.emit(value)


func toggle() -> bool:
	set_debug_visible(not visible)
	return visible


func is_layer_visible(layer: int) -> bool:
	var holder: Node3D = _layers.get(layer, null)
	return holder != null and holder.visible


func set_layer_visible(layer: int, value: bool) -> void:
	var holder: Node3D = _layers.get(layer, null)
	if holder != null:
		holder.visible = value


## Rebuilds the navigation mesh overlay, e.g. after a re-bake.
func refresh_navmesh() -> void:
	var holder: Node3D = _layers.get(Layer.NAVMESH, null)
	if holder == null:
		return
	for child in holder.get_children():
		child.queue_free()
	if _navigation == null or _navigation.navigation_mesh == null:
		return
	var mesh_data := _navigation.navigation_mesh
	var vertices := mesh_data.get_vertices()
	if vertices.is_empty():
		return
	var immediate := ImmediateMesh.new()
	var mat := PrototypeMeshes.material(COLOR_NAVMESH, true)
	immediate.surface_begin(Mesh.PRIMITIVE_LINES, mat)
	for i in mesh_data.get_polygon_count():
		var polygon := mesh_data.get_polygon(i)
		for j in polygon.size():
			var a := vertices[polygon[j]] + Vector3.UP * 0.25
			var b := vertices[polygon[(j + 1) % polygon.size()]] + Vector3.UP * 0.25
			immediate.surface_add_vertex(a)
			immediate.surface_add_vertex(b)
	immediate.surface_end()
	var node := MeshInstance3D.new()
	node.name = "NavMeshWireframe"
	node.mesh = immediate
	node.material_override = mat
	holder.add_child(node)


func _draw_lanes() -> void:
	var holder: Node3D = _layers[Layer.LANES]
	for lane_entry in _layout.lanes:
		var line := PrototypeMeshes.polyline(lane_entry["path"], COLOR_LANE_LINE, 0.6)
		line.name = "%s_CentreLine" % lane_entry["id"]
		holder.add_child(line)
		_add_label(String(lane_entry["id"]), MapShapes.to_world(lane_entry["position"], 3.0), COLOR_LANE_LINE)
	if not _layout.river.is_empty():
		var river_line := PrototypeMeshes.polyline(_layout.river["path"], COLOR_RIVER_LINE, 0.6)
		river_line.name = "RIVER_CentreLine"
		holder.add_child(river_line)


## Nexus positions and minion spawns, which the solo arena relies on and the
## three-lane map also benefits from.
func _draw_structures() -> void:
	var holder: Node3D = _layers[Layer.SPAWNS]
	for nexus in _layout.nexuses:
		var rim := PrototypeMeshes.ring(4.5, 0.3, PrototypeMeshes.team_color(nexus["team"]).lightened(0.3))
		rim.name = "%s_Marker" % nexus["id"]
		rim.position = MapShapes.to_world(nexus["position"], 0.5)
		holder.add_child(rim)
		_add_label(String(nexus["id"]), MapShapes.to_world(nexus["position"], 11.0),
			PrototypeMeshes.team_color(nexus["team"]).lightened(0.4))


func _draw_camps() -> void:
	var holder: Node3D = _layers[Layer.CAMPS]
	for camp in _layout.camps:
		var rim := PrototypeMeshes.ring(float(camp["radius"]), 0.25, COLOR_CAMP)
		rim.name = String(camp["id"])
		rim.position = MapShapes.to_world(camp["position"], 0.4)
		holder.add_child(rim)
		_add_label(String(camp["id"]), MapShapes.to_world(camp["position"], 2.6), COLOR_CAMP)
	for jungle in _layout.jungles:
		var outline: PackedVector2Array = jungle["polygon"].duplicate()
		outline.append(outline[0])
		var line := PrototypeMeshes.polyline(outline, COLOR_CAMP.darkened(0.2), 0.5)
		line.name = "%s_Outline" % jungle["id"]
		holder.add_child(line)
		_add_label(String(jungle["id"]), MapShapes.to_world(jungle["position"], 4.0), COLOR_CAMP)


func _draw_turret_ranges() -> void:
	var holder: Node3D = _layers[Layer.TURRET_RANGES]
	for turret in _layout.turrets:
		var rim := PrototypeMeshes.ring(float(turret["range"]), 0.3, COLOR_RANGE)
		rim.name = "%s_Range" % turret["id"]
		rim.position = MapShapes.to_world(turret["position"], 0.35)
		holder.add_child(rim)
		_add_label(String(turret["id"]), MapShapes.to_world(turret["position"], 9.5), COLOR_RANGE)


func _draw_spawns() -> void:
	var holder: Node3D = _layers[Layer.SPAWNS]
	for spawn in _layout.spawn_points:
		var marker := PrototypeMeshes.cone(1.6, 4.0, COLOR_SPAWN)
		marker.name = String(spawn["id"])
		marker.position = MapShapes.to_world(spawn["position"], 2.0)
		holder.add_child(marker)
		_add_label(String(spawn["id"]), MapShapes.to_world(spawn["position"], 6.0), COLOR_SPAWN)
	for entrance in _layout.lane_entrances:
		var pin := PrototypeMeshes.sphere(0.7, COLOR_SPAWN.darkened(0.2))
		pin.name = String(entrance["id"])
		pin.position = MapShapes.to_world(entrance["position"], 1.2)
		holder.add_child(pin)


func _draw_objectives() -> void:
	var holder: Node3D = _layers[Layer.OBJECTIVES]
	for objective in _layout.objectives:
		var rim := PrototypeMeshes.ring(float(objective["radius"]), 0.4, COLOR_OBJECTIVE)
		rim.name = "%s_Zone" % objective["id"]
		rim.position = MapShapes.to_world(objective["position"], 0.45)
		holder.add_child(rim)
		_add_label(String(objective["id"]), MapShapes.to_world(objective["position"], 11.0), COLOR_OBJECTIVE)


func _draw_bounds() -> void:
	var holder: Node3D = _layers[Layer.BOUNDS]
	var e := _layout.play_half_extents()
	var outline := PackedVector2Array([
		Vector2(-e.x, -e.y), Vector2(e.x, -e.y), Vector2(e.x, e.y), Vector2(-e.x, e.y), Vector2(-e.x, -e.y)
	])
	var line := PrototypeMeshes.polyline(outline, COLOR_BOUNDS, 1.0)
	line.name = "PlayFieldBounds"
	holder.add_child(line)


func _add_label(text: String, position: Vector3, color: Color) -> void:
	var holder: Node3D = _layers[Layer.LABELS]
	var label := Label3D.new()
	label.text = text
	label.position = position
	label.modulate = color
	label.outline_modulate = Color(0, 0, 0, 0.85)
	label.outline_size = 8
	label.font_size = 44
	label.pixel_size = 0.012
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.fixed_size = false
	holder.add_child(label)
