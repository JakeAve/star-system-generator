// src/travel/search.ts
import type { OrbitElements } from "./state.ts";
import { sweepTransfers, type TransferCandidate } from "./transfers.ts";
import { buildTerminal, type EndpointBody } from "./terminal.ts";
import {
  EndState,
  RankMode,
  type Route,
  RouteNodeKind,
  type TravelOptions,
} from "./types.ts";
import { AU_M, DAY_S } from "./units.ts";

export interface BodyRef {
  id: string;
  elements: OrbitElements;
  endpoint: EndpointBody;
}

const CODE: Record<EndState, string> = {
  [EndState.Orbit]: "o",
  [EndState.Surface]: "s",
  [EndState.Intercept]: "i",
};

function defaultSweepOpts(fromAu: number, toAu: number, mu: number) {
  const outerM = Math.max(fromAu, toAu) * AU_M;
  // Orbital period at the outer radius about a body of parameter mu: T = 2π√(a³/μ).
  const periodDays = (2 * Math.PI * Math.sqrt((outerM * outerM * outerM) / mu)) /
    DAY_S;
  return {
    departHorizonDays: periodDays,
    departSamples: 36,
    tofMinDays: periodDays * 0.1,
    tofMaxDays: periodDays * 0.9,
    tofSamples: 36,
  };
}

/** Build one Route from a swept transfer candidate. */
function toRoute(
  from: BodyRef,
  to: BodyRef,
  fromState: EndState,
  toState: EndState,
  centralId: string,
  c: TransferCandidate,
): Route {
  const departTerminal = buildTerminal(
    from.endpoint,
    fromState,
    c.vInfDepart,
    "depart",
  );
  const arriveTerminal = buildTerminal(
    to.endpoint,
    toState,
    c.vInfArrive,
    "arrive",
  );
  const departAt = c.departDay;
  const legDepart = departAt + departTerminal.duration;
  const legArrive = legDepart + c.tofDays;
  const arriveTime = legArrive + arriveTerminal.duration;
  const totalDeltaV = departTerminal.totalDeltaV + arriveTerminal.totalDeltaV;
  return {
    bodies: [from.id, to.id],
    nodes: [
      {
        bodyId: from.id,
        time: departAt,
        kind: RouteNodeKind.Depart,
        deltaV: 0,
        terminal: departTerminal,
      },
      {
        bodyId: to.id,
        time: arriveTime,
        kind: RouteNodeKind.Arrive,
        deltaV: 0,
        terminal: arriveTerminal,
      },
    ],
    legs: [{
      fromBodyId: from.id,
      toBodyId: to.id,
      centralBodyId: centralId,
      departTime: legDepart,
      arriveTime: legArrive,
      timeOfFlight: c.tofDays,
      transfer: { a: c.aAu, e: c.e },
      deltaV: 0, // Phase 1: leg energy lives in the terminals; per-leg burns added in later phases
    }],
    departAt,
    duration: arriveTime - departAt,
    totalDeltaV,
    notation: `${from.id}@${CODE[fromState]} > ${to.id}@${CODE[toState]}`,
  };
}

/** Keep non-dominated routes on (totalDeltaV, duration); sort by Δv ascending. */
function pareto(routes: Route[]): Route[] {
  const sorted = [...routes].sort((a, b) =>
    a.totalDeltaV - b.totalDeltaV || a.duration - b.duration
  );
  const keep: Route[] = [];
  let bestDuration = Infinity;
  for (const r of sorted) {
    if (r.duration < bestDuration) {
      keep.push(r);
      bestDuration = r.duration;
    }
  }
  return keep;
}

/** Enumerate direct transfers and rank them. Phase 1: the only topology is from→to. */
export function findDirectRoutes(
  from: BodyRef,
  to: BodyRef,
  fromState: EndState,
  toState: EndState,
  mu: number,
  centralId: string,
  options: TravelOptions,
): Route[] {
  const cands = sweepTransfers(
    from.elements,
    to.elements,
    mu,
    defaultSweepOpts(from.elements.orbitRadiusAu, to.elements.orbitRadiusAu, mu),
  );
  const routes = cands.map((c) =>
    toRoute(from, to, fromState, toState, centralId, c)
  );
  const rank = options.rank ?? RankMode.Pareto;
  if (rank === RankMode.All) return routes;
  if (rank === RankMode.TopN) {
    const w = options.weights ?? { time: 1, deltaV: 1 };
    const score = (r: Route) => w.deltaV * r.totalDeltaV + w.time * r.duration;
    return [...routes].sort((a, b) => score(a) - score(b)).slice(
      0,
      options.topN ?? 5,
    );
  }
  return pareto(routes);
}
