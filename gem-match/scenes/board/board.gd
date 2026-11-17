class_name Board
extends Node2D
## Owns the grid (a 2D array of Gem references), the turn state machine and player input.
##
## Coordinates: cell (0, 0) is the top-left cell. x is the column, y is the row, and y grows
## downwards, so gravity pulls towards larger y. The Board's own origin is the top-left
## corner of the grid.
##
## Turn flow:
##   IDLE -> SWAPPING -> MATCHING -> FALLING -> REFILLING -> MATCHING -> ... -> IDLE
## A swap that makes no match goes MATCHING -> SWAPPING (slide back) -> IDLE.
##
## Animation barrier: before the Board starts a gem animation it adds 1 to
## _pending_animations. Each gem signals when that animation ends. When the count reaches 0,
## _on_all_animations_finished() moves the state machine on to its next step.

signal state_changed(new_state: State)
## start() built a new grid. Background art should redraw to the new size and position.
signal layout_changed
## A swap made a match, so it counts as a move.
signal move_made
## A swap made no match and is sliding back.
signal swap_rejected
## One gem is being destroyed. `at` is its global position. `cascade` is 0 for the gems the
## player's swap matched, 1 for the first chain reaction, and so on.
signal gem_cleared(gem_type: GemType, at: Vector2, cascade: int)
## A wave of gems is being destroyed: once for the swap's matches, then once per cascade.
signal wave_cleared(cascade: int, gem_count: int)
## A match made a special gem.
signal special_created(kind: Gem.Special, at: Vector2)
## A special gem went off.
signal special_activated(kind: Gem.Special, at: Vector2)
## The board has stopped moving and is waiting for the player again.
signal board_settled

enum State { IDLE, SWAPPING, MATCHING, FALLING, REFILLING }

## Every legal state change. Any other change is a bug, so it is refused and logged.
const TRANSITIONS := {
	State.IDLE: [State.SWAPPING],
	State.SWAPPING: [State.MATCHING, State.IDLE],
	State.MATCHING: [State.FALLING, State.SWAPPING, State.IDLE],
	State.FALLING: [State.REFILLING],
	State.REFILLING: [State.MATCHING],
}
const NO_CELL := Vector2i(-1, -1)
## Prism target meaning "every gem on the board" (two prisms swapped together).
const ALL_COLORS := -2

@export_group("Grid")
@export_range(3, 12) var columns: int = 8
@export_range(3, 12) var rows: int = 8
@export var cell_size: float = 80.0
## Gem radius as a fraction of the cell size (0.5 would make neighbours touch).
@export_range(0.2, 0.5) var gem_radius_ratio: float = 0.42

@export_group("Gems")
## The gem types that can spawn. At least 3 are needed.
@export var gem_types: Array[GemType] = []

@export_group("Input")
## How far, in pixels, the pointer must move after a press before it counts as a swipe.
@export var swipe_threshold: float = 28.0

@export_group("Animation")
@export var swap_duration: float = 0.22
@export var spawn_duration: float = 0.35
## Extra delay per diagonal step, so the starting board pops in as a wave.
@export var spawn_stagger: float = 0.025
@export var clear_duration: float = 0.25
@export var fall_duration: float = 0.22
@export var fall_duration_per_cell: float = 0.04
## Extra destroy delay per cell of distance from a special gem, so its blast ripples outwards.
@export var blast_ripple_delay: float = 0.035

var _state: State = State.REFILLING
## _grid[x][y] holds a Gem, or null for an empty cell.
var _grid: Array = []
var _pending_animations: int = 0
## Chain-reaction depth of the current turn (see gem_cleared).
var _cascade: int = 0
## Gems playing their destroy animation. They go back to the pool when it ends.
var _clearing: Array[Gem] = []
## Prism gem -> the colour id it clears (or ALL_COLORS), for prisms swapped this turn.
var _prism_targets: Dictionary = {}

var _input_enabled: bool = true
var _selected: Gem = null
var _dragging: bool = false
var _press_cell: Vector2i = NO_CELL
var _press_position: Vector2 = Vector2.ZERO
var _press_was_on_selected: bool = false

var _swap_from: Vector2i = NO_CELL
var _swap_to: Vector2i = NO_CELL
var _swap_is_revert: bool = false

@onready var _pool: GemPool = $GemPool
@onready var _active_gems: Node2D = $ActiveGems


## Builds and pops in a new board from the current columns, rows and gem_types. Call once,
## after setting those (a level reloads the whole scene to restart).
func start() -> void:
	if not _is_config_valid():
		set_process_unhandled_input(false)
		return
	_pool.prewarm(columns * rows + columns * 2)
	_build_grid()
	layout_changed.emit()


