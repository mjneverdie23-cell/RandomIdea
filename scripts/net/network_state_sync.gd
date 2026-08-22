class_name NetworkStateSync
extends Node

## Streams the authority's unit state to clients at a fixed tick.
##
## Only what a client needs in order to draw and predict is sent: position,
## facing, health, the alive flag and who can see the unit, keyed by the unit's
## network id, plus a small per-champion block of gold, experience and level.
## Clients never simulate — [Unit] interpolates towards whatever arrives here —
## so there is no way for a client to disagree with the server about a result.
##
## The three flag bits ride in the byte that already carried "alive", so vision
## costs nothing extra on the wire. Ability ranks and inventory contents change
## rarely, so they go out reliably and only when they actually change rather
## than in every snapshot.
##
## One snapshot per tick keeps traffic flat: with two champions, four towers,
## two nexuses and a lane of minions this is a few kilobytes per second.

## Snapshot rate in hertz. Movement is interpolated between ticks.
@export_range(5.0, 60.0, 1.0) var tick_rate: float = 20.0

## Per-champion floats in the snapshot: gold, XP into the level, level,
## unspent skill points and the ability resource pool.
const CHAMPION_STRIDE := 6
## Ranks and items are resent this often even when nothing changed, so a client
## that missed a packet — or one whose local copy was tampered with — is
## corrected within a second rather than at the next purchase.
const LOADOUT_KEEPALIVE := 1.0

var units_root: Node3D
## Needed to turn replicated item ids back into resources on a client.
var catalog: ShopCatalog

var _accumulator: float = 0.0
var _snapshots_sent: int = 0
var _snapshots_received: int = 0
var _last_snapshot_units: int = 0
## net id -> last replicated "ranks|items" string, so unchanged loadouts are
## never resent.
var _loadout_signatures: Dictionary = {}
var _loadout_timer: float = 0.0


func setup(container: Node3D, shop_catalog: ShopCatalog = null) -> void:
	units_root = container
	catalog = shop_catalog


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
	# authority's real cooldowns rather than a locally guessed one, and its gold
	# and level come from the server rather than from a local guess.
	var champion_ids := PackedInt32Array()
	var cooldowns := PackedFloat32Array()
	var champion_values := PackedFloat32Array()
	for unit in Battle.all():
		if unit.net_id <= 0:
			continue
		if unit.kind == Unit.Kind.CHAMPION and unit.abilities != null:
			champion_ids.append(unit.net_id)
			cooldowns.append_array(unit.abilities.snapshot_cooldowns())
			champion_values.append_array(_champion_block(unit))
		ids.append(unit.net_id)
		var position: Vector3 = unit.global_position
		values.append(position.x)
		values.append(position.y)
		values.append(position.z)
		values.append(unit.facing_angle())
		values.append(unit.health.current)
		# Bit 0 alive, bits 1 and 2 the per-team visibility the authority just
		# computed. A client is told what it may see; it never decides it.
		var byte := VisionTypes.ALIVE_BIT if unit.is_alive() else 0
		flags.append(byte | Vision.state.mask_for(unit.net_id))
	_last_snapshot_units = ids.size()
	_snapshots_sent += 1
	_receive_snapshot.rpc(ids, values, flags, champion_ids, cooldowns, champion_values)
	_broadcast_changed_loadouts()


## Gold, experience, level and ability resource for one champion.
func _champion_block(champion: Unit) -> PackedFloat32Array:
	return PackedFloat32Array([
		champion.wallet.gold if champion.wallet != null else 0.0,
		champion.experience.into_level if champion.experience != null else 0.0,
		float(champion.level.level) if champion.level != null else 1.0,
		float(champion.level.skill_points) if champion.level != null else 0.0,
		champion.resource_pool.current if champion.resource_pool != null else 0.0,
		champion.resource_pool.maximum if champion.resource_pool != null else 0.0,
	])


## Ability ranks and item slots only move when a player spends something, so
## they are sent reliably and only on a change rather than twenty times a
## second.
func _broadcast_changed_loadouts() -> void:
	_loadout_timer -= 1.0 / maxf(tick_rate, 1.0)
	if _loadout_timer <= 0.0:
		_loadout_timer = LOADOUT_KEEPALIVE
		_loadout_signatures.clear()
	for unit in Battle.all():
		if unit.kind != Unit.Kind.CHAMPION or unit.net_id <= 0 or unit.abilities == null:
			continue
		var ranks: PackedInt32Array = unit.abilities.ranks.duplicate()
		var items: PackedStringArray = unit.inventory.item_ids() \
			if unit.inventory != null else PackedStringArray()
		var signature := "%s|%s" % [ranks, items]
		if _loadout_signatures.get(unit.net_id, "") == signature:
			continue
		_loadout_signatures[unit.net_id] = signature
		_receive_champion_loadout.rpc(unit.net_id, ranks, items)


@rpc("authority", "call_remote", "unreliable_ordered")
func _receive_snapshot(ids: PackedInt32Array, values: PackedFloat32Array, flags: PackedByteArray,
		champion_ids: PackedInt32Array, cooldowns: PackedFloat32Array,
		champion_values: PackedFloat32Array) -> void:
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
			values[base + 3], values[base + 4], (flags[i] & VisionTypes.ALIVE_BIT) != 0
		)
		Vision.apply_replicated_mask(ids[i], flags[i] & ~VisionTypes.ALIVE_BIT)
	var stride := InputCommands.ABILITY_NAMES.size()
	for i in champion_ids.size():
		var champion: Unit = by_id.get(champion_ids[i], null)
		if champion == null or champion.abilities == null:
			continue
		champion.abilities.apply_replicated_cooldowns(cooldowns.slice(i * stride, (i + 1) * stride))
		_apply_champion_block(champion, champion_values.slice(
			i * CHAMPION_STRIDE, (i + 1) * CHAMPION_STRIDE))


func _apply_champion_block(champion: Unit, block: PackedFloat32Array) -> void:
	if block.size() < CHAMPION_STRIDE:
		return
	var level := int(block[2])
	if champion.wallet != null:
		champion.wallet.apply_replicated(block[0])
	if champion.level != null:
		champion.level.apply_replicated(level, int(block[3]))
	if champion.experience != null:
		champion.experience.apply_replicated(block[1], level)
	if champion.resource_pool != null:
		champion.resource_pool.apply_replicated(block[4], block[5])


@rpc("authority", "call_remote", "reliable")
func _receive_champion_loadout(net_id: int, ranks: PackedInt32Array,
		items: PackedStringArray) -> void:
	var champion: Unit = _index_units().get(net_id, null)
	if champion == null:
		return
	if champion.abilities != null:
		champion.abilities.apply_replicated_ranks(ranks)
	if champion.inventory != null:
		champion.inventory.apply_replicated(items, catalog)


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
