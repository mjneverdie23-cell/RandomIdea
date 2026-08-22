@tool
class_name RewardConfig
extends Resource

## What a kill is worth, and how gold trickles in.
##
## [RewardSystem] is the only reader. Nothing in [MinionController] or
## [TurretController] knows a bounty exists.

@export_group("Starting state")
@export_range(0.0, 100000.0, 10.0) var starting_gold: float = 500.0
## Gold per second every champion earns just by being alive.
@export_range(0.0, 100.0, 0.1) var passive_gold_per_second: float = 2.4

@export_group("Minion bounties")
@export_range(0.0, 1000.0, 1.0) var melee_minion_gold: float = 21.0
@export_range(0.0, 1000.0, 1.0) var ranged_minion_gold: float = 17.0
@export_range(0.0, 1000.0, 1.0) var siege_minion_gold: float = 45.0
@export_range(0.0, 1000.0, 1.0) var minion_xp: float = 32.0

@export_group("Structure and champion bounties")
@export_range(0.0, 5000.0, 5.0) var turret_gold: float = 250.0
@export_range(0.0, 5000.0, 5.0) var turret_xp: float = 120.0
@export_range(0.0, 5000.0, 5.0) var champion_gold: float = 300.0
@export_range(0.0, 5000.0, 5.0) var champion_xp: float = 200.0

@export_group("Sharing")
## Allied champions this close to a kill share its XP (not its gold).
@export_range(0.0, 60.0, 0.5) var xp_share_radius: float = 14.0
@export_range(0.0, 1.0, 0.05) var shared_xp_ratio: float = 0.5


## Gold for one minion, chosen by its class.
func minion_gold(minion_class: int) -> float:
	match minion_class:
		MinionStats.MinionClass.RANGED:
			return ranged_minion_gold
		MinionStats.MinionClass.SIEGE:
			return siege_minion_gold
	return melee_minion_gold