func _notification(what: int) -> void:
	# A release that happens while the window is unfocused never arrives, so drop the drag.
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		_dragging = false


func _unhandled_input(event: InputEvent) -> void:
	var mouse_event := event as InputEventMouse
	if mouse_event == null:
		return
	var local_pos: Vector2 = (make_input_local(mouse_event) as InputEventMouse).position
	var button := mouse_event as InputEventMouseButton
	if button != null:
		if button.button_index == MOUSE_BUTTON_LEFT:
			if button.pressed:
				_on_pointer_pressed(local_pos)
			else:
				_on_pointer_released()
		elif button.button_index == MOUSE_BUTTON_RIGHT and button.pressed:
			_clear_selection()
	elif mouse_event is InputEventMouseMotion and _dragging:
		_on_pointer_dragged(local_pos)


# --- Public helpers -----------------------------------------------------------------------


func get_state() -> State:
	return _state


## While disabled the board ignores the player (popups, game over). It still finishes any
## turn that is already playing out.
func set_input_enabled(enabled: bool) -> void:
	_input_enabled = enabled
	_dragging = false
	if not enabled:
		_clear_selection()


func get_gem(cell: Vector2i) -> Gem:
	if not is_in_bounds(cell):
		return null
	return _grid[cell.x][cell.y]


func is_in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.x < columns and cell.y >= 0 and cell.y < rows


## Centre of a cell, in the Board's local space.
func grid_to_local(cell: Vector2i) -> Vector2:
	return (Vector2(cell) + Vector2(0.5, 0.5)) * cell_size


## The cell under a point in the Board's local space. It may be out of bounds.
func local_to_grid(local_pos: Vector2) -> Vector2i:
	return Vector2i((local_pos / cell_size).floor())


## The board as colour ids for MatchFinder: colors[x][y] is an index into gem_types, or
## MatchFinder.NO_COLOR for an empty cell.
func get_color_grid() -> Array:
	var colors: Array = []
	colors.resize(columns)
	for x in columns:
		var column := PackedInt32Array()
		column.resize(rows)
		for y in rows:
			column[y] = _color_of(_grid[x][y])
		colors[x] = column
	return colors


# --- State machine ------------------------------------------------------------------------


func _change_state(new_state: State) -> void:
	if new_state not in TRANSITIONS[_state]:
		push_error(
			"Board: illegal state change %s -> %s" % [State.keys()[_state], State.keys()[new_state]]
		)
		return
	_state = new_state
	state_changed.emit(new_state)


## Runs once every animation started in the current state has ended.
func _on_all_animations_finished() -> void:
	match _state:
		State.SWAPPING:
			_on_swap_finished()
		State.MATCHING:
			_on_clear_finished()
		State.FALLING:
			_on_fall_finished()
		State.REFILLING:
			_on_refill_finished()


## Call after starting a batch of animations. If the batch turned out to be empty, nothing
## would ever signal the barrier, so move on straight away.
func _wait_for_animations() -> void:
	if _pending_animations == 0:
		_on_all_animations_finished.call_deferred()


func _on_swap_finished() -> void:
	get_gem(_swap_from).z_index = 0
	get_gem(_swap_to).z_index = 0
	if _swap_is_revert:
		_swap_is_revert = false
		_change_state(State.IDLE)
		return
	_change_state(State.MATCHING)
	_cascade = 0
	_resolve_matches(true)


func _on_clear_finished() -> void:
	for gem in _clearing:
		_pool.release(gem)
	_clearing.clear()
	_prism_targets.clear()
	_change_state(State.FALLING)
	_apply_gravity()


func _on_fall_finished() -> void:
	_change_state(State.REFILLING)
	_refill()


func _on_refill_finished() -> void:
	_change_state(State.MATCHING)
	_cascade += 1
	_resolve_matches(false)


## Looks for matches. `is_swap_check` is true right after the player's swap: then "no match"
## means the swap is undone. Otherwise "no match" means the cascade is over.
func _resolve_matches(is_swap_check: bool) -> void:
	var groups := MatchFinder.find_matches(get_color_grid())
	var triggered: Array[Gem] = []
	if is_swap_check:
		triggered = _swap_triggers()
	if groups.is_empty() and triggered.is_empty():
		if is_swap_check:
			_revert_swap()
		else:
			_settle()
		return
	if is_swap_check:
		move_made.emit()
	_clear_wave(groups, triggered)


func _settle() -> void:
	_change_state(State.IDLE)
	board_settled.emit()


