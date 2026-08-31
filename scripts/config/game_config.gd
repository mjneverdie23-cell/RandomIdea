## Every number that defines the shape of a match.
##
## This is a Resource, so `data/config/game_config.tres` opens in the inspector and
## a designer can rebalance the whole game without touching a script. No system
## hard-codes a duration, a price or a win condition - they all read it from here
## via the `Config` autoload.
class_name GameConfig
extends Resource

# --------------------------------------------------------------------- match --
@export_group("Match")
## First team to this many round wins takes the match.
@export var rounds_to_win: int = 13
## Teams swap sides once this many rounds are complete.
@export var switch_sides_after_round: int = 12
## Hard cap on regulation rounds (normally 2 x switch_sides_after_round).
@export var max_rounds: int = 24
## Players per team. Empty slots are filled with bots.
@export var team_size: int = 5
@export var overtime_enabled: bool = false
@export var overtime_rounds_per_half: int = 3
@export var overtime_starting_money: int = 12500

# --------------------------------------------------------------------- round --
@export_group("Round")
@export var warmup_duration: float = 6.0
## Freeze time. Players are rooted and the shop is open.
@export var buy_duration: float = 15.0
## Live time before the defenders win on the clock.
@export var round_duration: float = 115.0
@export var round_end_duration: float = 5.0
@export var respawn_during_warmup: bool = true
@export var warmup_respawn_delay: float = 3.0

# ---------------------------------------------------------------------- bomb --
@export_group("Bomb")
@export var bomb_fuse_duration: float = 40.0
## Uninterrupted seconds needed to plant.
@export var plant_duration: float = 3.2
@export var defuse_duration: float = 10.0
@export var defuse_duration_with_kit: float = 5.0
## Stops players planting from on top of tall cover.
@export var plant_max_height_above_site: float = 2.5
## Interaction distance for defusing and picking the bomb back up.
@export var bomb_interact_radius: float = 2.2
@export var bomb_pickup_radius: float = 1.8
@export var explosion_radius: float = 28.0
@export var explosion_damage: float = 500.0
## Damage falls off linearly to this fraction at the edge of the radius.
@export var explosion_min_damage_fraction: float = 0.15

# ------------------------------------------------------------------- economy --
@export_group("Economy")
@export var starting_money: int = 800
@export var max_money: int = 16000
## Money is reset to starting_money when sides switch (second-half pistol round).
@export var reset_money_on_side_switch: bool = true
@export var round_win_reward: int = 3250
@export var bomb_detonated_bonus: int = 300
@export var bomb_defused_bonus: int = 300
## Consecutive-loss bonus: base + increment per extra loss, capped.
@export var loss_bonus_base: int = 1400
@export var loss_bonus_increment: int = 500
@export var loss_bonus_max: int = 3400
## Losing the round but having planted still pays this much extra.
@export var loss_with_plant_bonus: int = 800
@export var plant_reward: int = 300
@export var defuse_reward: int = 300
@export var team_kill_penalty: int = -300
@export var suicide_penalty: int = -300

# -------------------------------------------------------------------- combat --
@export_group("Combat")
## Fraction of character height above which a hit counts as a headshot.
@export var head_zone_fraction: float = 0.86
@export var stomach_zone_fraction: float = 0.55
@export var legs_zone_fraction: float = 0.42
@export var chest_damage_multiplier: float = 1.0
@export var stomach_damage_multiplier: float = 1.15
@export var legs_damage_multiplier: float = 0.75
## How much of the damage armour absorbs is taken off the armour value.
@export var armor_damage_fraction: float = 0.5
## Headshot damage reduction while a helmet is worn.
@export var helmet_headshot_reduction: float = 0.4
@export var friendly_fire: bool = false
@export var friendly_fire_multiplier: float = 0.35

# ------------------------------------------------------------------ movement --
@export_group("Movement")
@export var gravity: float = 22.0
@export var ground_acceleration: float = 70.0
@export var air_acceleration: float = 14.0
@export var ground_friction: float = 9.0
## Maximum ledge height the controller climbs automatically.
@export var step_height: float = 0.6
@export var sprint_multiplier: float = 1.35
@export var crouch_multiplier: float = 0.5
@export var ads_multiplier: float = 0.55
@export var crouch_height_fraction: float = 0.62
## Fall damage starts above this impact speed.
@export var fall_damage_min_speed: float = 18.0
@export var fall_damage_per_unit_speed: float = 4.5

# ---------------------------------------------------------------------- shop --
@export_group("Shop")
## Players must stand in their own spawn zone to buy.
@export var shop_require_spawn_zone: bool = true
## Buying is allowed during these round phases (GameEnums.RoundPhase values).
@export var shop_allowed_phases: Array[int] = [
	GameEnums.RoundPhase.BUY, GameEnums.RoundPhase.WARMUP,
]

# ----------------------------------------------------------------- simulation --
@export_group("Simulation")
## Seed for the deterministic RNG. Change it for a different (still repeatable) match.
@export var seed: int = 20260831

## Damage multiplier for a hit zone, before the weapon's own headshot multiplier.
func hit_zone_multiplier(zone: GameEnums.HitZone) -> float:
	match zone:
		GameEnums.HitZone.HEAD: return 1.0
		GameEnums.HitZone.CHEST: return chest_damage_multiplier
		GameEnums.HitZone.STOMACH: return stomach_damage_multiplier
		GameEnums.HitZone.LEGS: return legs_damage_multiplier
	return 1.0
