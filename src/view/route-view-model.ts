// Layer 2 — plain-data "what to draw" for a travel route over a system.
// No Three.js, no DOM. Engines consume this and render in their own space.

import type { SolarSystem } from "../core/types.ts";
import { AU_SCALE, MOON_ORBIT_SCALE } from "../core/kinematics.ts";
import type { Route, RouteNodeKind, RouteRole } from "../travel/types.ts";
import { EndState } from "../travel/types.ts";
import { getBestRoutes } from "../travel/index.ts";
import { buildViewModel, type ViewBody } from "./view-model.ts";

export interface RouteLegView {
  centralBodyId: string;
  fromBodyId: string;
  toBodyId: string;
  departTime: number; // day
  arriveTime: number; // day
  timeOfFlight: number; // days
  deltaV: number; // km/s, leg injection burn
  transfer: {
    a: number;
    e: number;
    argPeriapsis: number;
    nu1: number;
    nu2: number;
  };
  /** World-unit polyline tracing the leg's transfer arc (nu1 -> nu2). */
  points: { x: number; y: number }[];
}

export interface RouteNodeView {
  id: string; // body id
  kind: RouteNodeKind;
  x: number;
  y: number;
  time: number; // absolute day
  deltaV: number; // km/s
  vInfinity?: number; // km/s, transit nodes
  flyby?: { periapsisRadius: number; vInfinity: number; turnAngle: number };
}

export interface RouteGhostView {
  id: string;
  type: string; // ObjectType value or "star"
  x: number;
  y: number;
  visualR: number; // world units
}

export interface RouteView {
  id: string; // caller-supplied; returned in onRoutePick targets
  color?: string; // whole-route color for arc + node markers; engine default "#ffd633"
  /** Optimization role, if the source route was tagged (selectBestRoutes2). */
  role?: RouteRole;
  /** Whole-route totals, copied from the source Route for hover/panel display. */
  totalDeltaV: number; // km/s
  duration: number; // days
  departAt: number; // absolute day
  arriveAt: number; // absolute day (departAt + duration)
  legs: RouteLegView[];
  nodes: RouteNodeView[];
  ghosts: RouteGhostView[];
}

export type RoutePickTarget =
  | { kind: "node"; routeId: string; node: RouteNodeView }
  | { kind: "leg"; routeId: string; leg: RouteLegView };

/** Shortest distance from point (px,py) to segment (ax,ay)-(bx,by). */
function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Hit-test a world-space point against route geometry. For each route, a node within `radius`
 * wins over that route's legs (a node sits on leg endpoints, so clicking a junction selects the
 * node); otherwise the route's nearest leg within `radius` is its candidate. Across routes, the
 * candidate with the smallest distance wins — so a near leg on one route is not overridden by a
 * far node on another. Returns null when nothing is within `radius`. Pure: no DOM, no engine state.
 */
export function hitTestRoutes(
  routes: RouteView[],
  x: number,
  y: number,
  radius: number,
): RoutePickTarget | null {
  let best: { d: number; target: RoutePickTarget } | null = null;

  for (const route of routes) {
    // Per-route: nearest node within radius takes priority (junction); else nearest leg.
    let nodeBest: { d: number; node: RouteNodeView } | null = null;
    for (const node of route.nodes) {
      const d = Math.hypot(node.x - x, node.y - y);
      if (d <= radius && (!nodeBest || d < nodeBest.d)) nodeBest = { d, node };
    }

    let cand: { d: number; target: RoutePickTarget } | null = null;
    if (nodeBest) {
      cand = {
        d: nodeBest.d,
        target: { kind: "node", routeId: route.id, node: nodeBest.node },
      };
    } else {
      let legBest: { d: number; leg: RouteLegView } | null = null;
      for (const leg of route.legs) {
        for (let i = 1; i < leg.points.length; i++) {
          const a = leg.points[i - 1], b = leg.points[i];
          const d = pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y);
          if (d <= radius && (!legBest || d < legBest.d)) legBest = { d, leg };
        }
      }
      if (legBest) {
        cand = {
          d: legBest.d,
          target: { kind: "leg", routeId: route.id, leg: legBest.leg },
        };
      }
    }

    if (cand && (!best || cand.d < best.d)) best = cand;
  }

  return best ? best.target : null;
}

/** A chevron placement along a route polyline: a point and the travel-direction angle (rad). */
export interface Chevron {
  x: number;
  y: number;
  angle: number; // radians, pointing toward the polyline's end (direction of travel)
}

