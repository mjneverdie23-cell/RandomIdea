extends TestSuite


func test_no_match() -> void:
	var groups := MatchFinder.find_matches(grid_from_text(["0120", "1201", "2012"]))
	check(groups.is_empty(), "a board without lines has no matches")


func test_line_of_three() -> void:
	var groups := MatchFinder.find_matches(grid_from_text(["000.", "1212"]))
	check_eq(groups.size(), 1, "one group")
	check_eq(groups[0].shape, MatchFinder.Shape.LINE_3, "shape")
	check_eq(groups[0].cells.size(), 3, "cell count")
	check(groups[0].horizontal, "horizontal")


func test_line_of_four_vertical() -> void:
	var groups := MatchFinder.find_matches(grid_from_text(["1.", "1.", "1.", "1."]))
	check_eq(groups.size(), 1, "one group")
	check_eq(groups[0].shape, MatchFinder.Shape.LINE_4, "shape")
	check(not groups[0].horizontal, "vertical")
	check_eq(groups[0].pivot, Vector2i(0, 2), "pivot is the middle cell")


func test_line_of_five() -> void:
	var groups := MatchFinder.find_matches(grid_from_text(["22222"]))
	check_eq(groups[0].shape, MatchFinder.Shape.LINE_5, "shape")
	check_eq(groups[0].pivot, Vector2i(2, 0), "pivot")


func test_l_t_and_plus_shapes() -> void:
	var l_shape := MatchFinder.find_matches(grid_from_text(["333", "3..", "3.."]))
	check_eq(l_shape.size(), 1, "L is one group")
	check_eq(l_shape[0].shape, MatchFinder.Shape.CROSS, "L shape")
	check_eq(l_shape[0].pivot, Vector2i(0, 0), "L pivot is the corner")
	check_eq(l_shape[0].cells.size(), 5, "L cells")
	var t_shape := MatchFinder.find_matches(grid_from_text(["444", ".4.", ".4."]))
	check_eq(t_shape[0].shape, MatchFinder.Shape.CROSS, "T shape")
	check_eq(t_shape[0].pivot, Vector2i(1, 0), "T pivot")
	var plus := MatchFinder.find_matches(grid_from_text([".5.", "555", ".5."]))
	check_eq(plus[0].pivot, Vector2i(1, 1), "plus pivot")


func test_separate_groups_and_empty_cells() -> void:
	var groups := MatchFinder.find_matches(
		grid_from_text(["000.111", ".......", "2......", "2......", "2......"])
	)
	check_eq(groups.size(), 3, "three separate groups")
	check(
		MatchFinder.find_matches(grid_from_text(["...", "..."])).is_empty(), "empty never matches"
	)
	check(MatchFinder.find_matches(grid_from_text(["00100"])).is_empty(), "broken run")
