@tool
class_name NetworkTransport
extends Resource

## How a match reaches the wire.
##
## Gameplay never touches this: [NetworkManager] asks the transport for a
## configured [MultiplayerPeer] and knows nothing else about it. Swapping ENet
## for a WebRTC/relay peer later means adding a subclass and a .tres, with no
## change anywhere in the game.

@export var display_name: String = "ENet"
@export var address: String = "127.0.0.1"
@export_range(1024, 65535, 1) var port: int = 8642
@export_range(1, 32, 1) var max_clients: int = 4
## Seconds a client waits for the handshake before giving up.
@export_range(1.0, 60.0, 0.5) var connect_timeout: float = 10.0
## Human-readable note about any infrastructure this transport needs.
@export_multiline var infrastructure_notes: String = ""


## Returns a peer already in server mode, or null on failure.
func create_server() -> MultiplayerPeer:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_server(port, max_clients)
	if error != OK:
		push_error("NetworkTransport: could not listen on port %d (error %d)." % [port, error])
		return null
	return peer


## Returns a peer already dialling the host, or null on failure.
func create_client(override_address: String = "", override_port: int = 0) -> MultiplayerPeer:
	var host := override_address if not override_address.is_empty() else address
	var target_port := override_port if override_port > 0 else port
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_client(host, target_port)
	if error != OK:
		push_error("NetworkTransport: could not dial %s:%d (error %d)." % [host, target_port, error])
		return null
	return peer


## Address a host shows its opponent. LAN addresses are discovered locally;
## a relay or dedicated server overrides this with its public endpoint.
func advertised_address() -> String:
	for candidate in IP.get_local_addresses():
		if candidate.begins_with("127.") or candidate.contains(":"):
			continue
		return candidate
	return "127.0.0.1"


func describe() -> String:
	return "%s %s:%d" % [display_name, address, port]
