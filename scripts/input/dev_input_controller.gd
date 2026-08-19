class_name DevInputController
extends Node

## Development-only key bindings (F1-F8, F10-F12).
##
## Kept in its own node so nothing in the gameplay systems depends on it:
## deleting this node removes every cheat and leaves the sandbox intact. The
## normal debug-view toggle (F9) stays on the regular command bus, because a
## shipped build may still expose it.

signal dev_command(label: String)
## Raised when the developer asks for a different game mode.
signal game_mode_cycle_requested()

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
	elif event.is_action_pressed("cycle_game_mode"):
		game_mode_cycle_requested.emit()
	elif event.is_action_pressed("dev_destroy_nexus"):
		_report("Destroyed the enemy nexus" if director.dev_destroy_enemy_nexus() else "No enemy nexus")


func _report(label: String) -> void:
	dev_command.emit(label)
