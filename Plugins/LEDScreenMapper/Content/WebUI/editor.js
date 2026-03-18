/**
 * LED Screen Mapper — editor.js
 *
 * Communication with Unreal Engine:
 *   UE → JS:  Blueprint calls ExecuteJavaScript("initMap('file:///...', 3840, 2160)")
 *   JS → UE:  window.ue.ledMapper.receiveExportData(jsonString)   [via BindUObject in EUW]
 *             Fallback: downloads JSON file (for testing in browser)
 */

"use strict";

// ============================================================
// STATE
// ============================================================
const state = {
  mapWidth:  3840,
  mapHeight: 2160,
  mapImage:    null,    // HTMLImageElement
  mapImageUrl: "",     // persisted URL (server-served or file://)

  screens: [],          // Array of Screen objects
  selectedId: null,
  nextAutoIndex: 0,

  // Viewport transform
  viewOffsetX: 0,
  viewOffsetY: 0,
  viewScale:   1.0,

  // Interaction
  interaction: null,    // { type: 'move'|'resize', screenId, handle, startMapX, startMapY, origRect }
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  panStartViewX: 0,
  panStartViewY: 0,
};

// ============================================================
// SCREEN COLORS
// ============================================================
const COLORS = [
  "#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6",
  "#1abc9c","#e67e22","#e91e63","#00bcd4","#8bc34a",
  "#ff5722","#607d8b","#795548","#673ab7","#009688",
  "#cddc39","#ff9800","#f44336","#2196f3","#4caf50",
];

function screenColor(index) {
  return COLORS[index % COLORS.length];
}

function snapVal(v) {
  const snap = parseInt(document.getElementById("snapGrid").value, 10) || 1;
  return snap <= 1 ? Math.round(v) : Math.round(v / snap) * snap;
}

// ============================================================
// SCREEN OBJECT
// ============================================================
let _uid = 0;
function createScreen(name, index, w, h, mapX, mapY) {
  return {
    uid: ++_uid,
    name,
    index,
    x: Math.round(mapX - w / 2),
    y: Math.round(mapY - h / 2),
    w,
    h,
  };
}

function screenUV(s) {
  return {
    offsetX: s.x / state.mapWidth,
    offsetY: s.y / state.mapHeight,
    scaleX:  s.w / state.mapWidth,
    scaleY:  s.h / state.mapHeight,
  };
}

// ============================================================
// CANVAS
// ============================================================
const canvas = document.getElementById("mapCanvas");
const ctx    = canvas.getContext("2d");

function resizeCanvas() {
  const container = document.getElementById("canvasContainer");
  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;
  render();
}

window.addEventListener("resize", resizeCanvas);

// ============================================================
// VIEWPORT MATH
// ============================================================
function mapToCanvas(mx, my) {
  return {
    x: mx * state.viewScale + state.viewOffsetX,
    y: my * state.viewScale + state.viewOffsetY,
  };
}

function canvasToMap(cx, cy) {
  return {
    x: (cx - state.viewOffsetX) / state.viewScale,
    y: (cy - state.viewOffsetY) / state.viewScale,
  };
}

function fitView() {
  if (!state.mapImage) return;
  const pad = 20;
  const scaleX = (canvas.width  - pad * 2) / state.mapWidth;
  const scaleY = (canvas.height - pad * 2) / state.mapHeight;
  state.viewScale   = Math.min(scaleX, scaleY);
  state.viewOffsetX = Math.round((canvas.width  - state.mapWidth  * state.viewScale) / 2);
  state.viewOffsetY = Math.round((canvas.height - state.mapHeight * state.viewScale) / 2);
  render();
}

// ============================================================
// RENDER
// ============================================================
const HANDLE_SIZE = 6;

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background grid
  drawGrid();

  ctx.save();
  ctx.translate(state.viewOffsetX, state.viewOffsetY);
  ctx.scale(state.viewScale, state.viewScale);

  // Pixel map image
  if (state.mapImage) {
    ctx.drawImage(state.mapImage, 0, 0, state.mapWidth, state.mapHeight);
  } else {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, state.mapWidth, state.mapHeight);
  }

  // Map border
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1 / state.viewScale;
  ctx.strokeRect(0, 0, state.mapWidth, state.mapHeight);

  // Draw screens (unselected first, selected on top)
  const sorted = [...state.screens].sort((a, b) =>
    (a.uid === state.selectedId ? 1 : 0) - (b.uid === state.selectedId ? 1 : 0)
  );
  for (const s of sorted) {
    drawScreen(s, s.uid === state.selectedId);
  }

  ctx.restore();
}

