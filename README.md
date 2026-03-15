![LED Screen Mapper](images/LED_Screen_Mapper_Headder.png)

# LED Screen Mapper

An Unreal Engine 5 plugin for mapping virtual LED screens onto pixel maps using UV coordinates. Place screen rectangles graphically on a pixel map image, export the UV data, and drive LED screen meshes in Blueprints automatically.

No C++ required — Python only.

---

## Features

- Canvas-based graphical editor (runs inside UE via WebBrowser widget)
- Place, resize, move and duplicate screen rectangles on a pixel map
- Exports UV offset/scale data directly into a UE DataTable asset
- Multiple named configs — save and load different mapping setups
- Drives `BP_LEDScreen` Blueprints via DataTable lookup
- Works with any Media Texture as the content source

---

## Requirements

- Unreal Engine 5.1 or newer
- Windows (file dialog uses native Win32 API)
- Plugins enabled: `PythonScriptPlugin`, `WebBrowserWidget`, `EditorScriptingUtilities`

---

## Installation

1. Copy the `LEDScreenMapper` folder into your project's `Plugins/` directory
2. Open your project in Unreal Engine
3. Enable the plugin: **Edit → Plugins → LED Screen Mapper → Enable**
4. Restart the editor

After restart a **LED Mapper** button appears in the toolbar next to the Play buttons.

---

## Usage

### 1. Open the Editor

Click **LED Mapper** in the toolbar or go to **Tools → LED Screen Mapper**.

### 2. Set the Map Resolution

Enter the pixel dimensions of your pixel map (e.g. `3840 × 2160`) in the toolbar inputs.

### 3. Load a Pixel Map

Click **Load Map** — a native file dialog opens. Select your pixel map PNG/JPG. The image is displayed as the canvas background.

### 4. Add Screens

In the **New Screen** panel on the left:
- Set **Name**, **W (px)**, **H (px)** and **Index**
- Click **Place on Map** — the screen appears centered on the canvas

Drag screens to position them. Use the resize handles to adjust size. Fine-tune position and size in the **Properties** panel.

### 5. Save a Config

Enter a name in the config name field and click **Save**. Configs are stored in:
```
Plugins/LEDScreenMapper/Saved/Projects/<name>.json
```

Click **Load…** to restore a previously saved config.

### 6. Export to DataTable

Click **Export JSON**. This creates (or updates) a DataTable asset at:
```
/Game/Mappings/DT_<configname>
```

Each row in the DataTable corresponds to one screen. The row name is the screen index (as string: `"0"`, `"1"`, `"2"`, …).

---

## DataTable Structure

The plugin uses the struct `S_LEDScreenMapping` with these fields:

| Field | Type | Description |
|---|---|---|
| ScreenIndex | Integer | Index of the screen |
| ScreenName | String | Name of the screen |
| UVOffsetX | Float | UV horizontal offset (0–1) |
| UVOffsetY | Float | UV vertical offset (0–1) |
| UVScaleX | Float | UV horizontal scale (0–1) |
| UVScaleY | Float | UV vertical scale (0–1) |
| MapWidth | Float | Pixel map width in pixels |
| MapHeight | Float | Pixel map height in pixels |

### UV Math

```
UVOffsetX = ScreenX / MapWidth
UVOffsetY = ScreenY / MapHeight
UVScaleX  = ScreenW / MapWidth
UVScaleY  = ScreenH / MapHeight
```

In the material: `FinalUV = TexCoord * float2(ScaleX, ScaleY) + float2(OffsetX, OffsetY)`

---

## Blueprint Setup (BP_LEDScreen)

The plugin includes `BP_LEDScreen` — an actor Blueprint that reads UV data from a DataTable and applies it to a Dynamic Material Instance.

**Variables to set per instance:**
- `MappingTable` — the exported DataTable asset (e.g. `DT_Stage_01`)
- `ScreenIndex` — the index of this screen in the mapping

The Construction Script automatically looks up the correct row and sets the UV scalar parameters on the material.

---

## Material Setup (M_LEDScreen)

The plugin includes `M_LEDScreen` — an Unlit material with the following parameters:

| Parameter | Type | Default |
|---|---|---|
| ContentTexture | Texture2D / MediaTexture | — |
| UVOffsetX | Scalar | 0.0 |
| UVOffsetY | Scalar | 0.0 |
| UVScaleX | Scalar | 1.0 |
| UVScaleY | Scalar | 1.0 |

Assign a **Media Texture** to `ContentTexture` per screen instance to display the LED content.

---

## File Structure

```
LEDScreenMapper/
  LEDScreenMapper.uplugin
  Content/
    Python/
      init_unreal.py       ← auto-executed on editor start
      led_mapper.py        ← HTTP server, file dialog, DataTable export
    WebUI/
      index.html           ← editor UI
      editor.js            ← canvas editor logic
      style.css            ← dark theme
    Blueprints/
      EUW_LEDScreenMapper  ← Editor Utility Widget (opens the web editor)
      BP_LEDScreen         ← LED screen actor Blueprint
      S_LEDScreenMapping   ← DataTable row struct
    Materials/
      M_LEDScreen          ← example Unlit material
      MF_LEDUVMapping      ← UV mapping material function
    Textures/
      LED_Screen_Billboard ← plugin icon
  Resources/
    Icon128.png            ← plugin browser icon
```

---

## License

MIT
