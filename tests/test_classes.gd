## Class data integrity, stats reaching the character, and abilities.
extends TestCase

func test_every_class_resource_is_consistent() -> void:
	for class_id in Config.class_ids:
		var data: CharacterClassData = Config.classes[class_id]
		check_equal(data.id, class_id, "%s declares a matching id" % class_id)
		check_greater(data.max_health, 0.0, "%s has health" % class_id)
		check_greater(data.move_speed, 0.0, "%s can move" % class_id)
		check_greater(data.allowed_categories.size(), 0.0, "%s can carry something" % class_id)
		check(data.model_key != &"", "%s declares a model key for the render layer" % class_id)
		for ability_id in data.abilities:
			check(Config.ability(ability_id) != null, "%s references a real ability: %s" % [class_id, ability_id])
		for weapon_id in [data.default_primary, data.default_secondary, data.default_melee]:
			if weapon_id == &"":
				continue
			check(Config.weapon(weapon_id) != null, "%s default weapon %s exists" % [class_id, weapon_id])
			check(Config.is_item_allowed_for_class(weapon_id, class_id),
				"%s may carry its own default %s" % [class_id, weapon_id])
	await get_tree().physics_frame

func test_a_character_takes_its_stats_from_its_class() -> void:
	var session := make_session()
	pause_rounds(session)
	for class_id in Config.class_ids:
		var character := session.add_player(String(class_id), class_id, GameEnums.Team.TEAM_ONE)
		var data: CharacterClassData = Config.classes[class_id]
		check_equal(character.health.max_health, data.max_health, "%s health" % class_id)
		check_equal(character.class_data.move_speed, data.move_speed, "%s speed" % class_id)
		check_equal(character.class_data.hitbox_height, data.hitbox_height, "%s hitbox height" % class_id)
		check_equal(character.abilities.count(), data.abilities.size(), "%s ability count" % class_id)
	await advance(session, 0.2)
	session.queue_free()

func test_abilities_activate_apply_effects_and_go_on_cooldown() -> void:
	var session := make_session()
	pause_rounds(session)
	var bruiser := session.add_player("Rex", &"BRUISER", GameEnums.Team.TEAM_ONE)
	place(bruiser, 0.0, -66.0)
	await advance(session, 0.2)
	var used := record(Events.ability_used)

	bruiser.intent.use_ability = 0  # Terror Roar
	await advance(session, 0.2)
	check_equal(used.size(), 1, "the ability fired")
	check(bruiser.effects.has(&"roar_buff"), "the buff was applied")
	check_greater(bruiser.effects.damage_dealt(), 1.0, "modifiers are folded together")
	check(not bruiser.abilities.is_ready(0), "the ability went on cooldown")

	bruiser.intent.use_ability = 0
	await advance(session, 0.2)
	check_equal(used.size(), 1, "a second activation while on cooldown does nothing")
	session.queue_free()

func test_timed_effects_expire() -> void:
	var session := make_session()
	pause_rounds(session)
	var tank := session.add_player("Anky", &"TANK", GameEnums.Team.TEAM_ONE)
	place(tank, 0.0, -66.0)
	await advance(session, 0.2)

	tank.intent.use_ability = 0  # Bulwark
	await advance(session, 0.2)
	check_less(tank.effects.damage_taken(), 1.0, "damage reduction is active")
	await advance(session, Config.ability(&"ability_bulwark").duration + 0.4)
	check_equal(tank.effects.damage_taken(), 1.0, "the effect wore off")
	session.queue_free()

func test_a_damage_ability_hurts_enemies_but_not_teammates() -> void:
	var session := make_session()
	pause_rounds(session)
	var tank := session.add_player("Anky", &"TANK", GameEnums.Team.TEAM_ONE)
	var mate := session.add_player("Mate", &"RANGER", GameEnums.Team.TEAM_ONE)
	var enemy := session.add_player("Enemy", &"RANGER", GameEnums.Team.TEAM_TWO)
	place(tank, 0.0, -66.0)
	place(mate, 1.5, -66.0)
	place(enemy, 3.0, -66.0)
	await advance(session, 0.3)

	tank.intent.use_ability = 1  # Tail Slam
	await advance(session, 0.3)
	check_less(enemy.health.health, enemy.health.max_health, "the enemy took the slam")
	check_equal(mate.health.health, mate.health.max_health, "the teammate did not")
	session.queue_free()

func test_scan_abilities_reveal_enemies_for_a_limited_time() -> void:
	var session := make_session()
	pause_rounds(session)
	var ranger := session.add_player("Para", &"RANGER", GameEnums.Team.TEAM_ONE)
	var enemy := session.add_player("Enemy", &"RANGER", GameEnums.Team.TEAM_TWO)
	place(ranger, 0.0, -66.0)
	place(enemy, 6.0, -66.0)
	await advance(session, 0.3)

	ranger.intent.use_ability = 0  # Echo Call
	await advance(session, 0.2)
	check(enemy.is_revealed(session.elapsed), "the enemy is revealed")
	await advance(session, Config.ability(&"ability_echo_call").duration + 0.4)
	check(not enemy.is_revealed(session.elapsed), "the reveal expired")
	session.queue_free()

func test_class_can_be_changed_during_the_buy_phase_only() -> void:
	var session := make_session({"team_size": 1, "with_local_player": true})
	session.add_player("D", &"RANGER", GameEnums.Team.TEAM_TWO)
	session.start()
	await advance(session, 0.2)
	check(session.set_local_player_class(&"TANK"), "allowed during warmup")
	check_equal(session.local_player.class_id, &"TANK", "the class changed")

	session.round_manager.skip_phase()
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.BUY, 20.0)
	check(session.set_local_player_class(&"SNIPER"), "allowed during the buy phase")

	session.round_manager.skip_phase()
	await advance_until(session, func(): return session.round_manager.phase == GameEnums.RoundPhase.LIVE, 20.0)
	check(not session.set_local_player_class(&"TANK"), "blocked once the round is live")
	check_equal(session.local_player.class_id, &"SNIPER", "the class stayed put")
	session.queue_free()
