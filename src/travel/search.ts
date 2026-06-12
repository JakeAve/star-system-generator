// src/travel/search.ts
import { conic, type OrbitElements, stateAt } from "./state.ts";
import { sweepTransfers, type TransferCandidate } from "./transfers.ts";
import { buildTerminal, type EndpointBody } from "./terminal.ts";
import { solveLambert } from "./lambert.ts";
import { evaluateFlyby } from "./flyby.ts";
import {
  EndState,
  RankMode,
  type Route,
  type RouteLeg,
  type RouteNode,
  RouteNodeKind,
  type TravelOptions,
} from "./types.ts";
import { AU_M, DAY_S, mpsToKmps } from "./units.ts";
import { buildCrossFrameRoute, type CrossFrameEndpoint } from "./legs.ts";

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
  const periodDays =
    (2 * Math.PI * Math.sqrt((outerM * outerM * outerM) / mu)) /
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

/** Select/trim a route set per the requested ranking mode. */
export function rankRoutes(routes: Route[], options: TravelOptions): Route[] {
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
    defaultSweepOpts(
      from.elements.orbitRadiusAu,
      to.elements.orbitRadiusAu,
      mu,
    ),
  );
  const routes = cands.map((c) =>
    toRoute(from, to, fromState, toState, centralId, c)
  );
  return rankRoutes(routes, options);
}

/**
 * Enumerate routes where at least one endpoint is a moon of a different parent. Sweeps the
 * heliocentric spine between the two anchor planets, then maps each candidate through
 * buildCrossFrameRoute (which attaches planetocentric appendages and Transit nodes).
 */
export function findCrossFrameRoutes(
  from: CrossFrameEndpoint,
  to: CrossFrameEndpoint,
  centralId: string,
  mu: number,
  options: TravelOptions,
): Route[] {
  const cands = sweepTransfers(
    from.anchorElements,
    to.anchorElements,
    mu,
    defaultSweepOpts(
      from.anchorElements.orbitRadiusAu,
      to.anchorElements.orbitRadiusAu,
      mu,
    ),
  );
  const routes: Route[] = [];
  for (const c of cands) {
    const r = buildCrossFrameRoute(from, to, centralId, c);
    if (r) routes.push(r);
  }
  return rankRoutes(routes, options);
}

// --- Single gravity assist (Phase 2, depth 1) ---------------------------------------------

/** Coarser than the direct sweep — the assist search is a 3D grid (depart × tof₁ × tof₂). */
const ASSIST_DEPART_SAMPLES = 12;
const ASSIST_TOF_SAMPLES = 12;
/** Relative threshold for skipping near-collinear (singular) Lambert geometry. */
const COLLINEAR_EPS = 1e-6;
/** Absolute v∞ ceiling (m/s): anything above is a near-singular Lambert artifact. */
const MAX_VINF_MPS = 1e6;

