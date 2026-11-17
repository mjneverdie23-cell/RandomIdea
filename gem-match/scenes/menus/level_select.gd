extends Control
## Grid of level buttons. Locked levels are disabled; finished ones show their best stars.
## The hearts row at the top shows lives; a status line shows the weekly race rank. Each
## game costs a heart, so with none left every level button is disabled until one comes back.

var _buttons: Array[Button] = []
var _status_timer: float = 0.0

@onready var _status_label: Label = $Margin/Box/StatusLabel
@onready var _grid: GridContainer = $Margin/Box/Grid
@onready var _back_button: Button = $Margin/Box/BackButton


func _ready() -> void:
	_back_button.pressed.connect(GameState.go_to_main_menu)
	for index in GameState.level_count():
		var button := Button.new()
		button.custom_minimum_size = Vector2(140, 140)
		button.add_theme_font_size_override("font_size", 34)
		button.text = _button_text(index)
		button.pressed.connect(GameState.play_level.bind(index))
		_grid.add_child(button)
		_buttons.append(button)
	_refresh_status()


func _process(delta: float) -> void:
	_status_timer += delta
	if _status_timer >= 1.0:
		_status_timer = 0.0
		_refresh_status()


func _refresh_status() -> void:
	var lives := MetaProgression.get_lives()
	var text := "No hearts left: wait for the next one\n" if lives == 0 else ""
	text += (
		"Weekly race: #%d of %d (%d stars)"
		% [
			MetaProgression.get_race_rank(),
			MetaProgression.RACE_SIZE,
			MetaProgression.get_race_points(),
		]
	)
	_status_label.text = text
	for index in _buttons.size():
		_buttons[index].disabled = lives == 0 or not GameState.is_unlocked(index)


func _button_text(index: int) -> String:
	if not GameState.is_unlocked(index):
		return "%d\nlocked" % (index + 1)
	var stars := GameState.best_stars(index)
	return "%d\n%s" % [index + 1, "*".repeat(stars) if stars > 0 else "-"]
