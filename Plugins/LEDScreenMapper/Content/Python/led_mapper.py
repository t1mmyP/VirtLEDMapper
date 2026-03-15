"""
LED Screen Mapper - led_mapper.py
Core logic: HTTP server (serves WebUI + bridge API), window management, DataTable export.
"""

import unreal
import json
import os
import threading
import ctypes
import ctypes.wintypes
import mimetypes
import queue as _queue_module
import sys as _sys

try:
    from http.server import HTTPServer, BaseHTTPRequestHandler
except ImportError:
    HTTPServer = None


# ── Paths ──────────────────────────────────────────────────────────────────────
EUW_ASSET_PATH       = "/LEDScreenMapper/Blueprints/EUW_LEDScreenMapper"
DATATABLE_ASSET_PATH = "/LEDScreenMapper/DT_PixelMapMapping"
TEMP_DIR  = os.path.join(os.path.expanduser("~"), "AppData", "Local", "Temp", "LEDScreenMapper")

# Plugin root: .../Plugins/LEDScreenMapper/
PLUGIN_DIR   = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEBUI_DIR    = os.path.join(PLUGIN_DIR, "Content", "WebUI")
SAVES_DIR = os.path.join(PLUGIN_DIR, "Saved", "Projects")

# ── Main-thread task queue ─────────────────────────────────────────────────────
# Background threads (HTTP server) push callables here.
# They are executed on the UE main thread via a Slate tick callback.
_main_thread_queue = _queue_module.Queue()

def _tick_main_thread_queue(delta_time):
    while not _main_thread_queue.empty():
        try:
            _main_thread_queue.get_nowait()()
        except Exception as e:
            unreal.log_error(f"LED Mapper: Main-thread task error — {e}")

# Register once — survives module reloads because we check before registering
if not hasattr(_sys, "_led_mapper_tick_handle"):
    _sys._led_mapper_tick_handle = unreal.register_slate_post_tick_callback(
        _tick_main_thread_queue
    )

# ── Shared state ───────────────────────────────────────────────────────────────
_pending_texture_url = ""
_state_lock          = threading.Lock()

# ── HTTP server ────────────────────────────────────────────────────────────────
SERVER_PORT = 17832

# Store server in sys so it survives module reloads
if not hasattr(_sys, "_led_mapper_server"):
    _sys._led_mapper_server = None


class _Server(HTTPServer):
    allow_reuse_address = True


class _Handler(BaseHTTPRequestHandler):
    """
    Thin dispatcher — always imports the CURRENT led_mapper module at request time.
    This means the server never needs to restart after a module reload.
    """

    def do_OPTIONS(self):
        import led_mapper as m; m._handle_options(self)

    def do_GET(self):
        import led_mapper as m; m._handle_get(self)

    def do_POST(self):
        import led_mapper as m; m._handle_post(self)

    def log_message(self, fmt, *args):
        pass


# ── HTTP request handlers (module-level so reload picks them up) ───────────────
def _cors(handler):
    handler.send_response(200)
    handler.send_header("Access-Control-Allow-Origin",  "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")

def _handle_options(handler):
    _cors(handler); handler.end_headers()

