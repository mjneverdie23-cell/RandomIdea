class_name GameRoot
extends Node3D

## Wires the prototype together: takes a launch request, builds that mode's
## map, opens a match session, starts the combat sandbox and connects input,
## camera, HUD and the debug views.
##
## This is the only place that knows about all of the systems at once. The map
## does not know about combat, combat does not know about input devices, and
## nothing below this node knows whether the match is offline, hosted or
## joined — that difference lives entirely in the networking layer.

signal mode_started(mode: GameModeConfig)
signal local_champion_changed(champion: ChampionController)

## Survives reload_current_scene(), which is how a mode or session switch is
## applied: store the request, reload, pick it back up.
static var _pending_launch: Dictionary = {}
## Kept for tests and tooling that only care about the mode.
static var _pending_mode_id: String = ""

## Modes the build can launch. The first entry is the default.
@export var modes: Array[GameModeConfig] = []
@export var mode_index: int = 0
@export var player_team: int = MapEnums.Team.A
@export var transport: NetworkTransport
## Prints a navigation reachability report on startup (also used headless).
@export var print_startup_report: bool = true

@onready var map: MapController = $Map
@onready var camera: GameplayCamera = $GameplayCamera
@onready var commands: InputCommands = $InputCommands
@onready var pc_input: PCInputController = $PCInputController
@onready var dev_input: DevInputController = $DevInputController
@onready var director: GameDirector = $GameDirector
@onready var combat_debug: CombatDebugOverlay = $CombatDebug
@onready var units: Node3D = $Units
@onready var hud: PrototypeHud = $HUD
@onready var session: MatchSession = $MatchSession
@onready var spawner: NetworkSpawner = $NetworkSpawner
@onready var state_sync: NetworkStateSync = $NetworkStateSync
@onready var relay: CommandRelay = $CommandRelay
@onready var net_debug: NetworkDebugOverlay = $NetworkDebug
@onready var menu: MultiplayerMenu = $Menu

var mode: GameModeConfig
var champion: ChampionController
var launch: Dictionary = {}
var started: bool = false


func _ready() -> void:
	add_to_group("game_root")
	if transport == null:
		transport = NetworkTransport.new()
	menu.setup(modes, transport.port)
	menu.launch_requested.connect(_on_launch_requested)
	Net.connection_state_changed.connect(_on_connection_state_changed)
	Net.network_error.connect(_on_network_error)
	Net.peer_joined.connect(_on_peer_joined)
	Net.peer_left.connect(_on_peer_left)

	var request := _resolve_launch()
	if request.is_empty():
		menu.open()
	else:
		start_session(request)


# --- launch ------------------------------------------------------------------

## A pending request wins, then the command line. Empty means "show the menu".
func _resolve_launch() -> Dictionary:
	if not _pending_launch.is_empty():
		var pending := _pending_launch.duplicate()
		_pending_launch = {}
		return pending
	if not _pending_mode_id.is_empty():
		var mode_id := _pending_mode_id
		_pending_mode_id = ""
		return {"mode_id": mode_id, "net": MultiplayerMenu.NET_OFFLINE}
	return _launch_from_command_line()


## `--mode=<id> [--ai|--no-ai] --host | --join=<address> [--port=<n>]`
## `--dedicated-server`
func _launch_from_command_line() -> Dictionary:
	var request: Dictionary = {}
	for arg in OS.get_cmdline_user_args() + OS.get_cmdline_args():
		if arg.begins_with("--mode="):
			request["mode_id"] = arg.substr(7).to_lower()
		elif arg == "--host":
			request["net"] = MultiplayerMenu.NET_HOST
		elif arg == "--dedicated-server":
			request["net"] = "dedicated"
		elif arg.begins_with("--join="):
			request["net"] = MultiplayerMenu.NET_CLIENT
			request["address"] = arg.substr(7)
		elif arg.begins_with("--port="):
			request["port"] = int(arg.substr(7))
		elif arg == "--ai":
			request["ai_opponent"] = true
		elif arg == "--no-ai":
			request["ai_opponent"] = false
	if request.is_empty():
		return request
	if not request.has("net"):
		request["net"] = MultiplayerMenu.NET_OFFLINE
	return request


func _on_launch_requested(request: Dictionary) -> void:
	start_session(request)


## Builds the map and starts the match described by [param request].
func start_session(request: Dictionary) -> void:
	if started:
		return
	launch = request
	var net_mode := String(request.get("net", MultiplayerMenu.NET_OFFLINE))

	if not _open_network(net_mode, request):
		menu.open()
		return
	started = true
	menu.close()

	mode = _resolve_mode(String(request.get("mode_id", "")))
	_apply_mode(mode)
	map.build()

	session.open(_required_players(net_mode))
	director.player_team = player_team
	# An offline match can fill the empty team with a bot; a networked one
	# keeps that seat for the other player.
	director.ai_opponents_enabled = bool(request.get("ai_opponent", true))
	director.setup(map, commands, units, session, spawner)
	director.start()

	pc_input.setup(commands, camera)
	camera.bind_commands(commands)
	camera.set_bounds(map.play_bounds(), 4.0)
	commands.debug_toggle_requested.connect(_on_debug_toggle)
	commands.restart_requested.connect(restart_match)

	state_sync.setup(units)
	relay.setup(session, commands)
	combat_debug.set_overlay_visible(director.config.combat_debug_on_start)
	dev_input.setup(director, combat_debug)
	dev_input.network_debug_requested.connect(func() -> void: net_debug.toggle())
	dev_input.menu_requested.connect(open_menu)
	net_debug.setup(session, state_sync, relay, director)
	hud.bind(self)

	session.phase_changed.connect(_on_phase_changed)
	session.match_finished.connect(_on_match_finished)
	if Net.is_authority():
		if Net.has_local_player():
			session.add_player(Net.local_peer_id(), true)
		_try_begin_match()

	mode_started.emit(mode)
	if print_startup_report:
		_report()


