extends TestSuite
## Loads every scene and pokes it, to catch broken node paths and wiring. Needs the
## GameState autoload; if the runner was started without autoloads, this suite is skipped.

const SCENES: Array[String] = [
	"res://scenes/menus/main_menu.tscn",
	"res://scenes/menus/level_select.tscn",
	"res://scenes/main/main.tscn",
]


func test_scenes_load_and_run() -> void:
	if not get_tree().root.has_node("GameState"):
		print("          (skipped: GameState autoload not loaded)")
		return
	for path in SCENES:
		var packed: PackedScene = load(path)
		check(packed != null, path + " loads")
		if packed == null:
			continue
		var scene := packed.instantiate()
		add_child(scene)
		await get_tree().process_frame
		await get_tree().process_frame
		check(scene.is_inside_tree(), path + " runs")
		scene.queue_free()
		await get_tree().process_frame


func test_level_scene_flow() -> void:
	if not get_tree().root.has_node("GameState"):
		print("          (skipped: GameState autoload not loaded)")
		return
	var game_state: Node = get_tree().root.get_node("GameState")
	game_state.current_level = 0
	Engine.time_scale = 8.0
	var level: Node = load("res://scenes/main/main.tscn").instantiate()
	add_child(level)
	var board: Board = level.get_node("Board")
	var popup: MessagePopup = level.get_node("UI_Layer/Popup")
	check(popup.visible, "the intro popup is shown")
	check(await wait_board_idle(board), "the level board settles")
	check(not board._input_enabled, "the board ignores input behind the intro popup")
	popup.primary_pressed.emit()
	check(not popup.visible and board._input_enabled, "Play closes the popup and enables input")
	var move := find_move(board, true)
	if not move.is_empty():
		board._try_swap(move[0], move[1])
		check(await wait_board_idle(board), "a turn settles in the level scene")
		check_eq(level._moves_left, level._level.moves - 1, "a move was used")
		check(level._score > 0, "the turn scored points")

	# Running out of moves the first time offers a revival, which pauses the game.
	level._moves_left = 0
	level._on_board_settled()
	var revival := _find_revival_popup(level)
	check(revival != null and revival.visible, "out of moves shows the revival popup")
	check(get_tree().paused, "the revival popup pauses the game")
	if revival != null:
		revival._watch_ad_button.pressed.emit()
		check(await wait_until(func() -> bool: return not get_tree().paused, 5.0), "ad revives")
		var revival_moves: int = level.get_script().get_script_constant_map()["REVIVAL_MOVES"]
		check_eq(level._moves_left, revival_moves, "revival grants extra moves")
		check(board._input_enabled, "the board takes input again")
	await get_tree().process_frame

	# The second time there is no offer: straight to game over.
	level._moves_left = 0
	level._on_board_settled()
	check(_find_revival_popup(level) == null, "no second revival")
	check(popup.visible and not get_tree().paused, "game over shows at once")
	get_tree().paused = false
	level.queue_free()
	await get_tree().process_frame
	Engine.time_scale = 1.0


func test_every_sound_plays() -> void:
	if not get_tree().root.has_node("AudioManager"):
		print("          (skipped: AudioManager autoload not loaded)")
		return
	var audio: Node = get_tree().root.get_node("AudioManager")
	for sound: StringName in [
		&"click", &"swap", &"invalid", &"match", &"create", &"special", &"shuffle", &"win", &"lose"
	]:
		check(audio._sounds.has(sound), "sound %s exists" % sound)
		audio.play(sound)
	check(AudioServer.get_bus_index(&"Music") != -1, "Music bus exists")
	check(AudioServer.get_bus_index(&"SFX") != -1, "SFX bus exists")


func _find_revival_popup(level: Node) -> RevivalPopup:
	for child in level.get_node("UI_Layer").get_children():
		if child is RevivalPopup and not child.is_queued_for_deletion():
			return child
	return null
