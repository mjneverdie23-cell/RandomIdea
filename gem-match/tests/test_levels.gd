extends TestSuite
## Checks every level in the catalog is well-formed and that its board can start.

const BOARD_SCENE := preload("res://scenes/board/board.tscn")


func test_every_level_is_valid() -> void:
	var catalog := _catalog()
	check(catalog != null and not catalog.levels.is_empty(), "the catalog has levels")
	for i in catalog.levels.size():
		var level := catalog.levels[i]
		var label := "level %d" % (i + 1)
		check(level != null, label + " loads")
		if level == null:
			continue
		check(level.columns >= 3 and level.columns <= 8, label + ": columns 3-8")
		check(level.rows >= 3 and level.rows <= 9, label + ": rows 3-9")
		check(level.gem_types.size() >= 3 and not level.gem_types.has(null), label + ": gem types")
		check(level.moves > 0, label + ": moves")
		check_eq(level.star_scores.size(), 3, label + ": three star scores")
		for s in range(1, level.star_scores.size()):
			check(level.star_scores[s] > level.star_scores[s - 1], label + ": stars ascend")
		for goal in level.collect_goals:
			check(goal != null and goal.amount > 0, label + ": goal amount")
			check(level.gem_types.has(goal.gem_type), label + ": goal gem can spawn")


func test_every_level_board_starts() -> void:
	var catalog := _catalog()
	Engine.time_scale = 8.0
	for i in catalog.levels.size():
		var level := catalog.levels[i]
		seed(i)
		var board: Board = BOARD_SCENE.instantiate()
		board.columns = level.columns
		board.rows = level.rows
		board.gem_types = level.gem_types
		add_child(board)
		board.start()
		check(await wait_board_idle(board), "level %d board settles" % (i + 1))
		check_board_invariants(board, "level %d start" % (i + 1))
		board.queue_free()
	Engine.time_scale = 1.0


## Loaded at runtime rather than preloaded into a const (see GameState.CATALOG_PATH).
func _catalog() -> LevelCatalog:
	return load("res://levels/catalog.tres")
