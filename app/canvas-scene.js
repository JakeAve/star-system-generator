import { buildPanel } from "./panel.js";
import { buildPlaybackWidget } from "./playback-widget.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const AU_SCALE = 100;
const MOON_ORBIT_SCALE = 1;
const BODY_SCALE = 0.025;
const MIN_VIS_R = 0.015;       // world units
const SOLAR_TO_EARTH_RADII = 109;
const FLY_DURATION = 1.5;      // seconds

const TYPE_COLORS = {
  star:        "#fff5b0",
  rockyPlanet: "#c1693a",
  gasGiant:    "#d4874e",
  iceGiant:    "#6ab0d4",
  dwarfPlanet: "#7090b0",
  asteroid:    "#555555",
  moon:        "#aaaaaa",
  comet:       "#88aacc",
};

const TYPE_BORDERS = {
  star:        "#ccc380",
  rockyPlanet: "#8a4020",
  gasGiant:    "#a05828",
  iceGiant:    "#3a7090",
  dwarfPlanet: "#405070",
  asteroid:    "#333333",
  moon:        "#777777",
  comet:       "#557799",
};

const SPECTRAL_STAR_COLOR = {
  O: "#9bb0ff", B: "#aabfff", A: "#cad7ff",
  F: "#f8f7ff", G: "#fff5b0", K: "#ffcc6f", M: "#ff6633",
};
// ─────────────────────────────────────────────────────────────────────────────

const canvas = document.createElement("canvas");
canvas.width  = innerWidth;
canvas.height = innerHeight;
document.body.appendChild(canvas);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

globalThis.addEventListener("resize", () => {
  canvas.width  = innerWidth;
  canvas.height = innerHeight;
  ctx.imageSmoothingEnabled = false;
  if (currentSeed) starfield = buildStarfield(currentSeed.seed, canvas.width, canvas.height);
});

// ─── Camera state ─────────────────────────────────────────────────────────────
// cam.x/y = world coords at screen center; cam.scale = px per world unit
let cam = { x: 0, y: 0, scale: 1 };

// ─── Scene state ─────────────────────────────────────────────────────────────
let animObjects    = [];  // flat array, star first, then planets, then moons
let animObjectsById = {}; // id → animObj
let starfield      = [];  // [{ x, y }] in screen space (static)
let selectedId     = null;
let elapsedDays    = 0;
let lastTime       = null;
let paused         = false;
let timeScale      = 1;
let flyState       = null; // { startX, startY, startScale, target, targetScale, progress }
let lockedTarget   = null; // animObj that camera follows after fly completes
let rafId          = null;
let currentSeed    = null;

// ─── Input state ──────────────────────────────────────────────────────────────
let dragStart      = null;
let camAtDrag      = null;
let touchCache     = {};     // identifier → { x, y }
let pinchStartDist = null;
let pinchStartScale = null;
let pinchMidWorld  = null;   // world point under pinch midpoint at start

function screenToWorld(sx, sy) {
  return {
    x: (sx - canvas.width / 2) / cam.scale + cam.x,
    y: (sy - canvas.height / 2) / cam.scale + cam.y,
  };
}

function handleTap(screenX, screenY) {
  const { x: wx, y: wy } = screenToWorld(screenX, screenY);
  const MIN_HIT = 20 / cam.scale;
  let best = null, bestDist = Infinity;
  for (const obj of animObjects) {
    const d = Math.hypot(obj.worldX - wx, obj.worldY - wy);
    const hitR = Math.max(MIN_HIT, obj.visualR);
    if (d < hitR && d < bestDist) { best = obj; bestDist = d; }
  }
  if (best) selectBody(best.id);
}