# --- Matching, gravity and refill -----------------------------------------------------------


## Specials that the swap itself sets off, even without a colour match:
## a prism swapped with anything, or two specials swapped together.
func _swap_triggers() -> Array[Gem]:
	var moved := get_gem(_swap_to)
	var other := get_gem(_swap_from)
	var triggered: Array[Gem] = []
	if moved.special == Gem.Special.PRISM and other.special == Gem.Special.PRISM:
		_prism_targets[moved] = ALL_COLORS
		_prism_targets[other] = ALL_COLORS
		triggered.assign([moved, other])
	elif moved.special == Gem.Special.PRISM or other.special == Gem.Special.PRISM:
		var prism := moved if moved.special == Gem.Special.PRISM else other
		var partner := other if prism == moved else moved
		_prism_targets[prism] = _color_of(partner)
		triggered.append(prism)
		if partner.special != Gem.Special.NONE:
			triggered.append(partner)
	elif moved.special != Gem.Special.NONE and other.special != Gem.Special.NONE:
		triggered.assign([moved, other])
	return triggered


## Destroys one wave of gems (MATCHING state): the matched groups, the specials the swap set
## off, and everything those specials hit, including chain reactions. Matches of 4+ leave a
## new special gem behind instead of clearing one of their cells.
func _clear_wave(groups: Array[MatchFinder.MatchGroup], triggered: Array[Gem]) -> void:
	var delays := {}  # Vector2i -> destroy delay in seconds
	var keep := {}  # Vector2i -> Gem.Special created there this wave
	for group in groups:
		var kind := _special_for(group)
		if kind != Gem.Special.NONE:
			var cell := _creation_cell(group)
			if cell != NO_CELL:
				keep[cell] = kind
		for cell in group.cells:
			if not keep.has(cell):
				delays[cell] = 0.0

	var queue: Array[Gem] = []
	queue.append_array(triggered)
	for gem in triggered:
		delays[gem.grid_pos] = 0.0
	for cell: Vector2i in delays:
		var gem := get_gem(cell)
		if gem and gem.special != Gem.Special.NONE and not queue.has(gem):
			queue.append(gem)
	var activated := {}
	while not queue.is_empty():
		var source: Gem = queue.pop_front()
		if activated.has(source):
			continue
		activated[source] = true
		special_activated.emit(source.special, source.global_position)
		var start: float = delays.get(source.grid_pos, 0.0)
		for cell in _special_area(source):
			if keep.has(cell):
				continue
			var delay := start + blast_ripple_delay * Vector2(cell - source.grid_pos).length()
			if not delays.has(cell) or delays[cell] > delay:
				delays[cell] = delay
			var hit := get_gem(cell)
			if hit and hit.special != Gem.Special.NONE and not activated.has(hit):
				queue.append(hit)

	for cell: Vector2i in keep:
		var gem := get_gem(cell)
		gem.make_special(keep[cell])
		special_created.emit(keep[cell], gem.global_position)
	for cell: Vector2i in delays:
		var gem := get_gem(cell)
		if gem == null:
			continue
		_grid[cell.x][cell.y] = null
		_clearing.append(gem)
		gem_cleared.emit(gem.gem_type, gem.global_position, _cascade)
		_pending_animations += 1
		gem.play_clear(clear_duration, delays[cell])
	wave_cleared.emit(_cascade, delays.size())
	_wait_for_animations()


static func _special_for(group: MatchFinder.MatchGroup) -> Gem.Special:
	match group.shape:
		MatchFinder.Shape.LINE_4:
			return Gem.Special.STRIPED_H if group.horizontal else Gem.Special.STRIPED_V
		MatchFinder.Shape.CROSS:
			return Gem.Special.WRAPPED
		MatchFinder.Shape.LINE_5:
			return Gem.Special.PRISM
	return Gem.Special.NONE


## Where a match's new special gem appears: on the swapped gem if it is part of the match,
## otherwise on the group's pivot. Only a plain gem can become special. NO_CELL if none can.
func _creation_cell(group: MatchFinder.MatchGroup) -> Vector2i:
	var candidates: Array[Vector2i] = []
	if _cascade == 0:
		candidates.assign([_swap_to, _swap_from])
	candidates.append(group.pivot)
	candidates.append_array(group.cells)
	for cell in candidates:
		var gem := get_gem(cell)
		if group.cells.has(cell) and gem.special == Gem.Special.NONE:
			return cell
	return NO_CELL


