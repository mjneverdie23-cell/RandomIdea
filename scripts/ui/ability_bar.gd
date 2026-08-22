class_name AbilityBar
extends Control

## The four ability buttons, with their cooldowns, ranks and level-up state.
##
## Every button is in exactly one of five states — empty, locked, on cooldown,
## unaffordable or ready — and each is drawn differently, so a glance answers
## "why can't I cast this?".
##
## A slot the champion could rank up right now grows a full-width [b]+[/b] bar
## above it and a pulsing outline around it. Both are deliberately loud: the
## first version of this used a 22-pixel unlabelled square and players could
## not find it, which is the whole reason a level-up is a decision. Pressing it
## raises [signal InputCommands.ability_upgrade_requested], which the authority
## validates. Points are never spent for the player.
##
## The bar is a presentation layer over live components: it holds no cooldown
## timers, no ranks and no gameplay numbers of its own.

signal ability_pressed(slot: int)
signal upgrade_pressed(slot: int)

var config: HudConfig
var champion: ChampionController


func setup(hud_config: HudConfig) -> void:
	config = hud_config
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = preferred_size()
	size = custom_minimum_size


func attach(unit: ChampionController) -> void:
	champion = unit
	queue_redraw()


func preferred_size() -> Vector2:
	var slots := InputCommands.ABILITY_NAMES.size()
	var button := config.ability_button_size
	return Vector2(
		float(slots) * button + float(slots - 1) * config.ability_spacing,
		button + config.upgrade_button_size + 6.0
	)


func slot_rect(slot: int) -> Rect2:
	var button := config.ability_button_size
	return Rect2(
		Vector2(float(slot) * (button + config.ability_spacing), config.upgrade_button_size + 6.0),
		Vector2(button, button)
	)


## The "+" spans the whole slot width: a big, obvious target rather than
## something to hunt for.
func upgrade_rect(slot: int) -> Rect2:
	var base := slot_rect(slot)
	return Rect2(Vector2(base.position.x, 0.0),
		Vector2(base.size.x, config.upgrade_button_size))


## Which of the five states a slot is in. The HUD tests, and the drawing code,
## both read this so they can never disagree.
func slot_state(slot: int) -> String:
	if champion == null or not is_instance_valid(champion) or champion.abilities == null:
		return "empty"
	var abilities := champion.abilities
	if abilities.ability_for(slot) == null:
		return "empty"
	if not abilities.is_unlocked(slot):
		return "locked"
	if abilities.cooldown_remaining(slot) > 0.0:
		return "cooldown"
	if champion.resource_pool != null \
			and not champion.resource_pool.can_pay(abilities.ability_for(slot).resource_cost):
		return "unaffordable"
	return "ready"


func can_upgrade(slot: int) -> bool:
	if champion == null or not is_instance_valid(champion) or champion.level == null \
			or champion.abilities == null:
		return false
	return champion.level.skill_points > 0 and champion.abilities.can_upgrade(slot, champion.level.level)


func _process(_delta: float) -> void:
	if champion != null and is_instance_valid(champion):
		queue_redraw()


func _draw() -> void:
	if config == null:
		return
	# The bar draws its empty frames before a champion arrives, so the HUD does
	# not visibly pop into place when the spawner delivers one.
	var ready := champion != null and is_instance_valid(champion) and champion.abilities != null
	for slot in InputCommands.ABILITY_NAMES.size():
		if ready:
			_draw_slot(slot)
		else:
			HudDraw.panel(self, slot_rect(slot), config.background, config.locked)


