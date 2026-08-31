## Dev tool: loads the game, waits a moment, and writes a screenshot.
##
##   godot --path . res://tools/screenshot.tscn -- --out shot.png --frames 240
##
## Useful for CI or for checking a UI change without launching the editor.
extends Node

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var out_path := "user://screenshot.png"
	var frames := 180
	var index := 0
	while index < args.size():
		if args[index] == "--out" and index + 1 < args.size():
			out_path = args[index + 1]
		elif args[index] == "--frames" and index + 1 < args.size():
			frames = int(args[index + 1])
		index += 1

	var game: Node = load("res://scenes/main.tscn").instantiate()
	add_child(game)
	await get_tree().process_frame

	if args.has("--autostart"):
		var ui := game.get_node_or_null("UI")
		if ui != null:
			ui.start_match()
	if args.has("--skip-to-live"):
		await get_tree().process_frame
		Game.session.round_manager.skip_phase()
		for i in 30:
			await get_tree().physics_frame
		Game.session.round_manager.skip_phase()

	if args.has("--freecam"):
		var player_controller = Game.local_player().get_node_or_null("PlayerController")
		if player_controller != null:
			player_controller.toggle_free_camera()
	if args.has("--shop"):
		var ui2 := game.get_node_or_null("UI")
		if ui2 != null:
			ui2.shop.open()

	for i in frames:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw

	var image := get_viewport().get_texture().get_image()
	var error := image.save_png(out_path)
	print("screenshot: %s (error %d, %dx%d)" % [out_path, error, image.get_width(), image.get_height()])
	get_tree().quit(0 if error == OK else 1)
