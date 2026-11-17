extends Node
## Autoload "AdManager": rewarded video ads behind one small API, so the game never talks to
## an ad SDK directly. Call request_rewarded_ad() and wait for ad_rewarded(success).
##
## With USE_MOCK_DATA on, no SDK is needed: every request waits MOCK_DELAY_SECONDS and then
## reports mock_success. Use this on desktop. For a real build, set USE_MOCK_DATA to false
## and wire your ad plugin into _show_real_ad() (see the steps there).
##
## This node always processes, so ads still work while the game is paused (the revival popup
## pauses the tree before asking for an ad).

## Emitted once per request. true means the player watched to the end and earned the reward.
signal ad_rewarded(success: bool)

const USE_MOCK_DATA := true
const MOCK_DELAY_SECONDS := 2.0

## Result of each mock ad. Set it to false (e.g. from a test) to try the failure path.
var mock_success: bool = true

var _busy: bool = false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


## True while an ad is loading or showing. A second request during that time is ignored.
func is_busy() -> bool:
	return _busy


## Loads and shows a rewarded ad. The answer always arrives later, through ad_rewarded.
func request_rewarded_ad() -> void:
	if _busy:
		push_warning("AdManager: an ad is already in progress; request ignored.")
		return
	_busy = true
	if USE_MOCK_DATA:
		# SceneTreeTimers run while the tree is paused by default (process_always = true).
		await get_tree().create_timer(MOCK_DELAY_SECONDS).timeout
		_finish(mock_success)
	else:
		_show_real_ad()


## Real SDK hook. To use an ad plugin (for example an AdMob plugin):
## 1. Initialise the plugin once in _ready() (when USE_MOCK_DATA is false).
## 2. Here, load and show its rewarded ad.
## 3. From the plugin's "user earned reward" callback, call _finish(true).
## 4. From its "failed to load/show" or "closed without reward" callbacks, call _finish(false).
func _show_real_ad() -> void:
	push_warning("AdManager: no ad SDK is wired in; set USE_MOCK_DATA or add a plugin.")
	_finish(false)


## Always reports on the next frame, so callers can rely on the answer arriving after
## request_rewarded_ad() returns, even when it fails straight away.
func _finish(success: bool) -> void:
	_busy = false
	ad_rewarded.emit.call_deferred(success)
