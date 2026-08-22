class_name DevInputController
extends Node

## Development-only key bindings: F1-F8 and F10-F12 for the sandbox, Shift+1
## to Shift+8 for progression, economy and vision, Escape for the menu.
##
## Kept in its own node so nothing in the gameplay systems depends on it:
## deleting this node removes every cheat and leaves the sandbox intact. The
## normal debug-view toggle (F9) and the attack-range toggle (C) stay on the
## regular command bus, because a shipped build still exposes both — a cheat is
## something a player should not be able to do, and neither of those is.
##
## The Shift bindings are matched exactly, so pressing 1 on its own does
## nothing: a cheat should never be one mistyped key away.

signal dev_command(label: String)
## Raised when the developer asks for the network readout or the menu.
signal network_debug_requested()
signal menu_requested()
signal shop_toggle_requested()

## What each Shift key hands out. Amounts live here rather than in the branch
## bodies so retuning a cheat is one line.
const GOLD_GRANT := 500.0
const EXPERIENCE_GRANT := 1000.0

var director: GameDirector
var overlay: CombatDebugOverlay


func setup(game_director: GameDirector, debug_overlay: CombatDebugOverlay) -> void:
	director = game_director
	overlay = debug_overlay


func _unhandled_input(event: InputEvent) -> void:
	if director == null:
		return
	if event.is_action_pressed("dev_spawn_enemy_champion"):
		director.dev_spawn_enemy_champion()
		_report("Spawned enemy champion")
	elif event.is_action_pressed("dev_spawn_wave"):
		var count := director.dev_spawn_wave()
		_report("Spawned minion wave (%d minions)" % count)
	elif event.is_action_pressed("dev_reset_champion"):
		director.dev_reset_champion()
		_report("Champion reset")
	elif event.is_action_pressed("dev_teleport_team_a"):
		director.dev_teleport_to_own_spawn()
		_report("Teleported to own spawn")
	elif event.is_action_pressed("dev_teleport_team_b"):
		director.dev_teleport_to_enemy_base()
		_report("Teleported to the enemy base")
	elif event.is_action_pressed("dev_refill_health"):
		director.dev_refill_health()
		_report("Health refilled")
	elif event.is_action_pressed("dev_kill_target"):
		_report("Killed selected target" if director.dev_kill_selected_target() else "No target selected")
	elif event.is_action_pressed("dev_kill_all_enemies"):
		_report("Killed %d enemies" % director.dev_kill_all_enemies())
	elif event.is_action_pressed("toggle_combat_debug") and overlay != null:
		_report("Combat debug %s" % ("on" if overlay.toggle() else "off"))
	elif event.is_action_pressed("toggle_net_debug"):
		network_debug_requested.emit()
	elif event.is_action_pressed("open_multiplayer_menu"):
		menu_requested.emit()
	elif event.is_action_pressed("dev_destroy_nexus"):
		_report("Destroyed the enemy nexus" if director.dev_destroy_enemy_nexus() else "No enemy nexus")
	else:
		_handle_progression_keys(event)


## Shift+1 to Shift+8. Exact matching keeps them off the unmodified number row.
func _handle_progression_keys(event: InputEvent) -> void:
	if event.is_action_pressed("dev_grant_gold", false, true):
		_report("+%d gold" % int(GOLD_GRANT) if director.dev_grant_gold(GOLD_GRANT) else "No champion")
	elif event.is_action_pressed("dev_grant_experience", false, true):
		_report("+%d XP" % int(EXPERIENCE_GRANT) \
			if director.dev_grant_experience(EXPERIENCE_GRANT) else "No champion")
	elif event.is_action_pressed("dev_level_up", false, true):
		_report("Levelled up" if director.dev_level_up() else "Already at the level cap")
	elif event.is_action_pressed("dev_unlock_abilities", false, true):
		_report("Unlocked %d ability ranks" % director.dev_unlock_abilities())
	elif event.is_action_pressed("dev_spawn_ward", false, true):
		_report("Ward placed" if director.dev_place_ward() else "Could not place a ward")
	elif event.is_action_pressed("dev_reveal_vision", false, true):
		_report("Map revealed" if director.dev_toggle_reveal() else "Fog of war restored")
	elif event.is_action_pressed("dev_open_shop", false, true):
		shop_toggle_requested.emit()
	elif event.is_action_pressed("dev_clear_inventory", false, true):
		_report("Cleared %d items" % director.dev_clear_inventory())


func _report(label: String) -> void:
	dev_command.emit(label)
