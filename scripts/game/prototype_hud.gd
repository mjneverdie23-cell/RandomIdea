class_name PrototypeHud
extends CanvasLayer

## Development HUD: control reference on the left, live champion and sandbox
## state on the right.
##
## Purely observational. It reads from the map, the director and the camera and
## never drives them, so deleting it cannot change gameplay.

const COLOR_OK := "#7fe08a"
const COLOR_IDLE := "#8d97a5"
const COLOR_WARN := "#ffd36b"
const COLOR_BAD := "#ff8a7a"

var _root: GameRoot
var _attached: ChampionController
var _map: MapController
var _director: GameDirector
var _camera: GameplayCamera
var _champion: ChampionController

var _tracked: PackedStringArray = PackedStringArray()
var _visited: Dictionary = {}
var _status_label: RichTextLabel
var _controls_label: RichTextLabel
var _toast_label: Label
var _result_label: RichTextLabel
var _toast_timer: float = 0.0
var _network_label: Label
var _network_status: String = ""


func bind(root: GameRoot) -> void:
	_root = root
	_map = root.map
	_director = root.director
	_camera = root.camera
	_champion = root.director.player

	# The gameplay spaces worth visiting come from the layout, so the checklist
	# is right on the three-lane map and on the one-lane arena alike.
	_tracked = PackedStringArray()
	for collection in [_map.layout.lanes, _map.layout.jungles, _map.layout.objectives, _map.layout.bases]:
		for entry in collection:
			_tracked.append(String(entry["id"]))
	if not _map.layout.river.is_empty():
		_tracked.append(String(_map.layout.river["id"]))
	for id in _tracked:
		_visited[id] = false

	_build_ui()
	_connect_signals(root.dev_input)
	if _champion != null:
		attach_champion(_champion)


## Wires the toast feed to whichever champion this machine drives.
func attach_champion(champion: ChampionController) -> void:
	if champion == null or champion == _attached:
		return
	_champion = champion
	_attached = champion
	_connect_champion(champion)


func set_network_status(text: String) -> void:
	_network_status = text
	if _network_label != null:
		_network_label.text = text


func _connect_signals(dev_input: DevInputController) -> void:
	_map.debug_renderer.debug_visibility_changed.connect(func(on: bool) -> void:
		_toast("Map debug %s" % ("on" if on else "off")))
	_camera.lock_changed.connect(func(locked: bool) -> void:
		_toast("Camera %s" % ("locked" if locked else "free")))
	if _director.waves != null:
		_director.waves.wave_spawned.connect(func(index: int, team: int, lane: int, count: int) -> void:
			if team == MapEnums.Team.A and lane == MapEnums.Lane.MID:
				_toast("Wave %d spawned (%d per lane)" % [index, count]))
	if dev_input != null:
		dev_input.dev_command.connect(_toast)
	_director.match_ended.connect(_on_match_ended)
	for nexus in _director.nexuses:
		nexus.health.damaged.connect(func(_amount: float, _source: Node) -> void:
			_toast("%s under attack" % nexus.display_label()))


func _connect_champion(champion: ChampionController) -> void:
	champion.abilities.ability_cast.connect(func(_slot: int, ability: AbilityData) -> void:
		_toast("Cast %s" % ability.display_name))
	champion.abilities.ability_failed.connect(func(slot: int, reason: String) -> void:
		_toast("%s: %s" % [InputCommands.ability_name(slot), reason]))
	champion.recall_started.connect(func(duration: float) -> void: _toast("Recalling (%.1fs)" % duration))
	champion.recall_finished.connect(func() -> void: _toast("Recalled to fountain"))
	champion.recall_interrupted.connect(func() -> void: _toast("Recall interrupted"))
	champion.respawn_started.connect(func(duration: float) -> void: _toast("Killed - respawn in %.0fs" % duration))
	champion.respawn_finished.connect(func() -> void: _toast("Respawned"))
	champion.target_selected.connect(func(target: Node3D) -> void:
		_toast("Target: %s" % target.display_label()))
	champion.health.damaged.connect(func(amount: float, _source: Node) -> void:
		if amount >= 1.0:
			_toast("-%d HP" % int(amount)))


