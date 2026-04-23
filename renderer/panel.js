const STYLES = `
#system-panel {
  position: fixed; top: 64px; right: 16px; width: 260px;
  background: rgba(0,0,0,0.75); border: 1px solid #2a2a3a;
  border-radius: 4px; color: #ccc; font-family: monospace;
  font-size: 13px; z-index: 5; user-select: none;
}
.ph { display:flex; justify-content:space-between; align-items:center;
  padding:8px 12px; cursor:default; border-bottom:1px solid #2a2a3a; }
.ph span { font-size:11px; letter-spacing:1px; color:#aaa; }
.ph button { background:none; border:none; color:#888; cursor:pointer;
  font-size:16px; padding:0; line-height:1; }
.pc { padding:10px 12px; border-bottom:1px solid #1a1a2a;
  display:flex; flex-direction:column; gap:8px; }
.pc-row { display:flex; align-items:center; gap:8px; }
.pc button { background:#1a1a2a; border:1px solid #333; color:#ccc;
  cursor:pointer; border-radius:3px; padding:3px 10px;
  font-family:monospace; font-size:13px; }
.pc button:hover { border-color:#555; }
.pc input[type=range] { flex:1; accent-color:#6ab0d4; }
.pc label { color:#888; font-size:11px; white-space:nowrap; }
.po { max-height:60vh; overflow-y:auto; padding:4px 0; }
.pr { padding:5px 12px; cursor:pointer; display:flex; align-items:center;
  gap:8px; overflow:hidden; }
.pr:hover { background:rgba(255,255,255,0.05); }
.pr.active { color:#fff; box-shadow:inset 2px 0 0 #6ab0d4; }
.pm { padding-left:28px; font-size:11px; color:#777; }
.pm.active { color:#ccc; }
.dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
`;

const TYPE_HEX = {
  star: "#fff5b0",
  rockyPlanet: "#c1693a",
  gasGiant: "#d4874e",
  iceGiant: "#6ab0d4",
  dwarfPlanet: "#7090b0",
  asteroid: "#555555",
  moon: "#aaaaaa",
};

let panelEl = null;
let styleEl = null;
let activeRow = null;

export function buildPanel(seed, animObjects, callbacks) {
  // callbacks: { onFocus(animObj|null), onPause(), onResume(), onTimeScale(ts) }
  clearPanel();

  styleEl = document.createElement("style");
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  panelEl = document.createElement("div");
  panelEl.id = "system-panel";

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "ph";
  const title = document.createElement("span");
  title.textContent = `SEED ${seed.seed}`;
  const chevron = document.createElement("button");
  chevron.textContent = "▾";
  chevron.title = "Minimize";
  header.append(title, chevron);

  const body = document.createElement("div");
  body.className = "pb";

  chevron.addEventListener("click", () => {
    const collapsed = body.style.display === "none";
    body.style.display = collapsed ? "" : "none";
    chevron.textContent = collapsed ? "▾" : "▸";
  });

  // ── Controls ─────────────────────────────────────────────────────────────────
  const ctrl = document.createElement("div");
  ctrl.className = "pc";

  const playRow = document.createElement("div");
  playRow.className = "pc-row";
  const playBtn = document.createElement("button");
  playBtn.textContent = "⏸";
  let playing = true;
  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "⏸" : "▶";
    playing ? callbacks.onResume() : callbacks.onPause();
  });
  playRow.append(playBtn);

  ctrl.append(playRow);

  // ── Object list ───────────────────────────────────────────────────────────────
  const list = document.createElement("div");
  list.className = "po";

  // Star row (static — passes null to onFocus)
  const starRow = makeRow("star", `${seed.star.spectralType}-type Star`, false);
  starRow.addEventListener("click", () => {
    setActive(starRow);
    callbacks.onFocus(null);
  });
  list.append(starRow);

  // Planets sorted by orbitRadius, each followed by their moons
  const sorted = [...seed.objects].sort((a, b) =>
    a.orbitRadius - b.orbitRadius
  );
  for (const obj of sorted) {
    const animObj = animObjects.find((a) => a.mesh.userData.id === obj.id);
    const row = makeRow(obj.type, obj.name, false);
    row.addEventListener("click", () => {
      setActive(row);
      callbacks.onFocus(animObj);
    });
    list.append(row);

    for (const moon of (obj.moons ?? [])) {
      const moonAnimObj = animObjects.find((a) =>
        a.mesh.userData.id === moon.id
      );
      const moonRow = makeRow(moon.type, moon.name, true);
      moonRow.addEventListener("click", () => {
        setActive(moonRow);
        callbacks.onFocus(moonAnimObj);
      });
      list.append(moonRow);
    }
  }

  body.append(ctrl, list);
  panelEl.append(header, body);
  document.body.appendChild(panelEl);
}

function makeRow(type, name, isMoon) {
  const row = document.createElement("div");
  row.className = "pr" + (isMoon ? " pm" : "");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = TYPE_HEX[type] ?? "#fff";
  const label = document.createElement("span");
  label.textContent = name;
  row.append(dot, label);
  return row;
}

function setActive(row) {
  if (activeRow) activeRow.classList.remove("active");
  activeRow = row;
  row.classList.add("active");
}

export function clearActive() {
  if (activeRow) activeRow.classList.remove("active");
  activeRow = null;
}

export function clearPanel() {
  panelEl?.remove();
  styleEl?.remove();
  panelEl = null;
  styleEl = null;
  activeRow = null;
}
