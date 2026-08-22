@tool
class_name HudConfig
extends Resource

## Every number and colour the HUD draws with.
##
## The HUD scripts read this and the live gameplay components; they contain no
## gameplay constants of their own, so retuning the layout — or dropping in a
## polished mobile skin later — is editing one resource.

@export_group("Palette")
@export var background: Color = Color(0.07, 0.09, 0.12, 0.82)
@export var panel_border: Color = Color(0.30, 0.36, 0.45, 0.9)
@export var text: Color = Color(0.90, 0.93, 0.97)
@export var text_dim: Color = Color(0.55, 0.61, 0.70)
@export var health: Color = Color(0.36, 0.82, 0.42)
@export var health_low: Color = Color(0.90, 0.34, 0.30)
@export var resource: Color = Color(0.32, 0.58, 0.92)
@export var experience: Color = Color(0.78, 0.62, 0.24)
@export var gold: Color = Color(0.96, 0.80, 0.32)
@export var ready: Color = Color(0.92, 0.95, 1.0)
@export var locked: Color = Color(0.30, 0.34, 0.40)
@export var upgradeable: Color = Color(1.0, 0.85, 0.30)

@export_group("Ability bar")
@export_range(24.0, 160.0, 1.0) var ability_button_size: float = 64.0
@export_range(0.0, 40.0, 1.0) var ability_spacing: float = 10.0
## Side of the small "+" button that spends a skill point.
@export_range(12.0, 64.0, 1.0) var upgrade_button_size: float = 22.0

@export_group("Item bar")
@export_range(18.0, 120.0, 1.0) var item_slot_size: float = 38.0
@export_range(0.0, 20.0, 1.0) var item_spacing: float = 6.0

@export_group("Action buttons")
## Ward and shop buttons sitting beside the ability bar.
@export_range(20.0, 120.0, 1.0) var action_button_size: float = 42.0

@export_group("Bars")
@export_range(80.0, 800.0, 5.0) var status_bar_width: float = 300.0
@export_range(4.0, 60.0, 1.0) var health_bar_height: float = 18.0
@export_range(2.0, 40.0, 1.0) var experience_bar_height: float = 8.0
## Width of the K/D/A column sitting to the right of the bars.
@export_range(0.0, 240.0, 2.0) var score_column_width: float = 92.0

@export_group("Minimap")
@export_range(80.0, 600.0, 5.0) var minimap_size: float = 210.0
@export_range(0.0, 60.0, 1.0) var minimap_margin: float = 16.0
@export_range(1.0, 12.0, 0.5) var minimap_unit_dot: float = 4.0
@export_range(1.0, 20.0, 0.5) var minimap_champion_dot: float = 7.0
@export_range(1.0, 20.0, 0.5) var minimap_structure_dot: float = 6.0
@export var minimap_background: Color = Color(0.10, 0.13, 0.16, 0.86)
@export var minimap_bush: Color = Color(0.16, 0.46, 0.22, 0.75)
@export var minimap_ward: Color = Color(0.95, 0.90, 0.55)
## How often the minimap redraws, in seconds. It does not need a frame tick.
@export_range(0.02, 1.0, 0.01) var minimap_refresh: float = 0.08

@export_group("Shop")
@export_range(200.0, 900.0, 10.0) var shop_width: float = 420.0
@export_range(24.0, 120.0, 2.0) var shop_row_height: float = 54.0

@export_group("Toasts")
@export_range(0.5, 10.0, 0.1) var toast_duration: float = 2.2
