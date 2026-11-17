extends TestSuite
## GameState save/load, using a separate file so the player's save is never touched.

const GAME_STATE_SCRIPT := preload("res://autoload/game_state.gd")
const TEST_SAVE := "user://test_save.json"


func test_progress_round_trip() -> void:
	DirAccess.remove_absolute(TEST_SAVE)
	var state := _new_state()
	check(state.is_unlocked(0) and not state.is_unlocked(1), "a fresh start opens level 1 only")
	state.record_win(0, 1234, 2)
	state.set_music_enabled(false)

	var again := _new_state()
	check(again.is_unlocked(1), "winning level 1 unlocks level 2")
	check_eq(again.best_score(0), 1234, "best score saved")
	check_eq(again.best_stars(0), 2, "best stars saved")
	check(not again.music_enabled, "music setting saved")
	again.record_win(0, 500, 1)
	check_eq(again.best_score(0), 1234, "a worse result keeps the best score")
	check_eq(again.best_stars(0), 2, "a worse result keeps the best stars")
	state.free()
	again.free()
	DirAccess.remove_absolute(TEST_SAVE)


func test_broken_save_starts_fresh() -> void:
	_write(TEST_SAVE, "{not json")
	var state := _new_state()
	check(state.is_unlocked(0) and not state.is_unlocked(1), "unreadable save: fresh start")

	_write(TEST_SAVE, '{"unlocked": "lots", "best_scores": {"0": "x", "abc": 5}, "music": 3}')
	state.load_progress()
	check(not state.is_unlocked(1), "bad unlocked value is ignored")
	check_eq(state.best_score(0), 0, "bad score is ignored")
	check(state.music_enabled, "bad music value falls back to on")
	state.free()
	DirAccess.remove_absolute(TEST_SAVE)


func _new_state() -> Node:
	var state: Node = GAME_STATE_SCRIPT.new()
	state.save_path = TEST_SAVE
	state.load_progress()
	return state


func _write(path: String, text: String) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(text)
	file.close()
