const STYLES = `
#cs-sheet {
  position: fixed; bottom: 0; left: 0; right: 0; height: 0;
  max-height: 100vh;
  background: rgba(0,0,0,0.92); border-top: 1px solid #2a2a3a;
  border-radius: 12px 12px 0 0; color: #ccc; font-family: monospace;
  font-size: 13px; z-index: 10; user-select: none;
  display: flex; flex-direction: column;
}
#cs-content {
  flex: 1 1 0; min-height: 0; overflow-y: auto;
  padding: 0 16px 24px;
}
#cs-detail {
  position: sticky; top: 0; z-index: 1;
  background: rgba(0,0,0,0.92);
  padding-bottom: 12px;
  margin: 0 -16px 4px;
  padding-left: 16px; padding-right: 16px;
  border-bottom: 1px solid #1a1a2a;
  transition: padding 0.2s ease;
}
#cs-handle {
  cursor: grab; touch-action: none;
  padding: 10px 0 8px;
  display: flex; justify-content: center;
}
#cs-handle:active { cursor: grabbing; }
#cs-handle::before {
  content: ""; width: 40px; height: 4px; border-radius: 2px; background: #444;
  pointer-events: none;
}
#cs-detail-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 8px;
  transition: margin-bottom 0.2s ease;
}
#cs-detail-head-left {
  display: flex; align-items: center; gap: 8px;
  min-width: 0; flex: 1 1 auto;
}
#cs-detail-head h2 {
  font-size: 14px; color: #fff; margin: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: font-size 0.2s ease;
}
#cs-detail-head h2.placeholder { color: #888; font-weight: normal; font-size: 12px; letter-spacing: 0.05em; }
#cs-flyto {
  flex-shrink: 0;
  background: #1a1a2a; border: 1px solid #333; color: #ccc;
  cursor: pointer; border-radius: 3px; padding: 4px 12px;
  font-family: monospace; font-size: 12px; letter-spacing: 0.05em;
}
#cs-flyto:hover { border-color: #6ab0d4; color: #fff; }
#cs-detail.cs-detail-compact { padding-bottom: 6px; }
#cs-detail.cs-detail-compact #cs-detail-head { margin-bottom: 0; }
#cs-detail.cs-detail-compact #cs-detail-head h2 { font-size: 12px; }
#cs-detail.cs-detail-compact .cs-field { display: none; }
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

@media (min-width: 900px) {
  #cs-sheet {
    top: 64px; right: 16px; bottom: 16px; left: auto;
    width: 320px; height: auto !important; max-height: none;
    border: 1px solid #2a2a3a; border-radius: 8px;
  }
  #cs-handle { display: none; }
  #cs-content { padding-top: 14px; }
  #cs-detail { top: -14px; }
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

const SPECTRAL_STAR_COLOR = {
  O: "#9bb0ff", B: "#aabfff", A: "#cad7ff",
  F: "#f8f7ff", G: "#fff5b0", K: "#ffcc6f", M: "#ff6633",
};

function colorFor(obj) {
  if (obj?.type === "star") {
    return SPECTRAL_STAR_COLOR[obj.data?.spectralType] ?? TYPE_HEX.star;
  }
  return TYPE_HEX[obj?.type] ?? "#fff";
}

const PEEK_PX = 48;
const OPEN_FRACTION_ON_CLICK = 0.6;
const CLICK_SLOP_PX = 5;
const TRANSITION = "height 0.3s ease";

let sheetEl = null, styleEl = null;
let contentEl, detailEl, listEl;
let activeRow = null;
let panelCallbacks = {};
let bodySelectedController = null;
let currentHeight = PEEK_PX;

function isDesktop() {
  return window.matchMedia("(min-width: 900px)").matches;
}
function maxHeightPx() {
  return window.innerHeight;
}
function openHeight() {
  return maxHeightPx() * OPEN_FRACTION_ON_CLICK;
}

function setHeight(h, animate = true) {
  if (isDesktop()) {
    sheetEl.style.transition = "";
    sheetEl.style.height = "";
    return;
  }
  currentHeight = Math.max(PEEK_PX, Math.min(maxHeightPx(), h));
  sheetEl.style.transition = animate ? TRANSITION : "none";
  sheetEl.style.height = `${currentHeight}px`;
}

function toggle() {
  if (isDesktop()) return;
  setHeight(currentHeight <= PEEK_PX + 5 ? openHeight() : PEEK_PX);
}

function initHandle(handle) {
  let startY = null;
  let startHeight = 0;
  let moved = false;

  handle.addEventListener("pointerdown", (e) => {
    if (isDesktop()) return;
    startY = e.clientY;
    startHeight = currentHeight;
    moved = false;
    handle.setPointerCapture(e.pointerId);
    sheetEl.style.transition = "none";
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > CLICK_SLOP_PX) moved = true;
    setHeight(startHeight - dy, false);
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

  const starColor = SPECTRAL_STAR_COLOR[seed.star.spectralType] ?? TYPE_HEX.star;
  const starRow = makeListRow("star", `${seed.star.spectralType}-type Star`, false, "star", starColor);
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

function makeListRow(type, name, isMoon, id, color) {
  const row = document.createElement("li");
  row.className = "cs-row-item" + (isMoon ? " cs-moon" : "");
  if (id) row.dataset.bodyId = id;
  const dot = document.createElement("span");
  dot.className = "cs-dot";
  dot.style.background = color ?? TYPE_HEX[type] ?? "#fff";
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

function renderDetailPlaceholder() {
  // Clear everything except the drag handle.
  for (const child of [...detailEl.children]) {
    if (child.id !== "cs-handle") child.remove();
  }
  const head = document.createElement("div");
  head.id = "cs-detail-head";
  const left = document.createElement("div");
  left.id = "cs-detail-head-left";
  const h2 = document.createElement("h2");
  h2.className = "placeholder";
  h2.textContent = "Tap a body to inspect";
  left.append(h2);
  head.appendChild(left);
  detailEl.appendChild(head);
}

function showDetail(obj) {
  if (!obj) return;
  for (const child of [...detailEl.children]) {
    if (child.id !== "cs-handle") child.remove();
  }

  const head = document.createElement("div");
  head.id = "cs-detail-head";

  const left = document.createElement("div");
  left.id = "cs-detail-head-left";
  const dot = document.createElement("span");
  dot.className = "cs-dot";
  dot.style.background = colorFor(obj);
  const h2 = document.createElement("h2");
  h2.textContent = obj.name;
  left.append(dot, h2);

  const flyBtn = document.createElement("button");
  flyBtn.id = "cs-flyto";
  flyBtn.textContent = "→ Fly to";
  flyBtn.addEventListener("click", () => {
    panelCallbacks.onFlyTo?.(obj);
  });

  head.append(left, flyBtn);
  detailEl.appendChild(head);

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

  contentEl = document.createElement("div");
  contentEl.id = "cs-content";

  detailEl = document.createElement("div");
  detailEl.id = "cs-detail";

  const handle = document.createElement("div");
  handle.id = "cs-handle";
  initHandle(handle);
  detailEl.appendChild(handle);

  renderDetailPlaceholder();

  listEl = document.createElement("ul");
  listEl.id = "cs-list";
  buildList(seed, animObjects);

  contentEl.append(detailEl, listEl);
  contentEl.addEventListener("scroll", () => {
    detailEl.classList.toggle("cs-detail-compact", contentEl.scrollTop > 20);
  });
  sheetEl.append(contentEl);
  document.body.appendChild(sheetEl);

  setHeight(PEEK_PX, false);

  bodySelectedController = new AbortController();
  document.addEventListener("bodySelected", e => onBodySelected(e.detail), {
    signal: bodySelectedController.signal,
  });
  window.matchMedia("(min-width: 900px)").addEventListener("change", () => {
    setHeight(currentHeight, false);
  }, { signal: bodySelectedController.signal });
}

export function clearCanvasPanel() {
  sheetEl?.remove();
  styleEl?.remove();
  sheetEl = styleEl = null;
  activeRow = null;
  currentHeight = PEEK_PX;
  bodySelectedController?.abort();
  bodySelectedController = null;
}

function onBodySelected(obj) {
  const row = listEl.querySelector(`[data-body-id="${obj.id}"]`);
  if (row) setActiveRow(row);
  showDetail(obj);
}
