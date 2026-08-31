## Audio.
##
## PLACEHOLDER IMPLEMENTATION: no sound files ship with the prototype, so every
## cue is a short synthesised tone described in CUES below. Give a cue a `stream`
## (or point `path` at a real .ogg/.wav) and it plays that instead - no other
## code changes.
##
## Cues are bound to game events in `_ready`, so adding a sound to an existing
## event is a two-line change.
extends Node

const MASTER_VOLUME_DB := -6.0
const MAX_HEARING_DISTANCE := 70.0
const POOL_SIZE := 24

## cue id -> {wave, freq, duration, volume, path}
## `wave`: "sine" | "square" | "saw" | "triangle"
## `path`: optional res:// path to a real audio file; when set it wins.
const CUES := {
	&"weapon.fire.PISTOL":  {"wave": "square", "freq": 320.0, "duration": 0.08, "volume": 0.35},
	&"weapon.fire.SMG":     {"wave": "square", "freq": 380.0, "duration": 0.06, "volume": 0.30},
	&"weapon.fire.RIFLE":   {"wave": "saw", "freq": 240.0, "duration": 0.09, "volume": 0.40},
	&"weapon.fire.SNIPER":  {"wave": "saw", "freq": 160.0, "duration": 0.22, "volume": 0.50},
	&"weapon.fire.SHOTGUN": {"wave": "saw", "freq": 120.0, "duration": 0.18, "volume": 0.50},
	&"weapon.fire.LMG":     {"wave": "saw", "freq": 200.0, "duration": 0.08, "volume": 0.42},
	&"weapon.fire.MELEE":   {"wave": "triangle", "freq": 520.0, "duration": 0.10, "volume": 0.30},
	&"weapon.dryfire":      {"wave": "square", "freq": 90.0, "duration": 0.05, "volume": 0.25},
	&"weapon.reload":       {"wave": "triangle", "freq": 220.0, "duration": 0.14, "volume": 0.30},
	&"weapon.switch":       {"wave": "triangle", "freq": 300.0, "duration": 0.07, "volume": 0.25},
	&"hit.flesh":           {"wave": "sine", "freq": 160.0, "duration": 0.07, "volume": 0.40},
	&"hit.marker":          {"wave": "sine", "freq": 900.0, "duration": 0.05, "volume": 0.35},
	&"hit.headshot":        {"wave": "sine", "freq": 1300.0, "duration": 0.08, "volume": 0.50},
	&"character.death":     {"wave": "saw", "freq": 110.0, "duration": 0.40, "volume": 0.50},
	&"character.hurt":      {"wave": "triangle", "freq": 200.0, "duration": 0.15, "volume": 0.40},
	&"ability.use":         {"wave": "sine", "freq": 660.0, "duration": 0.25, "volume": 0.40},
	&"grenade.explode":     {"wave": "saw", "freq": 70.0, "duration": 0.50, "volume": 0.60},
	&"bomb.plant":          {"wave": "square", "freq": 440.0, "duration": 0.30, "volume": 0.50},
	&"bomb.beep":           {"wave": "sine", "freq": 1000.0, "duration": 0.06, "volume": 0.35},
	&"bomb.defused":        {"wave": "sine", "freq": 520.0, "duration": 0.50, "volume": 0.60},
	&"bomb.explode":        {"wave": "saw", "freq": 55.0, "duration": 1.20, "volume": 0.80},
	&"round.start":         {"wave": "sine", "freq": 700.0, "duration": 0.35, "volume": 0.50},
	&"round.win":           {"wave": "sine", "freq": 880.0, "duration": 0.60, "volume": 0.60},
	&"round.loss":          {"wave": "sine", "freq": 220.0, "duration": 0.60, "volume": 0.60},
	&"match.win":           {"wave": "sine", "freq": 1046.0, "duration": 1.20, "volume": 0.70},
	&"ui.buy":              {"wave": "sine", "freq": 780.0, "duration": 0.10, "volume": 0.40},
	&"ui.error":            {"wave": "square", "freq": 140.0, "duration": 0.12, "volume": 0.40},
}

var enabled: bool = true
var _streams: Dictionary = {}
var _pool: Array[AudioStreamPlayer] = []
var _pool_index: int = 0
var _warned: Dictionary = {}

func _ready() -> void:
	if DisplayServer.get_name() == "headless":
		enabled = false
		return
	for i in POOL_SIZE:
		var player := AudioStreamPlayer.new()
		player.bus = "Master"
		add_child(player)
		_pool.append(player)
	_bind_events()

