## Shared shell for full-screen menus: a dimmed background and a centred panel
## with a title, a subtitle and a content area.
##
## Subclasses only fill `content` - restyling every menu at once means editing
## this one file.
class_name OverlayPanel
extends Control

var panel: PanelContainer
var title_label: Label
var subtitle_label: Label
var content: VBoxContainer
var footer: HBoxContainer

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false

	var dim := ColorRect.new()
	dim.color = Color(0.024, 0.031, 0.043, 0.86)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)

	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)

	panel = PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style())
	centre.add_child(panel)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 6)
	panel.add_child(column)

	title_label = Label.new()
	title_label.add_theme_font_size_override("font_size", 22)
	column.add_child(title_label)

	subtitle_label = Label.new()
	subtitle_label.add_theme_font_size_override("font_size", 12)
	subtitle_label.add_theme_color_override("font_color", Color("9aa6b2"))
	column.add_child(subtitle_label)

	content = VBoxContainer.new()
	content.add_theme_constant_override("separation", 8)
	content.custom_minimum_size = Vector2(720, 0)
	column.add_child(content)

	footer = HBoxContainer.new()
	footer.add_theme_constant_override("separation", 8)
	column.add_child(footer)

	build()

## Subclasses build their contents here.
func build() -> void:
	pass

## Subclasses refresh dynamic contents here,每 time the panel opens.
func refresh() -> void:
	pass

func open() -> void:
	refresh()
	visible = true

func close() -> void:
	visible = false

func toggle(force := -1) -> bool:
	var next := (not visible) if force < 0 else bool(force)
	if next:
		open()
	else:
		close()
	return next

func add_button(text: String, callback: Callable, primary: bool = false) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(150, 34)
	if primary:
		button.add_theme_color_override("font_color", Color("08210f"))
		var style := StyleBoxFlat.new()
		style.bg_color = Color("4cd07a")
		style.set_corner_radius_all(6)
		style.set_content_margin_all(8)
		button.add_theme_stylebox_override("normal", style)
	button.pressed.connect(callback)
	footer.add_child(button)
	return button

func _panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color("12151b")
	style.border_color = Color(1, 1, 1, 0.14)
	style.set_border_width_all(1)
	style.set_corner_radius_all(12)
	style.set_content_margin_all(20)
	return style
