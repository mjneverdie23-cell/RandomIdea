## Shooting, damage and grenades.
##
## Everything that can reduce a character's health flows through `apply_damage()`
## - weapons, explosions, abilities, fall damage - so kill attribution, assists,
## events and rewards are implemented exactly once.
class_name CombatSystem
extends RefCounted

var session
var world: WorldQuery
var rng: RandomNumberGenerator
## Set by RoundManager: while false, triggers do nothing (freeze time).
var combat_enabled: bool = true

func _init(p_session, p_world: WorldQuery, p_rng: RandomNumberGenerator) -> void:
	session = p_session
	world = p_world
	rng = p_rng

# ------------------------------------------------------------------- firing --
## Safe to call every tick with the trigger held - the weapon's own fire-mode
## rules gate it.
func try_fire(character) -> bool:
	if not combat_enabled or character.frozen or not character.health.alive:
		return false
	var weapon: Weapon = character.inventory.active_weapon()
	if weapon == null:
		return false

	if not weapon.can_fire():
		if weapon.is_empty() and weapon.fire_cooldown <= 0.0 and not weapon.reloading:
			Events.weapon_dry_fire.emit(character, weapon)
			weapon.fire_cooldown = 0.25
			# Auto-reload keeps the prototype pleasant to play.
			if weapon.can_reload():
				start_reload(character)
		return false

	weapon.consume_shot()
	character.effects.notify_fired()

	var origin: Vector3 = character.eye_position()
	var direction := aim_direction(character, weapon)
	Events.weapon_fired.emit(character, weapon, origin, direction)

	var spread := compute_spread(character, weapon)
	for pellet in maxi(1, weapon.data.pellets):
		_resolve_shot(character, weapon, origin, _apply_spread(direction, spread))

	weapon.apply_recoil(rng)
	return true

## Aim direction including accumulated recoil.
func aim_direction(character, weapon: Weapon) -> Vector3:
	var pitch: float = character.pitch + deg_to_rad(weapon.recoil_pitch)
	var yaw: float = character.yaw + deg_to_rad(weapon.recoil_yaw)
	var cp := cos(pitch)
	return Vector3(-sin(yaw) * cp, sin(pitch), -cos(yaw) * cp)

## Cone half-angle in degrees for the character's current state.
func compute_spread(character, weapon: Weapon) -> float:
	var data := weapon.data
	var spread := data.spread_base
	spread += data.spread_moving * float(character.movement_fraction())
	if not character.is_on_floor():
		spread += data.spread_jumping
	if character.is_crouching:
		spread += data.spread_crouching
	if character.intent.aim:
		spread += data.spread_ads
	# Sustained fire opens the cone up.
	spread += minf(3.0, weapon.shots_in_spray * 0.08)
	spread *= character.effects.spread()
	return maxf(0.0, spread)

func _apply_spread(direction: Vector3, spread_degrees: float) -> Vector3:
	if spread_degrees <= 0.0:
		return direction
	# Random point in a cone: uniform angle, sqrt-distributed radius.
	var angle := rng.randf_range(0.0, TAU)
	var radius := sqrt(rng.randf()) * deg_to_rad(spread_degrees)
	var up := Vector3.RIGHT if absf(direction.y) > 0.99 else Vector3.UP
	var right := direction.cross(up).normalized()
	var true_up := right.cross(direction)
	var offset := right * (cos(angle) * radius) + true_up * (sin(angle) * radius)
	return (direction + offset).normalized()

func _resolve_shot(attacker, weapon: Weapon, origin: Vector3, direction: Vector3) -> void:
	var hit := world.raycast(origin, direction, weapon.data.range, [attacker])
	if hit.is_empty():
		Events.weapon_hit.emit(attacker, weapon, origin + direction * weapon.data.range,
			null, GameEnums.HitZone.CHEST, false)
		return

	var target = hit.get("character")
	if target == null:
		Events.weapon_hit.emit(attacker, weapon, hit["position"], null, GameEnums.HitZone.CHEST, false)
		return

	var zone: GameEnums.HitZone = hit["zone"]
	var headshot := zone == GameEnums.HitZone.HEAD
	var damage := weapon.data.damage
	damage *= weapon.data.falloff_multiplier(hit["distance"])
	damage *= Config.game.hit_zone_multiplier(zone)
	if headshot:
		damage *= weapon.data.headshot_multiplier

	apply_damage(target, attacker, damage, weapon.data.id, zone, headshot, weapon.data.armor_penetration)
	Events.weapon_hit.emit(attacker, weapon, hit["position"], target, zone, headshot)

