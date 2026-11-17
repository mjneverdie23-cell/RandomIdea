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


func test_match_shapes_create_the_right_special() -> void:
	var cases := [
		[
			{
				Vector2i(0, 0): 4,
				Vector2i(1, 0): 4,
				Vector2i(2, 0): 5,
				Vector2i(3, 0): 4,
				Vector2i(2, 1): 4
			},
			Vector2i(2, 1),
			Vector2i(2, 0),
			Gem.Special.STRIPED_H
		],
		[
			{
				Vector2i(0, 0): 4,
				Vector2i(1, 0): 4,
				Vector2i(2, 0): 5,
				Vector2i(3, 0): 4,
				Vector2i(4, 0): 4,
				Vector2i(2, 1): 4
			},
			Vector2i(2, 1),
			Vector2i(2, 0),
			Gem.Special.PRISM
		],
		[
			{
				Vector2i(0, 2): 4,
				Vector2i(1, 2): 4,
				Vector2i(2, 2): 5,
				Vector2i(3, 2): 4,
				Vector2i(2, 3): 4,
				Vector2i(2, 4): 4
			},
			Vector2i(3, 2),
			Vector2i(2, 2),
			Gem.Special.WRAPPED
		],
	]
	Engine.time_scale = 8.0
	for case in cases:
		seed(4242)
		var board: Board = BOARD_SCENE.instantiate()
		add_child(board)
		check(await _wait_idle(board), "the starting board settles")
		_paint(board, case[0])
		var created := []
		board.special_created.connect(
			func(kind: Gem.Special, _at: Vector2) -> void: created.append(kind)
		)
		check(board._try_swap(case[1], case[2]), "the designed swap is accepted")
		await get_tree().process_frame
		check(await _wait_idle(board), "the turn settles")
		check(not created.is_empty() and created[0] == case[3], "made %s" % case[3])
		_check_invariants(board, "after special %s" % case[3])
		board.queue_free()
	Engine.time_scale = 1.0


func test_special_swaps() -> void:
	Engine.time_scale = 8.0
	# Two prisms swapped together clear the whole board in the first wave.
	seed(99)
	var board: Board = BOARD_SCENE.instantiate()
	add_child(board)
	check(await _wait_idle(board), "the starting board settles")
	board.get_gem(Vector2i(0, 0)).make_special(Gem.Special.PRISM)
	board.get_gem(Vector2i(1, 0)).make_special(Gem.Special.PRISM)
	var first_wave := [0]
	board.gem_cleared.connect(
		func(_t: GemType, _at: Vector2, cascade: int) -> void:
			if cascade == 0:
				first_wave[0] += 1
	)
	check(board._try_swap(Vector2i(0, 0), Vector2i(1, 0)), "prism swap is accepted")
	check(await _wait_idle(board), "prism turn settles")
	check_eq(first_wave[0], board.columns * board.rows, "every gem cleared")
	_check_invariants(board, "after prism + prism")
	board.queue_free()

	# A horizontal and a vertical striped gem swapped together clear a row and a column.
	seed(100)
	board = BOARD_SCENE.instantiate()
	add_child(board)
	check(await _wait_idle(board), "the starting board settles")
	board.get_gem(Vector2i(2, 3)).make_special(Gem.Special.STRIPED_H)
	board.get_gem(Vector2i(3, 3)).make_special(Gem.Special.STRIPED_V)
	var cleared := [0]
	board.gem_cleared.connect(
		func(_t: GemType, _at: Vector2, cascade: int) -> void:
			if cascade == 0:
				cleared[0] += 1
	)
	check(board._try_swap(Vector2i(2, 3), Vector2i(3, 3)), "striped swap is accepted")
	check(await _wait_idle(board), "striped turn settles")
	check(cleared[0] >= board.columns + board.rows - 1, "a row and a column cleared")
	_check_invariants(board, "after striped + striped")
	board.queue_free()
	Engine.time_scale = 1.0


## Repaints the board: overrides[cell] is a gem_types index; other cells use a pattern
## that never makes a match ((x + 2y) mod 4).
func _paint(board: Board, overrides: Dictionary) -> void:
	for x in board.columns:
		for y in board.rows:
			var cell := Vector2i(x, y)
			var id: int = overrides.get(cell, (x + 2 * y) % 4)
			board.get_gem(cell).setup(
				board.gem_types[id], cell, board.cell_size * board.gem_radius_ratio
			)


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
