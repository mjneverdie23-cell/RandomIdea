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
## Prints one line per move with the decision. Off in normal builds.
const DEBUG_LOG := false

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
	var progress := progress_of(score, collected)
	_proximity = lookup_win_probability(_level_index, moves_left, progress)
	if moves_left <= 1 and progress >= RESCUE_MIN_PROGRESS:
		_assist_chance = 1.0  # Last move, close to winning: every refill makes a match.
	elif _proximity < ASSIST_BELOW:
		_assist_chance = ASSIST_CHANCE
	else:
		_assist_chance = 0.0
	if DEBUG_LOG:
		print(
			(
				"DDA move: moves_left %d progress %.2f proximity %.2f assist %.0f%%"
				% [moves_left, progress, _proximity, _assist_chance * 100.0]
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
	if tier != _tier:
		_apply_tier(tier)
		if DEBUG_LOG:
			print("DDA tier -> %s (smoothed %.2f)" % [Tier.keys()[tier], _smoothed])
	return _tier


## The Board's colour source. `allowed`: colour ids the Board may use here (never empty).
## `matching`: the ones that would complete a line where the gem lands. Always returns a
## member of `allowed` (or of `matching`, which only ever holds real colours of the level).
func get_next_gem_color(allowed: PackedInt32Array, matching: PackedInt32Array) -> int:
	if not matching.is_empty() and _assist_chance > 0.0 and _rng.randf() < _assist_chance:
		forced_spawns += 1
		for color in matching:
			if _goal_colors.has(color):
				return color  # Help that also counts towards a collect goal.
		return matching[_rng.randi_range(0, matching.size() - 1)]

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
			return calm[_rng.randi_range(0, calm.size() - 1)]
	random_spawns += 1
	return pool[_rng.randi_range(0, pool.size() - 1)]


# --- Revival offer ------------------------------------------------------------------------


## legacyPassProximityTreatment. Call when the player runs out of moves. Measures how close
## they were (chance to win with REVIVAL_REFERENCE_MOVES more moves) and prices the offer.
func legacy_pass_proximity_treatment(
	score: int, collected: Dictionary
) -> MonetizationModel.RevivalOffer:
	var progress := progress_of(score, collected)
	var proximity := lookup_win_probability(_level_index, REVIVAL_REFERENCE_MOVES, progress)
	var offer := MonetizationModel.make_offer(
		proximity,
		MetaProgression.get_losing_streak(),
		MetaProgression.get_level_fails(_level_index),
		MetaProgression.get_lives(),
		MetaProgression.MAX_LIVES,
		MetaProgression.get_race_rank(),
		MetaProgression.RACE_SIZE
	)
	if DEBUG_LOG:
		print("DDA revival: progress %.2f -> %s" % [progress, offer])
	return offer


# --- Internals ----------------------------------------------------------------------------


func _apply_tier(tier: Tier) -> void:
	_tier = tier
	_avoid_chance = AVOID_CHANCE if tier == Tier.HARDER else 0.0
	_palette.clear()
	for color in _color_count:
		_palette.append(color)
	if tier == Tier.EASIER and _color_count >= MIN_PALETTE_TO_DROP:
		# Fewer colours means more matches. Never drop a colour a collect goal needs.
		for color in range(_color_count - 1, -1, -1):
			if not _goal_colors.has(color):
				_palette.remove_at(_palette.find(color))
				break


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
