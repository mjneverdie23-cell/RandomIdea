## Hold-to-view scoreboard: both teams, their side, and per-player stats.
class_name Scoreboard
extends OverlayPanel

var _table: VBoxContainer

func build() -> void:
	title_label.text = "Scoreboard"
	_table = VBoxContainer.new()
	_table.add_theme_constant_override("separation", 2)
	content.add_child(_table)

func refresh() -> void:
	if not Game.has_session():
		return
	var session := Game.session
	subtitle_label.text = "Round %d - first to %d - sides switch after round %d" % [
		session.match_manager.round_number, Config.game.rounds_to_win, Config.game.switch_sides_after_round]

	for child in _table.get_children():
		child.queue_free()

	_table.add_child(_make_row(
		["Player", "Class", "K", "D", "A", "DMG", "Plants", "Defuses", "Money"],
		Color("9aa6b2"), 11))

	for team in session.teams.all():
		var header := _make_row(
			["%s - %d - %s" % [team.name, team.score, GameEnums.side_name(team.side)], "", "", "", "", "", "", "", ""],
			Color("d8763a") if team.id == GameEnums.Team.TEAM_ONE else Color("3a86d8"), 15)
		_table.add_child(header)

		var members := session.teams.members_of(team.id)
		members.sort_custom(func(a, b): return a.score["kills"] > b.score["kills"])
		for character in members:
			var row := _make_row([
				"%s%s" % [character.character_name, " (bot)" if character.is_bot else ""],
				character.class_data.display_name,
				str(character.score["kills"]), str(character.score["deaths"]),
				str(character.score["assists"]), str(int(character.score["damage"])),
				str(character.score["plants"]), str(character.score["defuses"]),
				"$%d" % character.money,
			], Color.WHITE, 13)
			if not character.health.alive:
				row.modulate = Color(1, 1, 1, 0.45)
			_table.add_child(row)

func _make_row(cells: Array, color: Color, font_size: int) -> HBoxContainer:
	var row := HBoxContainer.new()
	var widths := [220, 110, 44, 44, 44, 60, 60, 70, 80]
	for index in cells.size():
		var label := Label.new()
		label.text = str(cells[index])
		label.custom_minimum_size = Vector2(widths[index] if index < widths.size() else 60, 0)
		label.add_theme_font_size_override("font_size", font_size)
		label.add_theme_color_override("font_color", color)
		row.add_child(label)
	return row
