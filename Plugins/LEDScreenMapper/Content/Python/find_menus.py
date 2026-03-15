"""Run this once to find the correct menu paths in your UE version."""
import unreal

menus = unreal.ToolMenus.get()

# Try common paths and report which ones exist
paths_to_try = [
    "LevelEditor.MainMenu",
    "LevelEditor.MainMenu.Tools",
    "LevelEditor.MainMenu.Window",
    "LevelEditor.MainMenu.Help",
    "LevelEditor.LevelEditorToolBar",
    "LevelEditor.LevelEditorToolBar.PlayToolBar",
    "LevelEditor.LevelEditorToolBar.AssetsToolBar",
    "MainFrame.MainMenu",
    "MainFrame.MainMenu.Tools",
    "MainFrame.MainTabMenu",
]

for path in paths_to_try:
    menu = menus.find_menu(path)
    if menu is not None:
        unreal.log(f"FOUND: {path}")
    else:
        unreal.log(f"  not found: {path}")
