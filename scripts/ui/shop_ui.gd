class_name ShopUi
extends Control

## The buy panel: what is for sale, what it costs, what it gives and whether
## the champion can currently have it.
##
## It never grants anything. Pressing a row raises
## [signal InputCommands.purchase_requested] with an item id, and the
## authority's [PurchaseSystem] decides — same rule set offline, on a host and
## for a validated client request. The row's greyed-out state is a courtesy
## preview of that decision, taken from the same
## [method PurchaseSystem.rejection_reason] the server will run.

signal purchase_pressed(item_id: String)

var config: HudConfig
var catalog: ShopCatalog
var purchases: PurchaseSystem
var champion: ChampionController

var _hovered: int = -1


func setup(hud_config: HudConfig, shop_catalog: ShopCatalog, purchase_system: PurchaseSystem) -> void:
	config = hud_config
	catalog = shop_catalog
	purchases = purchase_system
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	custom_minimum_size = preferred_size()
	size = custom_minimum_size


func attach(unit: ChampionController) -> void:
	champion = unit
	queue_redraw()


func item_count() -> int:
	return catalog.size() if catalog != null else 0


func preferred_size() -> Vector2:
	return Vector2(config.shop_width, 52.0 + float(item_count()) * config.shop_row_height + 12.0)


func row_rect(index: int) -> Rect2:
	return Rect2(Vector2(8.0, 48.0 + float(index) * config.shop_row_height),
		Vector2(config.shop_width - 16.0, config.shop_row_height - 4.0))


## Why this item cannot be bought right now, or "" when it can.
func rejection_for(item: ItemData) -> String:
	if purchases == null:
		return "no shop"
	if champion == null or not is_instance_valid(champion):
		return "no champion"
	return purchases.rejection_reason(champion, item)


func is_open() -> bool:
	return visible


func open() -> void:
	visible = true
	queue_redraw()


func close() -> void:
	visible = false


func toggle() -> bool:
	visible = not visible
	if visible:
		queue_redraw()
	return visible


func _process(_delta: float) -> void:
	if visible:
		queue_redraw()


func _draw() -> void:
	if config == null or catalog == null:
		return
	HudDraw.panel(self, Rect2(Vector2.ZERO, size), config.background, config.panel_border)
	var gold: float = champion.wallet.gold if champion != null and champion.wallet != null else 0.0
	HudDraw.text_in(self, Rect2(Vector2(12.0, 8.0), Vector2(size.x - 24.0, 26.0)),
		catalog.display_name, config.text, HudDraw.font_size(1.15), HORIZONTAL_ALIGNMENT_LEFT)
	HudDraw.text_in(self, Rect2(Vector2(12.0, 8.0), Vector2(size.x - 24.0, 26.0)),
		"%s gold" % HudDraw.compact(gold), config.gold, HudDraw.font_size(1.0),
		HORIZONTAL_ALIGNMENT_RIGHT)
	for index in item_count():
		_draw_row(index, catalog.items[index])


func _draw_row(index: int, item: ItemData) -> void:
	if item == null:
		return
	var rect := row_rect(index)
	var reason := rejection_for(item)
	var affordable := reason.is_empty()
	var fill := config.background.lightened(0.12 if index == _hovered else 0.04)
	HudDraw.panel(self, rect, fill, config.ready if affordable else config.locked)

	var icon := Rect2(rect.position + Vector2(6.0, 6.0),
		Vector2(rect.size.y - 12.0, rect.size.y - 12.0))
	HudDraw.panel(self, icon, item.icon_color.darkened(0.35), item.icon_color)
	HudDraw.text_in(self, icon, item.icon_glyph, config.text, HudDraw.font_size(0.8))

	var text_color := config.text if affordable else config.text_dim
	var body := Rect2(Vector2(icon.end.x + 10.0, rect.position.y + 4.0),
		Vector2(rect.size.x - icon.size.x - 100.0, 18.0))
	HudDraw.text_in(self, body, item.display_name, text_color, HudDraw.font_size(0.92),
		HORIZONTAL_ALIGNMENT_LEFT)
	HudDraw.text_in(self, Rect2(body.position + Vector2(0.0, 18.0), body.size),
		item.summary(), config.text_dim, HudDraw.font_size(0.72), HORIZONTAL_ALIGNMENT_LEFT)

	var price := Rect2(Vector2(rect.end.x - 96.0, rect.position.y + 4.0), Vector2(90.0, 18.0))
	HudDraw.text_in(self, price, HudDraw.number(item.cost), config.gold, HudDraw.font_size(0.95),
		HORIZONTAL_ALIGNMENT_RIGHT)
	if not affordable:
		HudDraw.text_in(self, Rect2(price.position + Vector2(0.0, 18.0), price.size), reason,
			config.text_dim, HudDraw.font_size(0.7), HORIZONTAL_ALIGNMENT_RIGHT)


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		var motion: InputEventMouseMotion = event
		_hovered = _row_at(motion.position)
		return
	if not (event is InputEventMouseButton) or not event.pressed:
		return
	var mouse: InputEventMouseButton = event
	if mouse.button_index != MOUSE_BUTTON_LEFT:
		return
	var index := _row_at(mouse.position)
	if index >= 0:
		purchase_pressed.emit(catalog.items[index].id)
		accept_event()


func _row_at(point: Vector2) -> int:
	for index in item_count():
		if row_rect(index).has_point(point):
			return index
	return -1
