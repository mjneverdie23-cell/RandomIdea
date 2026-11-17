class_name Gem
extends Node2D
## One gem on the board. It only draws itself and plays animations. It never reads or
## changes the Board. When an animation the Board waits on ends, the gem emits a signal and
## the Board decides what happens next.
## Gems are pooled (see GemPool): call setup() when one is taken from the pool, and
## reset_for_pool() when it goes back.

## Emitted when a move_to() tween ends (swap, and later fall/refill).
signal move_finished(gem: Gem)
## Emitted when the pop-in animation from play_spawn() ends.
signal spawn_finished(gem: Gem)

const SELECTED_SCALE := 1.12
const SELECT_PULSE_TIME := 0.35

var gem_type: GemType
var grid_pos: Vector2i = Vector2i(-1, -1)

var _move_tween: Tween
var _spawn_tween: Tween
var _select_tween: Tween

@onready var _visual: Node2D = $Visual
@onready var _highlight: Polygon2D = $Visual/Highlight
@onready var _body: Polygon2D = $Visual/Body
@onready var _sprite: Sprite2D = $Visual/Sprite


## Gives a pooled gem its identity. `radius` is half the gem's on-screen width in pixels.
func setup(new_type: GemType, cell: Vector2i, radius: float) -> void:
	gem_type = new_type
	grid_pos = cell
	_apply_visuals(radius)


## Slides the gem to `target` (in the parent's local space). Emits move_finished at the end.
func move_to(
	target: Vector2,
	duration: float,
	trans: Tween.TransitionType = Tween.TRANS_BACK,
	easing: Tween.EaseType = Tween.EASE_OUT
) -> void:
	_cancel_tracked_tween(_move_tween, move_finished)
	_move_tween = create_tween().set_trans(trans).set_ease(easing)
	_move_tween.tween_property(self, "position", target, duration)
	_move_tween.finished.connect(_on_move_tween_finished)


## Pops the gem in from scale 0 after `delay` seconds. Emits spawn_finished at the end.
func play_spawn(duration: float, delay: float = 0.0) -> void:
	_cancel_tracked_tween(_spawn_tween, spawn_finished)
	_visual.scale = Vector2.ZERO
	_spawn_tween = create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_spawn_tween.tween_property(_visual, "scale", Vector2.ONE, duration).set_delay(delay)
	_spawn_tween.finished.connect(_on_spawn_tween_finished)


## Shows or hides the selection outline and the pulsing scale.
func set_selected(selected: bool) -> void:
	_highlight.visible = selected
	if _select_tween:
		_select_tween.kill()
	_select_tween = create_tween()
	if selected:
		_select_tween.set_loops().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_select_tween.tween_property(
			_visual, "scale", Vector2.ONE * SELECTED_SCALE, SELECT_PULSE_TIME
		)
		_select_tween.tween_property(_visual, "scale", Vector2.ONE, SELECT_PULSE_TIME)
	else:
		_select_tween.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		_select_tween.tween_property(_visual, "scale", Vector2.ONE, 0.15)


## Puts the gem back to a neutral state before it returns to the pool. Emits nothing.
func reset_for_pool() -> void:
	for tween: Tween in [_move_tween, _spawn_tween, _select_tween]:
		if tween:
			tween.kill()
	_move_tween = null
	_spawn_tween = null
	_select_tween = null
	gem_type = null
	grid_pos = Vector2i(-1, -1)
	position = Vector2.ZERO
	z_index = 0
	modulate = Color.WHITE
	_visual.scale = Vector2.ONE
	_visual.rotation = 0.0
	_highlight.visible = false


func _apply_visuals(radius: float) -> void:
	var sides := gem_type.placeholder_sides
	var has_texture := gem_type.texture != null
	_highlight.polygon = _regular_polygon(sides, radius * 1.25)
	_body.visible = not has_texture
	_sprite.visible = has_texture
	if has_texture:
		_sprite.texture = gem_type.texture
		var tex_size := gem_type.texture.get_size()
		_sprite.scale = Vector2.ONE * (radius * 2.0 / maxf(tex_size.x, tex_size.y))
	else:
		_body.polygon = _regular_polygon(sides, radius)
		_body.color = gem_type.color


## If a tween the Board is counting is still running, stop it and report it as finished
## anyway. This keeps the Board's pending-animation count from getting stuck.
func _cancel_tracked_tween(tween: Tween, done_signal: Signal) -> void:
	if tween and tween.is_valid():
		tween.kill()
		done_signal.emit(self)


func _on_move_tween_finished() -> void:
	move_finished.emit(self)


func _on_spawn_tween_finished() -> void:
	spawn_finished.emit(self)


## A regular polygon with one corner pointing up (4 sides gives a diamond shape).
static func _regular_polygon(sides: int, radius: float) -> PackedVector2Array:
	var points := PackedVector2Array()
	for i in sides:
		points.append(Vector2.from_angle(-PI / 2.0 + TAU * i / sides) * radius)
	return points
