## Bot AI.
##
## A thin decision layer that fills in the same Intent a human produces. It has
## no privileged access to the world beyond what a player's senses justify:
## field of view, line of sight and view distance.
##
## Behaviour is deliberately readable: perceive -> pick a goal -> path to it ->
## shoot what you can see. Difficulty is a set of multipliers (BotConfig), not a
## different code path.
class_name BotBrain
extends RefCounted

enum Goal { IDLE, PUSH_SITE, PLANT, DEFEND_BOMB, HOLD_SITE, DEFUSE, FETCH_BOMB, FIGHT }

var character
var session
var tuning: BotConfig
var agent: NavigationAgent3D

var goal: Goal = Goal.IDLE
var goal_position: Vector3 = Vector3.ZERO
var target                       ## Character or null
var target_last_seen: float = -1000.0
var target_last_known: Vector3 = Vector3.ZERO
var assigned_site: StringName = &"A"
var hold_position: Vector3 = Vector3.ZERO
var has_hold_position: bool = false

var _reaction_remaining: float = 0.0
var _think_timer: float = 0.0
var _fire_timer: float = 0.0
var _firing: bool = false
var _strafe_direction: float = 1.0
var _strafe_timer: float = 0.0
var _stuck_timer: float = 0.0
var _last_position: Vector3 = Vector3.ZERO
var _last_phase: int = -1

func _init(p_character, p_session, difficulty: StringName) -> void:
	character = p_character
	session = p_session
	tuning = Config.bots.with_difficulty(difficulty)

	agent = NavigationAgent3D.new()
	agent.path_desired_distance = 1.2
	agent.target_desired_distance = 1.0
	agent.path_max_distance = 8.0
	agent.avoidance_enabled = false
	agent.debug_enabled = false
	character.add_child(agent)

	_think_timer = session.rng.randf_range(0.0, Config.bots.think_interval)
	_strafe_direction = 1.0 if session.rng.randf() < 0.5 else -1.0
	_last_position = character.global_position

# ------------------------------------------------------------------- tick --
func think(delta: float) -> void:
	var intent: Intent = character.intent
	# Reset per-tick action flags; look direction persists between ticks.
	intent.move_forward = 0.0
	intent.move_right = 0.0
	intent.jump = false
	intent.fire = false
	intent.use = false
	intent.sprint = false
	intent.aim = false

	var phase: int = session.round_manager.phase
	if phase != _last_phase:
		_on_phase_changed(phase)
		_last_phase = phase

	if not character.health.alive:
		return
	if phase == GameEnums.RoundPhase.BUY or phase == GameEnums.RoundPhase.ROUND_END \
			or phase == GameEnums.RoundPhase.MATCH_END:
		return

	_think_timer -= delta
	if _think_timer <= 0.0:
		_think_timer = Config.bots.think_interval
		_acquire_target()
		_choose_goal()

	_update_combat(delta)
	_update_movement(delta)
	_update_stuck(delta)

# ----------------------------------------------------------------- phases --
func _on_phase_changed(phase: int) -> void:
	if phase == GameEnums.RoundPhase.BUY:
		_plan_round()
		_buy()
	elif phase == GameEnums.RoundPhase.LIVE:
		target = null
		has_hold_position = false

## Picks the site this bot attacks or defends for the round.
func _plan_round() -> void:
	var sites: Array[BombSiteData] = session.map_definition.bomb_sites
	if sites.is_empty():
		return
	# Two-site maps use the configured A/B bias; larger maps spread evenly.
	var site: BombSiteData
	if sites.size() == 2:
		site = sites[1] if session.rng.randf() < Config.bots.site_b_preference else sites[0]
	else:
		site = sites[session.rng.randi_range(0, sites.size() - 1)]
	assigned_site = site.id
	has_hold_position = false
	target = null

func _buy() -> void:
	var shop: ShopSystem = session.shop
	var side = session.teams.side_of(character.team_id)

	# Armour first: the best value purchase in almost every economy.
	if character.money >= 1000:
		shop.buy(character, &"eq_helmet")
	elif character.money >= 650:
		shop.buy(character, &"eq_armor")

	var has_primary := character.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY) != null
	if not has_primary and character.money >= Config.bots.save_threshold:
		shop.buy_from_priority(character, character.class_data.bot_buy_priority)
	if side == GameEnums.Side.DEFENDERS and character.money >= 400:
		shop.buy(character, &"eq_defuser")
	if character.money >= 1200:
		shop.buy(character, &"eq_frag")
	if character.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY) == null and character.money >= 700:
		shop.buy(character, &"pistol_talon")

