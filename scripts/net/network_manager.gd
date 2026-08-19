class_name NetworkManager
extends Node

## Autoloaded owner of the multiplayer peer, registered as "Net".
##
## It knows about roles, peers and connection state and nothing else — no map,
## no champion, no combat. Gameplay asks it two questions: "am I the
## authority?" and "who owns this player?". Everything else it reports through
## signals so the menu, the HUD and the debug overlay can follow along without
## polling.

signal role_changed(role: int)
signal connection_state_changed(state: int, message: String)
signal peer_joined(peer_id: int)
signal peer_left(peer_id: int)
## Raised on a client when the host goes away, and on any peer on a hard error.
signal network_error(message: String)

## How often a client measures round-trip time.
const PING_INTERVAL := 1.0

var role: int = NetTypes.Role.OFFLINE
var connection_state: int = NetTypes.ConnectionState.DISCONNECTED
var status_message: String = "Offline"
var transport: NetworkTransport

## Peer ids currently connected, excluding this process.
var peers: PackedInt32Array = PackedInt32Array()
## Round-trip time in milliseconds, measured client-side.
var latency_ms: float = 0.0

var _ping_timer: float = 0.0
var _ping_sent_at: float = 0.0
var _connect_deadline: float = 0.0


func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)


# --- lifecycle ---------------------------------------------------------------

## Starts listening. [param dedicated] means this process hosts but does not
## play, which is how a public server is run.
func start_host(config: NetworkTransport, dedicated: bool = false) -> bool:
	shutdown()
	transport = config
	var peer := config.create_server()
	if peer == null:
		_set_connection(NetTypes.ConnectionState.FAILED, "Could not open port %d" % config.port)
		network_error.emit(status_message)
		return false
	multiplayer.multiplayer_peer = peer
	_set_role(NetTypes.Role.DEDICATED_SERVER if dedicated else NetTypes.Role.HOST)
	_set_connection(NetTypes.ConnectionState.CONNECTED,
		"Hosting on %s:%d" % [config.advertised_address(), config.port])
	return true


func start_client(config: NetworkTransport, address: String = "", port: int = 0) -> bool:
	shutdown()
	transport = config
	var peer := config.create_client(address, port)
	if peer == null:
		_set_connection(NetTypes.ConnectionState.FAILED, "Could not reach the host")
		network_error.emit(status_message)
		return false
	multiplayer.multiplayer_peer = peer
	_set_role(NetTypes.Role.CLIENT)
	_connect_deadline = _now() + config.connect_timeout
	_set_connection(NetTypes.ConnectionState.CONNECTING, "Connecting...")
	return true


## Drops the peer and returns to offline. Safe to call at any time.
func shutdown(message: String = "Offline") -> void:
	if multiplayer.multiplayer_peer != null \
			and multiplayer.multiplayer_peer is not OfflineMultiplayerPeer:
		multiplayer.multiplayer_peer.close()
	multiplayer.multiplayer_peer = OfflineMultiplayerPeer.new()
	peers = PackedInt32Array()
	latency_ms = 0.0
	_connect_deadline = 0.0
	_set_role(NetTypes.Role.OFFLINE)
	_set_connection(NetTypes.ConnectionState.DISCONNECTED, message)


# --- queries -----------------------------------------------------------------

func is_offline() -> bool:
	return role == NetTypes.Role.OFFLINE


func is_networked() -> bool:
	return role != NetTypes.Role.OFFLINE


## True when this process decides gameplay results.
func is_authority() -> bool:
	return NetTypes.is_authority(role)


func is_client() -> bool:
	return role == NetTypes.Role.CLIENT


func has_local_player() -> bool:
	return NetTypes.has_local_player(role)


func local_peer_id() -> int:
	if is_offline():
		return NetTypes.SERVER_PEER_ID
	return multiplayer.get_unique_id()


func peer_count() -> int:
	return peers.size()


func is_connected_now() -> bool:
	return connection_state == NetTypes.ConnectionState.CONNECTED


func describe() -> Dictionary:
	return {
		"role": NetTypes.role_name(role),
		"peer_id": local_peer_id(),
		"state": NetTypes.connection_name(connection_state),
		"peers": peers.size(),
		"latency_ms": roundi(latency_ms),
		"transport": transport.describe() if transport != null else "none",
	}


# --- internals ---------------------------------------------------------------

func _set_role(next: int) -> void:
	if role == next:
		return
	role = next
	role_changed.emit(role)


func _set_connection(state: int, message: String) -> void:
	connection_state = state
	status_message = message
	connection_state_changed.emit(state, message)


func _now() -> float:
	return float(Time.get_ticks_msec()) / 1000.0


func _on_peer_connected(peer_id: int) -> void:
	if not peers.has(peer_id):
		peers.append(peer_id)
	peer_joined.emit(peer_id)


func _on_peer_disconnected(peer_id: int) -> void:
	var index := Array(peers).find(peer_id)
	if index >= 0:
		peers.remove_at(index)
	peer_left.emit(peer_id)


func _on_connected_to_server() -> void:
	_connect_deadline = 0.0
	if not peers.has(NetTypes.SERVER_PEER_ID):
		peers.append(NetTypes.SERVER_PEER_ID)
	_set_connection(NetTypes.ConnectionState.CONNECTED, "Connected")


func _on_connection_failed() -> void:
	_set_connection(NetTypes.ConnectionState.FAILED, "Connection failed")
	network_error.emit(status_message)
	shutdown("Connection failed")


func _on_server_disconnected() -> void:
	_set_connection(NetTypes.ConnectionState.CLOSED, "Host disconnected")
	network_error.emit(status_message)
	shutdown("Host disconnected")


func _process(delta: float) -> void:
	if _connect_deadline > 0.0 and _now() > _connect_deadline:
		_connect_deadline = 0.0
		_set_connection(NetTypes.ConnectionState.FAILED, "Connection timed out")
		network_error.emit(status_message)
		shutdown("Connection timed out")
		return
	if not is_client() or not is_connected_now():
		return
	_ping_timer -= delta
	if _ping_timer <= 0.0:
		_ping_timer = PING_INTERVAL
		_ping_sent_at = _now()
		_ping.rpc_id(NetTypes.SERVER_PEER_ID, _ping_sent_at)


@rpc("any_peer", "call_remote", "unreliable")
func _ping(sent_at: float) -> void:
	# Runs on the server; bounce straight back to whoever asked.
	_pong.rpc_id(multiplayer.get_remote_sender_id(), sent_at)


@rpc("authority", "call_remote", "unreliable")
func _pong(sent_at: float) -> void:
	latency_ms = maxf((_now() - sent_at) * 1000.0, 0.0)
