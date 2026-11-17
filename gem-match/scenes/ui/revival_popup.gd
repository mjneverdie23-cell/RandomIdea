class_name RevivalPopup
extends Control
## "Out of moves" revival offer, in two stages.
##
## Offer stage: [Watch ad], [Buy revival] and [No thanks]. A successful ad or purchase closes
## the popup and emits revival_accepted.
## Lockout stage (after [No thanks]): the offer buttons go away, a bar fills over
## lockout_seconds and [Exit] stays disabled until it is full. [Exit] then closes the popup
## and emits player_exited.
##
## The popup owns the pause: open() pauses the tree and closing unpauses it. The popup itself
## always processes, so its buttons and tweens keep working while the game is frozen.

## The player paid (ad or purchase). The tree is already unpaused when this is emitted.
signal revival_accepted
## The player declined and waited out the lockout. The tree is already unpaused.
signal player_exited

enum Pending { NONE, AD, PURCHASE }

## How long [Exit] stays disabled after [No thanks]. Tests shorten it.
@export var lockout_seconds: float = 15.0

var _pending: Pending = Pending.NONE
var _lockout_tween: Tween

@onready var _message: Label = $Center/Panel/Margin/Box/Message
@onready var _offer: Control = $Center/Panel/Margin/Box/Offer
@onready var _watch_ad_button: Button = $Center/Panel/Margin/Box/Offer/WatchAdButton
@onready var _buy_button: Button = $Center/Panel/Margin/Box/Offer/BuyButton
@onready var _status_label: Label = $Center/Panel/Margin/Box/Offer/StatusLabel
@onready var _decline_button: Button = $Center/Panel/Margin/Box/Offer/DeclineButton
@onready var _lockout: Control = $Center/Panel/Margin/Box/Lockout
@onready var _wait_label: Label = $Center/Panel/Margin/Box/Lockout/WaitLabel
@onready var _cooldown_bar: ProgressBar = $Center/Panel/Margin/Box/Lockout/CooldownBar
@onready var _exit_button: Button = $Center/Panel/Margin/Box/Lockout/ExitButton


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_watch_ad_button.pressed.connect(_on_watch_ad_pressed)
	_buy_button.pressed.connect(_on_buy_pressed)
	_decline_button.pressed.connect(_on_decline_pressed)
	_exit_button.pressed.connect(_on_exit_pressed)
	AdManager.ad_rewarded.connect(_on_ad_rewarded)
	IAPManager.purchase_completed.connect(_on_purchase_completed)
	hide()


## Shows the offer stage and pauses the game. `extra_moves` is only used for the wording.
func open(extra_moves: int) -> void:
	_message.text = "Keep playing with %d extra moves?" % extra_moves
	var price := IAPManager.get_revival_price_text()
	_buy_button.text = "Buy revival (%s)" % price if not price.is_empty() else "Buy revival"
	_show_offer_stage()
	show()
	get_tree().paused = true
	modulate.a = 0.0
	create_tween().tween_property(self, "modulate:a", 1.0, 0.2)
	_watch_ad_button.grab_focus.call_deferred()


# --- Offer stage --------------------------------------------------------------------------


func _show_offer_stage() -> void:
	_pending = Pending.NONE
	_offer.show()
	_lockout.hide()
	_status_label.hide()
	_set_offer_buttons_enabled(true)


func _on_watch_ad_pressed() -> void:
	_wait_for(Pending.AD, "Loading ad...")
	AdManager.request_rewarded_ad()


func _on_buy_pressed() -> void:
	_wait_for(Pending.PURCHASE, "Contacting the store...")
	IAPManager.purchase_revival()


## Locks the offer buttons while an ad or purchase is in progress, so it cannot be started
## twice or abandoned half way.
func _wait_for(kind: Pending, message: String) -> void:
	_pending = kind
	_set_offer_buttons_enabled(false)
	_status_label.text = message
	_status_label.show()


func _on_ad_rewarded(success: bool) -> void:
	if _pending == Pending.AD:
		_finish_offer(success, "The ad didn't finish, so there's no reward. Try again?")


func _on_purchase_completed(success: bool) -> void:
	if _pending == Pending.PURCHASE:
		_finish_offer(success, "The purchase didn't go through. You were not charged.")


func _finish_offer(success: bool, failure_message: String) -> void:
	_pending = Pending.NONE
	if success:
		_close()
		revival_accepted.emit()
		return
	_set_offer_buttons_enabled(true)
	_status_label.text = failure_message


func _set_offer_buttons_enabled(enabled: bool) -> void:
	_watch_ad_button.disabled = not enabled
	_buy_button.disabled = not enabled
	_decline_button.disabled = not enabled


# --- Lockout stage ------------------------------------------------------------------------


func _on_decline_pressed() -> void:
	_offer.hide()
	_lockout.show()
	_wait_label.text = "Please wait..."
	_exit_button.disabled = true
	_cooldown_bar.max_value = 100.0
	_cooldown_bar.value = 0.0
	if _lockout_tween:
		_lockout_tween.kill()
	# Linear, and on real time, so the bar fills at a steady rate in exactly lockout_seconds
	# even if Engine.time_scale is changed.
	_lockout_tween = create_tween().set_ignore_time_scale()
	_lockout_tween.tween_property(_cooldown_bar, "value", 100.0, lockout_seconds)
	_lockout_tween.finished.connect(_on_lockout_finished)


func _on_lockout_finished() -> void:
	_exit_button.disabled = false
	_wait_label.text = "You can leave now."
	_exit_button.grab_focus()


func _on_exit_pressed() -> void:
	if _exit_button.disabled:
		return  # Disabled buttons do not emit pressed; this is just a second lock.
	_close()
	player_exited.emit()


func _close() -> void:
	if _lockout_tween:
		_lockout_tween.kill()
	hide()
	get_tree().paused = false
