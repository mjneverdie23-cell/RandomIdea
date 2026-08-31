## Runs every `test_*.gd` in this folder and reports the results.
##
##   godot --headless --path . res://tests/test_main.tscn
##
## Exit code 0 means everything passed, 1 means at least one check failed - so
## this works as a CI gate as-is.
extends Node

const TEST_DIR := "res://tests"

## Game seconds simulated per wall-clock second. Raising the physics rate and the
## time scale together keeps every tick at 1/64 s while running many per second.
const SPEEDUP := 12

func _ready() -> void:
	Engine.physics_ticks_per_second = 64 * SPEEDUP
	Engine.max_physics_steps_per_frame = 64 * SPEEDUP
	Engine.time_scale = SPEEDUP
	Engine.max_fps = 0

	var files := _discover()
	var total_passed := 0
	var total_failed := 0
	var all_failures: Array[String] = []
	var started := Time.get_ticks_msec()

	print("running %d test files\n" % files.size())
	for path in files:
		var script: GDScript = load(path)
		# A script with a parse error still loads as a GDScript object, so check
		# that it can actually be instantiated before trying.
		if script == null or not script.can_instantiate():
			printerr("FAIL %s could not be compiled" % path)
			all_failures.append("%s: script failed to compile" % path.get_file())
			total_failed += 1
			continue
		var suite: TestCase = script.new()
		add_child(suite)
		var results: Dictionary = await suite.run_all()
		var file_name := path.get_file()
		for entry in results["names"]:
			print("  %s %s" % ["ok  " if entry["ok"] else "FAIL", entry["name"]])
		print("%s: %d passed, %d failed" % [file_name, results["passed"], results["failed"]])
		total_passed += results["passed"]
		total_failed += results["failed"]
		all_failures.append_array(suite.failures)
		suite.queue_free()
		# Systems connect to the global event bus; a stale listener from one test
		# must never observe the next one.
		Events.reset()
		await get_tree().process_frame

	print("\n%d passed, %d failed in %.1fs" % [
		total_passed, total_failed, (Time.get_ticks_msec() - started) / 1000.0])
	if not all_failures.is_empty():
		print("\nfailures:")
		for failure in all_failures:
			print("  - %s" % failure)
	get_tree().quit(0 if total_failed == 0 else 1)

func _discover() -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(TEST_DIR)
	if dir == null:
		printerr("cannot open %s" % TEST_DIR)
		return out
	var names := dir.get_files()
	names.sort()
	for file_name in names:
		var clean := file_name.trim_suffix(".remap")
		if not clean.begins_with("test_") or not clean.ends_with(".gd"):
			continue
		if clean in ["test_runner.gd", "test_case.gd", "test_main.gd"]:
			continue
		out.append("%s/%s" % [TEST_DIR, clean])
	return out
