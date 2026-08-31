## Composition root of one match.
##
## Builds the world, creates the roster, owns the systems and drives the tick
## order. It contains as little logic as possible: if something can live in a
## system, it lives there.
##
## The whole class is renderer-agnostic in the sense that matters - it never
## reads input and never draws. `tools/headless_match.tscn` runs it with no
## camera, no HUD and no player at all.
class_name MatchSession
extends Node3D

const CHARACTER_SCENE := preload("res://scenes/character.tscn")
const BOT_NAMES := [
	"Spike", "Fang", "Ridge", "Thorn", "Bolt", "Crag", "Dash", "Ember",
	"Gale", "Husk", "Iggy", "Jaws", "Kite", "Lash", "Moss", "Nyx",
]

# --- world -------------------------------------------------------------------
var map_definition: MapDefinition
var compiled_map: CompiledMap
var map_builder: MapBuilder

# --- systems -----------------------------------------------------------------
var rng := RandomNumberGenerator.new()
var world: WorldQuery
var teams: TeamManager
var match_manager: MatchManager
var combat: CombatSystem
var economy: EconomySystem
var shop: ShopSystem
var spawn: SpawnSystem
var bomb: BombSystem
var round_manager: RoundManager

# --- roster ------------------------------------------------------------------
var characters: Array = []
var bots: Array = []          ## BotBrain instances
var local_player: Character  ## null in headless/bot-only sessions
var elapsed: float = 0.0
var _started: bool = false

## Options: map_id, seed, with_local_player, player_name, player_class, team_size,
## fill_bots, bot_difficulty.
func configure(options: Dictionary = {}) -> void:
	var config := Config.game
	rng.seed = int(options.get("seed", config.seed))

	map_definition = Config.get_map(options.get("map_id", &"dust_proto"))
	map_builder = MapBuilder.new()
	map_builder.name = "Map"
	add_child(map_builder)
	compiled_map = map_builder.build(map_definition)

	world = WorldQuery.new(self)
	teams = TeamManager.new()
	match_manager = MatchManager.new(teams)
	combat = CombatSystem.new(self, world, rng)
	economy = EconomySystem.new(teams)
	spawn = SpawnSystem.new(self, teams, rng)
	bomb = BombSystem.new(self, teams, combat, rng)
	shop = ShopSystem.new(self, teams, economy)
	round_manager = RoundManager.new(self, teams, match_manager, economy, bomb, spawn, combat)
	bomb.marker = _create_bomb_marker()

	var team_size: int = options.get("team_size", config.team_size)
	if options.get("with_local_player", true):
		local_player = add_player(
			options.get("player_name", "You"),
			options.get("player_class", Config.default_class_id()),
			GameEnums.Team.TEAM_ONE)
	if options.get("fill_bots", Config.bots.enabled and Config.bots.fill_teams):
		fill_with_bots(team_size, options.get("bot_difficulty", Config.bots.default_difficulty))

func _exit_tree() -> void:
	# Systems hold signal connections on the global Events bus.
	if economy != null:
		economy.dispose()
	if bomb != null:
		bomb.dispose()
	if round_manager != null:
		round_manager.dispose()

# ------------------------------------------------------------------- roster --
func add_player(character_name: String, class_id: StringName, team_id: int) -> Character:
	return _create_character(character_name, class_id, team_id, false, &"")

func add_bot(character_name: String, class_id: StringName, team_id: int, difficulty: StringName = &"") -> Character:
	var character := _create_character(character_name, class_id, team_id, true, difficulty)
	var brain := BotBrain.new(character, self, difficulty if difficulty != &"" else Config.bots.default_difficulty)
	bots.append(brain)
	return character

func _create_character(character_name: String, class_id: StringName, team_id: int,
		is_bot: bool, _difficulty: StringName) -> Character:
	var character: Character = CHARACTER_SCENE.instantiate()
	add_child(character)
	character.setup(character_name, team_id, class_id, is_bot)
	characters.append(character)
	teams.add_member(character, team_id)
	character.survived_last_round = false
	# Fall damage flows through the normal damage pipeline for consistent events.
	character.damage_sink = func(target, amount: float) -> void:
		combat.apply_damage(target, null, amount, &"fall")
	return character

