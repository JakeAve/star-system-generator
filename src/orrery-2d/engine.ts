import type { SolarSystem } from "../core/types.ts";
import {
  AU_SCALE,
  eccentricAngleAtTime,
  orbitParams,
  orbitPosition,
  SOLAR_TO_EARTH_RADII,
  visualRadius,
} from "../core/kinematics.ts";
import { centroidOf, enclosingRadius } from "../view/framing.ts";
import { chevronsAlong, hitTestRoutes, isPureRole } from "../view/route-view-model.ts";
import type { RoutePickTarget, RouteView } from "../view/route-view-model.ts";

const FLY_DURATION = 1.5;

const TYPE_COLORS: Record<string, string> = {
  star: "#fff5b0",
  rockyPlanet: "#c1693a",
  gasGiant: "#d4874e",
  iceGiant: "#6ab0d4",
  dwarfPlanet: "#7090b0",
  asteroid: "#555555",
  moon: "#aaaaaa",
  comet: "#88aacc",
};
const TYPE_BORDERS: Record<string, string> = {
  star: "#ccc380",
  rockyPlanet: "#8a4020",
  gasGiant: "#a05828",
  iceGiant: "#3a7090",
  dwarfPlanet: "#405070",
  asteroid: "#333333",
  moon: "#777777",
  comet: "#557799",
};
const SPECTRAL_STAR_COLOR: Record<string, string> = {
  O: "#9bb0ff",
  B: "#aabfff",
  A: "#cad7ff",
  F: "#f8f7ff",
  G: "#fff5b0",
  K: "#ffcc6f",
  M: "#ff6633",
};

export interface CanvasOrreryOptions {
  onPick?: (id: string) => void;
  onSpacePick?: (au: number, phase: number) => void;
  /** Fired when the user manually pans/zooms while the camera was locked. */
  onLockBreak?: () => void;
  /** Fired when the user taps a route leg or node (takes precedence over onPick). */
  onRoutePick?: (target: RoutePickTarget) => void;
}

interface AnimObj {
  id: string;
  type: string;
  data: Record<string, unknown>;
  a: number;
  b: number;
  c: number;
  periapsisAngle: number;
  initialAngle: number;
  orbitPeriod: number;
  parentId: string | null;
  worldX: number;
  worldY: number;
  visualR: number;
}

export interface CanvasOrreryHandle {
  setSystem(system: SolarSystem | null): void;
  setTimeScale(scale: number): void;
  pause(): void;
  resume(): void;
  /** Move the camera to the given body ids. `lock` tracks their centroid every
   *  frame; `frame` fits them once then leaves the camera free. Unknown ids are
   *  skipped; an empty/all-unknown set is a no-op. */
  focus(ids: string[], mode: "lock" | "frame"): void;
  /** Set the highlighted (ringed) body ids. Unknown ids are skipped. */
  setHighlight(ids: string[]): void;
  /** Draw one or more route overlays (ghost bodies + colored transfer arcs + node markers).
   *  Replaces any current routes; pass [] to clear. */
  setRoutes(routeViews: RouteView[]): void;
  /** Convenience wrapper over setRoutes for a single route (or null to clear). */
  setRoute(routeView: RouteView | null): void;
  /** The renderer's current simulation time in days (advances while playing). */
  getCurrentDay(): number;
  dispose(): void;
}