func _build_ui() -> void:
	_controls_label = _make_label(Control.PRESET_TOP_LEFT)
	_controls_label.offset_left = 16
	_controls_label.custom_minimum_size = Vector2(360, 0)
	_controls_label.text = _controls_text()
	add_child(_controls_label)

	_status_label = _make_label(Control.PRESET_TOP_RIGHT)
	_status_label.offset_right = -16
	_status_label.offset_left = -430
	_status_label.custom_minimum_size = Vector2(414, 0)
	add_child(_status_label)

	_result_label = RichTextLabel.new()
	_result_label.bbcode_enabled = true
	_result_label.fit_content = true
	_result_label.scroll_active = false
	_result_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_result_label.set_anchors_preset(Control.PRESET_CENTER)
	_result_label.offset_left = -320
	_result_label.offset_right = 320
	_result_label.offset_top = -70
	_result_label.visible = false
	add_child(_result_label)

	_network_label = Label.new()
	_network_label.set_anchors_preset(Control.PRESET_TOP_LEFT)
	_network_label.offset_left = 16
	_network_label.offset_top = 330
	_network_label.modulate = Color(1.0, 0.83, 0.42)
	_network_label.text = _network_status
	add_child(_network_label)

	_toast_label = Label.new()
	_toast_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_toast_label.offset_bottom = -48
	_toast_label.offset_left = -320
	_toast_label.offset_right = 320
	_toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast_label.modulate = Color(1, 1, 1, 0)
	add_child(_toast_label)


func _make_label(preset: int) -> RichTextLabel:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.set_anchors_preset(preset)
	label.offset_top = 12
	return label


func _controls_text() -> String:
	return "\n".join([
		"[b]MOBA prototype[/b]  [color=#ffd36b]%s[/color]" % _root.mode_name(),
		"[color=#b9c2ce]WASD[/color]  move          [color=#b9c2ce]Mouse[/color] aim",
		"[color=#b9c2ce]LMB[/color]   select + attack",
		"[color=#b9c2ce]Q E R F[/color] abilities   [color=#b9c2ce]B[/color] recall",
		"[color=#b9c2ce]Wheel[/color] zoom          [color=#b9c2ce]Space[/color] camera lock",
		"",
		"[b]Developer[/b]",
		"[color=#b9c2ce]F1[/color] enemy champion  [color=#b9c2ce]F2[/color] minion wave",
		"[color=#b9c2ce]F3[/color] reset champion  [color=#b9c2ce]F4[/color] to A spawn",
		"[color=#b9c2ce]F5[/color] to B base       [color=#b9c2ce]F6[/color] refill HP",
		"[color=#b9c2ce]F7[/color] kill target     [color=#b9c2ce]F8[/color] kill enemies",
		"[color=#b9c2ce]F9[/color] map debug       [color=#b9c2ce]F10[/color] combat debug",
		"[color=#b9c2ce]F11[/color] network info   [color=#b9c2ce]F12[/color] destroy nexus",
		"[color=#b9c2ce]Enter[/color] restart match  [color=#b9c2ce]Esc[/color] menu",
	])


func _process(delta: float) -> void:
	if _map == null or not _map.is_built():
		return
	if _root != null and _root.champion != null and _root.champion != _attached:
		attach_champion(_root.champion)
	if _champion == null or not is_instance_valid(_champion):
		return
	_update_visited()
	_status_label.text = _status_text()
	if _toast_timer > 0.0:
		_toast_timer -= delta
		_toast_label.modulate.a = clampf(_toast_timer / 0.6, 0.0, 1.0)


func _update_visited() -> void:
	var ground := Vector2(_champion.global_position.x, _champion.global_position.z)
	var area := _map.layout.area_at(ground)
	if area.is_empty():
		return
	var data := _map.registry.get_data(area)
	if data.has("jungle"):
		area = String(data["jungle"])
	if _visited.has(area):
		_visited[area] = true


func _status_text() -> String:
	var lines := PackedStringArray()
	var position := _champion.global_position
	lines.append("[right][b]%d FPS[/b]   x %.0f  z %.0f[/right]" % [
		Engine.get_frames_per_second(), position.x, position.z
	])
	lines.append("[right]%s[/right]" % _health_text())
	lines.append("[right]%s[/right]" % _ability_text())
	lines.append("[right]target: %s[/right]" % _target_text())
	lines.append("[right]%s[/right]" % _sandbox_text())
	lines.append("[right]area: [color=%s]%s[/color]   visited %d/%d[/right]" % [
		COLOR_WARN, _current_area(), _visited_count(), _tracked.size()
	])
	return "\n".join(lines)


