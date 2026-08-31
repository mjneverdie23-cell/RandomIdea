## Carrying, planting, defusing, dropping and detonating the bomb.
extends TestCase

func _live_round(team_size: int = 1) -> Dictionary:
	var session := make_session({"team_size": team_size})
	var attacker := session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	var defender := session.add_player("D", &"RANGER", GameEnums.Team.TEAM_TWO)
	await start_live_round(session)
	session.bomb.reset()
	session.bomb.give_to(attacker)
	return {"session": session, "attacker": attacker, "defender": defender,
		"site": session.map_definition.bomb_sites[0]}

func test_the_bomb_starts_with_an_attacker() -> void:
	var session := make_session({"team_size": 1})
	session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	session.add_player("D", &"RANGER", GameEnums.Team.TEAM_TWO)
	await start_live_round(session)
	check(session.bomb.carrier != null, "someone carries the bomb")
	check_equal(session.teams.side_of(session.bomb.carrier.team_id), GameEnums.Side.ATTACKERS,
		"the carrier is an attacker")
	check(session.bomb.carrier.inventory.has_bomb, "the carrier knows it has the bomb")
	session.queue_free()

func test_planting_requires_standing_in_a_site() -> void:
	var setup := await _live_round()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attacker"]
	var site: BombSiteData = setup["site"]
	place(attacker, 0.0, -60.0)
	await advance(session, 0.3)
	check(not session.bomb.can_plant(attacker), "cannot plant at spawn")

	place(attacker, site.plant_point.x, site.plant_point.z)
	await advance(session, 0.4)
	check(session.bomb.can_plant(attacker), "can plant on the site")
	check(not session.bomb.can_plant(setup["defender"]), "defenders can never plant")
	session.queue_free()

func test_planting_takes_time_and_can_be_interrupted() -> void:
	var setup := await _live_round()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attacker"]
	var site: BombSiteData = setup["site"]
	place(attacker, site.plant_point.x, site.plant_point.z)
	await advance(session, 0.4)

	attacker.intent.use = true
	await advance(session, Config.game.plant_duration * 0.5)
	check_greater(session.bomb.plant_progress, 0.2, "the plant is in progress")
	check_less(session.bomb.plant_progress, 0.9, "the plant is not finished yet")

	attacker.intent.use = false
	await advance(session, 0.3)
	check_equal(session.bomb.plant_progress, 0.0, "letting go loses the progress")
	check_equal(session.bomb.state, GameEnums.BombState.CARRIED, "still carried")

	attacker.intent.use = true
	await advance(session, Config.game.plant_duration + 0.3)
	check_equal(session.bomb.state, GameEnums.BombState.PLANTED, "an uninterrupted plant completes")
	check_equal(session.bomb.site_id, setup["site"].id, "the site was recorded")
	check_equal(attacker.score["plants"], 1, "the planter was credited")
	check(not attacker.inventory.has_bomb, "the carrier no longer holds it")
	session.queue_free()

func test_a_planted_bomb_detonates_and_kills_nearby() -> void:
	var setup := await _live_round()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attacker"]
	var defender: Character = setup["defender"]
	var site: BombSiteData = setup["site"]
	place(attacker, site.plant_point.x, site.plant_point.z)
	await advance(session, 0.4)
	attacker.intent.use = true
	await advance(session, Config.game.plant_duration + 0.3)
	attacker.intent.use = false

	place(defender, site.plant_point.x + 3.0, site.plant_point.z)
	# The round restarts shortly after the blast, so snapshot at blast time.
	# A Dictionary, not a plain bool: GDScript lambdas capture by value, so
	# assigning to a captured local would never reach the test.
	var observed := {"alive": true}
	Events.bomb_exploded.connect(func(_position): observed["alive"] = defender.health.alive)
	var start_fuse := session.bomb.fuse_remaining
	await advance(session, 5.0)
	check_less(session.bomb.fuse_remaining, start_fuse, "the fuse is ticking")

	await advance_until(session, func(): return session.bomb.state == GameEnums.BombState.EXPLODED,
		Config.game.bomb_fuse_duration + 5.0)
	check_equal(session.bomb.state, GameEnums.BombState.EXPLODED, "the bomb went off")
	check(not observed["alive"], "anyone standing on the bomb dies")
	session.queue_free()

