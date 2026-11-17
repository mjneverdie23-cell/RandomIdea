class_name HeartsBar
extends HBoxContainer
## A row of hearts (one per life, filled or spent) with the time until the next one.
## Reads MetaProgression and updates itself: when a heart is spent or regenerates, and once a
## second for the countdown. Drop it into any screen as an HBoxContainer with this script.

const HEART_SIZE := 44.0

var _hearts: Array[HeartIcon] = []
var _timer_label: Label
var _countdown: float = 0.0
var _shown_lives: int = -1


func _ready() -> void:
	alignment = BoxContainer.ALIGNMENT_CENTER
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_theme_constant_override("separation", 8)
	for _i in MetaProgression.MAX_LIVES:
		var heart := HeartIcon.new()
		heart.custom_minimum_size = Vector2.ONE * HEART_SIZE
		add_child(heart)
		_hearts.append(heart)
	_timer_label = Label.new()
	_timer_label.add_theme_font_size_override("font_size", 26)
	_timer_label.custom_minimum_size = Vector2(150, 0)
	add_child(_timer_label)
	MetaProgression.lives_changed.connect(_on_lives_changed)
	_refresh()


func _process(delta: float) -> void:
	_countdown -= delta
	if _countdown <= 0.0:
		_countdown = 1.0
		_refresh()


func _refresh() -> void:
	var lives := MetaProgression.get_lives()
	for i in _hearts.size():
		var filled := i < lives
		# Bounce only the hearts that changed since the bar was first shown.
		if _shown_lives != -1 and filled != (i < _shown_lives):
			_hearts[i].pop()
		_hearts[i].filled = filled
	_shown_lives = lives
	var wait := MetaProgression.seconds_to_next_life()
	if wait <= 0:
		_timer_label.text = "Full"
	else:
		_timer_label.text = (
			"+1 in %d:%02d:%02d" % [floori(wait / 3600.0), floori(wait / 60.0) % 60, wait % 60]
		)


func _on_lives_changed(_lives: int) -> void:
	_refresh()
