extends Node

## Headless/offscreen smoke test for the prototype.
##
##   godot --path . tools/SmokeTest.tscn -- --out=/some/dir
##
## Boots the real game scene, proves the acceptance criteria that can be
## checked without a human (navigation reachability, command-driven movement,
## collision against walls, debug toggle) and optionally writes screenshots.
## It is a development tool and is never referenced by the game itself.

const MAIN_SCENE := "res://scenes/Main.tscn"
const SETTLE_FRAMES := 20

var _output_dir := ""
var _failures: PackedStringArray = PackedStringArray()
var _root: GameRoot


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			_output_dir = arg.substr(6)
	_run()


func _run() -> void:
	var scene: PackedScene = load(MAIN_SCENE)
	_root = scene.instantiate()
	add_child(_root)
	await _settle(SETTLE_FRAMES)

	_check_map()
	await _check_navigation()
	await _check_movement()
	await _check_wall_collision()
	_check_debug_view()
	await _capture_screenshots()
	await _check_alternate_map()

	if _failures.is_empty():
		print("[SmokeTest] PASS")
		get_tree().quit(0)
	else:
		for failure in _failures:
			printerr("[SmokeTest] FAIL: ", failure)
		get_tree().quit(1)


func _fail(message: String) -> void:
	_failures.append(message)


func _expect(condition: bool, message: String) -> void:
	if not condition:
		_fail(message)


func _settle(frames: int) -> void:
	for i in frames:
		await get_tree().process_frame


## Physics frames advance movement deterministically, unlike process frames
## which run as fast as the machine allows in headless mode.
func _settle_physics(frames: int) -> void:
	for i in frames:
		await get_tree().physics_frame


func _check_map() -> void:
	var map := _root.map
	_expect(map.is_built(), "map did not build")
	var description := map.describe()
	print("[SmokeTest] map: ", description)
	_expect(int(description["lanes"]) == 3, "expected 3 lanes")
	_expect(int(description["jungles"]) == 4, "expected 4 jungle quadrants")
	_expect(int(description["objectives"]) == 2, "expected 2 objectives")
	_expect(int(description["camps"]) == 16, "expected 16 jungle camps")
	_expect(int(description["turrets"]) >= 18, "expected at least 18 turrets")
	_expect(int(description["wall_boxes"]) > 0, "no terrain walls were generated")
	for id in MapProbe.REQUIRED_IDS:
		_expect(map.registry.has(id), "missing map identifier %s" % id)


func _check_navigation() -> void:
	await _root.map.navigation.await_synchronization()
	var report := MapProbe.run(_root.map)
	print(MapProbe.format(report))
	_expect(bool(report["ok"]), "navigation reachability check failed")
	_expect(int(report["nav_polygons"]) > 0, "navigation mesh is empty")


## Drives the champion through the command bus exactly like PC input would.
func _check_movement() -> void:
	var champion := _root.champion
	var commands := _root.commands
	# Stand in for the keyboard: the PC controller would overwrite the bus every
	# frame, which is exactly what a mobile joystick would replace.
	_root.pc_input.set_process(false)
	var start := champion.global_position
	commands.set_move_direction(Vector2(1.0, 0.0))
	await _settle_physics(45)
	commands.set_move_direction(Vector2.ZERO)
	await _settle_physics(5)
	var travelled := champion.global_position.distance_to(start)
	print("[SmokeTest] champion travelled %.2f m on a move command" % travelled)
	_expect(travelled > 5.0, "champion did not move on a movement command")
	_expect(_root.map.is_inside_play_field(champion.global_position), "champion left the play field")


## Walks the champion straight at the map border; walls must stop it.
func _check_wall_collision() -> void:
	var champion := _root.champion
	var half := _root.map.layout.play_field_half_size()
	var commands := _root.commands
	commands.set_move_direction(Vector2(-1.0, 1.0).normalized())
	await _settle_physics(180)
	commands.set_move_direction(Vector2.ZERO)
	await _settle_physics(5)
	var pos := champion.global_position
	print("[SmokeTest] champion stopped at x %.1f z %.1f (border %.1f)" % [pos.x, pos.z, half])
	_expect(absf(pos.x) <= half and absf(pos.z) <= half, "champion pushed through the map boundary")


func _check_debug_view() -> void:
	var map := _root.map
	var before := map.is_debug_visible()
	_root.commands.request_debug_toggle()
	_expect(map.is_debug_visible() != before, "debug view did not toggle")


func _capture_screenshots() -> void:
	if _output_dir.is_empty():
		return
	var camera := _root.camera
	var champion := _root.champion

	camera.locked_to_target = false
	camera.max_distance = 260.0
	camera.pitch_degrees = -68.0
	camera.set_distance(200.0)
	camera.set_focus(Vector3.ZERO)
	await _save_frame("overview_debug.png")

	_root.map.set_debug_visible(false)
	await _save_frame("overview.png")

	# Put the champion somewhere representative for the gameplay-camera shot.
	champion.global_position = Vector3(-18.0, 0.4, 18.0)
	camera.pitch_degrees = -52.0
	camera.set_distance(36.0)
	camera.locked_to_target = true
	camera.set_follow_target(champion)
	await _settle(20)
	await _save_frame("champion_view.png")

	# Close-up of the river / jungle junction to check wall height and scale.
	camera.locked_to_target = false
	camera.set_focus(Vector3(-24.0, 0.0, -6.0))
	camera.set_distance(40.0)
	await _save_frame("jungle_closeup.png")

	# Low angle: proves the terrain walls really are solid volumes, not decals.
	camera.pitch_degrees = -16.0
	camera.set_focus(Vector3(-30.0, 0.0, 6.0))
	camera.set_distance(38.0)
	await _save_frame("low_angle.png")


## Rebuilds the same systems from a differently sized [MapConfig]. This is the
## real test of the "reusable map architecture" requirement: nothing but the
## data resource changes.
func _check_alternate_map() -> void:
	var alternate: MapConfig = load("res://resources/maps/compact_map.tres")
	if alternate == null:
		_fail("could not load the alternate map configuration")
		return
	var map := _root.map
	map.config = alternate
	map.build()
	await map.navigation.await_synchronization()
	print("[SmokeTest] alternate map: ", map.describe())
	var report := MapProbe.run(map)
	print(MapProbe.format(report))
	_expect(bool(report["ok"]), "alternate map failed the reachability check")


func _save_frame(file_name: String) -> void:
	await _settle(4)
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	if image == null:
		_fail("could not capture %s" % file_name)
		return
	var path := _output_dir.path_join(file_name)
	var error := image.save_png(path)
	if error != OK:
		_fail("could not write %s (error %d)" % [path, error])
	else:
		print("[SmokeTest] wrote ", path)
