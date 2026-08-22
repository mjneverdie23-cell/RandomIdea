class_name ActionButtons
extends Control

## The two actions that are neither an ability nor an item: place a ward, and
## open the shop.
##
## Both leave through [InputCommands] like everything else the player does, so
## the same buttons work on a touch build and the ward request is validated by
## the authority exactly as it is when the developer key raises it.

signal ward_pressed()
signal shop_pressed()

const LABELS := ["Ward", "Shop"]

var config: HudConfig
var champion: ChampionController
## Set by the HUD so the ward button can grey out while it is on cooldown.
var director: GameDirector


func setup(hud_config: HudConfig, game_director: GameDirector) -> void:
	config = hud_config
	director = game_director
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = preferred_size()
	size = custom_minimum_size


func attach(unit: ChampionController) -> void:
	champion = unit
	queue_redraw()


func preferred_size() -> Vector2:
	var side := config.action_button_size
	return Vector2(side, side * float(LABELS.size()) + 6.0)


func button_rect(index: int) -> Rect2:
	var side := config.action_button_size
	return Rect2(Vector2(0.0, float(index) * (side + 6.0)), Vector2(side, side))


func ward_cooldown() -> float:
	if director == null or champion == null or not is_instance_valid(champion):
		return 0.0
	return director.ward_cooldown_for(champion)


func _process(_delta: float) -> void:
	queue_redraw()


func _draw() -> void:
	if config == null:
		return
	for index in LABELS.size():
		var rect := button_rect(index)
		var cooldown := ward_cooldown() if index == 0 else 0.0
		HudDraw.panel(self, rect, config.background,
			config.locked if cooldown > 0.0 else config.panel_border)
		HudDraw.text_in(self, rect, LABELS[index],
			config.text_dim if cooldown > 0.0 else config.text, HudDraw.font_size(0.75))
		if cooldown > 0.0:
			draw_rect(rect, Color(0.0, 0.0, 0.0, 0.5), true)
			HudDraw.text_in(self, rect, HudDraw.number(ceilf(cooldown)), config.text)


func _gui_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton) or not event.pressed:
		return
	var mouse: InputEventMouseButton = event
	if mouse.button_index != MOUSE_BUTTON_LEFT:
		return
	if button_rect(0).has_point(mouse.position):
		ward_pressed.emit()
		accept_event()
	elif button_rect(1).has_point(mouse.position):
		shop_pressed.emit()
		accept_event()