/** Build one single-assist Route from a swept (depart, flyby, arrive) triple. */
function toAssistRoute(
  from: BodyRef,
  to: BodyRef,
  via: BodyRef,
  fromState: EndState,
  toState: EndState,
  centralId: string,
  departDay: number,
  tof1: number,
  tof2: number,
  leg1Conic: { aAu: number; e: number },
  leg2Conic: { aAu: number; e: number },
  fb: {
    deltaV: number;
    periapsisRadius: number;
    turnAngle: number;
    vInfinity: number;
  },
  vInfDepart: number,
  vInfArrive: number,
): Route {
  const departTerminal = buildTerminal(
    from.endpoint,
    fromState,
    vInfDepart,
    "depart",
  );
  const arriveTerminal = buildTerminal(
    to.endpoint,
    toState,
    vInfArrive,
    "arrive",
  );
  const departAt = departDay;
  const leg1Depart = departAt + departTerminal.duration;
  const flybyTime = leg1Depart + tof1;
  const leg2Arrive = flybyTime + tof2;
  const arriveTime = leg2Arrive + arriveTerminal.duration;
  const flybyDv = mpsToKmps(fb.deltaV);
  const totalDeltaV = departTerminal.totalDeltaV + flybyDv +
    arriveTerminal.totalDeltaV;
  const marker = flybyDv > 1e-6 ? "+" : "*";
  const nodes: RouteNode[] = [
    {
      bodyId: from.id,
      time: departAt,
      kind: RouteNodeKind.Depart,
      deltaV: 0,
      terminal: departTerminal,
    },
    {
      bodyId: via.id,
      time: flybyTime,
      kind: RouteNodeKind.Flyby,
      deltaV: flybyDv,
      flyby: {
        periapsisRadius: fb.periapsisRadius / 1000, // m → km
        vInfinity: mpsToKmps(fb.vInfinity),
        turnAngle: fb.turnAngle,
      },
    },
    {
      bodyId: to.id,
      time: arriveTime,
      kind: RouteNodeKind.Arrive,
      deltaV: 0,
      terminal: arriveTerminal,
    },
  ];
  const legs: RouteLeg[] = [
    {
      fromBodyId: from.id,
      toBodyId: via.id,
      centralBodyId: centralId,
      departTime: leg1Depart,
      arriveTime: flybyTime,
      timeOfFlight: tof1,
      transfer: { a: leg1Conic.aAu, e: leg1Conic.e },
      deltaV: 0, // escape energy lives in the depart terminal
    },
    {
      fromBodyId: via.id,
      toBodyId: to.id,
      centralBodyId: centralId,
      departTime: flybyTime,
      arriveTime: leg2Arrive,
      timeOfFlight: tof2,
      transfer: { a: leg2Conic.aAu, e: leg2Conic.e },
      deltaV: 0, // the flyby node carries any powered correction
    },
  ];
  return {
    bodies: [from.id, via.id, to.id],
    nodes,
    legs,
    departAt,
    duration: arriveTime - departAt,
    totalDeltaV,
    notation: `${from.id}@${CODE[fromState]} > ${marker}${via.id} > ${to.id}@${
      CODE[toState]
    }`,
  };
}

