class_name PlayerSession
extends Node

## One human player in a match: which peer they are, which team they got, and
## the command bus their champion listens to.
##
## The authority owns a bus per player — the local one comes from the input
## device, remote ones are filled by [CommandRelay] from validated RPCs. The
## champion cannot tell the difference, which is why no gameplay class knows
## about networking.

signal champion_changed(champion: ChampionController)

var peer_id: int = NetTypes.SERVER_PEER_ID
var team: int = MapEnums.Team.A
## True on the process where this player's input is produced.
var is_local: bool = false
var display_name: String = "Player"

var champion: ChampionController
## Only populated on the authority; clients never drive champions directly.
var commands: InputCommands


func setup(id: int, player_team: int, local: bool) -> void:
	peer_id = id
	team = player_team
	is_local = local
	display_name = "Player %d (%s)" % [id, MapEnums.team_name(team)]
	name = "Player_%d" % id


## Gives this player a server-side bus. The local player on a host reuses the
## input bus directly so there is no extra hop.
func attach_commands(bus: InputCommands) -> void:
	commands = bus
	if bus.get_parent() == null:
		add_child(bus)


func set_champion(unit: ChampionController) -> void:
	champion = unit
	champion_changed.emit(unit)


func has_champion() -> bool:
	return champion != null and is_instance_valid(champion)


func to_dictionary() -> Dictionary:
	return {"peer_id": peer_id, "team": team, "name": display_name}
