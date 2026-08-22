class_name RewardSystem
extends Node

## Turns deaths into gold and XP.
##
## It listens to [signal BattleRegistry.unit_died] rather than living inside
## [MinionController], so a new unit kind becomes payable by adding a line to
## [RewardConfig] — no behaviour script learns about bounties.
##
## Authority only: a client is told the resulting numbers, never the events.

signal reward_granted(champion: ChampionController, gold: float, experience: float, reason: String)

@export var config: RewardConfig


func setup(reward_config: RewardConfig) -> void:
	config = reward_config if reward_config != null else RewardConfig.new()
	if not Battle.unit_died.is_connected(_on_unit_died):
		Battle.unit_died.connect(_on_unit_died)


func _exit_tree() -> void:
	if Battle.unit_died.is_connected(_on_unit_died):
		Battle.unit_died.disconnect(_on_unit_died)


## Passive income, ticked by the director on the authority.
func tick(delta: float) -> void:
	if not Net.is_authority():
		return
	for unit in Battle.all():
		if unit.kind == Unit.Kind.CHAMPION and unit.is_alive() and unit.wallet != null:
			unit.wallet.tick(delta)


func _on_unit_died(unit: Node3D, source: Node) -> void:
	if not Net.is_authority() or config == null or unit == null:
		return
	var killer := _credited_champion(unit, source)
	var bounty := _bounty_for(unit)
	if bounty.is_empty():
		return
	if killer != null:
		_grant(killer, float(bounty["gold"]), float(bounty["xp"]), String(bounty["reason"]))
	_share_experience(unit, killer, float(bounty["xp"]))


## Only a champion of the opposing team is paid, and only when it is the one
## that landed the blow.
func _credited_champion(victim: Node3D, source: Node) -> ChampionController:
	if source == null or not is_instance_valid(source):
		return null
	if not (source is ChampionController):
		return null
	var champion: ChampionController = source
	if champion.team == victim.team or not is_instance_valid(champion):
		return null
	return champion


func _bounty_for(unit: Node3D) -> Dictionary:
	match unit.kind:
		Unit.Kind.MINION:
			var minion_class := MinionStats.MinionClass.MELEE
			if unit.stats_resource is MinionStats:
				minion_class = unit.stats_resource.minion_class
			return {"gold": config.minion_gold(minion_class), "xp": config.minion_xp, "reason": "minion"}
		Unit.Kind.CHAMPION:
			return {"gold": config.champion_gold, "xp": config.champion_xp, "reason": "champion"}
		Unit.Kind.TURRET:
			if unit is NexusController:
				return {}
			return {"gold": config.turret_gold, "xp": config.turret_xp, "reason": "turret"}
	return {}


## Allied champions standing close enough share the XP, not the gold.
func _share_experience(victim: Node3D, killer: ChampionController, experience: float) -> void:
	if experience <= 0.0 or config.shared_xp_ratio <= 0.0:
		return
	var share := experience * config.shared_xp_ratio
	for unit in Battle.all():
		if unit.kind != Unit.Kind.CHAMPION or unit == killer or not unit.is_alive():
			continue
		if unit.team == victim.team:
			continue
		if unit.global_position.distance_to(victim.global_position) > config.xp_share_radius:
			continue
		_grant(unit, 0.0, share, "assist")


func _grant(champion: ChampionController, gold: float, experience: float, reason: String) -> void:
	if champion.wallet != null and gold > 0.0:
		champion.wallet.add(gold, reason)
	if champion.experience != null and experience > 0.0:
		champion.experience.add(experience, reason)
	reward_granted.emit(champion, gold, experience, reason)
