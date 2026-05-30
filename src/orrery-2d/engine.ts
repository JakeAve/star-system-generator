import type { SolarSystem } from "../core/types.ts";
import {
  angleAtTime,
  orbitParams,
  orbitPosition,
  SOLAR_TO_EARTH_RADII,
  visualRadius,
} from "../core/kinematics.ts";

const FLY_DURATION = 1.5;

const TYPE_COLORS: Record<string, string> = {
  star: "#fff5b0", rockyPlanet: "#c1693a", gasGiant: "#d4874e", iceGiant: "#6ab0d4",
  dwarfPlanet: "#7090b0", asteroid: "#555555", moon: "#aaaaaa", comet: "#88aacc",
};
const TYPE_BORDERS: Record<string, string> = {
  star: "#ccc380", rockyPlanet: "#8a4020", gasGiant: "#a05828", iceGiant: "#3a7090",
  dwarfPlanet: "#405070", asteroid: "#333333", moon: "#777777", comet: "#557799",
};
const SPECTRAL_STAR_COLOR: Record<string, string> = {
  O: "#9bb0ff", B: "#aabfff", A: "#cad7ff", F: "#f8f7ff", G: "#fff5b0", K: "#ffcc6f", M: "#ff6633",
};

export interface CanvasOrreryOptions {
  onPick?: (id: string) => void;
}

interface AnimObj {
  id: string;
  type: string;
  data: Record<string, unknown>;
  a: number; b: number; c: number;
  initialAngle: number;
  orbitPeriod: number;
  parentId: string | null;
  worldX: number; worldY: number;
  visualR: number;
}

export interface CanvasOrreryHandle {
  setSystem(system: SolarSystem | null): void;
  setTimeScale(scale: number): void;
  pause(): void;
  resume(): void;
  focus(id: string): void;
  dispose(): void;
}

