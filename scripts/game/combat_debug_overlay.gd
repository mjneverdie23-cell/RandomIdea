class_name CombatDebugOverlay
extends Node3D

## Optional world-space combat debugging, toggled with F10.
##
## It attaches a gizmo to every unit the [BattleRegistry] knows about — health
## bar, attack-range ring, current target line and a state line covering the
## movement command, navigation target and respawn timer. Nothing here feeds
## back into gameplay, so turning it off changes nothing but the picture.
##
## The bars billboard around their own origin, which reads correctly because
## the gameplay camera keeps a fixed yaw.

signal overlay_toggled(is_visible: bool)

const BAR_WIDTH := 2.4
const BAR_HEIGHT := 0.26
const REFRESH_INTERVAL := 0.1

@export var show_health_bars: bool = true
## Range rings are drawn for champions and turrets only; a ring on each of
## thirty minions buries the map it is meant to explain.
@export var show_range_rings: bool = true
@export var show_target_lines: bool = true
@export var show_state_labels: bool = true

var player: ChampionController

var _gizmos: Dictionary = {}
var _refresh_timer: float = 0.0
var _overlay_visible: bool = true


func _ready() -> void:
	Battle.unit_registered.connect(_on_unit_registered)
	Battle.unit_unregistered.connect(_on_unit_unregistered)
	for unit in Battle.all():
		_on_unit_registered(unit)


func setup(player_champion: ChampionController) -> void:
	player = player_champion


func set_overlay_visible(value: bool) -> void:
	_overlay_visible = value
	for unit in _gizmos:
		var gizmo: Dictionary = _gizmos[unit]
		gizmo["root"].visible = value
	set_process(value)
	overlay_toggled.emit(value)


func toggle() -> bool:
	set_overlay_visible(not _overlay_visible)
	return _overlay_visible


func is_overlay_visible() -> bool:
	return _overlay_visible


func _on_unit_registered(unit: Node3D) -> void:
	if _gizmos.has(unit) or unit == null:
		return
	var root := Node3D.new()
	root.name = "DebugGizmo"
	root.visible = _overlay_visible
	unit.add_child(root)

	var top: float = unit.body_height() + 0.9
	var background := _bar_quad(BAR_WIDTH, BAR_HEIGHT, Color(0.05, 0.06, 0.08, 0.85), false)
	background.position = Vector3(0.0, top, 0.0)
	root.add_child(background)

	var fill_pivot := Node3D.new()
	fill_pivot.position = Vector3(-BAR_WIDTH * 0.5, top, 0.01)
	root.add_child(fill_pivot)
	var fill := _bar_quad(BAR_WIDTH, BAR_HEIGHT * 0.78, _health_color(unit), true)
	fill_pivot.add_child(fill)

	var label := Label3D.new()
	label.position = Vector3(0.0, top + 0.55, 0.0)
	label.font_size = 34
	label.pixel_size = 0.011
	label.outline_size = 8
	label.outline_modulate = Color(0, 0, 0, 0.9)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.modulate = PrototypeMeshes.team_color(unit.team).lightened(0.35)
	root.add_child(label)

	var ring := PrototypeMeshes.ring(maxf(unit.attack_range(), 0.5), 0.18,
		PrototypeMeshes.team_color(unit.team).lightened(0.15))
	ring.position.y = 0.18
	ring.visible = _wants_range_ring(unit)
	root.add_child(ring)

	var line := MeshInstance3D.new()
	line.mesh = ImmediateMesh.new()
	line.material_override = PrototypeMeshes.material(Color(1.0, 0.4, 0.35), true)
	line.top_level = true  # draw in world space, not the unit's local space
	root.add_child(line)

	_gizmos[unit] = {
		"root": root, "fill": fill_pivot, "label": label, "ring": ring, "line": line,
	}
	_apply_layer_visibility(_gizmos[unit])


func _on_unit_unregistered(unit: Node3D) -> void:
	_gizmos.erase(unit)


