## Bots: roster, buying, navigation, fighting, and a full short match.
extends TestCase

## Shrinks the match so a full one runs inside a test. Restores on teardown.
func _use_short_match_config() -> GameConfig:
	var original := Config.game
	var short: GameConfig = original.duplicate()
	short.rounds_to_win = 3
	short.switch_sides_after_round = 2
	short.max_rounds = 4
	short.warmup_duration = 2.0
	short.buy_duration = 3.0
	short.round_duration = 45.0
	short.round_end_duration = 2.0
	Config.game = short
	return original

func test_bots_fill_both_teams_with_a_spread_of_classes() -> void:
	var session := make_session({"fill_bots": true})
	await advance(session, 0.2)
	check_equal(session.characters.size(), Config.game.team_size * 2, "both teams are full")
	check_equal(session.bots.size(), Config.game.team_size * 2, "every slot is a bot")
	var classes := {}
	for character in session.characters:
		classes[character.class_id] = true
	check_greater(classes.size(), 2.0, "bots use several classes")
	session.queue_free()

func test_bots_buy_gear_in_the_buy_phase() -> void:
	var session := make_session({"fill_bots": true})
	session.start()
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.BUY, 20.0)
	await advance(session, 0.5)

	var bought_something := 0
	for character in session.characters:
		if character.health.armor > 0.0 or character.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY) != null:
			bought_something += 1
	check_greater(bought_something, 0.0, "bots spent their pistol-round money")

	# With a full wallet they should upgrade on the next buy phase.
	for character in session.characters:
		character.money = 8000
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.LIVE, 30.0)
	session.round_manager._end_round(GameEnums.Team.TEAM_ONE, GameEnums.RoundEndReason.TIME_EXPIRED)
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.BUY, 30.0)
	await advance(session, 0.5)

	var with_primaries := 0
	for character in session.characters:
		if character.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY) != null:
			with_primaries += 1
	check_greater(with_primaries, 4.0, "most bots bought a primary when they could afford one")
	session.queue_free()

func test_bots_leave_spawn_and_head_for_an_objective() -> void:
	var session := make_session({"fill_bots": true, "seed": 5})
	session.start()
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.LIVE, 40.0)
	var starts := {}
	for character in session.characters:
		starts[character] = character.global_position
	await advance(session, 12.0)

	var moved := 0
	for character in session.characters:
		if starts[character].distance_to(character.global_position) > 12.0:
			moved += 1
	check_greater(moved, 5.0, "most bots pushed out of spawn")

	var attacking := false
	var holding := false
	for brain in session.bots:
		if brain.goal in [BotBrain.Goal.PUSH_SITE, BotBrain.Goal.PLANT, BotBrain.Goal.FIGHT]:
			attacking = true
		if brain.goal in [BotBrain.Goal.HOLD_SITE, BotBrain.Goal.DEFUSE, BotBrain.Goal.FIGHT]:
			holding = true
	check(attacking, "attackers are executing an attacking plan")
	check(holding, "defenders are holding or reacting")
	session.queue_free()

func test_bots_fight_and_plant_across_rounds() -> void:
	var original := _use_short_match_config()
	var session := make_session({"fill_bots": true, "seed": 11})
	var plants := record(Events.bomb_planted)
	var deaths := record(Events.character_died)
	session.start()
	await advance_until(session, func(): return session.match_manager.completed_rounds >= 3, 260.0)

	check_greater(session.match_manager.completed_rounds, 2.0, "rounds keep resolving")
	check_greater(deaths.size(), 3.0, "bots are shooting to kill")
	check_greater(plants.size(), 0.0, "bots managed to plant the bomb")
	session.queue_free()
	Config.game = original

func test_a_full_bot_match_reaches_the_win_condition() -> void:
	var original := _use_short_match_config()
	var session := make_session({"fill_bots": true, "seed": 21})
	var rounds := record(Events.round_ended)
	var switches := record(Events.sides_switched)
	session.start()
	var finished := await advance_until(session,
		func(): return session.round_manager.phase == GameEnums.RoundPhase.MATCH_END, 400.0)

	check(finished, "the match completed inside the time budget")
	check(session.match_manager.is_over, "the match is over")
	var best := maxi(session.teams.get_team(GameEnums.Team.TEAM_ONE).score,
		session.teams.get_team(GameEnums.Team.TEAM_TWO).score)
	check_equal(best, Config.game.rounds_to_win, "the winner reached the round target")
	check_greater(rounds.size(), 2.0, "every round produced a result")
	check(rounds.size() <= Config.game.max_rounds, "the match stayed inside the round cap")
	check_equal(switches.size(), 1, "sides switched once at halftime")
	session.queue_free()
	Config.game = original

func test_bot_decisions_are_deterministic_for_a_seed() -> void:
	var runs: Array[Array] = []
	for attempt in 2:
		var session := make_session({"fill_bots": true, "seed": 4321})
		session.start()
		await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.BUY, 20.0)
		await advance(session, 0.5)
		var snapshot: Array[String] = []
		for brain in session.bots:
			var primary: Weapon = brain.character.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY)
			snapshot.append("%s|%s|%s|%d" % [
				brain.character.character_name, brain.assigned_site,
				primary.id() if primary != null else &"none", brain.character.money])
		runs.append(snapshot)
		session.queue_free()
		await get_tree().physics_frame

	check_equal(runs[0], runs[1], "the same seed produces the same plans and purchases")
