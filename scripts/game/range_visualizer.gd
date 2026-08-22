class_name RangeVisualizer
extends Node3D

## The one place attack ranges are drawn.
##
## Before this existed, the combat overlay put a permanent ring under every
## champion and every turret, which buried the map under circles that told the
## player nothing. A range ring is only useful when it answers a question the
## player is actually asking, so exactly three things put one on screen:
##
##   * the local champion's own range, while the player has toggled it on
##     (the [signal InputCommands.range_toggle_requested] action, bound to C on
##     a keyboard and to a button on a touch HUD);
##   * an enemy tower that is currently threatening the local champion — the
##     champion stands inside its real attack range and can actually see it;
##   * everything at once, while the developer combat overlay is on.
##
## Nothing else ever gets a ring: not enemy champions, not allied towers, not
## minions. Rings are local presentation with no replication — the server
## remains the only judge of whether an attack is in range, and one player
## toggling their own ring cannot be seen by anyone else.

signal own_range_toggled(is_visible: bool)

## Rings are cheap but not free, and nothing here needs a frame tick.
const REFRESH_INTERVAL := 0.1
## Rebuild the mesh only when the range really moved (an item, a level).
const RADIUS_EPSILON := 0.05

var config: RangeDisplayConfig
## The champion this machine drives. Everything below is relative to it.
var local_champion: ChampionController
## Developer override: show every range, whatever the rules say.
var debug_all: bool = false

var _rings: Dictionary = {}
var _own_visible: bool = false
var _timer: float = 0.0


func setup(display_config: RangeDisplayConfig, champion: ChampionController = null) -> void:
	config = display_config if display_config != null else RangeDisplayConfig.new()
	_own_visible = config.own_range_visible_on_start
	local_champion = champion
	if not Battle.unit_unregistered.is_connected(_on_unit_unregistered):
		Battle.unit_unregistered.connect(_on_unit_unregistered)
	refresh()


func set_local_champion(champion: ChampionController) -> void:
	local_champion = champion
	refresh()


# --- the player's own ring ---------------------------------------------------

## Raised by the range-toggle command, never by a key check, so a mobile
## button reaches it the same way the C key does.
func toggle_own_range() -> bool:
	set_own_range_visible(not _own_visible)
	return _own_visible


func set_own_range_visible(value: bool) -> void:
	if _own_visible == value:
		return
	_own_visible = value
	own_range_toggled.emit(value)
	refresh()


func is_own_range_visible() -> bool:
	return _own_visible


## Developer combat debug (F10) reveals every range at once.
func set_debug_all(value: bool) -> void:
	if debug_all == value:
		return
	debug_all = value
	refresh()


# --- the rules ---------------------------------------------------------------

## Should [param unit] be showing a range ring right now?
func _wants_ring(unit: Node3D) -> bool:
	if not is_instance_valid(unit) or not unit.is_alive():
		return false
	if debug_all:
		# The developer view is the only thing that shows minion rings.
		return unit.kind != Unit.Kind.MINION or not config.show_minions_in_debug_only
	match unit.kind:
		Unit.Kind.CHAMPION:
			# Only ever the local player's own champion, and only on request.
			# An enemy champion's range is never shown in normal gameplay, and
			# neither is an ally's.
			return _own_visible and unit == local_champion
		Unit.Kind.TURRET:
			return _is_threatening_tower(unit)
	return false


## An enemy tower earns a ring the moment it could actually shoot the local
## champion: the champion is inside the tower's real, configured attack range
## and has vision of the tower. Leaving the range — or losing sight of it —
## takes the ring away again, so the ring means "this is shooting at you".
func _is_threatening_tower(tower: Node3D) -> bool:
	if not config.show_threatening_enemy_towers:
		return false
	if local_champion == null or not is_instance_valid(local_champion) or not local_champion.is_alive():
		return false
	if tower.team == local_champion.team:
		return false  # allied towers stay quiet
	if not tower.is_visible_to(local_champion.team):
		return false  # fog of war hides the threat as well as the tower
	var gap := tower.global_position.distance_to(local_champion.global_position)
	return gap <= tower.attack_range() + config.threat_hysteresis


func _color_for(unit: Node3D) -> Color:
	if local_champion != null and unit == local_champion:
		return config.own_color
	if local_champion != null and unit.team != local_champion.team:
		return config.threat_color if unit.kind == Unit.Kind.TURRET and not debug_all \
			else config.debug_enemy_color
	return config.debug_ally_color


# --- ring nodes --------------------------------------------------------------

func _process(delta: float) -> void:
	_timer -= delta
	if _timer > 0.0:
		return
	_timer = REFRESH_INTERVAL
	refresh()


## Recomputes every ring now rather than on the next tick.
func refresh() -> void:
	if config == null:
		return
	for unit in Battle.all():
		var wanted := _wants_ring(unit)
		if not wanted and not _rings.has(unit):
			continue  # never built a ring for this unit, and still does not need one
		var ring := _ring_for(unit)
		if ring == null:
			continue
		ring.visible = wanted
		if wanted:
			_apply(unit, ring)


## Builds the ring lazily: a minion that never enters the developer view never
## allocates one.
func _ring_for(unit: Node3D) -> MeshInstance3D:
	if _rings.has(unit):
		var existing: Dictionary = _rings[unit]
		return existing["node"]
	var radius := maxf(unit.attack_range(), 0.5)
	var color := _color_for(unit)
	var ring := PrototypeMeshes.ring(radius, config.thickness, color)
	ring.name = "RangeRing"
	ring.position.y = config.height
	unit.add_child(ring)
	_rings[unit] = {"node": ring, "radius": radius, "color": color}
	return ring


## Keeps the drawn radius honest: it is the unit's live attack range, so an
## item or a level that extends the range extends the ring too.
func _apply(unit: Node3D, ring: MeshInstance3D) -> void:
	var entry: Dictionary = _rings[unit]
	var radius := maxf(unit.attack_range(), 0.5)
	if absf(float(entry["radius"]) - radius) > RADIUS_EPSILON:
		ring.mesh = PrototypeMeshes.ring(radius, config.thickness, entry["color"]).mesh
		entry["radius"] = radius
	var color := _color_for(unit)
	if color != entry["color"]:
		entry["color"] = color
		ring.material_override = PrototypeMeshes.material(color, true)


func _on_unit_unregistered(unit: Node3D) -> void:
	_rings.erase(unit)


## Test and debug helper: how many rings are actually on screen.
func visible_ring_count() -> int:
	var total := 0
	for unit in _rings:
		if is_instance_valid(unit) and bool(_rings[unit]["node"].visible):
			total += 1
	return total


func is_ring_visible_for(unit: Node3D) -> bool:
	if not _rings.has(unit):
		return false
	return bool(_rings[unit]["node"].visible)
