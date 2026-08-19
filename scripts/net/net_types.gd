class_name NetTypes
extends RefCounted

## Shared vocabulary for the networking layer, kept free of any gameplay type
## so map, combat and input code never has to import networking to compile.

## What this process is doing. OFFLINE keeps the single-player path alive.
enum Role { OFFLINE, HOST, CLIENT, DEDICATED_SERVER }

enum ConnectionState { DISCONNECTED, CONNECTING, CONNECTED, FAILED, CLOSED }

## Lifecycle of a networked match, replicated from the authority.
enum MatchPhase { IDLE, WAITING_FOR_PLAYERS, RUNNING, ENDED }

const ROLE_NAMES := ["OFFLINE", "HOST", "CLIENT", "DEDICATED_SERVER"]
const CONNECTION_NAMES := ["DISCONNECTED", "CONNECTING", "CONNECTED", "FAILED", "CLOSED"]
const PHASE_NAMES := ["IDLE", "WAITING_FOR_PLAYERS", "RUNNING", "ENDED"]

## Peer id the server always owns in Godot's high-level multiplayer.
const SERVER_PEER_ID := 1


static func role_name(role: int) -> String:
	return ROLE_NAMES[role]


static func connection_name(state: int) -> String:
	return CONNECTION_NAMES[state]


static func phase_name(phase: int) -> String:
	return PHASE_NAMES[phase]


## True when this role decides gameplay outcomes.
static func is_authority(role: int) -> bool:
	return role != Role.CLIENT


## True when this role also plays a champion locally.
static func has_local_player(role: int) -> bool:
	return role != Role.DEDICATED_SERVER
