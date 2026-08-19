class_name NetworkDebugOverlay
extends CanvasLayer

## Development-only networking readout, toggled with F11.
##
## It only reads: role, peer id, connection state, latency, roster, ownership
## and snapshot counters. Nothing here influences the match, and the node is
## skipped entirely in a release build.

const REFRESH_INTERVAL := 0.25

var session: MatchSession
var state_sync: NetworkStateSync
var relay: CommandRelay
var director: GameDirector

var _label: RichTextLabel
var _timer: float = 0.0


func _ready() -> void:
	visible = false
	_label = RichTextLabel.new()
	_label.bbcode_enabled = true
	_label.fit_content = true
	_label.scroll_active = false
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_label.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_label.offset_left = 16
	_label.offset_top = -330
	_label.offset_bottom = -16
	_label.custom_minimum_size = Vector2(420, 0)
	add_child(_label)


func setup(match_session: MatchSession, sync: NetworkStateSync, command_relay: CommandRelay,
		game_director: GameDirector) -> void:
	session = match_session
	state_sync = sync
	relay = command_relay
	director = game_director


func toggle() -> bool:
	visible = not visible
	return visible


func _process(delta: float) -> void:
	if not visible:
		return
	_timer -= delta
	if _timer > 0.0:
		return
	_timer = REFRESH_INTERVAL
	_label.text = _report()


func _report() -> String:
	var net := Net.describe()
	var lines := PackedStringArray()
	lines.append("[b]NETWORK[/b]")
	lines.append("role      [color=#ffd36b]%s[/color]" % net["role"])
	lines.append("peer id   %s" % net["peer_id"])
	lines.append("state     %s  (%s)" % [net["state"], Net.status_message])
	lines.append("transport %s" % net["transport"])
	lines.append("peers     %d connected" % net["peers"])
	lines.append("latency   %d ms" % net["latency_ms"])
	if session != null:
		lines.append("phase     %s   players %d/%d" % [
			session.phase_name(), session.player_count(), session.required_players
		])
		for entry in session.roster():
			var mine := " [color=#7fe08a](you)[/color]" if int(entry["peer_id"]) == Net.local_peer_id() else ""
			lines.append("  peer %-6s team %s%s" % [
				entry["peer_id"], MapEnums.team_name(int(entry["team"])), mine
			])
	if state_sync != null:
		var sync := state_sync.describe()
		lines.append("snapshots %d sent / %d received @ %d Hz  (%d units)" % [
			sync["sent"], sync["received"], int(sync["tick_rate"]), sync["units"]
		])
	if relay != null:
		lines.append("rejected  %d client requests" % relay.rejected_count())
	if director != null and director.player != null:
		lines.append("local champion owned by peer %d" % director.player.owner_peer_id)
	return "\n".join(lines)
