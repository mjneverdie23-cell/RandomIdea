## Dinosaur class picker.
##
## Cards are generated from the class resources, so adding a class to
## `data/classes/` makes it selectable here automatically.
class_name ClassSelect
extends OverlayPanel

var _cards: HBoxContainer

func build() -> void:
	title_label.text = "Choose your dinosaur"
	subtitle_label.text = "Class can be changed during any buy phase. Each class has its own shop."
	_cards = HBoxContainer.new()
	_cards.add_theme_constant_override("separation", 10)
	content.add_child(_cards)
	add_button("Confirm", func(): close(), true)

func refresh() -> void:
	for child in _cards.get_children():
		child.queue_free()
	var player := Game.local_player()
	var current: StringName = player.class_id if player != null else &""

	for class_id in Config.class_ids:
		var data: CharacterClassData = Config.classes[class_id]
		var button := Button.new()
		button.custom_minimum_size = Vector2(200, 210)
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.add_theme_font_size_override("font_size", 12)
		var ability_names := PackedStringArray()
		for ability_id in data.abilities:
			var ability := Config.ability(ability_id)
			ability_names.append(ability.display_name if ability != null else String(ability_id))
		button.text = "%s%s\n%s - %s\n\n%s\n\nHealth %d\nSpeed %.1f\nArmour %d/%d\nTakes x%.2f damage\n\n%s" % [
			data.display_name, "  (selected)" if class_id == current else "",
			data.role, data.species, data.description,
			int(data.max_health), data.move_speed, int(data.starting_armor), int(data.max_armor),
			data.damage_taken_multiplier, " - ".join(ability_names)]
		button.pressed.connect(func():
			Game.session.set_local_player_class(class_id)
			refresh())
		_cards.add_child(button)
