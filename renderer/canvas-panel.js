const STYLES = `
#cs-sheet {
  position: fixed; bottom: 0; left: 0; right: 0; height: 90vh;
  background: rgba(0,0,0,0.92); border-top: 1px solid #2a2a3a;
  border-radius: 12px 12px 0 0; color: #ccc; font-family: monospace;
  font-size: 13px; z-index: 10; user-select: none;
  transform: translateY(calc(100% - 48px));
  transition: transform 0.3s ease; display: flex; flex-direction: column;
}
#cs-handle {
  width: 40px; height: 4px; border-radius: 2px; background: #444;
  margin: 10px auto 0; flex-shrink: 0; cursor: grab;
}
#cs-peek {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 16px 10px; flex-shrink: 0;
}
#cs-peek-name { font-size: 12px; color: #aaa; letter-spacing: 0.05em; }
#cs-peek-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
#cs-content { flex: 1; overflow-y: auto; padding: 0 16px 40vh; display: none; }
#cs-detail { margin-bottom: 12px; }
#cs-detail h2 { font-size: 14px; color: #fff; margin-bottom: 8px; }
.cs-field { display: flex; justify-content: space-between; padding: 3px 0;
  border-bottom: 1px solid #1a1a2a; font-size: 12px; }
.cs-field span:first-child { color: #888; }
#cs-list { list-style: none; padding: 12px 0 0; margin: 0; }
.cs-row-item { display: flex; align-items: center; gap: 8px; padding: 6px 0;
  cursor: pointer; border-bottom: 1px solid #111; }
.cs-row-item:hover { background: rgba(255,255,255,0.04); }
.cs-row-item.cs-active { color: #fff; box-shadow: inset 2px 0 0 #6ab0d4; padding-left: 6px; }
.cs-row-item.cs-moon { padding-left: 28px; font-size: 11px; color: #777; }
.cs-row-item.cs-moon.cs-active { color: #ccc; }
.cs-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
#cs-expand {
  position: fixed; bottom: 56px; right: 16px; z-index: 11;
  background: #1a1a2a; border: 1px solid #2a2a3a; color: #ccc;
  border-radius: 50%; width: 40px; height: 40px; font-size: 20px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-family: monospace; line-height: 1;
}
`;

const TYPE_HEX = {
  star:        "#fff5b0",
  rockyPlanet: "#c1693a",
  gasGiant:    "#d4874e",
  iceGiant:    "#6ab0d4",
  dwarfPlanet: "#7090b0",
  asteroid:    "#555555",
  moon:        "#aaaaaa",
  comet:       "#88aacc",
};

const STATE = { COLLAPSED: "collapsed", HALF: "half", FULL: "full" };
const STATE_TRANSFORM = {
  [STATE.COLLAPSED]: "translateY(calc(100% - 48px))",
  [STATE.HALF]:      "translateY(40%)",
  [STATE.FULL]:      "translateY(0)",
};

let sheetEl = null, styleEl = null, expandBtn = null;
let peekName, peekDot, contentEl, detailEl, listEl;
let currentState = STATE.COLLAPSED;
let activeRow = null;
let panelCallbacks = {};
let bodySelectedController = null;

function setState(state) {
  currentState = state;
  sheetEl.style.transform = STATE_TRANSFORM[state];
  contentEl.style.display = state === STATE.COLLAPSED ? "none" : "block";
}

function initDragHandle(handle) {
  let dragY = null;
  handle.addEventListener("touchstart", e => {
    dragY = e.touches[0].clientY;
    e.stopPropagation();
  }, { passive: true });
  handle.addEventListener("touchend", e => {
    if (dragY === null) return;
    const dy = e.changedTouches[0].clientY - dragY;
    dragY = null;
    if (dy < -30) {
      if (currentState === STATE.COLLAPSED) setState(STATE.HALF);
      else if (currentState === STATE.HALF) setState(STATE.FULL);
    } else if (dy > 30) {
      if (currentState === STATE.FULL) setState(STATE.HALF);
      else if (currentState === STATE.HALF) setState(STATE.COLLAPSED);
    }
    e.stopPropagation();
  }, { passive: true });
}

function buildList(seed, animObjects) {
  listEl.innerHTML = "";

  // Star row
  const starRow = makeListRow("star", `${seed.star.spectralType}-type Star`, false, "star");
  starRow.addEventListener("click", () => {
    setActiveRow(starRow);
    const starObj = animObjects.find(o => o.type === "star");
    panelCallbacks.onFocus(starObj);
    showDetail(starObj);
    setState(STATE.HALF);
  });
  listEl.appendChild(starRow);

  // Planets sorted by orbitRadius, each followed by their moons
  const sorted = [...seed.objects].sort((a, b) => a.orbitRadius - b.orbitRadius);
  for (const obj of sorted) {
    const planetAnimObj = animObjects.find(o => o.id === obj.id);
    const row = makeListRow(obj.type, obj.name, false, obj.id);
    row.addEventListener("click", () => {
      if (!planetAnimObj) return;
      setActiveRow(row);
      panelCallbacks.onFocus(planetAnimObj);
      showDetail(planetAnimObj);
      setState(STATE.HALF);
    });
    listEl.appendChild(row);

    for (const moon of (obj.moons ?? [])) {
      const moonAnimObj = animObjects.find(o => o.id === moon.id);
      const moonRow = makeListRow(moon.type, moon.name, true, moon.id);
      moonRow.addEventListener("click", () => {
        if (!moonAnimObj) return;
        setActiveRow(moonRow);
        panelCallbacks.onFocus(moonAnimObj);
        showDetail(moonAnimObj);
        setState(STATE.HALF);
      });
      listEl.appendChild(moonRow);
    }
  }
}