def _handle_get(handler):
    path = handler.path.split("?")[0]

    if path == "/ping":
        _cors(handler); handler.end_headers()
        handler.wfile.write(b"pong"); return

    if path == "/list-projects":
        os.makedirs(SAVES_DIR, exist_ok=True)
        names = [f[:-5] for f in os.listdir(SAVES_DIR) if f.endswith(".json")]
        names.sort()
        data = json.dumps(names).encode("utf-8")
        _cors(handler)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", len(data))
        handler.end_headers()
        handler.wfile.write(data)
        return

    if path.startswith("/load-project"):
        from urllib.parse import urlparse, parse_qs
        qs   = parse_qs(urlparse(handler.path).query)
        name = qs.get("name", [None])[0]
        if name:
            filepath = os.path.join(SAVES_DIR, name + ".json")
            if os.path.isfile(filepath):
                with open(filepath, "r", encoding="utf-8") as f:
                    data = f.read().encode("utf-8")
                _cors(handler)
                handler.send_header("Content-Type", "application/json")
                handler.send_header("Content-Length", len(data))
                handler.end_headers()
                handler.wfile.write(data)
                return
        _cors(handler); handler.end_headers()
        handler.wfile.write(b"null")
        return

    if path == "/texture-url":
        global _pending_texture_url
        with _state_lock:
            url = _pending_texture_url
            _pending_texture_url = ""
        _cors(handler); handler.end_headers()
        handler.wfile.write(url.encode("utf-8")); return

    # Serve external file (pixel map): GET /file/D:/path/to/image.png
    if path.startswith("/file/"):
        disk_path = path[6:]
        if len(disk_path) >= 3 and disk_path[1] == ":":
            pass  # already Windows absolute: D:/...
        elif len(disk_path) >= 3 and disk_path[0] == "/" and disk_path[2] == ":":
            disk_path = disk_path[1:]  # strip leading slash: /D:/... → D:/...
        if os.path.isfile(disk_path):
            mime, _ = mimetypes.guess_type(disk_path)
            with open(disk_path, "rb") as f: data = f.read()
            _cors(handler)
            handler.send_header("Content-Type", mime or "application/octet-stream")
            handler.send_header("Content-Length", len(data))
            handler.end_headers(); handler.wfile.write(data)
        else:
            handler.send_response(404); handler.end_headers()
        return

    # Serve WebUI static files
    if path == "/": path = "/index.html"
    filepath = os.path.join(WEBUI_DIR, path.lstrip("/"))
    if os.path.isfile(filepath):
        mime, _ = mimetypes.guess_type(filepath)
        with open(filepath, "rb") as f: data = f.read()
        _cors(handler)
        handler.send_header("Content-Type", mime or "application/octet-stream")
        handler.send_header("Content-Length", len(data))
        handler.end_headers(); handler.wfile.write(data)
    else:
        handler.send_response(404); handler.end_headers()

def _handle_post(handler):
    path = handler.path

    if path.startswith("/save-project"):
        from urllib.parse import urlparse, parse_qs
        qs   = parse_qs(urlparse(handler.path).query)
        name = qs.get("name", ["unnamed"])[0]
        # Sanitize filename
        name = "".join(c for c in name if c.isalnum() or c in " _-").strip() or "unnamed"
        length = int(handler.headers.get("Content-Length", 0))
        body   = handler.rfile.read(length).decode("utf-8")
        os.makedirs(SAVES_DIR, exist_ok=True)
        filepath = os.path.join(SAVES_DIR, name + ".json")
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(body)
        _cors(handler); handler.end_headers()
        handler.wfile.write(b"ok")
        unreal.log(f"LED Mapper: Project '{name}' saved → {filepath}")
        return

    if path.startswith("/export"):
        from urllib.parse import urlparse, parse_qs
        qs   = parse_qs(urlparse(handler.path).query)
        name = qs.get("name", ["mapping"])[0]
        name = "".join(c for c in name if c.isalnum() or c in " _-").strip() or "mapping"
        length = int(handler.headers.get("Content-Length", 0))
        body   = handler.rfile.read(length).decode("utf-8")
        _cors(handler); handler.end_headers()
        handler.wfile.write(b"ok")
        # Unreal API must run on main thread — push to queue
        _main_thread_queue.put(lambda b=body, n=name: save_mapping_from_json(b, n))

    elif path == "/pick-texture":
        _cors(handler); handler.end_headers()
        handler.wfile.write(b"ok")
        threading.Thread(target=_open_file_dialog_and_store, daemon=True).start()

    else:
        handler.send_response(404); handler.end_headers()