## Solo Lane over the network is 1v1; everything else runs with one seat.
func _required_players(net_mode: String) -> int:
	if net_mode == MultiplayerMenu.NET_OFFLINE:
		return 1
	return 2 if mode_is_solo_lane() else 1


func mode_is_solo_lane() -> bool:
	var mode_id := String(launch.get("mode_id", ""))
	if not mode_id.is_empty():
		return mode_id == "solo_lane"
	return mode != null and mode.kind == GameModeConfig.Kind.SOLO_LANE


func _open_network(net_mode: String, request: Dictionary) -> bool:
	var port := int(request.get("port", 0))
	var address := String(request.get("address", ""))
	match net_mode:
		MultiplayerMenu.NET_HOST:
			if port > 0:
				transport.port = port
			menu.set_status("Starting host...")
			return Net.start_host(transport, false)
		"dedicated":
			if port > 0:
				transport.port = port
			return Net.start_host(transport, true)
		MultiplayerMenu.NET_CLIENT:
			menu.set_status("Connecting...")
			return Net.start_client(transport, address, port)
	Net.shutdown("Offline")
	return true


# --- match lifecycle ---------------------------------------------------------

func _on_peer_joined(peer_id: int) -> void:
	if not Net.is_authority():
		return
	session.add_player(peer_id, false)
	_try_begin_match()


func _on_peer_left(peer_id: int) -> void:
	if not Net.is_authority():
		return
	var was_seated := session.session_for_peer(peer_id) != null
	session.remove_player(peer_id)
	if was_seated and session.is_running():
		hud.set_network_status("Opponent disconnected")
		session.set_phase(NetTypes.MatchPhase.ENDED)


## Starts as soon as every seat is filled. Until then the match sits in
## WAITING_FOR_PLAYERS and nothing is spawned.
func _try_begin_match() -> void:
	if not Net.is_authority() or session.is_running() or not session.is_full():
		return
	session.set_phase(NetTypes.MatchPhase.RUNNING)
	director.begin_match()


func _on_phase_changed(phase: int) -> void:
	match phase:
		NetTypes.MatchPhase.WAITING_FOR_PLAYERS:
			hud.set_network_status("Waiting for opponent...")
		NetTypes.MatchPhase.RUNNING:
			hud.set_network_status("Match started")
		NetTypes.MatchPhase.ENDED:
			hud.set_network_status("Match ended")


func _on_match_finished(_outcome: int, winner_team: int) -> void:
	# Clients score the authority's result from their own team's point of view.
	if Net.is_client():
		director.report_match_result(winner_team)


func _on_connection_state_changed(_state: int, message: String) -> void:
	menu.set_status(message)
	if hud != null and started:
		hud.set_network_status(message)


func _on_network_error(message: String) -> void:
	hud.set_network_status(message)
	if Net.is_client() or not started:
		# A client with no host has nothing left to play; go back to the menu.
		call_deferred("open_menu")


# --- local champion ----------------------------------------------------------

## The spawner delivers a client's champion a few frames after the match
## starts, so the local view is wired up when it actually arrives.
func _process(_delta: float) -> void:
	if not started or not Net.has_local_player():
		return
	if champion != null and is_instance_valid(champion):
		return
	var found := director.adopt_local_champion()
	if found != null:
		_set_local_champion(found)


func _set_local_champion(unit: ChampionController) -> void:
	champion = unit
	camera.set_follow_target(unit)
	combat_debug.setup(unit)
	hud.attach_champion(unit)
	local_champion_changed.emit(unit)


# --- mode --------------------------------------------------------------------

func _resolve_mode(mode_id: String) -> GameModeConfig:
	if modes.is_empty():
		return GameModeConfig.new()
	if not mode_id.is_empty():
		for i in modes.size():
			if modes[i] != null and modes[i].id.to_lower() == mode_id:
				mode_index = i
				return modes[i]
		push_warning("GameRoot: unknown mode '%s'; using the default." % mode_id)
	mode_index = clampi(mode_index, 0, modes.size() - 1)
	return modes[mode_index]


func _apply_mode(selected: GameModeConfig) -> void:
	if selected == null:
		return
	if selected.map_config != null:
		map.config = selected.map_config
	map.layout_script = selected.layout_script
	if selected.match_config != null:
		director.config = selected.match_config


func mode_name() -> String:
	return mode.display_name if mode != null else "Prototype"


# --- restart and menu --------------------------------------------------------

## Reloads the scene, which is the simplest correct reset for a prototype:
## every system rebuilds from its data with no stale state to miss.
func restart_match() -> void:
	_reload(launch)


func open_menu() -> void:
	Net.shutdown("Offline")
	_reload({})


func _reload(next_launch: Dictionary) -> void:
	_pending_launch = next_launch.duplicate()
	if get_tree().current_scene != self:
		push_warning("GameRoot: not the current scene, skipping the reload.")
		return
	get_tree().reload_current_scene()


func _on_debug_toggle() -> void:
	map.toggle_debug()


func _report() -> void:
	print("[GameRoot] mode: %s   net: %s" % [mode_name(), NetTypes.role_name(Net.role)])
	print("[GameRoot] map built: ", map.describe())
	await map.navigation.await_synchronization()
	print(MapProbe.format(MapProbe.run(map)))
	print("[GameRoot] sandbox: ", director.describe())
