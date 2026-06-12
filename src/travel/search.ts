// src/travel/search.ts
import { conic, type OrbitElements, stateAt } from "./state.ts";
import { sweepTransfers, type TransferCandidate } from "./transfers.ts";
import { buildTerminal, type EndpointBody } from "./terminal.ts";
import { solveLambert } from "./lambert.ts";
import { evaluateFlyby, type FlybyResult } from "./flyby.ts";
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

// --- Gravity-assist search (Phase 2 depth 1, Phase 3 depth 2) -----------------------------

/** Single-assist grid is 3D (depart × tof₁ × tof₂); a finer sweep is affordable. */
const ASSIST_DEPART_SAMPLES = 12;
const ASSIST_TOF_SAMPLES = 12;
/** Double-assist grid is 4D (depart × tof₁ × tof₂ × tof₃); a coarser sweep keeps it bounded. */
const DOUBLE_DEPART_SAMPLES = 8;
const DOUBLE_TOF_SAMPLES = 8;
/** Relative threshold for skipping near-collinear (singular) Lambert geometry. */
const COLLINEAR_EPS = 1e-6;
/** Absolute v∞ ceiling (m/s): anything above is a near-singular Lambert artifact. */
const MAX_VINF_MPS = 1e6;

interface Vec {
  x: number;
  y: number;
}

interface LegSolve {
  v1: Vec; // heliocentric velocity at the leg's start
  v2: Vec; // heliocentric velocity at the leg's end
  conic: { aAu: number; e: number };
}

/** Solve one heliocentric Lambert leg, rejecting singular geometry and non-finite results. */
function solveLeg(
  p1: Vec,
  p2: Vec,
  tofDays: number,
  mu: number,
): LegSolve | null {
  const r1 = Math.hypot(p1.x, p1.y);
  const r2 = Math.hypot(p2.x, p2.y);
  const crossZ = p1.x * p2.y - p1.y * p2.x;
  if (Math.abs(crossZ) < COLLINEAR_EPS * r1 * r2) return null;
  const lam = solveLambert(p1, p2, tofDays * DAY_S, mu, true);
  if (!Number.isFinite(lam.v1.x) || !Number.isFinite(lam.v2.x)) return null;
  const c = conic(p1, lam.v1, mu);
  if (!Number.isFinite(c.aAu) || !Number.isFinite(c.e)) return null;
  return { v1: lam.v1, v2: lam.v2, conic: c };
}

/** v∞ magnitude (m/s) of a heliocentric velocity relative to a body's velocity. */
function vInfMag(vHelio: Vec, vBody: Vec): number {
  return Math.hypot(vHelio.x - vBody.x, vHelio.y - vBody.y);
}

/**
 * Evaluate the swing-by that takes incoming heliocentric `vArrive` to outgoing `vDepart` at
 * `via`. Returns null when the reconciling periapsis burn is an absurd Lambert artifact.
 */
function flybyVia(
  via: BodyRef,
  vBody: Vec,
  vArrive: Vec,
  vDepart: Vec,
): FlybyResult | null {
  const vInfIn = { x: vArrive.x - vBody.x, y: vArrive.y - vBody.y };
  const vInfOut = { x: vDepart.x - vBody.x, y: vDepart.y - vBody.y };
  const fb = evaluateFlyby(vInfIn, vInfOut, via.endpoint);
  if (!Number.isFinite(fb.periapsisRadius) || !Number.isFinite(fb.deltaV)) {
    return null;
  }
  if (mpsToKmps(fb.deltaV) > MAX_VINF_MPS) return null;
  return fb;
}

/** One swing-by waypoint: the flyby body, the leg that arrives at it, and its geometry. */
interface FlybyStep {
  via: BodyRef;
  inboundTof: number; // days, the leg arriving at this flyby
  inboundConic: { aAu: number; e: number };
  fb: FlybyResult;
}

/**
 * Assemble a gravity-assist Route from the depart epoch, an ordered list of flyby steps, and
 * the final leg into the destination. Works for any assist depth (1, 2, …). Each leg carries
 * deltaV 0 — escape energy lives in the depart terminal, and each flyby node carries its own
 * powered periapsis burn (0 for an unpowered swing-by, marked `*`; nonzero is marked `+`).
 */
