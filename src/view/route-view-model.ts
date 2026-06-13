// Layer 2 — plain-data "what to draw" for a travel route over a system.
// No Three.js, no DOM. Engines consume this and render in their own space.

import type { SolarSystem } from "../core/types.ts";
import { AU_SCALE } from "../core/kinematics.ts";
import type { Route, RouteNodeKind } from "../travel/types.ts";
import { buildViewModel, type ViewBody } from "./view-model.ts";

export interface RouteLegView {
  centralBodyId: string;
  /** World-unit polyline tracing the leg's transfer arc (nu1 -> nu2). */
  points: { x: number; y: number }[];
}

export interface RouteNodeView {
  id: string;
  kind: RouteNodeKind;
  x: number;
  y: number;
  time: number; // absolute day
  deltaV: number; // km/s
}

export interface RouteGhostView {
  id: string;
  type: string; // ObjectType value or "star"
  x: number;
  y: number;
  visualR: number; // world units
}

export interface RouteView {
  legs: RouteLegView[];
  nodes: RouteNodeView[];
  ghosts: RouteGhostView[];
}

const ARC_SAMPLES = 48;

/** World position + body record of each body at `day`, via the system view-model. */
function bodyAt(system: SolarSystem, day: number): Map<string, ViewBody> {
  const map = new Map<string, ViewBody>();
  for (const b of buildViewModel(system, day)) map.set(b.id, b);
  return map;
}

/** Sample a transfer conic from nu1 to nu2 into a world-unit polyline. */
function sampleArc(
  transfer: { a: number; e: number; argPeriapsis: number; nu1: number; nu2: number },
  centralWorld: { x: number; y: number },
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
    pts.push({ x: centralWorld.x + xAu * AU_SCALE, y: centralWorld.y + yAu * AU_SCALE });
  }
  return pts;
}

/**
 * Convert a Route into plain world-space geometry: one arc polyline per leg, one marker per
 * node (body position at the node's time), and faint ghost discs for the node bodies. The
 * star is fixed at the origin; planetocentric legs anchor their central body at the leg's
 * departTime (a sub-pixel approximation for short escape/capture legs).
 */
export function buildRouteViewModel(system: SolarSystem, route: Route): RouteView {
  const starId = system.star.id;

  // Leg arcs.
  const legs: RouteLegView[] = route.legs.map((leg) => {
    let centralWorld = { x: 0, y: 0 };
    if (leg.centralBodyId !== starId) {
      const central = bodyAt(system, leg.departTime).get(leg.centralBodyId);
      if (central) centralWorld = { x: central.position.x, y: central.position.y };
    }
    return {
      centralBodyId: leg.centralBodyId,
      points: sampleArc(leg.transfer, centralWorld),
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

  return { legs, nodes, ghosts };
}
