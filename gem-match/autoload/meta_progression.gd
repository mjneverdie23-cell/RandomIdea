extends Node
## Autoload "MetaProgression": lives, the losing streak, per-level fails and quits, and the
## weekly race. Everything is computed from UTC timestamps
## (Time.get_unix_time_from_system()), so lives keep regenerating while the game is closed.
## Saved to user://meta.json, separately from GameState's level progress.
##
## Lives (hearts): at most MAX_LIVES. Playing a level costs one, paid when the level starts
## (spend_life_for_level). Winning does not refund it, and losing or quitting costs nothing
## more. While below the maximum, one life comes back every LIFE_REGEN_SECONDS, counted from
## _regen_anchor. On every read, the time since the anchor is turned into whole lives.
##
## Weekly race: weeks start Monday 00:00 UTC. The player scores race points (stars) for
## wins. There is no server yet, so the other RACE_SIZE - 1 racers are bots with a fixed
## pace per week; their points grow as the week goes on. Replace _bot_points() with a real
## leaderboard when there is a backend.
##
## Logging: with debug_log on (the default when running from the editor), every change prints
## a "[Meta] function_name: ..." line to the Output panel. Getters that the level select
## polls every second stay quiet.

signal lives_changed(lives: int)

const MAX_LIVES := 5
const LIFE_REGEN_SECONDS := 3 * 60 * 60
const WEEK_SECONDS := 7 * 24 * 60 * 60
## Unix time 0 was a Thursday; shifting by 3 days makes weeks start on Monday 00:00 UTC.
const WEEK_START_OFFSET := 3 * 24 * 60 * 60
const RACE_SIZE := 30
## Points a bot would have at the end of the week at full pace.
const RACE_BOT_MAX_POINTS := 60
const SAVE_VERSION := 1

## Prints what changes to the Output panel. On in debug builds, off in release exports.
var debug_log: bool = OS.is_debug_build()
## Tests point this somewhere else so they never touch the player's save.
var save_path: String = "user://meta.json"
## Tests set this to fake the clock (unix seconds); -1 uses the real time.
var time_override: int = -1
## Seconds the game was closed for, measured when the save was loaded.
var offline_seconds: int = 0

var _lives: int = MAX_LIVES
var _regen_anchor: int = 0
var _last_seen: int = 0
var _losing_streak: int = 0
var _level_fails: Dictionary = {}  # level index -> fails and quits since its last win
var _race_week: int = -1
var _race_points: int = 0


func _ready() -> void:
	load_state()


func _notification(what: int) -> void:
	# Coming back from the background (mobile) or closing: refresh and record "last seen".
	if what == NOTIFICATION_APPLICATION_RESUMED:
		_apply_regen()
	elif what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED:
		save_state()


func now() -> int:
	return time_override if time_override >= 0 else int(Time.get_unix_time_from_system())


# --- Lives --------------------------------------------------------------------------------


func get_lives() -> int:
	_apply_regen()
	return _lives


func can_play() -> bool:
	return get_lives() > 0


## Pays one heart to start a level. Returns false (and spends nothing) when out of hearts.
func spend_life_for_level(level_index: int) -> bool:
	if not can_play():
		_log("spend_life_for_level", "level %d: no hearts left, cannot start" % (level_index + 1))
		return false
	_lose_life()
	_log(
		"spend_life_for_level",
		"level %d started: 1 heart spent, %d/%d left" % [level_index + 1, _lives, MAX_LIVES]
	)
	save_state()
	return true


## Seconds until the next life arrives, or 0 when lives are full.
func seconds_to_next_life() -> int:
	_apply_regen()
	if _lives >= MAX_LIVES:
		return 0
	return clampi(_regen_anchor + LIFE_REGEN_SECONDS - now(), 0, LIFE_REGEN_SECONDS)


func _lose_life() -> void:
	_apply_regen()
	if _lives >= MAX_LIVES:
		_regen_anchor = now()  # The regen clock starts when the first life is spent.
	_lives = maxi(_lives - 1, 0)
	lives_changed.emit(_lives)
	_log(
		"_lose_life",
		"lost a life: %d/%d left, next in %s" % [_lives, MAX_LIVES, _clock(seconds_to_next_life())]
	)


## Turns the time since _regen_anchor into whole lives, keeping the leftover time.
func _apply_regen() -> void:
	var t := now()
	if _lives >= MAX_LIVES:
		_regen_anchor = t
		return
	if t < _regen_anchor:
		# The clock went backwards. Grant nothing and keep the anchor, so setting the clock
		# back and then forward again cannot mint lives for time that never passed.
		return
	var gained := floori(float(t - _regen_anchor) / LIFE_REGEN_SECONDS)
	if gained <= 0:
		return
	var before := _lives
	_lives = mini(MAX_LIVES, _lives + gained)
	_regen_anchor = t if _lives >= MAX_LIVES else _regen_anchor + gained * LIFE_REGEN_SECONDS
	lives_changed.emit(_lives)
	_log("_apply_regen", "+%d lives from time passed: %d/%d" % [_lives - before, _lives, MAX_LIVES])


# --- Results ------------------------------------------------------------------------------


func record_win(level_index: int, stars: int) -> void:
	_losing_streak = 0
	_level_fails.erase(level_index)
	_roll_race_week()
	_race_points += stars
	_log(
		"record_win",
		(
			"level %d won with %d stars: streak reset, race points %d"
			% [level_index + 1, stars, _race_points]
		)
	)
	save_state()


