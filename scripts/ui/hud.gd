## The heads-up display.
##
## A pure consumer: it reads simulation state and listens to events, and never
## writes anything back. Layout lives in `scenes/ui/hud.tscn` - this script only
## fills it in, so restyling is an editor job, not a code job.
extends CanvasLayer

@onready var team_one_name: Label = $Root/TopBar/Row/TeamOne/Name
@onready var team_one_score: Label = $Root/TopBar/Row/TeamOne/Score
@onready var team_one_side: Label = $Root/TopBar/Row/TeamOne/Side
@onready var team_two_name: Label = $Root/TopBar/Row/TeamTwo/Name
@onready var team_two_score: Label = $Root/TopBar/Row/TeamTwo/Score
@onready var team_two_side: Label = $Root/TopBar/Row/TeamTwo/Side
@onready var clock_time: Label = $Root/TopBar/Row/Clock/Time
@onready var clock_phase: Label = $Root/TopBar/Row/Clock/Phase
@onready var clock_round: Label = $Root/TopBar/Row/Clock/Round
@onready var objective: PanelContainer = $Root/Objective
@onready var objective_label: Label = $Root/Objective/Label
@onready var health_label: Label = $Root/Vitals/Column/Row/Health
@onready var armor_label: Label = $Root/Vitals/Column/Row/Armor
@onready var health_bar: ProgressBar = $Root/Vitals/Column/HealthBar
@onready var class_line: Label = $Root/Vitals/Column/ClassLine
@onready var ammo_label: Label = $Root/WeaponPanel/Column/Ammo
@onready var weapon_name: Label = $Root/WeaponPanel/Column/WeaponName
@onready var money_label: Label = $Root/WeaponPanel/Column/Money
@onready var slots_label: Label = $Root/WeaponPanel/Column/Slots
@onready var abilities_row: HBoxContainer = $Root/Abilities
@onready var kill_feed: VBoxContainer = $Root/KillFeed
@onready var crosshair: Control = $Root/Crosshair
@onready var hit_marker: Label = $Root/HitMarker
@onready var interaction: PanelContainer = $Root/Interaction
@onready var interaction_label: Label = $Root/Interaction/Column/Label
@onready var interaction_progress: ProgressBar = $Root/Interaction/Column/Progress
@onready var banner: PanelContainer = $Root/Banner
@onready var banner_title: Label = $Root/Banner/Column/Title
@onready var banner_reason: Label = $Root/Banner/Column/Reason
@onready var damage_flash: ColorRect = $Root/DamageFlash
@onready var debug_label: Label = $Root/Debug

const KILL_FEED_LIFETIME := 6.0
const KILL_FEED_MAX := 6

var show_debug: bool = false
var _banner_timer: float = 0.0
var _hit_marker_timer: float = 0.0
var _damage_timer: float = 0.0
var _kill_feed_entries: Array[Dictionary] = []

func _ready() -> void:
	Events.kill_feed.connect(_on_kill_feed)
	Events.weapon_hit.connect(_on_weapon_hit)
	Events.character_died.connect(_on_character_died)
	Events.character_damaged.connect(_on_character_damaged)
	Events.round_ended.connect(_on_round_ended)
	Events.round_phase_changed.connect(_on_phase_changed)
	Events.sides_switched.connect(func(_rounds):
		show_banner("SIDES SWITCHED", "Second half - money reset", Color("e0a54a"), 4.0))
	Events.purchase_rejected.connect(func(character, _item, result):
		if character == Game.local_player():
			show_banner("Purchase failed", GameEnums.PURCHASE_RESULT_TEXT.get(result, ""), Color("ff4d4d"), 1.4))

func _process(delta: float) -> void:
	if not Game.has_session():
		return
	var session := Game.session
	_update_top_bar(session)
	_update_objective(session)
	var player := Game.local_player()
	if player != null:
		_update_vitals(player)
		_update_weapon(player)
		_update_abilities(player)
		_update_interaction(player, session.bomb)
	_tick_timers(delta)
	if show_debug:
		debug_label.text = _debug_text(session)
	debug_label.visible = show_debug

