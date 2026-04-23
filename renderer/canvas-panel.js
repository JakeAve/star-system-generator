const STYLES = `
#cs-sheet {
  position: fixed; bottom: 0; left: 0; right: 0; height: 90vh;
  background: rgba(0,0,0,0.92); border-top: 1px solid #2a2a3a;
  border-radius: 12px 12px 0 0; color: #ccc; font-family: monospace;
  font-size: 13px; z-index: 10; user-select: none;
  display: flex; flex-direction: column;
  transform: translateY(100%);
}
#cs-header {
  flex-shrink: 0; cursor: grab; touch-action: none;
  padding: 10px 16px 10px;
}
#cs-header:active { cursor: grabbing; }
#cs-header * { pointer-events: none; }
#cs-handle-bar {
  width: 40px; height: 4px; border-radius: 2px; background: #444;
  margin: 0 auto 10px;
}
#cs-peek {
  display: flex; align-items: center; gap: 8px;
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

const PEEK_PX = 48;                  // visible height when collapsed
const OPEN_FRACTION_ON_CLICK = 0.6;  // how much of the sheet opens on click (60%)
const CLICK_SLOP_PX = 5;             // drag distance under which release is a click
const TRANSITION = "transform 0.3s ease";

let sheetEl = null, styleEl = null;
let peekName, peekDot, contentEl, detailEl, listEl;
let activeRow = null;
let panelCallbacks = {};
let bodySelectedController = null;
let currentOffset = 0;               // translateY px: 0 = fully open, max = collapsed

function sheetHeight() {
  return sheetEl.getBoundingClientRect().height;
}
function collapsedOffset() {
  return Math.max(0, sheetHeight() - PEEK_PX);
}
function openOffset() {
  return sheetHeight() * (1 - OPEN_FRACTION_ON_CLICK);
}

function setOffset(offset, animate = true) {
  const max = collapsedOffset();
  currentOffset = Math.max(0, Math.min(max, offset));
  sheetEl.style.transition = animate ? TRANSITION : "none";
  sheetEl.style.transform = `translateY(${currentOffset}px)`;
  contentEl.style.display = currentOffset < max - 10 ? "block" : "none";
}

function toggle() {
  const max = collapsedOffset();
  setOffset(currentOffset >= max - 5 ? openOffset() : max);
}

function initHandle(handle) {
  let startY = null;
  let startOffset = 0;
  let moved = false;

  handle.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    startOffset = currentOffset;
    moved = false;
    handle.setPointerCapture(e.pointerId);
    sheetEl.style.transition = "none";
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > CLICK_SLOP_PX) moved = true;
    setOffset(startOffset + dy, false);
  });

  const finish = (e) => {
    if (startY === null) return;
    const wasClick = !moved;
    startY = null;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    if (wasClick) toggle();
    else sheetEl.style.transition = TRANSITION;
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}

function buildList(seed, animObjects) {
  listEl.innerHTML = "";

  const starRow = makeListRow("star", `${seed.star.spectralType}-type Star`, false, "star");
  starRow.addEventListener("click", () => {
    setActiveRow(starRow);
    const starObj = animObjects.find(o => o.type === "star");
    panelCallbacks.onFocus(starObj);
    showDetail(starObj);
  });
  listEl.appendChild(starRow);

  const sorted = [...seed.objects].sort((a, b) => a.orbitRadius - b.orbitRadius);
  for (const obj of sorted) {
    const planetAnimObj = animObjects.find(o => o.id === obj.id);
    const row = makeListRow(obj.type, obj.name, false, obj.id);
    row.addEventListener("click", () => {
      if (!planetAnimObj) return;
      setActiveRow(row);
      panelCallbacks.onFocus(planetAnimObj);
      showDetail(planetAnimObj);
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

  const header = document.createElement("div");
  header.id = "cs-header";
  const handleBar = document.createElement("div");
  handleBar.id = "cs-handle-bar";

  const peek = document.createElement("div");
  peek.id = "cs-peek";
  peekDot = document.createElement("span");
  peekDot.id = "cs-peek-dot";
  peekDot.style.display = "none";
  peekName = document.createElement("span");
  peekName.id = "cs-peek-name";
  peekName.textContent = "Tap a body to inspect";
  peek.append(peekDot, peekName);

  header.append(handleBar, peek);
  initHandle(header);

  contentEl = document.createElement("div");
  contentEl.id = "cs-content";

  detailEl = document.createElement("div");
  detailEl.id = "cs-detail";

  listEl = document.createElement("ul");
  listEl.id = "cs-list";
  buildList(seed, animObjects);

  contentEl.append(detailEl, listEl);
  sheetEl.append(header, contentEl);
  document.body.appendChild(sheetEl);

  // Start collapsed; use rAF so the sheet height is measurable.
  requestAnimationFrame(() => setOffset(collapsedOffset(), false));

  bodySelectedController = new AbortController();
  document.addEventListener("bodySelected", e => onBodySelected(e.detail), {
    signal: bodySelectedController.signal,
  });
}

export function clearCanvasPanel() {
  sheetEl?.remove();
  styleEl?.remove();
  sheetEl = styleEl = null;
  activeRow = null;
  currentOffset = 0;
  bodySelectedController?.abort();
  bodySelectedController = null;
}

function onBodySelected(obj) {
  peekDot.style.display = "inline-block";
  peekDot.style.background = TYPE_HEX[obj.type] ?? "#fff";
  peekName.textContent = obj.name;

  const row = listEl.querySelector(`[data-body-id="${obj.id}"]`);
  if (row) setActiveRow(row);

  showDetail(obj);
}
