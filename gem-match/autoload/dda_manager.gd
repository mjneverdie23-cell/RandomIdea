extends Node
## Autoload "DDAManager": Dynamic Difficulty Adjustment.
##
## Data: res://data/pass_proximity.csv holds, for every level, moves left and goal-progress
## bucket, the observed chance of going on to win ("Pass Proximity"). It is parsed once in
## _ready() into a flat PackedFloat32Array, so a lookup is one array index (O(1), no
## allocation). The table is built by tools/sim/make_proximity_csv.py.
##
## Per move (called by the level controller as the swap is accepted, before the swap's
## cascades refill the board):
##   pass_proximity_treatment()  - how close is the player to winning? If behind, 10% of
##                                  refilled gems are forced to make a match; on the last move,
##                                  if close, all of them are (the "rescue").
##   difficulty_actions_component() - on a smoothed proximity: EASIER drops one non-goal
##                                  colour from refills (fewer colours, more matches),
##                                  HARDER steers 10% of refills away from matches.
## Every new gem's colour then comes from get_next_gem_color(), which the Board calls.
##
## On losing: legacy_pass_proximity_treatment() prices the revival offer (MonetizationModel).
##
## Logging: with debug_log on (the default when running from the editor), every DDA function
## prints a "[DDA] function_name: ..." line to the Output panel, saying what it decided and
## why. get_next_gem_color() runs for every new gem, so it only prints when it forces or
## avoids a match; the rest are counted and summed up once per move.

enum Tier { EASIER, NORMAL, HARDER }

const DATA_PATH := "res://data/pass_proximity.csv"
## Progress buckets per row; MUST match tools/sim/make_proximity_csv.py.
const BUCKETS := 20
## While the player is behind, this share of refilled gems is forced to help (the rest stay
## random).
const ASSIST_CHANCE := 0.10
## Pass Proximity below which the player counts as falling behind.
const ASSIST_BELOW := 0.40
## Last-move rescue (every refill makes a match) only for players at least this far along,
## so it turns near-misses into wins without carrying players who were far behind.
const RESCUE_MIN_PROGRESS := 0.6
## Weight of the newest proximity in the smoothed value that drives the difficulty tier.
const SMOOTHING := 0.35
const EASIER_BELOW := 0.30
const HARDER_ABOVE := 0.85
## The tier only changes back after moving this far past the threshold (no flip-flopping).
const HYSTERESIS := 0.05
## HARDER tier: share of refilled gems steered away from making a match.
const AVOID_CHANCE := 0.10
## EASIER tier only drops a colour from palettes at least this big.
const MIN_PALETTE_TO_DROP := 5
## The revival offer is measured against this many extra moves.
const REVIVAL_REFERENCE_MOVES := 5
## Prints what every DDA function does to the Output panel. On in debug builds (running
## from the editor), off in release exports. Set it to false to silence the DDA.
var debug_log: bool = OS.is_debug_build()

## Spawn counters since the level started, for debugging and analytics.
var forced_spawns: int = 0
var avoided_spawns: int = 0
var random_spawns: int = 0

var _table := PackedFloat32Array()
var _level_offset := PackedInt32Array()  # level index -> first entry in _table
var _level_max_moves := PackedInt32Array()  # level index -> highest moves_left row
var _rng := RandomNumberGenerator.new()

var _level_index: int = -1
var _level: LevelData
var _color_count: int = 0
var _goal_colors := PackedInt32Array()
var _palette := PackedInt32Array()
var _proximity: float = 0.5
var _smoothed: float = 0.5
var _tier: Tier = Tier.NORMAL
var _assist_chance: float = 0.0
var _avoid_chance: float = 0.0
# Spawns since the last per-move report, for the log.
var _report_forced: int = 0
var _report_avoided: int = 0
var _report_random: int = 0


func _ready() -> void:
	_rng.randomize()
	_load_table()


## True if the data table loaded. Without it every proximity is a neutral 0.5.
func has_data() -> bool:
	return not _table.is_empty()


## For tests and replays: makes every DDA decision reproducible.
func set_seed(value: int) -> void:
	_rng.seed = value


func get_proximity() -> float:
	return _proximity


func get_tier() -> Tier:
	return _tier


