class_name MultiplayerMenu
extends CanvasLayer

## Minimal front end: pick a mode, then play offline, host, or join.
##
## It produces a launch request and nothing else — it never touches the map,
## the director or the peer. [GameRoot] decides what to do with the request, so
## the menu can be replaced wholesale without affecting gameplay.

signal launch_requested(request: Dictionary)

const NET_OFFLINE := "offline"
const NET_HOST := "host"
const NET_CLIENT := "client"

var modes: Array[GameModeConfig] = []

var _mode_picker: OptionButton
var _address_field: LineEdit
var _port_field: LineEdit
var _status: Label
var _panel: VBoxContainer


func setup(available_modes: Array[GameModeConfig], default_port: int) -> void:
	modes = available_modes
	_build_ui(default_port)


func set_status(text: String) -> void:
	if _status != null:
		_status.text = text


func open() -> void:
	visible = true


func close() -> void:
	visible = false


func selected_mode_id() -> String:
	if _mode_picker == null or modes.is_empty():
		return ""
	return modes[clampi(_mode_picker.selected, 0, modes.size() - 1)].id


func _build_ui(default_port: int) -> void:
	var backdrop := ColorRect.new()
	backdrop.color = Color(0.04, 0.05, 0.07, 0.92)
	backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(backdrop)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	_panel = VBoxContainer.new()
	_panel.custom_minimum_size = Vector2(420, 0)
	_panel.add_theme_constant_override("separation", 8)
	center.add_child(_panel)

	_add_title("MOBA PROTOTYPE")
	_add_hint("Solo Lane is 1v1: one human champion per team.")

	_mode_picker = OptionButton.new()
	for mode in modes:
		_mode_picker.add_item(mode.display_name)
	# Solo Lane is the interesting one for multiplayer, so preselect it.
	for i in modes.size():
		if modes[i].id == "solo_lane":
			_mode_picker.selected = i
	_panel.add_child(_mode_picker)

	_add_button("Play Offline", func() -> void: _launch(NET_OFFLINE))

	_add_hint("LAN / Online — host shows its address, the other side types it in.")
	var row := HBoxContainer.new()
	_address_field = LineEdit.new()
	_address_field.text = "127.0.0.1"
	_address_field.placeholder_text = "host address"
	_address_field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_address_field)
	_port_field = LineEdit.new()
	_port_field.text = str(default_port)
	_port_field.custom_minimum_size = Vector2(90, 0)
	row.add_child(_port_field)
	_panel.add_child(row)

	_add_button("Host Match", func() -> void: _launch(NET_HOST))
	_add_button("Join Match", func() -> void: _launch(NET_CLIENT))

	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size = Vector2(420, 40)
	_panel.add_child(_status)
	set_status("Choose a mode.")


func _add_title(text: String) -> void:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", 30)
	_panel.add_child(label)


func _add_hint(text: String) -> void:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.modulate = Color(0.72, 0.77, 0.84)
	_panel.add_child(label)


func _add_button(text: String, action: Callable) -> void:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(0, 36)
	button.pressed.connect(action)
	_panel.add_child(button)


func _launch(net_mode: String) -> void:
	launch_requested.emit({
		"mode_id": selected_mode_id(),
		"net": net_mode,
		"address": _address_field.text.strip_edges(),
		"port": int(_port_field.text) if _port_field.text.is_valid_int() else 0,
	})
