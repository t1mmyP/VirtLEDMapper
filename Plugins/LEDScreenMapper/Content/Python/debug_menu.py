import unreal
menus = unreal.ToolMenus.get()

# Test 1: extend_menu ohne label
m1 = menus.extend_menu("LevelEditor.MainMenu.Tools")
s1 = m1.add_section("LEDTest1")
unreal.log(f"extend_menu, no label:    section={s1}")

# Test 2: find_menu ohne label
m2 = menus.find_menu("LevelEditor.MainMenu.Tools")
s2 = m2.add_section("LEDTest2")
unreal.log(f"find_menu,   no label:    section={s2}")

# Test 3: find_menu mit label
s3 = m2.add_section("LEDTest3", label=unreal.Text("LED Tools"))
unreal.log(f"find_menu,   with label:  section={s3}")

menus.refresh_all_widgets()
