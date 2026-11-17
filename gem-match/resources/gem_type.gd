class_name GemType
extends Resource
## Data for one kind of gem (Ruby, Sapphire, ...). One .tres file per gem lives in
## res://resources/gems/. Add a new gem by duplicating a .tres and adding it to Board.gem_types.

## Stable identifier used by code and (later) level files, e.g. &"ruby".
@export var id: StringName = &""
@export var display_name: String = ""
## Base colour. Used for the placeholder shape now, and for particles/UI later.
@export var color: Color = Color.WHITE
## Optional final art. While this is empty the gem draws a placeholder polygon.
@export var texture: Texture2D
## Number of sides of the placeholder polygon, so gems differ by shape and not only colour.
@export_range(3, 12) var placeholder_sides: int = 6
## Score for each gem of this type that is cleared.
@export var points: int = 10
