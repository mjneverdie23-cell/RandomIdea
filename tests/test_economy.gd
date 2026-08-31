## Kill rewards, round income, the loss bonus and money limits.
extends TestCase

func _two_players() -> Dictionary:
	var session := make_session()
	pause_rounds(session)
	var a := session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	var b := session.add_player("B", &"RANGER", GameEnums.Team.TEAM_TWO)
	place(a, 0.0, -66.0)
	place(b, 4.0, -66.0)
	return {"session": session, "a": a, "b": b}

func test_starting_money_comes_from_the_config() -> void:
	var setup := _two_players()
	await advance(setup["session"], 0.1)
	setup["session"].economy.grant_starting_money(setup["session"].characters)
	check_equal(setup["a"].money, Config.game.starting_money, "everyone starts with the configured money")
	setup["session"].queue_free()

func test_money_is_capped_and_never_negative() -> void:
	var setup := _two_players()
	await advance(setup["session"], 0.1)
	var economy: EconomySystem = setup["session"].economy
	economy.add_money(setup["a"], 999999, &"test")
	check_equal(setup["a"].money, Config.game.max_money, "money is capped")
	economy.add_money(setup["a"], -999999, &"test")
	check_equal(setup["a"].money, 0, "money never goes negative")
	setup["session"].queue_free()

func test_kills_pay_the_weapon_specific_reward() -> void:
	var setup := _two_players()
	await advance(setup["session"], 0.1)
	setup["a"].money = 0
	setup["session"].combat.apply_damage(setup["b"], setup["a"], 500.0, &"shotgun_maw")
	check_equal(setup["a"].money, Config.weapon(&"shotgun_maw").kill_reward, "the shotgun's kill reward was paid")
	setup["session"].queue_free()

func test_round_win_pays_and_losses_build_a_streak_bonus() -> void:
	var setup := _two_players()
	await advance(setup["session"], 0.1)
	var config := Config.game
	var session: MatchSession = setup["session"]
	setup["a"].money = 0
	setup["b"].money = 0

	session.teams.get_team(GameEnums.Team.TEAM_TWO).loss_streak = 1
	session.economy.award_round_end(GameEnums.Team.TEAM_ONE, false, -1)
	check_equal(setup["a"].money, config.round_win_reward, "the winner got the win reward")
	check_equal(setup["b"].money, config.loss_bonus_base, "the loser got the first loss bonus")

	setup["b"].money = 0
	session.teams.get_team(GameEnums.Team.TEAM_TWO).loss_streak = 3
	session.economy.award_round_end(GameEnums.Team.TEAM_ONE, false, -1)
	check_equal(setup["b"].money, config.loss_bonus_base + config.loss_bonus_increment * 2,
		"a third straight loss pays more")
	session.queue_free()

func test_the_loss_bonus_is_capped() -> void:
	var setup := _two_players()
	await advance(setup["session"], 0.1)
	setup["b"].money = 0
	setup["session"].teams.get_team(GameEnums.Team.TEAM_TWO).loss_streak = 99
	setup["session"].economy.award_round_end(GameEnums.Team.TEAM_ONE, false, -1)
	check_equal(setup["b"].money, Config.game.loss_bonus_max, "the loss bonus is capped")
	setup["session"].queue_free()

func test_losing_after_planting_pays_extra() -> void:
	var setup := _two_players()
	await advance(setup["session"], 0.1)
	setup["b"].money = 0
	setup["session"].teams.get_team(GameEnums.Team.TEAM_TWO).loss_streak = 1
	setup["session"].economy.award_round_end(GameEnums.Team.TEAM_ONE, true, GameEnums.Team.TEAM_TWO)
	check_equal(setup["b"].money, Config.game.loss_bonus_base + Config.game.loss_with_plant_bonus,
		"planting softens the loss")
	setup["session"].queue_free()

func test_objective_rewards_reach_the_planter_and_defuser() -> void:
	var setup := _two_players()
	await advance(setup["session"], 0.1)
	setup["a"].money = 0
	setup["b"].money = 0
	Events.bomb_planted.emit(setup["a"], &"A", Vector3.ZERO)
	Events.bomb_defused.emit(setup["b"])
	check_equal(setup["a"].money, Config.game.plant_reward, "the planter was paid")
	check_equal(setup["b"].money, Config.game.defuse_reward, "the defuser was paid")
	setup["session"].queue_free()
