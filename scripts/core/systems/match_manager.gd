## Match-level rules: the score, the halftime side switch and the win condition.
##
## RoundManager reports who won a round; MatchManager decides whether that ends
## the match and whether sides swap next round. Every threshold comes from
## GameConfig.
class_name MatchManager
extends RefCounted

var teams: TeamManager
var round_number: int = 0      ## 1-based, incremented when a round starts
var completed_rounds: int = 0
var is_over: bool = false
var winning_team: int = -1
var end_reason: String = ""
var in_overtime: bool = false
var history: Array[Dictionary] = []

var _pending_match_end: Dictionary = {}

func _init(p_teams: TeamManager) -> void:
	teams = p_teams

func begin_match() -> void:
	round_number = 0
	completed_rounds = 0
	is_over = false
	winning_team = -1
	for team in teams.all():
		team.score = 0
		team.loss_streak = 0
	Events.match_started.emit()

func begin_round() -> int:
	round_number += 1
	return round_number

## Records a round result and evaluates the match state.
## Returns {"match_over": bool, "switch_sides": bool}.
func record_round_result(winning_team_id: int, reason: GameEnums.RoundEndReason) -> Dictionary:
	var winner := teams.get_team(winning_team_id)
	if winner != null:
		winner.score += 1
		winner.loss_streak = 0
	for team in teams.all():
		if team.id != winning_team_id:
			team.loss_streak += 1

	completed_rounds += 1
	history.append({
		"round": round_number, "winner": winning_team_id, "reason": reason,
		"scores": teams.scores(),
	})
	Events.score_changed.emit(teams.scores())

	var match_over := _evaluate_match_end()
	var switch_sides := not match_over and _should_switch_sides()
	return {"match_over": match_over, "switch_sides": switch_sides}

func _evaluate_match_end() -> bool:
	var config := Config.game
	for team in teams.all():
		if team.score >= config.rounds_to_win:
			_end_match(team.id, "ROUNDS_REACHED")
			return true
	if completed_rounds >= config.max_rounds:
		if config.overtime_enabled:
			in_overtime = true
			return false
		# Regulation exhausted with nobody at the target: decide on score, else draw.
		var a: TeamManager.TeamState = teams.all()[0]
		var b: TeamManager.TeamState = teams.all()[1]
		if a.score == b.score:
			_end_match(-1, "DRAW")
		else:
			_end_match(a.id if a.score > b.score else b.id, "ROUNDS_EXHAUSTED")
		return true
	return false

func _end_match(team_id: int, reason: String) -> void:
	is_over = true
	winning_team = team_id
	end_reason = reason
	# Queued rather than emitted here so listeners always see the deciding round's
	# round_ended before match_ended. RoundManager flushes it.
	_pending_match_end = {"team": team_id, "reason": reason, "scores": teams.scores()}

## Emits a queued match_ended, if any. Called by RoundManager.
func flush_match_end() -> bool:
	if _pending_match_end.is_empty():
		return false
	var payload := _pending_match_end
	_pending_match_end = {}
	Events.match_ended.emit(payload["team"], payload["reason"], payload["scores"])
	return true

func _should_switch_sides() -> bool:
	var config := Config.game
	if in_overtime:
		var overtime_rounds := completed_rounds - config.max_rounds
		return overtime_rounds > 0 and overtime_rounds % config.overtime_rounds_per_half == 0
	return completed_rounds == config.switch_sides_after_round

## True when the next round could decide the match for either team.
func is_match_point() -> bool:
	for team in teams.all():
		if team.score == Config.game.rounds_to_win - 1:
			return true
	return false

func describe() -> Dictionary:
	return {
		"round_number": round_number,
		"completed_rounds": completed_rounds,
		"scores": teams.scores(),
		"rounds_to_win": Config.game.rounds_to_win,
		"is_over": is_over,
		"winning_team": winning_team,
		"end_reason": end_reason,
		"match_point": is_match_point(),
	}
