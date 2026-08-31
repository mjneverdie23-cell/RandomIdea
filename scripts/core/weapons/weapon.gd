## A weapon in someone's hands.
##
## Holds ONLY mutable state; every stat is read from the WeaponData resource.
## That split is what makes weapons data-driven: rebalancing is an inspector
## edit, and a new gun never needs a new class.
class_name Weapon
extends RefCounted

var data: WeaponData
var ammo_in_mag: int = 0
var reserve_ammo: int = 0

var fire_cooldown: float = 0.0     ## seconds until the next shot is allowed
var equip_remaining: float = 0.0   ## seconds left of the draw
var reloading: bool = false
var reload_remaining: float = 0.0

var burst_remaining: int = 0
var burst_delay_remaining: float = 0.0

## Accumulated recoil in degrees, applied to the aim direction.
var recoil_pitch: float = 0.0
var recoil_yaw: float = 0.0
var shots_in_spray: int = 0
var time_since_last_shot: float = 1000.0
## Semi-automatic weapons need the trigger released between shots.
var trigger_released: bool = true

func _init(p_data: WeaponData) -> void:
	data = p_data
	refill_ammo()

func id() -> StringName:
	return data.id

func display_name() -> String:
	return data.display_name

func has_infinite_ammo() -> bool:
	return data.mag_size < 0

func is_empty() -> bool:
	return not has_infinite_ammo() and ammo_in_mag <= 0

func can_reload() -> bool:
	return not has_infinite_ammo() and not reloading \
		and ammo_in_mag < data.mag_size and reserve_ammo > 0

## True when pulling the trigger this tick should produce a shot.
func can_fire() -> bool:
	if equip_remaining > 0.0 or reloading:
		return false
	if fire_cooldown > 0.0 or is_empty():
		return false
	if data.fire_mode == GameEnums.FireMode.SEMI and not trigger_released:
		return false
	if data.fire_mode == GameEnums.FireMode.BURST and burst_delay_remaining > 0.0:
		return false
	return true

## Called by CombatSystem straight after a shot is resolved.
func consume_shot() -> void:
	if not has_infinite_ammo():
		ammo_in_mag -= 1
	fire_cooldown = data.seconds_per_shot()
	trigger_released = false
	shots_in_spray += 1
	time_since_last_shot = 0.0
	if data.fire_mode == GameEnums.FireMode.BURST:
		if burst_remaining <= 0:
			burst_remaining = data.burst_count
		burst_remaining -= 1
		if burst_remaining <= 0:
			burst_delay_remaining = data.burst_delay

func apply_recoil(rng: RandomNumberGenerator) -> void:
	recoil_pitch = minf(data.recoil_max_vertical, recoil_pitch + data.recoil_vertical)
	recoil_yaw += rng.randf_range(-data.recoil_horizontal, data.recoil_horizontal)
	# Horizontal drift stays bounded so sprays are learnable rather than random.
	var limit := data.recoil_max_vertical * 0.5
	recoil_yaw = clampf(recoil_yaw, -limit, limit)

func start_reload() -> bool:
	if not can_reload():
		return false
	reloading = true
	reload_remaining = data.reload_time
	return true

func cancel_reload() -> void:
	reloading = false
	reload_remaining = 0.0

func finish_reload() -> void:
	var needed := data.mag_size - ammo_in_mag
	var taken := mini(needed, reserve_ammo)
	ammo_in_mag += taken
	reserve_ammo -= taken
	reloading = false
	reload_remaining = 0.0

func equip() -> void:
	equip_remaining = data.equip_time
	cancel_reload()
	reset_spray()

func reset_spray() -> void:
	shots_in_spray = 0
	burst_remaining = 0
	burst_delay_remaining = 0.0
	time_since_last_shot = 1000.0

func refill_ammo() -> void:
	ammo_in_mag = data.mag_size
	reserve_ammo = data.reserve_ammo
	reloading = false
	reload_remaining = 0.0

## Advances timers. Returns true when a reload finished this tick.
func update(delta: float, trigger_held: bool) -> bool:
	var reload_finished := false
	equip_remaining = maxf(0.0, equip_remaining - delta)
	fire_cooldown = maxf(0.0, fire_cooldown - delta)
	burst_delay_remaining = maxf(0.0, burst_delay_remaining - delta)
	if not trigger_held:
		trigger_released = true
		if shots_in_spray > 0 and fire_cooldown <= 0.0:
			reset_spray()

	if reloading:
		reload_remaining -= delta
		if reload_remaining <= 0.0:
			finish_reload()
			reload_finished = true

	# Recoil recovers only once the burst is over - otherwise sustained fire
	# would never climb, because recovery would cancel every shot's kick.
	time_since_last_shot += delta
	if trigger_held or time_since_last_shot < data.recoil_recovery_delay:
		return reload_finished
	var recovery := data.recoil_recovery * delta
	recoil_pitch = maxf(0.0, recoil_pitch - recovery)
	if absf(recoil_yaw) <= recovery:
		recoil_yaw = 0.0
	else:
		recoil_yaw -= signf(recoil_yaw) * recovery
	return reload_finished
