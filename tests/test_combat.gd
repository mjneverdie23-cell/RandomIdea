## Damage model, hit zones, armour, line of sight and grenades.
extends TestCase

func _duel(shooter_class: StringName = &"RANGER", target_class: StringName = &"RANGER",
		distance: float = 10.0, weapon_id: StringName = &"rifle_ranger") -> Dictionary:
	var session := make_session()
	pause_rounds(session)
	var shooter := session.add_player("A", shooter_class, GameEnums.Team.TEAM_ONE)
	var target := session.add_player("B", target_class, GameEnums.Team.TEAM_TWO)
	place(shooter, 0.0, -66.0)
	place(target, 0.0, -66.0 + distance)
	shooter.inventory.give_weapon(weapon_id)
	return {"session": session, "shooter": shooter, "target": target}

func test_damage_reduces_health() -> void:
	var duel := _duel()
	await advance(duel["session"], 0.2)
	var target: Character = duel["target"]
	var before := target.health.health
	duel["session"].combat.apply_damage(target, duel["shooter"], 25.0, &"test")
	check_almost(target.health.health, before - 25.0, 0.01, "unarmoured damage is applied in full")
	duel["session"].queue_free()

func test_headshots_multiply_damage() -> void:
	var duel := _duel()
	await advance(duel["session"], 0.2)
	var session: MatchSession = duel["session"]
	var target: Character = duel["target"]
	var weapon: WeaponData = Config.weapon(&"rifle_ranger")
	var before := target.health.health
	session.combat.apply_damage(target, duel["shooter"], weapon.damage * weapon.headshot_multiplier,
		weapon.id, GameEnums.HitZone.HEAD, true)
	check_greater(before - target.health.health, weapon.damage, "a headshot hurts more than a body shot")
	check_less(Config.game.hit_zone_multiplier(GameEnums.HitZone.LEGS), 1.0, "leg shots are reduced")
	session.queue_free()

func test_armour_absorbs_damage_and_is_consumed() -> void:
	var duel := _duel()
	await advance(duel["session"], 0.2)
	var target: Character = duel["target"]
	target.health.armor = 100.0
	var before := target.health.health
	duel["session"].combat.apply_damage(target, duel["shooter"], 50.0, &"test",
		GameEnums.HitZone.CHEST, false, 0.7)
	check_less(before - target.health.health, 50.0, "armour reduced the damage")
	check_less(target.health.armor, 100.0, "armour was consumed")
	duel["session"].queue_free()

func test_damage_falls_off_with_distance() -> void:
	var weapon: WeaponData = Config.weapon(&"rifle_ranger")
	check_equal(weapon.falloff_multiplier(5.0), 1.0, "no falloff inside the effective range")
	check_less(weapon.falloff_multiplier(weapon.falloff_end + 10.0), 1.0, "damage drops at long range")
	check(weapon.falloff_multiplier(1000.0) >= weapon.falloff_min_multiplier, "falloff has a floor")
	await get_tree().physics_frame

func test_class_multipliers_change_how_much_damage_is_taken() -> void:
	var tank_duel := _duel(&"RANGER", &"TANK")
	var assassin_duel := _duel(&"RANGER", &"ASSASSIN")
	await advance(tank_duel["session"], 0.2)
	tank_duel["session"].combat.apply_damage(tank_duel["target"], tank_duel["shooter"], 100.0, &"test")
	assassin_duel["session"].combat.apply_damage(assassin_duel["target"], assassin_duel["shooter"], 100.0, &"test")
	var tank: Character = tank_duel["target"]
	var assassin: Character = assassin_duel["target"]
	check_less(assassin.health.health_fraction(), tank.health.health_fraction(),
		"the tank survives the same hit better than the assassin")
	tank_duel["session"].queue_free()
	assassin_duel["session"].queue_free()

func test_lethal_damage_kills_and_credits_the_attacker() -> void:
	var duel := _duel()
	await advance(duel["session"], 0.2)
	var deaths := record(Events.character_died)
	var feed := record(Events.kill_feed)
	duel["session"].combat.apply_damage(duel["target"], duel["shooter"], 500.0, &"rifle_ranger")

	var target: Character = duel["target"]
	var shooter: Character = duel["shooter"]
	check(not target.health.alive, "the target died")
	check_equal(deaths.size(), 1, "one death event")
	check_equal(shooter.score["kills"], 1, "the killer was credited")
	check_equal(target.score["deaths"], 1, "the victim's deaths went up")
	check_equal(feed.size(), 1, "the kill feed was notified")
	duel["session"].queue_free()

