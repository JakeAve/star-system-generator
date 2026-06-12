import type { OrbitElements } from "./state.ts";
import { buildTerminal, type EndpointBody, oberthBurn } from "./terminal.ts";
import { hohmann, type TransferCandidate } from "./transfers.ts";
import {
  EndState,
  type Route,
  type RouteLeg,
  type RouteNode,
  RouteNodeKind,
} from "./types.ts";
import { mpsToKmps, mToAu, sToDay } from "./units.ts";
import { sumPrecise } from "./sum.ts";

/**
 * Hohmann appendage between a low circular orbit at the parent's radius and a moon's
 * orbit radius (both about the parent). The parent-side orbit has free phase, so no
 * moon-phasing wait is needed and this is a pure closed-form transfer.
 */
export function planetoAppendage(
  parent: EndpointBody,
  moonOrbitRadiusM: number,
): {
  legDeltaVMps: number;
  moonVInfMps: number;
  tofDays: number;
  aAu: number;
  e: number;
} {
  const rLow = parent.radiusM;
  const rMoon = moonOrbitRadiusM;
  const h = hohmann(rLow, rMoon, parent.mu);
  return {
    legDeltaVMps: h.dvDepart, // low-orbit-side injection/circularization burn
    moonVInfMps: h.dvArrive, // moon-orbit-side velocity mismatch = capture/escape v∞
    tofDays: sToDay(h.tof),
    aAu: mToAu((rLow + rMoon) / 2),
    e: Math.abs(rMoon - rLow) / (rMoon + rLow),
  };
}

const CODE: Record<EndState, string> = {
  [EndState.Orbit]: "o",
  [EndState.Surface]: "s",
  [EndState.Intercept]: "i",
};

/** One endpoint of a cross-frame route: a planet (anchors to itself) or a moon. */
export interface CrossFrameEndpoint {
  id: string;
  endState: EndState;
  body: EndpointBody; // the endpoint body's own μ/radius (for its terminal)
  anchorId: string; // heliocentric anchor: the planet itself, or a moon's parent
  anchorElements: OrbitElements; // anchor's heliocentric elements (used by the sweep)
  parent?: { body: EndpointBody; moonOrbitRadiusM: number }; // present iff a moon
}

/**
 * Assemble a complete cross-frame route from one heliocentric transfer candidate (between
 * the two anchor planets). Returns null when a moon-departure appendage would push departAt
 * before t=0 — those candidates are covered by later sweep windows.
 */
export function buildCrossFrameRoute(
  from: CrossFrameEndpoint,
  to: CrossFrameEndpoint,
  centralId: string,
  c: TransferCandidate,
): Route | null {
  const fromAp = from.parent
    ? planetoAppendage(from.parent.body, from.parent.moonOrbitRadiusM)
    : null;
  const toAp = to.parent
    ? planetoAppendage(to.parent.body, to.parent.moonOrbitRadiusM)
    : null;

  // Origin terminal: moon uses the appendage mismatch as v∞; planet uses the heliocentric v∞.
  const originVInf = fromAp ? fromAp.moonVInfMps : c.vInfDepart;
  const originTerminal = buildTerminal(
    from.body,
    from.endState,
    originVInf,
    "depart",
  );
  const destVInf = toAp ? toAp.moonVInfMps : c.vInfArrive;
  const destTerminal = buildTerminal(to.body, to.endState, destVInf, "arrive");

  // Heliocentric leg flies at the swept departure; back out departAt for a moon origin.
  const escapeTof = fromAp ? fromAp.tofDays : 0;
  const departAt = c.departDay - escapeTof - originTerminal.duration;
  if (departAt < 0) return null; // window already passed; later candidates cover it

  const nodes: RouteNode[] = [];
  const legs: RouteLeg[] = [];

  // ORIGIN endpoint node.
  nodes.push({
    bodyId: from.id,
    time: departAt,
    kind: RouteNodeKind.Depart,
    deltaV: 0,
    terminal: originTerminal,
  });

  // ESCAPE appendage (moon origin only): planetocentric leg + parent escape Transit.
  const helioDepart = c.departDay;
  if (fromAp && from.parent) {
    const legDepart = departAt + originTerminal.duration;
    legs.push({
      fromBodyId: from.id,
      toBodyId: from.anchorId,
      centralBodyId: from.anchorId,
      departTime: legDepart,
      arriveTime: helioDepart,
      timeOfFlight: fromAp.tofDays,
      transfer: { a: fromAp.aAu, e: fromAp.e },
      deltaV: mpsToKmps(fromAp.legDeltaVMps),
    });
    nodes.push({
      bodyId: from.anchorId,
      time: helioDepart,
      kind: RouteNodeKind.Transit,
      deltaV: mpsToKmps(oberthBurn(from.parent.body, c.vInfDepart)),
      vInfinity: mpsToKmps(c.vInfDepart),
    });
  }

  // HELIOCENTRIC leg between the two anchor planets.
  const helioArrive = helioDepart + c.tofDays;
  legs.push({
    fromBodyId: from.anchorId,
    toBodyId: to.anchorId,
    centralBodyId: centralId,
    departTime: helioDepart,
    arriveTime: helioArrive,
    timeOfFlight: c.tofDays,
    transfer: { a: c.aAu, e: c.e },
    deltaV: 0,
  });

  // CAPTURE appendage (moon destination only): parent capture Transit + planetocentric leg.
  let arriveTime = helioArrive;
  if (toAp && to.parent) {
    nodes.push({
      bodyId: to.anchorId,
      time: helioArrive,
      kind: RouteNodeKind.Transit,
      deltaV: mpsToKmps(oberthBurn(to.parent.body, c.vInfArrive)),
      vInfinity: mpsToKmps(c.vInfArrive),
    });
    arriveTime = helioArrive + toAp.tofDays;
    legs.push({
      fromBodyId: to.anchorId,
      toBodyId: to.id,
      centralBodyId: to.anchorId,
      departTime: helioArrive,
      arriveTime,
      timeOfFlight: toAp.tofDays,
      transfer: { a: toAp.aAu, e: toAp.e },
      deltaV: mpsToKmps(toAp.legDeltaVMps),
    });
  }

  // DESTINATION endpoint node.
  const arriveNodeTime = arriveTime + destTerminal.duration;
  nodes.push({
    bodyId: to.id,
    time: arriveNodeTime,
    kind: RouteNodeKind.Arrive,
    deltaV: 0,
    terminal: destTerminal,
  });

  const totalDeltaV = legs.reduce((s, l) => s + l.deltaV, 0) +
    nodes.reduce((s, n) => s + n.deltaV, 0) +
    originTerminal.totalDeltaV + destTerminal.totalDeltaV;

  return {
    bodies: nodes.map((n) => n.bodyId),
    nodes,
    legs,
    departAt,
    // Precise component sum (leg times + terminal ops) rather than differencing the timeline.
    duration: sumPrecise([
      ...legs.map((l) => l.timeOfFlight),
      originTerminal.duration,
      destTerminal.duration,
    ]),
    totalDeltaV,
    notation: `${from.id}@${CODE[from.endState]} > ${to.id}@${
      CODE[to.endState]
    }`,
  };
}