canvas.addEventListener("mousedown", e => {
  dragStart = { x: e.clientX, y: e.clientY };
  camAtDrag = { x: cam.x, y: cam.y };
  lockedTarget = null;
});
canvas.addEventListener("mousemove", e => {
  if (!dragStart) return;
  cam.x = camAtDrag.x - (e.clientX - dragStart.x) / cam.scale;
  cam.y = camAtDrag.y - (e.clientY - dragStart.y) / cam.scale;
});
canvas.addEventListener("mouseup", e => {
  if (dragStart &&
      Math.abs(e.clientX - dragStart.x) < 4 &&
      Math.abs(e.clientY - dragStart.y) < 4) {
    handleTap(e.clientX, e.clientY);
  }
  dragStart = null;
});
canvas.addEventListener("mouseleave", () => { dragStart = null; });
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  lockedTarget = null;
  const factor = e.deltaY < 0 ? 1.1 : 0.909;
  const before = screenToWorld(e.clientX, e.clientY);
  cam.scale = Math.max(0.01, Math.min(500, cam.scale * factor));
  const after = screenToWorld(e.clientX, e.clientY);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
}, { passive: false });

canvas.addEventListener("touchstart", e => {
  e.preventDefault();
  lockedTarget = null;
  for (const t of e.changedTouches) {
    touchCache[t.identifier] = { x: t.clientX, y: t.clientY };
  }
  const pts = Object.values(touchCache);
  if (pts.length === 2) {
    pinchStartDist  = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    pinchStartScale = cam.scale;
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    pinchMidWorld = screenToWorld(mx, my);
    dragStart = null;
  } else if (pts.length === 1) {
    dragStart = { x: pts[0].x, y: pts[0].y };
    camAtDrag = { x: cam.x, y: cam.y };
  }
}, { passive: false });

canvas.addEventListener("touchmove", e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    touchCache[t.identifier] = { x: t.clientX, y: t.clientY };
  }
  const pts = Object.values(touchCache);
  if (pts.length === 2 && pinchStartDist !== null) {
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    cam.scale = Math.max(0.01, Math.min(500, pinchStartScale * dist / pinchStartDist));
    // Keep pinch midpoint fixed in world space
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    const after = screenToWorld(mx, my);
    cam.x += pinchMidWorld.x - after.x;
    cam.y += pinchMidWorld.y - after.y;
  } else if (pts.length === 1 && dragStart) {
    cam.x = camAtDrag.x - (pts[0].x - dragStart.x) / cam.scale;
    cam.y = camAtDrag.y - (pts[0].y - dragStart.y) / cam.scale;
  }
}, { passive: false });

canvas.addEventListener("touchend", e => {
  const wasSingle = Object.keys(touchCache).length === 1;
  for (const t of e.changedTouches) delete touchCache[t.identifier];
  pinchStartDist = null;
  if (wasSingle && e.changedTouches.length === 1) {
    const t = e.changedTouches[0];
    if (dragStart &&
        Math.abs(t.clientX - dragStart.x) < 10 &&
        Math.abs(t.clientY - dragStart.y) < 10) {
      handleTap(t.clientX, t.clientY);
    }
  }
  if (Object.keys(touchCache).length === 0) dragStart = null;
});

canvas.addEventListener("touchcancel", e => {
  for (const t of e.changedTouches) delete touchCache[t.identifier];
  pinchStartDist = null;
  dragStart = null;
});

function visualRadius(r) {
  return Math.max(MIN_VIS_R, Math.log1p(r) * BODY_SCALE);
}

function orbitParams(orbitRadius, eccentricity, isMoon) {
  const scale = isMoon ? AU_SCALE * MOON_ORBIT_SCALE : AU_SCALE;
  const a = orbitRadius * scale;
  const e = Math.min(eccentricity ?? 0, 0.999);
  const b = a * Math.sqrt(1 - e * e);
  const c = a * e;
  return { a, b, c };
}

