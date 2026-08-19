class_name PrototypeHud
extends CanvasLayer

## Development HUD: controls reference, live champion state and an acceptance
## checklist that ticks off every gameplay space as the player walks into it.
##
## Purely observational — it reads from the map, champion and camera and never
## drives them, so removing it cannot change gameplay.

const CHECK_COLOR_DONE := "#7fe08a"
const CHECK_COLOR_TODO := "#8d97a5"

var _map: MapController
var _champion: Champion
var _camera: GameplayCamera
var _commands: InputCommands

var _tracked: PackedStringArray = PackedStringArray()
var _visited: Dictionary = {}
var _status_label: RichTextLabel
var _controls_label: RichTextLabel
var _toast_label: Label
var _toast_timer: float = 0.0


func bind(map: MapController, champion: Champion, camera: GameplayCamera, commands: InputCommands) -> void:
	_map = map
	_champion = champion
	_camera = camera
	_commands = commands

	_tracked = PackedStringArray(["TOP_LANE", "MID_LANE", "BOT_LANE", "RIVER"])
	for jungle in map.layout.jungles:
		_tracked.append(String(jungle["id"]))
	_tracked.append_array(PackedStringArray(["TOP_OBJECTIVE", "BOT_OBJECTIVE", "TEAM_A_BASE", "TEAM_B_BASE"]))
	for id in _tracked:
		_visited[id] = false

	_build_ui()
	champion.ability_cast.connect(func(slot: int) -> void: _toast("Ability %s" % InputCommands.ability_name(slot)))
	champion.ability_blocked.connect(func(slot: int, left: float) -> void:
		_toast("Ability %s on cooldown (%.1fs)" % [InputCommands.ability_name(slot), left]))
	champion.recall_started.connect(func(duration: float) -> void: _toast("Recalling (%.1fs)" % duration))
	champion.recall_finished.connect(func() -> void: _toast("Recalled to fountain"))
	champion.recall_interrupted.connect(func() -> void: _toast("Recall interrupted"))
	camera.lock_changed.connect(func(locked: bool) -> void:
		_toast("Camera %s" % ("locked to champion" if locked else "free (edge pan)")))
	map.debug_renderer.debug_visibility_changed.connect(func(on: bool) -> void:
		_toast("Debug view %s" % ("on" if on else "off")))


func _build_ui() -> void:
	_controls_label = RichTextLabel.new()
	_controls_label.bbcode_enabled = true
	_controls_label.fit_content = true
	_controls_label.scroll_active = false
	_controls_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_controls_label.set_anchors_preset(Control.PRESET_TOP_LEFT)
	_controls_label.offset_left = 16
	_controls_label.offset_top = 12
	_controls_label.custom_minimum_size = Vector2(340, 0)
	_controls_label.text = _controls_text()
	add_child(_controls_label)

	_status_label = RichTextLabel.new()
	_status_label.bbcode_enabled = true
	_status_label.fit_content = true
	_status_label.scroll_active = false
	_status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_status_label.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_status_label.offset_right = -16
	_status_label.offset_top = 12
	_status_label.offset_left = -400
	_status_label.custom_minimum_size = Vector2(384, 0)
	add_child(_status_label)

	_toast_label = Label.new()
	_toast_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_toast_label.offset_bottom = -48
	_toast_label.offset_left = -300
	_toast_label.offset_right = 300
	_toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast_label.modulate = Color(1, 1, 1, 0)
	add_child(_toast_label)


func _controls_text() -> String:
	return "\n".join([
		"[b]MOBA prototype[/b]",
		"[color=#b9c2ce]WASD[/color]  move        [color=#b9c2ce]Mouse[/color] aim",
		"[color=#b9c2ce]LMB[/color]   basic attack",
		"[color=#b9c2ce]Q W E R[/color] abilities  [color=#b9c2ce]B[/color] recall",
		"[color=#b9c2ce]Wheel[/color] zoom        [color=#b9c2ce]Space[/color] camera lock",
		"[color=#b9c2ce]F1[/color]    debug view",
	])


func _process(delta: float) -> void:
	if _champion == null or _map == null or not _map.is_built():
		return
	_update_visited()
	_status_label.text = _status_text()
	if _toast_timer > 0.0:
		_toast_timer -= delta
		_toast_label.modulate.a = clampf(_toast_timer / 0.6, 0.0, 1.0)


func _update_visited() -> void:
	var area := _map.layout.area_at(_champion.ground_position())
	if area.is_empty():
		return
	# Camps report their own id; credit the jungle quadrant that owns them.
	var data := _map.registry.get_data(area)
	if data.has("jungle"):
		area = String(data["jungle"])
	if _visited.has(area):
		_visited[area] = true


func _status_text() -> String:
	var pos := _champion.global_position
	var area := _map.layout.area_at(_champion.ground_position())
	var lines := PackedStringArray()
	lines.append("[right][b]%d FPS[/b]   x %.0f  z %.0f[/right]" % [
		Engine.get_frames_per_second(), pos.x, pos.z
	])
	lines.append("[right]area: [color=#ffd36b]%s[/color][/right]" % (area if not area.is_empty() else "terrain"))
	lines.append("[right]cooldowns  %s[/right]" % _cooldown_text())
	if _champion.is_recalling():
		lines.append("[right]recall %d%%[/right]" % int(_champion.recall_progress() * 100.0))
	lines.append_array(_checklist_lines())
	return "\n".join(lines)


func _cooldown_text() -> String:
	var parts := PackedStringArray()
	for slot in InputCommands.ABILITY_NAMES.size():
		var left := _champion.cooldown_remaining(slot)
		var color := CHECK_COLOR_TODO if left > 0.0 else CHECK_COLOR_DONE
		parts.append("[color=%s]%s[/color]" % [color, InputCommands.ability_name(slot)])
	return " ".join(parts)


## One line per gameplay space the acceptance test asks the player to visit.
func _checklist_lines() -> PackedStringArray:
	var lines := PackedStringArray(["[right][b]visited[/b][/right]"])
	for id in _tracked:
		var done: bool = _visited[id]
		lines.append("[right][color=%s]%s %s[/color][/right]" % [
			CHECK_COLOR_DONE if done else CHECK_COLOR_TODO,
			"[lb]x[rb]" if done else "[lb] [rb]",
			id,
		])
	return lines


func _toast(message: String) -> void:
	if _toast_label == null:
		return
	_toast_label.text = message
	_toast_timer = 2.2
	_toast_label.modulate.a = 1.0
