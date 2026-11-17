extends Control
## Grid of level buttons. Locked levels are disabled; finished ones show their best stars.

@onready var _grid: GridContainer = $Margin/Box/Grid
@onready var _back_button: Button = $Margin/Box/BackButton


func _ready() -> void:
	_back_button.pressed.connect(GameState.go_to_main_menu)
	for index in GameState.level_count():
		var button := Button.new()
		button.custom_minimum_size = Vector2(140, 140)
		button.add_theme_font_size_override("font_size", 34)
		button.disabled = not GameState.is_unlocked(index)
		button.text = _button_text(index)
		button.pressed.connect(GameState.play_level.bind(index))
		_grid.add_child(button)


func _button_text(index: int) -> String:
	if not GameState.is_unlocked(index):
		return "%d\nlocked" % (index + 1)
	var stars := GameState.best_stars(index)
	return "%d\n%s" % [index + 1, "*".repeat(stars) if stars > 0 else "-"]