func test_friendly_fire_is_off_by_default() -> void:
	var session := make_session()
	pause_rounds(session)
	var a := session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	var b := session.add_player("B", &"RANGER", GameEnums.Team.TEAM_ONE)
	place(a, 0.0, -66.0)
	place(b, 2.0, -66.0)
	await advance(session, 0.2)
	var before := b.health.health
	session.combat.apply_damage(b, a, 100.0, &"test")
	check_equal(b.health.health, before, "teammates take no damage")
	session.queue_free()

func test_firing_is_blocked_during_freeze_time() -> void:
	var duel := _duel()
	var session: MatchSession = duel["session"]
	await advance(session, 0.2)
	session.combat.combat_enabled = false  # what RoundManager does during the buy phase
	var shots := record(Events.weapon_fired)
	duel["shooter"].intent.fire = true
	await advance(session, 0.5)
	check_equal(shots.size(), 0, "no shots during freeze time")
	session.queue_free()

func test_shots_travel_and_can_kill() -> void:
	var duel := _duel(&"RANGER", &"RANGER", 12.0)
	var session: MatchSession = duel["session"]
	var shooter: Character = duel["shooter"]
	var target: Character = duel["target"]
	await advance(session, 1.2)
	aim_at(shooter, target)
	var hits := record(Events.weapon_hit)
	shooter.intent.fire = true
	await advance(session, 3.0)
	shooter.intent.fire = false

	var on_target := 0
	for hit in hits:
		if hit[3] == target:
			on_target += 1
	check_greater(on_target, 0.0, "bullets connected")
	check(not target.health.alive, "sustained accurate fire is lethal")
	session.queue_free()

func test_walls_block_shots() -> void:
	var session := make_session()
	pause_rounds(session)
	var shooter := session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	var target := session.add_player("B", &"RANGER", GameEnums.Team.TEAM_TWO)
	# Opposite sides of the solid mass between mid and A long.
	place(shooter, 0.0, -20.0)
	place(target, 46.0, -20.0)
	shooter.inventory.give_weapon(&"rifle_ranger")
	await advance(session, 1.2)
	aim_at(shooter, target)
	check(not session.world.has_line_of_sight(shooter, target), "the wall blocks line of sight")

	var before := target.health.health
	shooter.intent.fire = true
	await advance(session, 1.5)
	check_equal(target.health.health, before, "no damage through the wall")
	session.queue_free()

func test_throwing_a_grenade_consumes_it_and_explodes() -> void:
	var session := make_session()
	pause_rounds(session)
	var thrower := session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	place(thrower, 0.0, -66.0, 0.3, PI)
	thrower.intent.yaw = PI
	thrower.inventory.add_grenade(&"eq_frag")
	await advance(session, 0.5)

	var explosions := record(Events.grenade_exploded)
	thrower.intent.throw_grenade = true
	await advance(session, 4.0)

	check_equal(explosions.size(), 1, "the grenade went off after its fuse")
	check_equal(thrower.inventory.grenade_count(&"eq_frag"), 0, "the grenade was consumed")
	check(not thrower.intent.throw_grenade, "the throw intent was consumed")
	session.queue_free()

func test_grenade_blast_damages_enemies_in_radius() -> void:
	var session := make_session()
	pause_rounds(session)
	var thrower := session.add_player("A", &"RANGER", GameEnums.Team.TEAM_ONE)
	var near := session.add_player("Near", &"RANGER", GameEnums.Team.TEAM_TWO)
	var far := session.add_player("Far", &"RANGER", GameEnums.Team.TEAM_TWO)
	place(thrower, 0.0, -66.0)
	place(near, 2.0, -66.0)
	place(far, 25.0, -66.0)
	await advance(session, 0.5)

	# Detonate at a known position rather than relying on the throw arc.
	var grenade := Grenade.new()
	grenade.setup(Config.equipment_item(&"eq_frag"), thrower, session.combat)
	session.add_child(grenade)
	grenade.global_position = near.global_position + Vector3(0, 0.3, 0)
	await get_tree().physics_frame

	var near_before := near.health.health
	var far_before := far.health.health
	session.combat.explode_grenade(grenade)
	grenade.queue_free()

	check_less(near.health.health, near_before, "the blast hurt the enemy standing on it")
	check_equal(far.health.health, far_before, "an enemy outside the radius was untouched")
	session.queue_free()
