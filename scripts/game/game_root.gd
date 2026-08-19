class_name GameRoot
extends Node3D

## Wires the prototype together: builds the map, starts the combat sandbox and
## connects input, camera, HUD and the two debug views.
##
## This is the only place that knows about all of the systems at once. The map
## does not know about combat, combat does not know about input devices, and
## none of them know about the HUD.

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

var champion: ChampionController


func _ready() -> void:
	if not map.is_built():
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

	combat_debug.setup(champion)
	combat_debug.set_overlay_visible(director.config.combat_debug_on_start)
	dev_input.setup(director, combat_debug)

	hud.bind(map, director, camera, dev_input)

	if print_startup_report:
		_report()


func _on_debug_toggle() -> void:
	map.toggle_debug()


func _report() -> void:
	print("[GameRoot] map built: ", map.describe())
	await map.navigation.await_synchronization()
	print(MapProbe.format(MapProbe.run(map)))
	print("[GameRoot] sandbox: ", director.describe())
