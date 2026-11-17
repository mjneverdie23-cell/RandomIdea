extends Node
## Autoload "IAPManager": in-app purchases behind one small API, so the game never talks to
## a store SDK directly. Call purchase_revival() and wait for purchase_completed(success).
##
## With USE_MOCK_DATA on, no store is needed: every purchase waits MOCK_DELAY_SECONDS and then
## reports mock_success. Use this on desktop. For a real build, set USE_MOCK_DATA to false
## and wire your billing plugin into _start_real_purchase() (see the steps there).
##
## This node always processes, so purchases still work while the game is paused.

## Emitted once per purchase attempt. true means the store confirmed the payment.
signal purchase_completed(success: bool)

const USE_MOCK_DATA := true
const MOCK_DELAY_SECONDS := 2.0
## Store product id of the revival. Create it as a consumable product in each store.
const REVIVAL_PRODUCT_ID := "revival_plus_5_moves"
## Shown on the buy button while there is no real store price to show.
const MOCK_PRICE_TEXT := "$0.99"

## Result of each mock purchase. Set it to false (e.g. from a test) to try the failure path.
var mock_success: bool = true

var _busy: bool = false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


## True while a purchase is in progress. A second purchase during that time is ignored.
func is_busy() -> bool:
	return _busy


## The localised price to show on the buy button.
func get_revival_price_text() -> String:
	if USE_MOCK_DATA:
		return MOCK_PRICE_TEXT
	# Real store: return the price string the billing plugin reports for REVIVAL_PRODUCT_ID.
	return ""


## Starts buying one revival. The answer always arrives later, through purchase_completed.
func purchase_revival() -> void:
	if _busy:
		push_warning("IAPManager: a purchase is already in progress; request ignored.")
		return
	_busy = true
	if USE_MOCK_DATA:
		# SceneTreeTimers run while the tree is paused by default (process_always = true).
		await get_tree().create_timer(MOCK_DELAY_SECONDS).timeout
		_finish(mock_success)
	else:
		_start_real_purchase()


## Real SDK hook. To use a billing plugin (Google Play Billing, StoreKit, ...):
## 1. Connect to the store once in _ready() and query REVIVAL_PRODUCT_ID (for its price).
## 2. Here, start the purchase flow for REVIVAL_PRODUCT_ID.
## 3. When the store confirms the purchase, consume it (it is a consumable), then call
##    _finish(true).
## 4. On cancel or error, call _finish(false).
func _start_real_purchase() -> void:
	push_warning("IAPManager: no store SDK is wired in; set USE_MOCK_DATA or add a plugin.")
	_finish(false)


## Always reports on the next frame, so callers can rely on the answer arriving after
## purchase_revival() returns, even when it fails straight away.
func _finish(success: bool) -> void:
	_busy = false
	purchase_completed.emit.call_deferred(success)
