class_name InputSettings
extends RefCounted

## Player-configurable key bindings, on top of Godot's own input map.
##
## Nothing in gameplay changes: every action here is already an entry in
## `project.godot` that [PCInputController] turns into an [InputCommands]
## request, so rebinding a key rewrites one [InputMap] event and no gameplay
## script learns about it. A touch build, which raises the same commands with
## no keys at all, is unaffected.
##
## Only the *keyboard* event of an action is ever replaced. Mouse bindings —
## left click to attack, the wheel to zoom — are left in place, so rebinding
## "zoom in" to a key does not cost you the wheel.

const SAVE_PATH := "user://input_bindings.cfg"
const SECTION := "bindings"

## What the settings panel lists, in the order it lists it. Anything not here
## is not player-facing: developer cheats stay off the panel on purpose.
const GROUPS: Array[Dictionary] = [
	{"title": "Movement", "actions": ["move_up", "move_left", "move_down", "move_right"]},
	{"title": "Combat", "actions": ["basic_attack", "ability_q", "ability_e", "ability_r",
		"ability_f", "recall"]},
	{"title": "Levelling", "actions": ["upgrade_q", "upgrade_e", "upgrade_r", "upgrade_f"]},
	{"title": "Interface", "actions": ["toggle_shop", "toggle_range", "camera_lock",
		"camera_zoom_in", "camera_zoom_out", "toggle_debug", "open_settings", "restart_match"]},
]

const LABELS := {
	"move_up": "Move up", "move_left": "Move left",
	"move_down": "Move down", "move_right": "Move right",
	"basic_attack": "Basic attack", "recall": "Recall",
	"ability_q": "Ability 1", "ability_e": "Ability 2",
	"ability_r": "Ability 3", "ability_f": "Ability 4",
	"upgrade_q": "Upgrade ability 1", "upgrade_e": "Upgrade ability 2",
	"upgrade_r": "Upgrade ability 3", "upgrade_f": "Upgrade ability 4",
	"toggle_shop": "Open shop", "toggle_range": "Show my attack range",
	"camera_lock": "Camera lock", "camera_zoom_in": "Zoom in",
	"camera_zoom_out": "Zoom out", "toggle_debug": "Map debug view",
	"open_settings": "Settings", "restart_match": "Restart match",
}

## Captured from the project's own input map the first time anything asks, so
## "reset to defaults" means the shipped bindings rather than a second copy of
## them maintained by hand.
static var _defaults: Dictionary = {}


static func actions() -> PackedStringArray:
	var out := PackedStringArray()
	for group in GROUPS:
		for action in group["actions"]:
			out.append(action)
	return out


static func label_for(action: String) -> String:
	return String(LABELS.get(action, action.capitalize()))


## Remembers the shipped bindings. Safe to call repeatedly.
static func capture_defaults() -> void:
	if not _defaults.is_empty():
		return
	for action in actions():
		if InputMap.has_action(action):
			_defaults[action] = InputMap.action_get_events(action).duplicate()


# --- reading -----------------------------------------------------------------

## The keyboard event bound to [param action], or null when it has none.
static func key_event(action: String) -> InputEventKey:
	if not InputMap.has_action(action):
		return null
	for event in InputMap.action_get_events(action):
		if event is InputEventKey:
			return event
	return null


## Human-readable binding, e.g. "Ctrl + Q", or the mouse button when the action
## has no key at all.
static func binding_text(action: String) -> String:
	var key := key_event(action)
	if key != null:
		return describe(key)
	if InputMap.has_action(action):
		for event in InputMap.action_get_events(action):
			if event is InputEventMouseButton:
				return _mouse_name(event.button_index)
	return "unbound"


static func describe(event: InputEventKey) -> String:
	var parts := PackedStringArray()
	if event.ctrl_pressed:
		parts.append("Ctrl")
	if event.shift_pressed:
		parts.append("Shift")
	if event.alt_pressed:
		parts.append("Alt")
	var code := event.physical_keycode if event.physical_keycode != 0 else event.keycode
	parts.append(OS.get_keycode_string(DisplayServer.keyboard_get_keycode_from_physical(code)))
	return " + ".join(parts)


