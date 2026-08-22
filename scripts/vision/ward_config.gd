@tool
class_name WardConfig
extends Resource

## Everything a prototype ward is. Kept as data so a control ward, a trinket
## and a scan can be three resources rather than three scripts.

@export var display_name: String = "Prototype Ward"
@export_range(1.0, 600.0, 1.0) var lifetime: float = 60.0
@export_range(1.0, 60.0, 0.5) var vision_radius: float = 14.0
## How many a champion may have standing at once.
@export_range(1, 10, 1) var max_active: int = 3
@export_range(0.0, 60.0, 0.5) var cooldown: float = 8.0
## How far from the champion one may be placed.
@export_range(1.0, 40.0, 0.5) var place_range: float = 10.0