function makeListRow(type, name, isMoon, id) {
  const row = document.createElement("li");
  row.className = "cs-row-item" + (isMoon ? " cs-moon" : "");
  if (id) row.dataset.bodyId = id;
  const dot = document.createElement("span");
  dot.className = "cs-dot";
  dot.style.background = TYPE_HEX[type] ?? "#fff";
  const label = document.createElement("span");
  label.textContent = name;
  row.append(dot, label);
  return row;
}

function setActiveRow(row) {
  if (activeRow) activeRow.classList.remove("cs-active");
  activeRow = row;
  row.classList.add("cs-active");
}

function showDetail(obj) {
  if (!obj) return;
  detailEl.innerHTML = "";
  const h2 = document.createElement("h2");
  h2.textContent = obj.name;
  detailEl.appendChild(h2);

  const fields = obj.type === "star"
    ? [
        ["Type",           `${obj.data.spectralType}-type Star`],
        ["Luminosity",     `${obj.data.luminosity?.toFixed(2) ?? "—"} L☉`],
        ["Habitable zone", `${obj.data.habitableZoneAU?.toFixed(2) ?? "—"} AU`],
        ["Mass",           `${obj.data.mass?.toFixed(2) ?? "—"} M☉`],
        ["Radius",         `${obj.data.radius?.toFixed(2) ?? "—"} R☉`],
      ]
    : [
        ["Type",           obj.type],
        ["Radius",         obj.data.radius?.toFixed(2) ?? "—"],
        ["Mass",           obj.data.mass?.toFixed(2) ?? "—"],
        ["Orbit radius",   `${obj.data.orbitRadius?.toFixed(3) ?? "—"} AU`],
        ["Orbit period",   `${obj.data.orbitPeriod?.toFixed(1) ?? "—"} days`],
        ["Eccentricity",   obj.data.eccentricity?.toFixed(3) ?? "—"],
        ["Settlement cap", obj.data.settlementCap ?? "—"],
        ["Rotation",       `${obj.data.rotationPeriodDays?.toFixed(2) ?? "—"} days`],
        ["Tidal lock",     obj.data.tidallyLocked ? "Yes" : "No"],
      ];

  for (const [label, value] of fields) {
    const row = document.createElement("div");
    row.className = "cs-field";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("span");
    v.textContent = value;
    row.append(l, v);
    detailEl.appendChild(row);
  }
}

export function buildCanvasPanel(seed, animObjects, callbacks) {
  clearCanvasPanel();
  panelCallbacks = callbacks;

  styleEl = document.createElement("style");
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  sheetEl = document.createElement("div");
  sheetEl.id = "cs-sheet";

  // Handle
  const handle = document.createElement("div");
  handle.id = "cs-handle";
  initDragHandle(handle);

  // Peek bar
  const peek = document.createElement("div");
  peek.id = "cs-peek";
  peekDot = document.createElement("span");
  peekDot.id = "cs-peek-dot";
  peekDot.style.display = "none";
  peekName = document.createElement("span");
  peekName.id = "cs-peek-name";
  peekName.textContent = "Tap a body to inspect";
  peek.append(peekDot, peekName);

  // Content area
  contentEl = document.createElement("div");
  contentEl.id = "cs-content";

  // Detail section
  detailEl = document.createElement("div");
  detailEl.id = "cs-detail";

  listEl = document.createElement("ul");
  listEl.id = "cs-list";
  buildList(seed, animObjects);

  contentEl.append(detailEl, listEl);
  sheetEl.append(handle, peek, contentEl);
  document.body.appendChild(sheetEl);

  // Expand button
  expandBtn = document.createElement("button");
  expandBtn.id = "cs-expand";
  expandBtn.textContent = "⊕";
  expandBtn.title = "Expand panel";
  expandBtn.addEventListener("click", () => {
    setState(currentState === STATE.COLLAPSED ? STATE.HALF : STATE.COLLAPSED);
  });
  document.body.appendChild(expandBtn);

  // Listen for bodySelected from canvas-scene
  bodySelectedController = new AbortController();
  document.addEventListener("bodySelected", e => onBodySelected(e.detail), {
    signal: bodySelectedController.signal,
  });
}

export function clearCanvasPanel() {
  sheetEl?.remove();
  styleEl?.remove();
  expandBtn?.remove();
  sheetEl = styleEl = expandBtn = null;
  activeRow = null;
  currentState = STATE.COLLAPSED;
  bodySelectedController?.abort();
  bodySelectedController = null;
}

function onBodySelected(obj) {
  // Update peek bar
  peekDot.style.display = "inline-block";
  peekDot.style.background = TYPE_HEX[obj.type] ?? "#fff";
  peekName.textContent = obj.name;

  // Highlight the matching list row by id
  const row = listEl.querySelector(`[data-body-id="${obj.id}"]`);
  if (row) setActiveRow(row);

  showDetail(obj);
  setState(STATE.HALF);
}
