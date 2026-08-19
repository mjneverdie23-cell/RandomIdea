class_name CommandRelay
extends Node

## Carries a client's intent to the authority and nothing else.
##
## A client never applies its own commands: it publishes them here, the
## authority validates ownership and match state, and then writes them into the
## server-side [InputCommands] bus that the player's champion already listens
## to. Results — movement, damage, cooldowns, death — come back as replicated
## state, so a client cannot decide any of them.
##
## Everything past the bus is the same code the offline game runs.

## How often movement intent goes out. Discrete actions are sent immediately.
@export_range(5.0, 60.0, 1.0) var send_rate: float = 20.0
## Resend even when unchanged, so a dropped packet cannot leave a champion
## walking forever.
@export_range(0.1, 2.0, 0.05) var keepalive: float = 0.25

var session: MatchSession
## The bus fed by this machine's input device.
var local_bus: InputCommands

var _accumulator: float = 0.0
var _since_keepalive: float = 0.0
var _last_direction: Vector2 = Vector2.ZERO
var _last_aim: Vector3 = Vector3.ZERO
var _rejected: int = 0


func setup(match_session: MatchSession, bus: InputCommands) -> void:
	session = match_session
	local_bus = bus
	bus.ability_requested.connect(_on_local_ability)
	bus.basic_attack_requested.connect(_on_local_attack)
	bus.recall_requested.connect(_on_local_recall)


func rejected_count() -> int:
	return _rejected


# --- client side -------------------------------------------------------------

func _forwarding() -> bool:
	return Net.is_client() and Net.is_connected_now() and session != null


func _physics_process(delta: float) -> void:
	if not _forwarding():
		return
	_accumulator += delta
	_since_keepalive += delta
	if _accumulator < 1.0 / maxf(send_rate, 1.0):
		return
	_accumulator = 0.0
	var direction := local_bus.move_direction
	var aim := local_bus.aim_point
	var changed := direction.distance_to(_last_direction) > 0.02 or aim.distance_to(_last_aim) > 0.5
	if not changed and _since_keepalive < keepalive:
		return
	_last_direction = direction
	_last_aim = aim
	_since_keepalive = 0.0
	_request_move.rpc_id(NetTypes.SERVER_PEER_ID, direction, aim)


func _on_local_ability(slot: int, aim_point: Vector3) -> void:
	if _forwarding():
		_request_ability.rpc_id(NetTypes.SERVER_PEER_ID, slot, aim_point)


func _on_local_attack(aim_point: Vector3) -> void:
	if _forwarding():
		_request_attack.rpc_id(NetTypes.SERVER_PEER_ID, aim_point)


func _on_local_recall() -> void:
	if _forwarding():
		_request_recall.rpc_id(NetTypes.SERVER_PEER_ID)


# --- authority side ----------------------------------------------------------

## Resolves the sender to a seated player, or null when the request is not
## allowed. Every RPC below goes through this, so an unseated or spectating
## peer can never move a champion.
func _authorise() -> PlayerSession:
	if not Net.is_authority() or session == null:
		return null
	if not session.is_running():
		_rejected += 1
		return null
	var player := session.session_for_peer(multiplayer.get_remote_sender_id())
	if player == null or player.commands == null or not player.has_champion():
		_rejected += 1
		return null
	if not player.champion.is_alive():
		_rejected += 1
		return null
	return player


## Aim points are clamped to the play field so a client cannot cast off-map.
func _sanitise_aim(point: Vector3) -> Vector3:
	var root := get_tree().get_first_node_in_group("game_root")
	if root == null or root.map == null or root.map.layout == null:
		return point
	return root.map.clamp_to_play_field(Vector3(point.x, 0.0, point.z))


@rpc("any_peer", "call_remote", "unreliable_ordered")
func _request_move(direction: Vector2, aim_point: Vector3) -> void:
	var player := _authorise()
	if player == null:
		return
	# Length is clamped by the bus itself, so a forged vector cannot outrun
	# anyone; speed comes from the server's own StatsComponent.
	player.commands.set_move_direction(direction)
	player.commands.set_aim_point(_sanitise_aim(aim_point))


@rpc("any_peer", "call_remote", "reliable")
func _request_ability(slot: int, aim_point: Vector3) -> void:
	var player := _authorise()
	if player == null:
		return
	if slot < 0 or slot >= InputCommands.ABILITY_NAMES.size():
		_rejected += 1
		return
	# The champion's AbilityComponent still checks cooldown, range and cast
	# validity; this only decides whether the request is allowed to be made.
	player.commands.set_aim_point(_sanitise_aim(aim_point))
	player.commands.request_ability(slot)


@rpc("any_peer", "call_remote", "reliable")
func _request_attack(aim_point: Vector3) -> void:
	var player := _authorise()
	if player == null:
		return
	# Note the client sends a point, never a target: the server picks the unit
	# with its own Battle query, so target choice is never client-authored.
	player.commands.set_aim_point(_sanitise_aim(aim_point))
	player.commands.request_basic_attack()


@rpc("any_peer", "call_remote", "reliable")
func _request_recall() -> void:
	var player := _authorise()
	if player != null:
		player.commands.request_recall()