/**
 * Place chevron markers along a polyline at `spacing` (world units), shifted forward by
 * `phase` ∈ [0,1) of one spacing for animated flow. Each chevron's `angle` points along the
 * local segment toward the polyline's end (depart -> arrive), so they read as travel direction.
 * Pure: no DOM, no engine state. Returns [] for degenerate input.
 */
export function chevronsAlong(
  points: { x: number; y: number }[],
  spacing: number,
  phase: number,
): Chevron[] {
  if (points.length < 2 || spacing <= 0) return [];
  const segs: { len: number; ang: number; x0: number; y0: number }[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    segs.push({
      len,
      ang: Math.atan2(dy, dx),
      x0: points[i - 1].x,
      y0: points[i - 1].y,
    });
    total += len;
  }
  if (total === 0) return [];

  const out: Chevron[] = [];
  for (let k = 0;; k++) {
    const s = (k + phase) * spacing;
    if (s > total) break;
    let acc = 0;
    for (const sg of segs) {
      if (s <= acc + sg.len) {
        const t = sg.len > 0 ? (s - acc) / sg.len : 0;
        out.push({
          x: sg.x0 + Math.cos(sg.ang) * sg.len * t,
          y: sg.y0 + Math.sin(sg.ang) * sg.len * t,
          angle: sg.ang,
        });
        break;
      }
      acc += sg.len;
    }
  }
  return out;
}

const ARC_SAMPLES = 48;

/** World position + body record of each body at `day`, via the system view-model. */
function bodyAt(system: SolarSystem, day: number): Map<string, ViewBody> {
  const map = new Map<string, ViewBody>();
  for (const b of buildViewModel(system, day)) map.set(b.id, b);
  return map;
}

/**
 * Sample a transfer conic from nu1 to nu2 into a world-unit polyline. `auToWorld` is the
 * world-units-per-AU factor for the leg's frame: heliocentric legs use AU_SCALE, while
 * planetocentric (moon) legs use AU_SCALE * MOON_ORBIT_SCALE to match how buildViewModel
 * scales moon orbits — so the arc stays aligned with the moon node/ghost positions.
 */
function sampleArc(
  transfer: {
    a: number;
    e: number;
    argPeriapsis: number;
    nu1: number;
    nu2: number;
  },
  centralWorld: { x: number; y: number },
  auToWorld: number,
): { x: number; y: number }[] {
  const { a, e, argPeriapsis, nu1, nu2 } = transfer;
  const cosw = Math.cos(argPeriapsis);
  const sinw = Math.sin(argPeriapsis);
  const p = a * (1 - e * e); // semi-latus rectum (AU)
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const nu = nu1 + (nu2 - nu1) * (i / ARC_SAMPLES);
    const denom = 1 + e * Math.cos(nu);
    if (denom <= 1e-9) continue; // skip asymptote (unbound/degenerate); ellipses are safe
    const r = p / denom; // AU
    // Perifocal (periapsis on +x), rotate by argPeriapsis -> central-body frame (AU).
    const xp = r * Math.cos(nu);
    const yp = r * Math.sin(nu);
    const xAu = xp * cosw - yp * sinw;
    const yAu = xp * sinw + yp * cosw;
    pts.push({
      x: centralWorld.x + xAu * auToWorld,
      y: centralWorld.y + yAu * auToWorld,
    });
  }
  return pts;
}

/**
 * Convert a Route into plain world-space geometry: one arc polyline per leg, one marker per
 * node (body position at the node's time), and faint ghost discs for the node bodies. The
 * star is fixed at the origin; planetocentric legs anchor their central body at the leg's
 * departTime (a sub-pixel approximation for short escape/capture legs).
 */
