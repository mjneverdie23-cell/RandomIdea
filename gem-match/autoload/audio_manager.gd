extends Node
## Autoload "AudioManager": music on the Music bus and sound effects on the SFX bus.
## Every sound is synthesised once at startup, so the game needs no audio files. To use
## real audio later, replace an entry in _sounds (or the music stream) with a loaded file.
## Bus mute follows the GameState sound settings. Every Button in the game clicks.

enum Wave { SINE, TRIANGLE, SQUARE, NOISE }

const MUSIC_BUS := &"Music"
const SFX_BUS := &"SFX"
const MIX_RATE := 22050
## Music is soft and low-pitched, so a lower rate halves the work of generating it.
const MUSIC_MIX_RATE := 16000
const SFX_VOICES := 8

var _sounds: Dictionary = {}  # StringName -> AudioStream
var _voices: Array[AudioStreamPlayer] = []
var _next_voice: int = 0
var _music: AudioStreamPlayer


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_ensure_bus(MUSIC_BUS)
	_ensure_bus(SFX_BUS)
	_build_sounds()
	for _i in SFX_VOICES:
		var voice := AudioStreamPlayer.new()
		voice.bus = SFX_BUS
		add_child(voice)
		_voices.append(voice)
	_music = AudioStreamPlayer.new()
	_music.bus = MUSIC_BUS
	add_child(_music)
	_start_music.call_deferred()
	GameState.settings_changed.connect(_apply_settings)
	_apply_settings()
	get_tree().node_added.connect(_on_node_added)


## Plays a sound effect by name. `pitch` above 1 plays it higher and shorter.
func play(sound: StringName, pitch: float = 1.0) -> void:
	if not _sounds.has(sound):
		push_warning("AudioManager: no sound named %s." % sound)
		return
	var voice := _voices[_next_voice]
	_next_voice = (_next_voice + 1) % _voices.size()
	voice.stream = _sounds[sound]
	voice.pitch_scale = pitch
	voice.play()


func _start_music() -> void:
	_music.stream = _build_music()
	_music.play()


func _apply_settings() -> void:
	AudioServer.set_bus_mute(AudioServer.get_bus_index(MUSIC_BUS), not GameState.music_enabled)
	AudioServer.set_bus_mute(AudioServer.get_bus_index(SFX_BUS), not GameState.sfx_enabled)


func _on_node_added(node: Node) -> void:
	if node is BaseButton:
		(node as BaseButton).pressed.connect(play.bind(&"click"))


## The buses normally come from default_bus_layout.tres; create them if that is missing.
static func _ensure_bus(bus_name: StringName) -> void:
	if AudioServer.get_bus_index(bus_name) != -1:
		return
	AudioServer.add_bus()
	var index := AudioServer.bus_count - 1
	AudioServer.set_bus_name(index, bus_name)
	AudioServer.set_bus_send(index, &"Master")


# --- Synthesis ----------------------------------------------------------------------------


func _build_sounds() -> void:
	_sounds[&"click"] = _render(0.05, [[0.0, 0.05, 1200.0, 900.0, 0.35, Wave.SQUARE, 60.0]])
	_sounds[&"swap"] = _render(0.14, [[0.0, 0.14, 420.0, 760.0, 0.45, Wave.TRIANGLE, 14.0]])
	_sounds[&"invalid"] = _render(
		0.26,
		[
			[0.0, 0.1, 190.0, 170.0, 0.35, Wave.SQUARE, 18.0],
			[0.13, 0.12, 170.0, 150.0, 0.35, Wave.SQUARE, 18.0],
		]
	)
	_sounds[&"match"] = _render(
		0.32,
		[
			[0.0, 0.32, 660.0, 660.0, 0.4, Wave.SINE, 9.0],
			[0.04, 0.28, 990.0, 990.0, 0.3, Wave.SINE, 10.0],
		]
	)
	_sounds[&"create"] = _render(0.3, [[0.0, 0.3, 500.0, 1500.0, 0.35, Wave.TRIANGLE, 7.0]])
	_sounds[&"special"] = _render(
		0.45,
		[
			[0.0, 0.45, 0.0, 0.0, 0.45, Wave.NOISE, 8.0],
			[0.0, 0.4, 320.0, 70.0, 0.5, Wave.SINE, 5.0],
		]
	)
	_sounds[&"shuffle"] = _render(0.4, _arpeggio([392.0, 494.0, 587.0, 784.0], 0.08, 0.3))
	_sounds[&"win"] = _render(1.1, _arpeggio([523.3, 659.3, 784.0, 1046.5], 0.14, 0.4))
	_sounds[&"lose"] = _render(1.0, _arpeggio([392.0, 329.6, 261.6, 196.0], 0.2, 0.4))