function drawGrid() {
  const step = 40;
  ctx.strokeStyle = "#1f1f1f";
  ctx.lineWidth   = 1;
  for (let x = 0; x < canvas.width; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawScreen(s, isSelected) {
  const color = screenColor(s.index);
  const lw    = 1.5 / state.viewScale;

  // Fill
  ctx.globalAlpha = isSelected ? 0.45 : 0.30;
  ctx.fillStyle = color;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.globalAlpha = 1;

  // Border
  ctx.strokeStyle = isSelected ? "#fff" : color;
  ctx.lineWidth   = isSelected ? 2 / state.viewScale : lw;
  ctx.strokeRect(s.x, s.y, s.w, s.h);

  // Label background
  const fontSize = Math.max(10, Math.min(24, s.h * 0.12));
  ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
  const labelText = `${s.index}: ${s.name}`;
  const textW = ctx.measureText(labelText).width;
  const padX  = fontSize * 0.4;
  const padY  = fontSize * 0.3;
  const lx    = s.x + s.w / 2 - textW / 2 - padX;
  const ly    = s.y + s.h / 2 - fontSize / 2 - padY;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(lx, ly, textW + padX * 2, fontSize + padY * 2);

  // Label text
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.fillText(labelText, lx + padX, ly + padY);

  // Resize handles (only for selected)
  if (isSelected) {
    const hs = HANDLE_SIZE / state.viewScale;
    for (const [hx, hy] of getHandlePositions(s)) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1 / state.viewScale;
      ctx.beginPath();
      ctx.rect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function getHandlePositions(s) {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  return [
    [s.x,        s.y       ],  // 0 top-left
    [cx,         s.y       ],  // 1 top-center
    [s.x + s.w,  s.y       ],  // 2 top-right
    [s.x + s.w,  cy        ],  // 3 right-center
    [s.x + s.w,  s.y + s.h],  // 4 bottom-right
    [cx,         s.y + s.h],  // 5 bottom-center
    [s.x,        s.y + s.h],  // 6 bottom-left
    [s.x,        cy        ],  // 7 left-center
  ];
}

// ============================================================
// HIT TESTING
// ============================================================
function hitTestHandle(s, mx, my) {
  const hs = (HANDLE_SIZE + 4) / state.viewScale;
  const positions = getHandlePositions(s);
  for (let i = 0; i < positions.length; i++) {
    const [hx, hy] = positions[i];
    if (Math.abs(mx - hx) <= hs / 2 && Math.abs(my - hy) <= hs / 2) return i;
  }
  return -1;
}

function hitTestScreen(mx, my) {
  // Iterate in reverse so topmost (selected) is hit first
  for (let i = state.screens.length - 1; i >= 0; i--) {
    const s = state.screens[i];
    if (mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h) return s;
  }
  return null;
}

const HANDLE_CURSORS = [
  "nw-resize","n-resize","ne-resize","e-resize",
  "se-resize","s-resize","sw-resize","w-resize"
];

function getCursorForMap(mx, my) {
  const sel = state.screens.find(s => s.uid === state.selectedId);
  if (sel) {
    const h = hitTestHandle(sel, mx, my);
    if (h >= 0) return HANDLE_CURSORS[h];
    if (mx >= sel.x && mx <= sel.x + sel.w && my >= sel.y && my <= sel.y + sel.h)
      return "move";
  }
  const hit = hitTestScreen(mx, my);
  return hit ? "pointer" : "default";
}

// ============================================================
// CANVAS MOUSE EVENTS
// ============================================================
canvas.addEventListener("mousedown", e => {
  const { x: mx, y: my } = canvasToMap(e.offsetX, e.offsetY);

  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    // Pan
    state.isPanning   = true;
    state.panStartX   = e.offsetX;
    state.panStartY   = e.offsetY;
    state.panStartViewX = state.viewOffsetX;
    state.panStartViewY = state.viewOffsetY;
    canvas.style.cursor = "grabbing";
    return;
  }

  if (e.button !== 0) return;

  // Check resize handle on selected screen first
  const sel = state.screens.find(s => s.uid === state.selectedId);
  if (sel) {
    const handleIdx = hitTestHandle(sel, mx, my);
    if (handleIdx >= 0) {
      state.interaction = {
        type: "resize",
        screenId: sel.uid,
        handle: handleIdx,
        startMapX: mx,
        startMapY: my,
        origRect: { x: sel.x, y: sel.y, w: sel.w, h: sel.h },
      };
      return;
    }
  }

  // Check move
  const hit = hitTestScreen(mx, my);
  if (hit) {
    selectScreen(hit.uid);
    state.interaction = {
      type: "move",
      screenId: hit.uid,
      startMapX: mx,
      startMapY: my,
      origRect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h },
    };
    return;
  }

  // Deselect
  selectScreen(null);
});

canvas.addEventListener("mousemove", e => {
  if (state.isPanning) {
    state.viewOffsetX = state.panStartViewX + (e.offsetX - state.panStartX);
    state.viewOffsetY = state.panStartViewY + (e.offsetY - state.panStartY);
    render();
    return;
  }

  const { x: mx, y: my } = canvasToMap(e.offsetX, e.offsetY);

  if (state.interaction) {
    const s = state.screens.find(s => s.uid === state.interaction.screenId);
    if (!s) return;

    const dx = mx - state.interaction.startMapX;
    const dy = my - state.interaction.startMapY;
    const or = state.interaction.origRect;

    if (state.interaction.type === "move") {
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          s.x = snapVal(or.x + dx);
          s.y = or.y;
        } else {
          s.x = or.x;
          s.y = snapVal(or.y + dy);
        }
      } else {
        s.x = snapVal(or.x + dx);
        s.y = snapVal(or.y + dy);
      }
    } else {
      applyResize(s, state.interaction.handle, dx, dy, or);
    }

    updatePropsPanel();
    render();
    return;
  }

  canvas.style.cursor = getCursorForMap(mx, my);
});

