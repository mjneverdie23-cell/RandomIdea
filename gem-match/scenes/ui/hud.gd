class_name Hud
extends Control
## In-level display: level number, moves left, score with star progress, and goals.
## The level controller sets the values; the HUD only shows them.

signal quit_pressed

var _toast_tween: Tween

@onready var _level_label: Label = $Top/LevelLabel
@onready var _moves_label: Label = $Top/Stats/MovesLabel
@onready var _score_label: Label = $Top/Stats/ScoreLabel
@onready var _score_bar: ProgressBar = $Top/ScoreBar
@onready var _goals_label: Label = $Top/GoalsLabel
@onready var _quit_button: Button = $QuitButton
@onready var _toast: Label = $Toast


func _ready() -> void:
	_quit_button.pressed.connect(quit_pressed.emit)


func set_level(number: int) -> void:
	_level_label.text = "Level %d" % number


func set_moves(moves_left: int) -> void:
	_moves_label.text = "Moves %d" % moves_left


## `star_scores` are the 1-, 2- and 3-star thresholds.
func set_score(score: int, stars: int, star_scores: PackedInt32Array) -> void:
	_score_label.text = "Score %d  %s" % [score, "*".repeat(stars)]
	_score_bar.max_value = star_scores[star_scores.size() - 1]
	_score_bar.value = score


func set_goals(text: String) -> void:
	_goals_label.text = text


## Briefly shows a message in the middle of the screen.
func show_toast(text: String) -> void:
	_toast.text = text
	if _toast_tween:
		_toast_tween.kill()
	_toast.modulate.a = 1.0
	_toast_tween = create_tween()
	_toast_tween.tween_interval(0.8)
	_toast_tween.tween_property(_toast, "modulate:a", 0.0, 0.4)
