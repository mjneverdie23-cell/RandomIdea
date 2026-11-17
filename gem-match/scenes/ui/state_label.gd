extends Label
## Phase 1 debug readout: shows the Board's current state so the state machine can be seen.

@export var board: Board


func _ready() -> void:
	if board == null:
		return
	board.state_changed.connect(_on_board_state_changed)
	_on_board_state_changed(board.get_state())


func _on_board_state_changed(new_state: Board.State) -> void:
	text = "State: %s" % Board.State.keys()[new_state]