function orbitPosition(a, b, c, angle) {
  return { x: c + a * Math.cos(angle), y: b * Math.sin(angle) };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Mulberry32 PRNG — seeded so starfield is stable across frames
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildStarfield(systemSeed, w, h) {
  const rand = mulberry32(systemSeed);
  const dots = [];
  for (let i = 0; i < 250; i++) {
    dots.push({ x: Math.floor(rand() * w), y: Math.floor(rand() * h) });
  }
  return dots;
}

function applyTransform() {
  ctx.setTransform(
    cam.scale, 0, 0, cam.scale,
    canvas.width / 2 - cam.x * cam.scale,
    canvas.height / 2 - cam.y * cam.scale,
  );
}

function drawStarfield() {
  // Draw in screen space (reset transform first)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff44";
  for (const dot of starfield) {
    ctx.fillRect(dot.x, dot.y, 1, 1);
  }
}

function drawOrbits() {
  ctx.lineWidth = 1 / cam.scale;
  for (const obj of animObjects) {
    if (obj.type === "star") continue;
    const isMoon = obj.parentId !== null;
    const parent = isMoon ? animObjectsById[obj.parentId] : null;
    const px = parent ? parent.worldX : 0;
    const py = parent ? parent.worldY : 0;

    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath();
    ctx.ellipse(obj.c, 0, obj.a, obj.b, 0, 0, Math.PI * 2);
    ctx.strokeStyle = isMoon ? "#0a2a2a" : "#1a3a6a";
    ctx.stroke();
    ctx.restore();
  }
}

function drawBodies() {
  for (const obj of animObjects) {
    const r = Math.max(2 / cam.scale, obj.visualR);
    const isSelected = obj.id === selectedId;

    ctx.save();
    ctx.translate(obj.worldX, obj.worldY);

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 3 / cam.scale, 0, Math.PI * 2);
      ctx.strokeStyle = "#6ab0d4";
      ctx.lineWidth = 1.5 / cam.scale;
      ctx.stroke();
    }

    // Body fill
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = obj.type === "star"
      ? (SPECTRAL_STAR_COLOR[obj.data.spectralType] ?? "#fff5b0")
      : (TYPE_COLORS[obj.type] ?? "#ffffff");
    ctx.fill();

    // 1px border
    ctx.strokeStyle = TYPE_BORDERS[obj.type] ?? "#888";
    ctx.lineWidth = 1 / cam.scale;
    ctx.stroke();

    ctx.restore();
  }
}

function buildAnimObjects(seed) {
  const objs = [];

  // Star (fixed at world origin)
  objs.push({
    id: "star",
    name: `${seed.star.spectralType}-type Star`,
    type: "star",
    data: seed.star,
    worldX: 0, worldY: 0,
    visualR: visualRadius(seed.star.radius * SOLAR_TO_EARTH_RADII),
    a: 0, b: 0, c: 0, initialAngle: 0, orbitPeriod: 1, parentId: null,
  });

  // Planets (sorted ascending by orbitRadius) then each planet's moons
  const sorted = [...seed.objects].sort((a, b) => a.orbitRadius - b.orbitRadius);
  for (const obj of sorted) {
    const { a, b, c } = orbitParams(obj.orbitRadius, obj.eccentricity, false);
    objs.push({
      id: obj.id, name: obj.name, type: obj.type, data: obj,
      a, b, c,
      initialAngle: (obj.orbitalPhase ?? 0) * Math.PI * 2,
      orbitPeriod: obj.orbitPeriod || 1,
      parentId: null,
      worldX: 0, worldY: 0,
      visualR: visualRadius(obj.radius),
    });
    for (const moon of (obj.moons ?? [])) {
      const mp = orbitParams(moon.orbitRadius, moon.eccentricity, true);
      objs.push({
        id: moon.id, name: moon.name, type: moon.type, data: moon,
        a: mp.a, b: mp.b, c: mp.c,
        initialAngle: (moon.orbitalPhase ?? 0) * Math.PI * 2,
        orbitPeriod: moon.orbitPeriod || 1,
        parentId: obj.id,
        worldX: 0, worldY: 0,
        visualR: visualRadius(moon.radius),
      });
    }
  }
  return objs;
}

function updatePositions() {
  for (const obj of animObjects) {
    if (obj.type === "star") continue;
    const angle = obj.initialAngle + (2 * Math.PI / obj.orbitPeriod) * elapsedDays;
    const pos = orbitPosition(obj.a, obj.b, obj.c, angle);
    if (obj.parentId === null) {
      obj.worldX = pos.x;
      obj.worldY = pos.y;
    } else {
      const parent = animObjectsById[obj.parentId];
      obj.worldX = parent.worldX + pos.x;
      obj.worldY = parent.worldY + pos.y;
    }
  }
}