canvas.addEventListener("mouseup", e => {
  if (state.isPanning) {
    state.isPanning = false;
    canvas.style.cursor = "default";
    return;
  }
  if (state.interaction) {
    state.interaction = null;
    updatePropsPanel();
    render();
  }
});

canvas.addEventListener("mouseleave", () => {
  state.isPanning = false;
  state.interaction = null;
});

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const mx = e.offsetX;
  const my = e.offsetY;
  state.viewOffsetX = mx + (state.viewOffsetX - mx) * factor;
  state.viewOffsetY = my + (state.viewOffsetY - my) * factor;
  state.viewScale  *= factor;
  state.viewScale   = Math.max(0.05, Math.min(20, state.viewScale));
  render();
}, { passive: false });

// ============================================================
// RESIZE LOGIC
// ============================================================
function applyResize(s, handle, dx, dy, or_) {
  const MIN = 4;
  let { x, y, w, h } = or_;

  // handle layout: 0=TL 1=TC 2=TR 3=RC 4=BR 5=BC 6=BL 7=LC
  switch (handle) {
    case 0: x += dx; y += dy; w -= dx; h -= dy; break; // TL
    case 1:          y += dy;           h -= dy; break; // TC
    case 2:          y += dy; w += dx;  h -= dy; break; // TR
    case 3:                   w += dx;           break; // RC
    case 4:                   w += dx;  h += dy; break; // BR
    case 5:                             h += dy; break; // BC
    case 6: x += dx;          w -= dx;  h += dy; break; // BL
    case 7: x += dx;          w -= dx;           break; // LC
  }

  if (w < MIN) { if (handle === 0 || handle === 6 || handle === 7) x = or_.x + or_.w - MIN; w = MIN; }
  if (h < MIN) { if (handle === 0 || handle === 1 || handle === 2) y = or_.y + or_.h - MIN; h = MIN; }

  s.x = snapVal(x);
  s.y = snapVal(y);
  s.w = snapVal(w);
  s.h = snapVal(h);
}

// ============================================================
// SELECTION & UI
// ============================================================
function selectScreen(uid) {
  state.selectedId = uid;
  updateScreenList();
  updatePropsPanel();
  render();
}

function updateScreenList() {
  const list = document.getElementById("screenList");
  list.innerHTML = "";
  document.getElementById("screenCount").textContent = `(${state.screens.length})`;

  for (const s of state.screens) {
    const item = document.createElement("div");
    item.className = "screen-list-item" + (s.uid === state.selectedId ? " active" : "");
    item.innerHTML = `
      <div class="screen-list-swatch" style="background:${screenColor(s.index)}"></div>
      <span class="screen-list-label">${s.name}</span>
      <span class="screen-list-index">#${s.index}</span>
    `;
    item.addEventListener("click", () => selectScreen(s.uid));
    list.appendChild(item);
  }
}

