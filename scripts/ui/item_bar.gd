class_name ItemBar
extends Control

## The champion's inventory slots.
##
## Slot count comes from the live [InventoryComponent], which took it from the
## champion's loadout, so a six-slot and a four-slot champion both render
## correctly with no HUD change. Icons are the item's placeholder colour and
## glyph until there is real art to draw.

signal slot_pressed(slot: int)

var config: HudConfig
var champion: ChampionController


func setup(hud_config: HudConfig) -> void:
	config = hud_config
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = preferred_size(6)
	size = custom_minimum_size


func attach(unit: ChampionController) -> void:
	champion = unit
	var slots: int = unit.inventory.slots if unit != null and unit.inventory != null else 6
	custom_minimum_size = preferred_size(slots)
	size = custom_minimum_size
	queue_redraw()


func preferred_size(slots: int) -> Vector2:
	var side := config.item_slot_size
	return Vector2(float(slots) * side + float(maxi(slots - 1, 0)) * config.item_spacing, side)


func slot_count() -> int:
	if champion == null or not is_instance_valid(champion) or champion.inventory == null:
		return 0
	return champion.inventory.slots


## Empty frames while the HUD waits for a champion, so the bar holds its space.
func placeholder_count() -> int:
	return 6


func slot_rect(slot: int) -> Rect2:
	var side := config.item_slot_size
	return Rect2(Vector2(float(slot) * (side + config.item_spacing), 0.0), Vector2(side, side))


func _process(_delta: float) -> void:
	if champion != null and is_instance_valid(champion):
		queue_redraw()


func _draw() -> void:
	if config == null:
		return
	if slot_count() == 0:
		for slot in placeholder_count():
			HudDraw.panel(self, slot_rect(slot), config.background.darkened(0.2), config.locked)
		return
	for slot in slot_count():
		var rect := slot_rect(slot)
		var item: ItemData = champion.inventory.item_at(slot)
		if item == null:
			HudDraw.panel(self, rect, config.background.darkened(0.2), config.locked)
			continue
		HudDraw.panel(self, rect, item.icon_color.darkened(0.35), item.icon_color)
		HudDraw.text_in(self, rect, item.icon_glyph, config.text, HudDraw.font_size(0.85))
		var cooldown := champion.inventory.active_cooldown(slot)
		if cooldown > 0.0:
			draw_rect(rect, Color(0.0, 0.0, 0.0, 0.55), true)
			HudDraw.text_in(self, rect, HudDraw.number(ceilf(cooldown)), config.text)


func _gui_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton) or not event.pressed:
		return
	var mouse: InputEventMouseButton = event
	if mouse.button_index != MOUSE_BUTTON_LEFT:
		return
	for slot in slot_count():
		if slot_rect(slot).has_point(mouse.position):
			slot_pressed.emit(slot)
			accept_event()
			return