function buildAssistRoute(
  from: BodyRef,
  to: BodyRef,
  fromState: EndState,
  toState: EndState,
  centralId: string,
  departDay: number,
  steps: FlybyStep[],
  finalTof: number,
  finalConic: { aAu: number; e: number },
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
  const nodes: RouteNode[] = [];
  const legs: RouteLeg[] = [];
  const departAt = departDay;
  nodes.push({
    bodyId: from.id,
    time: departAt,
    kind: RouteNodeKind.Depart,
    deltaV: 0,
    terminal: departTerminal,
  });
  let legDepart = departAt + departTerminal.duration;
  let prevId = from.id;
  let flybyDvSum = 0;
  for (const step of steps) {
    const arriveTime = legDepart + step.inboundTof;
    legs.push({
      fromBodyId: prevId,
      toBodyId: step.via.id,
      centralBodyId: centralId,
      departTime: legDepart,
      arriveTime,
      timeOfFlight: step.inboundTof,
      transfer: { a: step.inboundConic.aAu, e: step.inboundConic.e },
      deltaV: 0,
    });
    const flybyDv = mpsToKmps(step.fb.deltaV);
    flybyDvSum += flybyDv;
    nodes.push({
      bodyId: step.via.id,
      time: arriveTime,
      kind: RouteNodeKind.Flyby,
      deltaV: flybyDv,
      flyby: {
        periapsisRadius: step.fb.periapsisRadius / 1000, // m → km
        vInfinity: mpsToKmps(step.fb.vInfinity),
        turnAngle: step.fb.turnAngle,
      },
    });
    prevId = step.via.id;
    legDepart = arriveTime;
  }
  const destArrive = legDepart + finalTof;
  legs.push({
    fromBodyId: prevId,
    toBodyId: to.id,
    centralBodyId: centralId,
    departTime: legDepart,
    arriveTime: destArrive,
    timeOfFlight: finalTof,
    transfer: { a: finalConic.aAu, e: finalConic.e },
    deltaV: 0,
  });
  const arriveTime = destArrive + arriveTerminal.duration;
  nodes.push({
    bodyId: to.id,
    time: arriveTime,
    kind: RouteNodeKind.Arrive,
    deltaV: 0,
    terminal: arriveTerminal,
  });
  const totalDeltaV = departTerminal.totalDeltaV + flybyDvSum +
    arriveTerminal.totalDeltaV;
  const mid = steps
    .map((s) => (mpsToKmps(s.fb.deltaV) > 1e-6 ? "+" : "*") + s.via.id)
    .join(" > ");
  return {
    bodies: nodes.map((n) => n.bodyId),
    nodes,
    legs,
    departAt,
    duration: arriveTime - departAt,
    totalDeltaV,
    notation: `${from.id}@${CODE[fromState]} > ${mid} > ${to.id}@${
      CODE[toState]
    }`,
  };
}

/** Even sampling step over a closed range with `samples` points (last - first inclusive). */
function step(min: number, max: number, samples: number): number {
  return (max - min) / Math.max(1, samples - 1);
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
  const dStep = step(0, departHorizon, ASSIST_DEPART_SAMPLES);
  const t1Step = step(opt1.tofMinDays, opt1.tofMaxDays, ASSIST_TOF_SAMPLES);
  const t2Step = step(opt2.tofMinDays, opt2.tofMaxDays, ASSIST_TOF_SAMPLES);
  const out: Route[] = [];

  for (let i = 0; i < ASSIST_DEPART_SAMPLES; i++) {
    const departDay = i * dStep;
    const sFrom = stateAt(from.elements, mu, departDay);
    for (let j = 0; j < ASSIST_TOF_SAMPLES; j++) {
      const tof1 = opt1.tofMinDays + j * t1Step;
      if (tof1 <= 0) continue;
      const flybyDay = departDay + tof1;
      const sVia = stateAt(via.elements, mu, flybyDay);
      const leg1 = solveLeg(sFrom.position, sVia.position, tof1, mu);
      if (!leg1) continue;
      const vInfDepart = vInfMag(leg1.v1, sFrom.velocity);
      if (vInfDepart > MAX_VINF_MPS) continue;
      for (let k = 0; k < ASSIST_TOF_SAMPLES; k++) {
        const tof2 = opt2.tofMinDays + k * t2Step;
        if (tof2 <= 0) continue;
        const sTo = stateAt(to.elements, mu, flybyDay + tof2);
        const leg2 = solveLeg(sVia.position, sTo.position, tof2, mu);
        if (!leg2) continue;
        const vInfArrive = vInfMag(leg2.v2, sTo.velocity);
        if (vInfArrive > MAX_VINF_MPS) continue;
        const fb = flybyVia(via, sVia.velocity, leg1.v2, leg2.v1);
        if (!fb) continue;
        out.push(
          buildAssistRoute(
            from,
            to,
            fromState,
            toState,
            centralId,
            departDay,
            [{ via, inboundTof: tof1, inboundConic: leg1.conic, fb }],
            tof2,
            leg2.conic,
            vInfDepart,
            vInfArrive,
          ),
        );
      }
    }
  }
  return out;
}

