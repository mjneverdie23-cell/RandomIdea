extends SceneTree
## Headless test runner. From the repository root:
##   godot --headless --path gem-match -s res://tests/test_runner.gd
## Open the project in the editor once first so the class_names are registered.
## Exit code 0 means every test passed.

const SUITES: Array[String] = [
	"res://tests/test_match_finder.gd",
	"res://tests/test_board.gd",
	"res://tests/test_levels.gd",
	"res://tests/test_save.gd",
	"res://tests/test_scenes.gd",
	"res://tests/test_revival.gd",
	"res://tests/test_monetization.gd",
	"res://tests/test_meta.gd",
	"res://tests/test_dda.gd",
]


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var passed := 0
	var failed := 0
	for path in SUITES:
		var suite: TestSuite = load(path).new()
		root.add_child(suite)
		for method in suite.get_method_list():
			var test_name: String = method["name"]
			if not test_name.begins_with("test_"):
				continue
			suite.failures.clear()
			await suite.call(test_name)
			if suite.failures.is_empty():
				passed += 1
				print("  ok    %s.%s" % [path.get_file(), test_name])
			else:
				failed += 1
				print("  FAIL  %s.%s" % [path.get_file(), test_name])
				for failure in suite.failures:
					print("          " + failure)
		suite.queue_free()
		await process_frame
	print("\n%d passed, %d failed" % [passed, failed])
	quit(1 if failed > 0 else 0)