## The cells a special gem destroys when it goes off (its own cell included).
func _special_area(source: Gem) -> Array[Vector2i]:
	var origin := source.grid_pos
	var cells: Array[Vector2i] = []
	match source.special:
		Gem.Special.STRIPED_H:
			for x in columns:
				cells.append(Vector2i(x, origin.y))
		Gem.Special.STRIPED_V:
			for y in rows:
				cells.append(Vector2i(origin.x, y))
		Gem.Special.WRAPPED:
			for dx in range(-1, 2):
				for dy in range(-1, 2):
					var cell := origin + Vector2i(dx, dy)
					if is_in_bounds(cell):
						cells.append(cell)
		Gem.Special.PRISM:
			var target: int = _prism_targets.get(source, _most_common_color())
			cells.append(origin)
			for x in columns:
				for y in rows:
					var cell := Vector2i(x, y)
					if target == ALL_COLORS or _color_of(get_gem(cell)) == target:
						cells.append(cell)
	return cells


## Used when a prism is set off by another special instead of being swapped.
func _most_common_color() -> int:
	var counts := {}
	var best := MatchFinder.NO_COLOR
	for x in columns:
		for y in rows:
			var color := _color_of(_grid[x][y])
			if color == MatchFinder.NO_COLOR:
				continue
			counts[color] = counts.get(color, 0) + 1
			if best == MatchFinder.NO_COLOR or counts[color] > counts[best]:
				best = color
	return best


## Drops every gem as far down its column as it can go (FALLING state).
func _apply_gravity() -> void:
	for x in columns:
		var landing_y := rows - 1
		for y in range(rows - 1, -1, -1):
			var gem: Gem = _grid[x][y]
			if gem == null:
				continue
			if y != landing_y:
				_grid[x][y] = null
				var landing := Vector2i(x, landing_y)
				_set_cell(landing, gem)
				_move_gem(
					gem, grid_to_local(landing), _fall_time(landing_y - y), Tween.TRANS_BOUNCE
				)
			landing_y -= 1
	_wait_for_animations()


## Fills the empty cells at the top of each column with new gems that drop in from above
## the board (REFILLING state). The TopMask node hides them until they reach the grid.
func _refill() -> void:
	for x in columns:
		var empty := 0
		while empty < rows and _grid[x][empty] == null:
			empty += 1
		for y in empty:
			var cell := Vector2i(x, y)
			var gem := _spawn_gem(gem_types.pick_random(), cell)
			gem.position = grid_to_local(Vector2i(x, y - empty))
			_move_gem(gem, grid_to_local(cell), _fall_time(empty), Tween.TRANS_BOUNCE)
	_wait_for_animations()


func _fall_time(cells: int) -> float:
	return fall_duration + fall_duration_per_cell * cells


# --- Grid construction --------------------------------------------------------------------


func _is_config_valid() -> bool:
	if gem_types.size() < 3:
		push_error("Board needs at least 3 GemTypes in gem_types (has %d)." % gem_types.size())
		return false
	if gem_types.has(null):
		push_error("Board.gem_types has an empty slot.")
		return false
	return true


func _build_grid() -> void:
	_grid.clear()
	_grid.resize(columns)
	for x in columns:
		var column: Array = []
		column.resize(rows)
		_grid[x] = column

	# Fill row by row, top to bottom, so the left and upper neighbours already exist when
	# _pick_spawn_type() checks them.
	for y in rows:
		for x in columns:
			var cell := Vector2i(x, y)
			var gem := _spawn_gem(_pick_spawn_type(cell), cell)
			gem.position = grid_to_local(cell)
			_pending_animations += 1
			gem.play_spawn(spawn_duration, (x + y) * spawn_stagger)
	_wait_for_animations()


## A random type that does not make a line of 3 with the two gems to the left or the two
## gems above. This keeps the starting board free of matches.
func _pick_spawn_type(cell: Vector2i) -> GemType:
	var candidates: Array[GemType] = []
	candidates.assign(gem_types)
	var left := _type_at(cell + Vector2i.LEFT)
	if left != null and left == _type_at(cell + Vector2i.LEFT * 2):
		candidates.erase(left)
	var up := _type_at(cell + Vector2i.UP)
	if up != null and up == _type_at(cell + Vector2i.UP * 2):
		candidates.erase(up)
	return candidates.pick_random()


func _type_at(cell: Vector2i) -> GemType:
	var gem := get_gem(cell)
	return gem.gem_type if gem else null


func _color_of(gem: Gem) -> int:
	if gem == null or gem.gem_type == null:
		return MatchFinder.NO_COLOR
	return gem_types.find(gem.gem_type)


