## Weapon data, fire modes, ammo, recoil and spread.
extends TestCase

func _armed(session: MatchSession, weapon_id: StringName, class_id: StringName = &"RANGER") -> Character:
	var character := session.add_player("Shooter", class_id, GameEnums.Team.TEAM_ONE)
	place(character, 0.0, -66.0)
	character.inventory.give_weapon(weapon_id)
	return character

func test_every_weapon_resource_is_complete() -> void:
	for id in Config.weapons:
		var data: WeaponData = Config.weapons[id]
		check_equal(data.id, id, "%s declares a matching id" % id)
		check_greater(data.damage, 0.0, "%s deals damage" % id)
		check_greater(data.fire_rate, 0.0, "%s has a fire rate" % id)
		check_greater(data.range, 0.0, "%s has a range" % id)
		check(data.falloff_end >= data.falloff_start, "%s has a sane falloff curve" % id)
	await get_tree().physics_frame

func test_class_restrictions_gate_weapons() -> void:
	check(Config.is_item_allowed_for_class(&"sniper_longneck", &"SNIPER"), "snipers may buy sniper rifles")
	check(not Config.is_item_allowed_for_class(&"sniper_longneck", &"TANK"), "tanks may not")
	check(Config.is_item_allowed_for_class(&"lmg_thunder", &"TANK"), "tanks may buy heavy weapons")
	check(not Config.is_item_allowed_for_class(&"lmg_thunder", &"ASSASSIN"), "assassins may not")
	check(Config.is_item_allowed_for_class(&"pistol_scav", &"RANGER"), "every class can hold a sidearm")
	await get_tree().physics_frame

func test_automatic_fire_respects_the_fire_rate() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := _armed(session, &"rifle_ranger")
	var weapon := character.inventory.active_weapon()
	await advance(session, weapon.data.equip_time + 0.2)

	var shots := record(Events.weapon_fired)
	character.intent.fire = true
	await advance(session, 1.0)
	character.intent.fire = false

	var expected := weapon.data.fire_rate / 60.0
	check(absf(shots.size() - expected) <= 2.0,
		"fired about %d rounds in a second (got %d)" % [int(expected), shots.size()])
	check_equal(weapon.ammo_in_mag, weapon.data.mag_size - shots.size(), "ammo matches shots fired")
	session.queue_free()

func test_semi_automatic_needs_the_trigger_released() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := _armed(session, &"pistol_scav")
	character.inventory.equip_slot(GameEnums.WeaponSlot.SECONDARY)
	await advance(session, 1.2)

	var shots := record(Events.weapon_fired)
	character.intent.fire = true
	await advance(session, 1.0)
	check_equal(shots.size(), 1, "holding the trigger only fires once")

	character.intent.fire = false
	await advance(session, 0.2)
	character.intent.fire = true
	await advance(session, 0.2)
	check_equal(shots.size(), 2, "releasing and pulling again fires a second shot")
	session.queue_free()

func test_reloading_refills_from_reserve() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := _armed(session, &"rifle_ranger")
	var weapon := character.inventory.active_weapon()
	await advance(session, 1.0)

	weapon.ammo_in_mag = 10
	var reserve_before := weapon.reserve_ammo
	character.intent.reload = true
	await advance(session, 0.2)
	check(weapon.reloading, "the reload started")
	await advance(session, weapon.data.reload_time)
	check_equal(weapon.ammo_in_mag, weapon.data.mag_size, "the magazine is full")
	check_equal(weapon.reserve_ammo, reserve_before - 20, "the reserve paid for the refill")
	session.queue_free()

func test_recoil_climbs_while_firing_and_recovers_after() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := _armed(session, &"rifle_ranger")
	var weapon := character.inventory.active_weapon()
	await advance(session, 1.0)

	character.intent.fire = true
	await advance(session, 0.6)
	var peak := weapon.recoil_pitch
	check_greater(peak, 0.5, "recoil built up")
	check(peak <= weapon.data.recoil_max_vertical, "recoil is capped")

	character.intent.fire = false
	await advance(session, 2.0)
	check_less(weapon.recoil_pitch, 0.01, "recoil recovered")
	session.queue_free()

func test_spread_reacts_to_movement_crouching_and_aiming() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := _armed(session, &"rifle_ranger")
	var weapon := character.inventory.active_weapon()
	await advance(session, 1.0)

	var still := session.combat.compute_spread(character, weapon)
	character.intent.move_forward = 1.0
	await advance(session, 1.0)
	var moving := session.combat.compute_spread(character, weapon)
	check_greater(moving, still, "moving is less accurate")

	character.intent.move_forward = 0.0
	await advance(session, 1.0)
	character.intent.aim = true
	check_less(session.combat.compute_spread(character, weapon), still, "aiming is more accurate")
	session.queue_free()

func test_switching_weapons_applies_the_draw_delay() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := _armed(session, &"rifle_ranger")
	await advance(session, 1.0)

	character.intent.switch_to_slot = GameEnums.WeaponSlot.SECONDARY
	await advance(session, 2.0 / 64.0)
	check_equal(character.inventory.active_slot, GameEnums.WeaponSlot.SECONDARY, "the slot changed")
	check_greater(character.inventory.active_weapon().equip_remaining, 0.0, "the draw is running")
	check(not character.inventory.active_weapon().can_fire(), "cannot fire mid-draw")
	await advance(session, 1.0)
	check(character.inventory.active_weapon().can_fire(), "can fire once drawn")
	session.queue_free()
