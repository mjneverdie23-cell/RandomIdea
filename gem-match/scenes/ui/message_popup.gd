class_name MessagePopup
extends Control
## A centred panel with a title, a message and one or two buttons, over a dimmed screen.
## Used for level start, win and lose. While it is open it blocks clicks to the board.

signal primary_pressed
signal secondary_pressed

@onready var _panel: Control = $Center/Panel
@onready var _title: Label = $Center/Panel/Margin/Box/Title
@onready var _body: Label = $Center/Panel/Margin/Box/Body
@onready var _primary: Button = $Center/Panel/Margin/Box/Buttons/Primary
@onready var _secondary: Button = $Center/Panel/Margin/Box/Buttons/Secondary


func _ready() -> void:
	_primary.pressed.connect(primary_pressed.emit)
	_secondary.pressed.connect(secondary_pressed.emit)
	hide()


## Shows the popup. An empty `secondary_text` hides the second button.
func open(title: String, body: String, primary_text: String, secondary_text: String = "") -> void:
	_title.text = title
	_body.text = body
	_primary.text = primary_text
	_secondary.text = secondary_text
	_secondary.visible = not secondary_text.is_empty()
	show()
	modulate.a = 0.0
	create_tween().tween_property(self, "modulate:a", 1.0, 0.2)
	_primary.grab_focus.call_deferred()


func close() -> void:
	hide()