func get_assist_chance() -> float:
	return _assist_chance


# --- Level lifecycle ----------------------------------------------------------------------


## Call when a level scene starts, before the Board spawns anything.
func begin_level(level_index: int, level: LevelData) -> void:
	_level_index = level_index
	_level = level
	_color_count = level.gem_types.size()
	_goal_colors.clear()
	for goal in level.collect_goals:
		_goal_colors.append(level.gem_types.find(goal.gem_type))
	_proximity = lookup_win_probability(level_index, level.moves, 0.0)
	_smoothed = _proximity
	_assist_chance = 0.0
	forced_spawns = 0
	avoided_spawns = 0
	random_spawns = 0
	_report_forced = 0
	_report_avoided = 0
	_report_random = 0
	if debug_log:
		var goals := PackedStringArray(["%d points" % level.star_scores[0]])
		for goal in level.collect_goals:
			goals.append("%d %s" % [goal.amount, goal.gem_type.display_name])
		_log(
			"begin_level",
			(
				"level %d, %d moves, %d colours, goals: %s. Start proximity %.2f%s"
				% [
					level_index + 1,
					level.moves,
					_color_count,
					", ".join(goals),
					_proximity,
					"" if has_data() else " (no data table: neutral 0.5)",
				]
			)
		)
	_apply_tier(Tier.NORMAL)


## Goal completion in [0, 1]: the mean of each goal's capped completion, where the goals are
## the 1-star score and every collect goal. MUST match tools/sim/simulator.py progress_of().
func progress_of(score: int, collected: Dictionary) -> float:
	if _level == null:
		return 0.0
	var total := minf(1.0, float(score) / maxf(_level.star_scores[0], 1))
	for goal in _level.collect_goals:
		total += minf(1.0, float(collected.get(goal.gem_type, 0)) / maxf(goal.amount, 1))
	return total / (1 + _level.collect_goals.size())


## Chance of winning from this state, straight from the table. Returns 0.5 (neutral) when
## there is no data for the level.
func lookup_win_probability(level_index: int, moves_left: int, progress: float) -> float:
	if progress >= 1.0:
		return 1.0
	if level_index < 0 or level_index >= _level_offset.size():
		return 0.5
	var max_moves := _level_max_moves[level_index]
	if max_moves < 0:
		return 0.5
	var m := clampi(moves_left, 0, max_moves)
	var bucket := clampi(floori(progress * BUCKETS), 0, BUCKETS - 1)
	return _table[_level_offset[level_index] + m * BUCKETS + bucket]


# --- Per-move systems ---------------------------------------------------------------------


## passProximityTreatment. Call on every accepted move, with the moves left BEFORE the move
## and the score / collected gems so far. Returns the Pass Proximity it measured.
func pass_proximity_treatment(moves_left: int, score: int, collected: Dictionary) -> float:
	_log_spawn_report()
	var progress := progress_of(score, collected)
	_proximity = lookup_win_probability(_level_index, moves_left, progress)
	var decision: String
	if moves_left <= 1 and progress >= RESCUE_MIN_PROGRESS:
		_assist_chance = 1.0  # Last move, close to winning: every refill makes a match.
		decision = (
			"RESCUE: last move and %.0f%% done, every refill makes a match" % (progress * 100)
		)
	elif _proximity < ASSIST_BELOW:
		_assist_chance = ASSIST_CHANCE
		decision = (
			"ASSIST: behind (proximity < %.2f), %.0f%% of refills forced to match"
			% [ASSIST_BELOW, ASSIST_CHANCE * 100]
		)
	else:
		_assist_chance = 0.0
		decision = "no help: on track"
	_log(
		"pass_proximity_treatment",
		(
			"moves left %d, progress %.0f%%, proximity %.2f -> %s"
			% [moves_left, progress * 100, _proximity, decision]
		)
	)
	return _proximity


