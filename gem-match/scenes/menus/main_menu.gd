extends Control
## Title screen: play, sound toggles and (on desktop) quit.

@onready var _play_button: Button = $Center/Box/PlayButton
@onready var _music_toggle: CheckButton = $Center/Box/MusicToggle
@onready var _sfx_toggle: CheckButton = $Center/Box/SfxToggle
@onready var _quit_button: Button = $Center/Box/QuitButton


func _ready() -> void:
	_play_button.pressed.connect(GameState.go_to_level_select)
	_music_toggle.button_pressed = GameState.music_enabled
	_sfx_toggle.button_pressed = GameState.sfx_enabled
	_music_toggle.toggled.connect(GameState.set_music_enabled)
	_sfx_toggle.toggled.connect(GameState.set_sfx_enabled)
	_quit_button.visible = not (OS.has_feature("web") or OS.has_feature("mobile"))
	_quit_button.pressed.connect(get_tree().quit)
	_play_button.grab_focus.call_deferred()
