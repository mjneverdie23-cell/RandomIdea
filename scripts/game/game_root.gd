class_name GameRoot
extends Node3D

## Wires the prototype together: picks a game mode, builds its map, starts the
## combat sandbox and connects input, camera, HUD and the two debug views.
##
## This is the only place that knows about all of the systems at once. The map
## does not know about combat, combat does not know about input devices, and
## none of them know about the HUD or which mode is running.

signal mode_started(mode: GameModeConfig)

## Requested mode for the next scene load. Static state is the only thing that
## survives reload_current_scene(), which is how a mode switch is applied.
static var _pending_mode_id: String = ""

## Modes the build can launch. The first entry is the default.
@export var modes: Array[GameModeConfig] = []
## Index into [member modes]. Overridden by `--mode=<id>` on the command line.
@export var mode_index: int = 0
@export var player_team: int = MapEnums.Team.A
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

var mode: GameModeConfig
var champion: ChampionController


func _ready() -> void:
	mode = _resolve_mode()
	_apply_mode(mode)

	map.build()

	director.player_team = player_team
	director.setup(map, commands, units)
	director.start()
	champion = director.player

	pc_input.setup(commands, camera)
	camera.bind_commands(commands)
	camera.set_bounds(map.play_bounds(), 4.0)
	camera.set_follow_target(champion)
	commands.debug_toggle_requested.connect(_on_debug_toggle)
	commands.restart_requested.connect(restart_match)

	combat_debug.setup(champion)
	combat_debug.set_overlay_visible(director.config.combat_debug_on_start)
	dev_input.setup(director, combat_debug)
	dev_input.game_mode_cycle_requested.connect(cycle_mode)

	hud.bind(self)
	mode_started.emit(mode)

	if print_startup_report:
		_report()


# --- game mode ---------------------------------------------------------------

## A pending switch wins, then the command line, then [member mode_index].
func _resolve_mode() -> GameModeConfig:
	if modes.is_empty():
		return GameModeConfig.new()
	var requested := _pending_mode_id if not _pending_mode_id.is_empty() else _requested_mode_id()
	_pending_mode_id = ""
	if not requested.is_empty():
		for i in modes.size():
			if modes[i] != null and modes[i].id.to_lower() == requested:
				mode_index = i
				return modes[i]
		push_warning("GameRoot: unknown --mode='%s'; using the default." % requested)
	mode_index = clampi(mode_index, 0, modes.size() - 1)
	return modes[mode_index]


func _requested_mode_id() -> String:
	for arg in OS.get_cmdline_user_args() + OS.get_cmdline_args():
		if arg.begins_with("--mode="):
			return arg.substr(7).to_lower()
	return ""


## Pushes the mode's data into the map and the director before anything builds.
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


## Reloads the scene, which is the simplest correct reset for a prototype:
## every system rebuilds from its data with no stale state to miss.
func restart_match() -> void:
	_reload_with_mode(mode_index)


func cycle_mode() -> void:
	if modes.size() < 2:
		return
	_reload_with_mode((mode_index + 1) % modes.size())


func _reload_with_mode(next_index: int) -> void:
	if next_index >= 0 and next_index < modes.size() and modes[next_index] != null:
		_pending_mode_id = modes[next_index].id
	# Only meaningful when this scene is the running one; a test harness that
	# instantiates it as a child would otherwise reload the harness.
	if get_tree().current_scene != self:
		push_warning("GameRoot: not the current scene, skipping the reload.")
		return
	get_tree().reload_current_scene()


func _on_debug_toggle() -> void:
	map.toggle_debug()


func _report() -> void:
	print("[GameRoot] mode: %s (%s)" % [mode_name(), mode.kind_name() if mode != null else "?"])
	print("[GameRoot] map built: ", map.describe())
	await map.navigation.await_synchronization()
	print(MapProbe.format(MapProbe.run(map)))
	print("[GameRoot] sandbox: ", director.describe())
