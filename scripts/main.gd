## Entry point: builds the world, the match and the UI, and wires the local
## player's camera to it.
##
## This is the only place the simulation, the UI and input meet. Each of them can
## be replaced on its own.
##
## Command-line options (after `--`):
##   --seed 7            deterministic match seed
##   --map dust_proto    map id from Config.get_map()
##   --difficulty hard   bot difficulty (easy | normal | hard)
##   --debug             on-screen debug readout
extends Node3D

@onready var ui: CanvasLayer = $UI

var session: MatchSession
var player_controller: PlayerController

func _ready() -> void:
	add_to_group("match_root")
	var options := _options_from_command_line()

	session = MatchSession.new()
	session.name = "MatchSession"
	add_child(session)
	session.set_meta("options", options)
	session.configure(options)
	Game.register_session(session)

	attach_local_player()

## Creates the camera/controller for the current session's local player.
## Called again after a restart, when the player node is a new instance.
func attach_local_player() -> void:
	session = Game.session
	var player: Character = session.local_player
	if player == null:
		return
	player_controller = PlayerController.new()
	player_controller.name = "PlayerController"
	player.add_child(player_controller)
	player_controller.setup(player)
	ui.bind_player(player_controller)

func _options_from_command_line() -> Dictionary:
	var options := {"with_local_player": true}
	var args := OS.get_cmdline_user_args()
	var index := 0
	while index < args.size():
		var argument: String = args[index]
		var value: String = args[index + 1] if index + 1 < args.size() else ""
		match argument:
			"--seed":
				options["seed"] = int(value)
				index += 1
			"--map":
				options["map_id"] = StringName(value)
				index += 1
			"--difficulty":
				options["bot_difficulty"] = StringName(value.to_upper())
				index += 1
			"--class":
				options["player_class"] = StringName(value.to_upper())
				index += 1
		index += 1
	return options
