@tool
class_name MatchConfig
extends Resource

## Top-level data for the combat sandbox: who spawns, with what stats, and how
## the turrets are tuned. [GameDirector] reads nothing else.

@export var player_loadout: ChampionLoadout
@export var enemy_loadout: ChampionLoadout
@export var wave: WaveConfig

@export_group("Nexus")
@export var nexus_stats: UnitStats
## Attach a [NexusController] to each nexus the map placed, making it a real,
## destructible unit rather than scenery.
@export var spawn_nexus_controllers: bool = true
## Destroying a nexus ends the match.
@export var nexus_destruction_ends_match: bool = true

@export_group("Turrets")
@export var lane_turret_stats: UnitStats
@export var nexus_turret_stats: UnitStats
## Health multiplier per [enum MapEnums.TurretTier] (inhibitor, inner, outer).
@export var turret_tier_health: PackedFloat32Array = PackedFloat32Array([1.3, 1.15, 1.0])
@export var spawn_turret_controllers: bool = true

@export_group("Champions")
## Give AI champions the [ChampionAi] state machine.
@export var enemy_champion_ai: bool = true
@export_range(0, 6, 1) var starting_enemy_champions: int = 2
## Lane fraction an AI champion walks to when it has nothing to fight.
@export_range(0.0, 1.0, 0.05) var ai_push_target: float = 0.5

@export_group("Debug")
## Health bars and combat state are on by default; F10 toggles them.
@export var combat_debug_on_start: bool = true
