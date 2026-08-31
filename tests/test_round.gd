## The round state machine and every win condition.
extends TestCase

func _match(team_size: int = 1) -> Dictionary:
	var session := make_session({"team_size": team_size})
	var attackers: Array[Character] = []
	var defenders: Array[Character] = []
	for i in team_size:
		attackers.append(session.add_player("A%d" % i, &"RANGER", GameEnums.Team.TEAM_ONE))
		defenders.append(session.add_player("D%d" % i, &"RANGER", GameEnums.Team.TEAM_TWO))
	return {"session": session, "attackers": attackers, "defenders": defenders}

func test_phases_run_warmup_then_buy_then_live() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	var phases := record(Events.round_phase_changed)
	session.start()
	check_equal(session.round_manager.phase, GameEnums.RoundPhase.WARMUP, "starts in warmup")

	await advance(session, Config.game.warmup_duration + 0.2)
	check_equal(session.round_manager.phase, GameEnums.RoundPhase.BUY, "warmup leads to the buy phase")
	check_equal(session.match_manager.round_number, 1, "round 1 begins at the first buy phase")

	await advance(session, Config.game.buy_duration + 0.2)
	check_equal(session.round_manager.phase, GameEnums.RoundPhase.LIVE, "the buy phase leads to live")
	check_equal(phases.size(), 3, "three phase changes so far")
	session.queue_free()

func test_players_are_frozen_during_the_buy_phase() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attackers"][0]
	session.start()
	await advance(session, Config.game.warmup_duration + 0.2)
	check(attacker.frozen, "frozen during the buy phase")

	var start := attacker.global_position
	attacker.intent.move_forward = 1.0
	await advance(session, 1.0)
	check_less(start.distance_to(attacker.global_position), 0.3, "cannot walk while frozen")

	session.round_manager.skip_phase()
	await advance(session, 0.2)
	check(not attacker.frozen, "unfrozen once live")
	await advance(session, 1.0)
	check_greater(start.distance_to(attacker.global_position), 1.0, "moves once live")
	session.queue_free()

func test_eliminating_the_defenders_wins_for_the_attackers() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	await start_live_round(session)
	var ended := record(Events.round_ended)
	session.combat.apply_damage(setup["defenders"][0], null, 999.0, &"test")
	await advance(session, 0.2)
	check_equal(ended.size(), 1, "the round ended")
	check_equal(ended[0][2], GameEnums.RoundEndReason.DEFENDERS_ELIMINATED, "for the right reason")
	check_equal(ended[0][1], session.teams.team_id_on_side(GameEnums.Side.ATTACKERS), "attackers won")
	session.queue_free()

func test_eliminating_the_attackers_wins_for_the_defenders() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	await start_live_round(session)
	var ended := record(Events.round_ended)
	session.combat.apply_damage(setup["attackers"][0], null, 999.0, &"test")
	await advance(session, 0.2)
	check_equal(ended[0][2], GameEnums.RoundEndReason.ATTACKERS_ELIMINATED, "attackers were wiped")
	check_equal(ended[0][1], session.teams.team_id_on_side(GameEnums.Side.DEFENDERS), "defenders won")
	session.queue_free()

func test_after_a_plant_wiping_the_attackers_does_not_end_the_round() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attackers"][0]
	var defender: Character = setup["defenders"][0]
	await start_live_round(session)
	session.bomb.reset()
	session.bomb.give_to(attacker)
	var site: BombSiteData = session.map_definition.bomb_sites[0]
	place(attacker, site.plant_point.x, site.plant_point.z)
	await advance(session, 0.4)
	attacker.intent.use = true
	await advance(session, Config.game.plant_duration + 0.3)
	check_equal(session.bomb.state, GameEnums.BombState.PLANTED, "the bomb is planted")

	var ended := record(Events.round_ended)
	session.combat.apply_damage(attacker, null, 999.0, &"test")
	await advance(session, 1.0)
	check_equal(ended.size(), 0, "the bomb is still ticking, so the round continues")

	# The defenders now have to defuse, or lose.
	place(defender, session.bomb.position.x + 1.0, session.bomb.position.z)
	await advance(session, 0.3)
	defender.intent.use = true
	await advance(session, Config.game.defuse_duration + 0.6)
	check_equal(ended.size(), 1, "defusing ended the round")
	check_equal(ended[0][2], GameEnums.RoundEndReason.BOMB_DEFUSED, "for the right reason")
	session.queue_free()