func _spawn_gem(gem_type: GemType, cell: Vector2i) -> Gem:
	var gem := _pool.acquire(_active_gems)
	if not gem.move_finished.is_connected(_on_gem_animation_finished):
		gem.move_finished.connect(_on_gem_animation_finished)
		gem.spawn_finished.connect(_on_gem_animation_finished)
		gem.clear_finished.connect(_on_gem_animation_finished)
	gem.setup(gem_type, cell, cell_size * gem_radius_ratio)
	_set_cell(cell, gem)
	return gem


func _set_cell(cell: Vector2i, gem: Gem) -> void:
	_grid[cell.x][cell.y] = gem
	if gem:
		gem.grid_pos = cell


# --- Input --------------------------------------------------------------------------------


func _on_pointer_pressed(local_pos: Vector2) -> void:
	if _state != State.IDLE or not _input_enabled:
		return
	var cell := local_to_grid(local_pos)
	var gem := get_gem(cell)
	if gem == null:
		_clear_selection()
		return
	# Tap-tap: a gem is already selected and the player taps one of its neighbours.
	if _selected != null and _selected != gem and _are_adjacent(_selected.grid_pos, cell):
		_try_swap(_selected.grid_pos, cell)
		return
	_press_was_on_selected = gem == _selected
	_select(gem)
	_dragging = true
	_press_cell = cell
	_press_position = local_pos


func _on_pointer_dragged(local_pos: Vector2) -> void:
	if _state != State.IDLE:
		_dragging = false
		return
	var delta := local_pos - _press_position
	if delta.length() < swipe_threshold:
		return
	_dragging = false
	var direction := Vector2i.RIGHT if delta.x > 0.0 else Vector2i.LEFT
	if absf(delta.y) > absf(delta.x):
		direction = Vector2i.DOWN if delta.y > 0.0 else Vector2i.UP
	if not _try_swap(_press_cell, _press_cell + direction):
		_clear_selection()


func _on_pointer_released() -> void:
	# Tapping the gem that is already selected (without swiping) deselects it.
	if _dragging and _press_was_on_selected:
		_clear_selection()
	_dragging = false
	_press_was_on_selected = false


func _select(gem: Gem) -> void:
	if _selected == gem:
		return
	_clear_selection()
	_selected = gem
	gem.set_selected(true)


func _clear_selection() -> void:
	if _selected != null:
		_selected.set_selected(false)
		_selected = null


static func _are_adjacent(a: Vector2i, b: Vector2i) -> bool:
	var diff := (a - b).abs()
	return diff.x + diff.y == 1


# --- Swapping -----------------------------------------------------------------------------


## Starts a player swap if it is allowed. Returns false (and changes nothing) if it is not.
func _try_swap(from: Vector2i, to: Vector2i) -> bool:
	if _state != State.IDLE or not _are_adjacent(from, to):
		return false
	if get_gem(from) == null or get_gem(to) == null:
		return false
	_clear_selection()
	_swap_from = from
	_swap_to = to
	_swap_is_revert = false
	_change_state(State.SWAPPING)
	_animate_swap(from, to, Tween.TRANS_BACK)
	return true


## Slides the last swap back, because it made no match.
func _revert_swap() -> void:
	_swap_is_revert = true
	_change_state(State.SWAPPING)
	swap_rejected.emit()
	# The gem the player moved is now at _swap_to, so it is passed first to stay on top.
	_animate_swap(_swap_to, _swap_from, Tween.TRANS_SINE)


## Swaps two cells in the grid straight away, then tweens both gems to their new cells.
## The gem that starts at `a` is drawn above the other one while they move.
func _animate_swap(a: Vector2i, b: Vector2i, trans: Tween.TransitionType) -> void:
	var gem_a := get_gem(a)
	var gem_b := get_gem(b)
	_set_cell(b, gem_a)
	_set_cell(a, gem_b)
	gem_a.z_index = 1
	gem_b.z_index = 0
	_move_gem(gem_a, grid_to_local(b), swap_duration, trans)
	_move_gem(gem_b, grid_to_local(a), swap_duration, trans)


func _move_gem(
	gem: Gem,
	target: Vector2,
	duration: float,
	trans: Tween.TransitionType,
	easing: Tween.EaseType = Tween.EASE_OUT
) -> void:
	_pending_animations += 1
	gem.move_to(target, duration, trans, easing)


func _on_gem_animation_finished(_gem: Gem) -> void:
	_pending_animations -= 1
	if _pending_animations < 0:
		push_error("Board: an animation finished that was never counted.")
		_pending_animations = 0
		return
	if _pending_animations == 0:
		# Deferred so the next step never runs inside a tween's own `finished` signal.
		_on_all_animations_finished.call_deferred()