function updatePropsPanel() {
  const panel = document.getElementById("propsPanel");
  const s = state.screens.find(s => s.uid === state.selectedId);

  if (!s) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "";
  document.getElementById("propName").value  = s.name;
  document.getElementById("propIndex").value = s.index;
  document.getElementById("propX").value     = s.x;
  document.getElementById("propY").value     = s.y;
  document.getElementById("propW").value     = s.w;
  document.getElementById("propH").value     = s.h;

  const uv = screenUV(s);
  document.getElementById("uvOffsetX").textContent = uv.offsetX.toFixed(6);
  document.getElementById("uvOffsetY").textContent = uv.offsetY.toFixed(6);
  document.getElementById("uvScaleX").textContent  = uv.scaleX.toFixed(6);
  document.getElementById("uvScaleY").textContent  = uv.scaleY.toFixed(6);
}

// Sync props panel back to screen
function bindPropsInput(id, key, type) {
  document.getElementById(id).addEventListener("change", e => {
    const s = state.screens.find(s => s.uid === state.selectedId);
    if (!s) return;
    if      (type === "string") s[key] = e.target.value;
    else if (type === "float")  s[key] = parseFloat(e.target.value);
    else                        s[key] = parseInt(e.target.value, 10);
    updatePropsPanel();
    updateScreenList();
    render();
  });
}
bindPropsInput("propName",  "name",  "string");
bindPropsInput("propIndex", "index", "int");
bindPropsInput("propX",     "x",     "int");
bindPropsInput("propY",     "y",     "int");
bindPropsInput("propW",     "w",     "int");
bindPropsInput("propH",     "h",     "int");

// ============================================================
// ADD / DELETE SCREEN
// ============================================================
document.getElementById("btnConfirmAdd").addEventListener("click", () => {
  const name  = document.getElementById("newScreenName").value.trim() || `Screen_${state.nextAutoIndex.toString().padStart(2,"0")}`;
  const w     = parseInt(document.getElementById("newW").value, 10) || 384;
  const h     = parseInt(document.getElementById("newH").value, 10) || 680;
  const index = parseInt(document.getElementById("newIndex").value, 10) || state.nextAutoIndex;

  const s = createScreen(name, index, w, h, state.mapWidth / 2, state.mapHeight / 2);
  state.screens.push(s);
  state.nextAutoIndex = index + 1;
  document.getElementById("newIndex").value = state.nextAutoIndex;
  document.getElementById("newScreenName").value = `Screen_${state.nextAutoIndex.toString().padStart(2,"0")}`;

  selectScreen(s.uid);
  updateScreenList();
  render();
});

document.getElementById("btnDuplicateScreen").addEventListener("click", () => {
  const src = state.screens.find(s => s.uid === state.selectedId);
  if (!src) return;
  const newIndex = state.nextAutoIndex;
  const newName  = `Screen_${newIndex.toString().padStart(2, "0")}`;
  const copy = {
    ...src,
    uid:   ++_uid,
    name:  newName,
    index: newIndex,
    x:     src.x + src.w,
    y:     src.y,
  };
  state.screens.push(copy);
  state.nextAutoIndex = newIndex + 1;
  document.getElementById("newIndex").value       = state.nextAutoIndex;
  document.getElementById("newScreenName").value  = `Screen_${state.nextAutoIndex.toString().padStart(2, "0")}`;
  selectScreen(copy.uid);
  updateScreenList();
  render();
});

document.getElementById("btnDeleteScreen").addEventListener("click", () => {
  if (state.selectedId === null) return;
  state.screens = state.screens.filter(s => s.uid !== state.selectedId);
  state.selectedId = null;
  updateScreenList();
  updatePropsPanel();
  render();
});

// ============================================================
// TOOLBAR ACTIONS
// ============================================================
document.getElementById("btnZoomIn").addEventListener("click",    () => { zoom(1.25); });
document.getElementById("btnZoomOut").addEventListener("click",   () => { zoom(0.8);  });
document.getElementById("btnZoomReset").addEventListener("click", () => { state.viewScale = 1; state.viewOffsetX = 0; state.viewOffsetY = 0; render(); });
document.getElementById("btnZoomFit").addEventListener("click",   () => fitView());

function zoom(factor) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  state.viewOffsetX = cx + (state.viewOffsetX - cx) * factor;
  state.viewOffsetY = cy + (state.viewOffsetY - cy) * factor;
  state.viewScale   = Math.max(0.05, Math.min(20, state.viewScale * factor));
  render();
}

