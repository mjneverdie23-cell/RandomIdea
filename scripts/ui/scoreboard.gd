class_name Scoreboard
extends Control

## Every champion in the match, both teams: name, level, K/D/A and items.
##
## Held open rather than toggled, the way a MOBA scoreboard always is. It reads
## the live components on each champion, so on a client it shows exactly what
## the server replicated and nothing it worked out for itself.
##
## Gold is shown for your own team only. Everything else on the board is public
## knowledge in a real match; how much money the enemy is sitting on is not.

var config: HudConfig
var local_team: int = MapEnums.Team.A


func setup(hud_config: HudConfig) -> void:
	config = hud_config
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false


func attach(champion: ChampionController) -> void:
	if champion != null:
		local_team = champion.team
	queue_redraw()


func set_open(open: bool) -> void:
	if visible == open:
		return
	visible = open
	if open:
		queue_redraw()


func is_open() -> bool:
	return visible


## Own team first, then the opposition; stable within a team so rows do not
## jump around while you are reading them.
func rows() -> Array:
	var mine: Array = []
	var theirs: Array = []
	for unit in Battle.all():
		if unit.kind != Unit.Kind.CHAMPION:
			continue
		if unit.team == local_team:
			mine.append(unit)
		else:
			theirs.append(unit)
	mine.sort_custom(func(a: Node3D, b: Node3D) -> bool: return a.net_id < b.net_id)
	theirs.sort_custom(func(a: Node3D, b: Node3D) -> bool: return a.net_id < b.net_id)
	return mine + theirs


func preferred_height() -> float:
	# Two team headings plus a row per champion, plus the title bar.
	return 52.0 + config.scoreboard_row_height * float(rows().size() + 2) + 16.0


func _process(_delta: float) -> void:
	if visible:
		queue_redraw()


func _draw() -> void:
	if config == null:
		return
	var champions := rows()
	var height := preferred_height()
	var panel := Rect2(Vector2((size.x - config.scoreboard_width) * 0.5,
		(size.y - height) * 0.5), Vector2(config.scoreboard_width, height))
	HudDraw.panel(self, panel, config.background, config.panel_border)
	HudDraw.text_in(self, Rect2(panel.position + Vector2(16.0, 10.0),
		Vector2(panel.size.x - 32.0, 26.0)), "Scoreboard", config.text,
		HudDraw.font_size(1.2), HORIZONTAL_ALIGNMENT_LEFT)
	HudDraw.text_in(self, Rect2(panel.position + Vector2(16.0, 10.0),
		Vector2(panel.size.x - 32.0, 26.0)), "Champion / Lv / K / D / A / Items",
		config.text_dim, HudDraw.font_size(0.72), HORIZONTAL_ALIGNMENT_RIGHT)

	var y := panel.position.y + 48.0
	var drawn_heading := {}
	for champion in champions:
		var friendly: bool = champion.team == local_team
		if not drawn_heading.has(friendly):
			drawn_heading[friendly] = true
			HudDraw.text_in(self, Rect2(Vector2(panel.position.x + 16.0, y),
				Vector2(panel.size.x - 32.0, config.scoreboard_row_height)),
				"Your team" if friendly else "Enemy team",
				config.upgradeable, HudDraw.font_size(0.8), HORIZONTAL_ALIGNMENT_LEFT)
			y += config.scoreboard_row_height
		_draw_row(champion, Rect2(Vector2(panel.position.x + 12.0, y),
			Vector2(panel.size.x - 24.0, config.scoreboard_row_height - 3.0)), friendly)
		y += config.scoreboard_row_height


func _draw_row(champion: ChampionController, rect: Rect2, friendly: bool) -> void:
	var alive: bool = champion.is_alive()
	HudDraw.panel(self, rect, config.background.lightened(0.05),
		config.panel_border if friendly else config.locked)

	var level: int = champion.level.level if champion.level != null else 1
	var badge := Rect2(rect.position + Vector2(6.0, 4.0), Vector2(24.0, rect.size.y - 8.0))
	HudDraw.panel(self, badge, config.background, config.panel_border)
	HudDraw.text_in(self, badge, str(level), config.text, HudDraw.font_size(0.8))

	var name_color := config.text if alive else config.text_dim
	HudDraw.text_in(self, Rect2(Vector2(badge.end.x + 10.0, rect.position.y),
		Vector2(190.0, rect.size.y)),
		champion.display_name() + ("" if alive else "  (dead)"),
		name_color, HudDraw.font_size(0.88), HORIZONTAL_ALIGNMENT_LEFT)

	var score: String = champion.score.summary() if champion.score != null else "0 / 0 / 0"
	HudDraw.text_in(self, Rect2(Vector2(badge.end.x + 200.0, rect.position.y),
		Vector2(90.0, rect.size.y)), score, config.text, HudDraw.font_size(0.9))

	# Gold is your team's business only.
	if friendly and champion.wallet != null:
		HudDraw.text_in(self, Rect2(Vector2(badge.end.x + 292.0, rect.position.y),
			Vector2(70.0, rect.size.y)), HudDraw.compact(champion.wallet.gold),
			config.gold, HudDraw.font_size(0.82), HORIZONTAL_ALIGNMENT_RIGHT)

	_draw_items(champion, Vector2(rect.end.x - 8.0, rect.position.y + rect.size.y * 0.5))


## Item glyphs, right-aligned so the column lines up whatever the name length.
func _draw_items(champion: ChampionController, right_middle: Vector2) -> void:
	if champion.inventory == null:
		return
	var side := config.scoreboard_item_size
	var slots := champion.inventory.slots
	for index in slots:
		var box := Rect2(
			Vector2(right_middle.x - float(slots - index) * (side + 3.0), right_middle.y - side * 0.5),
			Vector2(side, side)
		)
		var item: ItemData = champion.inventory.item_at(index)
		if item == null:
			HudDraw.panel(self, box, config.background.darkened(0.25), config.locked)
			continue
		HudDraw.panel(self, box, item.icon_color.darkened(0.35), item.icon_color)
		HudDraw.text_in(self, box, item.icon_glyph, config.text, HudDraw.font_size(0.62))
