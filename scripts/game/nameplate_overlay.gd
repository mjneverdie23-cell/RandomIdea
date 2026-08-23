class_name NameplateOverlay
extends Node3D

## Health bars over every unit, and a name over every champion.
##
## Normal presentation, not debug output. The distinction matters: the
## developer overlay draws internal identifiers, state machines and navigation
## targets, and is off unless you ask for it; this draws the two things a
## player actually reads in a fight, and is always on.
##
## One system for both maps and all three unit kinds, driven by a
## [NameplateConfig]. It answers to the same [VisionManager] as everything else
## — a champion you cannot see has no plate, exactly as it has no minimap dot
## and cannot be targeted — so a plate can never give away a bush.

const MINIMUM_FILL := 0.001
## Draw order within one plate. The pieces are coplanar, so distance sorting
## cannot separate them and the priority has to say which is on top.
const PRIORITY_BACKING := 1
const PRIORITY_FILL := 2
## A Label3D draws its outline as a separate pass, which has to stay *under*
## the glyphs or the name comes out solid black.
const PRIORITY_NAME_OUTLINE := 3
const PRIORITY_NAME := 4

var config: NameplateConfig
## The team whose point of view decides friend, foe and what is hidden.
var local_team: int = MapEnums.Team.A
## Used only to cull distant plates.
var camera: Camera3D

var _plates: Dictionary = {}
var _timer: float = 0.0


func setup(nameplate_config: NameplateConfig, team: int, view: Camera3D = null) -> void:
	config = nameplate_config if nameplate_config != null else NameplateConfig.new()
	local_team = team
	camera = view
	if not Battle.unit_registered.is_connected(_on_unit_registered):
		Battle.unit_registered.connect(_on_unit_registered)
		Battle.unit_unregistered.connect(_on_unit_unregistered)
	for unit in Battle.all():
		_on_unit_registered(unit)
	refresh()


## A client learns which team it is on only once its champion arrives.
func set_local_team(team: int) -> void:
	if team == local_team:
		return
	local_team = team
	for unit in _plates:
		if is_instance_valid(unit):
			_restyle(unit, _plates[unit])
	refresh()


func plate_count() -> int:
	return _plates.size()


## Test and debug helper: is this unit's plate actually on screen?
func is_plate_visible(unit: Node3D) -> bool:
	if not _plates.has(unit):
		return false
	return bool(_plates[unit]["root"].visible)


func name_shown_for(unit: Node3D) -> String:
	if not _plates.has(unit):
		return ""
	var label: Label3D = _plates[unit]["label"]
	if label == null or not label.visible:
		return ""
	return label.text


# --- construction ------------------------------------------------------------

func _wants_plate(unit: Node3D) -> bool:
	match unit.kind:
		Unit.Kind.CHAMPION:
			return config.champion_health or config.champion_name
		Unit.Kind.MINION:
			return config.minion_health
		Unit.Kind.TURRET:
			return config.structure_health
	return false


func _bar_width(unit: Node3D) -> float:
	match unit.kind:
		Unit.Kind.CHAMPION:
			return config.champion_bar_width
		Unit.Kind.TURRET:
			return config.structure_bar_width
	return config.minion_bar_width


func _on_unit_registered(unit: Node3D) -> void:
	if unit == null or config == null or _plates.has(unit) or not _wants_plate(unit):
		return
	var root := Node3D.new()
	root.name = "Nameplate"
	root.position = Vector3(0.0, unit.body_height() + config.height_above_unit, 0.0)
	root.visible = false
	unit.add_child(root)

	var width := _bar_width(unit)
	var wants_bar: bool = unit.kind != Unit.Kind.CHAMPION or config.champion_health
	var pivot: Node3D = null
	var bar: MeshInstance3D = null
	if wants_bar:
		root.add_child(PrototypeMeshes.billboard_quad(
			Vector2(width, config.bar_height), config.background, false, PRIORITY_BACKING))
		pivot = Node3D.new()
		pivot.name = "Fill"
		pivot.position = Vector3(-width * 0.5, 0.0, 0.01)
		root.add_child(pivot)
		bar = PrototypeMeshes.billboard_quad(
			Vector2(width, config.bar_height * 0.78), config.ally_fill, true, PRIORITY_FILL)
		pivot.add_child(bar)

	var label: Label3D = null
	if unit.kind == Unit.Kind.CHAMPION and config.champion_name:
		label = Label3D.new()
		label.text = unit.display_name()
		label.position = Vector3(0.0, config.bar_height + 0.28, 0.0)
		label.font_size = config.name_font_size
		label.pixel_size = config.name_pixel_size
		label.outline_size = 8
		label.outline_modulate = Color(0, 0, 0, 0.9)
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.no_depth_test = true
		label.render_priority = PRIORITY_NAME
		label.outline_render_priority = PRIORITY_NAME_OUTLINE
		root.add_child(label)

	var plate := {"root": root, "fill": pivot, "bar": bar, "label": label}
	_plates[unit] = plate
	_restyle(unit, plate)


func _on_unit_unregistered(unit: Node3D) -> void:
	_plates.erase(unit)


# --- per-tick ----------------------------------------------------------------

func _process(delta: float) -> void:
	_timer -= delta
	if _timer > 0.0:
		return
	_timer = config.refresh if config != null else 0.1
	refresh()


func refresh() -> void:
	if config == null:
		return
	for unit in _plates.keys():
		if not is_instance_valid(unit):
			_plates.erase(unit)
			continue
		var plate: Dictionary = _plates[unit]
		var shown := _should_show(unit)
		plate["root"].visible = shown
		if not shown:
			continue
		var bar: MeshInstance3D = plate["bar"]
		if bar == null:
			continue
		var ratio: float = unit.health.health_ratio()
		plate["fill"].scale = Vector3(maxf(ratio, MINIMUM_FILL), 1.0, 1.0)
		var color := _fill_color(unit, ratio)
		if bar.material_override.albedo_color != color:
			bar.material_override.albedo_color = color


## Dead units have no plate, and neither does anything this team cannot see.
func _should_show(unit: Node3D) -> bool:
	if not unit.is_alive():
		return false
	if unit.team != local_team and not Vision.is_visible_to(unit, local_team):
		return false
	if camera != null and config.max_distance > 0.0:
		if camera.global_position.distance_to(unit.global_position) > config.max_distance:
			return false
	return true


func _fill_color(unit: Node3D, ratio: float) -> Color:
	if ratio <= config.low_health_ratio:
		return config.low_fill
	return config.ally_fill if unit.team == local_team else config.enemy_fill


## Friend/foe colouring is a function of who is watching, so it is re-applied
## when a client finds out which team it is on.
func _restyle(unit: Node3D, plate: Dictionary) -> void:
	var friendly: bool = unit.team == local_team
	var bar: MeshInstance3D = plate["bar"]
	if bar != null:
		bar.material_override.albedo_color = _fill_color(unit, unit.health.health_ratio())
	var label: Label3D = plate["label"]
	if label != null:
		label.modulate = config.ally_name if friendly else config.enemy_name
