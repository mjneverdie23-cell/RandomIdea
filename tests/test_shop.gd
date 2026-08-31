## Buy-menu restrictions.
extends TestCase

func _buy_phase() -> Dictionary:
	var session := make_session({"team_size": 1})
	var attacker := session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	var defender := session.add_player("D", &"TANK", GameEnums.Team.TEAM_TWO)
	session.start()
	session.round_manager.skip_phase()
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.BUY, 20.0)
	await advance(session, 0.1)
	return {"session": session, "attacker": attacker, "defender": defender}

func test_buying_in_the_buy_zone_works_and_costs_money() -> void:
	var setup := await _buy_phase()
	var attacker: Character = setup["attacker"]
	attacker.money = 5000
	var result: GameEnums.PurchaseResult = setup["session"].shop.buy(attacker, &"rifle_ranger")
	check_equal(result, GameEnums.PurchaseResult.OK, "the purchase succeeded")
	check_equal(attacker.money, 5000 - Config.weapon(&"rifle_ranger").price, "money was spent")
	check_equal(attacker.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY).id(), &"rifle_ranger",
		"the weapon is in the primary slot")
	setup["session"].queue_free()

func test_classes_cannot_buy_outside_their_categories() -> void:
	var setup := await _buy_phase()
	var defender: Character = setup["defender"]
	defender.money = 16000
	check_equal(setup["session"].shop.buy(defender, &"sniper_longneck"),
		GameEnums.PurchaseResult.CLASS_RESTRICTED, "the tank cannot buy a sniper rifle")
	setup["session"].queue_free()

func test_too_little_money_is_rejected() -> void:
	var setup := await _buy_phase()
	var attacker: Character = setup["attacker"]
	attacker.money = 100
	check_equal(setup["session"].shop.buy(attacker, &"rifle_ranger"),
		GameEnums.PurchaseResult.NOT_ENOUGH_MONEY, "cannot afford it")
	check_equal(attacker.money, 100, "no money was taken")
	setup["session"].queue_free()

func test_defuse_kits_are_defenders_only() -> void:
	var setup := await _buy_phase()
	var attacker: Character = setup["attacker"]
	var defender: Character = setup["defender"]
	attacker.money = 5000
	defender.money = 5000
	check_equal(setup["session"].shop.buy(attacker, &"eq_defuser"),
		GameEnums.PurchaseResult.SIDE_RESTRICTED, "attackers cannot buy a defuse kit")
	check_equal(setup["session"].shop.buy(defender, &"eq_defuser"),
		GameEnums.PurchaseResult.OK, "defenders can")
	check(defender.inventory.has_defuse_kit, "the kit was applied")
	setup["session"].queue_free()

func test_buying_is_blocked_outside_the_zone_and_the_phase() -> void:
	var setup := await _buy_phase()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attacker"]
	attacker.money = 5000
	place(attacker, 0.0, 0.0)
	check_equal(session.shop.buy(attacker, &"rifle_ranger"),
		GameEnums.PurchaseResult.NOT_IN_BUY_ZONE, "cannot buy in the middle of the map")

	place(attacker, 0.0, -66.0)
	session.round_manager.skip_phase()
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.LIVE, 20.0)
	check_equal(session.shop.buy(attacker, &"rifle_ranger"),
		GameEnums.PurchaseResult.WRONG_PHASE, "cannot buy once the round is live")
	session.queue_free()

func test_the_listing_hides_gear_the_class_can_never_use() -> void:
	var setup := await _buy_phase()
	var defender: Character = setup["defender"]
	defender.money = 16000
	var ids: Array[StringName] = []
	for category in setup["session"].shop.list_for(defender):
		for item in category["items"]:
			ids.append(item["id"])
	check(ids.has(&"lmg_thunder"), "the tank sees heavy weapons")
	check(not ids.has(&"sniper_longneck"), "the tank never sees snipers")
	setup["session"].queue_free()

func test_armour_and_grenade_limits() -> void:
	var setup := await _buy_phase()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attacker"]
	attacker.money = 16000
	attacker.health.armor = 0.0
	check_equal(session.shop.buy(attacker, &"eq_helmet"), GameEnums.PurchaseResult.OK, "bought a helmet")
	check_equal(attacker.health.armor, attacker.health.max_armor, "armour was refilled")
	check(attacker.health.has_helmet, "the helmet was applied")
	check_equal(session.shop.buy(attacker, &"eq_helmet"), GameEnums.PurchaseResult.ALREADY_OWNED,
		"buying it twice is refused")

	check_equal(session.shop.buy(attacker, &"eq_frag"), GameEnums.PurchaseResult.OK, "first grenade")
	check_equal(session.shop.buy(attacker, &"eq_frag"), GameEnums.PurchaseResult.OK, "second grenade")
	check_equal(session.shop.buy(attacker, &"eq_frag"), GameEnums.PurchaseResult.ALREADY_OWNED,
		"a third grenade is over the carry limit")
	check_equal(attacker.inventory.grenade_count(&"eq_frag"), 2, "two grenades carried")
	session.queue_free()
