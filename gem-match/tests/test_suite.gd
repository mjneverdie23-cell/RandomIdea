class_name TestSuite
extends Node
## Base class for test suites run by test_runner.gd. Methods named test_* are run in order;
## they may use `await`.

var failures: Array[String] = []


func check(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)


func check_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual != expected:
		failures.append("%s (expected %s, got %s)" % [message, str(expected), str(actual)])


## Waits until `condition` returns true, checking once per frame. Gives up after
## `max_seconds` of real time (headless runs have no frame cap, so frames are not a clock).
func wait_until(condition: Callable, max_seconds: float = 20.0) -> bool:
	var deadline := Time.get_ticks_msec() + int(max_seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await get_tree().process_frame
	return condition.call()


## Builds colors[x][y] from rows of text: "." is NO_COLOR, digits are colour ids.
static func grid_from_text(rows_text: Array[String]) -> Array:
	var colors: Array = []
	for x in rows_text[0].length():
		var column := PackedInt32Array()
		for row in rows_text:
			var ch := row[x]
			column.append(MatchFinder.NO_COLOR if ch == "." else ch.to_int())
		colors.append(column)
	return colors
