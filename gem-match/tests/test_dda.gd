extends TestSuite
## DDAManager: the data table, the per-move treatments and the gem colour source.
## Needs the DDAManager and MetaProgression autoloads; skipped without them.


func test_table_loads_and_behaves() -> void:
	var dda := _dda()
	if dda == null:
		return
	check(dda.has_data(), "the CSV loaded")
	check_eq(dda.lookup_win_probability(0, 5, 1.0), 1.0, "a finished level is a sure win")
	check_eq(dda.lookup_win_probability(99, 5, 0.5), 0.5, "unknown level: neutral")
	check_eq(dda.lookup_win_probability(0, 0, 0.5), 0.0, "no moves left: no win")
	for level in _levels().size():
		var moves: int = _levels()[level].moves
		var previous := -1.0
		for bucket in 20:
			var p: float = dda.lookup_win_probability(level, moves, bucket / 20.0)
			check(p >= 0.0 and p <= 1.0, "probabilities are in [0, 1]")
			check(p >= previous, "more progress never lowers the chance (level %d)" % level)
			previous = p
		check(
			(
				dda.lookup_win_probability(level, moves, 0.5)
				>= dda.lookup_win_probability(level, 1, 0.5)
			),
			"more moves never lowers the chance (level %d)" % level
		)


func test_spawns_stay_in_bounds_and_rescue_forces_matches() -> void:
	var dda := _dda()
	if dda == null:
		return
	var level: LevelData = _levels()[2]  # 5 colours, collect emeralds
	dda.begin_level(2, level)
	dda.set_seed(1)
	var allowed := PackedInt32Array([0, 1, 2, 3, 4])
	var matching := PackedInt32Array([1, 3])
	for _i in 200:
		check(allowed.has(dda.get_next_gem_color(allowed, matching)), "always a real colour")

	# Last move, nearly done: every refill is forced to make a match.
	var collected := {level.collect_goals[0].gem_type: level.collect_goals[0].amount - 2}
	dda.pass_proximity_treatment(1, level.star_scores[0] - 50, collected)
	check_eq(dda.get_assist_chance(), 1.0, "last-move rescue is on")
	for _i in 50:
		check(matching.has(dda.get_next_gem_color(allowed, matching)), "rescue spawns match")
	var goal_color := level.gem_types.find(level.collect_goals[0].gem_type)
	var with_goal := PackedInt32Array([1, goal_color])
	check_eq(dda.get_next_gem_color(allowed, with_goal), goal_color, "help prefers goal gems")


func test_difficulty_tiers() -> void:
	var dda := _dda()
	if dda == null:
		return
	var level: LevelData = _levels()[4]  # 5 colours, no collect goal
	dda.begin_level(4, level)
	dda.set_seed(2)
	for _i in 10:  # Far behind with few moves left.
		dda.pass_proximity_treatment(2, 0, {})
		dda.difficulty_actions_component()
	check_eq(dda.get_tier(), dda.Tier.EASIER, "struggling players get an easier tier")
	check_eq(dda.get_assist_chance(), dda.ASSIST_CHANCE, "and 10% forced help")
	var seen := {}
	for _i in 400:
		seen[dda.get_next_gem_color(PackedInt32Array([0, 1, 2, 3, 4]), PackedInt32Array())] = true
	check_eq(seen.size(), 4, "EASIER drops one colour from refills")

	for _i in 10:  # Goals almost done with plenty of moves left.
		dda.pass_proximity_treatment(level.moves, level.star_scores[0] - 10, {})
		dda.difficulty_actions_component()
	check_eq(dda.get_tier(), dda.Tier.HARDER, "dominating players get a harder tier")
	check_eq(dda.get_assist_chance(), 0.0, "and no help")


func test_revival_offer_is_priced() -> void:
	var dda := _dda()
	if dda == null:
		return
	var level: LevelData = _levels()[1]
	dda.begin_level(1, level)
	var goal := level.collect_goals[0]
	var close: MonetizationModel.RevivalOffer = dda.legacy_pass_proximity_treatment(
		level.star_scores[0], {goal.gem_type: goal.amount - 2}
	)
	var far: MonetizationModel.RevivalOffer = dda.legacy_pass_proximity_treatment(0, {})
	check(close.proximity > far.proximity, "more progress, higher proximity")
	check(close.ad_moves < far.ad_moves, "closer players get fewer ad moves")
	for offer in [close, far]:
		check(offer.ad_moves >= 3 and offer.ad_moves <= 5, "ad moves in 3..5")
		check(offer.iap_moves >= 5 and offer.iap_moves <= 10, "purchase moves in 5..10")
		check(offer.reward_multiplier >= 1.0 and offer.reward_multiplier <= 2.0, "multiplier")


func _dda() -> Node:
	var root := get_tree().root
	if root.has_node("DDAManager") and root.has_node("MetaProgression"):
		return root.get_node("DDAManager")
	print("          (skipped: DDAManager/MetaProgression autoloads not loaded)")
	return null


## Loaded at runtime rather than preloaded into a const (see GameState.CATALOG_PATH).
func _levels() -> Array[LevelData]:
	var catalog: LevelCatalog = load("res://levels/catalog.tres")
	return catalog.levels