func _current_area() -> String:
	var ground := Vector2(_champion.global_position.x, _champion.global_position.z)
	var area := _map.layout.area_at(ground)
	return area if not area.is_empty() else "terrain"


func _visited_count() -> int:
	var total := 0
	for id in _tracked:
		if _visited[id]:
			total += 1
	return total


func _health_text() -> String:
	if not _champion.is_alive():
		return "[color=%s]DEAD - respawn in %.1fs[/color]" % [COLOR_BAD, _champion.respawn_remaining()]
	var health := _champion.health
	var color := COLOR_OK if health.health_ratio() > 0.35 else COLOR_BAD
	var text := "[color=%s]HP %d/%d[/color]" % [color, int(health.current), int(health.maximum)]
	if _champion.is_recalling():
		text += "   recall %d%%" % int(_champion.recall_progress() * 100.0)
	for id in _champion.stats.active_modifier_ids():
		text += "   [color=%s]%s %.1fs[/color]" % [COLOR_WARN, id, _champion.stats.modifier_remaining(id)]
	return text


func _ability_text() -> String:
	var parts := PackedStringArray()
	for slot in InputCommands.ABILITY_NAMES.size():
		var name := InputCommands.ability_name(slot)
		if _champion.abilities.ability_for(slot) == null:
			parts.append("[color=%s]%s -[/color]" % [COLOR_IDLE, name])
			continue
		var left := _champion.abilities.cooldown_remaining(slot)
		if left <= 0.0:
			parts.append("[color=%s]%s[/color]" % [COLOR_OK, name])
		else:
			parts.append("[color=%s]%s %.1f[/color]" % [COLOR_IDLE, name, left])
	return "  ".join(parts)


func _target_text() -> String:
	var target = _champion.targeting.current_target
	if target == null or not is_instance_valid(target) or not target.is_alive():
		return "[color=%s]none[/color]" % COLOR_IDLE
	var gap := _champion.targeting.distance_to_target()
	var color := COLOR_OK if gap <= _champion.attack_range() else COLOR_WARN
	return "[color=%s]%s  %d/%d HP  %.1fm[/color]" % [
		color, target.display_label(), int(target.health.current),
		int(target.health.maximum), maxf(gap, 0.0)
	]


func _sandbox_text() -> String:
	var info := _director.describe()
	var wave: float = info["next_wave"]
	var wave_text := "off" if wave < 0.0 else "%.0fs" % wave
	return "minions %d/%d   turrets %d   next wave %s\n[right]%s[/right]" % [
		info["minions_a"], info["minions_b"], info["turrets"], wave_text, _nexus_text()
	]


func _nexus_text() -> String:
	var parts := PackedStringArray()
	for nexus in _director.nexuses:
		var color := COLOR_OK if nexus.team == _director.player_team else COLOR_BAD
		if not nexus.is_alive():
			parts.append("[color=%s]%s DOWN[/color]" % [COLOR_IDLE, nexus.display_label()])
		else:
			parts.append("[color=%s]%s %d%%[/color]" % [
				color, nexus.display_label(), int(nexus.health.health_ratio() * 100.0)
			])
	return "  ".join(parts)


func _on_match_ended(_outcome: int, winner_team: int) -> void:
	var state := _director.match_state
	var color := COLOR_OK if state.outcome == MatchState.Outcome.VICTORY else COLOR_BAD
	_result_label.text = "\n".join([
		"[center][font_size=96][color=%s]%s[/color][/font_size][/center]" % [color, state.banner_text()],
		"[center]Team %s destroyed the enemy nexus after %s[/center]" % [
			MapEnums.team_name(winner_team), _format_time(state.elapsed)
		],
		"[center][color=#b9c2ce]Enter[/color] restart    [color=#b9c2ce]F11[/color] switch mode[/center]",
	])
	_result_label.visible = true


func _format_time(seconds: float) -> String:
	return "%d:%02d" % [int(seconds) / 60, int(seconds) % 60]


func _toast(message: String) -> void:
	if _toast_label == null:
		return
	_toast_label.text = message
	_toast_timer = 2.2
	_toast_label.modulate.a = 1.0
