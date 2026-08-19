class_name NetworkSpawner
extends MultiplayerSpawner

## Replicates the units that appear and disappear during a match: champions and
## minions. Turrets and nexuses are not spawned here — every peer builds those
## locally from the same map data, so their node paths already agree.
##
## Units are built in code rather than instanced from a scene, so this uses
## MultiplayerSpawner's custom spawn function: the host sends a small
## description and both sides run the same builder.

## Description keys shared by host and client.
const KIND_CHAMPION := "champion"
const KIND_MINION := "minion"

var _next_net_id: int = 1


func _ready() -> void:
	spawn_function = _build_unit


## Host-side spawn. Returns the live node so the caller can finish configuring
## it (a lane route, a spawn point) without that data going over the wire.
func spawn_unit(data: Dictionary) -> Node:
	data["net_id"] = _reserve_net_id()
	if not Net.is_networked():
		# Offline: no replication layer, just build and parent it.
		var unit := _build_unit(data)
		get_node(spawn_path).add_child(unit)
		return unit
	return spawn(data)


func _reserve_net_id() -> int:
	_next_net_id += 1
	return _next_net_id


## Runs on the host and on every client with identical input.
func _build_unit(data: Variant) -> Node:
	var description: Dictionary = data
	match String(description.get("kind", "")):
		KIND_CHAMPION:
			return _build_champion(description)
		KIND_MINION:
			return _build_minion(description)
	push_error("NetworkSpawner: unknown unit kind '%s'." % description.get("kind", ""))
	return null


func _build_champion(data: Dictionary) -> ChampionController:
	var loadout: ChampionLoadout = load(String(data["loadout"]))
	var champion := ChampionController.new()
	champion.loadout = loadout
	champion.net_id = int(data["net_id"])
	champion.owner_peer_id = int(data.get("owner_peer", 0))
	champion.initialize(int(data["team"]), loadout.stats if loadout != null else null)
	champion.spawn_point = data.get("spawn", Vector3.ZERO)
	champion.position = champion.spawn_point + Vector3.UP * 0.2
	return champion


func _build_minion(data: Dictionary) -> MinionController:
	var stats: MinionStats = load(String(data["stats"]))
	var minion := MinionController.new()
	minion.net_id = int(data["net_id"])
	minion.lane = int(data.get("lane", MapEnums.Lane.MID))
	minion.initialize(int(data["team"]), stats)
	minion.position = data.get("spawn", Vector3.ZERO)
	return minion
