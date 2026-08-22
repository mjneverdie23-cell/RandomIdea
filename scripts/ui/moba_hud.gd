class_name MobaHud
extends CanvasLayer

## The one HUD, used by every game mode.
##
## Layout follows the shape mobile MOBAs settled on, because it works: the
## champion's own state sits along the bottom (level and bars on the left,
## abilities in the centre, items beside them), the minimap sits in the lower
## right where a thumb can reach it, and everything the player does not need
## mid-fight — the control reference, the sandbox readout — is pushed to the
## top corners. It is assembled from small widgets rather than one giant draw
## call, so a real mobile skin later replaces widgets one at a time.
##
## Nothing here holds a gameplay number. Every value is read from a live
## component on the champion, from the map or from the director, and every
## action leaves through [InputCommands] — so the HUD works unchanged on a
## client, where all of those values arrive from the server.

const COLOR_OK := "#7fe08a"
const COLOR_IDLE := "#8d97a5"
const COLOR_WARN := "#ffd36b"
const COLOR_BAD := "#ff8a7a"

@export var config: HudConfig

var champion_panel: ChampionPanel
var ability_bar: AbilityBar
var item_bar: ItemBar
var actions: ActionButtons
var minimap: Minimap
var shop: ShopUi

var _root: GameRoot
var _attached: ChampionController
var _map: MapController
var _director: GameDirector
var _camera: GameplayCamera
var _commands: InputCommands
var _champion: ChampionController

var _status_label: RichTextLabel
var _controls_label: RichTextLabel
var _toast_label: Label
var _result_label: RichTextLabel
var _network_label: Label
var _hint_label: Label
var _toast_timer: float = 0.0
var _network_status: String = ""
## Latches so entering the fountain opens the shop once rather than every frame.
var _was_in_shop: bool = false


func bind(root: GameRoot) -> void:
	_root = root
	_map = root.map
	_director = root.director
	_camera = root.camera
	_commands = root.commands
	_champion = root.director.player
	if config == null:
		config = HudConfig.new()

	_build_ui()
	_connect_signals(root.dev_input)
	if _champion != null:
		attach_champion(_champion)


## Wires every widget to whichever champion this machine drives.
func attach_champion(champion: ChampionController) -> void:
	if champion == null or champion == _attached:
		return
	_champion = champion
	_attached = champion
	for widget in [champion_panel, ability_bar, item_bar, actions, minimap, shop]:
		widget.attach(champion)
	_connect_champion(champion)


## Public toast, so another system can say something without reaching into the
## HUD's widgets.
func show_toast(message: String) -> void:
	_toast(message)


func set_network_status(text: String) -> void:
	_network_status = text
	if _network_label != null:
		_network_label.text = text


# --- shop --------------------------------------------------------------------

func toggle_shop() -> bool:
	return shop.toggle()


func open_shop() -> void:
	shop.open()


func close_shop() -> void:
	shop.close()


func is_shop_open() -> bool:
	return shop.is_open()


# --- construction ------------------------------------------------------------

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

	_network_label = Label.new()
	_network_label.set_anchors_preset(Control.PRESET_TOP_LEFT)
	_network_label.offset_left = 16
	_network_label.offset_top = 300
	_network_label.modulate = Color(1.0, 0.83, 0.42)
	_network_label.text = _network_status
	add_child(_network_label)

	_build_champion_area()
	_build_minimap()
	_build_shop()

	_hint_label = Label.new()
	_hint_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_hint_label.offset_bottom = -int(config.ability_button_size) - 96
	_hint_label.offset_left = -300
	_hint_label.offset_right = 300
	_hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hint_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hint_label.modulate = config.gold
	_hint_label.visible = false
	add_child(_hint_label)

	_toast_label = Label.new()
	_toast_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_toast_label.offset_bottom = -int(config.ability_button_size) - 64
	_toast_label.offset_left = -320
	_toast_label.offset_right = 320
	_toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast_label.modulate = Color(1, 1, 1, 0)
	add_child(_toast_label)

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