## A level ended with the player out of moves (after declining the revival). The heart was
## already paid when the level started; this only feeds the streak and fail counts.
func record_loss(level_index: int) -> void:
	_register_failure(level_index, "lost")


## The player left a level they had started (made at least one move). Like a loss, it costs
## no extra heart.
func record_quit(level_index: int) -> void:
	_register_failure(level_index, "quit")


func get_losing_streak() -> int:
	return _losing_streak


func get_level_fails(level_index: int) -> int:
	return _level_fails.get(level_index, 0)


func _register_failure(level_index: int, how: String) -> void:
	_losing_streak += 1
	_level_fails[level_index] = get_level_fails(level_index) + 1
	_log(
		"record_" + ("loss" if how == "lost" else how),
		(
			"level %d %s: losing streak %d, fails on this level %d"
			% [level_index + 1, how, _losing_streak, get_level_fails(level_index)]
		)
	)
	save_state()


# --- Weekly race --------------------------------------------------------------------------


static func week_index(unix_time: int) -> int:
	return floori(float(unix_time + WEEK_START_OFFSET) / WEEK_SECONDS)


func get_race_points() -> int:
	_roll_race_week()
	return _race_points


## 1 = first place, RACE_SIZE = last.
func get_race_rank() -> int:
	_roll_race_week()
	var t := now()
	var week := week_index(t)
	var elapsed := float(t + WEEK_START_OFFSET - week * WEEK_SECONDS) / WEEK_SECONDS
	var rank := 1
	for bot in RACE_SIZE - 1:
		if _bot_points(week, bot, elapsed) > _race_points:
			rank += 1
	return rank


## A bot's points, `elapsed` (0..1) of the way through the week. Each bot has a fixed pace
## per week, from an integer hash, so ranks are stable and need no saved state.
static func _bot_points(week: int, bot: int, elapsed: float) -> int:
	var h := absi((week * 73856093) ^ ((bot + 1) * 19349663)) % 1000
	var pace := 0.15 + 0.85 * h / 999.0
	return int(pace * clampf(elapsed, 0.0, 1.0) * RACE_BOT_MAX_POINTS)


func _roll_race_week() -> void:
	var week := week_index(now())
	if week != _race_week:
		if _race_week != -1:
			_log("_roll_race_week", "new race week: points reset (had %d)" % _race_points)
		_race_week = week
		_race_points = 0


# --- Save / load --------------------------------------------------------------------------


func save_state() -> void:
	_apply_regen()
	_last_seen = now()
	var fails := {}
	for level: int in _level_fails:
		fails[str(level)] = _level_fails[level]
	var data := {
		"version": SAVE_VERSION,
		"lives": _lives,
		"regen_anchor": _regen_anchor,
		"last_seen": _last_seen,
		"losing_streak": _losing_streak,
		"level_fails": fails,
		"race_week": _race_week,
		"race_points": _race_points,
	}
	var temp_path := save_path + ".tmp"
	var file := FileAccess.open(temp_path, FileAccess.WRITE)
	if file == null:
		push_warning("Could not write %s (%s)." % [temp_path, FileAccess.get_open_error()])
		return
	file.store_string(JSON.stringify(data, "\t"))
	file.close()
	if DirAccess.rename_absolute(temp_path, save_path) != OK:
		push_warning("Could not replace %s." % save_path)


## Loads the save ("login") and works out how long the game was closed.
func load_state() -> void:
	_lives = MAX_LIVES
	_regen_anchor = now()
	_last_seen = now()
	_losing_streak = 0
	_level_fails.clear()
	_race_week = -1
	_race_points = 0
	offline_seconds = 0
	if FileAccess.file_exists(save_path):
		var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(save_path))
		if typeof(data) == TYPE_DICTIONARY:
			_lives = clampi(_as_int(data.get("lives"), MAX_LIVES), 0, MAX_LIVES)
			_regen_anchor = _as_int(data.get("regen_anchor"), now())
			_last_seen = _as_int(data.get("last_seen"), now())
			_losing_streak = maxi(_as_int(data.get("losing_streak"), 0), 0)
			_race_week = _as_int(data.get("race_week"), -1)
			_race_points = maxi(_as_int(data.get("race_points"), 0), 0)
			var fails: Variant = data.get("level_fails")
			if typeof(fails) == TYPE_DICTIONARY:
				for key: Variant in fails:
					if str(key).is_valid_int():
						_level_fails[str(key).to_int()] = maxi(_as_int(fails[key], 0), 0)
		else:
			push_warning("Meta save %s is unreadable; starting fresh." % save_path)
	offline_seconds = maxi(now() - _last_seen, 0)
	_apply_regen()
	_roll_race_week()
	_log(
		"load_state",
		(
			"login after %s offline: lives %d/%d, losing streak %d, race points %d"
			% [_clock(offline_seconds), _lives, MAX_LIVES, _losing_streak, _race_points]
		)
	)


func _log(function_name: String, text: String) -> void:
	if debug_log:
		print("[Meta] %s: %s" % [function_name, text])


## Seconds as h:mm:ss.
static func _clock(seconds: int) -> String:
	return "%d:%02d:%02d" % [floori(seconds / 3600.0), floori(seconds / 60.0) % 60, seconds % 60]


static func _as_int(value: Variant, fallback: int) -> int:
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return int(value)
	return fallback
