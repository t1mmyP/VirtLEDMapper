"""
LED Screen Mapper - init_unreal.py
Auto-executed by UE on editor startup.
Starts the HTTP bridge server and registers the toolbar button.
"""

import unreal
import importlib

import led_mapper
importlib.reload(led_mapper)

# Server starts once and never needs restart — handler delegates to current module
led_mapper.ensure_server()


# ── Toolbar button + Tools menu entry ──────────────────────────────────────────
menus = unreal.ToolMenus.get()
cmd   = "import led_mapper; led_mapper.open_window()"

# 1) Toolbar button (right of Play buttons)
toolbar = menus.extend_menu("LevelEditor.LevelEditorToolBar.PlayToolBar")
toolbar.add_section("LEDScreenMapper", label=unreal.Text("LED Screen Mapper"))
tb_entry = unreal.ToolMenuEntry(
    name="OpenLEDScreenMapper_TB",
    type=unreal.MultiBlockType.TOOL_BAR_BUTTON,
)
tb_entry.set_label(unreal.Text("LED Mapper"))
tb_entry.set_tool_tip(unreal.Text("Open LED Screen Pixel Map Mapper"))
tb_entry.set_icon("EditorStyle", "LevelEditor.Tabs.Viewports")
tb_entry.set_string_command(unreal.ToolMenuStringCommandType.PYTHON, "", cmd)
toolbar.add_menu_entry("LEDScreenMapper", tb_entry)

# 2) Tools menu entry (fallback)
tools_menu = menus.extend_menu("LevelEditor.MainMenu.Tools")
tools_menu.add_section("LEDScreenMapper", label=unreal.Text("LED Screen Mapper"))
menu_entry = unreal.ToolMenuEntry(
    name="OpenLEDScreenMapper_Menu",
    type=unreal.MultiBlockType.MENU_ENTRY,
)
menu_entry.set_label(unreal.Text("LED Screen Mapper"))
menu_entry.set_tool_tip(unreal.Text("Open LED Screen Pixel Map Mapper"))
menu_entry.set_string_command(unreal.ToolMenuStringCommandType.PYTHON, "", cmd)
tools_menu.add_menu_entry("LEDScreenMapper", menu_entry)

menus.refresh_all_widgets()
unreal.log("LED Screen Mapper: Ready.")
