class_name Board
extends Node2D
## Owns the grid (a 2D array of Gem references), the turn state machine and player input.
##
## Coordinates: cell (0, 0) is the top-left cell. x is the column, y is the row, and y grows
## downwards, so gravity in Phase 2 means "towards larger y". The Board's own origin is the
## top-left corner of the grid.
##
## Animation barrier: before the Board starts a gem animation it adds 1 to
## _pending_animations. Each gem signals when that animation ends. When the count reaches 0,
## _on_all_animations_finished() moves the state machine on to its next step.

signal state_changed(new_state: State)

enum State { IDLE, SWAPPING, MATCHING, FALLING, REFILLING }

## Every legal state change. Any other change is a bug, so it is refused and logged.
const TRANSITIONS := {
	State.IDLE: [State.SWAPPING],
	State.SWAPPING: [State.MATCHING, State.IDLE],
	State.MATCHING: [State.FALLING, State.SWAPPING, State.IDLE],
	State.FALLING: [State.REFILLING],
	State.REFILLING: [State.MATCHING, State.IDLE],
}
const NO_CELL := Vector2i(-1, -1)

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

var _state: State = State.REFILLING
## _grid[x][y] holds a Gem, or null for an empty cell.
var _grid: Array = []
var _pending_animations: int = 0

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


func _ready() -> void:
	if not _is_config_valid():
		set_process_unhandled_input(false)
		return
	_pool.prewarm(columns * rows + columns * 2)
	_build_grid()


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
		State.REFILLING:
			_on_refill_finished()
		State.SWAPPING:
			_on_swap_finished()
		_:
			pass  # MATCHING and FALLING get their animations in Phase 2.


func _on_refill_finished() -> void:
	# PHASE 2: go to MATCHING here so cascades are found. The starting board is generated
	# without matches, so in Phase 1 the board goes straight to IDLE.
	_change_state(State.IDLE)


func _on_swap_finished() -> void:
	get_gem(_swap_from).z_index = 0
	get_gem(_swap_to).z_index = 0
	if _swap_is_revert:
		_swap_is_revert = false
		_change_state(State.IDLE)
		return
	_change_state(State.MATCHING)
	_resolve_matches()


## PHASE 2 replaces this body: find matches. If there are none, call _revert_swap().
## If there are some, clear them and go to FALLING.
func _resolve_matches() -> void:
	_change_state(State.IDLE)


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


func _spawn_gem(gem_type: GemType, cell: Vector2i) -> Gem:
	var gem := _pool.acquire(_active_gems)
	if not gem.move_finished.is_connected(_on_gem_animation_finished):
		gem.move_finished.connect(_on_gem_animation_finished)
		gem.spawn_finished.connect(_on_gem_animation_finished)
	gem.setup(gem_type, cell, cell_size * gem_radius_ratio)
	_set_cell(cell, gem)
	return gem


func _set_cell(cell: Vector2i, gem: Gem) -> void:
	_grid[cell.x][cell.y] = gem
	if gem:
		gem.grid_pos = cell


# --- Input --------------------------------------------------------------------------------


func _on_pointer_pressed(local_pos: Vector2) -> void:
	if _state != State.IDLE:
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


## Slides the last swap back. Phase 2 calls this when a swap makes no match.
func _revert_swap() -> void:
	_swap_is_revert = true
	_change_state(State.SWAPPING)
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