# ------------------------------------------------------------- perception --
func _acquire_target() -> void:
	var eye = character.eye_position()
	var forward := Vector3(-sin(character.yaw), 0.0, -cos(character.yaw))
	var best = null
	var best_score := INF

	for enemy in session.characters:
		if not enemy.health.alive or enemy.team_id == character.team_id:
			continue
		var revealed: bool = enemy.is_revealed(session.elapsed)
		if enemy.is_invisible() and not revealed:
			continue
		var distance = eye.distance_to(enemy.center_position())
		if distance > tuning.view_distance:
			continue
		if not revealed:
			var to_enemy = (enemy.center_position() - eye).normalized()
			var angle := acos(clampf(forward.dot(to_enemy), -1.0, 1.0))
			# Being shot at counts as noticing, even from behind.
			var recently_hurt = session.elapsed - character.last_damage_time < 1.5
			if angle > Config.bots.field_of_view * 0.5 and not recently_hurt:
				continue
		if not session.world.has_line_of_sight(character, enemy):
			continue
		var score = distance - (12.0 if enemy == target else 0.0)  # sticky targeting
		if score < best_score:
			best_score = score
			best = enemy

	if best != null:
		if best != target:
			_reaction_remaining = tuning.reaction_time
		target = best
		target_last_seen = session.elapsed
		target_last_known = best.center_position()
	elif target != null and session.elapsed - target_last_seen > Config.bots.target_memory:
		target = null

# ------------------------------------------------------------------ goals --
func _choose_goal() -> void:
	var bomb: BombSystem = session.bomb
	var side = session.teams.side_of(character.team_id)
	var site := _site_by_id(assigned_site)
	var chosen := Goal.IDLE
	var destination := Vector3.ZERO

	if side == GameEnums.Side.ATTACKERS:
		if bomb.is_planted():
			chosen = Goal.DEFEND_BOMB
			destination = _position_near(bomb.position, 9.0)
		elif bomb.carrier == character:
			chosen = Goal.PLANT
			destination = site.plant_point
		elif bomb.is_dropped() and _is_closest_to_bomb():
			chosen = Goal.FETCH_BOMB
			destination = bomb.position
		else:
			chosen = Goal.PUSH_SITE
			var focus := site
			if bomb.carrier != null and bomb.carrier != character:
				focus = _site_nearest_to(bomb.carrier.global_position, site)
			destination = _position_near(focus.plant_point, 7.0)
	else:
		if bomb.is_planted():
			chosen = Goal.DEFUSE
			destination = bomb.position
		else:
			chosen = Goal.HOLD_SITE
			if not has_hold_position:
				hold_position = _position_near(site.plant_point, 8.0)
				has_hold_position = true
			destination = hold_position

	# Fighting overrides navigation but keeps the objective as the fallback.
	var previous_goal := goal
	goal = Goal.FIGHT if (target != null and chosen != Goal.DEFUSE and chosen != Goal.PLANT) else chosen

	# Re-target whenever the plan changes, not only when the destination moves:
	# a defender already holding a site is metres from a bomb planted on it, and
	# a distance-only guard would leave it standing there while the fuse runs.
	var interaction_goal := chosen == Goal.DEFUSE or chosen == Goal.PLANT or chosen == Goal.FETCH_BOMB
	if destination != Vector3.ZERO and (chosen != previous_goal or interaction_goal
			or destination.distance_to(goal_position) > 3.0):
		goal_position = destination
		agent.target_position = destination

func _site_by_id(id: StringName) -> BombSiteData:
	for site in session.map_definition.bomb_sites:
		if site.id == id:
			return site
	return session.map_definition.bomb_sites[0]

## Support the carrier: head for whichever site they are closest to.
func _site_nearest_to(position: Vector3, fallback: BombSiteData) -> BombSiteData:
	var best := fallback
	var best_distance := INF
	for site in session.map_definition.bomb_sites:
		var distance := position.distance_to(site.plant_point)
		if distance < best_distance:
			best_distance = distance
			best = site
	return best