/** Sweep the (depart × tof₁ × tof₂ × tof₃) grid for an ordered flyby pair (f1 then f2). */
function sweepDoubleAssist(
  from: BodyRef,
  to: BodyRef,
  f1: BodyRef,
  f2: BodyRef,
  fromState: EndState,
  toState: EndState,
  mu: number,
  centralId: string,
): Route[] {
  const opt1 = defaultSweepOpts(
    from.elements.orbitRadiusAu,
    f1.elements.orbitRadiusAu,
    mu,
  );
  const opt2 = defaultSweepOpts(
    f1.elements.orbitRadiusAu,
    f2.elements.orbitRadiusAu,
    mu,
  );
  const opt3 = defaultSweepOpts(
    f2.elements.orbitRadiusAu,
    to.elements.orbitRadiusAu,
    mu,
  );
  const departHorizon = Math.max(
    opt1.departHorizonDays,
    opt2.departHorizonDays,
    opt3.departHorizonDays,
  );
  const dStep = step(0, departHorizon, DOUBLE_DEPART_SAMPLES);
  const t1Step = step(opt1.tofMinDays, opt1.tofMaxDays, DOUBLE_TOF_SAMPLES);
  const t2Step = step(opt2.tofMinDays, opt2.tofMaxDays, DOUBLE_TOF_SAMPLES);
  const t3Step = step(opt3.tofMinDays, opt3.tofMaxDays, DOUBLE_TOF_SAMPLES);
  const out: Route[] = [];

  for (let i = 0; i < DOUBLE_DEPART_SAMPLES; i++) {
    const departDay = i * dStep;
    const sFrom = stateAt(from.elements, mu, departDay);
    for (let j = 0; j < DOUBLE_TOF_SAMPLES; j++) {
      const tof1 = opt1.tofMinDays + j * t1Step;
      if (tof1 <= 0) continue;
      const f1Day = departDay + tof1;
      const sF1 = stateAt(f1.elements, mu, f1Day);
      const leg1 = solveLeg(sFrom.position, sF1.position, tof1, mu);
      if (!leg1) continue;
      const vInfDepart = vInfMag(leg1.v1, sFrom.velocity);
      if (vInfDepart > MAX_VINF_MPS) continue;
      for (let k = 0; k < DOUBLE_TOF_SAMPLES; k++) {
        const tof2 = opt2.tofMinDays + k * t2Step;
        if (tof2 <= 0) continue;
        const f2Day = f1Day + tof2;
        const sF2 = stateAt(f2.elements, mu, f2Day);
        const leg2 = solveLeg(sF1.position, sF2.position, tof2, mu);
        if (!leg2) continue;
        // F1 swing-by: heliocentric arrival (leg1) → heliocentric departure (leg2).
        const fb1 = flybyVia(f1, sF1.velocity, leg1.v2, leg2.v1);
        if (!fb1) continue;
        for (let l = 0; l < DOUBLE_TOF_SAMPLES; l++) {
          const tof3 = opt3.tofMinDays + l * t3Step;
          if (tof3 <= 0) continue;
          const sTo = stateAt(to.elements, mu, f2Day + tof3);
          const leg3 = solveLeg(sF2.position, sTo.position, tof3, mu);
          if (!leg3) continue;
          const vInfArrive = vInfMag(leg3.v2, sTo.velocity);
          if (vInfArrive > MAX_VINF_MPS) continue;
          // F2 swing-by: heliocentric arrival (leg2) → heliocentric departure (leg3).
          const fb2 = flybyVia(f2, sF2.velocity, leg2.v2, leg3.v1);
          if (!fb2) continue;
          out.push(
            buildAssistRoute(
              from,
              to,
              fromState,
              toState,
              centralId,
              departDay,
              [
                {
                  via: f1,
                  inboundTof: tof1,
                  inboundConic: leg1.conic,
                  fb: fb1,
                },
                {
                  via: f2,
                  inboundTof: tof2,
                  inboundConic: leg2.conic,
                  fb: fb2,
                },
              ],
              tof3,
              leg3.conic,
              vInfDepart,
              vInfArrive,
            ),
          );
        }
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

/**
 * Enumerate double-gravity-assist routes (origin → F1 → F2 → destination) over every ordered
 * pair of distinct `flybyBodies`, then rank. MGA coupling is handled per swing-by: each flyby
 * node carries the periapsis burn that reconciles its incoming and outgoing v∞ vectors, so the
 * cheap near-unpowered chains surface naturally under Pareto pruning.
 */
export function findDoubleAssistRoutes(
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
  for (const f1 of flybyBodies) {
    for (const f2 of flybyBodies) {
      if (f1.id === f2.id) continue;
      routes.push(
        ...sweepDoubleAssist(
          from,
          to,
          f1,
          f2,
          fromState,
          toState,
          mu,
          centralId,
        ),
      );
    }
  }
  return rankRoutes(routes, options);
}
