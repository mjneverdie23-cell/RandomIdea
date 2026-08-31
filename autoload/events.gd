## Global signal hub.
##
## Systems talk to each other through these signals, never by direct reference,
## so a new consumer (a HUD widget, an audio cue, analytics, a bot behaviour) can
## be bolted on without touching the system that produces the event.
##
## Connect from anywhere:  Events.bomb_planted.connect(_on_bomb_planted)
extends Node

# --- match / round lifecycle -------------------------------------------------
signal match_started()
## reason: "ROUNDS_REACHED" | "ROUNDS_EXHAUSTED" | "DRAW"
signal match_ended(winning_team: int, reason: String, scores: Dictionary)
signal round_phase_changed(phase: GameEnums.RoundPhase, previous: GameEnums.RoundPhase, round_number: int)
signal round_started(round_number: int)
signal round_ended(round_number: int, winning_team: int, reason: GameEnums.RoundEndReason, scores: Dictionary)
signal sides_switched(completed_rounds: int)
signal score_changed(scores: Dictionary)

# --- characters ---------------------------------------------------------------
signal character_spawned(character: Node)
signal character_damaged(target: Node, attacker: Node, amount: float, zone: GameEnums.HitZone, source: StringName)
signal character_died(victim: Node, attacker: Node, source: StringName, headshot: bool)
signal character_class_changed(character: Node, class_id: StringName)

# --- weapons / combat ---------------------------------------------------------
signal weapon_fired(character: Node, weapon: Weapon, origin: Vector3, direction: Vector3)
signal weapon_hit(character: Node, weapon: Weapon, point: Vector3, target: Node, zone: GameEnums.HitZone, headshot: bool)
signal weapon_reload_started(character: Node, weapon: Weapon)
signal weapon_reload_finished(character: Node, weapon: Weapon)
signal weapon_switched(character: Node, weapon: Weapon)
signal weapon_dry_fire(character: Node, weapon: Weapon)
signal grenade_thrown(character: Node, grenade: Node)
signal grenade_exploded(position: Vector3)

# --- abilities ------------------------------------------------------------------
signal ability_used(character: Node, ability_id: StringName)
signal ability_ended(character: Node, ability_id: StringName)

# --- economy / shop -------------------------------------------------------------
signal money_changed(character: Node, amount: int, delta: int, reason: StringName)
signal item_purchased(character: Node, item_id: StringName, price: int)
signal purchase_rejected(character: Node, item_id: StringName, result: GameEnums.PurchaseResult)

# --- bomb / objective -----------------------------------------------------------
signal bomb_picked_up(character: Node)
signal bomb_dropped(position: Vector3, character: Node)
signal bomb_plant_started(character: Node, site_id: StringName)
signal bomb_plant_aborted(character: Node)
signal bomb_planted(character: Node, site_id: StringName, position: Vector3)
signal bomb_defuse_started(character: Node, duration: float)
signal bomb_defuse_aborted(character: Node)
signal bomb_defused(character: Node)
signal bomb_exploded(position: Vector3)
signal bomb_beep(fuse_remaining: float, position: Vector3)

# --- presentation hooks ----------------------------------------------------------
signal notification_posted(text: String, level: StringName)
signal kill_feed(attacker_name: String, attacker_team: int, victim_name: String, victim_team: int, source: StringName, headshot: bool)

## Disconnects every listener. Called between test sessions so one match's
## listeners can never observe the next one.
func reset() -> void:
	for signal_info in get_signal_list():
		var signal_name: StringName = signal_info["name"]
		for connection in get_signal_connection_list(signal_name):
			disconnect(signal_name, connection["callable"])