## Four bars (C, Am, F, G) of a soft arpeggio over a bass note, as a seamless loop.
func _build_music() -> AudioStream:
	var chords := [
		[261.6, 329.6, 392.0],
		[220.0, 261.6, 329.6],
		[174.6, 220.0, 261.6],
		[196.0, 246.9, 293.7],
	]
	var pattern := [0, 1, 2, 3, 2, 1, 0, 1]  # chord tone per eighth note; 3 = root an octave up
	var eighth := 0.25
	var notes: Array = []
	for bar in chords.size():
		var chord: Array = chords[bar]
		var bar_start: float = bar * eighth * pattern.size()
		notes.append([bar_start, 1.9, chord[0] / 2.0, chord[0] / 2.0, 0.22, Wave.SINE, 1.5])
		for step in pattern.size():
			var tone: int = pattern[step]
			var freq: float = chord[0] * 2.0 if tone == 3 else chord[tone]
			notes.append([bar_start + step * eighth, 0.4, freq, freq, 0.14, Wave.TRIANGLE, 6.0])
	var length := eighth * pattern.size() * chords.size()
	var stream := _render(length, notes, MUSIC_MIX_RATE)
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_begin = 0
	stream.loop_end = int(length * MUSIC_MIX_RATE)
	return stream


## Notes one after another, each `step` seconds apart.
static func _arpeggio(freqs: Array, step: float, length: float) -> Array:
	var notes: Array = []
	for i in freqs.size():
		notes.append([i * step, length, freqs[i], freqs[i], 0.35, Wave.TRIANGLE, 6.0])
	return notes


## Mixes notes into a 16-bit mono stream. Each note is
## [start, length, start_freq, end_freq, volume, Wave, decay] (times in seconds).
func _render(duration: float, notes: Array, rate: int = MIX_RATE) -> AudioStreamWAV:
	var samples := PackedFloat32Array()
	samples.resize(int(duration * rate))
	for note: Array in notes:
		_add_note(samples, note, rate)
	var data := PackedByteArray()
	data.resize(samples.size() * 2)
	for i in samples.size():
		data.encode_s16(i * 2, int(clampf(samples[i], -1.0, 1.0) * 32767.0))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = rate
	stream.stereo = false
	stream.data = data
	return stream


func _add_note(samples: PackedFloat32Array, note: Array, rate: int) -> void:
	var first := int(note[0] * rate)
	var count := int(note[1] * rate)
	var wave: Wave = note[5]
	var phase := 0.0
	for i in count:
		var index := first + i
		if index >= samples.size():
			break
		var t := float(i) / rate
		var freq: float = lerpf(note[2], note[3], float(i) / count)
		phase = fmod(phase + freq / rate, 1.0)
		var value: float
		match wave:
			Wave.SINE:
				value = sin(phase * TAU)
			Wave.TRIANGLE:
				value = 4.0 * absf(phase - 0.5) - 1.0
			Wave.SQUARE:
				value = 1.0 if phase < 0.5 else -1.0
			_:
				value = randf_range(-1.0, 1.0)
		# 5 ms attack so notes do not click, then exponential decay.
		var envelope := minf(t / 0.005, 1.0) * exp(-note[6] * t)
		samples[index] += value * envelope * note[4]
