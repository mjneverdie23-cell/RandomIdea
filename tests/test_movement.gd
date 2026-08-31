## The kinematic character controller.
extends TestCase

func test_characters_fall_and_land_on_the_ground() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := session.add_player("Faller", &"RANGER", GameEnums.Team.TEAM_ONE)
	place(character, 0.0, -66.0, 6.0)
	await advance(session, 2.0)
	check(character.is_on_floor(), "landed")
	check_less(absf(character.global_position.y), 0.2, "rests on the floor")
	session.queue_free()

func test_walls_stop_horizontal_movement() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := session.add_player("Walker", &"RANGER", GameEnums.Team.TEAM_ONE)
	# The mid corridor runs x in [-8, 8]; walk east into the wall.
	place(character, 0.0, -30.0, 0.3, PI * 1.5)
	character.intent.yaw = PI * 1.5
	character.intent.move_forward = 1.0
	await advance(session, 4.0)
	check_less(character.global_position.x, 8.0, "did not pass through the corridor wall")
	check_greater(character.global_position.x, 4.0, "did reach the wall")
	session.queue_free()

func test_crouching_lowers_the_hitbox_and_slows_the_character() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := session.add_player("Croucher", &"RANGER", GameEnums.Team.TEAM_ONE)
	place(character, 0.0, -66.0)
	await advance(session, 0.5)
	var standing_height := character.current_height
	var standing_speed := character.target_speed()

	character.intent.crouch = true
	await advance(session, 0.5)
	check_less(character.current_height, standing_height, "the hitbox shrinks while crouched")
	check_less(character.target_speed(), standing_speed, "crouching is slower")
	check_almost(character.current_height,
		character.class_data.hitbox_height * Config.game.crouch_height_fraction, 0.01,
		"crouch height matches the config")
	session.queue_free()

func test_jumping_leaves_the_ground_and_gravity_returns() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := session.add_player("Jumper", &"ASSASSIN", GameEnums.Team.TEAM_ONE)
	place(character, 0.0, -66.0)
	await advance(session, 0.6)
	character.intent.jump = true
	var peak := 0.0
	for i in 40:
		await get_tree().physics_frame
		peak = maxf(peak, character.global_position.y)
	character.intent.jump = false
	check_greater(peak, 0.5, "the jump gained height")
	await advance(session, 2.0)
	check(character.is_on_floor(), "came back down")
	session.queue_free()

func test_ramps_can_be_walked_up() -> void:
	var session := make_session()
	pause_rounds(session)
	var character := session.add_player("Climber", &"RANGER", GameEnums.Team.TEAM_ONE)
	# mid_nest_ramp climbs from z=25 to z=28, up to the 1.6 unit nest platform.
	place(character, 0.0, 23.0, 0.3, PI)
	character.intent.yaw = PI
	character.intent.move_forward = 1.0
	await advance(session, 1.2)
	check_greater(character.global_position.y, 1.0, "climbed onto the raised platform")
	check(character.is_on_floor(), "standing on the platform rather than falling")
	session.queue_free()

func test_class_speed_differences_show_up_in_movement() -> void:
	var session := make_session()
	pause_rounds(session)
	var assassin := session.add_player("Fast", &"ASSASSIN", GameEnums.Team.TEAM_ONE)
	var tank := session.add_player("Slow", &"TANK", GameEnums.Team.TEAM_TWO)
	place(assassin, -3.0, -66.0, 0.3, PI)
	place(tank, 3.0, -66.0, 0.3, PI)
	assassin.intent.yaw = PI
	tank.intent.yaw = PI
	assassin.intent.move_forward = 1.0
	tank.intent.move_forward = 1.0
	await advance(session, 3.0)
	check_greater(assassin.global_position.z, tank.global_position.z, "the assassin outruns the tank")
	session.queue_free()
