extends TestSuite
## Plays real turns on a Board (sped up) and checks the grid stays consistent.

const BOARD_SCENE := preload("res://scenes/board/board.tscn")


func test_turns_keep_the_board_consistent() -> void:
	seed(12345)
	Engine.time_scale = 8.0
	var board: Board = BOARD_SCENE.instantiate()
	add_child(board)
	board.start()
	var moves := [0]
	var cleared := [0]
	board.move_made.connect(func() -> void: moves[0] += 1)
	board.gem_cleared.connect(func(_t: GemType, _at: Vector2, _c: int) -> void: cleared[0] += 1)

	check(await wait_board_idle(board), "the starting board settles")
	check_board_invariants(board, "start")

	var turns := 0
	for i in 12:
		var move := find_move(board, true)
		if move.is_empty():
			break
		check(board._try_swap(move[0], move[1]), "a valid swap is accepted")
		check(await wait_board_idle(board), "turn %d settles" % i)
		check_board_invariants(board, "after turn %d" % i)
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
	board.start()
	check(await wait_board_idle(board), "the starting board settles")
	var move := find_move(board, false)
	check(not move.is_empty(), "found a swap that makes no match")
	if not move.is_empty():
		var before := board.get_color_grid()
		var rejected := [false]
		var settled := [false]
		board.swap_rejected.connect(func() -> void: rejected[0] = true)
		board.board_settled.connect(func() -> void: settled[0] = true)
		board._try_swap(move[0], move[1])
		check(board.get_state() == Board.State.SWAPPING, "input moves the board to SWAPPING")
		check(not board._try_swap(move[0], move[1]), "a second swap is refused while busy")
		check(await wait_board_idle(board), "the board settles")
		check(rejected[0], "swap_rejected was emitted")
		check(settled[0], "board_settled follows the slide-back")
		check_eq(board.get_color_grid(), before, "the board is unchanged")
		check_board_invariants(board, "after revert")
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
		board.start()
		check(await wait_board_idle(board), "the starting board settles")
		_paint(board, case[0])
		var created := []
		board.special_created.connect(
			func(kind: Gem.Special, _at: Vector2) -> void: created.append(kind)
		)
		check(board._try_swap(case[1], case[2]), "the designed swap is accepted")
		await get_tree().process_frame
		check(await wait_board_idle(board), "the turn settles")
		check(not created.is_empty() and created[0] == case[3], "made %s" % case[3])
		check_board_invariants(board, "after special %s" % case[3])
		board.queue_free()
	Engine.time_scale = 1.0


func test_special_swaps() -> void:
	Engine.time_scale = 8.0
	# Two prisms swapped together clear the whole board in the first wave.
	seed(99)
	var board: Board = BOARD_SCENE.instantiate()
	add_child(board)
	board.start()
	check(await wait_board_idle(board), "the starting board settles")
	board.get_gem(Vector2i(0, 0)).make_special(Gem.Special.PRISM)
	board.get_gem(Vector2i(1, 0)).make_special(Gem.Special.PRISM)
	var first_wave := [0]
	board.gem_cleared.connect(
		func(_t: GemType, _at: Vector2, cascade: int) -> void:
			if cascade == 0:
				first_wave[0] += 1
	)
	check(board._try_swap(Vector2i(0, 0), Vector2i(1, 0)), "prism swap is accepted")
	check(await wait_board_idle(board), "prism turn settles")
	check_eq(first_wave[0], board.columns * board.rows, "every gem cleared")
	check_board_invariants(board, "after prism + prism")
	board.queue_free()

	# A horizontal and a vertical striped gem swapped together clear a row and a column.
	seed(100)
	board = BOARD_SCENE.instantiate()
	add_child(board)
	board.start()
	check(await wait_board_idle(board), "the starting board settles")
	board.get_gem(Vector2i(2, 3)).make_special(Gem.Special.STRIPED_H)
	board.get_gem(Vector2i(3, 3)).make_special(Gem.Special.STRIPED_V)
	var cleared := [0]
	board.gem_cleared.connect(
		func(_t: GemType, _at: Vector2, cascade: int) -> void:
			if cascade == 0:
				cleared[0] += 1
	)
	check(board._try_swap(Vector2i(2, 3), Vector2i(3, 3)), "striped swap is accepted")
	check(await wait_board_idle(board), "striped turn settles")
	check(cleared[0] >= board.columns + board.rows - 1, "a row and a column cleared")
	check_board_invariants(board, "after striped + striped")
	board.queue_free()
	Engine.time_scale = 1.0


func test_board_with_no_moves_shuffles() -> void:
	seed(5)
	Engine.time_scale = 8.0
	var board: Board = BOARD_SCENE.instantiate()
	add_child(board)
	board.start()
	check(await wait_board_idle(board), "the starting board settles")
	var stuck := {}
	for x in board.columns:
		for y in board.rows:
			stuck[Vector2i(x, y)] = (x % 2) + 2 * (y % 2)
	_paint(board, stuck)
	check(board._find_possible_move().is_empty(), "the painted board is stuck")
	var shuffled := [false]
	board.shuffled.connect(func() -> void: shuffled[0] = true)
	# Re-run the end-of-cascade check, as if a turn had just finished on this board.
	board._state = Board.State.MATCHING
	board._resolve_matches(false)
	check_eq(board.get_state(), Board.State.SHUFFLING, "a stuck board starts shuffling")
	check(await wait_board_idle(board), "the shuffle settles")
	check(shuffled[0], "shuffled was emitted")
	check(not board._find_possible_move().is_empty(), "the shuffled board has a move")
	check_board_invariants(board, "after shuffle")
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
