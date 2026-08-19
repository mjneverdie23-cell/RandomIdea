class_name NetworkStateSync
extends Node

## Streams the authority's unit state to clients at a fixed tick.
##
## Only what a client needs in order to draw and predict is sent: position,
## facing, health and alive flag, keyed by the unit's network id. Clients never
## simulate — [Unit] interpolates towards whatever arrives here — so there is no
## way for a client to disagree with the server about a result.
##
## One snapshot per tick keeps traffic flat: with two champions, four towers,
## two nexuses and a lane of minions this is a few kilobytes per second.

## Snapshot rate in hertz. Movement is interpolated between ticks.
@export_range(5.0, 60.0, 1.0) var tick_rate: float = 20.0

var units_root: Node3D

var _accumulator: float = 0.0
var _snapshots_sent: int = 0
var _snapshots_received: int = 0
var _last_snapshot_units: int = 0


func setup(container: Node3D) -> void:
	units_root = container


func describe() -> Dictionary:
	return {
		"tick_rate": tick_rate,
		"sent": _snapshots_sent,
		"received": _snapshots_received,
		"units": _last_snapshot_units,
	}


func _physics_process(delta: float) -> void:
	if not Net.is_networked() or not Net.is_authority() or Net.peer_count() == 0:
		return
	_accumulator += delta
	var interval := 1.0 / maxf(tick_rate, 1.0)
	if _accumulator < interval:
		return
	_accumulator = 0.0
	_broadcast()


func _broadcast() -> void:
	var ids := PackedInt32Array()
	var values := PackedFloat32Array()
	var flags := PackedByteArray()
	# Champions carry a small extra block so a client's ability bar shows the
	# authority's real cooldowns rather than a locally guessed one.
	var champion_ids := PackedInt32Array()
	var cooldowns := PackedFloat32Array()
	for unit in Battle.all():
		if unit.net_id <= 0:
			continue
		if unit.kind == Unit.Kind.CHAMPION and unit.abilities != null:
			champion_ids.append(unit.net_id)
			cooldowns.append_array(unit.abilities.snapshot_cooldowns())
		ids.append(unit.net_id)
		var position: Vector3 = unit.global_position
		values.append(position.x)
		values.append(position.y)
		values.append(position.z)
		values.append(unit.facing_angle())
		values.append(unit.health.current)
		flags.append(1 if unit.is_alive() else 0)
	_last_snapshot_units = ids.size()
	_snapshots_sent += 1
	_receive_snapshot.rpc(ids, values, flags, champion_ids, cooldowns)


@rpc("authority", "call_remote", "unreliable_ordered")
func _receive_snapshot(ids: PackedInt32Array, values: PackedFloat32Array, flags: PackedByteArray,
		champion_ids: PackedInt32Array, cooldowns: PackedFloat32Array) -> void:
	_snapshots_received += 1
	_last_snapshot_units = ids.size()
	var by_id := _index_units()
	for i in ids.size():
		var unit: Unit = by_id.get(ids[i], null)
		if unit == null:
			continue
		var base := i * 5
		unit.apply_network_state(
			Vector3(values[base], values[base + 1], values[base + 2]),
			values[base + 3], values[base + 4], flags[i] == 1
		)
	var stride := InputCommands.ABILITY_NAMES.size()
	for i in champion_ids.size():
		var champion: Unit = by_id.get(champion_ids[i], null)
		if champion == null or champion.abilities == null:
			continue
		champion.abilities.apply_replicated_cooldowns(cooldowns.slice(i * stride, (i + 1) * stride))


func _index_units() -> Dictionary:
	var out: Dictionary = {}
	for unit in Battle.all():
		if unit.net_id > 0:
			out[unit.net_id] = unit
	return out


# --- one-shot effects --------------------------------------------------------

## Ability and attack flashes are cosmetic, so they are fired once rather than
## carried in every snapshot. Ignored entirely when offline.
func broadcast_effect(at: Vector3, radius: float, color: Color, duration: float) -> void:
	if not Net.is_networked() or not Net.is_authority() or Net.peer_count() == 0:
		return
	_receive_effect.rpc(at, radius, color, duration)


@rpc("authority", "call_remote", "reliable")
func _receive_effect(at: Vector3, radius: float, color: Color, duration: float) -> void:
	if units_root != null:
		AbilityPulse.spawn(units_root, at, radius, color, duration)
