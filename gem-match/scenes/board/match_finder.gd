class_name MatchFinder
extends RefCounted
## Match-detection logic with no nodes involved, so it can be unit-tested directly.
## Everything works on a grid of colour ids: colors[x][y] is the colour of the gem in that
## cell, or NO_COLOR for an empty cell or a gem that never matches by colour.

enum Shape { LINE_3, LINE_4, LINE_5, CROSS }

const NO_COLOR := -1
const MIN_RUN := 3


## A straight line of 3 or more same-coloured cells.
class Run:
	var cells: Array[Vector2i] = []
	var horizontal: bool = true


## One connected set of matched cells: a single run, or runs that cross each other
## (L, T and + shapes).
class MatchGroup:
	var cells: Array[Vector2i] = []
	var color: int = NO_COLOR
	var shape: Shape = Shape.LINE_3
	## Where a special gem made by this match should appear (used from Phase 3).
	var pivot: Vector2i = Vector2i.ZERO
	## True if the longest run in the group is horizontal.
	var horizontal: bool = true


## Every match on the board, as connected groups.
static func find_matches(colors: Array) -> Array[MatchGroup]:
	var columns := colors.size()
	var rows: int = colors[0].size() if columns > 0 else 0
	var runs: Array[Run] = []
	for y in rows:
		var x := 0
		while x < columns:
			var end := x + 1
			while end < columns and colors[end][y] == colors[x][y]:
				end += 1
			if colors[x][y] != NO_COLOR and end - x >= MIN_RUN:
				runs.append(_make_run(Vector2i(x, y), Vector2i.RIGHT, end - x))
			x = end
	for x in columns:
		var y := 0
		while y < rows:
			var end := y + 1
			while end < rows and colors[x][end] == colors[x][y]:
				end += 1
			if colors[x][y] != NO_COLOR and end - y >= MIN_RUN:
				runs.append(_make_run(Vector2i(x, y), Vector2i.DOWN, end - y))
			y = end
	return _group_runs(runs, colors)


static func _make_run(start: Vector2i, step: Vector2i, length: int) -> Run:
	var run := Run.new()
	run.horizontal = step == Vector2i.RIGHT
	for i in length:
		run.cells.append(start + step * i)
	return run


## Joins runs that share a cell (union-find), then builds one MatchGroup per joined set.
static func _group_runs(runs: Array[Run], colors: Array) -> Array[MatchGroup]:
	var parent: Array = range(runs.size())
	var first_run_at := {}
	for i in runs.size():
		for cell in runs[i].cells:
			if first_run_at.has(cell):
				parent[_root(parent, i)] = _root(parent, first_run_at[cell])
			else:
				first_run_at[cell] = i
	var runs_by_root := {}
	for i in runs.size():
		var root := _root(parent, i)
		if not runs_by_root.has(root):
			runs_by_root[root] = []
		runs_by_root[root].append(runs[i])
	var groups: Array[MatchGroup] = []
	for root: int in runs_by_root:
		groups.append(_build_group(runs_by_root[root], colors))
	return groups


static func _root(parent: Array, i: int) -> int:
	while parent[i] != i:
		parent[i] = parent[parent[i]]
		i = parent[i]
	return i


static func _build_group(group_runs: Array, colors: Array) -> MatchGroup:
	var group := MatchGroup.new()
	var longest: Run = group_runs[0]
	var horizontal_cells := {}
	var has_vertical := false
	var seen := {}
	for run: Run in group_runs:
		if run.cells.size() > longest.cells.size():
			longest = run
		if run.horizontal:
			for cell in run.cells:
				horizontal_cells[cell] = true
		else:
			has_vertical = true
		for cell in run.cells:
			if not seen.has(cell):
				seen[cell] = true
				group.cells.append(cell)

	var first := longest.cells[0]
	group.color = colors[first.x][first.y]
	group.horizontal = longest.horizontal
	group.pivot = longest.cells[int(longest.cells.size() / 2.0)]
	if longest.cells.size() >= 5:
		group.shape = Shape.LINE_5
	elif has_vertical and not horizontal_cells.is_empty():
		group.shape = Shape.CROSS
		for run: Run in group_runs:
			if run.horizontal:
				continue
			for cell in run.cells:
				if horizontal_cells.has(cell):
					group.pivot = cell
	elif longest.cells.size() == 4:
		group.shape = Shape.LINE_4
	return group