function animate(time) {
  rafId = requestAnimationFrame(animate);
  if (lastTime === null) { lastTime = time; return; }
  const delta = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  if (!paused) elapsedDays += delta * timeScale;

  // Fly-to camera lerp — update positions first so live target is current
  updatePositions();

  if (flyState !== null) {
    flyState.progress = Math.min(flyState.progress + delta / FLY_DURATION, 1);
    const t = easeInOutCubic(flyState.progress);
    const tx = flyState.target.worldX;
    const ty = flyState.target.worldY;
    cam.x = flyState.startX + (tx - flyState.startX) * t;
    cam.y = flyState.startY + (ty - flyState.startY) * t;
    if (flyState.targetScale !== null) {
      const ls = Math.log(flyState.startScale);
      const lt = Math.log(flyState.targetScale);
      cam.scale = Math.exp(ls + (lt - ls) * t);
    }
    if (flyState.progress >= 1) {
      lockedTarget = flyState.target;
      flyState = null;
    }
  } else if (lockedTarget !== null) {
    cam.x = lockedTarget.worldX;
    cam.y = lockedTarget.worldY;
  }

  drawStarfield();
  applyTransform();
  drawOrbits();
  drawBodies();
}

function clearScene() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  animObjects = [];
  animObjectsById = {};
  starfield = [];
  selectedId = null;
  elapsedDays = 0;
  lastTime = null;
  paused = false;
  timeScale = 1;
  flyState = null;
  lockedTarget = null;
  dragStart = null;
  camAtDrag = null;
  touchCache = {};
  pinchStartDist = null;
  pinchStartScale = null;
  pinchMidWorld = null;
}

export function buildSystem(seed) {
  if (!seed) {
    clearScene();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#666";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("No system loaded — generate one first", canvas.width / 2, canvas.height / 2);
    const link = document.createElement("a");
    link.href = "/";
    link.textContent = "← Generate";
    link.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,40px);color:#6ab0d4;font-family:monospace;font-size:13px";
    document.body.appendChild(link);
    return;
  }

  clearScene();
  currentSeed = seed;
  animObjects = buildAnimObjects(seed);
  animObjectsById = Object.fromEntries(animObjects.map(o => [o.id, o]));
  starfield = buildStarfield(seed.seed, canvas.width, canvas.height);

  // Fit all planet orbits in view
  const maxR = Math.max(
    1,
    ...animObjects
      .filter(o => o.parentId === null && o.type !== "star")
      .map(o => o.a + Math.abs(o.c)),
  );
  cam.x = 0;
  cam.y = 0;
  cam.scale = Math.min(canvas.width, canvas.height) / 2 / maxR * 0.8;

  buildPanel(seed, animObjects, {
    onFocus: obj => { if (obj) selectBody(obj.id); },
    onFlyTo: obj => { if (obj) flyToBody(obj.id); },
  });
  buildPlaybackWidget({
    onTimeScale: ts => { timeScale = ts; },
    onPause:     () => { paused = true; },
    onResume:    () => { paused = false; },
  });

  rafId = requestAnimationFrame(animate);
}

export function selectBody(id) {
  selectedId = id;
  const obj = animObjectsById[id];
  if (!obj) return;
  flyState = {
    startX: cam.x, startY: cam.y, startScale: cam.scale,
    target: obj, targetScale: null,
    progress: 0,
  };
  canvas.dispatchEvent(new CustomEvent("bodySelected", {
    detail: obj,
    bubbles: true,
  }));
}

export function flyToBody(id) {
  selectedId = id;
  const obj = animObjectsById[id];
  if (!obj) return;
  const minDim = Math.min(canvas.width, canvas.height);
  const targetScale = Math.max(
    0.01,
    Math.min(500, (minDim * 0.2) / Math.max(obj.visualR, 1e-6)),
  );
  flyState = {
    startX: cam.x, startY: cam.y, startScale: cam.scale,
    target: obj, targetScale,
    progress: 0,
  };
  canvas.dispatchEvent(new CustomEvent("bodySelected", {
    detail: obj,
    bubbles: true,
  }));
}
