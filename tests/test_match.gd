## Scoring, the halftime side switch and the match win condition.
extends TestCase

## Drives whole rounds without simulating them - the fastest way to test match rules.
func _fast_match() -> MatchSession:
	var session := make_session({"team_size": 1})
	session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	session.add_player("D", &"RANGER", GameEnums.Team.TEAM_TWO)
	session.start()
	return session

## Ends the current round in favour of `team_id` and rolls into the next one.
##
## Phase *durations* are covered by test_round.gd, so these tests skip through
## them - otherwise every match test would replay 13 rounds of real freeze time.
func _win_round(session: MatchSession, team_id: int) -> void:
	await _skip_to(session, [GameEnums.RoundPhase.LIVE])
	session.round_manager._end_round(team_id, GameEnums.RoundEndReason.TIME_EXPIRED)
	await _skip_to(session, [GameEnums.RoundPhase.BUY, GameEnums.RoundPhase.MATCH_END])

func _skip_to(session: MatchSession, phases: Array) -> void:
	for i in 600:
		if phases.has(session.round_manager.phase):
			return
		session.round_manager.skip_phase()
		await get_tree().physics_frame

func test_scores_accumulate_per_team() -> void:
	var session := _fast_match()
	var score_events := record(Events.score_changed)
	await _win_round(session, GameEnums.Team.TEAM_ONE)
	await _win_round(session, GameEnums.Team.TEAM_TWO)
	await _win_round(session, GameEnums.Team.TEAM_ONE)
	check_equal(session.teams.get_team(GameEnums.Team.TEAM_ONE).score, 2, "team one has two wins")
	check_equal(session.teams.get_team(GameEnums.Team.TEAM_TWO).score, 1, "team two has one win")
	check_equal(score_events.size(), 3, "the score was announced each round")
	session.queue_free()

func test_sides_switch_after_the_configured_round() -> void:
	var session := _fast_match()
	var switch_round := Config.game.switch_sides_after_round
	var before := session.teams.side_of(GameEnums.Team.TEAM_ONE)
	var switches := record(Events.sides_switched)

	for round_index in switch_round:
		check_equal(session.teams.side_of(GameEnums.Team.TEAM_ONE), before,
			"sides are unchanged during round %d" % (round_index + 1))
		await _win_round(session, GameEnums.Team.TEAM_ONE if round_index % 2 == 0 else GameEnums.Team.TEAM_TWO)

	check_equal(switches.size(), 1, "exactly one side switch happened")
	check(session.teams.side_of(GameEnums.Team.TEAM_ONE) != before, "team one changed sides")
	check_equal(session.teams.get_team(GameEnums.Team.TEAM_ONE).score, switch_round / 2, "scores survived the switch")
	session.queue_free()

func test_money_and_gear_reset_at_the_side_switch() -> void:
	var session := _fast_match()
	var player: Character = session.characters[0]
	for round_index in Config.game.switch_sides_after_round:
		player.money = 16000
		player.inventory.give_weapon(&"rifle_ranger")
		await _win_round(session, GameEnums.Team.TEAM_ONE)
	check_equal(player.money, Config.game.starting_money, "money reset for the new half")
	check(player.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY) == null, "gear was wiped for the new half")
	session.queue_free()

func test_the_match_ends_at_the_configured_round_wins() -> void:
	var session := _fast_match()
	var target := Config.game.rounds_to_win
	var ended := record(Events.match_ended)

	for round_index in target:
		check(not session.match_manager.is_over, "the match is still running at %d wins" % round_index)
		await _win_round(session, GameEnums.Team.TEAM_ONE)

	check_equal(ended.size(), 1, "the match ended exactly once")
	check_equal(ended[0][0], GameEnums.Team.TEAM_ONE, "team one won")
	check_equal(session.teams.get_team(GameEnums.Team.TEAM_ONE).score, target, "they reached the target")
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.MATCH_END, 20.0)
	check_equal(session.round_manager.phase, GameEnums.RoundPhase.MATCH_END, "the game settles in match end")
	session.queue_free()

func test_no_further_rounds_start_once_the_match_is_over() -> void:
	var session := _fast_match()
	for round_index in Config.game.rounds_to_win:
		await _win_round(session, GameEnums.Team.TEAM_ONE)
	var final_round := session.match_manager.round_number
	await advance(session, 20.0)
	check_equal(session.match_manager.round_number, final_round, "the round counter stopped")
	check_equal(session.round_manager.phase, GameEnums.RoundPhase.MATCH_END, "still in match end")
	session.queue_free()

func test_the_loss_streak_resets_on_a_win() -> void:
	var session := _fast_match()
	await _win_round(session, GameEnums.Team.TEAM_ONE)
	await _win_round(session, GameEnums.Team.TEAM_ONE)
	check_equal(session.teams.get_team(GameEnums.Team.TEAM_TWO).loss_streak, 2, "two straight losses")
	check_equal(session.teams.get_team(GameEnums.Team.TEAM_ONE).loss_streak, 0, "the winner has no streak")
	await _win_round(session, GameEnums.Team.TEAM_TWO)
	check_equal(session.teams.get_team(GameEnums.Team.TEAM_TWO).loss_streak, 0, "a win clears the streak")
	session.queue_free()

func test_match_point_is_reported_for_the_ui() -> void:
	var session := _fast_match()
	for round_index in Config.game.rounds_to_win - 1:
		await _win_round(session, GameEnums.Team.TEAM_ONE)
	check(session.match_manager.is_match_point(), "one win away is match point")
	session.queue_free()
