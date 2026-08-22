class_name HudDraw
extends RefCounted

## Drawing helpers shared by the HUD widgets.
##
## Every widget draws itself in [method CanvasItem._draw] rather than composing
## a tree of themed Controls: a prototype HUD changes shape constantly, and one
## draw call per panel is far easier to retune than a scene of nested boxes.
## Colours and sizes are never decided here — they arrive from [HudConfig].


static func font() -> Font:
	return ThemeDB.fallback_font


static func font_size(scale: float = 1.0) -> int:
	return maxi(int(round(float(ThemeDB.fallback_font_size) * scale)), 6)


## Filled panel with a one-pixel border.
static func panel(canvas: CanvasItem, rect: Rect2, fill: Color, border: Color) -> void:
	canvas.draw_rect(rect, fill, true)
	canvas.draw_rect(rect, border, false, 1.0)


## Horizontal progress bar. [param ratio] is clamped for safety, so a HUD can
## never be asked to draw a negative-width rectangle.
static func bar(canvas: CanvasItem, rect: Rect2, ratio: float, fill: Color,
		background: Color, border: Color = Color(0, 0, 0, 0)) -> void:
	canvas.draw_rect(rect, background, true)
	var filled := clampf(ratio, 0.0, 1.0)
	if filled > 0.0:
		canvas.draw_rect(Rect2(rect.position, Vector2(rect.size.x * filled, rect.size.y)), fill, true)
	if border.a > 0.0:
		canvas.draw_rect(rect, border, false, 1.0)


## Text laid out inside [param rect], vertically centred.
static func text_in(canvas: CanvasItem, rect: Rect2, value: String, color: Color,
		size: int = 0, alignment: int = HORIZONTAL_ALIGNMENT_CENTER) -> void:
	var use_size := size if size > 0 else font_size()
	var typeface := font()
	var baseline := rect.position.y + (rect.size.y - typeface.get_height(use_size)) * 0.5 \
		+ typeface.get_ascent(use_size)
	canvas.draw_string(typeface, Vector2(rect.position.x, baseline), value,
		alignment, rect.size.x, use_size, color)


## Short numeric label, e.g. a cooldown or a price.
static func number(value: float, decimals: int = 0) -> String:
	if decimals <= 0:
		return str(int(round(value)))
	return String.num(value, decimals)


## Compact gold/XP figure: 1250 becomes "1.2k" so the bar never reflows.
static func compact(value: float) -> String:
	if absf(value) < 1000.0:
		return str(int(round(value)))
	return "%.1fk" % (value / 1000.0)