## Plays a cue. `position` only affects volume (simple distance attenuation);
## swap the pool for AudioStreamPlayer3D nodes for true positional audio.
func play(cue_id: StringName, position = null, volume_scale: float = 1.0) -> void:
	if not enabled:
		return
	var cue: Dictionary = CUES.get(cue_id, {})
	if cue.is_empty():
		if not _warned.has(cue_id):
			_warned[cue_id] = true
			push_warning("AudioManager: no cue registered for '%s'" % cue_id)
		return

	var volume: float = cue.get("volume", 1.0) * volume_scale
	if position != null:
		volume *= _attenuation(position)
	if volume <= 0.01:
		return

	var player := _pool[_pool_index]
	_pool_index = (_pool_index + 1) % _pool.size()
	player.stream = _stream_for(cue_id, cue)
	player.volume_db = MASTER_VOLUME_DB + linear_to_db(clampf(volume, 0.01, 1.0))
	player.play()

func _attenuation(position: Vector3) -> float:
	var listener = Game.local_player()
	if listener == null:
		return 1.0
	var distance: float = listener.global_position.distance_to(position)
	if distance <= 6.0:
		return 1.0
	if distance >= MAX_HEARING_DISTANCE:
		return 0.0
	return 1.0 - (distance - 6.0) / (MAX_HEARING_DISTANCE - 6.0)

func _stream_for(cue_id: StringName, cue: Dictionary) -> AudioStream:
	if _streams.has(cue_id):
		return _streams[cue_id]
	var stream: AudioStream
	if cue.has("path") and ResourceLoader.exists(cue["path"]):
		stream = load(cue["path"])
	else:
		stream = _synthesise(cue)
	_streams[cue_id] = stream
	return stream

## PLACEHOLDER tone generator: one oscillator with a linear decay envelope.
func _synthesise(cue: Dictionary) -> AudioStreamWAV:
	var rate := 22050
	var duration: float = cue.get("duration", 0.1)
	var frequency: float = cue.get("freq", 440.0)
	var wave: String = cue.get("wave", "sine")
	var samples := int(rate * duration)
	var data := PackedByteArray()
	data.resize(samples * 2)

	for index in samples:
		var t := float(index) / rate
		var phase := fmod(t * frequency, 1.0)
		var value := 0.0
		match wave:
			"square": value = 1.0 if phase < 0.5 else -1.0
			"saw": value = phase * 2.0 - 1.0
			"triangle": value = 1.0 - absf(phase * 4.0 - 2.0)
			_: value = sin(phase * TAU)
		var envelope := 1.0 - float(index) / samples
		var sample := int(clampf(value * envelope, -1.0, 1.0) * 32767.0)
		data.encode_s16(index * 2, sample)

	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = rate
	stream.stereo = false
	stream.data = data
	return stream

func _bind_events() -> void:
	Events.weapon_fired.connect(func(_c, weapon, origin, _d):
		play(StringName("weapon.fire.%s" % GameEnums.WeaponCategory.keys()[weapon.data.category]), origin))
	Events.weapon_dry_fire.connect(func(c, _w): play(&"weapon.dryfire", c.global_position))
	Events.weapon_reload_started.connect(func(c, _w): play(&"weapon.reload", c.global_position))
	Events.weapon_switched.connect(func(c, _w): play(&"weapon.switch", c.global_position))

	Events.character_damaged.connect(func(target, attacker, _amount, zone, _source):
		play(&"hit.flesh", target.global_position)
		if attacker == Game.local_player():
			play(&"hit.headshot" if zone == GameEnums.HitZone.HEAD else &"hit.marker")
		if target == Game.local_player():
			play(&"character.hurt"))
	Events.character_died.connect(func(victim, _a, _s, _h): play(&"character.death", victim.global_position))

	Events.ability_used.connect(func(c, _id): play(&"ability.use", c.global_position))
	Events.grenade_exploded.connect(func(position): play(&"grenade.explode", position))

	Events.bomb_planted.connect(func(_c, _site, position): play(&"bomb.plant", position))
	Events.bomb_beep.connect(func(_fuse, position): play(&"bomb.beep", position))
	Events.bomb_defused.connect(func(_c): play(&"bomb.defused"))
	Events.bomb_exploded.connect(func(position): play(&"bomb.explode", position))

	Events.round_phase_changed.connect(func(phase, _previous, _round):
		if phase == GameEnums.RoundPhase.LIVE:
			play(&"round.start"))
	Events.round_ended.connect(func(_round, winner, _reason, _scores):
		var player = Game.local_player()
		if player != null:
			play(&"round.win" if winner == player.team_id else &"round.loss"))
	Events.match_ended.connect(func(_team, _reason, _scores): play(&"match.win"))
	Events.item_purchased.connect(func(_c, _item, _price): play(&"ui.buy"))
	Events.purchase_rejected.connect(func(_c, _item, _result): play(&"ui.error"))
