extends Node2D
## Runs one level. Sets the Board up from the LevelData, keeps score, moves and goals,
## shows the start / win / lose popups, and turns Board signals into feedback (particles
## and screen shake). The Board never knows any of this exists.

enum Phase { INTRO, PLAYING, WON, LOST }

const SHAKE_BY_SPECIAL := {
	Gem.Special.STRIPED_H: 0.3,
	Gem.Special.STRIPED_V: 0.3,
	Gem.Special.WRAPPED: 0.45,
	Gem.Special.PRISM: 0.6,
}
## The board is centred inside this rectangle (viewport pixels), below the HUD.
const BOARD_AREA := Rect2(0, 330, 720, 760)
## Points for each unused move when the level is won.
const MOVE_BONUS := 50
## Points for destroying a prism, which has no GemType to read points from.
const PRISM_POINTS := 30

var _level: LevelData
var _phase: Phase = Phase.INTRO
var _score: int = 0
var _moves_left: int = 0
var _collected: Dictionary = {}  # GemType -> gems destroyed so far

@onready var _board: Board = $Board
@onready var _camera: ShakeCamera = $Camera
@onready var _effects: BurstEffects = $Effects
@onready var _hud: Hud = $UI_Layer/HUD
@onready var _popup: MessagePopup = $UI_Layer/Popup


func _ready() -> void:
	_level = GameState.get_level(GameState.current_level)
	_moves_left = _level.moves
	for goal in _level.collect_goals:
		_collected[goal.gem_type] = 0

	_board.gem_cleared.connect(_on_gem_cleared)
	_board.special_activated.connect(_on_special_activated)
	_board.wave_cleared.connect(_on_wave_cleared)
	_board.move_made.connect(_on_move_made)
	_board.board_settled.connect(_on_board_settled)
	_popup.primary_pressed.connect(_on_popup_primary)
	_popup.secondary_pressed.connect(GameState.go_to_level_select)
	_hud.quit_pressed.connect(GameState.go_to_level_select)

	_board.columns = _level.columns
	_board.rows = _level.rows
	_board.gem_types = _level.gem_types
	var board_size := Vector2(_level.columns, _level.rows) * _board.cell_size
	_board.position = (BOARD_AREA.position + (BOARD_AREA.size - board_size) / 2.0).round()
	_board.set_input_enabled(false)
	_board.start()

	_refresh_hud()
	var intro := "%s\n\nSwipe a gem, or tap two neighbours, to swap." % _goal_text()
	_popup.open("Level %d" % (GameState.current_level + 1), intro, "Play", "Back")


# --- Board events -------------------------------------------------------------------------


func _on_gem_cleared(gem_type: GemType, at: Vector2, cascade: int) -> void:
	_effects.burst(at, gem_type.color if gem_type else Gem.PRISM_COLOR)
	var points := gem_type.points if gem_type else PRISM_POINTS
	_score += points * (cascade + 1)
	if gem_type and _collected.has(gem_type):
		_collected[gem_type] += 1
	_refresh_hud()


func _on_special_activated(kind: Gem.Special, _at: Vector2) -> void:
	_camera.add_trauma(SHAKE_BY_SPECIAL.get(kind, 0.0))


func _on_wave_cleared(cascade: int, _gem_count: int) -> void:
	if cascade >= 2:
		_camera.add_trauma(0.1 * mini(cascade, 4))


func _on_move_made() -> void:
	_moves_left -= 1
	_refresh_hud()


## The turn (with all its cascades) is over: decide whether the level is won or lost.
func _on_board_settled() -> void:
	if _phase != Phase.PLAYING:
		return
	if _goals_met():
		_win()
	elif _moves_left <= 0:
		_lose()


# --- Level flow ---------------------------------------------------------------------------


func _on_popup_primary() -> void:
	match _phase:
		Phase.INTRO:
			_popup.close()
			_phase = Phase.PLAYING
			_board.set_input_enabled(true)
		Phase.WON:
			if GameState.has_next_level():
				GameState.play_level(GameState.current_level + 1)
			else:
				GameState.go_to_level_select()
		Phase.LOST:
			GameState.play_level(GameState.current_level)


func _win() -> void:
	_phase = Phase.WON
	_board.set_input_enabled(false)
	var bonus := _moves_left * MOVE_BONUS
	_score += bonus
	var stars := _level.stars_for(_score)
	GameState.record_win(GameState.current_level, _score, stars)
	_refresh_hud()
	var body := "Score %d\n(includes %d for moves left)\n\nStars: %d of 3" % [_score, bonus, stars]
	if GameState.has_next_level():
		_popup.open("Level complete!", body, "Next level", "Levels")
	else:
		_popup.open("You beat every level!", body, "Levels")


func _lose() -> void:
	_phase = Phase.LOST
	_board.set_input_enabled(false)
	_popup.open("Out of moves", "Score %d\n%s" % [_score, _goal_text()], "Retry", "Levels")


func _goals_met() -> bool:
	if _score < _level.star_scores[0]:
		return false
	for goal in _level.collect_goals:
		if _collected[goal.gem_type] < goal.amount:
			return false
	return true


func _goal_text() -> String:
	var parts := PackedStringArray(
		["Score %d/%d" % [mini(_score, _level.star_scores[0]), _level.star_scores[0]]]
	)
	for goal in _level.collect_goals:
		var done: int = mini(_collected[goal.gem_type], goal.amount)
		parts.append("%s %d/%d" % [goal.gem_type.display_name, done, goal.amount])
	return "   ".join(parts)


func _refresh_hud() -> void:
	_hud.set_level(GameState.current_level + 1)
	_hud.set_moves(_moves_left)
	_hud.set_score(_score, _level.stars_for(_score), _level.star_scores)
	_hud.set_goals(_goal_text())
