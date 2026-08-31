## Global access point for the current match.
##
## Deliberately thin: it owns no rules. The match itself lives in a MatchSession
## node so the UI, tests and the headless simulator can all create, inspect and
## throw away matches independently.
extends Node

var session: MatchSession

func register_session(new_session: MatchSession) -> void:
	session = new_session

func has_session() -> bool:
	return session != null and is_instance_valid(session)

func local_player() -> Character:
	return session.local_player if has_session() else null

func round_phase() -> GameEnums.RoundPhase:
	return session.round_manager.phase if has_session() else GameEnums.RoundPhase.WARMUP

func is_buy_phase() -> bool:
	var phase := round_phase()
	return phase == GameEnums.RoundPhase.BUY or phase == GameEnums.RoundPhase.WARMUP

## Restarts the match with the same options. Used by the match-end screen.
func restart(options: Dictionary = {}) -> void:
	if not has_session():
		return
	var parent := session.get_parent()
	var previous_options: Dictionary = session.get_meta("options", {})
	session.queue_free()
	Events.reset()
	await get_tree().process_frame

	var fresh := MatchSession.new()
	fresh.name = "MatchSession"
	parent.add_child(fresh)
	var merged := previous_options.duplicate()
	for key in options:
		merged[key] = options[key]
	fresh.set_meta("options", merged)
	fresh.configure(merged)
	register_session(fresh)
	fresh.start()
	restarted.emit(fresh)

signal restarted(new_session: MatchSession)