# ------------------------------------------------------------------- damage --
## The single damage entry point. Returns the health actually removed.
func apply_damage(target, attacker, amount: float, source: StringName = &"unknown",
		zone: GameEnums.HitZone = GameEnums.HitZone.CHEST, headshot: bool = false,
		armor_penetration: float = 1.0) -> float:
	if target == null or not target.health.alive or amount <= 0.0:
		return 0.0

	var config := Config.game
	var same_team: bool = attacker != null and attacker != target and attacker.team_id == target.team_id
	if same_team and not config.friendly_fire:
		return 0.0

	var final_amount := amount
	if attacker != null:
		final_amount *= attacker.class_data.damage_dealt_multiplier * attacker.effects.damage_dealt()
	final_amount *= target.class_data.damage_taken_multiplier * target.effects.damage_taken()
	if same_team:
		final_amount *= config.friendly_fire_multiplier

	var result: Dictionary = target.health.take_damage(final_amount, armor_penetration, headshot)
	target.last_damage_time = session.elapsed

	if attacker != null and attacker != target:
		attacker.score["damage"] += result["health_damage"]
		var previous: float = target.damage_taken_from.get(attacker, 0.0)
		target.damage_taken_from[attacker] = previous + result["health_damage"]

	Events.character_damaged.emit(target, attacker, result["health_damage"], zone, source)
	if result["died"]:
		_handle_death(target, attacker, source, headshot)
	return result["health_damage"]

func _handle_death(victim, attacker, source: StringName, headshot: bool) -> void:
	victim.score["deaths"] += 1
	victim.frozen = false
	victim.effects.clear()

	if attacker != null and attacker != victim:
		if attacker.team_id == victim.team_id:
			attacker.score["kills"] -= 1
		else:
			attacker.score["kills"] += 1

	# Assists: anyone else who did meaningful damage to the victim this round.
	for contributor in victim.damage_taken_from:
		if contributor != attacker and contributor.team_id != victim.team_id \
				and victim.damage_taken_from[contributor] >= 40.0:
			contributor.score["assists"] += 1

	Events.character_died.emit(victim, attacker, source, headshot)
	Events.kill_feed.emit(
		attacker.character_name if attacker != null else "World",
		attacker.team_id if attacker != null else -1,
		victim.character_name, victim.team_id, source, headshot)

# ------------------------------------------------------------------- reload --
func start_reload(character) -> bool:
	var weapon: Weapon = character.inventory.active_weapon()
	if weapon == null or not weapon.can_reload():
		return false
	if weapon.start_reload():
		Events.weapon_reload_started.emit(character, weapon)
		return true
	return false

# ----------------------------------------------------------------- grenades --
func throw_grenade(character) -> bool:
	if not combat_enabled or character.frozen or not character.health.alive:
		return false
	var item_id: StringName = character.inventory.take_grenade()
	if item_id == &"":
		return false
	var data := Config.equipment_item(item_id)
	if data == null:
		return false

	var look: Vector3 = character.look_direction()
	var direction := look.rotated(look.cross(Vector3.UP).normalized(), -0.12).normalized()
	var grenade := Grenade.new()
	grenade.setup(data, character, self)
	session.add_child(grenade)
	grenade.global_position = character.eye_position() + direction * 0.6
	grenade.linear_velocity = direction * data.throw_speed + character.velocity * 0.5
	Events.grenade_thrown.emit(character, grenade)
	return true

func explode_grenade(grenade) -> void:
	var data: EquipmentData = grenade.data
	var origin: Vector3 = grenade.global_position
	for victim in world.characters_within(origin, data.grenade_radius, {}):
		if not world.is_visible_from(origin, victim, []):
			continue
		var distance: float = victim.center_position().distance_to(origin)
		var falloff := maxf(data.grenade_min_damage_fraction, 1.0 - distance / maxf(0.01, data.grenade_radius))
		apply_damage(victim, grenade.owner_character, data.grenade_damage * falloff,
			data.id, GameEnums.HitZone.CHEST, false, 0.5)
	Events.grenade_exploded.emit(origin)

func clear_projectiles() -> void:
	for node in session.get_children():
		if node is Grenade:
			node.queue_free()
