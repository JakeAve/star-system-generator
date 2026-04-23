import { buildCanvasPanel } from "./canvas-panel.js";

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
let flyState       = null; // { startX, startY, targetX, targetY, progress }
let rafId          = null;
let currentSeed    = null;

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

  // Fly-to camera lerp
  if (flyState !== null) {
    flyState.progress = Math.min(flyState.progress + delta / FLY_DURATION, 1);
    const t = easeInOutCubic(flyState.progress);
    cam.x = flyState.startX + (flyState.targetX - flyState.startX) * t;
    cam.y = flyState.startY + (flyState.targetY - flyState.startY) * t;
    if (flyState.progress >= 1) flyState = null;
  }

  updatePositions();
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

  buildCanvasPanel(seed, animObjects, {
    onFocus: obj => { if (obj) selectBody(obj.id); },
    onPause:     () => { paused = true; },
    onResume:    () => { paused = false; },
    onTimeScale: ts => { timeScale = ts; },
  });

  rafId = requestAnimationFrame(animate);
}

export function selectBody(id) {
  selectedId = id;
}