document.getElementById("btnLoadMap").addEventListener("click", () => {
  showToast("Opening file dialog...");
  // Always try bridge server first (UE context), fall back to HTML file picker
  fetch("http://localhost:17832/pick-texture", { method: "POST" })
    .then(r => {
      if (r.ok) {
        showToast("Select a file in the dialog...");
        pollForTexture();
      } else {
        openBrowserFilePicker();
      }
    })
    .catch(() => openBrowserFilePicker());
});

function openBrowserFilePicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const mw = parseInt(document.getElementById("mapWidth").value,  10) || 3840;
    const mh = parseInt(document.getElementById("mapHeight").value, 10) || 2160;
    initMap(URL.createObjectURL(file), mw, mh);
  };
  input.click();
}

function pollForTexture(attempts = 0) {
  if (attempts > 60) { showToast("Timeout: no file selected."); return; }
  fetch("http://localhost:17832/texture-url")
    .then(r => r.text())
    .then(url => {
      if (url) {
        const mw = parseInt(document.getElementById("mapWidth").value,  10) || 3840;
        const mh = parseInt(document.getElementById("mapHeight").value, 10) || 2160;
        initMap(url, mw, mh);
      } else {
        setTimeout(() => pollForTexture(attempts + 1), 500);
      }
    })
    .catch(() => showToast("Bridge server not reachable."));
}

// ============================================================
// EXPORT
// ============================================================
document.getElementById("btnExport").addEventListener("click", () => exportMapping());

// ── Save ──────────────────────────────────────────────────────────────────────
document.getElementById("btnSave").addEventListener("click", () => {
  const name = document.getElementById("saveNameInput").value.trim();
  if (!name) { showToast("Enter a config name first."); return; }

  const project = {
    mapWidth:      state.mapWidth,
    mapHeight:     state.mapHeight,
    mapImageUrl:   state.mapImageUrl,
    screens:       state.screens,
    nextAutoIndex: state.nextAutoIndex,
  };
  fetch(`http://localhost:17832/save-project?name=${encodeURIComponent(name)}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(project, null, 2),
  })
  .then(r => r.ok ? showToast(`"${name}" saved.`) : showToast("Save failed."))
  .catch(() => showToast("Bridge server not reachable."));
});

// ── Load Modal ────────────────────────────────────────────────────────────────
document.getElementById("btnLoad").addEventListener("click", () => {
  fetch("http://localhost:17832/list-projects")
    .then(r => r.json())
    .then(names => {
      const list = document.getElementById("loadModalList");
      list.innerHTML = "";
      if (!names.length) {
        list.innerHTML = '<div style="color:#888; font-size:12px;">No saved configs found.</div>';
      } else {
        names.forEach(name => {
          const btn = document.createElement("button");
          btn.textContent = name;
          btn.style.cssText = "text-align:left; padding:6px 10px;";
          btn.addEventListener("click", () => {
            loadProject(name);
            closeLoadModal();
          });
          list.appendChild(btn);
        });
      }
      const modal = document.getElementById("loadModal");
      modal.style.display = "flex";
    })
    .catch(() => showToast("Could not reach server."));
});

document.getElementById("loadModalClose").addEventListener("click", closeLoadModal);
document.getElementById("loadModal").addEventListener("click", e => {
  if (e.target === document.getElementById("loadModal")) closeLoadModal();
});

function closeLoadModal() {
  document.getElementById("loadModal").style.display = "none";
}

function loadProject(name) {
  fetch(`http://localhost:17832/load-project?name=${encodeURIComponent(name)}`)
    .then(r => r.json())
    .then(project => {
      if (!project) { showToast("Config not found."); return; }
      state.nextAutoIndex = project.nextAutoIndex || 0;
      state.screens       = (project.screens || []).map(s => ({ ...s, uid: ++_uid }));
      state.selectedId    = null;
      document.getElementById("newIndex").value      = state.nextAutoIndex;
      document.getElementById("saveNameInput").value = name;
      updateScreenList();
      updatePropsPanel();

      // Load image first, then render
      if (project.mapImageUrl && !project.mapImageUrl.startsWith("blob:")) {
        initMap(project.mapImageUrl, project.mapWidth || 3840, project.mapHeight || 2160);
      } else {
        state.mapWidth  = project.mapWidth  || 3840;
        state.mapHeight = project.mapHeight || 2160;
        document.getElementById("mapWidth").value  = state.mapWidth;
        document.getElementById("mapHeight").value = state.mapHeight;
        render();
      }
      showToast(`"${name}" loaded — ${state.screens.length} screen(s).`);
    })
    .catch(() => showToast("Could not load config."));
}

function generateJSON() {
  const rows = state.screens.map(s => {
    const uv = screenUV(s);
    return {
      Name:       String(s.index),
      ScreenIndex: s.index,
      ScreenName: s.name,
      UVOffsetX:  parseFloat(uv.offsetX.toFixed(8)),
      UVOffsetY:  parseFloat(uv.offsetY.toFixed(8)),
      UVScaleX:   parseFloat(uv.scaleX.toFixed(8)),
      UVScaleY:   parseFloat(uv.scaleY.toFixed(8)),
      MapWidth:    state.mapWidth,
      MapHeight:   state.mapHeight,
    };
  });
  return JSON.stringify(rows, null, 2);
}

const BRIDGE_URL = "http://localhost:17832/export";

function exportMapping() {
  if (state.screens.length === 0) {
    alert("No screens to export.");
    return;
  }

  const json = generateJSON();

  // Try Python bridge server first (running inside UE)
  const configName = document.getElementById("saveNameInput").value.trim() || "mapping";
  fetch(`${BRIDGE_URL}?name=${encodeURIComponent(configName)}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    json,
  })
  .then(r => {
    if (r.ok) {
      showToast(`${state.screens.length} screen(s) exported as "${configName}".`);
    } else {
      fallbackDownload(json, configName);
    }
  })
  .catch(() => fallbackDownload(json, configName));
}

function fallbackDownload(json, name = "mapping") {
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${name}.json (browser mode).`);
}

function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.style.cssText = [
      "position:fixed","bottom:16px","right:16px","background:#27ae60",
      "color:#fff","padding:8px 16px","border-radius:4px","font-size:12px",
      "z-index:9999","pointer-events:none","transition:opacity 0.4s",
    ].join(";");
    document.body.appendChild(toast);
  }
  toast.textContent  = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
}