## Bottom band: bars on the left, abilities centred, items beside them.
func _build_champion_area() -> void:
	champion_panel = ChampionPanel.new()
	champion_panel.name = "ChampionPanel"
	champion_panel.setup(config)
	champion_panel.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	champion_panel.offset_left = 18
	champion_panel.offset_top = -int(champion_panel.preferred_size().y) - 24
	add_child(champion_panel)

	ability_bar = AbilityBar.new()
	ability_bar.name = "AbilityBar"
	ability_bar.setup(config)
	var bar_size := ability_bar.preferred_size()
	ability_bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	ability_bar.offset_left = -int(bar_size.x * 0.5)
	ability_bar.offset_right = int(bar_size.x * 0.5)
	ability_bar.offset_top = -int(bar_size.y) - 18
	ability_bar.offset_bottom = -18
	ability_bar.ability_pressed.connect(func(slot: int) -> void: _commands.request_ability(slot))
	ability_bar.upgrade_pressed.connect(_on_upgrade_pressed)
	add_child(ability_bar)

	item_bar = ItemBar.new()
	item_bar.name = "ItemBar"
	item_bar.setup(config)
	item_bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	item_bar.offset_left = int(bar_size.x * 0.5) + 18
	item_bar.offset_top = -int(config.item_slot_size) - 18
	item_bar.slot_pressed.connect(func(_slot: int) -> void: toggle_shop())
	add_child(item_bar)

	actions = ActionButtons.new()
	actions.name = "ActionButtons"
	actions.setup(config, _director)
	actions.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	actions.offset_left = -int(bar_size.x * 0.5) - int(config.action_button_size) - 18
	actions.offset_top = -int(actions.preferred_size().y) - 18
	# The ward goes where the player is pointing; the authority clamps it to the
	# champion's placement range and to the play field.
	actions.ward_pressed.connect(func() -> void: _commands.request_ward())
	actions.shop_pressed.connect(func() -> void: toggle_shop())
	add_child(actions)


func _build_minimap() -> void:
	minimap = Minimap.new()
	minimap.name = "Minimap"
	minimap.setup(config, _map, _director.player_team)
	minimap.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	minimap.offset_left = -int(config.minimap_size + config.minimap_margin)
	minimap.offset_top = -int(config.minimap_size + config.minimap_margin)
	minimap.offset_right = -int(config.minimap_margin)
	minimap.offset_bottom = -int(config.minimap_margin)
	add_child(minimap)


func _build_shop() -> void:
	shop = ShopUi.new()
	shop.name = "Shop"
	shop.setup(config, _director.config.shop_catalog, _director.purchases)
	# Centred: the shop is a modal moment at the fountain, not a corner widget,
	# and centring keeps it clear of the bars, the ability bar and the minimap.
	var shop_size := shop.preferred_size()
	shop.set_anchors_preset(Control.PRESET_CENTER)
	shop.offset_left = -int(shop_size.x * 0.5)
	shop.offset_right = int(shop_size.x * 0.5)
	shop.offset_top = -int(shop_size.y * 0.5)
	shop.offset_bottom = int(shop_size.y * 0.5)
	shop.purchase_pressed.connect(func(item_id: String) -> void:
		_commands.request_purchase(item_id))
	add_child(shop)


func _make_label(preset: int) -> RichTextLabel:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.set_anchors_preset(preset)
	label.offset_top = 12
	return label


# --- signals -----------------------------------------------------------------

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
	if _director.purchases != null:
		_director.purchases.purchase_succeeded.connect(func(who: ChampionController, item: ItemData) -> void:
			if who == _champion:
				_toast("Bought %s" % item.display_name))
		_director.purchases.purchase_rejected.connect(func(who: ChampionController, _id: String, reason: String) -> void:
			if who == _champion:
				_toast("Cannot buy: %s" % reason))
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
	champion.skill_point_spent.connect(func(slot: int, rank: int) -> void:
		_toast("%s upgraded to rank %d" % [InputCommands.ability_name(slot), rank]))
	champion.ward_placed.connect(func(_ward: Ward) -> void: _toast("Ward placed"))
	champion.target_selected.connect(func(target: Node3D) -> void:
		_toast("Target: %s" % target.display_label()))
	champion.health.damaged.connect(func(amount: float, _source: Node) -> void:
		if amount >= 1.0:
			_toast("-%d HP" % int(amount)))
	if champion.level != null:
		champion.level.levelled_up.connect(func(level: int, points: int) -> void:
			_toast("Level %d - %d skill point%s" % [level, points, "" if points == 1 else "s"]))
	if champion.wallet != null:
		champion.wallet.gold_earned.connect(func(amount: float, reason: String) -> void:
			if reason != "passive" and amount >= 1.0:
				_toast("+%d gold (%s)" % [int(amount), reason]))


## Upgrades go out on the command bus rather than straight to the champion, so
## a client's click travels through [CommandRelay] and is validated like any
## other request.
func _on_upgrade_pressed(slot: int) -> void:
	_commands.request_ability_upgrade(slot)


# --- per-frame ---------------------------------------------------------------