export function createCanvasOrrery(
  container: HTMLElement,
  opts: CanvasOrreryOptions = {},
): CanvasOrreryHandle {
  if (!container) {
    throw new Error("createCanvasOrrery: container element is required");
  }

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
  let highlightIds: Set<string> = new Set();
  let currentRoutes: RouteView[] = [];
  let hoveredRouteId: string | null = null;
  // Marching-chevron animation: subtle directional flow along route legs.
  // Tunables — spacing/size are screen px (divided by scale); speed is spacings/sec.
  const CHEVRON_SPACING_PX = 46;
  const CHEVRON_ARM_PX = 5;
  const CHEVRON_SPEED = 0.5; // ~23 px/sec of flow at this spacing — deliberately gentle
  let routePhase = 0;
  let elapsedDays = 0;
  let lastTime: number | null = null;
  let paused = false;
  let timeScale = 1;
  let flyState:
    | {
      startX: number;
      startY: number;
      startScale: number;
      endX: number;
      endY: number;
      targetScale: number | null;
      lockTargets: AnimObj[];
      progress: number;
    }
    | null = null;
  let lockedTargets: AnimObj[] = [];
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

  function breakLock() {
    const wasLocking = lockedTargets.length > 0 ||
      (flyState?.lockTargets.length ?? 0) > 0;
    lockedTargets = [];
    if (flyState) flyState.lockTargets = [];
    if (wasLocking) opts.onLockBreak?.();
  }

  function handleTap(screenX: number, screenY: number) {
    const { x: wx, y: wy } = screenToWorld(screenX, screenY);
    const MIN_HIT = 20 / cam.scale;
    const routeHit = hitTestRoutes(currentRoutes, wx, wy, MIN_HIT);
    if (routeHit) {
      opts.onRoutePick?.(routeHit);
      return;
    }
    let best: AnimObj | null = null, bestDist = Infinity;
    for (const obj of animObjects) {
      const d = Math.hypot(obj.worldX - wx, obj.worldY - wy);
      const hitR = Math.max(MIN_HIT, obj.visualR);
      if (d < hitR && d < bestDist) {
        best = obj;
        bestDist = d;
      }
    }
    if (best) {
      opts.onPick?.(best.id);
    } else {
      const au = Math.hypot(wx, wy) / AU_SCALE;
      const phase = ((Math.atan2(wy, wx) / (2 * Math.PI)) + 1) % 1;
      opts.onSpacePick?.(au, phase);
    }
  }

  const onMouseDown = (e: MouseEvent) => {
    dragStart = { x: e.clientX, y: e.clientY };
    camAtDrag = { x: cam.x, y: cam.y };
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!dragStart || !camAtDrag) return;
    breakLock();
    cam.x = camAtDrag.x - (e.clientX - dragStart.x) / cam.scale;
    cam.y = camAtDrag.y - (e.clientY - dragStart.y) / cam.scale;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (
      dragStart && Math.abs(e.clientX - dragStart.x) < 4 &&
      Math.abs(e.clientY - dragStart.y) < 4
    ) {
      handleTap(e.clientX, e.clientY);
    }
    dragStart = null;
  };
  const onMouseLeave = () => {
    dragStart = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    breakLock();
    const factor = e.deltaY < 0 ? 1.1 : 0.909;
    const before = screenToWorld(e.clientX, e.clientY);
    cam.scale = Math.max(0.01, Math.min(500, cam.scale * factor));
    const after = screenToWorld(e.clientX, e.clientY);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  };
  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      touchCache[t.identifier] = { x: t.clientX, y: t.clientY };
    }
    const pts = Object.values(touchCache);
    if (pts.length === 2) {
      pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartScale = cam.scale;
      pinchMidWorld = screenToWorld(
        (pts[0].x + pts[1].x) / 2,
        (pts[0].y + pts[1].y) / 2,
      );
      dragStart = null;
    } else if (pts.length === 1) {
      dragStart = { x: pts[0].x, y: pts[0].y };
      camAtDrag = { x: cam.x, y: cam.y };
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    breakLock();
    for (const t of Array.from(e.changedTouches)) {
      touchCache[t.identifier] = { x: t.clientX, y: t.clientY };
    }
    const pts = Object.values(touchCache);
    if (pts.length === 2 && pinchStartDist !== null && pinchMidWorld) {
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      cam.scale = Math.max(
        0.01,
        Math.min(500, pinchStartScale * dist / pinchStartDist),
      );
      const after = screenToWorld(
        (pts[0].x + pts[1].x) / 2,
        (pts[0].y + pts[1].y) / 2,
      );
      cam.x += pinchMidWorld.x - after.x;
      cam.y += pinchMidWorld.y - after.y;
    } else if (pts.length === 1 && dragStart && camAtDrag) {
      cam.x = camAtDrag.x - (pts[0].x - dragStart.x) / cam.scale;
      cam.y = camAtDrag.y - (pts[0].y - dragStart.y) / cam.scale;
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    const wasSingle = Object.keys(touchCache).length === 1;
    for (const t of Array.from(e.changedTouches)) {
      delete touchCache[t.identifier];
    }
    pinchStartDist = null;
    if (wasSingle && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      if (
        dragStart && Math.abs(t.clientX - dragStart.x) < 10 &&
        Math.abs(t.clientY - dragStart.y) < 10
      ) {
        handleTap(t.clientX, t.clientY);
      }
    }
    if (Object.keys(touchCache).length === 0) dragStart = null;
  };
  const onTouchCancel = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      delete touchCache[t.identifier];
    }
    pinchStartDist = null;
    dragStart = null;
  };
  const onResize = () => {
    canvas.width = container.clientWidth || globalThis.innerWidth;
    canvas.height = container.clientHeight || globalThis.innerHeight;
    ctx.imageSmoothingEnabled = false;
    if (currentSeed) {
      starfield = buildStarfield(currentSeed, canvas.width, canvas.height);
    }
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
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function buildStarfield(systemSeed: number, w: number, h: number) {
    const rand = mulberry32(systemSeed);
    const dots: { x: number; y: number }[] = [];
    for (let i = 0; i < 250; i++) {
      dots.push({ x: Math.floor(rand() * w), y: Math.floor(rand() * h) });
    }
    return dots;
  }
  function applyTransform() {
    ctx.setTransform(
      cam.scale,
      0,
      0,
      cam.scale,
      canvas.width / 2 - cam.x * cam.scale,
      canvas.height / 2 - cam.y * cam.scale,
    );
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
      ctx.rotate(obj.periapsisAngle);
      ctx.beginPath();
      ctx.ellipse(-obj.c, 0, obj.a, obj.b, 0, 0, Math.PI * 2);
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
      if (highlightIds.has(obj.id)) {
        ctx.beginPath();
        ctx.arc(0, 0, r + 4 / cam.scale, 0, Math.PI * 2);
        ctx.strokeStyle = "#7fdfff";
        ctx.lineWidth = 2.5 / cam.scale;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = obj.type === "star"
        ? (SPECTRAL_STAR_COLOR[
          (obj.data as { spectralType?: string }).spectralType ?? "G"
        ] ?? "#fff5b0")
        : (TYPE_COLORS[obj.type] ?? "#ffffff");
      ctx.fill();
      ctx.strokeStyle = TYPE_BORDERS[obj.type] ?? "#888";
      ctx.lineWidth = 1 / cam.scale;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawRoute() {
    if (currentRoutes.length === 0) return;
    ctx.save(); // isolate route styling (stroke/fill/lineWidth) from the rest of the frame

    // Draw balanced routes first, pure routes on top, hovered route always last (topmost).
    const ordered = [...currentRoutes].sort((a, b) => {
      const rank = (rv: typeof a) =>
        (rv.id === hoveredRouteId ? 2 : isPureRole(rv.role) ? 1 : 0);
      return rank(a) - rank(b);
    });

    for (const route of ordered) {
      const color = route.color ?? "#ffd633";
      const hovered = route.id === hoveredRouteId;
      const balanced = !isPureRole(route.role);
      // Balanced routes recede (thinner, translucent) unless hovered; hovered routes thicken.
      const arcWidth = (hovered ? 3 : balanced ? 1.2 : 2) / cam.scale;
      const arcAlpha = hovered ? 1 : balanced ? 0.5 : 1;

      // Ghost bodies: faint body-tinted discs at the route's times.
      ctx.save();
      ctx.globalAlpha = 0.35;
      for (const g of route.ghosts) {
        const r = Math.max(2 / cam.scale, g.visualR);
        ctx.beginPath();
        ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLORS[g.type] ?? "#ffffff";
        ctx.fill();
      }
      ctx.restore();

      // Transfer arcs (route color).
      ctx.save();
      ctx.globalAlpha = arcAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = arcWidth;
      for (const leg of route.legs) {
        if (leg.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(leg.points[0].x, leg.points[0].y);
        for (let i = 1; i < leg.points.length; i++) {
          ctx.lineTo(leg.points[i].x, leg.points[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // Marching chevrons: subtle arrows flowing toward the destination (direction of travel).
      ctx.save();
      const spacing = CHEVRON_SPACING_PX / cam.scale;
      const arm = CHEVRON_ARM_PX / cam.scale;
      const spread = 2.5; // arms angled back from the tip (~143°)
      ctx.lineWidth = 1.4 / cam.scale;
      ctx.globalAlpha = 0.85 * arcAlpha;
      for (const leg of route.legs) {
        for (const c of chevronsAlong(leg.points, spacing, routePhase)) {
          ctx.beginPath();
          ctx.moveTo(
            c.x + Math.cos(c.angle + spread) * arm,
            c.y + Math.sin(c.angle + spread) * arm,
          );
          ctx.lineTo(c.x, c.y);
          ctx.lineTo(
            c.x + Math.cos(c.angle - spread) * arm,
            c.y + Math.sin(c.angle - spread) * arm,
          );
          ctx.stroke();
        }
      }
      ctx.restore();

      // Node markers: filled dot for depart/arrive, hollow ring for flyby.
      for (const n of route.nodes) {
        const r = 4 / cam.scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        if (n.kind === "flyby") {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5 / cam.scale;
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  function buildAnimObjects(system: SolarSystem): AnimObj[] {
    const objs: AnimObj[] = [];
    objs.push({
      id: system.star.id,
      type: "star",
      data: system.star as unknown as Record<string, unknown>,
      worldX: 0,
      worldY: 0,
      visualR: visualRadius(system.star.radius * SOLAR_TO_EARTH_RADII),
      a: 0,
      b: 0,
      c: 0,
      periapsisAngle: 0,
      initialAngle: 0,
      orbitPeriod: 1,
      parentId: null,
    });
    const sorted = [...system.objects].sort((a, b) =>
      a.orbitRadius - b.orbitRadius
    );
    for (const obj of sorted) {
      const p = orbitParams(obj.orbitRadius, obj.eccentricity, false);
      objs.push({
        id: obj.id,
        type: obj.type,
        data: obj as unknown as Record<string, unknown>,
        a: p.a,
        b: p.b,
        c: p.c,
        periapsisAngle: obj.periapsisAngle ?? 0,
        initialAngle: (obj.orbitalPhase ?? 0) * Math.PI * 2,
        orbitPeriod: obj.orbitPeriod || 1,
        parentId: null,
        worldX: 0,
        worldY: 0,
        visualR: visualRadius(obj.radius),
      });
      for (const moon of obj.moons ?? []) {
        const mp = orbitParams(moon.orbitRadius, moon.eccentricity, true);
        objs.push({
          id: moon.id,
          type: moon.type,
          data: moon as unknown as Record<string, unknown>,
          a: mp.a,
          b: mp.b,
          c: mp.c,
          periapsisAngle: moon.periapsisAngle ?? 0,
          initialAngle: (moon.orbitalPhase ?? 0) * Math.PI * 2,
          orbitPeriod: moon.orbitPeriod || 1,
          parentId: obj.id,
          worldX: 0,
          worldY: 0,
          visualR: visualRadius(moon.radius),
        });
      }
    }
    return objs;
  }

  function updatePositions() {
    for (const obj of animObjects) {
      if (obj.type === "star") continue;
      const angle = eccentricAngleAtTime(
        obj.initialAngle,
        obj.orbitPeriod,
        elapsedDays,
        obj.a > 0 ? obj.c / obj.a : 0,
      );
      const pos = orbitPosition(obj.a, obj.b, obj.c, angle, obj.periapsisAngle);
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

  function focus(ids: string[], mode: "lock" | "frame") {
    const objs = ids
      .map((id) => animObjectsById[id])
      .filter((o): o is AnimObj => Boolean(o));
    if (objs.length === 0) return;
    const pts = objs.map((o) => [o.worldX, o.worldY]);
    const center = centroidOf(pts);
    const maxVisualR = Math.max(...objs.map((o) => o.visualR));
    const radius = enclosingRadius(pts, center) + maxVisualR;
    const minDim = Math.min(canvas.width, canvas.height);
    const targetScale = Math.max(
      0.01,
      Math.min(500, (minDim / 2) * 0.4 / Math.max(radius, 1e-6)),
    );
    flyState = {
      startX: cam.x,
      startY: cam.y,
      startScale: cam.scale,
      endX: center[0],
      endY: center[1],
      targetScale,
      lockTargets: mode === "lock" ? objs : [],
      progress: 0,
    };
    lockedTargets = [];
  }

  function setHighlight(ids: string[]) {
    highlightIds = new Set(ids.filter((id) => id in animObjectsById));
  }

  function animate(time: number) {
    rafId = requestAnimationFrame(animate);
    if (lastTime === null) {
      lastTime = time;
      return;
    }
    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    routePhase = (routePhase + delta * CHEVRON_SPEED) % 1; // flows even while sim is paused
    if (!paused) elapsedDays += delta * timeScale;
    updatePositions();
    if (flyState !== null) {
      flyState.progress = Math.min(flyState.progress + delta / FLY_DURATION, 1);
      const t = easeInOutCubic(flyState.progress);
      cam.x = flyState.startX + (flyState.endX - flyState.startX) * t;
      cam.y = flyState.startY + (flyState.endY - flyState.startY) * t;
      if (flyState.targetScale !== null) {
        const ls = Math.log(flyState.startScale);
        const lt = Math.log(flyState.targetScale);
        cam.scale = Math.exp(ls + (lt - ls) * t);
      }
      if (flyState.progress >= 1) {
        lockedTargets = flyState.lockTargets;
        flyState = null;
      }
    } else if (lockedTargets.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const o of lockedTargets) {
        sx += o.worldX;
        sy += o.worldY;
      }
      cam.x = sx / lockedTargets.length;
      cam.y = sy / lockedTargets.length;
    }
    drawStarfield();
    applyTransform();
    drawOrbits();
    drawBodies();
    drawRoute();
  }

  function clearScene() {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    animObjects = [];
    animObjectsById = {};
    starfield = [];
    highlightIds = new Set();
    currentRoutes = [];
    elapsedDays = 0;
    lastTime = null;
    paused = false;
    timeScale = 1;
    flyState = null;
    lockedTargets = [];
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
      ctx.fillText(
        "No system loaded — generate one first",
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }
    currentSeed = system.seed;
    animObjects = buildAnimObjects(system);
    animObjectsById = Object.fromEntries(animObjects.map((o) => [o.id, o]));
    starfield = buildStarfield(system.seed, canvas.width, canvas.height);
    const maxR = Math.max(
      1,
      ...animObjects.filter((o) => o.parentId === null && o.type !== "star")
        .map((o) => o.a + Math.abs(o.c)),
    );
    cam = {
      x: 0,
      y: 0,
      scale: Math.min(canvas.width, canvas.height) / 2 / maxR * 0.8,
    };
    rafId = requestAnimationFrame(animate);
  }

  return {
    setSystem,
    setTimeScale(scale) {
      timeScale = scale;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    focus,
    setHighlight,
    setRoutes(routeViews) {
      currentRoutes = [...routeViews]; // copy so later caller mutation can't change the overlay
    },
    setRoute(routeView) {
      currentRoutes = routeView ? [routeView] : [];
    },
    getCurrentDay() {
      return elapsedDays;
    },
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