func _update_top_bar(session: MatchSession) -> void:
	var teams := session.teams
	var one := teams.get_team(GameEnums.Team.TEAM_ONE)
	var two := teams.get_team(GameEnums.Team.TEAM_TWO)
	team_one_name.text = one.name
	team_one_score.text = str(one.score)
	team_one_side.text = "ATTACK" if one.side == GameEnums.Side.ATTACKERS else "DEFEND"
	team_two_name.text = two.name
	team_two_score.text = str(two.score)
	team_two_side.text = "ATTACK" if two.side == GameEnums.Side.ATTACKERS else "DEFEND"

	var remaining := session.round_manager.time_remaining()
	clock_time.text = "%d:%02d" % [int(remaining) / 60, int(remaining) % 60]
	var urgent := remaining <= 10.0 and session.round_manager.phase == GameEnums.RoundPhase.LIVE
	clock_time.modulate = Color("ff4d4d") if urgent else Color.WHITE
	clock_phase.text = _phase_label(session.round_manager.phase)
	clock_round.text = "warmup" if session.round_manager.phase == GameEnums.RoundPhase.WARMUP \
		else "round %d / to %d" % [session.match_manager.round_number, Config.game.rounds_to_win]

func _update_objective(session: MatchSession) -> void:
	var bomb := session.bomb
	var player := Game.local_player()
	var side := session.teams.side_of(player.team_id) if player != null else GameEnums.Side.ATTACKERS
	var text := ""
	var planted := false

	match session.round_manager.phase:
		GameEnums.RoundPhase.BUY:
			text = "BUY PHASE - press [B] for the shop"
		GameEnums.RoundPhase.WARMUP:
			text = "WARMUP - free roam, no scoring"
		_:
			if bomb.is_planted():
				planted = true
				text = "BOMB PLANTED AT %s - %.1fs" % [bomb.site_id, bomb.fuse_remaining]
				if bomb.defusing != null:
					text += " - defusing %d%%" % int(bomb.defuse_progress * 100.0)
			elif bomb.is_dropped():
				text = "BOMB DROPPED"
			elif side == GameEnums.Side.ATTACKERS:
				if player != null and player.inventory.has_bomb:
					text = "YOU CARRY THE BOMB - reach site A or B and hold [E]"
				else:
					text = "PLANT THE BOMB - carrier: %s" % (bomb.carrier.character_name if bomb.carrier != null else "nobody")
			else:
				text = "DEFEND BOTH SITES"

	objective_label.text = text
	objective_label.modulate = Color("ffd9d9") if planted else Color.WHITE
	objective.visible = text != ""

func _update_vitals(player: Character) -> void:
	health_label.text = str(int(ceil(player.health.health)))
	armor_label.text = "%d%s" % [int(ceil(player.health.armor)), " +H" if player.health.has_helmet else ""]
	health_bar.value = player.health.health_fraction() * 100.0
	class_line.text = "%s - %s%s" % [player.class_data.display_name, player.class_data.role,
		"" if player.health.alive else " - DEAD (spectating)"]

func _update_weapon(player: Character) -> void:
	var weapon := player.inventory.active_weapon()
	if weapon != null:
		ammo_label.text = "-" if weapon.has_infinite_ammo() else "%d / %d" % [weapon.ammo_in_mag, weapon.reserve_ammo]
		ammo_label.modulate = Color("ff4d4d") if weapon.is_empty() else Color.WHITE
		weapon_name.text = "%s%s" % [weapon.display_name(), " - RELOADING" if weapon.reloading else ""]
	else:
		ammo_label.text = "-"
		weapon_name.text = "unarmed"
	money_label.text = "$%d" % player.money

	var parts: Array[String] = []
	for slot in InventoryComponent.SLOT_ORDER:
		var carried := player.inventory.weapon_in(slot)
		if carried == null:
			continue
		parts.append("[%s]" % carried.display_name() if player.inventory.active_slot == slot else carried.display_name())
	if player.inventory.total_grenades() > 0:
		parts.append("%d nade" % player.inventory.total_grenades())
	if player.inventory.has_defuse_kit:
		parts.append("KIT")
	if player.inventory.has_bomb:
		parts.append("BOMB")
	slots_label.text = " | ".join(parts)

	var scoped: bool = weapon != null and weapon.data.ads_zoom >= 2.0 and player.intent.aim
	crosshair.visible = player.health.alive and not scoped