static func _mouse_name(index: int) -> String:
	match index:
		MOUSE_BUTTON_LEFT:
			return "Left click"
		MOUSE_BUTTON_RIGHT:
			return "Right click"
		MOUSE_BUTTON_MIDDLE:
			return "Middle click"
		MOUSE_BUTTON_WHEEL_UP:
			return "Wheel up"
		MOUSE_BUTTON_WHEEL_DOWN:
			return "Wheel down"
	return "Button %d" % index


# --- conflicts ---------------------------------------------------------------

## The action already using this key, or "" when it is free. [param ignoring]
## is the action being rebound, which is allowed to keep its own key.
static func conflict(event: InputEventKey, ignoring: String) -> String:
	for action in actions():
		if action == ignoring:
			continue
		var bound := key_event(action)
		if bound != null and matches(bound, event):
			return action
	return ""


static func matches(a: InputEventKey, b: InputEventKey) -> bool:
	return a.physical_keycode == b.physical_keycode \
		and a.ctrl_pressed == b.ctrl_pressed \
		and a.shift_pressed == b.shift_pressed \
		and a.alt_pressed == b.alt_pressed


# --- writing -----------------------------------------------------------------

## Replaces the action's keyboard event, keeping any mouse binding it had.
static func rebind(action: String, event: InputEventKey) -> void:
	if not InputMap.has_action(action):
		return
	for existing in InputMap.action_get_events(action):
		if existing is InputEventKey:
			InputMap.action_erase_event(action, existing)
	InputMap.action_add_event(action, _clean(event))
	save()


static func reset_all() -> void:
	capture_defaults()
	for action in _defaults:
		InputMap.action_erase_events(action)
		for event in _defaults[action]:
			InputMap.action_add_event(action, event)
	save()


## Strips the noise a live event carries so what is stored is just the chord.
static func _clean(event: InputEventKey) -> InputEventKey:
	var copy := InputEventKey.new()
	copy.physical_keycode = event.physical_keycode if event.physical_keycode != 0 else event.keycode
	copy.ctrl_pressed = event.ctrl_pressed
	copy.shift_pressed = event.shift_pressed
	copy.alt_pressed = event.alt_pressed
	return copy


# --- persistence -------------------------------------------------------------

## Writes only the actions that differ from the shipped bindings, so a later
## change to a default reaches players who never touched that key.
static func save() -> void:
	capture_defaults()
	var file := ConfigFile.new()
	for action in actions():
		var key := key_event(action)
		if key == null:
			continue
		var original := _default_key(action)
		if original != null and matches(original, key):
			continue
		file.set_value(SECTION, action, {
			"keycode": key.physical_keycode,
			"ctrl": key.ctrl_pressed,
			"shift": key.shift_pressed,
			"alt": key.alt_pressed,
		})
	file.save(SAVE_PATH)


## Called once at startup, before anything reads the input map.
static func load_and_apply() -> int:
	capture_defaults()
	var file := ConfigFile.new()
	if file.load(SAVE_PATH) != OK:
		return 0
	var applied := 0
	for action in file.get_section_keys(SECTION) if file.has_section(SECTION) else []:
		if not InputMap.has_action(action):
			continue
		var stored: Dictionary = file.get_value(SECTION, action, {})
		if not stored.has("keycode"):
			continue
		var event := InputEventKey.new()
		event.physical_keycode = int(stored["keycode"])
		event.ctrl_pressed = bool(stored.get("ctrl", false))
		event.shift_pressed = bool(stored.get("shift", false))
		event.alt_pressed = bool(stored.get("alt", false))
		for existing in InputMap.action_get_events(action):
			if existing is InputEventKey:
				InputMap.action_erase_event(action, existing)
		InputMap.action_add_event(action, event)
		applied += 1
	return applied


static func _default_key(action: String) -> InputEventKey:
	for event in _defaults.get(action, []):
		if event is InputEventKey:
			return event
	return null


## Test and tooling helper: forget the saved file entirely.
static func clear_saved() -> void:
	if FileAccess.file_exists(SAVE_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE_PATH))