## difficultyActionsComponent. Call right after pass_proximity_treatment(). Moves the
## difficulty tier on a smoothed proximity, with hysteresis, and returns it.
func difficulty_actions_component() -> Tier:
	_smoothed = lerpf(_smoothed, _proximity, SMOOTHING)
	var tier := _tier
	if tier == Tier.EASIER and _smoothed > EASIER_BELOW + HYSTERESIS:
		tier = Tier.NORMAL
	elif tier == Tier.HARDER and _smoothed < HARDER_ABOVE - HYSTERESIS:
		tier = Tier.NORMAL
	if tier == Tier.NORMAL:
		if _smoothed < EASIER_BELOW:
			tier = Tier.EASIER
		elif _smoothed > HARDER_ABOVE:
			tier = Tier.HARDER
	var previous := _tier
	if tier != _tier:
		_apply_tier(tier)
	_log(
		"difficulty_actions_component",
		(
			"smoothed proximity %.2f -> tier %s%s"
			% [
				_smoothed,
				Tier.keys()[_tier],
				" (was %s)" % Tier.keys()[previous] if previous != _tier else " (unchanged)",
			]
		)
	)
	return _tier


## The Board's colour source. `allowed`: colour ids the Board may use here (never empty).
## `matching`: the ones that would complete a line where the gem lands. Always returns a
## member of `allowed` (or of `matching`, which only ever holds real colours of the level).
func get_next_gem_color(allowed: PackedInt32Array, matching: PackedInt32Array) -> int:
	if not matching.is_empty() and _assist_chance > 0.0 and _rng.randf() < _assist_chance:
		forced_spawns += 1
		_report_forced += 1
		var forced := matching[_rng.randi_range(0, matching.size() - 1)]
		for color in matching:
			if _goal_colors.has(color):
				forced = color  # Help that also counts towards a collect goal.
				break
		_log(
			"get_next_gem_color",
			(
				"FORCED %s (completes a match%s)"
				% [_color_name(forced), ", goal gem" if _goal_colors.has(forced) else ""]
			)
		)
		return forced

	var pool := allowed
	if _palette.size() < _color_count:
		var narrowed := PackedInt32Array()
		for color in allowed:
			if _palette.has(color):
				narrowed.append(color)
		if not narrowed.is_empty():
			pool = narrowed
	if not matching.is_empty() and _avoid_chance > 0.0 and _rng.randf() < _avoid_chance:
		var calm := PackedInt32Array()
		for color in pool:
			if not matching.has(color):
				calm.append(color)
		if not calm.is_empty():
			avoided_spawns += 1
			_report_avoided += 1
			var chosen := calm[_rng.randi_range(0, calm.size() - 1)]
			_log(
				"get_next_gem_color",
				(
					"AVOIDED a match (HARDER tier): %s instead of a matching colour"
					% _color_name(chosen)
				)
			)
			return chosen
	random_spawns += 1
	_report_random += 1
	return pool[_rng.randi_range(0, pool.size() - 1)]


# --- Revival offer ------------------------------------------------------------------------


## legacyPassProximityTreatment. Call when the player runs out of moves. Measures how close
## they were (chance to win with REVIVAL_REFERENCE_MOVES more moves) and prices the offer.
func legacy_pass_proximity_treatment(
	score: int, collected: Dictionary
) -> MonetizationModel.RevivalOffer:
	var progress := progress_of(score, collected)
	var proximity := lookup_win_probability(_level_index, REVIVAL_REFERENCE_MOVES, progress)
	var streak := MetaProgression.get_losing_streak()
	var fails := MetaProgression.get_level_fails(_level_index)
	var lives := MetaProgression.get_lives()
	var rank := MetaProgression.get_race_rank()
	var offer := MonetizationModel.make_offer(
		proximity, streak, fails, lives, MetaProgression.MAX_LIVES, rank, MetaProgression.RACE_SIZE
	)
	_log_spawn_report()
	_log(
		"legacy_pass_proximity_treatment",
		(
			"progress %.0f%%, proximity with %d more moves %.2f"
			% [progress * 100, REVIVAL_REFERENCE_MOVES, proximity]
		)
	)
	_log(
		"legacy_pass_proximity_treatment",
		(
			"streak %d, level fails %d, lives %d/%d, race #%d of %d"
			% [streak, fails, lives, MetaProgression.MAX_LIVES, rank, MetaProgression.RACE_SIZE]
		)
	)
	_log(
		"legacy_pass_proximity_treatment",
		(
			"multiplier x%.2f = %s"
			% [
				offer.reward_multiplier,
				MonetizationModel.describe_multiplier(
					proximity,
					streak,
					fails,
					lives,
					MetaProgression.MAX_LIVES,
					rank,
					MetaProgression.RACE_SIZE
				),
			]
		)
	)
	_log(
		"legacy_pass_proximity_treatment",
		"offer: watch ad +%d moves, buy +%d moves" % [offer.ad_moves, offer.iap_moves]
	)
	return offer