func test_defusing_works_and_a_kit_halves_it() -> void:
	var setup := await _live_round()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attacker"]
	var defender: Character = setup["defender"]
	var site: BombSiteData = setup["site"]
	place(attacker, site.plant_point.x, site.plant_point.z)
	await advance(session, 0.4)
	attacker.intent.use = true
	await advance(session, Config.game.plant_duration + 0.3)
	attacker.intent.use = false

	place(defender, session.bomb.position.x + 1.0, session.bomb.position.z)
	await advance(session, 0.3)
	check(session.bomb.can_defuse(defender), "a defender next to the bomb can defuse")
	check(not session.bomb.can_defuse(attacker), "attackers cannot defuse")

	defender.intent.use = true
	await advance(session, 1.0)
	check_greater(session.bomb.defuse_progress, 0.0, "the defuse started")
	check_equal(session.bomb.defuse_duration, Config.game.defuse_duration, "no kit means the slow defuse")

	defender.intent.use = false
	await advance(session, 0.3)
	check_equal(session.bomb.defuse_progress, 0.0, "interrupting resets the progress")

	defender.inventory.has_defuse_kit = true
	defender.intent.use = true
	await advance(session, 0.3)
	check_equal(session.bomb.defuse_duration, Config.game.defuse_duration_with_kit, "a kit halves the defuse")
	await advance(session, Config.game.defuse_duration_with_kit + 0.3)
	check_equal(session.bomb.state, GameEnums.BombState.DEFUSED, "the bomb was defused")
	check_equal(defender.score["defuses"], 1, "the defuser was credited")
	session.queue_free()

func test_killing_the_carrier_drops_the_bomb_and_a_mate_can_take_it() -> void:
	var session := make_session({"team_size": 2})
	var carrier := session.add_player("Carrier", &"RANGER", GameEnums.Team.TEAM_ONE)
	var mate := session.add_player("Mate", &"RANGER", GameEnums.Team.TEAM_ONE)
	session.add_player("D1", &"RANGER", GameEnums.Team.TEAM_TWO)
	session.add_player("D2", &"RANGER", GameEnums.Team.TEAM_TWO)
	await start_live_round(session)
	session.bomb.reset()
	session.bomb.give_to(carrier)

	place(carrier, 0.0, -40.0)
	place(mate, 1.0, -40.0)
	await advance(session, 0.4)

	var drops := record(Events.bomb_dropped)
	session.combat.apply_damage(carrier, null, 999.0, &"test")
	await advance(session, 0.2)
	check_equal(drops.size(), 1, "the bomb dropped where the carrier died")
	check_equal(session.bomb.state, GameEnums.BombState.DROPPED, "it is on the ground")

	mate.intent.use = true
	await advance(session, 0.3)
	check_equal(session.bomb.state, GameEnums.BombState.CARRIED, "it was picked up")
	check_equal(session.bomb.carrier, mate, "the teammate has it")
	session.queue_free()

func test_killing_the_planter_cancels_the_plant() -> void:
	var setup := await _live_round()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attacker"]
	var site: BombSiteData = setup["site"]
	place(attacker, site.plant_point.x, site.plant_point.z)
	await advance(session, 0.4)
	attacker.intent.use = true
	await advance(session, Config.game.plant_duration * 0.6)
	check_equal(session.bomb.planting, attacker, "the plant is under way")

	session.combat.apply_damage(attacker, null, 999.0, &"test")
	await advance(session, 0.2)
	check(session.bomb.planting == null, "the plant was aborted")
	check_equal(session.bomb.state, GameEnums.BombState.DROPPED, "the bomb dropped")
	session.queue_free()

func test_both_sites_accept_a_plant() -> void:
	for site_index in 2:
		var setup := await _live_round()
		var session: MatchSession = setup["session"]
		var attacker: Character = setup["attacker"]
		var site: BombSiteData = session.map_definition.bomb_sites[site_index]
		place(attacker, site.plant_point.x, site.plant_point.z)
		await advance(session, 0.4)
		attacker.intent.use = true
		await advance(session, Config.game.plant_duration + 0.4)
		check_equal(session.bomb.state, GameEnums.BombState.PLANTED, "site %s accepts a plant" % site.id)
		check_equal(session.bomb.site_id, site.id, "the right site was recorded")
		session.queue_free()
		await get_tree().physics_frame