func _update_abilities(player: Character) -> void:
	var described := player.abilities.describe()
	while abilities_row.get_child_count() < described.size():
		abilities_row.add_child(_make_ability_chip())
	while abilities_row.get_child_count() > described.size():
		abilities_row.get_child(abilities_row.get_child_count() - 1).queue_free()
		await get_tree().process_frame

	var keys := ["Q", "F", "C", "X"]
	for index in described.size():
		var chip := abilities_row.get_child(index)
		if chip.get_child_count() == 0:
			continue
		var column := chip.get_child(0)
		if column.get_child_count() < 3:
			continue
		var ability: Dictionary = described[index]
		column.get_child(0).text = keys[index] if index < keys.size() else str(index + 1)
		column.get_child(1).text = ability["name"]
		column.get_child(2).text = "READY" if ability["ready"] else "%.1fs" % ability["cooldown_remaining"]
		chip.modulate = Color.WHITE if ability["ready"] else Color(0.6, 0.6, 0.6)

func _make_ability_chip() -> Control:
	var panel := PanelContainer.new()
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	for i in 3:
		var label := Label.new()
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		label.add_theme_font_size_override("font_size", 12 if i == 0 else 10)
		column.add_child(label)
	panel.add_child(column)
	panel.custom_minimum_size = Vector2(96, 0)
	return panel

func _update_interaction(player: Character, bomb: BombSystem) -> void:
	var show := false
	var text := ""
	var progress := 0.0

	if bomb.planting == player:
		show = true
		text = "PLANTING"
		progress = bomb.plant_progress
	elif bomb.defusing == player:
		show = true
		text = "DEFUSING (kit)" if player.inventory.has_defuse_kit else "DEFUSING"
		progress = bomb.defuse_progress
	elif bomb.can_plant(player):
		show = true
		text = "Hold [E] to plant"
	elif bomb.can_defuse(player):
		show = true
		text = "Hold [E] to defuse"
	elif bomb.can_pick_up(player):
		show = true
		text = "Hold [E] to pick up the bomb"

	interaction.visible = show
	if show:
		interaction_label.text = text
		interaction_progress.value = progress * 100.0

# ------------------------------------------------------------- transient UI --
func _on_kill_feed(attacker_name: String, attacker_team: int, victim_name: String,
		victim_team: int, source: StringName, headshot: bool) -> void:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.custom_minimum_size = Vector2(340, 0)
	label.text = "[right]%s [color=#9aa6b2]%s%s[/color] %s[/right]" % [
		_team_bbcode(attacker_name, attacker_team), source,
		" [color=#ff4d4d]HS[/color]" if headshot else "",
		_team_bbcode(victim_name, victim_team)]
	kill_feed.add_child(label)
	_kill_feed_entries.append({"node": label, "life": KILL_FEED_LIFETIME})
	while _kill_feed_entries.size() > KILL_FEED_MAX:
		var oldest: Dictionary = _kill_feed_entries.pop_front()
		oldest["node"].queue_free()

func _team_bbcode(text: String, team: int) -> String:
	if team == GameEnums.Team.TEAM_ONE:
		return "[color=#d8763a]%s[/color]" % text
	if team == GameEnums.Team.TEAM_TWO:
		return "[color=#3a86d8]%s[/color]" % text
	return text

