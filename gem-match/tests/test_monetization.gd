extends TestSuite
## MonetizationModel: the revival offer formulas (pure functions, no autoloads needed).


func test_ad_moves_shrink_as_proximity_grows() -> void:
	check_eq(MonetizationModel.ad_revival_moves(0.0), 5, "far behind: 5 moves")
	check_eq(MonetizationModel.ad_revival_moves(0.2), 5, "20% close: 5 moves")
	check_eq(MonetizationModel.ad_revival_moves(0.55), 4, "halfway: 4 moves")
	check_eq(MonetizationModel.ad_revival_moves(0.9), 3, "90% close: 3 moves")
	check_eq(MonetizationModel.ad_revival_moves(1.0), 3, "already there: 3 moves")
	var previous := 99
	for i in 101:
		var moves := MonetizationModel.ad_revival_moves(i / 100.0)
		check(moves <= previous, "never more moves for a closer player")
		previous = moves


func test_multiplier_bounds_and_extremes() -> void:
	var best := MonetizationModel.reward_multiplier(1.0, 0, 0, 5, 5, 30, 30)
	check_eq(best, 1.0, "a player with no pressure gets exactly the base reward")
	var worst := MonetizationModel.reward_multiplier(0.0, 1000, 1000, 0, 5, 1, 30)
	check(absf(worst - 2.0) < 0.001, "maximum pressure tends to 2x (got %s)" % worst)
	check_eq(MonetizationModel.iap_revival_moves(best), 5, "1x buys 5 moves")
	check_eq(MonetizationModel.iap_revival_moves(worst), 10, "2x buys 10 moves")
	check_eq(MonetizationModel.iap_revival_moves(0.2), 5, "never below the base reward")


func test_multiplier_grows_with_every_input() -> void:
	var base := MonetizationModel.reward_multiplier(0.5, 1, 1, 3, 5, 15, 30)
	check(MonetizationModel.reward_multiplier(0.5, 4, 1, 3, 5, 15, 30) > base, "streak")
	check(MonetizationModel.reward_multiplier(0.5, 1, 4, 3, 5, 15, 30) > base, "fails")
	check(MonetizationModel.reward_multiplier(0.5, 1, 1, 0, 5, 15, 30) > base, "low lives")
	check(MonetizationModel.reward_multiplier(0.5, 1, 1, 3, 5, 2, 30) > base, "race standing")
	check(MonetizationModel.reward_multiplier(0.1, 1, 1, 3, 5, 15, 30) > base, "struggling")


func test_offer_combines_both() -> void:
	var offer := MonetizationModel.make_offer(0.9, 0, 0, 5, 5, 30, 30)
	check_eq(offer.ad_moves, 3, "close player: small ad reward")
	check_eq(offer.iap_moves, 5, "no pressure: base purchase reward")
	var desperate := MonetizationModel.make_offer(0.1, 5, 6, 0, 5, 3, 30)
	check_eq(desperate.ad_moves, 5, "far behind: full ad reward")
	check(desperate.iap_moves >= 8, "high pressure: bigger purchase reward")