## Tops both teams up with bots of assorted classes.
func fill_with_bots(team_size: int, difficulty: StringName) -> void:
	var name_index := 0
	for team_id in [GameEnums.Team.TEAM_ONE, GameEnums.Team.TEAM_TWO]:
		var current := teams.members_of(team_id).size()
		for i in range(current, team_size):
			var class_id: StringName = Config.class_ids[(name_index + i) % Config.class_ids.size()]
			var suffix := "" if team_id == GameEnums.Team.TEAM_ONE else ".2"
			add_bot("%s%s" % [BOT_NAMES[name_index % BOT_NAMES.size()], suffix], class_id, team_id, difficulty)
			name_index += 1

## Swaps the local player's dinosaur class (buy phase or warmup only).
func set_local_player_class(class_id: StringName) -> bool:
	if local_player == null:
		return false
	if round_manager.phase != GameEnums.RoundPhase.BUY and round_manager.phase != GameEnums.RoundPhase.WARMUP:
		return false
	local_player.apply_class(class_id)
	Events.character_class_changed.emit(local_player, class_id)
	return true

func start() -> void:
	_started = true
	round_manager.start()

## Starts ticking without starting a match. Tests use this together with
## `round_manager.paused = true` to study one mechanic in isolation.
func begin_ticking() -> void:
	_started = true

# --------------------------------------------------------------------- tick --
## Order matters: think -> act -> move -> resolve -> round rules.
func _physics_process(delta: float) -> void:
	if not _started:
		return
	tick(delta)

func tick(delta: float) -> void:
	elapsed += delta

	for brain in bots:
		brain.think(delta)

	var ctx := ability_context()
	var viewer_team: int = local_player.team_id if local_player != null else -1
	for character in characters:
		_apply_intent(character)

	for character in characters:
		character.tick_movement(delta)
		character.effects.update(delta, ctx)
		character.abilities.update(delta, ctx)
		var weapon: Weapon = character.inventory.active_weapon()
		if weapon != null and weapon.update(delta, character.intent.fire):
			Events.weapon_reload_finished.emit(character, weapon)
		character.sync_visual(viewer_team)

	round_manager.update(delta)

func ability_context() -> AbilityContext:
	return AbilityContext.new(null, world, combat, rng, elapsed)

## Translates one character's intent into actions.
func _apply_intent(character) -> void:
	var intent: Intent = character.intent
	if not character.health.alive:
		return

	character.yaw = intent.yaw
	character.pitch = intent.pitch
	if character.frozen:
		intent.fire = false
		intent.jump = false

	if intent.switch_to_slot >= 0:
		var slot := intent.switch_to_slot
		intent.switch_to_slot = -1
		if character.inventory.equip_slot(slot):
			Events.weapon_switched.emit(character, character.inventory.active_weapon())

	if intent.reload:
		combat.start_reload(character)
		intent.reload = false

	if intent.use_ability >= 0:
		var index := intent.use_ability
		intent.use_ability = -1
		var ctx := ability_context()
		ctx.character = character
		character.abilities.activate(index, ctx)

	if intent.throw_grenade:
		intent.throw_grenade = false
		combat.throw_grenade(character)

	if intent.drop:
		intent.drop = false
		if character.inventory.has_bomb:
			bomb.drop(character)

	if intent.fire:
		combat.try_fire(character)

	# Bomb interactions run every tick so progress can be interrupted.
	bomb.handle_use(character, intent.use)

func _create_bomb_marker() -> Node3D:
	var marker := Node3D.new()
	marker.name = "BombMarker"
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.5, 0.3, 0.35)
	mesh.mesh = box
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("ff3b30")
	material.emission_enabled = true
	material.emission = Color("ff3b30")
	material.emission_energy_multiplier = 1.5
	mesh.material_override = material
	marker.add_child(mesh)
	marker.visible = false
	add_child(marker)
	return marker

# ----------------------------------------------------------------- snapshot --
## Read-only view of the whole match, for UI and debugging.
func snapshot() -> Dictionary:
	var described: Array[Dictionary] = []
	for character in characters:
		described.append(character.describe())
	return {
		"elapsed": elapsed,
		"round": round_manager.describe(),
		"match": match_manager.describe(),
		"teams": teams.describe(),
		"bomb": bomb.describe(),
		"local_player": local_player.describe() if local_player != null else {},
		"characters": described,
	}