func test_detonation_wins_for_the_attackers_even_if_they_are_dead() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attackers"][0]
	await start_live_round(session)
	session.bomb.reset()
	session.bomb.give_to(attacker)
	var site: BombSiteData = session.map_definition.bomb_sites[1]
	place(attacker, site.plant_point.x, site.plant_point.z)
	await advance(session, 0.4)
	attacker.intent.use = true
	await advance(session, Config.game.plant_duration + 0.3)

	var ended := record(Events.round_ended)
	session.combat.apply_damage(attacker, null, 999.0, &"test")
	await advance_until(session, func(): return ended.size() > 0, Config.game.bomb_fuse_duration + 6.0)
	check_equal(ended.size(), 1, "the round ended")
	check_equal(ended[0][2], GameEnums.RoundEndReason.BOMB_DETONATED, "the bomb detonated")
	check_equal(ended[0][1], session.teams.team_id_on_side(GameEnums.Side.ATTACKERS), "attackers won")
	session.queue_free()

func test_running_out_of_time_wins_for_the_defenders() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	await start_live_round(session)
	var ended := record(Events.round_ended)
	await advance(session, Config.game.round_duration + 0.5)
	check_equal(ended.size(), 1, "the clock ended the round")
	check_equal(ended[0][2], GameEnums.RoundEndReason.TIME_EXPIRED, "time expired")
	check_equal(ended[0][1], session.teams.team_id_on_side(GameEnums.Side.DEFENDERS), "defenders won")
	session.queue_free()

func test_the_clock_switches_to_the_fuse_once_planted() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attackers"][0]
	await start_live_round(session)
	session.bomb.reset()
	session.bomb.give_to(attacker)
	var site: BombSiteData = session.map_definition.bomb_sites[0]
	place(attacker, site.plant_point.x, site.plant_point.z)
	await advance(session, 0.4)
	var round_clock := session.round_manager.time_remaining()
	attacker.intent.use = true
	await advance(session, Config.game.plant_duration + 0.3)
	check_less(session.round_manager.time_remaining(), round_clock, "the displayed clock switched")
	check_almost(session.round_manager.time_remaining(), session.bomb.fuse_remaining, 0.05,
		"the clock now shows the fuse")
	session.queue_free()

func test_a_new_round_respawns_everyone_and_rearms_the_bomb() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attackers"][0]
	var defender: Character = setup["defenders"][0]
	await start_live_round(session)
	attacker.health.health = 10.0
	session.combat.apply_damage(defender, null, 999.0, &"test")

	await advance_until(session, func():
		return session.round_manager.phase == GameEnums.RoundPhase.BUY \
			and session.match_manager.round_number == 2, 30.0)
	check_equal(session.match_manager.round_number, 2, "round two started")
	check(defender.health.alive, "the dead are back")
	check_equal(attacker.health.health, attacker.health.max_health, "health was restored")
	check(session.bomb.carrier != null, "the bomb is back with an attacker")
	session.queue_free()

func test_survivors_keep_weapons_and_the_dead_lose_them() -> void:
	var setup := _match()
	var session: MatchSession = setup["session"]
	var attacker: Character = setup["attackers"][0]
	var defender: Character = setup["defenders"][0]
	await start_live_round(session)
	attacker.inventory.give_weapon(&"rifle_ranger")
	defender.inventory.give_weapon(&"rifle_ranger")
	session.combat.apply_damage(defender, null, 999.0, &"test")

	await advance_until(session, func():
		return session.round_manager.phase == GameEnums.RoundPhase.BUY \
			and session.match_manager.round_number == 2, 30.0)
	check(attacker.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY) != null, "the survivor kept the rifle")
	check(defender.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY) == null, "the dead player must re-buy")
	session.queue_free()
