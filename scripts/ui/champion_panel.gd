class_name ChampionPanel
extends Control

## Level, health, ability resource, experience, gold and K/D/A for the local
## champion.
##
## Everything on it is read live from the champion's components: the level
## badge from [LevelComponent], the bars from [HealthComponent],
## [ResourceComponent] and [ExperienceComponent], the purse from
## [WalletComponent]. The panel owns no numbers, which is why it is correct on
## a client that only receives replicated values.

var config: HudConfig
var champion: ChampionController


func setup(hud_config: HudConfig) -> void:
	config = hud_config
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	custom_minimum_size = preferred_size()
	size = custom_minimum_size


func attach(unit: ChampionController) -> void:
	champion = unit
	queue_redraw()


func preferred_size() -> Vector2:
	var height := config.health_bar_height * 2.0 + config.experience_bar_height + 40.0
	return Vector2(config.status_bar_width + 52.0 + config.score_column_width, height)


func _process(_delta: float) -> void:
	if champion != null and is_instance_valid(champion):
		queue_redraw()


func _draw() -> void:
	if config == null or champion == null or not is_instance_valid(champion):
		return
	_draw_level_badge()
	_draw_score()
	var left := 48.0
	var width := config.status_bar_width
	var y := 0.0

	var health := champion.health
	var low := health.health_ratio() <= 0.3
	HudDraw.bar(self, Rect2(Vector2(left, y), Vector2(width, config.health_bar_height)),
		health.health_ratio(), config.health_low if low else config.health,
		config.background, config.panel_border)
	HudDraw.text_in(self, Rect2(Vector2(left, y), Vector2(width, config.health_bar_height)),
		"%d / %d" % [int(health.current), int(health.maximum)], config.text, HudDraw.font_size(0.8))
	y += config.health_bar_height + 3.0

	# A champion without a resource pool simply has no second bar, rather than
	# an empty one pretending to mean something.
	if champion.resource_pool != null and champion.resource_pool.is_enabled():
		var pool := champion.resource_pool
		HudDraw.bar(self, Rect2(Vector2(left, y), Vector2(width, config.health_bar_height * 0.7)),
			pool.ratio(), config.resource, config.background, config.panel_border)
		HudDraw.text_in(self,
			Rect2(Vector2(left, y), Vector2(width, config.health_bar_height * 0.7)),
			"%d / %d" % [int(pool.current), int(pool.maximum)], config.text, HudDraw.font_size(0.72))
		y += config.health_bar_height * 0.7 + 3.0

	if champion.experience != null:
		HudDraw.bar(self, Rect2(Vector2(left, y), Vector2(width, config.experience_bar_height)),
			champion.experience.ratio(), config.experience, config.background, config.panel_border)
		y += config.experience_bar_height + 4.0

	HudDraw.text_in(self, Rect2(Vector2(left, y), Vector2(width, 20.0)),
		_footer_text(), config.text, HudDraw.font_size(0.8), HORIZONTAL_ALIGNMENT_LEFT)


## Level, unspent points and gold: the three numbers a player checks between
## fights.
func _footer_text() -> String:
	var parts := PackedStringArray()
	if champion.experience != null:
		var needed := champion.experience.needed()
		parts.append("XP %d/%d" % [int(champion.experience.into_level), int(needed)] \
			if needed > 0.0 else "XP max")
	if champion.level != null and champion.level.skill_points > 0:
		parts.append("%d skill point%s" % [champion.level.skill_points,
			"" if champion.level.skill_points == 1 else "s"])
	if champion.wallet != null:
		parts.append("%s gold" % HudDraw.compact(champion.wallet.gold))
	return "   ".join(parts)


## K/D/A, in its own column to the right of the bars so it never overlaps the
## abilities, the minimap, the gold or the inventory.
func _draw_score() -> void:
	if champion.score == null or config.score_column_width <= 0.0:
		return
	var column := Rect2(
		Vector2(48.0 + config.status_bar_width + 8.0, 0.0),
		Vector2(config.score_column_width - 8.0, size.y - 4.0)
	)
	HudDraw.panel(self, column, config.background, config.panel_border)
	HudDraw.text_in(self, Rect2(column.position + Vector2(0.0, 6.0), Vector2(column.size.x, 14.0)),
		"K / D / A", config.text_dim, HudDraw.font_size(0.68))
	HudDraw.text_in(self, Rect2(column.position + Vector2(0.0, 20.0), Vector2(column.size.x, 24.0)),
		champion.score.summary(), config.text, HudDraw.font_size(1.05))


func _draw_level_badge() -> void:
	var centre := Vector2(22.0, 22.0)
	var level: int = champion.level.level if champion.level != null else 1
	var ready := champion.level != null and champion.level.skill_points > 0
	draw_circle(centre, 20.0, config.background)
	draw_arc(centre, 20.0, 0.0, TAU, 24, config.upgradeable if ready else config.panel_border, 2.0)
	HudDraw.text_in(self, Rect2(Vector2(2.0, 8.0), Vector2(40.0, 28.0)), str(level),
		config.text, HudDraw.font_size(1.3))
