class_name GameRoot
extends Node3D

## Wires the prototype together: builds the map, spawns the player champion and
## the placeholder enemies, and connects input, camera, HUD and debug view.
##
## This is the only place that knows about all of the systems at once. Each
## system stays ignorant of the others, which is what keeps the map reusable and
## the visuals replaceable.

@export var player_team: int = MapEnums.Team.A
@export var enemy_count: int = 6
## Prints a navigation reachability report on startup (also used headless).
@export var print_startup_report: bool = true

@onready var map: MapController = $Map
@onready var camera: GameplayCamera = $GameplayCamera
@onready var commands: InputCommands = $InputCommands
@onready var pc_input: PCInputController = $PCInputController
@onready var units: Node3D = $Units
@onready var hud: PrototypeHud = $HUD

var champion: Champion
var enemies: Array[EnemyUnit] = []


func _ready() -> void:
	if not map.is_built():
		map.build()

	champion = _spawn_champion(player_team)
	_spawn_enemies()

	pc_input.setup(commands, camera)
	camera.bind_commands(commands)
	camera.set_bounds(map.play_bounds(), 4.0)
	camera.set_follow_target(champion)
	commands.debug_toggle_requested.connect(_on_debug_toggle)
	hud.bind(map, champion, camera, commands)

	if print_startup_report:
		_report()


func _spawn_champion(team: int) -> Champion:
	var unit := Champion.new()
	unit.name = "PlayerChampion"
	unit.team = team
	units.add_child(unit)
	var spawn := map.spawn_transform(team)
	unit.global_position = spawn.origin + Vector3.UP * 0.2
	unit.recall_target = spawn.origin
	unit.bind_commands(commands)
	return unit


## Placeholder hostiles on routes that exercise lanes, jungle and the river.
func _spawn_enemies() -> void:
	var layout := map.layout
	var routes: Array[Dictionary] = [
		{"name": "MidSkirmisher", "shape": EnemyUnit.BodyShape.SPHERE, "size": 1.0, "speed": 7.0,
			"points": [layout.lane_point(MapEnums.Lane.MID, 0.35), layout.lane_point(MapEnums.Lane.MID, 0.65)]},
		{"name": "TopPatrol", "shape": EnemyUnit.BodyShape.BOX, "size": 0.8, "speed": 6.0,
			"points": [layout.lane_point(MapEnums.Lane.TOP, 0.35), layout.lane_point(MapEnums.Lane.TOP, 0.62)]},
		{"name": "BotPatrol", "shape": EnemyUnit.BodyShape.BOX, "size": 0.8, "speed": 6.0,
			"points": [layout.lane_point(MapEnums.Lane.BOT, 0.35), layout.lane_point(MapEnums.Lane.BOT, 0.62)]},
		{"name": "RiverRunner", "shape": EnemyUnit.BodyShape.SPHERE, "size": 1.1, "speed": 8.0,
			"points": [layout.river_point(0.22), layout.river_point(0.5), layout.river_point(0.78)]},
		{"name": "EnemyJungler", "shape": EnemyUnit.BodyShape.BOX, "size": 1.0, "speed": 7.0,
			"points": _camp_route(MapEnums.Team.B, MapEnums.Side.TOP)},
		{"name": "AlliedJungleDummy", "shape": EnemyUnit.BodyShape.BOX, "size": 1.0, "speed": 6.0,
			"points": _camp_route(MapEnums.Team.A, MapEnums.Side.BOT)},
	]

	for i in mini(enemy_count, routes.size()):
		var route: Dictionary = routes[i]
		var unit := EnemyUnit.new()
		unit.name = String(route["name"])
		unit.team = MapEnums.other_team(player_team)
		unit.body_shape = route["shape"]
		unit.body_size = route["size"]
		unit.move_speed = route["speed"]
		units.add_child(unit)
		var points: PackedVector3Array = _to_world_points(route["points"])
		unit.global_position = points[0] + Vector3.UP * 0.2
		unit.set_patrol(points)
		enemies.append(unit)


func _camp_route(team: int, side: int) -> Array:
	var jungle_id := MapEnums.jungle_id(team, side)
	var points: Array = []
	for camp in map.layout.camps:
		if String(camp["jungle"]) == jungle_id:
			points.append(camp["position"])
	return points


func _to_world_points(points: Array) -> PackedVector3Array:
	var out := PackedVector3Array()
	for p in points:
		out.append(Vector3(p.x, 0.0, p.y))
	return out


func _on_debug_toggle() -> void:
	map.toggle_debug()


func _report() -> void:
	print("[GameRoot] map built: ", map.describe())
	await map.navigation.await_synchronization()
	print(MapProbe.format(MapProbe.run(map)))
