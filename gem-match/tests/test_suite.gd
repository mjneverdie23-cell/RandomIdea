class_name TestSuite
extends Node
## Base class for test suites run by test_runner.gd. Methods named test_* are run in order;
## they may use `await`.

var failures: Array[String] = []


func check(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)


func check_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual != expected:
		failures.append("%s (expected %s, got %s)" % [message, str(expected), str(actual)])


## Waits until `condition` returns true, checking once per frame. Gives up after
## `max_seconds` of real time (headless runs have no frame cap, so frames are not a clock).
func wait_until(condition: Callable, max_seconds: float = 20.0) -> bool:
	var deadline := Time.get_ticks_msec() + int(max_seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await get_tree().process_frame
	return condition.call()


func wait_board_idle(board: Board) -> bool:
	return await wait_until(func() -> bool: return board.get_state() == Board.State.IDLE)


## First adjacent swap that does (want_match) or does not make a match.
func find_move(board: Board, want_match: bool) -> Array[Vector2i]:
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


func check_board_invariants(board: Board, when: String) -> void:
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


## Builds colors[x][y] from rows of text: "." is NO_COLOR, digits are colour ids.
static func grid_from_text(rows_text: Array[String]) -> Array:
	var colors: Array = []
	for x in rows_text[0].length():
		var column := PackedInt32Array()
		for row in rows_text:
			var ch := row[x]
			column.append(MatchFinder.NO_COLOR if ch == "." else ch.to_int())
		colors.append(column)
	return colors