export function createCanvasOrrery(
  container: HTMLElement,
  opts: CanvasOrreryOptions = {},
): CanvasOrreryHandle {
  if (!container) throw new Error("createCanvasOrrery: container element is required");

  const canvas = document.createElement("canvas");
  canvas.width = container.clientWidth || globalThis.innerWidth;
  canvas.height = container.clientHeight || globalThis.innerHeight;
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  let cam = { x: 0, y: 0, scale: 1 };
  let animObjects: AnimObj[] = [];
  let animObjectsById: Record<string, AnimObj> = {};
  let starfield: { x: number; y: number }[] = [];
  let selectedId: string | null = null;
  let elapsedDays = 0;
  let lastTime: number | null = null;
  let paused = false;
  let timeScale = 1;
  let flyState:
    | { startX: number; startY: number; startScale: number; target: AnimObj; targetScale: number | null; progress: number }
    | null = null;
  let lockedTarget: AnimObj | null = null;
  let rafId = 0;
  let currentSeed = 0;

  let dragStart: { x: number; y: number } | null = null;
  let camAtDrag: { x: number; y: number } | null = null;
  let touchCache: Record<number, { x: number; y: number }> = {};
  let pinchStartDist: number | null = null;
  let pinchStartScale = 1;
  let pinchMidWorld: { x: number; y: number } | null = null;

  function screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - canvas.width / 2) / cam.scale + cam.x,
      y: (sy - canvas.height / 2) / cam.scale + cam.y,
    };
  }

  function handleTap(screenX: number, screenY: number) {
    const { x: wx, y: wy } = screenToWorld(screenX, screenY);
    const MIN_HIT = 20 / cam.scale;
    let best: AnimObj | null = null, bestDist = Infinity;
    for (const obj of animObjects) {
      const d = Math.hypot(obj.worldX - wx, obj.worldY - wy);
      const hitR = Math.max(MIN_HIT, obj.visualR);
      if (d < hitR && d < bestDist) { best = obj; bestDist = d; }
    }
    if (best) { focus(best.id); opts.onPick?.(best.id); }
  }

  const onMouseDown = (e: MouseEvent) => {
    dragStart = { x: e.clientX, y: e.clientY };
    camAtDrag = { x: cam.x, y: cam.y };
    lockedTarget = null;
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!dragStart || !camAtDrag) return;
    cam.x = camAtDrag.x - (e.clientX - dragStart.x) / cam.scale;
    cam.y = camAtDrag.y - (e.clientY - dragStart.y) / cam.scale;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (dragStart && Math.abs(e.clientX - dragStart.x) < 4 && Math.abs(e.clientY - dragStart.y) < 4) {
      handleTap(e.clientX, e.clientY);
    }
    dragStart = null;
  };
  const onMouseLeave = () => { dragStart = null; };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    lockedTarget = null;
    const factor = e.deltaY < 0 ? 1.1 : 0.909;
    const before = screenToWorld(e.clientX, e.clientY);
    cam.scale = Math.max(0.01, Math.min(500, cam.scale * factor));
    const after = screenToWorld(e.clientX, e.clientY);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  };
  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    lockedTarget = null;
    for (const t of Array.from(e.changedTouches)) touchCache[t.identifier] = { x: t.clientX, y: t.clientY };
    const pts = Object.values(touchCache);
    if (pts.length === 2) {
      pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartScale = cam.scale;
      pinchMidWorld = screenToWorld((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      dragStart = null;
    } else if (pts.length === 1) {
      dragStart = { x: pts[0].x, y: pts[0].y };
      camAtDrag = { x: cam.x, y: cam.y };
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) touchCache[t.identifier] = { x: t.clientX, y: t.clientY };
    const pts = Object.values(touchCache);
    if (pts.length === 2 && pinchStartDist !== null && pinchMidWorld) {
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      cam.scale = Math.max(0.01, Math.min(500, pinchStartScale * dist / pinchStartDist));
      const after = screenToWorld((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      cam.x += pinchMidWorld.x - after.x;
      cam.y += pinchMidWorld.y - after.y;
    } else if (pts.length === 1 && dragStart && camAtDrag) {
      cam.x = camAtDrag.x - (pts[0].x - dragStart.x) / cam.scale;
      cam.y = camAtDrag.y - (pts[0].y - dragStart.y) / cam.scale;
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    const wasSingle = Object.keys(touchCache).length === 1;
    for (const t of Array.from(e.changedTouches)) delete touchCache[t.identifier];
    pinchStartDist = null;
    if (wasSingle && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      if (dragStart && Math.abs(t.clientX - dragStart.x) < 10 && Math.abs(t.clientY - dragStart.y) < 10) {
        handleTap(t.clientX, t.clientY);
      }
    }
    if (Object.keys(touchCache).length === 0) dragStart = null;
  };
  const onTouchCancel = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) delete touchCache[t.identifier];
    pinchStartDist = null;
    dragStart = null;
  };
  const onResize = () => {
    canvas.width = container.clientWidth || globalThis.innerWidth;
    canvas.height = container.clientHeight || globalThis.innerHeight;
    ctx.imageSmoothingEnabled = false;
    if (currentSeed) starfield = buildStarfield(currentSeed, canvas.width, canvas.height);
  };

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mouseleave", onMouseLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);
  canvas.addEventListener("touchcancel", onTouchCancel);
  globalThis.addEventListener("resize", onResize);

  function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function mulberry32(seed: number) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function buildStarfield(systemSeed: number, w: number, h: number) {
    const rand = mulberry32(systemSeed);
    const dots: { x: number; y: number }[] = [];
    for (let i = 0; i < 250; i++) dots.push({ x: Math.floor(rand() * w), y: Math.floor(rand() * h) });
    return dots;
  }
  function applyTransform() {
    ctx.setTransform(cam.scale, 0, 0, cam.scale,
      canvas.width / 2 - cam.x * cam.scale, canvas.height / 2 - cam.y * cam.scale);
  }
  function drawStarfield() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff44";
    for (const dot of starfield) ctx.fillRect(dot.x, dot.y, 1, 1);
  }
  function drawOrbits() {
    ctx.lineWidth = 1 / cam.scale;
    for (const obj of animObjects) {
      if (obj.type === "star") continue;
      const parent = obj.parentId ? animObjectsById[obj.parentId] : null;
      const px = parent ? parent.worldX : 0;
      const py = parent ? parent.worldY : 0;
      ctx.save();
      ctx.translate(px, py);
      ctx.beginPath();
      ctx.ellipse(obj.c, 0, obj.a, obj.b, 0, 0, Math.PI * 2);
      ctx.strokeStyle = obj.parentId ? "#0a2a2a" : "#1a3a6a";
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawBodies() {
    for (const obj of animObjects) {
      const r = Math.max(2 / cam.scale, obj.visualR);
      ctx.save();
      ctx.translate(obj.worldX, obj.worldY);
      if (obj.id === selectedId) {
        ctx.beginPath();
        ctx.arc(0, 0, r + 3 / cam.scale, 0, Math.PI * 2);
        ctx.strokeStyle = "#6ab0d4";
        ctx.lineWidth = 1.5 / cam.scale;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = obj.type === "star"
        ? (SPECTRAL_STAR_COLOR[(obj.data as { spectralType?: string }).spectralType ?? "G"] ?? "#fff5b0")
        : (TYPE_COLORS[obj.type] ?? "#ffffff");
      ctx.fill();
      ctx.strokeStyle = TYPE_BORDERS[obj.type] ?? "#888";
      ctx.lineWidth = 1 / cam.scale;
      ctx.stroke();
      ctx.restore();
    }
  }

  function buildAnimObjects(system: SolarSystem): AnimObj[] {
    const objs: AnimObj[] = [];
    objs.push({
      id: "star", type: "star", data: system.star as unknown as Record<string, unknown>,
      worldX: 0, worldY: 0, visualR: visualRadius(system.star.radius * SOLAR_TO_EARTH_RADII),
      a: 0, b: 0, c: 0, initialAngle: 0, orbitPeriod: 1, parentId: null,
    });
    const sorted = [...system.objects].sort((a, b) => a.orbitRadius - b.orbitRadius);
    for (const obj of sorted) {
      const p = orbitParams(obj.orbitRadius, obj.eccentricity, false);
      objs.push({
        id: obj.id, type: obj.type, data: obj as unknown as Record<string, unknown>,
        a: p.a, b: p.b, c: p.c,
        initialAngle: (obj.orbitalPhase ?? 0) * Math.PI * 2,
        orbitPeriod: obj.orbitPeriod || 1, parentId: null,
        worldX: 0, worldY: 0, visualR: visualRadius(obj.radius),
      });
      for (const moon of obj.moons ?? []) {
        const mp = orbitParams(moon.orbitRadius, moon.eccentricity, true);
        objs.push({
          id: moon.id, type: moon.type, data: moon as unknown as Record<string, unknown>,
          a: mp.a, b: mp.b, c: mp.c,
          initialAngle: (moon.orbitalPhase ?? 0) * Math.PI * 2,
          orbitPeriod: moon.orbitPeriod || 1, parentId: obj.id,
          worldX: 0, worldY: 0, visualR: visualRadius(moon.radius),
        });
      }
    }
    return objs;
  }

  function updatePositions() {
    for (const obj of animObjects) {
      if (obj.type === "star") continue;
      const angle = angleAtTime(obj.initialAngle, obj.orbitPeriod, elapsedDays);
      const pos = orbitPosition(obj.a, obj.b, obj.c, angle);
      if (obj.parentId === null) { obj.worldX = pos.x; obj.worldY = pos.y; }
      else {
        const parent = animObjectsById[obj.parentId];
        obj.worldX = parent.worldX + pos.x;
        obj.worldY = parent.worldY + pos.y;
      }
    }
  }

  function focus(id: string) {
    selectedId = id;
    const obj = animObjectsById[id];
    if (!obj) return;
    const minDim = Math.min(canvas.width, canvas.height);
    const targetScale = Math.max(0.01, Math.min(500, (minDim * 0.2) / Math.max(obj.visualR, 1e-6)));
    flyState = { startX: cam.x, startY: cam.y, startScale: cam.scale, target: obj, targetScale, progress: 0 };
  }

  function animate(time: number) {
    rafId = requestAnimationFrame(animate);
    if (lastTime === null) { lastTime = time; return; }
    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (!paused) elapsedDays += delta * timeScale;
    updatePositions();
    if (flyState !== null) {
      flyState.progress = Math.min(flyState.progress + delta / FLY_DURATION, 1);
      const t = easeInOutCubic(flyState.progress);
      cam.x = flyState.startX + (flyState.target.worldX - flyState.startX) * t;
      cam.y = flyState.startY + (flyState.target.worldY - flyState.startY) * t;
      if (flyState.targetScale !== null) {
        const ls = Math.log(flyState.startScale);
        const lt = Math.log(flyState.targetScale);
        cam.scale = Math.exp(ls + (lt - ls) * t);
      }
      if (flyState.progress >= 1) { lockedTarget = flyState.target; flyState = null; }
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
    if (rafId !== 0) { cancelAnimationFrame(rafId); rafId = 0; }
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
  }

  function setSystem(system: SolarSystem | null) {
    clearScene();
    if (!system) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#666";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.fillText("No system loaded — generate one first", canvas.width / 2, canvas.height / 2);
      return;
    }
    currentSeed = system.seed;
    animObjects = buildAnimObjects(system);
    animObjectsById = Object.fromEntries(animObjects.map((o) => [o.id, o]));
    starfield = buildStarfield(system.seed, canvas.width, canvas.height);
    const maxR = Math.max(1,
      ...animObjects.filter((o) => o.parentId === null && o.type !== "star").map((o) => o.a + Math.abs(o.c)));
    cam = { x: 0, y: 0, scale: Math.min(canvas.width, canvas.height) / 2 / maxR * 0.8 };
    rafId = requestAnimationFrame(animate);
  }

  return {
    setSystem,
    setTimeScale(scale) { timeScale = scale; },
    pause() { paused = true; },
    resume() { paused = false; },
    focus,
    dispose() {
      clearScene();
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchCancel);
      globalThis.removeEventListener("resize", onResize);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}