func _draw_slot(slot: int) -> void:
	var rect := slot_rect(slot)
	var state := slot_state(slot)
	var fill := config.background
	var border := config.panel_border
	match state:
		"ready":
			border = config.ready
		"locked":
			fill = config.background.darkened(0.3)
			border = config.locked
	HudDraw.panel(self, rect, fill, border)
	if can_upgrade(slot):
		# A slot waiting for a point outranks whatever else it was saying.
		draw_rect(rect.grow(1.0), config.upgradeable, false, 2.0)

	var abilities: AbilityComponent = champion.abilities if champion != null else null
	var ability: AbilityData = abilities.ability_for(slot) if abilities != null else null
	var label_color := config.text if state != "locked" else config.locked

	# The key is the identity of the button; a touch build shows the same slot
	# without one, which is why the label comes from the command bus.
	HudDraw.text_in(self, Rect2(rect.position + Vector2(0.0, 4.0), Vector2(rect.size.x, 20.0)),
		InputCommands.ability_name(slot), label_color, HudDraw.font_size(1.1))
	if ability != null:
		HudDraw.text_in(self,
			Rect2(rect.position + Vector2(0.0, rect.size.y * 0.42), Vector2(rect.size.x, 18.0)),
			ability.display_name, label_color, HudDraw.font_size(0.75))

	match state:
		"locked":
			_draw_locked(rect, slot)
		"cooldown":
			_draw_cooldown(rect, slot)
		"unaffordable":
			draw_rect(rect, Color(0.1, 0.2, 0.45, 0.45), true)
	_draw_ranks(rect, slot)
	if can_upgrade(slot):
		_draw_upgrade_button(slot)


## A locked slot says what would unlock it, which is the only useful thing it
## can say.
func _draw_locked(rect: Rect2, slot: int) -> void:
	draw_rect(rect, Color(0.0, 0.0, 0.0, 0.45), true)
	var needed: int = champion.abilities.unlock_level(slot)
	HudDraw.text_in(self, Rect2(rect.position + Vector2(0.0, rect.size.y - 24.0),
		Vector2(rect.size.x, 18.0)), "Lv %d" % needed, config.locked, HudDraw.font_size(0.8))


## The overlay drains from the top, and the remaining seconds sit over it.
func _draw_cooldown(rect: Rect2, slot: int) -> void:
	var ratio := champion.abilities.cooldown_ratio(slot)
	draw_rect(Rect2(rect.position, Vector2(rect.size.x, rect.size.y * ratio)),
		Color(0.02, 0.03, 0.05, 0.72), true)
	HudDraw.text_in(self, rect, HudDraw.number(ceilf(champion.abilities.cooldown_remaining(slot))),
		config.text, HudDraw.font_size(1.2))


## One pip per rank, filled up to the current one.
func _draw_ranks(rect: Rect2, slot: int) -> void:
	var abilities := champion.abilities
	var total := abilities.max_rank(slot)
	if total <= 0:
		return
	var current := abilities.rank(slot)
	var pip_width := (rect.size.x - 8.0) / float(total)
	for i in total:
		var pip := Rect2(
			Vector2(rect.position.x + 4.0 + float(i) * pip_width, rect.end.y - 6.0),
			Vector2(pip_width - 2.0, 3.0)
		)
		draw_rect(pip, config.ready if i < current else config.locked, true)


## Pulsing, so it reads as something to press rather than as decoration.
func _draw_upgrade_button(slot: int) -> void:
	var rect := upgrade_rect(slot)
	var pulse := 0.72 + 0.28 * sin(float(Time.get_ticks_msec()) * 0.005)
	var color := config.upgradeable
	color.a = pulse
	HudDraw.panel(self, rect, color, config.upgradeable.darkened(0.4))
	HudDraw.text_in(self, rect, "+", config.background, HudDraw.font_size(1.05))


func _gui_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton) or not event.pressed:
		return
	var mouse: InputEventMouseButton = event
	if mouse.button_index != MOUSE_BUTTON_LEFT:
		return
	for slot in InputCommands.ABILITY_NAMES.size():
		if can_upgrade(slot) and upgrade_rect(slot).has_point(mouse.position):
			upgrade_pressed.emit(slot)
			accept_event()
			return
		if slot_rect(slot).has_point(mouse.position):
			ability_pressed.emit(slot)
			accept_event()
			return