// ============================================================
// UE → JS API  (called via ExecuteJavaScript from Blueprint)
// ============================================================

/**
 * Called by Unreal Blueprint to initialize the map.
 * @param {string} imageUrl    - file:// URL to the exported texture PNG
 * @param {number} mapWidth    - pixel map width in pixels
 * @param {number} mapHeight   - pixel map height in pixels
 */
window.initMap = function(imageUrl, mapWidth, mapHeight) {
  state.mapWidth    = mapWidth  || parseInt(document.getElementById("mapWidth").value,  10) || 3840;
  state.mapHeight   = mapHeight || parseInt(document.getElementById("mapHeight").value, 10) || 2160;
  state.mapImageUrl = imageUrl;

  document.getElementById("mapWidth").value  = state.mapWidth;
  document.getElementById("mapHeight").value = state.mapHeight;
  document.getElementById("canvasHint").style.display = "none";

  const img = new Image();
  img.onload = () => { state.mapImage = img; fitView(); };
  img.onerror = () => {
    console.warn("initMap: could not load image at", imageUrl);
    state.mapImage = null;
    fitView();
  };
  img.src = imageUrl;
};

/**
 * Load existing mapping data (e.g. from saved DataTable JSON).
 * @param {string} jsonString
 */
window.loadMapping = function(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    // Support both object format {"0": {...}} and legacy array format [{Name:"0",...}]
    const entries = Array.isArray(parsed)
      ? parsed.map(r => r)
      : Object.entries(parsed).map(([key, r]) => ({ ...r, _rowKey: key }));
    state.screens = [];
    for (const r of entries) {
      const s = {
        uid:   ++_uid,
        name:  r.ScreenName || r.Name || r._rowKey || "",
        index: r.ScreenIndex,
        x:     Math.round(r.UVOffsetX * state.mapWidth),
        y:     Math.round(r.UVOffsetY * state.mapHeight),
        w:     Math.round(r.UVScaleX  * state.mapWidth),
        h:     Math.round(r.UVScaleY  * state.mapHeight),
      };
      state.screens.push(s);
    }
    state.nextAutoIndex = Math.max(0, ...state.screens.map(s => s.index)) + 1;
    selectScreen(null);
    updateScreenList();
    render();
  } catch(e) {
    console.error("loadMapping: invalid JSON", e);
  }
};

// ============================================================
// INIT
// ============================================================
resizeCanvas();
fitView();

