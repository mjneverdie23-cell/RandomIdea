extends Node
## Autoload "GameState": which level is being played, progress that survives between runs
## (unlocked levels, best scores and stars, sound settings) and scene changes.
## Progress is saved as JSON to user://save.json. A missing or broken save file just means
## a fresh start; it never stops the game from running.

## Emitted when the music or sound-effects toggle changes.
signal settings_changed

const SAVE_VERSION := 1
const CATALOG: LevelCatalog = preload("res://levels/catalog.tres")
const MAIN_MENU_SCENE := "res://scenes/menus/main_menu.tscn"
const LEVEL_SELECT_SCENE := "res://scenes/menus/level_select.tscn"
const LEVEL_SCENE := "res://scenes/main/main.tscn"

## Tests point this somewhere else so they never touch the player's save.
var save_path: String = "user://save.json"
## Index (from 0) of the level being played.
var current_level: int = 0
var music_enabled: bool = true
var sfx_enabled: bool = true

var _unlocked_count: int = 1
var _best_scores: Dictionary = {}  # level index -> int
var _best_stars: Dictionary = {}  # level index -> int


func _ready() -> void:
	load_progress()


func _notification(what: int) -> void:
	# Android back button (project setting quit_on_go_back is off, so this is ours).
	if what == NOTIFICATION_WM_GO_BACK_REQUEST:
		go_back()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		go_back()


# --- Levels -------------------------------------------------------------------------------


func level_count() -> int:
	return CATALOG.levels.size()


func get_level(index: int) -> LevelData:
	return CATALOG.levels[clampi(index, 0, level_count() - 1)]


func is_unlocked(index: int) -> bool:
	return index < _unlocked_count


func has_next_level() -> bool:
	return current_level + 1 < level_count()


func best_score(index: int) -> int:
	return _best_scores.get(index, 0)


func best_stars(index: int) -> int:
	return _best_stars.get(index, 0)


## Stores a finished level. Winning unlocks the next one. Saves straight away.
func record_win(index: int, score: int, stars: int) -> void:
	_unlocked_count = maxi(_unlocked_count, mini(index + 2, level_count()))
	_best_scores[index] = maxi(best_score(index), score)
	_best_stars[index] = maxi(best_stars(index), stars)
	save_progress()


func set_music_enabled(enabled: bool) -> void:
	music_enabled = enabled
	settings_changed.emit()
	save_progress()


func set_sfx_enabled(enabled: bool) -> void:
	sfx_enabled = enabled
	settings_changed.emit()
	save_progress()


# --- Scenes -------------------------------------------------------------------------------


func play_level(index: int) -> void:
	current_level = clampi(index, 0, level_count() - 1)
	_change_scene(LEVEL_SCENE)


func go_to_level_select() -> void:
	_change_scene(LEVEL_SELECT_SCENE)


func go_to_main_menu() -> void:
	_change_scene(MAIN_MENU_SCENE)


## Escape / back: level -> level select -> main menu -> quit. Ignored while the game is
## paused, so a paused popup (the revival lockout) decides when the player may leave.
func go_back() -> void:
	if get_tree().paused:
		return
	var scene := get_tree().current_scene
	if scene == null:
		return
	match scene.scene_file_path:
		LEVEL_SCENE:
			go_to_level_select()
		LEVEL_SELECT_SCENE:
			go_to_main_menu()
		MAIN_MENU_SCENE:
			get_tree().quit()


## A new scene must never start frozen, so every scene change also unpauses.
func _change_scene(path: String) -> void:
	get_tree().paused = false
	get_tree().change_scene_to_file(path)


# --- Save / load --------------------------------------------------------------------------


func save_progress() -> void:
	var data := {
		"version": SAVE_VERSION,
		"unlocked": _unlocked_count,
		"best_scores": _keys_to_strings(_best_scores),
		"best_stars": _keys_to_strings(_best_stars),
		"music": music_enabled,
		"sfx": sfx_enabled,
	}
	# Write to a temporary file first, so a crash mid-write cannot corrupt the real save.
	var temp_path := save_path + ".tmp"
	var file := FileAccess.open(temp_path, FileAccess.WRITE)
	if file == null:
		push_warning("Could not write %s (%s)." % [temp_path, FileAccess.get_open_error()])
		return
	file.store_string(JSON.stringify(data, "\t"))
	file.close()
	if DirAccess.rename_absolute(temp_path, save_path) != OK:
		push_warning("Could not replace %s." % save_path)


func load_progress() -> void:
	_unlocked_count = 1
	_best_scores.clear()
	_best_stars.clear()
	music_enabled = true
	sfx_enabled = true
	if not FileAccess.file_exists(save_path):
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(save_path))
	if typeof(data) != TYPE_DICTIONARY:
		push_warning("Save file %s is unreadable; starting fresh." % save_path)
		return
	_unlocked_count = clampi(_as_int(data.get("unlocked"), 1), 1, maxi(level_count(), 1))
	_best_scores = _int_map(data.get("best_scores"))
	_best_stars = _int_map(data.get("best_stars"))
	music_enabled = _as_bool(data.get("music"), true)
	sfx_enabled = _as_bool(data.get("sfx"), true)


## Wipes all progress (used by tests, and handy while designing levels).
func reset_progress() -> void:
	_unlocked_count = 1
	_best_scores.clear()
	_best_stars.clear()
	save_progress()


static func _keys_to_strings(map: Dictionary) -> Dictionary:
	var out := {}
	for key: int in map:
		out[str(key)] = map[key]
	return out


## JSON gives back string keys and float numbers; turn them into int -> int and skip
## anything malformed.
static func _int_map(value: Variant) -> Dictionary:
	var out := {}
	if typeof(value) != TYPE_DICTIONARY:
		return out
	for key: Variant in value:
		if str(key).is_valid_int():
			out[str(key).to_int()] = _as_int(value[key], 0)
	return out


static func _as_int(value: Variant, fallback: int) -> int:
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return int(value)
	return fallback


static func _as_bool(value: Variant, fallback: bool) -> bool:
	return value if typeof(value) == TYPE_BOOL else fallback
