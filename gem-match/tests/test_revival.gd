extends TestSuite
## Revival popup: pause handling, the ad / purchase paths and the [No thanks] lockout.
## Needs the AdManager and IAPManager autoloads; skipped if the runner started without them.

const POPUP_SCENE := preload("res://scenes/ui/revival_popup.tscn")


func test_decline_locks_exit_until_the_bar_is_full() -> void:
	if not _has_managers():
		return
	var popup := _new_popup()
	popup.lockout_seconds = 0.6
	var exited := [false]
	popup.player_exited.connect(func() -> void: exited[0] = true)
	popup.open(5)
	check(get_tree().paused, "opening the popup pauses the game")
	check(popup._offer.visible and not popup._lockout.visible, "starts on the offer")

	popup._decline_button.pressed.emit()
	check(not popup._offer.visible, "the ad and buy buttons are gone")
	check(popup._lockout.visible, "the lockout is shown")
	check(popup._exit_button.disabled, "exit starts disabled")
	check_eq(popup._cooldown_bar.value, 0.0, "the bar starts empty")
	popup._exit_button.pressed.emit()  # Even a forced press must not get out early.
	check(not exited[0], "exit does nothing during the lockout")

	await get_tree().create_timer(0.3).timeout
	var midway: float = popup._cooldown_bar.value
	check(midway > 0.0 and midway < 100.0, "the bar fills while paused (%s)" % midway)
	check(popup._exit_button.disabled, "exit is still disabled halfway")

	check(
		await wait_until(func() -> bool: return not popup._exit_button.disabled, 3.0),
		"exit enables"
	)
	check_eq(popup._cooldown_bar.value, 100.0, "the bar is full when exit enables")
	popup._exit_button.pressed.emit()
	check(exited[0], "exit emits player_exited")
	check(not popup.visible and not get_tree().paused, "exit closes and unpauses")
	_cleanup(popup)


func test_watching_an_ad_revives() -> void:
	if not _has_managers():
		return
	var popup := _new_popup()
	var accepted := [false]
	popup.revival_accepted.connect(func() -> void: accepted[0] = true)
	popup.open(5)
	popup._watch_ad_button.pressed.emit()
	check(
		popup._watch_ad_button.disabled and popup._decline_button.disabled, "locked while loading"
	)
	check(await wait_until(func() -> bool: return accepted[0], 5.0), "the ad grants the revival")
	check(not popup.visible and not get_tree().paused, "closes and unpauses")
	_cleanup(popup)


func test_buying_revives() -> void:
	if not _has_managers():
		return
	var popup := _new_popup()
	var accepted := [false]
	popup.revival_accepted.connect(func() -> void: accepted[0] = true)
	popup.open(5)
	popup._buy_button.pressed.emit()
	check(await wait_until(func() -> bool: return accepted[0], 5.0), "the purchase grants it")
	check(not get_tree().paused, "unpaused after buying")
	_cleanup(popup)


func test_failed_ad_keeps_the_offer_open() -> void:
	if not _has_managers():
		return
	var ads: Node = get_tree().root.get_node("AdManager")
	ads.mock_success = false
	var popup := _new_popup()
	var accepted := [false]
	popup.revival_accepted.connect(func() -> void: accepted[0] = true)
	popup.open(5)
	popup._watch_ad_button.pressed.emit()
	check(
		await wait_until(func() -> bool: return not popup._watch_ad_button.disabled, 5.0),
		"buttons come back after a failed ad"
	)
	check(not accepted[0], "no revival without a reward")
	check(popup.visible and get_tree().paused, "the offer stays open and paused")
	check(popup._status_label.visible, "the player is told why")
	ads.mock_success = true
	_cleanup(popup)


func _has_managers() -> bool:
	var root := get_tree().root
	if root.has_node("AdManager") and root.has_node("IAPManager"):
		return true
	print("          (skipped: AdManager/IAPManager autoloads not loaded)")
	return false


func _new_popup() -> RevivalPopup:
	var popup: RevivalPopup = POPUP_SCENE.instantiate()
	add_child(popup)
	return popup


func _cleanup(popup: RevivalPopup) -> void:
	get_tree().paused = false
	popup.queue_free()
