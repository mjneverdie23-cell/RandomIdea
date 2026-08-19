class_name MatchState
extends RefCounted

## Win/lose bookkeeping for a match, kept out of [GameDirector]'s spawning code.

enum Outcome { RUNNING, VICTORY, DEFEAT }

const OUTCOME_NAMES := ["RUNNING", "VICTORY", "DEFEAT"]

var outcome: int = Outcome.RUNNING
## Team that won, or -1 while the match is still running.
var winner: int = -1
var elapsed: float = 0.0


func is_running() -> bool:
	return outcome == Outcome.RUNNING


## Records the winner from the point of view of [param player_team].
func finish(winning_team: int, player_team: int) -> void:
	if not is_running():
		return
	winner = winning_team
	outcome = Outcome.VICTORY if winning_team == player_team else Outcome.DEFEAT


func reset() -> void:
	outcome = Outcome.RUNNING
	winner = -1
	elapsed = 0.0


func outcome_name() -> String:
	return OUTCOME_NAMES[outcome]


## Short banner text for the result screen.
func banner_text() -> String:
	match outcome:
		Outcome.VICTORY:
			return "VICTORY"
		Outcome.DEFEAT:
			return "DEFEAT"
	return ""
