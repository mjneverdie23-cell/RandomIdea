## Final scoreboard shown when a team reaches the round target.
class_name MatchEndScreen
extends OverlayPanel

signal restart_pressed()

var _summary: Label

func build() -> void:
	title_label.text = "Match over"
	_summary = Label.new()
	_summary.add_theme_font_size_override("font_size", 14)
	content.add_child(_summary)
	add_button("Play again", func(): restart_pressed.emit(), true)
	Events.match_ended.connect(_on_match_ended)

func _on_match_ended(winning_team: int, reason: String, scores: Dictionary) -> void:
	var teams := Game.session.teams
	var winner := teams.get_team(winning_team)
	title_label.text = "%s win the match" % winner.name if winner != null else "Match drawn"
	subtitle_label.text = "%s %d   -   %s %d   (%s)" % [
		teams.get_team(GameEnums.Team.TEAM_ONE).name, scores[GameEnums.Team.TEAM_ONE],
		teams.get_team(GameEnums.Team.TEAM_TWO).name, scores[GameEnums.Team.TEAM_TWO], reason]

	var top: Array = Game.session.characters.duplicate()
	top.sort_custom(func(a, b): return a.score["kills"] > b.score["kills"])
	var lines := PackedStringArray(["Top fraggers:"])
	for character in top.slice(0, 5):
		lines.append("  %s (%s)  %d / %d / %d" % [
			character.character_name, character.class_data.display_name,
			character.score["kills"], character.score["deaths"], character.score["assists"]])
	_summary.text = "\n".join(lines)
	open()