func _process(delta: float) -> void:
	_refresh_timer -= delta
	var refresh_text := _refresh_timer <= 0.0
	if refresh_text:
		_refresh_timer = REFRESH_INTERVAL

	for unit in _gizmos.keys():
		if not is_instance_valid(unit):
			_gizmos.erase(unit)
			continue
		var gizmo: Dictionary = _gizmos[unit]
		var ratio: float = unit.health.health_ratio()
		gizmo["fill"].scale = Vector3(maxf(ratio, 0.001), 1.0, 1.0)
		_update_target_line(unit, gizmo["line"])
		if refresh_text:
			gizmo["label"].text = _describe(unit)
			gizmo["ring"].visible = _wants_range_ring(unit) and unit.is_alive()


func _update_target_line(unit: Node3D, line: MeshInstance3D) -> void:
	var mesh: ImmediateMesh = line.mesh
	mesh.clear_surfaces()
	if not show_target_lines or unit.targeting == null:
		return
	var target = unit.targeting.current_target
	if target == null or not is_instance_valid(target) or not unit.is_alive():
		return
	mesh.surface_begin(Mesh.PRIMITIVE_LINES, line.material_override)
	mesh.surface_add_vertex(unit.get_aim_position())
	mesh.surface_add_vertex(target.get_aim_position())
	mesh.surface_end()


func _describe(unit: Node3D) -> String:
	var parts := PackedStringArray()
	if unit.kind == Unit.Kind.CHAMPION:
		parts.append("%s %s" % [unit.kind_name(), MapEnums.team_name(unit.team)])
		if not unit.is_alive():
			parts.append("respawn %.1fs" % unit.respawn_remaining())
		else:
			parts.append("%d/%d" % [int(unit.health.current), int(unit.health.maximum)])
			var ai_state: String = unit.ai_state_name()
			if not ai_state.is_empty():
				parts.append(ai_state)
			parts.append(_cooldown_text(unit))
	elif unit.kind == Unit.Kind.MINION:
		# Deliberately terse: thirty of these are on screen at once.
		parts.append("%s %d/%d" % [
			unit.state_name(), unit.current_waypoint() + 1, maxi(unit.waypoint_count(), 1)
		])
		var target = unit.targeting.current_target
		if target != null and is_instance_valid(target):
			parts.append("-> %s" % target.display_label())
		return " ".join(parts)
	else:
		parts.append(unit.display_label())
		parts.append("%d/%d" % [int(unit.health.current), int(unit.health.maximum)])
	parts.append(_movement_text(unit))
	var target = unit.targeting.current_target if unit.targeting != null else null
	if target != null and is_instance_valid(target):
		parts.append("-> %s" % target.display_label())
	return "  ".join(parts)


## Only champions and turrets get a range ring; minion rings drown the map.
func _wants_range_ring(unit: Node3D) -> bool:
	return show_range_rings and unit.kind != Unit.Kind.MINION


func _movement_text(unit: Node3D) -> String:
	if unit.movement == null:
		return "static"
	match unit.movement.mode:
		MovementComponent.Mode.DIRECT:
			return "cmd:MOVE"
		MovementComponent.Mode.NAVIGATE:
			var destination: Vector3 = unit.movement.destination()
			return "nav:(%.0f, %.0f)" % [destination.x, destination.z]
		_:
			return "cmd:IDLE"


func _cooldown_text(champion: Node3D) -> String:
	var parts := PackedStringArray()
	for slot in InputCommands.ABILITY_NAMES.size():
		var left: float = champion.abilities.cooldown_remaining(slot)
		parts.append("%s:%s" % [InputCommands.ability_name(slot), "-" if left <= 0.0 else "%.0f" % left])
	return " ".join(parts)


func _health_color(unit: Node3D) -> Color:
	return Color(0.35, 0.85, 0.4) if unit.team == MapEnums.Team.A else Color(0.9, 0.4, 0.35)


func _bar_quad(width: float, height: float, color: Color, anchor_left: bool) -> MeshInstance3D:
	var quad := QuadMesh.new()
	quad.size = Vector2(width, height)
	if anchor_left:
		quad.center_offset = Vector3(width * 0.5, 0.0, 0.0)
	var node := MeshInstance3D.new()
	node.mesh = quad
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	material.billboard_keep_scale = true
	material.no_depth_test = true
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	node.material_override = material
	return node


func _apply_layer_visibility(gizmo: Dictionary) -> void:
	gizmo["fill"].visible = show_health_bars
	gizmo["label"].visible = show_state_labels
	gizmo["line"].visible = show_target_lines
