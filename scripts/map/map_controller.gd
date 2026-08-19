class_name MapController
extends Node3D

## Builds and owns a complete MOBA map from a single [MapConfig] resource.
##
## The controller itself contains no geometry knowledge. It creates the focused
## managers, hands each of them the computed [MapLayout], and exposes a small
## query surface (spawn transforms, feature positions, bounds) that gameplay
## systems use instead of reaching into the map's node tree.
##
## Building a different map means supplying a different [MapConfig] — or a
## different [MapLayout] subclass — not rewriting the systems below.

signal map_built(controller: MapController)

## Map description. When left empty a default configuration is created, so the
## scene is playable out of the box.
@export var config: MapConfig
## [MapLayout] subclass that turns the config into geometry. Left empty it uses
## the three-lane [MapLayout]; a game mode supplies its own for another map.
@export var layout_script: Script
@export var build_on_ready: bool = true
@export var start_with_debug_visible: bool = false

var layout: MapLayout
var registry := MapRegistry.new()

var navigation: NavigationSetup
var terrain: TerrainBuilder
var lanes: LaneManager
var jungle: JungleManager
var objectives: ObjectiveManager
var bases: BaseManager
var spawns: SpawnPointManager
var debug_renderer: MapDebugRenderer

var _built := false


func _ready() -> void:
	if build_on_ready:
		build()


func is_built() -> bool:
	return _built


## Rebuilds the whole map. Safe to call again after changing [member config].
func build() -> void:
	if config == null:
		config = MapConfig.new()
	layout = _create_layout()
	registry.clear()
	_ensure_children()

	terrain.build(layout)
	bases.build(layout, registry)
	lanes.build(layout, registry)
	jungle.build(layout, registry)
	objectives.build(layout, registry)
	spawns.build(layout, registry)

	navigation.configure(layout)
	navigation.rebuild()

	debug_renderer.build(layout, navigation)
	debug_renderer.set_debug_visible(start_with_debug_visible)

	_built = true
	map_built.emit(self)


## Instantiates the configured layout, falling back to the three-lane default.
func _create_layout() -> MapLayout:
	if layout_script == null:
		return MapLayout.new(config)
	var created: Variant = layout_script.new(config)
	if created is MapLayout:
		return created
	push_error("MapController: layout_script does not produce a MapLayout; using the default.")
	return MapLayout.new(config)


func _ensure_children() -> void:
	if navigation == null:
		navigation = NavigationSetup.new()
		navigation.name = "Navigation"
		add_child(navigation)
	# Static map geometry lives under the navigation region so the region owns
	# everything it bakes from.
	terrain = _ensure_child(terrain, TerrainBuilder, "Terrain", navigation)
	bases = _ensure_child(bases, BaseManager, "Bases", navigation)
	lanes = _ensure_child(lanes, LaneManager, "Lanes", navigation)
	jungle = _ensure_child(jungle, JungleManager, "Jungle", navigation)
	objectives = _ensure_child(objectives, ObjectiveManager, "Objectives", navigation)
	spawns = _ensure_child(spawns, SpawnPointManager, "SpawnPoints", self)
	debug_renderer = _ensure_child(debug_renderer, MapDebugRenderer, "Debug", self)


func _ensure_child(current: Variant, type: Variant, node_name: String, parent: Node) -> Variant:
	if current != null and is_instance_valid(current):
		return current
	var existing := parent.get_node_or_null(NodePath(node_name))
	if existing != null:
		return existing
	var node = type.new()
	node.name = node_name
	parent.add_child(node)
	return node


# --- query surface -----------------------------------------------------------

## World position of any registered map feature, e.g. "TOP_OUTER_TURRET_A".
func position_of(id: String, fallback: Vector3 = Vector3.ZERO) -> Vector3:
	return registry.get_position(id, fallback)


func spawn_transform(team: int, scatter_radius: float = 0.0, index: int = 0) -> Transform3D:
	return spawns.spawn_transform(team, scatter_radius, index)


func play_bounds() -> Rect2:
	return layout.play_bounds() if layout != null else Rect2()


func is_inside_play_field(point: Vector3) -> bool:
	return play_bounds().has_point(Vector2(point.x, point.z))


## Clamps a world position to the playable square, used by the camera.
func clamp_to_play_field(point: Vector3, margin: float = 0.0) -> Vector3:
	var half: float = maxf(layout.play_field_half_size() - margin, 0.0) if layout != null else 0.0
	return Vector3(clampf(point.x, -half, half), point.y, clampf(point.z, -half, half))


func toggle_debug() -> bool:
	return debug_renderer.toggle()


func set_debug_visible(value: bool) -> void:
	debug_renderer.set_debug_visible(value)


func is_debug_visible() -> bool:
	return debug_renderer.visible


## Short human-readable summary, handy in the HUD and in headless checks.
func describe() -> Dictionary:
	return {
		"features": registry.size(),
		"lanes": layout.lanes.size(),
		"turrets": layout.turrets.size(),
		"camps": layout.camps.size(),
		"jungles": layout.jungles.size(),
		"objectives": layout.objectives.size(),
		"spawns": layout.spawn_points.size(),
		"wall_boxes": terrain.wall_rects().size(),
		"nav_floor_boxes": terrain.floor_rects().size(),
		"nav_polygons": navigation.polygon_count(),
	}