# ── File dialog ────────────────────────────────────────────────────────────────
def _open_file_dialog_and_store():
    global _pending_texture_url
    try:
        path = _windows_open_file_dialog("Select Pixel Map",
               "Image Files\0*.png;*.jpg;*.jpeg;*.bmp;*.tga\0All Files\0*.*\0")
        if path:
            url = "http://localhost:{}/file/{}".format(
                SERVER_PORT, path.replace("\\", "/"))
            with _state_lock:
                _pending_texture_url = url
            unreal.log(f"LED Mapper: File selected → {path}")
        else:
            unreal.log("LED Mapper: File dialog cancelled.")
    except Exception as e:
        unreal.log_error(f"LED Mapper: File dialog error — {e}")


def _windows_open_file_dialog(title="Open File", filters="All Files\0*.*\0") -> str:
    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize",       ctypes.wintypes.DWORD),
            ("hwndOwner",         ctypes.wintypes.HWND),
            ("hInstance",         ctypes.wintypes.HINSTANCE),
            ("lpstrFilter",       ctypes.c_wchar_p),
            ("lpstrCustomFilter", ctypes.c_wchar_p),
            ("nMaxCustFilter",    ctypes.wintypes.DWORD),
            ("nFilterIndex",      ctypes.wintypes.DWORD),
            ("lpstrFile",         ctypes.c_void_p),
            ("nMaxFile",          ctypes.wintypes.DWORD),
            ("lpstrFileTitle",    ctypes.c_wchar_p),
            ("nMaxFileTitle",     ctypes.wintypes.DWORD),
            ("lpstrInitialDir",   ctypes.c_wchar_p),
            ("lpstrTitle",        ctypes.c_wchar_p),
            ("Flags",             ctypes.wintypes.DWORD),
            ("nFileOffset",       ctypes.wintypes.WORD),
            ("nFileExtension",    ctypes.wintypes.WORD),
            ("lpstrDefExt",       ctypes.c_wchar_p),
            ("lCustData",         ctypes.wintypes.LPARAM),
            ("lpfnHook",          ctypes.c_void_p),
            ("lpTemplateName",    ctypes.c_wchar_p),
            ("pvReserved",        ctypes.c_void_p),
            ("dwReserved",        ctypes.wintypes.DWORD),
            ("FlagsEx",           ctypes.wintypes.DWORD),
        ]
    buf = ctypes.create_unicode_buffer(32768)
    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    ofn.lpstrFilter = filters
    ofn.lpstrFile   = ctypes.addressof(buf)
    ofn.nMaxFile    = len(buf)
    ofn.lpstrTitle  = title
    ofn.Flags       = 0x00000800 | 0x00000004  # OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR
    if ctypes.windll.comdlg32.GetOpenFileNameW(ctypes.byref(ofn)):
        return buf.value  # c_wchar_Array still readable via .value
    return ""


# ── Server lifecycle ───────────────────────────────────────────────────────────
def ensure_server():
    # If already running, do nothing — never call shutdown() from the game thread
    if _sys._led_mapper_server is not None:
        unreal.log(f"LED Mapper: Server already running on port {SERVER_PORT}.")
        return

    if HTTPServer is None:
        unreal.log_error("LED Mapper: http.server not available."); return
    try:
        srv = _Server(("localhost", SERVER_PORT), _Handler)
        t   = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        _sys._led_mapper_server = srv
        unreal.log(f"LED Mapper: Server started → http://localhost:{SERVER_PORT}/")
    except OSError as e:
        unreal.log_warning(f"LED Mapper: Could not start server ({e}).")


def stop_server():
    """Call this only from a background thread, never from the game thread."""
    if _sys._led_mapper_server:
        def _shutdown():
            try:
                _sys._led_mapper_server.shutdown()
                _sys._led_mapper_server.server_close()
            except Exception:
                pass
            _sys._led_mapper_server = None
        threading.Thread(target=_shutdown, daemon=True).start()


# ── Window ─────────────────────────────────────────────────────────────────────
def open_window():
    ensure_server()
    euw = unreal.EditorAssetLibrary.load_asset(EUW_ASSET_PATH)
    if euw is None:
        unreal.log_warning(f"LED Mapper: EUW not found at '{EUW_ASSET_PATH}'."); return
    sub = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
    sub.spawn_and_register_tab(euw)
    unreal.log("LED Mapper: Window opened.")


