## Owns every screen and decides who has the mouse.
##
## The single place that connects input to menus, so adding a screen means adding
## it here and nowhere else.
extends CanvasLayer

@onready var hud: CanvasLayer = $HUD

var shop: ShopUI
var scoreboard: Scoreboard
var class_select: ClassSelect
var start_screen: StartScreen
var match_end: MatchEndScreen

var player_controller: PlayerController
var _match_running: bool = false

func _ready() -> void:
	var layer := Control.new()
	layer.name = "Overlays"
	layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(layer)

	shop = ShopUI.new()
	scoreboard = Scoreboard.new()
	class_select = ClassSelect.new()
	start_screen = StartScreen.new()
	match_end = MatchEndScreen.new()
	for screen in [shop, scoreboard, class_select, start_screen, match_end]:
		layer.add_child(screen)

	start_screen.play_pressed.connect(start_match)
	start_screen.class_pressed.connect(func(): class_select.open())
	match_end.restart_pressed.connect(_on_restart_pressed)

	Events.round_phase_changed.connect(_on_phase_changed)
	hud.set("show_debug", OS.get_cmdline_user_args().has("--debug"))

func bind_player(controller: PlayerController) -> void:
	player_controller = controller
	_sync_mouse()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		_close_all()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("toggle_shop"):
		_toggle_shop()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("scoreboard"):
		scoreboard.open()
	elif event.is_action_released("scoreboard"):
		scoreboard.close()

func _toggle_shop() -> void:
	if not Game.is_buy_phase():
		hud.show_banner("Shop closed", "Buy phase only", Color("ff4d4d"), 1.2)
		return
	shop.toggle()
	_sync_mouse()

func _close_all() -> void:
	shop.close()
	class_select.close()
	scoreboard.close()
	_sync_mouse()

## Closes the title card and starts the match. Also used by tools/screenshot.gd.
func start_match() -> void:
	start_screen.close()
	if not _match_running:
		_match_running = true
		Game.session.start()
	_sync_mouse()

func _on_restart_pressed() -> void:
	match_end.close()
	await Game.restart()
	# The session was rebuilt: re-attach the camera and controller to the new player.
	get_tree().call_group("match_root", "attach_local_player")
	_sync_mouse()

func _on_phase_changed(phase: GameEnums.RoundPhase, _previous, _round: int) -> void:
	# Open the shop automatically at the start of each buy phase - a prototype
	# convenience so the economy is always visible.
	if not _match_running:
		return
	if phase == GameEnums.RoundPhase.BUY and not _any_overlay_open():
		shop.open()
		_sync_mouse()
	elif phase == GameEnums.RoundPhase.LIVE and shop.visible:
		shop.close()
		_sync_mouse()

func _any_overlay_open() -> bool:
	return shop.visible or class_select.visible or match_end.visible or start_screen.visible

## The mouse is captured only while nothing else needs it.
func _sync_mouse() -> void:
	var overlay_open := _any_overlay_open()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if overlay_open else Input.MOUSE_MODE_CAPTURED
	if player_controller != null:
		player_controller.set_input_enabled(not overlay_open)