func _on_weapon_hit(character, _weapon, _point: Vector3, target, zone, _headshot: bool) -> void:
	if character != Game.local_player() or target == null:
		return
	hit_marker.modulate = Color.WHITE
	hit_marker.text = "X" if zone == GameEnums.HitZone.HEAD else "x"
	_hit_marker_timer = 0.15

func _on_character_died(_victim, attacker, _source: StringName, _headshot: bool) -> void:
	if attacker == Game.local_player():
		hit_marker.modulate = Color("ff4d4d")
		hit_marker.text = "X"
		_hit_marker_timer = 0.4

func _on_character_damaged(target, _attacker, _amount: float, _zone, _source: StringName) -> void:
	if target != Game.local_player():
		return
	damage_flash.modulate = Color(1, 1, 1, 1)
	_damage_timer = 0.25

func _on_round_ended(_round: int, winning_team: int, reason: GameEnums.RoundEndReason, _scores: Dictionary) -> void:
	var team := Game.session.teams.get_team(winning_team)
	var player := Game.local_player()
	var won: bool = player != null and winning_team == player.team_id
	show_banner("%s win the round" % (team.name if team != null else "Nobody"),
		GameEnums.round_end_text(reason), Color("4cd07a") if won else Color("ff4d4d"), 3.5)

func _on_phase_changed(phase: GameEnums.RoundPhase, _previous, _round: int) -> void:
	if phase == GameEnums.RoundPhase.LIVE:
		show_banner("GO!", "", Color.WHITE, 1.1)
	elif phase == GameEnums.RoundPhase.BUY:
		hide_banner()

func show_banner(title: String, reason: String, color: Color, seconds: float) -> void:
	banner.visible = true
	banner_title.text = title
	banner_title.modulate = color
	banner_reason.text = reason
	_banner_timer = seconds

func hide_banner() -> void:
	banner.visible = false
	_banner_timer = 0.0

func _tick_timers(delta: float) -> void:
	if _banner_timer > 0.0:
		_banner_timer -= delta
		if _banner_timer <= 0.0:
			hide_banner()
	if _hit_marker_timer > 0.0:
		_hit_marker_timer -= delta
		if _hit_marker_timer <= 0.0:
			hit_marker.modulate = Color(1, 1, 1, 0)
	if _damage_timer > 0.0:
		_damage_timer -= delta
		damage_flash.modulate = Color(1, 1, 1, maxf(0.0, _damage_timer / 0.25))
	for index in range(_kill_feed_entries.size() - 1, -1, -1):
		var entry := _kill_feed_entries[index]
		entry["life"] -= delta
		if entry["life"] <= 0.0:
			entry["node"].queue_free()
			_kill_feed_entries.remove_at(index)

func _phase_label(phase: GameEnums.RoundPhase) -> String:
	match phase:
		GameEnums.RoundPhase.BUY: return "buy phase"
		GameEnums.RoundPhase.LIVE: return "live"
		GameEnums.RoundPhase.ROUND_END: return "round over"
		GameEnums.RoundPhase.MATCH_END: return "match over"
	return "warmup"

func _debug_text(session: MatchSession) -> String:
	var player := Game.local_player()
	var lines := PackedStringArray()
	lines.append("fps %d   phase %s   round %d   bomb %s" % [
		Engine.get_frames_per_second(), _phase_label(session.round_manager.phase),
		session.match_manager.round_number, GameEnums.BombState.keys()[session.bomb.state]])
	if player != null:
		var area := session.map_definition.area_at(player.global_position)
		lines.append("pos %.0f, %.0f, %.0f - %s" % [
			player.global_position.x, player.global_position.y, player.global_position.z,
			area.label if area != null else "nowhere"])
	for brain in session.bots.slice(0, 5):
		lines.append("%s: %s" % [brain.character.character_name, BotBrain.Goal.keys()[brain.goal]])
	return "\n".join(lines)