func _is_closest_to_bomb() -> bool:
	var my_distance = character.global_position.distance_to(session.bomb.position)
	for mate in session.teams.members_on_side(GameEnums.Side.ATTACKERS, true):
		if mate != character and mate.global_position.distance_to(session.bomb.position) < my_distance - 0.01:
			return false
	return true

## A navigable point within `radius` of `center`, so bots do not stack up.
func _position_near(center: Vector3, radius: float) -> Vector3:
	var angle = session.rng.randf_range(0.0, TAU)
	var distance = session.rng.randf_range(0.0, radius)
	var candidate := center + Vector3(cos(angle) * distance, 0.0, sin(angle) * distance)
	return session.compiled_map.nearest_navigable(candidate)

# ----------------------------------------------------------------- combat --
func _update_combat(delta: float) -> void:
	var intent: Intent = character.intent
	var weapon = character.inventory.active_weapon()
	if _reaction_remaining > 0.0:
		_reaction_remaining -= delta

	# Keep a usable weapon in hand.
	if weapon != null and weapon.is_empty() and weapon.can_reload():
		intent.reload = true
	var primary = character.inventory.weapon_in(GameEnums.WeaponSlot.PRIMARY)
	if weapon == null or (weapon.is_empty() and weapon.reserve_ammo <= 0):
		intent.switch_to_slot = GameEnums.WeaponSlot.PRIMARY if (primary != null and not primary.is_empty()) \
			else GameEnums.WeaponSlot.SECONDARY
	elif character.inventory.active_slot == GameEnums.WeaponSlot.MELEE and primary != null:
		intent.switch_to_slot = GameEnums.WeaponSlot.PRIMARY

	var aim_point := Vector3.ZERO
	var have_aim_point := false
	if target != null and target.health.alive:
		aim_point = _predicted_aim_point(target)
		have_aim_point = true
	elif target_last_seen > 0.0 and session.elapsed - target_last_seen <= Config.bots.target_memory:
		aim_point = target_last_known
		have_aim_point = true

	if have_aim_point:
		_aim_at(aim_point, delta, 1.0)
	elif not agent.is_navigation_finished():
		var next := agent.get_next_path_position()
		_aim_at(next + Vector3(0, character.class_data.eye_height(character.current_height), 0), delta, 0.6)

	var can_shoot = target != null and target.health.alive and _reaction_remaining <= 0.0 \
		and weapon != null and not weapon.reloading and not weapon.is_empty() \
		and session.world.has_line_of_sight(character, target)

	if can_shoot:
		var to_target = (_predicted_aim_point(target) - character.eye_position()).normalized()
		var facing = character.look_direction()
		var aim_error := acos(clampf(facing.dot(to_target), -1.0, 1.0))
		var distance = character.eye_position().distance_to(target.center_position())
		# A wider cone up close, a tight one at range.
		var tolerance := maxf(0.02, atan2(target.radius() * 1.4, maxf(1.0, distance)))
		if aim_error < tolerance:
			_update_trigger(delta)
			intent.fire = _firing
			if weapon.data.ads_zoom >= 2.0:
				intent.aim = true
		else:
			_firing = false
	else:
		_firing = false
		if weapon != null and not weapon.reloading and target == null \
				and weapon.ammo_in_mag < weapon.data.mag_size * 0.35:
			intent.reload = true

## Simple lead: aim where the target will be, scaled by difficulty.
func _predicted_aim_point(enemy) -> Vector3:
	var distance = character.eye_position().distance_to(enemy.center_position())
	var lead := minf(0.35, distance / 260.0) * tuning.accuracy_moving
	return enemy.center_position() + enemy.velocity * lead

func _aim_at(point: Vector3, delta: float, rate_scale: float) -> void:
	var intent: Intent = character.intent
	var eye = character.eye_position()
	var error := deg_to_rad(tuning.aim_error)
	var to_point = point - eye
	var desired_yaw = atan2(-to_point.x, -to_point.z) + session.rng.randf_range(-error * 0.5, error * 0.5)
	var flat := Vector2(to_point.x, to_point.z).length()
	var desired_pitch = atan2(to_point.y, flat) + session.rng.randf_range(-error * 0.35, error * 0.35)

	var rate := tuning.aim_turn_rate * rate_scale * delta
	intent.yaw = _approach_angle(intent.yaw, desired_yaw, rate)
	intent.pitch = clampf(_approach_angle(intent.pitch, desired_pitch, rate), -1.4, 1.4)

