class_name Gem
extends Node2D
## One gem on the board. It only draws itself and plays animations. It never reads or
## changes the Board. When an animation the Board waits on ends, the gem emits a signal and
## the Board decides what happens next.
## Gems are pooled (see GemPool): call setup() when one is taken from the pool, and
## reset_for_pool() when it goes back.

## Emitted when a move_to() tween ends (swap, fall, refill).
signal move_finished(gem: Gem)
## Emitted when the pop-in animation from play_spawn() ends.
signal spawn_finished(gem: Gem)
## Emitted when the destroy animation from play_clear() ends. The gem can then be pooled.
signal clear_finished(gem: Gem)

## STRIPED_H clears its row, STRIPED_V its column, WRAPPED the 3x3 area around it, and
## PRISM every gem of one colour. A PRISM has no colour of its own (gem_type is null).
enum Special { NONE, STRIPED_H, STRIPED_V, WRAPPED, PRISM }

const SELECTED_SCALE := 1.12
const SELECT_PULSE_TIME := 0.35
const PRISM_COLOR := Color(0.95, 0.95, 1.0)
const MARKER_COLOR := Color(1, 1, 1, 0.9)
const PRISM_MARKER_COLOR := Color(0.1, 0.08, 0.2)

var gem_type: GemType
var special: Special = Special.NONE
var grid_pos: Vector2i = Vector2i(-1, -1)

var _radius: float = 32.0
var _move_tween: Tween
var _spawn_tween: Tween
var _clear_tween: Tween
var _select_tween: Tween
var _pop_tween: Tween
var _hint_tween: Tween

@onready var _visual: Node2D = $Visual
@onready var _highlight: Polygon2D = $Visual/Highlight
@onready var _body: Polygon2D = $Visual/Body
@onready var _sprite: Sprite2D = $Visual/Sprite
@onready var _marker: Polygon2D = $Visual/Marker


## Gives a pooled gem its identity. `radius` is half the gem's on-screen width in pixels.
func setup(new_type: GemType, cell: Vector2i, radius: float) -> void:
	gem_type = new_type
	grid_pos = cell
	special = Special.NONE
	_radius = radius
	_apply_visuals()


## Turns this gem into a special gem, with a springy pop. A PRISM loses its colour.
func make_special(kind: Special) -> void:
	special = kind
	if kind == Special.PRISM:
		gem_type = null
	_apply_visuals()
	if _pop_tween:
		_pop_tween.kill()
	_visual.scale = Vector2.ONE * 0.5
	_pop_tween = create_tween().set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)
	_pop_tween.tween_property(_visual, "scale", Vector2.ONE, 0.5)


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


## After `delay`, pops the gem slightly bigger and then shrinks it to nothing.
## Emits clear_finished at the end.
func play_clear(duration: float, delay: float = 0.0) -> void:
	_cancel_tracked_tween(_clear_tween, clear_finished)
	if _pop_tween:
		_pop_tween.kill()
	_clear_tween = create_tween()
	var grow := _clear_tween.tween_property(_visual, "scale", Vector2.ONE * 1.25, duration * 0.35)
	grow.set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT).set_delay(delay)
	var shrink := _clear_tween.tween_property(_visual, "scale", Vector2.ZERO, duration * 0.65)
	shrink.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
	_clear_tween.finished.connect(_on_clear_tween_finished)


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


## A quick wiggle to point out a possible move. Purely cosmetic; emits nothing.
func play_hint() -> void:
	if _hint_tween:
		_hint_tween.kill()
	_hint_tween = create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	for _i in 2:
		_hint_tween.tween_property(_visual, "rotation", 0.3, 0.08)
		_hint_tween.tween_property(_visual, "rotation", -0.3, 0.12)
	_hint_tween.tween_property(_visual, "rotation", 0.0, 0.08)


## Puts the gem back to a neutral state before it returns to the pool. Emits nothing.
func reset_for_pool() -> void:
	for tween: Tween in [
		_move_tween, _spawn_tween, _clear_tween, _select_tween, _pop_tween, _hint_tween
	]:
		if tween:
			tween.kill()
	_move_tween = null
	_spawn_tween = null
	_clear_tween = null
	_select_tween = null
	_pop_tween = null
	_hint_tween = null
	gem_type = null
	special = Special.NONE
	grid_pos = Vector2i(-1, -1)
	position = Vector2.ZERO
	z_index = 0
	modulate = Color.WHITE
	_visual.scale = Vector2.ONE
	_visual.rotation = 0.0
	_highlight.visible = false
	_marker.visible = false


func _apply_visuals() -> void:
	var r := _radius
	var is_prism := special == Special.PRISM
	var sides := 12 if is_prism else gem_type.placeholder_sides
	var texture: Texture2D = null if is_prism else gem_type.texture
	_highlight.polygon = _regular_polygon(sides, r * 1.25)
	_body.visible = texture == null
	_sprite.visible = texture != null
	if texture:
		_sprite.texture = texture
		_sprite.scale = Vector2.ONE * (r * 2.0 / maxf(texture.get_width(), texture.get_height()))
	else:
		_body.polygon = _regular_polygon(sides, r)
		_body.color = PRISM_COLOR if is_prism else gem_type.color

	_marker.visible = special != Special.NONE
	_marker.color = PRISM_MARKER_COLOR if is_prism else MARKER_COLOR
	match special:
		Special.STRIPED_H:
			_marker.polygon = _rect(Vector2(r * 1.6, r * 0.3))
		Special.STRIPED_V:
			_marker.polygon = _rect(Vector2(r * 0.3, r * 1.6))
		Special.WRAPPED:
			_marker.polygon = _rect(Vector2(r * 0.75, r * 0.75))
		Special.PRISM:
			_marker.polygon = _regular_polygon(12, r * 0.4)


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


func _on_clear_tween_finished() -> void:
	clear_finished.emit(self)


## A regular polygon with one corner pointing up (4 sides gives a diamond shape).
static func _regular_polygon(sides: int, radius: float) -> PackedVector2Array:
	var points := PackedVector2Array()
	for i in sides:
		points.append(Vector2.from_angle(-PI / 2.0 + TAU * i / sides) * radius)
	return points


## A rectangle of `size` centred on the gem.
static func _rect(size: Vector2) -> PackedVector2Array:
	var h := size / 2.0
	return PackedVector2Array([Vector2(-h.x, -h.y), Vector2(h.x, -h.y), h, Vector2(-h.x, h.y)])