/** Sweep the (depart × tof₁ × tof₂) grid for one flyby body and emit feasible assist routes. */
function sweepAssist(
  from: BodyRef,
  to: BodyRef,
  via: BodyRef,
  fromState: EndState,
  toState: EndState,
  mu: number,
  centralId: string,
): Route[] {
  const opt1 = defaultSweepOpts(
    from.elements.orbitRadiusAu,
    via.elements.orbitRadiusAu,
    mu,
  );
  const opt2 = defaultSweepOpts(
    via.elements.orbitRadiusAu,
    to.elements.orbitRadiusAu,
    mu,
  );
  const departHorizon = Math.max(
    opt1.departHorizonDays,
    opt2.departHorizonDays,
  );
  const dStep = departHorizon / Math.max(1, ASSIST_DEPART_SAMPLES - 1);
  const t1Step = (opt1.tofMaxDays - opt1.tofMinDays) /
    Math.max(1, ASSIST_TOF_SAMPLES - 1);
  const t2Step = (opt2.tofMaxDays - opt2.tofMinDays) /
    Math.max(1, ASSIST_TOF_SAMPLES - 1);
  const out: Route[] = [];

  for (let i = 0; i < ASSIST_DEPART_SAMPLES; i++) {
    const departDay = i * dStep;
    const sFrom = stateAt(from.elements, mu, departDay);
    const r0 = Math.hypot(sFrom.position.x, sFrom.position.y);
    for (let j = 0; j < ASSIST_TOF_SAMPLES; j++) {
      const tof1 = opt1.tofMinDays + j * t1Step;
      if (tof1 <= 0) continue;
      const flybyDay = departDay + tof1;
      const sVia = stateAt(via.elements, mu, flybyDay);
      const rV = Math.hypot(sVia.position.x, sVia.position.y);
      const cross1 = sFrom.position.x * sVia.position.y -
        sFrom.position.y * sVia.position.x;
      if (Math.abs(cross1) < COLLINEAR_EPS * r0 * rV) continue;
      const lam1 = solveLambert(
        sFrom.position,
        sVia.position,
        tof1 * DAY_S,
        mu,
        true,
      );
      if (!Number.isFinite(lam1.v1.x) || !Number.isFinite(lam1.v2.x)) continue;
      const c1 = conic(sFrom.position, lam1.v1, mu);
      if (!Number.isFinite(c1.aAu) || !Number.isFinite(c1.e)) continue;
      const vInfDepart = Math.hypot(
        lam1.v1.x - sFrom.velocity.x,
        lam1.v1.y - sFrom.velocity.y,
      );
      if (vInfDepart > MAX_VINF_MPS) continue;
      const vInfIn = {
        x: lam1.v2.x - sVia.velocity.x,
        y: lam1.v2.y - sVia.velocity.y,
      };
      for (let k = 0; k < ASSIST_TOF_SAMPLES; k++) {
        const tof2 = opt2.tofMinDays + k * t2Step;
        if (tof2 <= 0) continue;
        const arriveDay = flybyDay + tof2;
        const sTo = stateAt(to.elements, mu, arriveDay);
        const rT = Math.hypot(sTo.position.x, sTo.position.y);
        const cross2 = sVia.position.x * sTo.position.y -
          sVia.position.y * sTo.position.x;
        if (Math.abs(cross2) < COLLINEAR_EPS * rV * rT) continue;
        const lam2 = solveLambert(
          sVia.position,
          sTo.position,
          tof2 * DAY_S,
          mu,
          true,
        );
        if (!Number.isFinite(lam2.v1.x) || !Number.isFinite(lam2.v2.x)) {
          continue;
        }
        const c2 = conic(sVia.position, lam2.v1, mu);
        if (!Number.isFinite(c2.aAu) || !Number.isFinite(c2.e)) continue;
        const vInfArrive = Math.hypot(
          lam2.v2.x - sTo.velocity.x,
          lam2.v2.y - sTo.velocity.y,
        );
        if (vInfArrive > MAX_VINF_MPS) continue;
        const vInfOut = {
          x: lam2.v1.x - sVia.velocity.x,
          y: lam2.v1.y - sVia.velocity.y,
        };
        const fb = evaluateFlyby(vInfIn, vInfOut, via.endpoint);
        if (
          !Number.isFinite(fb.periapsisRadius) || !Number.isFinite(fb.deltaV)
        ) {
          continue;
        }
        if (mpsToKmps(fb.deltaV) > MAX_VINF_MPS) continue;
        out.push(
          toAssistRoute(
            from,
            to,
            via,
            fromState,
            toState,
            centralId,
            departDay,
            tof1,
            tof2,
            c1,
            c2,
            fb,
            vInfDepart,
            vInfArrive,
          ),
        );
      }
    }
  }
  return out;
}

/**
 * Enumerate single-gravity-assist routes (origin → flyby planet → destination) over the
 * candidate `flybyBodies`, then rank. Each flyby is unpowered (`*`) when the swing-by alone
 * delivers the outgoing velocity, or powered (`+`) when a periapsis burn closes the residual.
 */
export function findSingleAssistRoutes(
  from: BodyRef,
  to: BodyRef,
  fromState: EndState,
  toState: EndState,
  flybyBodies: BodyRef[],
  mu: number,
  centralId: string,
  options: TravelOptions,
): Route[] {
  const routes: Route[] = [];
  for (const via of flybyBodies) {
    routes.push(
      ...sweepAssist(from, to, via, fromState, toState, mu, centralId),
    );
  }
  return rankRoutes(routes, options);
}