func _process(delta: float) -> void:
	if _map == null or not _map.is_built():
		return
	if _root != null and _root.champion != null and _root.champion != _attached:
		attach_champion(_root.champion)
	if _champion == null or not is_instance_valid(_champion):
		return
	_status_label.text = _status_text()
	_update_shop_presence()
	if _toast_timer > 0.0:
		_toast_timer -= delta
		_toast_label.modulate.a = clampf(_toast_timer / 0.6, 0.0, 1.0)


## Walking into your own fountain opens the shop, and walking out closes it —
## the same affordance a mobile MOBA uses, and the reason a recall feels like
## a shopping trip rather than a menu.
func _update_shop_presence() -> void:
	if _director.purchases == null:
		return
	var inside := _director.purchases.zone_for(_champion) != null
	if inside and not _was_in_shop:
		shop.open()
	elif not inside and _was_in_shop:
		shop.close()
	_was_in_shop = inside
	_hint_label.visible = inside and not shop.is_open()
	if _hint_label.visible:
		_hint_label.text = "In the shop - press the Shop button to open"
	# The control reference is reading material; it has no business competing
	# with an open panel.
	_controls_label.visible = not shop.is_open()


# --- text --------------------------------------------------------------------

func _controls_text() -> String:
	return "\n".join([
		"[b]MOBA prototype[/b]  [color=#ffd36b]%s[/color]" % _root.mode_name(),
		"[color=#b9c2ce]WASD[/color]  move          [color=#b9c2ce]Mouse[/color] aim",
		"[color=#b9c2ce]LMB[/color]   select + attack",
		"[color=#b9c2ce]Q E R F[/color] abilities   [color=#b9c2ce]B[/color] recall",
		"[color=#b9c2ce]C[/color] show my attack range   [color=#b9c2ce]Space[/color] camera lock",
		"[color=#b9c2ce]Ward / Shop[/color] buttons beside the ability bar",
		"",
		"[b]Developer[/b]",
		"[color=#b9c2ce]F1[/color] enemy champion  [color=#b9c2ce]F2[/color] minion wave",
		"[color=#b9c2ce]F3[/color] reset champion  [color=#b9c2ce]F4[/color] to A spawn",
		"[color=#b9c2ce]F5[/color] to B base       [color=#b9c2ce]F6[/color] refill HP",
		"[color=#b9c2ce]F7[/color] kill target     [color=#b9c2ce]F8[/color] kill enemies",
		"[color=#b9c2ce]F9[/color] map debug       [color=#b9c2ce]F10[/color] combat debug",
		"[color=#b9c2ce]F11[/color] network info   [color=#b9c2ce]F12[/color] destroy nexus",
		"[color=#b9c2ce]Shift+1..8[/color] gold, XP, level, abilities, ward,",
		"          reveal, shop, clear items",
		"[color=#b9c2ce]Enter[/color] restart match  [color=#b9c2ce]Esc[/color] menu",
	])


func _status_text() -> String:
	var lines := PackedStringArray()
	var position := _champion.global_position
	lines.append("[right][b]%d FPS[/b]   x %.0f  z %.0f[/right]" % [
		Engine.get_frames_per_second(), position.x, position.z
	])
	lines.append("[right]%s[/right]" % _state_text())
	lines.append("[right]target: %s[/right]" % _target_text())
	lines.append("[right]%s[/right]" % _sandbox_text())
	return "\n".join(lines)


func _state_text() -> String:
	if not _champion.is_alive():
		return "[color=%s]DEAD - respawn in %.1fs[/color]" % [COLOR_BAD, _champion.respawn_remaining()]
	var parts := PackedStringArray()
	if _champion.is_recalling():
		parts.append("[color=%s]recall %d%%[/color]" % [COLOR_WARN, int(_champion.recall_progress() * 100.0)])
	if _champion.is_concealed():
		parts.append("[color=%s]in a bush[/color]" % COLOR_OK)
	for id in _champion.stats.active_modifier_ids():
		# Levels and items register permanent modifiers; only timed buffs and
		# debuffs are worth a countdown on screen.
		var left := _champion.stats.modifier_remaining(id)
		if left > 0.0:
			parts.append("[color=%s]%s %.1fs[/color]" % [COLOR_WARN, id, left])
	return "  ".join(parts) if not parts.is_empty() else "[color=%s]ready[/color]" % COLOR_IDLE


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
		"[center][color=#b9c2ce]Enter[/color] restart    [color=#b9c2ce]Esc[/color] menu[/center]",
	])
	_result_label.visible = true


func _format_time(seconds: float) -> String:
	return "%d:%02d" % [int(seconds) / 60, int(seconds) % 60]


func _toast(message: String) -> void:
	if _toast_label == null:
		return
	_toast_label.text = message
	_toast_timer = config.toast_duration
	_toast_label.modulate.a = 1.0