export function buildRouteViewModel(
  system: SolarSystem,
  route: Route,
  opts: { id?: string; color?: string; role?: RouteRole } = {},
): RouteView {
  const starId = system.star.id;

  // Leg arcs.
  const legs: RouteLegView[] = route.legs.map((leg) => {
    const heliocentric = leg.centralBodyId === starId;
    let centralWorld = { x: 0, y: 0 };
    if (!heliocentric) {
      const central = bodyAt(system, leg.departTime).get(leg.centralBodyId);
      if (central) {
        centralWorld = { x: central.position.x, y: central.position.y };
      }
    }
    const auToWorld = heliocentric ? AU_SCALE : AU_SCALE * MOON_ORBIT_SCALE;
    return {
      centralBodyId: leg.centralBodyId,
      fromBodyId: leg.fromBodyId,
      toBodyId: leg.toBodyId,
      departTime: leg.departTime,
      arriveTime: leg.arriveTime,
      timeOfFlight: leg.timeOfFlight,
      deltaV: leg.deltaV,
      transfer: leg.transfer,
      points: sampleArc(leg.transfer, centralWorld, auToWorld),
    };
  });

  // Node markers + ghosts (deduped per body id at its node time).
  const nodes: RouteNodeView[] = [];
  const ghosts: RouteGhostView[] = [];
  const seenGhost = new Set<string>();
  for (const n of route.nodes) {
    const body = bodyAt(system, n.time).get(n.bodyId);
    if (!body) continue;
    nodes.push({
      id: n.bodyId,
      kind: n.kind,
      x: body.position.x,
      y: body.position.y,
      time: n.time,
      deltaV: n.deltaV,
      vInfinity: n.vInfinity,
      flyby: n.flyby,
    });
    const key = `${n.bodyId}@${n.time}`;
    if (!seenGhost.has(key)) {
      seenGhost.add(key);
      ghosts.push({
        id: n.bodyId,
        type: body.type,
        x: body.position.x,
        y: body.position.y,
        visualR: body.visualR,
      });
    }
  }

  return {
    id: opts.id ?? route.notation,
    color: opts.color,
    role: opts.role ?? route.role,
    totalDeltaV: route.totalDeltaV,
    duration: route.duration,
    departAt: route.departAt,
    arriveAt: route.departAt + route.duration,
    legs,
    nodes,
    ghosts,
  };
}

export const PURE_ROLE_COLOR: Record<string, string> = {
  cheapest: "#4fc3f7",
  fastest: "#ffd633",
  soonest: "#ef5350",
};
export const BALANCED_COLOR = "#8a8f9c";

export const ROLE_DISPLAY_NAME: Record<string, string> = {
  cheapest: "Cheapest",
  fastest: "Fastest",
  soonest: "Soonest",
  "balanced-cheap-fast": "Balanced: cheap + fast",
  "balanced-cheap-soon": "Balanced: cheap + soon",
  "balanced-fast-soon": "Balanced: fast + soon",
  "balanced-all": "Balanced: all-round",
};

/** True for the three anchor roles (cheapest/fastest/soonest); false for balances/undefined. */
export function isPureRole(role: RouteRole | undefined): boolean {
  return role !== undefined && role in PURE_ROLE_COLOR;
}

/** Line color for a role: saturated per-anchor, muted gray for balances/undefined. */
export function roleColor(role: RouteRole | undefined): string {
  return (role && PURE_ROLE_COLOR[role]) ?? BALANCED_COLOR;
}

/** Human-readable label for a role; "Route" when untagged. */
export function roleDisplayName(role: RouteRole | undefined): string {
  return (role && ROLE_DISPLAY_NAME[role]) ?? "Route";
}

/**
 * Compute all picks from getBestRoutes for a departure on/after `currentDay` and convert
 * each to a RouteView colored by optimization role (pure roles get distinct saturated colors;
 * balanced routes share a muted gray). Returns an empty array when no routes exist.
 * Intended for multi-route overlay display; call `orrery.setRoutes(views)` with the result.
 */
export function routeViewsForPick(
  system: SolarSystem,
  fromId: string,
  toId: string,
  currentDay: number,
  opts: { balance?: boolean } = {},
): RouteView[] {
  const routes = getBestRoutes(
    system,
    { obj: fromId, type: EndState.Orbit },
    { obj: toId, type: EndState.Orbit },
    { startWindow: currentDay, balance: opts.balance ?? true, findSoonest: true },
  );
  return routes.map((route) =>
    buildRouteViewModel(system, route, {
      color: roleColor(route.role),
    })
  );
}

/**
 * Compute the best route between two bodies for a departure on/after `currentDay`, and convert it
 * to a RouteView ready for an engine to draw. `currentDay` is the renderer's absolute sim day; it
 * is passed straight through as the travel `startWindow`, so the returned route departs at/after
 * the current epoch instead of day 0. Returns null when no route is found (the same "no route"
 * signal the caller already handles). Both endpoints orbit-to-orbit.
 */
export function routeViewForPick(
  system: SolarSystem,
  fromId: string,
  toId: string,
  currentDay: number,
  opts: { id?: string; color?: string } = {},
): RouteView | null {
  const routes = getBestRoutes(
    system,
    { obj: fromId, type: EndState.Orbit },
    { obj: toId, type: EndState.Orbit },
    { startWindow: currentDay },
  );
  const route = routes[0];
  if (!route) return null;
  return buildRouteViewModel(system, route, opts);
}
