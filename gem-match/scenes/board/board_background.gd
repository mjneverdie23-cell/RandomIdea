extends Node2D
## Static checkerboard of cell slots drawn behind the gems. It reads the grid size from the
## Board, so it always lines up. Replace it with a TileMapLayer or Sprite2D once there is art.

@export var board: Board
@export var frame_padding: float = 10.0
@export var frame_color: Color = Color(0.06, 0.04, 0.12, 0.9)
@export var light_cell_color: Color = Color(0.25, 0.21, 0.38)
@export var dark_cell_color: Color = Color(0.2, 0.16, 0.31)


func _ready() -> void:
	if board == null:
		push_warning("BoardBackground: no board assigned.")
		return
	board.layout_changed.connect(_on_board_layout_changed)
	_on_board_layout_changed()


func _on_board_layout_changed() -> void:
	position = board.position
	queue_redraw()


func _draw() -> void:
	if board == null:
		return
	var grid_size := Vector2(board.columns, board.rows) * board.cell_size
	var pad := Vector2.ONE * frame_padding
	draw_rect(Rect2(-pad, grid_size + pad * 2.0), frame_color)
	var cell := Vector2.ONE * board.cell_size
	for x in board.columns:
		for y in board.rows:
			var color := light_cell_color if (x + y) % 2 == 0 else dark_cell_color
			draw_rect(Rect2(Vector2(x, y) * board.cell_size, cell), color)
