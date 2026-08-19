class_name DevInputController
extends Node

## Development-only key bindings (F1-F8, F10).
##
## Kept in its own node so nothing in the gameplay systems depends on it:
## deleting this node removes every cheat and leaves the sandbox intact. The
## normal debug-view toggle (F9) stays on the regular command bus, because a
## shipped build may still expose it.

signal dev_command(label: String)

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
		director.dev_teleport_player("TEAM_A_SPAWN")
		_report("Teleported to TEAM_A_SPAWN")
	elif event.is_action_pressed("dev_teleport_team_b"):
		director.dev_teleport_player("TEAM_B_BASE")
		_report("Teleported to TEAM_B_BASE")
	elif event.is_action_pressed("dev_refill_health"):
		director.dev_refill_health()
		_report("Health refilled")
	elif event.is_action_pressed("dev_kill_target"):
		_report("Killed selected target" if director.dev_kill_selected_target() else "No target selected")
	elif event.is_action_pressed("dev_kill_all_enemies"):
		_report("Killed %d enemies" % director.dev_kill_all_enemies())
	elif event.is_action_pressed("toggle_combat_debug") and overlay != null:
		_report("Combat debug %s" % ("on" if overlay.toggle() else "off"))


func _report(label: String) -> void:
	dev_command.emit(label)