# --- Internals ----------------------------------------------------------------------------


func _apply_tier(tier: Tier) -> void:
	_tier = tier
	_avoid_chance = AVOID_CHANCE if tier == Tier.HARDER else 0.0
	_palette.clear()
	for color in _color_count:
		_palette.append(color)
	var dropped := -1
	if tier == Tier.EASIER and _color_count >= MIN_PALETTE_TO_DROP:
		# Fewer colours means more matches. Never drop a colour a collect goal needs.
		for color in range(_color_count - 1, -1, -1):
			if not _goal_colors.has(color):
				_palette.remove_at(_palette.find(color))
				dropped = color
				break
	var action := "refills use all %d colours" % _color_count
	if dropped != -1:
		action = "refills skip %s (fewer colours, more matches)" % _color_name(dropped)
	elif tier == Tier.EASIER:
		action += " (palette too small to drop one)"
	if tier == Tier.HARDER:
		action += ", %.0f%% of refills avoid making a match" % (AVOID_CHANCE * 100)
	_log("_apply_tier", "tier %s: %s" % [Tier.keys()[tier], action])


## Parses the CSV into _table. Rows may come in any order; missing rows read as 0.
func _load_table() -> void:
	var file := FileAccess.open(DATA_PATH, FileAccess.READ)
	if file == null:
		push_warning("DDAManager: %s not found; difficulty adjustment is off." % DATA_PATH)
		return
	file.get_csv_line()  # Header.
	var rows: Array[PackedStringArray] = []
	var max_moves := {}
	while not file.eof_reached():
		var row := file.get_csv_line()
		if row.size() < 4 or not row[0].is_valid_int() or row[0].to_int() < 1:
			continue
		rows.append(row)
		var level := row[0].to_int() - 1
		max_moves[level] = maxi(max_moves.get(level, 0), row[1].to_int())
	if rows.is_empty():
		push_warning("DDAManager: %s has no rows; difficulty adjustment is off." % DATA_PATH)
		return

	var level_count: int = max_moves.keys().max() + 1
	_level_offset.resize(level_count)
	_level_max_moves.resize(level_count)
	var size := 0
	for level in level_count:
		var top: int = max_moves.get(level, -1)
		_level_offset[level] = size
		_level_max_moves[level] = top
		size += (top + 1) * BUCKETS if top >= 0 else 0
	_table.resize(size)
	for row in rows:
		var level := row[0].to_int() - 1
		var moves_left := row[1].to_int()
		var bucket := row[2].to_int()
		if moves_left < 0 or bucket < 0 or bucket >= BUCKETS:
			continue
		var index := _level_offset[level] + moves_left * BUCKETS + bucket
		_table[index] = clampf(row[3].to_float(), 0.0, 1.0)
	_log(
		"_load_table",
		"loaded %d rows for %d levels from %s" % [rows.size(), level_count, DATA_PATH]
	)


## Sums up get_next_gem_color() since the last report (one line instead of one per gem).
func _log_spawn_report() -> void:
	var total := _report_forced + _report_avoided + _report_random
	if total > 0:
		_log(
			"get_next_gem_color",
			(
				"%d gems spawned since last report: %d forced, %d avoided, %d random%s"
				% [
					total,
					_report_forced,
					_report_avoided,
					_report_random,
					" (reduced palette)" if _palette.size() < _color_count else "",
				]
			)
		)
	_report_forced = 0
	_report_avoided = 0
	_report_random = 0


func _log(function_name: String, text: String) -> void:
	if debug_log:
		print("[DDA] %s: %s" % [function_name, text])


func _color_name(color: int) -> String:
	if _level == null or color < 0 or color >= _level.gem_types.size():
		return "colour %d" % color
	return _level.gem_types[color].display_name
