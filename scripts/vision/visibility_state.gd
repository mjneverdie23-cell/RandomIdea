class_name VisibilityState
extends RefCounted

## Who can see what, right now.
##
## One mask per unit, one bit per team. The authority computes it; clients
## receive it in the ordinary unit snapshot and read their own bit. Because it
## is plain state rather than a rendering trick, targeting, the minimap, the
## HUD and the renderer all answer the same question the same way.

var _masks: Dictionary = {}
## Teams that currently see everything, used by the developer reveal.
var _revealed_teams: int = 0


func clear() -> void:
	_masks.clear()


func set_mask(unit_id: int, mask: int) -> void:
	_masks[unit_id] = mask


func mask_for(unit_id: int) -> int:
	return int(_masks.get(unit_id, 0))


## Own team is always visible; otherwise the bit decides.
func is_visible_to(unit: Node3D, team: int) -> bool:
	if unit == null or not is_instance_valid(unit):
		return false
	if unit.team == team:
		return true
	if _revealed_teams & VisionTypes.team_bit(team):
		return true
	if unit.net_id <= 0:
		return true  # not tracked (e.g. before the first pass) - fail visible
	return bool(mask_for(unit.net_id) & VisionTypes.team_bit(team))


func set_revealed(team: int, revealed: bool) -> void:
	var bit := VisionTypes.team_bit(team)
	_revealed_teams = (_revealed_teams | bit) if revealed else (_revealed_teams & ~bit)


func is_revealed(team: int) -> bool:
	return bool(_revealed_teams & VisionTypes.team_bit(team))


func tracked_count() -> int:
	return _masks.size()
