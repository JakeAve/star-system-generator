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

export function buildSystem(seed) {
  // stub — expanded in Task 5
  currentSeed = seed;
}
