extends Node2D
## Runs one level. Sets the Board up from the LevelData, keeps score, moves and goals,
## shows the start / revival / win / lose popups, and turns Board signals into feedback
## (particles, screen shake and sound). The Board never knows any of this exists.

enum Phase { INTRO, PLAYING, REVIVAL_OFFER, WON, LOST }

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
## Moves lost for a swap that makes no match.
const WRONG_MOVE_PENALTY := 1
## Moves granted by a revival (ad or purchase).
const REVIVAL_MOVES := 5
const REVIVAL_POPUP_SCENE := preload("res://scenes/ui/revival_popup.tscn")

var _level: LevelData
var _phase: Phase = Phase.INTRO
var _score: int = 0
var _moves_left: int = 0
var _collected: Dictionary = {}  # GemType -> gems destroyed so far
## One revival per attempt at the level. Retrying reloads the scene, which resets it.
var _has_revived: bool = false

@onready var _board: Board = $Board
@onready var _camera: ShakeCamera = $Camera
@onready var _effects: BurstEffects = $Effects
@onready var _ui_layer: CanvasLayer = $UI_Layer
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
	_board.swap_started.connect(AudioManager.play.bind(&"swap", 1.0))
	_board.swap_rejected.connect(_on_swap_rejected)
	_board.special_created.connect(_on_special_created)
	_board.shuffled.connect(_on_shuffled)
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
	var intro := (
		"%s\n\nSwipe a gem, or tap two neighbours, to swap.\nA swap with no match costs a move."
		% _goal_text()
	)
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
	AudioManager.play(&"special")


func _on_special_created(_kind: Gem.Special, _at: Vector2) -> void:
	AudioManager.play(&"create")


## Each chain reaction plays the match sound a little higher.
func _on_wave_cleared(cascade: int, _gem_count: int) -> void:
	AudioManager.play(&"match", 1.0 + 0.12 * mini(cascade, 6))
	if cascade >= 2:
		_camera.add_trauma(0.1 * mini(cascade, 4))
		_hud.show_toast("Combo x%d!" % (cascade + 1))


func _on_shuffled() -> void:
	AudioManager.play(&"shuffle")
	_hud.show_toast("No moves left - shuffling")


func _on_move_made() -> void:
	_moves_left -= 1
	_refresh_hud()


## A swap that makes no match slides back and still costs a move. If that was the last
## move, the board_settled that follows the slide-back runs the normal out-of-moves check.
func _on_swap_rejected() -> void:
	AudioManager.play(&"invalid")
	if _phase != Phase.PLAYING:
		return
	_moves_left = maxi(_moves_left - WRONG_MOVE_PENALTY, 0)
	_refresh_hud()
	_hud.show_toast("No match: -%d move" % WRONG_MOVE_PENALTY)


## The turn (with all its cascades) is over: decide whether the level is won or lost.
func _on_board_settled() -> void:
	if _phase != Phase.PLAYING:
		return
	if _goals_met():
		_win()
	elif _moves_left <= 0:
		_on_out_of_moves()


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
	AudioManager.play(&"win")
	var body := "Score %d\n(includes %d for moves left)\n\nStars: %d of 3" % [_score, bonus, stars]
	if GameState.has_next_level():
		_popup.open("Level complete!", body, "Next level", "Levels")
	else:
		_popup.open("You beat every level!", body, "Levels")


## Out of moves without winning. The first time, offer a revival; after that, game over.
func _on_out_of_moves() -> void:
	if _has_revived:
		_lose()
		return
	_phase = Phase.REVIVAL_OFFER
	_board.set_input_enabled(false)
	var revival: RevivalPopup = REVIVAL_POPUP_SCENE.instantiate()
	_ui_layer.add_child(revival)
	revival.revival_accepted.connect(_on_revival_accepted.bind(revival))
	revival.player_exited.connect(_on_revival_declined.bind(revival))
	revival.open(REVIVAL_MOVES)  # Pauses the game until the player decides.


## The popup has already unpaused the game.
func _on_revival_accepted(revival: RevivalPopup) -> void:
	revival.queue_free()
	_has_revived = true
	_moves_left += REVIVAL_MOVES
	_phase = Phase.PLAYING
	_board.set_input_enabled(true)
	_refresh_hud()
	_hud.show_toast("+%d moves!" % REVIVAL_MOVES)
	AudioManager.play(&"create")


## The player said no and waited out the lockout: show the real game-over popup.
func _on_revival_declined(revival: RevivalPopup) -> void:
	revival.queue_free()
	_lose()


func _lose() -> void:
	_phase = Phase.LOST
	_board.set_input_enabled(false)
	AudioManager.play(&"lose")
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
