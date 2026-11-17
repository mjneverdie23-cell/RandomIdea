extends TestSuite
## MetaProgression: lives regeneration, streaks, fails and the weekly race, on a fake clock
## and a separate save file.

const META_SCRIPT := preload("res://autoload/meta_progression.gd")
const TEST_SAVE := "user://test_meta.json"
## 2024-01-01 00:00 UTC, a Monday.
const MONDAY := 1704067200
const HOUR := 3600


func test_lives_regenerate_over_time() -> void:
	var meta := _fresh(MONDAY)
	check_eq(meta.get_lives(), 5, "a new player has full lives")
	meta.record_loss(0)
	check_eq(meta.get_lives(), 4, "a loss costs a life")
	check_eq(meta.seconds_to_next_life(), 3 * HOUR, "the next life is 3 hours away")
	meta.time_override = MONDAY + 3 * HOUR - 1
	check_eq(meta.get_lives(), 4, "not quite 3 hours later: still 4")
	meta.time_override = MONDAY + 3 * HOUR
	check_eq(meta.get_lives(), 5, "3 hours later: back to 5")

	meta.time_override = MONDAY + 10 * HOUR
	for _i in 3:
		meta.record_quit(1)
	check_eq(meta.get_lives(), 2, "quits cost lives too")
	meta.time_override = MONDAY + 17 * HOUR
	check_eq(meta.get_lives(), 4, "7 hours later: 2 lives back")
	check_eq(meta.seconds_to_next_life(), 2 * HOUR, "the leftover hour is kept")
	meta.time_override = MONDAY + 5 * HOUR
	check_eq(meta.get_lives(), 4, "turning the clock back gives nothing")
	meta.time_override = MONDAY + 17 * HOUR
	check_eq(meta.get_lives(), 4, "and turning it forward again gives nothing extra")
	check_eq(meta.seconds_to_next_life(), 2 * HOUR, "the real countdown continues")
	_cleanup(meta)


func test_out_of_lives_and_offline_regen() -> void:
	var meta := _fresh(MONDAY)
	for _i in 5:
		meta.record_loss(2)
	check(not meta.can_play(), "0 lives: cannot play")
	meta.save_state()
	var later := _load(MONDAY + 7 * HOUR)
	check_eq(later.offline_seconds, 7 * HOUR, "time away is measured from the last save")
	check_eq(later.get_lives(), 2, "lives regenerated while the game was closed")
	check(later.can_play(), "can play again")
	_cleanup(meta)
	_cleanup(later)


func test_streak_and_level_fails() -> void:
	var meta := _fresh(MONDAY)
	meta.record_loss(3)
	meta.record_quit(3)
	meta.record_loss(4)
	check_eq(meta.get_losing_streak(), 3, "three failures in a row")
	check_eq(meta.get_level_fails(3), 2, "level 4 failed twice")
	meta.record_win(3, 2)
	check_eq(meta.get_losing_streak(), 0, "a win resets the streak")
	check_eq(meta.get_level_fails(3), 0, "and that level's fail count")
	check_eq(meta.get_level_fails(4), 1, "other levels keep theirs")
	_cleanup(meta)


func test_weekly_race() -> void:
	check_eq(
		META_SCRIPT.week_index(MONDAY) - META_SCRIPT.week_index(MONDAY - 1),
		1,
		"weeks start on Monday 00:00 UTC"
	)
	var meta := _fresh(MONDAY)
	check_eq(meta.get_race_rank(), 1, "at the very start of the week everyone has 0")
	meta.time_override = MONDAY + 7 * 24 * HOUR - 1
	check_eq(meta.get_race_rank(), meta.RACE_SIZE, "no points by the end of the week: last")
	meta.record_win(0, 3)
	check_eq(meta.get_race_points(), 3, "stars from wins are race points")
	var rank: int = meta.get_race_rank()
	check(rank >= 1 and rank <= meta.RACE_SIZE, "rank stays in range")
	meta.time_override = MONDAY + 7 * 24 * HOUR
	check_eq(meta.get_race_points(), 0, "a new week resets the points")
	_cleanup(meta)


func _fresh(time: int) -> Node:
	DirAccess.remove_absolute(TEST_SAVE)
	return _load(time)


func _load(time: int) -> Node:
	var meta: Node = META_SCRIPT.new()
	meta.save_path = TEST_SAVE
	meta.time_override = time
	meta.load_state()
	return meta


func _cleanup(meta: Node) -> void:
	meta.free()
	DirAccess.remove_absolute(TEST_SAVE)
