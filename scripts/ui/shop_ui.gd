## Buy menu.
##
## Renders whatever ShopSystem reports for the local player, including *why* an
## item is unavailable - so adding items or changing restrictions in the data
## needs no change here.
class_name ShopUI
extends OverlayPanel

var _columns: HBoxContainer
var _wallet: Label

func build() -> void:
	title_label.text = "Loadout"
	_columns = HBoxContainer.new()
	_columns.add_theme_constant_override("separation", 18)
	content.add_child(_columns)

	_wallet = Label.new()
	_wallet.add_theme_font_size_override("font_size", 16)
	_wallet.add_theme_color_override("font_color", Color("7fd18a"))
	footer.add_child(_wallet)
	add_button("Close  [B]", func(): close())

func refresh() -> void:
	var player := Game.local_player()
	if player == null:
		return
	subtitle_label.text = "%s (%s) - only gear this class can carry is shown." % [
		player.class_data.display_name, player.class_data.role]
	_wallet.text = "$%d   " % player.money

	for child in _columns.get_children():
		child.queue_free()

	for category in Game.session.shop.list_for(player):
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 4)
		column.custom_minimum_size = Vector2(190, 0)

		var heading := Label.new()
		heading.text = String(category["name"]).to_upper()
		heading.add_theme_font_size_override("font_size", 11)
		heading.add_theme_color_override("font_color", Color("9aa6b2"))
		column.add_child(heading)

		for item in category["items"]:
			column.add_child(_make_item_button(item))
		_columns.add_child(column)

func _make_item_button(item: Dictionary) -> Button:
	var button := Button.new()
	button.custom_minimum_size = Vector2(186, 44)
	button.disabled = not item["available"]
	button.text = "%s   $%d\n%s" % [item["name"], item["price"], item["stats"]]
	button.add_theme_font_size_override("font_size", 12)
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	button.tooltip_text = GameEnums.PURCHASE_RESULT_TEXT.get(item["reason"], "")
	var item_id: StringName = item["id"]
	button.pressed.connect(func():
		Game.session.shop.buy(Game.local_player(), item_id)
		refresh())
	return button
