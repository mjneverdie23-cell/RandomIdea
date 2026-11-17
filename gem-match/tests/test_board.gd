extends TestSuite
## Plays real turns on a Board (sped up) and checks the grid stays consistent.

const BOARD_SCENE := preload("res://scenes/board/board.tscn")


func test_turns_keep_the_board_consistent() -> void:
	seed(12345)
	Engine.time_scale = 8.0
	var board: Board = BOARD_SCENE.instantiate()
	add_child(board)
	var moves := [0]
	var cleared := [0]
	board.move_made.connect(func() -> void: moves[0] += 1)
	board.gem_cleared.connect(func(_t: GemType, _at: Vector2, _c: int) -> void: cleared[0] += 1)

	check(await _wait_idle(board), "the starting board settles")
	_check_invariants(board, "start")

	var turns := 0
	for i in 12:
		var move := _find_move(board, true)
		if move.is_empty():
			break
		check(board._try_swap(move[0], move[1]), "a valid swap is accepted")
		check(await _wait_idle(board), "turn %d settles" % i)
		_check_invariants(board, "after turn %d" % i)
		turns += 1
	check(turns > 0, "at least one turn was played")
	check_eq(moves[0], turns, "move_made once per valid swap")
	check(cleared[0] >= turns * 3, "each turn clears at least 3 gems")

	board.queue_free()
	Engine.time_scale = 1.0


func test_swap_without_match_slides_back() -> void:
	seed(777)
	Engine.time_scale = 8.0
	var board: Board = BOARD_SCENE.instantiate()
	add_child(board)
	check(await _wait_idle(board), "the starting board settles")
	var move := _find_move(board, false)
	check(not move.is_empty(), "found a swap that makes no match")
	if not move.is_empty():
		var before := board.get_color_grid()
		var rejected := [false]
		board.swap_rejected.connect(func() -> void: rejected[0] = true)
		board._try_swap(move[0], move[1])
		check(board.get_state() == Board.State.SWAPPING, "input moves the board to SWAPPING")
		check(not board._try_swap(move[0], move[1]), "a second swap is refused while busy")
		check(await _wait_idle(board), "the board settles")
		check(rejected[0], "swap_rejected was emitted")
		check_eq(board.get_color_grid(), before, "the board is unchanged")
		_check_invariants(board, "after revert")
	board.queue_free()
	Engine.time_scale = 1.0


func _wait_idle(board: Board) -> bool:
	return await wait_until(func() -> bool: return board.get_state() == Board.State.IDLE)


## First adjacent swap that does (want_match) or does not make a match.
func _find_move(board: Board, want_match: bool) -> Array[Vector2i]:
	var colors := board.get_color_grid()
	for x in board.columns:
		for y in board.rows:
			for dir: Vector2i in [Vector2i.RIGHT, Vector2i.DOWN]:
				var a := Vector2i(x, y)
				var b := a + dir
				if not board.is_in_bounds(b):
					continue
				var swapped := colors.duplicate(true)
				swapped[a.x][a.y] = colors[b.x][b.y]
				swapped[b.x][b.y] = colors[a.x][a.y]
				if MatchFinder.find_matches(swapped).is_empty() != want_match:
					return [a, b]
	return []


func _check_invariants(board: Board, when: String) -> void:
	var active: Node = board.get_node("ActiveGems")
	check_eq(active.get_child_count(), board.columns * board.rows, when + ": active gem count")
	var seen := {}
	for x in board.columns:
		for y in board.rows:
			var cell := Vector2i(x, y)
			var gem := board.get_gem(cell)
			if gem == null:
				failures.append("%s: empty cell %s" % [when, cell])
				continue
			check(not seen.has(gem), "%s: gem in two cells" % when)
			seen[gem] = true
			check_eq(gem.grid_pos, cell, when + ": grid_pos")
			check(gem.position.distance_to(board.grid_to_local(cell)) < 0.5, when + ": position")
			check(gem.visible and gem.get_parent() == active, when + ": gem is active")
	check(MatchFinder.find_matches(board.get_color_grid()).is_empty(), when + ": no matches left")
