class_name MatchSession
extends Node

## Who is in this match and what phase it is in.
##
## The authority assigns teams and drives the phase; clients receive both over
## reliable RPCs and never invent either. Offline play uses exactly the same
## object with a single local player, so there is one code path for one player
## and for two.

signal phase_changed(phase: int)
signal roster_changed()
signal player_joined(session: PlayerSession)
signal player_left(session: PlayerSession)
signal match_finished(outcome: int, winner_team: int)

## Teams handed out in order, so player 1 is team A and player 2 is team B.
const TEAM_ORDER := [MapEnums.Team.A, MapEnums.Team.B]

## How many humans a match waits for before it starts.
var required_players: int = 1
var phase: int = NetTypes.MatchPhase.IDLE

var _sessions: Dictionary = {}
## Mirror of the authority's roster, used by clients that own no sessions.
var _roster: Array = []


# --- queries -----------------------------------------------------------------

func sessions() -> Array:
	var out: Array = []
	for key in _sessions:
		out.append(_sessions[key])
	out.sort_custom(func(a: PlayerSession, b: PlayerSession) -> bool: return a.team < b.team)
	return out


func session_for_peer(peer_id: int) -> PlayerSession:
	return _sessions.get(peer_id, null)


func session_for_team(team: int) -> PlayerSession:
	for player in sessions():
		if player.team == team:
			return player
	return null


func local_session() -> PlayerSession:
	return session_for_peer(Net.local_peer_id())


func local_team() -> int:
	var player := local_session()
	if player != null:
		return player.team
	for entry in _roster:
		if int(entry["peer_id"]) == Net.local_peer_id():
			return int(entry["team"])
	return MapEnums.Team.A


func player_count() -> int:
	return maxi(_sessions.size(), _roster.size())


func roster() -> Array:
	return _roster.duplicate(true)


func is_full() -> bool:
	return player_count() >= required_players


func is_running() -> bool:
	return phase == NetTypes.MatchPhase.RUNNING


func phase_name() -> String:
	return NetTypes.phase_name(phase)


func describe() -> Dictionary:
	return {
		"phase": phase_name(),
		"players": player_count(),
		"required": required_players,
		"local_team": MapEnums.team_name(local_team()),
	}


# --- authority ---------------------------------------------------------------

## Opens a match that waits for [param players] humans.
func open(players: int) -> void:
	required_players = maxi(players, 1)
	_sessions.clear()
	_roster.clear()
	_set_phase(NetTypes.MatchPhase.WAITING_FOR_PLAYERS)


## Seats a peer and hands it the next free team. Authority only.
func add_player(peer_id: int, local: bool) -> PlayerSession:
	if not Net.is_authority():
		return null
	if _sessions.has(peer_id):
		return _sessions[peer_id]
	if _sessions.size() >= required_players:
		push_warning("MatchSession: match is full, refusing peer %d." % peer_id)
		return null
	var player := PlayerSession.new()
	player.setup(peer_id, _next_free_team(), local)
	_sessions[peer_id] = player
	add_child(player)
	_publish_roster()
	player_joined.emit(player)
	return player


func remove_player(peer_id: int) -> void:
	if not Net.is_authority() or not _sessions.has(peer_id):
		return
	var player: PlayerSession = _sessions[peer_id]
	_sessions.erase(peer_id)
	_publish_roster()
	player_left.emit(player)
	player.queue_free()


func _next_free_team() -> int:
	for team in TEAM_ORDER:
		if session_for_team(team) == null:
			return team
	return MapEnums.Team.A


## Authority-side phase change, mirrored to every client.
func set_phase(next: int) -> void:
	if not Net.is_authority():
		return
	if Net.is_networked():
		_receive_phase.rpc(next)
	else:
		_set_phase(next)


func finish(outcome: int, winner_team: int) -> void:
	if not Net.is_authority():
		return
	set_phase(NetTypes.MatchPhase.ENDED)
	if Net.is_networked():
		_receive_result.rpc(outcome, winner_team)
	else:
		_apply_result(outcome, winner_team)


func _publish_roster() -> void:
	var data: Array = []
	for player in sessions():
		data.append(player.to_dictionary())
	if Net.is_networked():
		_receive_roster.rpc(data)
	else:
		_apply_roster(data)


# --- replication -------------------------------------------------------------

@rpc("authority", "call_local", "reliable")
func _receive_roster(data: Array) -> void:
	_apply_roster(data)


@rpc("authority", "call_local", "reliable")
func _receive_phase(next: int) -> void:
	_set_phase(next)


@rpc("authority", "call_local", "reliable")
func _receive_result(outcome: int, winner_team: int) -> void:
	_apply_result(outcome, winner_team)


func _apply_roster(data: Array) -> void:
	_roster = data.duplicate(true)
	roster_changed.emit()


func _set_phase(next: int) -> void:
	if phase == next:
		return
	phase = next
	phase_changed.emit(phase)


func _apply_result(outcome: int, winner_team: int) -> void:
	match_finished.emit(outcome, winner_team)
