class_name ChampionAi
extends Node

## Small, explicit brain for an AI-controlled champion.
##
## It only reads and writes the champion's existing components, so the same
## [ChampionController] runs under a player's command bus or under this node
## with no branching inside the champion itself.
##
## PUSH_LANE -> ATTACK_MINIONS -> ATTACK_CHAMPION -> RETREAT -> DEFEND -> DEAD

enum State { PUSH_LANE, ATTACK_MINIONS, ATTACK_CHAMPION, RETREAT, DEFEND, DEAD }

const STATE_NAMES := ["PUSH_LANE", "ATTACK_MINIONS", "ATTACK_CHAMPION", "RETREAT", "DEFEND", "DEAD"]

signal state_changed(state: int)

## Health fraction below which the champion pulls back to its fountain.
@export_range(0.05, 0.9, 0.05) var retreat_health_ratio: float = 0.3
## Health fraction that ends a retreat.
@export_range(0.2, 1.0, 0.05) var recover_health_ratio: float = 0.8
## How close an enemy has to be to a friendly structure to trigger DEFEND.
@export_range(2.0, 60.0, 0.5) var defend_radius: float = 15.0
@export_range(0.05, 2.0, 0.05) var think_interval: float = 0.2

var champion: ChampionController
## Where the champion pushes when nothing else is happening.
var push_target: Vector3 = Vector3.ZERO
## Friendly structures worth defending, nearest-first at decision time.
var defend_points: Array[Vector3] = []

## Turned off by tests and by the end of a match; the champion then holds still.
var enabled: bool = true

var state: int = State.PUSH_LANE

var _timer: float = 0.0
var _retreat_point: Vector3 = Vector3.ZERO


func setup(ai_champion: ChampionController, lane_push_target: Vector3, structures: Array[Vector3]) -> void:
	champion = ai_champion
	push_target = lane_push_target
	defend_points = structures
	_retreat_point = ai_champion.spawn_point


func state_name() -> String:
	return STATE_NAMES[state]


## Called by the champion each physics frame while it is alive.
func think(delta: float) -> void:
	if not enabled:
		champion.movement.stop()
		return
	_timer -= delta
	if _timer <= 0.0:
		_timer = think_interval
		_choose_state()
	_act()


func _set_state(next: int) -> void:
	if state == next:
		return
	state = next
	state_changed.emit(state)


func _choose_state() -> void:
	if not champion.is_alive():
		_set_state(State.DEAD)
		return

	var health_ratio := champion.health.health_ratio()
	if state == State.RETREAT and health_ratio < recover_health_ratio:
		return  # keep retreating until healed up
	if health_ratio <= retreat_health_ratio:
		_set_state(State.RETREAT)
		return

	var threatened := _threatened_structure()
	if threatened != null:
		champion.targeting.set_target(threatened)
		_set_state(State.DEFEND)
		return

	var enemy_champion := _nearest_enemy_of_kind(Unit.Kind.CHAMPION, champion.loadout.ai_aggro_range)
	if enemy_champion != null:
		champion.targeting.set_target(enemy_champion)
		_set_state(State.ATTACK_CHAMPION)
		return

	var minion := _nearest_enemy_of_kind(Unit.Kind.MINION, champion.loadout.ai_aggro_range)
	if minion != null:
		champion.targeting.set_target(minion)
		_set_state(State.ATTACK_MINIONS)
		return

	# Nothing nearby: walk down the lane, shooting whatever comes into range.
	var anything := Battle.find_target(champion.global_position, champion.team,
		champion.loadout.ai_aggro_range, [Unit.Kind.CHAMPION, Unit.Kind.MINION, Unit.Kind.TURRET])
	champion.targeting.set_target(anything)
	_set_state(State.PUSH_LANE)


func _act() -> void:
	match state:
		State.RETREAT:
			champion.targeting.clear_target()
			champion.movement.move_to(_retreat_point)
		State.PUSH_LANE:
			_engage_or(push_target)
		_:
			_engage_or(push_target)


## Attack the current target when it is in range, walk to it when it is not,
## and fall back to [param fallback] when there is nothing to fight.
func _engage_or(fallback: Vector3) -> void:
	if not champion.targeting.is_target_valid(INF):
		champion.movement.move_to(fallback)
		return
	var target := champion.targeting.current_target
	if champion.targeting.distance_to_target() <= champion.attack_range():
		champion.movement.stop()
		champion.movement.face_towards(target.global_position)
		_cast_ready_ability(target)
	else:
		champion.movement.move_to(target.global_position)


## Fires whatever is off cooldown and in range. Deliberately unsophisticated.
func _cast_ready_ability(target: Node3D) -> void:
	for slot in champion.abilities.abilities.size():
		var ability := champion.abilities.ability_for(slot)
		if ability == null or not champion.abilities.is_ready(slot):
			continue
		if ability.cast_range > 0.0 and champion.targeting.distance_to_target() > ability.cast_range:
			continue
		champion.abilities.try_cast(slot, target.global_position)
		return


func _nearest_enemy_of_kind(kind: int, max_range: float) -> Node3D:
	return Battle.find_target(champion.global_position, champion.team, max_range, [kind])


## An enemy standing on top of one of our structures takes priority.
func _threatened_structure() -> Node3D:
	for point in defend_points:
		var attacker := Battle.find_target(point, champion.team, defend_radius,
			[Unit.Kind.CHAMPION, Unit.Kind.MINION])
		if attacker != null:
			return attacker
	return null
