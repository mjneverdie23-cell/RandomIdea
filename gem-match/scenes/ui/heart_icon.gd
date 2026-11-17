class_name HeartIcon
extends Control
## One heart, drawn in code (two circles and a triangle), so it needs no image and looks the
## same on every platform. Red when filled, dim when spent.

const FULL_COLOR := Color(0.93, 0.22, 0.33)
const EMPTY_COLOR := Color(0.3, 0.25, 0.4)

var filled: bool = true:
	set(value):
		filled = value
		queue_redraw()


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(func() -> void: pivot_offset = size / 2.0)


func _draw() -> void:
	var r := minf(size.x, size.y) * 0.5
	var c := size / 2.0 + Vector2(0.0, r * 0.08)
	var color := FULL_COLOR if filled else EMPTY_COLOR
	draw_circle(c + Vector2(-r * 0.5, -r * 0.25), r * 0.5, color)
	draw_circle(c + Vector2(r * 0.5, -r * 0.25), r * 0.5, color)
	draw_colored_polygon(
		PackedVector2Array(
			[c + Vector2(-r, -r * 0.25), c + Vector2(r, -r * 0.25), c + Vector2(0.0, r * 0.85)]
		),
		color
	)


## A quick bounce, for when the heart is spent or comes back.
func pop() -> void:
	if not is_inside_tree():
		return
	scale = Vector2.ONE * 1.35
	create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT).tween_property(
		self, "scale", Vector2.ONE, 0.35
	)