# ── DataTable export ───────────────────────────────────────────────────────────
MAPPINGS_ASSET_PATH = "/Game/Mappings"
STRUCT_ASSET_PATH   = "/LEDScreenMapper/Blueprints/s_LEDScreenMapping.s_LEDScreenMapping"


def save_mapping_from_json(json_string: str, config_name: str = "mapping"):
    try:
        rows = json.loads(json_string)
    except json.JSONDecodeError as e:
        unreal.log_error(f"LED Mapper: Invalid JSON — {e}"); return False

    # Also write JSON to temp for manual fallback
    os.makedirs(TEMP_DIR, exist_ok=True)
    json_path = os.path.join(TEMP_DIR, f"{config_name}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)

    unreal.log(f"LED Mapper: {len(rows)} screen(s) — creating DataTable...")
    _create_or_update_datatable(json_string, config_name)
    return True


_DT_FIELDS = [
    "ScreenIndex", "ScreenName",
    "UVOffsetX", "UVOffsetY", "UVScaleX", "UVScaleY",
    "MapWidth", "MapHeight",
]

def _json_to_datatable_csv(json_string: str) -> str:
    """Convert JSON array to DataTable CSV where ScreenIndex is used as row name (--- column)."""
    import csv, io
    rows = json.loads(json_string)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["---"] + _DT_FIELDS)
    for r in rows:
        row_name = str(int(r.get("ScreenIndex", 0)))
        writer.writerow([row_name] + [r.get(f, "") for f in _DT_FIELDS])
    return out.getvalue()


def _create_or_update_datatable(json_string: str, config_name: str):
    dt_name = f"DT_{config_name}"
    dt_path = f"{MAPPINGS_ASSET_PATH}/{dt_name}"

    # Ensure /Game/Mappings/ exists
    if not unreal.EditorAssetLibrary.does_directory_exist(MAPPINGS_ASSET_PATH):
        unreal.EditorAssetLibrary.make_directory(MAPPINGS_ASSET_PATH)
        unreal.log(f"LED Mapper: Created directory {MAPPINGS_ASSET_PATH}")

    # Load struct
    struct_ref = unreal.load_object(None, STRUCT_ASSET_PATH)
    if struct_ref is None:
        unreal.log_error(f"LED Mapper: Could not load struct at '{STRUCT_ASSET_PATH}'. "
                         "Make sure S_LEDScreenMapping exists in the plugin content.")
        return

    # Get existing DataTable or create new one
    dt = unreal.EditorAssetLibrary.load_asset(dt_path) if \
         unreal.EditorAssetLibrary.does_asset_exist(dt_path) else None

    if dt is None:
        factory = unreal.DataTableFactory()
        factory.struct = struct_ref
        dt = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            dt_name, MAPPINGS_ASSET_PATH, unreal.DataTable, factory
        )
        if dt is None:
            unreal.log_error(f"LED Mapper: Failed to create DataTable '{dt_name}'.")
            return
        unreal.log(f"LED Mapper: Created new DataTable '{dt_name}'.")
    else:
        unreal.log(f"LED Mapper: Updating existing DataTable '{dt_name}'.")

    # Convert JSON to CSV so ScreenIndex becomes the explicit row name (--- column)
    csv_string = _json_to_datatable_csv(json_string)
    success = unreal.DataTableFunctionLibrary.fill_data_table_from_csv_string(dt, csv_string)

    if success:
        unreal.EditorAssetLibrary.save_asset(dt_path)
        unreal.log(f"LED Mapper: DataTable '{dt_name}' saved at {dt_path}")
    else:
        unreal.log_error(f"LED Mapper: fill_data_table_from_csv_string failed for '{dt_name}'. "
                         f"JSON saved to: {os.path.join(TEMP_DIR, config_name + '.json')}")
