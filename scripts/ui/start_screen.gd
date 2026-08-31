## Title card: controls, class picker entry point, and the click that captures
## the mouse and starts the match.
class_name StartScreen
extends OverlayPanel

signal play_pressed()
signal class_pressed()

func build() -> void:
	title_label.text = "RAPTOR STRIKE"
	subtitle_label.text = "Tactical dinosaur shooter - prototype build. Plant the bomb, or stop it."

	var controls := Label.new()
	controls.add_theme_font_size_override("font_size", 13)
	controls.text = """
WASD          move                       LMB / RMB     fire / aim
Space         jump                       R             reload
Ctrl          crouch                     E (hold)      plant, defuse, pick up bomb
Shift         sprint                     1 / 2 / 3     primary / secondary / melee
Q / F         abilities                  V             throw grenade
B             buy menu                   Tab           scoreboard
P             overhead debug camera      Esc           release the mouse
"""
	content.add_child(controls)
	add_button("Click to play", func(): play_pressed.emit(), true)
	add_button("Choose class", func(): class_pressed.emit())
	visible = true
