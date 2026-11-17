extends Node2D
## Hides refill gems while they are still above the grid. It paints the background colour
## over everything above the board's frame, which is the simplest possible clip and works
## with every renderer. It must be drawn after (above) ActiveGems.

const FAR := 4000.0

@export var board: Board
## Keep in step with BoardBackground.frame_padding so the frame's top edge stays visible.
@export var frame_padding: float = 10.0


func _ready() -> void:
	z_index = 10
	queue_redraw()


func _draw() -> void:
	if board == null:
		return
	var color: Color = ProjectSettings.get_setting(
		"rendering/environment/defaults/default_clear_color", Color.BLACK
	)
	var top := -frame_padding
	draw_rect(Rect2(-FAR, top - FAR, board.columns * board.cell_size + FAR * 2.0, FAR), color)
