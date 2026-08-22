class_name SettingsPanel
extends CanvasLayer

## In-game controls screen: see every player-facing binding, change one, spot a
## clash, or put them all back.
##
## It edits Godot's [InputMap] through [InputSettings] and nothing else. No
## gameplay script is touched by a rebind, because no gameplay script reads a
## key — they read [InputCommands], which is also what a touch build feeds.
##
## Built from ordinary Control nodes rather than a custom `_draw`, because this
## one panel genuinely wants focus, hover and click handling.

signal closed()

const ROW_HEIGHT := 30

@export var config: HudConfig

var _shade: ColorRect
var _panel: PanelContainer
var _rows: VBoxContainer
var _status: Label
var _buttons: Dictionary = {}
## The action currently waiting for a key press, or "" when nothing is.
var _capturing: String = ""


func _ready() -> void:
	layer = 3
	if config == null:
		config = HudConfig.new()
	InputSettings.capture_defaults()
	_build()
	hide_panel()


func is_open() -> bool:
	return _panel != null and _panel.visible


func toggle() -> bool:
	if is_open():
		hide_panel()
	else:
		show_panel()
	return is_open()


func show_panel() -> void:
	_shade.visible = true
	_panel.visible = true
	_capturing = ""
	_status.text = "Click a binding, then press the key you want."
	_refresh()


func hide_panel() -> void:
	_shade.visible = false
	_panel.visible = false
	_capturing = ""
	closed.emit()


# --- construction ------------------------------------------------------------

func _build() -> void:
	# The shade is a sibling, not a child: a PanelContainer lays its children
	# out, so a full-screen rect inside one covers the panel instead of the map.
	_shade = ColorRect.new()
	_shade.name = "Shade"
	_shade.color = Color(0.0, 0.0, 0.0, 0.55)
	_shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_shade.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_shade)

	_panel = PanelContainer.new()
	_panel.name = "Settings"
	_panel.add_theme_stylebox_override("panel", _box(config.background, config.panel_border))
	_panel.set_anchors_preset(Control.PRESET_CENTER)
	_panel.offset_left = -300
	_panel.offset_right = 300
	_panel.offset_top = -300
	_panel.offset_bottom = 300
	add_child(_panel)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 8)
	_panel.add_child(column)

	var title := Label.new()
	title.text = "Controls"
	title.add_theme_font_size_override("font_size", HudDraw.font_size(1.3))
	title.add_theme_color_override("font_color", config.text)
	column.add_child(title)

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 420)
	column.add_child(scroll)

	_rows = VBoxContainer.new()
	_rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_rows.add_theme_constant_override("separation", 2)
	scroll.add_child(_rows)
	for group in InputSettings.GROUPS:
		_add_group(String(group["title"]), group["actions"])

	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size = Vector2(0, 34)
	_status.add_theme_color_override("font_color", config.text_dim)
	column.add_child(_status)

	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 8)
	column.add_child(footer)
	footer.add_child(_action_button("Reset to defaults", _on_reset))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(spacer)
	footer.add_child(_action_button("Close", hide_panel))


func _add_group(title: String, action_list: Array) -> void:
	var heading := Label.new()
	heading.text = title
	heading.add_theme_color_override("font_color", config.upgradeable)
	heading.custom_minimum_size = Vector2(0, ROW_HEIGHT)
	heading.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	_rows.add_child(heading)

	for action in action_list:
		if not InputMap.has_action(action):
			continue
		var row := HBoxContainer.new()
		row.custom_minimum_size = Vector2(0, ROW_HEIGHT)
		_rows.add_child(row)

		var name_label := Label.new()
		name_label.text = InputSettings.label_for(action)
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		name_label.add_theme_color_override("font_color", config.text)
		row.add_child(name_label)

		var button := Button.new()
		button.custom_minimum_size = Vector2(190, ROW_HEIGHT - 4)
		button.pressed.connect(_begin_capture.bind(action))
		row.add_child(button)
		_buttons[action] = button


func _action_button(text: String, handler: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(160, 32)
	button.pressed.connect(handler)
	return button


func _box(fill: Color, border: Color) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = fill
	box.border_color = border
	box.set_border_width_all(1)
	box.set_content_margin_all(16)
	box.set_corner_radius_all(4)
	return box


# --- rebinding ---------------------------------------------------------------

func _begin_capture(action: String) -> void:
	_capturing = action
	_refresh()
	_status.text = "Press a key for \"%s\". Escape cancels." % InputSettings.label_for(action)


## Runs ahead of gameplay input. While the panel is open no key reaches the
## game at all: pressing Q to see what Q does must not also cast Q, and the key
## you are binding must not fire the action it is about to become.
func _input(event: InputEvent) -> void:
	if not is_open() or not (event is InputEventKey):
		return
	var key: InputEventKey = event
	if not key.pressed or key.echo:
		get_viewport().set_input_as_handled()
		return
	if _capturing.is_empty():
		get_viewport().set_input_as_handled()
		# Escape, or the settings key itself, closes; everything else is eaten.
		if key.keycode == KEY_ESCAPE or InputMap.event_is_action(key, "open_settings"):
			hide_panel()
		return
	get_viewport().set_input_as_handled()
	if key.keycode == KEY_ESCAPE:
		_capturing = ""
		_status.text = "Cancelled."
		_refresh()
		return
	if key.physical_keycode in [KEY_CTRL, KEY_SHIFT, KEY_ALT, KEY_META]:
		return  # a modifier on its own is not a binding

	var clash := InputSettings.conflict(key, _capturing)
	if not clash.is_empty():
		_status.text = "%s is already \"%s\". Pick another key." % [
			InputSettings.describe(key), InputSettings.label_for(clash)
		]
		return
	InputSettings.rebind(_capturing, key)
	_status.text = "\"%s\" is now %s. Saved." % [
		InputSettings.label_for(_capturing), InputSettings.describe(key)
	]
	_capturing = ""
	_refresh()


func _on_reset() -> void:
	InputSettings.reset_all()
	_capturing = ""
	_status.text = "Controls reset to defaults."
	_refresh()


func _refresh() -> void:
	for action in _buttons:
		var button: Button = _buttons[action]
		if action == _capturing:
			button.text = "press a key..."
			button.add_theme_color_override("font_color", config.upgradeable)
		else:
			button.text = InputSettings.binding_text(action)
			button.add_theme_color_override("font_color", config.text)