## Trigger discipline: short bursts with pauses, per difficulty.
func _update_trigger(delta: float) -> void:
	_fire_timer -= delta
	if _fire_timer > 0.0:
		return
	_firing = not _firing
	_fire_timer = session.rng.randf_range(tuning.fire_burst_min, tuning.fire_burst_max) if _firing \
		else session.rng.randf_range(0.08, 0.25)

# --------------------------------------------------------------- movement --
func _update_movement(delta: float) -> void:
	var intent: Intent = character.intent
	var bomb: BombSystem = session.bomb

	# Objective interactions: stand still and hold use.
	if goal == Goal.PLANT and bomb.can_plant(character):
		intent.use = true
		return
	if goal == Goal.DEFUSE and bomb.can_defuse(character):
		intent.use = true
		return
	if goal == Goal.FETCH_BOMB and bomb.can_pick_up(character):
		intent.use = true
		return

	var desired := Vector3.ZERO
	if goal == Goal.FIGHT and target != null:
		var flat_distance := Vector2(
			character.global_position.x - target.global_position.x,
			character.global_position.z - target.global_position.z).length()
		var preferred := _preferred_range()
		var to_target = (target.global_position - character.global_position)
		to_target.y = 0.0
		to_target = to_target.normalized()

		_strafe_timer -= delta
		if _strafe_timer <= 0.0:
			_strafe_timer = session.rng.randf_range(0.4, 1.2)
			_strafe_direction *= -1.0
		var strafe := Vector3(-to_target.z, 0.0, to_target.x)
		var approach := 1.0 if flat_distance > preferred * 1.2 else (-1.0 if flat_distance < preferred * 0.6 else 0.0)
		desired = (to_target * approach + strafe * _strafe_direction * Config.bots.combat_strafe).normalized()
	else:
		desired = _follow_path()
		if desired != Vector3.ZERO and target == null:
			intent.sprint = true

	if desired == Vector3.ZERO:
		return

	# Convert a world direction into local move axes, so the bot can walk one way
	# while aiming another.
	var forward := Vector3(-sin(character.yaw), 0.0, -cos(character.yaw))
	var right := Vector3(-forward.z, 0.0, forward.x)
	intent.move_forward = clampf(desired.dot(forward), -1.0, 1.0)
	intent.move_right = clampf(desired.dot(right), -1.0, 1.0)

	# Hop over small obstacles rather than grinding into them.
	if _stuck_timer > 0.6 and character.is_on_floor():
		intent.jump = true

func _preferred_range() -> float:
	var weapon = character.inventory.active_weapon()
	if weapon == null:
		return 6.0
	match weapon.data.category:
		GameEnums.WeaponCategory.SNIPER: return 45.0
		GameEnums.WeaponCategory.RIFLE: return 25.0
		GameEnums.WeaponCategory.LMG: return 22.0
		GameEnums.WeaponCategory.SMG: return 12.0
		GameEnums.WeaponCategory.SHOTGUN: return 6.0
		GameEnums.WeaponCategory.MELEE: return 1.5
	return 15.0

func _follow_path() -> Vector3:
	if agent.is_navigation_finished():
		return Vector3.ZERO
	var next := agent.get_next_path_position()
	var direction = next - character.global_position
	direction.y = 0.0
	if direction.length() < 0.05:
		return Vector3.ZERO
	return direction.normalized()

func _update_stuck(delta: float) -> void:
	var moved = character.global_position.distance_to(_last_position)
	if moved < 0.05 and goal != Goal.HOLD_SITE:
		_stuck_timer += delta
		if _stuck_timer > 1.2:
			_stuck_timer = 0.0
			# Jitter the goal so bots do not re-derive the same blocked route.
			goal_position = _position_near(goal_position, 5.0)
			agent.target_position = goal_position
	else:
		_stuck_timer = 0.0
	_last_position = character.global_position

func _approach_angle(current: float, target_angle: float, max_delta: float) -> float:
	var difference := wrapf(target_angle - current, -PI, PI)
	if absf(difference) <= max_delta:
		return wrapf(target_angle, -PI, PI)
	return wrapf(current + signf(difference) * max_delta, -PI, PI)

func describe() -> Dictionary:
	return {
		"name": character.character_name,
		"goal": Goal.keys()[goal],
		"site": assigned_site,
		"target": target.character_name if target != null else "",
	}
