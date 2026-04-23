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
#cs-content { flex: 1; overflow-y: auto; padding: 0 16px 16px; display: none; }
#cs-detail { margin-bottom: 12px; }
#cs-detail h2 { font-size: 14px; color: #fff; margin-bottom: 8px; }
.cs-field { display: flex; justify-content: space-between; padding: 3px 0;
  border-bottom: 1px solid #1a1a2a; font-size: 12px; }
.cs-field span:first-child { color: #888; }
#cs-controls { display: flex; flex-direction: column; gap: 8px;
  padding: 10px 0 12px; border-bottom: 1px solid #2a2a3a; }
.cs-row { display: flex; align-items: center; gap: 8px; }
#cs-play { background: #1a1a2a; border: 1px solid #333; color: #ccc;
  cursor: pointer; border-radius: 3px; padding: 3px 10px;
  font-family: monospace; font-size: 13px; }
#cs-slider { flex: 1; accent-color: #6ab0d4; }
#cs-speed-val { color: #aaa; font-size: 11px; min-width: 42px; text-align: right; }
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
let peekName, peekDot, contentEl, detailEl, listEl, playBtn, slider, speedVal;
let currentState = STATE.COLLAPSED;
let activeRow = null;
let playing = true;
let panelCallbacks = {};

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

  // Speed controls
  const controls = document.createElement("div");
  controls.id = "cs-controls";
  const playRow = document.createElement("div");
  playRow.className = "cs-row";
  playBtn = document.createElement("button");
  playBtn.id = "cs-play";
  playBtn.textContent = "⏸";
  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "⏸" : "▶";
    playing ? callbacks.onResume() : callbacks.onPause();
  });
  playRow.append(playBtn);

  const speedRow = document.createElement("div");
  speedRow.className = "cs-row";
  const speedLabel = document.createElement("label");
  speedLabel.textContent = "Speed";
  speedLabel.style.cssText = "color:#888;font-size:11px";
  slider = document.createElement("input");
  slider.id = "cs-slider";
  slider.type = "range";
  slider.min = "0"; slider.max = "100"; slider.value = "1";
  speedVal = document.createElement("span");
  speedVal.id = "cs-speed-val";
  function applySpeed(v) {
    const ts = 0.1 * Math.pow(5000, v / 100);
    speedVal.textContent = ts < 10 ? `${ts.toFixed(1)}×` : `${Math.round(ts)}×`;
    callbacks.onTimeScale(ts);
  }
  applySpeed(1);
  slider.addEventListener("input", () => applySpeed(Number(slider.value)));
  speedRow.append(speedLabel, slider, speedVal);
  controls.append(playRow, speedRow);

  // Body list placeholder (populated in Task 8)
  listEl = document.createElement("ul");
  listEl.id = "cs-list";

  contentEl.append(detailEl, controls, listEl);
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
  document.addEventListener("bodySelected", e => {
    onBodySelected(e.detail);
  });
}

export function clearCanvasPanel() {
  sheetEl?.remove();
  styleEl?.remove();
  expandBtn?.remove();
  sheetEl = styleEl = expandBtn = null;
  activeRow = null;
  currentState = STATE.COLLAPSED;
  playing = true;
}

// onBodySelected stub — replaced in Task 8
function onBodySelected(obj) {
  peekDot.style.display = "inline-block";
  peekDot.style.background = TYPE_HEX[obj.type] ?? "#fff";
  peekName.textContent = obj.name;
  setState(STATE.HALF);
}
