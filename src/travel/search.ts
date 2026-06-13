// src/travel/search.ts
import { conic, type OrbitElements, stateAt } from "./state.ts";
import {
  type ReframeSweep,
  sweepTransfers,
  type TransferCandidate,
} from "./transfers.ts";
import {
  combinedRecurrenceDays,
  DEFAULT_REFRAME,
  orbitalPeriodDays,
  reframeCount,
  synodicPeriodDays,
} from "./recurrence.ts";
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
import { DAY_S, mpsToKmps } from "./units.ts";
import { buildCrossFrameRoute, type CrossFrameEndpoint } from "./legs.ts";
import { sumPrecise } from "./sum.ts";

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

function defaultSweepOpts(
  fromAu: number,
  toAu: number,
  mu: number,
  departWindowDays?: number,
  reframe?: boolean,
) {
  const innerPeriod = orbitalPeriodDays(Math.min(fromAu, toAu), mu);
  const outerPeriod = orbitalPeriodDays(Math.max(fromAu, toAu), mu);
  // Launch windows recur on the synodic period (how often the two bodies return to the same
  // relative geometry), not the orbital period. One synodic period samples every distinct
  // departure geometry exactly once; near-coorbital bodies send it to infinity, so cap it at
  // the outer period.
  const synodicPeriod = synodicPeriodDays(innerPeriod, outerPeriod);
  const recurDays = Math.min(synodicPeriod, outerPeriod);
  // Default (fixed) horizon: the player window if given, else one synodic recurrence. The reframe
  // additionally caps the window at the recurrence period — beyond it is only repeats of sampled
  // geometries, and projection (getBestRoutes3) maps each opportunity into the window instead.
  const departHorizonDays = reframe
    ? Math.min(departWindowDays ?? Infinity, recurDays)
    : (departWindowDays ?? recurDays);
  return {
    departHorizonDays,
    departSamples: 36,
    tofMinDays: outerPeriod * 0.1,
    tofMaxDays: outerPeriod * 0.9,
    tofSamples: 36,
    recurDays,
  };
}

/** True when options request the resolution-target reframe sweep. */
function isResolutionTarget(options: TravelOptions): boolean {
  return options.sweep?.kind === "resolutionTarget";
}

/** Build the porkchop reframe overrides from options.sweep for a given recurrence period.
 * Returns undefined unless options.sweep is the resolutionTarget mode. */
function reframeFor(
  options: TravelOptions,
  recurDays: number,
): ReframeSweep | undefined {
  const s = options.sweep;
  if (!s || s.kind !== "resolutionTarget") return undefined;
  return {
    deltaD: s.deltaD, minD: s.minD, maxD: s.maxD,
    deltaT: s.deltaT, minT: s.minT, maxT: s.maxT,
    recurDays,
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
    // Sum the positive components rather than differencing the absolute timeline
    // (arriveTime - departAt), which loses precision for late departures.
    duration: sumPrecise([
      departTerminal.duration,
      c.tofDays,
      arriveTerminal.duration,
    ]),
    totalDeltaV,
    notation: `${from.id}@${CODE[fromState]} > ${to.id}@${CODE[toState]}`,
    ...(c.phaseDay !== undefined
      ? { phaseDay: c.phaseDay, recurDays: c.recurDays }
      : {}),
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
  const reframeOn = isResolutionTarget(options);
  const opts = defaultSweepOpts(
    from.elements.orbitRadiusAu,
    to.elements.orbitRadiusAu,
    mu,
    options.departWindowDays,
    reframeOn,
  );
  const reframe = reframeFor(options, opts.recurDays);
  const cands = sweepTransfers(from.elements, to.elements, mu, opts, reframe);
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
  const reframeOn = isResolutionTarget(options);
  const opts = defaultSweepOpts(
    from.anchorElements.orbitRadiusAu,
    to.anchorElements.orbitRadiusAu,
    mu,
    options.departWindowDays,
    reframeOn,
  );
  const reframe = reframeFor(options, opts.recurDays);
  const cands = sweepTransfers(
    from.anchorElements,
    to.anchorElements,
    mu,
    opts,
    reframe,
  );
  const routes: Route[] = [];
  for (const c of cands) {
    const r = buildCrossFrameRoute(from, to, centralId, c);
    if (r) {
      if (c.phaseDay !== undefined) {
        r.phaseDay = c.phaseDay;
        r.recurDays = c.recurDays;
      }
      routes.push(r);
    }
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
    // Sum the positive leg/terminal components rather than differencing the absolute timeline.
    duration: sumPrecise([
      departTerminal.duration,
      ...steps.map((s) => s.inboundTof),
      finalTof,
      arriveTerminal.duration,
    ]),
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

/** Per-axis assist grid: sample count + step, plus the depart horizon and recurrence tag. */
interface AssistGrid {
  departSamples: number;
  dStep: number;
  tofSteps: number[]; // one step per tof axis, ordered
  tofCounts: number[]; // one count per tof axis, ordered
  recurDays: number; // T_combined to tag emitted routes with
}

/**
 * Reframe grid for an assist chain. `chainAus` is [originAu, via1Au, …, destAu]; `tofRanges` is one
 * [min, max] per tof axis (origin→via1, via1→via2, …, →dest). T_combined is the approximate capped
 * LCM of the from-relative synodic periods of every non-origin body, capped at the chain's outer
 * orbital period. Depart and tof axes use resolution-target spacing with the lower assist clamps.
 * Returns null when options.sweep is not the resolutionTarget mode.
 */
function assistReframeGrid(
  chainAus: number[],
  tofRanges: [number, number][],
  mu: number,
  options: TravelOptions,
): AssistGrid | null {
  const s = options.sweep;
  if (!s || s.kind !== "resolutionTarget") return null;
  const originPeriod = orbitalPeriodDays(chainAus[0], mu);
  const relSynodics = chainAus.slice(1).map((au) =>
    synodicPeriodDays(orbitalPeriodDays(au, mu), originPeriod)
  );
  const outerPeriod = orbitalPeriodDays(Math.max(...chainAus), mu);
  const recurDays = combinedRecurrenceDays(relSynodics, outerPeriod);
  const horizon = Math.min(options.departWindowDays ?? Infinity, recurDays);
  const maxD = Math.min(s.maxD, DEFAULT_REFRAME.maxDAssist);
  const maxT = Math.min(s.maxT, DEFAULT_REFRAME.maxTAssist);
  const d = reframeCount(horizon, s.deltaD, Math.min(s.minD, maxD), maxD);
  const tof = tofRanges.map(([lo, hi]) =>
    reframeCount(hi - lo, s.deltaT, Math.min(s.minT, maxT), maxT)
  );
  return {
    departSamples: d.count,
    dStep: d.step,
    tofSteps: tof.map((t) => t.step),
    tofCounts: tof.map((t) => t.count),
    recurDays,
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
  options: TravelOptions,
): Route[] {
  const opt1 = defaultSweepOpts(
    from.elements.orbitRadiusAu,
    via.elements.orbitRadiusAu,
    mu,
    options.departWindowDays,
  );
  const opt2 = defaultSweepOpts(
    via.elements.orbitRadiusAu,
    to.elements.orbitRadiusAu,
    mu,
    options.departWindowDays,
  );
  const grid = assistReframeGrid(
    [
      from.elements.orbitRadiusAu,
      via.elements.orbitRadiusAu,
      to.elements.orbitRadiusAu,
    ],
    [
      [opt1.tofMinDays, opt1.tofMaxDays],
      [opt2.tofMinDays, opt2.tofMaxDays],
    ],
    mu,
    options,
  );
  const departSamples = grid ? grid.departSamples : ASSIST_DEPART_SAMPLES;
  const dStep = grid
    ? grid.dStep
    : step(
      0,
      Math.max(opt1.departHorizonDays, opt2.departHorizonDays),
      ASSIST_DEPART_SAMPLES,
    );
  const t1Count = grid ? grid.tofCounts[0] : ASSIST_TOF_SAMPLES;
  const t1Step = grid
    ? grid.tofSteps[0]
    : step(opt1.tofMinDays, opt1.tofMaxDays, ASSIST_TOF_SAMPLES);
  const t2Count = grid ? grid.tofCounts[1] : ASSIST_TOF_SAMPLES;
  const t2Step = grid
    ? grid.tofSteps[1]
    : step(opt2.tofMinDays, opt2.tofMaxDays, ASSIST_TOF_SAMPLES);
  const out: Route[] = [];

  for (let i = 0; i < departSamples; i++) {
    const departDay = i * dStep;
    const sFrom = stateAt(from.elements, mu, departDay);
    for (let j = 0; j < t1Count; j++) {
      const tof1 = opt1.tofMinDays + j * t1Step;
      if (tof1 <= 0) continue;
      const flybyDay = departDay + tof1;
      const sVia = stateAt(via.elements, mu, flybyDay);
      const leg1 = solveLeg(sFrom.position, sVia.position, tof1, mu);
      if (!leg1) continue;
      const vInfDepart = vInfMag(leg1.v1, sFrom.velocity);
      if (vInfDepart > MAX_VINF_MPS) continue;
      for (let k = 0; k < t2Count; k++) {
        const tof2 = opt2.tofMinDays + k * t2Step;
        if (tof2 <= 0) continue;
        const sTo = stateAt(to.elements, mu, flybyDay + tof2);
        const leg2 = solveLeg(sVia.position, sTo.position, tof2, mu);
        if (!leg2) continue;
        const vInfArrive = vInfMag(leg2.v2, sTo.velocity);
        if (vInfArrive > MAX_VINF_MPS) continue;
        const fb = flybyVia(via, sVia.velocity, leg1.v2, leg2.v1);
        if (!fb) continue;
        const r = buildAssistRoute(
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
        );
        if (grid) {
          r.phaseDay = departDay;
          r.recurDays = grid.recurDays;
        }
        out.push(r);
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
  options: TravelOptions,
): Route[] {
  const opt1 = defaultSweepOpts(
    from.elements.orbitRadiusAu,
    f1.elements.orbitRadiusAu,
    mu,
    options.departWindowDays,
  );
  const opt2 = defaultSweepOpts(
    f1.elements.orbitRadiusAu,
    f2.elements.orbitRadiusAu,
    mu,
    options.departWindowDays,
  );
  const opt3 = defaultSweepOpts(
    f2.elements.orbitRadiusAu,
    to.elements.orbitRadiusAu,
    mu,
    options.departWindowDays,
  );
  const grid = assistReframeGrid(
    [
      from.elements.orbitRadiusAu,
      f1.elements.orbitRadiusAu,
      f2.elements.orbitRadiusAu,
      to.elements.orbitRadiusAu,
    ],
    [
      [opt1.tofMinDays, opt1.tofMaxDays],
      [opt2.tofMinDays, opt2.tofMaxDays],
      [opt3.tofMinDays, opt3.tofMaxDays],
    ],
    mu,
    options,
  );
  const departSamples = grid ? grid.departSamples : DOUBLE_DEPART_SAMPLES;
  const dStep = grid
    ? grid.dStep
    : step(
      0,
      Math.max(
        opt1.departHorizonDays,
        opt2.departHorizonDays,
        opt3.departHorizonDays,
      ),
      DOUBLE_DEPART_SAMPLES,
    );
  const t1Count = grid ? grid.tofCounts[0] : DOUBLE_TOF_SAMPLES;
  const t1Step = grid
    ? grid.tofSteps[0]
    : step(opt1.tofMinDays, opt1.tofMaxDays, DOUBLE_TOF_SAMPLES);
  const t2Count = grid ? grid.tofCounts[1] : DOUBLE_TOF_SAMPLES;
  const t2Step = grid
    ? grid.tofSteps[1]
    : step(opt2.tofMinDays, opt2.tofMaxDays, DOUBLE_TOF_SAMPLES);
  const t3Count = grid ? grid.tofCounts[2] : DOUBLE_TOF_SAMPLES;
  const t3Step = grid
    ? grid.tofSteps[2]
    : step(opt3.tofMinDays, opt3.tofMaxDays, DOUBLE_TOF_SAMPLES);
  const out: Route[] = [];

  for (let i = 0; i < departSamples; i++) {
    const departDay = i * dStep;
    const sFrom = stateAt(from.elements, mu, departDay);
    for (let j = 0; j < t1Count; j++) {
      const tof1 = opt1.tofMinDays + j * t1Step;
      if (tof1 <= 0) continue;
      const f1Day = departDay + tof1;
      const sF1 = stateAt(f1.elements, mu, f1Day);
      const leg1 = solveLeg(sFrom.position, sF1.position, tof1, mu);
      if (!leg1) continue;
      const vInfDepart = vInfMag(leg1.v1, sFrom.velocity);
      if (vInfDepart > MAX_VINF_MPS) continue;
      for (let k = 0; k < t2Count; k++) {
        const tof2 = opt2.tofMinDays + k * t2Step;
        if (tof2 <= 0) continue;
        const f2Day = f1Day + tof2;
        const sF2 = stateAt(f2.elements, mu, f2Day);
        const leg2 = solveLeg(sF1.position, sF2.position, tof2, mu);
        if (!leg2) continue;
        const fb1 = flybyVia(f1, sF1.velocity, leg1.v2, leg2.v1);
        if (!fb1) continue;
        for (let l = 0; l < t3Count; l++) {
          const tof3 = opt3.tofMinDays + l * t3Step;
          if (tof3 <= 0) continue;
          const sTo = stateAt(to.elements, mu, f2Day + tof3);
          const leg3 = solveLeg(sF2.position, sTo.position, tof3, mu);
          if (!leg3) continue;
          const vInfArrive = vInfMag(leg3.v2, sTo.velocity);
          if (vInfArrive > MAX_VINF_MPS) continue;
          const fb2 = flybyVia(f2, sF2.velocity, leg2.v2, leg3.v1);
          if (!fb2) continue;
          const r = buildAssistRoute(
            from,
            to,
            fromState,
            toState,
            centralId,
            departDay,
            [
              { via: f1, inboundTof: tof1, inboundConic: leg1.conic, fb: fb1 },
              { via: f2, inboundTof: tof2, inboundConic: leg2.conic, fb: fb2 },
            ],
            tof3,
            leg3.conic,
            vInfDepart,
            vInfArrive,
          );
          if (grid) {
            r.phaseDay = departDay;
            r.recurDays = grid.recurDays;
          }
          out.push(r);
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
      ...sweepAssist(from, to, via, fromState, toState, mu, centralId, options),
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
        ...sweepDoubleAssist(from, to, f1, f2, fromState, toState, mu, centralId, options),
      );
    }
  }
  return rankRoutes(routes, options);
}

// --- Single-objective branch-and-bound (experimental) -------------------------------------
//
// EXPERIMENT: an A*/branch-and-bound alternative to enumerate-then-Pareto. Sweeps the SAME
// grid as the find* functions, but optimises ONE objective at a time and prunes any partial
// chain whose lower-bound cost already exceeds the best complete route found so far.
//
// All three objectives admit an admissible lower bound, because extending a partial chain
// only grows both totals: totalDeltaV is a sum of non-negative terminal/flyby burns, and
// duration is a sum of positive times-of-flight (terminals contribute 0 today). For
// "goldilocks" the cost is normalised distance to the utopia corner (minΔv, minTime); since
// distance is monotonic in both coordinates (clamped at the corner), the partial point is a
// valid lower bound there too. Searching the same grid means the optimum is identical to the
// corresponding Pareto-front pick; only the wasted work differs.

export type Objective = "deltaV" | "duration" | "arrival" | "goldilocks";

/**
 * Normalisation ranges for a balance ("goldilocks") objective. Each axis is optional; only the
 * axes present participate in the utopia distance. Today's Δv×duration goldilocks supplies only
 * the dv* and dur* fields; the arrival axis (arr*) is added for the Tier-C balances.
 */
export interface UtopiaBox {
  dvMin?: number;
  dvMax?: number;
  durMin?: number;
  durMax?: number;
  arrMin?: number;
  arrMax?: number;
}

export interface SearchOpts {
  box?: UtopiaBox; // required for obj === "goldilocks"
  initialBest?: number; // seed the incumbent bound (e.g. anchor distance for goldilocks)
  initialIncumbent?: Route | null;
  departWindowDays?: number; // cap the depart-time horizon (days from now)
  // When set with a departWindowDays, the depth-0 (direct) departure horizon is additionally
  // capped at one synodic period: beyond it is only repeats of geometries already sampled, so a
  // wide game window must not push a direct departure to a needlessly-late recurrence.
  capDirectDepartAtSynodic?: boolean;
}

/**
 * Pick the fastest / cheapest / goldilocks routes from an already-enumerated candidate set,
 * matching searchBest's objective semantics. Used for topologies the branch-and-bound search
 * doesn't cover (moon endpoints): there are no gravity-assist variants there, so the candidate
 * set from a single sweep is small and full enumeration via getRoutes is already cheap — this
 * just selects the same three picks searchBest would, keeping getRoutes and getBestRoutes in
 * agreement. Returns the deduped [fastest, goldilocks, cheapest], or [] for an empty input.
 */
export function selectBestRoutes(
  routes: Route[],
  includeGoldilocks = true,
): Route[] {
  if (routes.length === 0) return [];
  // fastest: min duration, lexicographic tiebreak on Δv (matches obj "duration").
  // cheapest: min Δv, lexicographic tiebreak on duration (matches obj "deltaV").
  let fastest = routes[0];
  let cheapest = routes[0];
  for (const r of routes) {
    if (
      r.duration < fastest.duration ||
      (r.duration === fastest.duration && r.totalDeltaV < fastest.totalDeltaV)
    ) {
      fastest = r;
    }
    if (
      r.totalDeltaV < cheapest.totalDeltaV ||
      (r.totalDeltaV === cheapest.totalDeltaV && r.duration < cheapest.duration)
    ) {
      cheapest = r;
    }
  }

  let goldilocks: Route | null = null;
  if (includeGoldilocks && fastest !== cheapest) {
    const box: UtopiaBox = {
      dvMin: cheapest.totalDeltaV,
      dvMax: fastest.totalDeltaV,
      durMin: fastest.duration,
      durMax: cheapest.duration,
    };
    let best = Infinity;
    for (const r of routes) {
      const d = utopiaDist(r.totalDeltaV, r.duration, r.departAt + r.duration, box);
      if (d < best) {
        best = d;
        goldilocks = r;
      }
    }
  }

  const out: Route[] = [];
  for (const r of [fastest, goldilocks, cheapest]) {
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

/** Value-identity key for a route: schedule (departAt + duration) plus the body/flyby chain. */
function routeKey(r: Route): string {
  return `${r.departAt}|${r.duration}|${r.notation}`;
}

/** Dedupe routes by value (schedule + notation), dropping nulls, preserving first-seen order. */
export function dedupeRoutes(routes: (Route | null)[]): Route[] {
  const seen = new Set<string>();
  const out: Route[] = [];
  for (const r of routes) {
    if (!r) continue;
    const k = routeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Return a copy of `r` with every absolute time advanced by `deltaDays` (0 → returns `r`). */
function shiftRoute(r: Route, deltaDays: number): Route {
  if (deltaDays === 0) return r;
  return {
    ...r,
    departAt: r.departAt + deltaDays,
    nodes: r.nodes.map((n) => ({ ...n, time: n.time + deltaDays })),
    legs: r.legs.map((l) => ({
      ...l,
      departTime: l.departTime + deltaDays,
      arriveTime: l.arriveTime + deltaDays,
    })),
  };
}

/**
 * Project tagged routes into the player window at `nowDay` (= t0). For each tagged route, the
 * soonest in-window occurrence is t_soonest = D + n*·T_recur with n* = max(0, ceil((t0−D)/T)). A
 * route is eligible iff t_soonest < t0 + windowDays (always eligible when no window); eligible
 * routes are time-shifted to t_soonest. The Lambert-derived Δv/geometry/duration is the first-cycle
 * value (eccentricity re-solve is deferred). Untagged routes (the fixed default path) pass through
 * unchanged — projection is a no-op when phaseDay/recurDays are absent. At t0=0 the projection is
 * the identity for tagged direct routes (D ≥ 0 ⇒ n* = 0).
 */
export function projectRoutes(
  routes: Route[],
  nowDay: number,
  windowDays?: number,
): Route[] {
  const out: Route[] = [];
  for (const r of routes) {
    if (
      r.phaseDay === undefined || r.recurDays === undefined ||
      !Number.isFinite(r.recurDays) || r.recurDays <= 0
    ) {
      out.push(r);
      continue;
    }
    const D = r.phaseDay;
    const T = r.recurDays;
    const n = Math.max(0, Math.ceil((nowDay - D) / T));
    const tSoonest = D + n * T;
    if (windowDays !== undefined && tSoonest >= nowDay + windowDays) continue;
    out.push(shiftRoute(r, n * T));
  }
  return out;
}

/** The four Tier-C balance boxes, derived from the three anchors. Shared by the enumerated
 * (selectBestRoutes2) and branch-and-bound (getBestRoutes2) paths so they stay in agreement. */
export function balanceBoxes(
  cheapest: Route,
  fastest: Route,
  soonest: Route,
): { cf: UtopiaBox; cs: UtopiaBox; fs: UtopiaBox; triple: UtopiaBox } {
  const arr = (r: Route) => r.departAt + r.duration;
  return {
    cf: {
      dvMin: cheapest.totalDeltaV, dvMax: fastest.totalDeltaV,
      durMin: fastest.duration, durMax: cheapest.duration,
    },
    cs: {
      dvMin: cheapest.totalDeltaV, dvMax: soonest.totalDeltaV,
      arrMin: arr(soonest), arrMax: arr(cheapest),
    },
    fs: {
      durMin: fastest.duration, durMax: soonest.duration,
      arrMin: arr(soonest), arrMax: arr(fastest),
    },
    triple: {
      dvMin: cheapest.totalDeltaV, dvMax: Math.max(fastest.totalDeltaV, soonest.totalDeltaV),
      durMin: fastest.duration, durMax: Math.max(cheapest.duration, soonest.duration),
      arrMin: arr(soonest), arrMax: Math.max(arr(cheapest), arr(fastest)),
    },
  };
}

/**
 * Tier-C counterpart to selectBestRoutes: pick the 3 anchors (cheapest/fastest/soonest) and the
 * 4 balances (cheapest×fastest, cheapest×soonest, fastest×soonest, triple) from an already
 * enumerated candidate set, then value-dedupe. Used for moon topologies (no assist variants, so
 * the candidate set from getRoutes is small and full enumeration is cheap), keeping getBestRoutes2
 * and getRoutes in agreement — mirrors selectBestRoutes' role for the old getBestRoutes.
 */
export function selectBestRoutes2(routes: Route[]): Route[] {
  if (routes.length === 0) return [];
  const arr = (r: Route) => r.departAt + r.duration;
  const pickMin = (
    primary: (r: Route) => number,
    secondary: (r: Route) => number,
  ): Route => {
    let best = routes[0];
    for (const r of routes) {
      if (
        primary(r) < primary(best) ||
        (primary(r) === primary(best) && secondary(r) < secondary(best))
      ) best = r;
    }
    return best;
  };
  const cheapest = pickMin((r) => r.totalDeltaV, arr);
  const fastest = pickMin((r) => r.duration, (r) => r.totalDeltaV);
  const soonest = pickMin(arr, (r) => r.totalDeltaV);

  const nearest = (box: UtopiaBox): Route => {
    let best = routes[0];
    let bestD = Infinity;
    for (const r of routes) {
      const d = utopiaDist(r.totalDeltaV, r.duration, arr(r), box);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  };
  const boxes = balanceBoxes(cheapest, fastest, soonest);
  const cf = nearest(boxes.cf);
  const cs = nearest(boxes.cs);
  const fs = nearest(boxes.fs);
  const triple = nearest(boxes.triple);

  return dedupeRoutes([cheapest, fastest, soonest, cf, cs, fs, triple]);
}

/**
 * Normalised Euclidean distance from a point to the utopia corner of `b`, over whichever axes
 * the box carries. Each present axis is normalised to its [min, max] range and clamped at 0 so
 * a point at or past the corner contributes nothing (keeps the metric an admissible lower bound
 * for branch-and-bound). `arr` is the arrival axis (departAt + duration); ignored when the box
 * has no arr range.
 */
export function utopiaDist(
  dv: number,
  dur: number,
  arr: number,
  b: UtopiaBox,
): number {
  let sq = 0;
  if (b.dvMin !== undefined) {
    const r = Math.max(1e-9, (b.dvMax ?? b.dvMin) - b.dvMin);
    const x = Math.max(0, (dv - b.dvMin) / r);
    sq += x * x;
  }
  if (b.durMin !== undefined) {
    const r = Math.max(1e-9, (b.durMax ?? b.durMin) - b.durMin);
    const y = Math.max(0, (dur - b.durMin) / r);
    sq += y * y;
  }
  if (b.arrMin !== undefined) {
    const r = Math.max(1e-9, (b.arrMax ?? b.arrMin) - b.arrMin);
    const z = Math.max(0, (arr - b.arrMin) / r);
    sq += z * z;
  }
  return Math.sqrt(sq);
}

/** Closed-form terminal Δv (km/s) for one endpoint at a given v∞. */
function terminalDv(
  body: EndpointBody,
  endState: EndState,
  vInf: number,
  phase: "depart" | "arrive",
): number {
  return buildTerminal(body, endState, vInf, phase).totalDeltaV;
}

/**
 * Find the single best route under one objective via branch-and-bound. Covers the same
 * topologies as getRoutes' heliocentric path (direct + single + double assist, capped by
 * `maxAssists`). Returns null when no feasible route exists.
 */
export function searchBest(
  obj: Objective,
  from: BodyRef,
  to: BodyRef,
  fromState: EndState,
  toState: EndState,
  flybyBodies: BodyRef[],
  mu: number,
  centralId: string,
  maxAssists: number,
  opts: SearchOpts = {},
): Route | null {
  const box = opts.box;
  // Δv is always needed: as the primary cost for deltaV/goldilocks, and as the lexicographic
  // secondary (tiebreak) for duration — so even the "fastest" search must cost Δv to prefer the
  // non-dominated route among the many that tie on minimum time. (Terminal Δv is closed-form
  // and flyby Δv is already computed for feasibility, so this is cheap.)
  const needDv = true;

  // Objective score from a (Δv, duration, departDay) triple. arrival = departDay + duration.
  // Fed partial lower bounds while pruning and full totals at a completion; utopiaDist clamps at
  // the corner so partials stay admissible.
  const score = (dv: number, dur: number, departDay: number): number =>
    obj === "deltaV"
      ? dv
      : obj === "duration"
      ? dur
      : obj === "arrival"
      ? departDay + dur
      : utopiaDist(dv, dur, departDay + dur, box!);
  // Lexicographic secondary tiebreak among equal-primary routes: deltaV prefers least duration;
  // duration and arrival prefer least Δv; goldilocks has no secondary.
  const secondaryOf = (dv: number, dur: number): number =>
    obj === "deltaV" ? dur : (obj === "duration" || obj === "arrival") ? dv : 0;

  let bestP = opts.initialBest ?? Infinity;
  let incumbent: Route | null = opts.initialIncumbent ?? null;
  let bestS = incumbent
    ? secondaryOf(incumbent.totalDeltaV, incumbent.duration)
    : Infinity;
  // Accept a completed candidate if it improves the primary, or ties it with a better secondary.
  const tryAccept = (
    dv: number,
    dur: number,
    departDay: number,
    make: () => Route,
  ) => {
    const p = score(dv, dur, departDay);
    if (p > bestP) return;
    const s = secondaryOf(dv, dur);
    if (p === bestP && s >= bestS) return;
    bestP = p;
    bestS = s;
    incumbent = make();
  };

  // Depth 0 — direct. Cost is computed closed-form before materialising the Route, so only an
  // improving candidate allocates.
  let directOpts = defaultSweepOpts(
    from.elements.orbitRadiusAu,
    to.elements.orbitRadiusAu,
    mu,
    opts.departWindowDays,
  );
  if (opts.capDirectDepartAtSynodic && opts.departWindowDays !== undefined) {
    // The synodic horizon is what defaultSweepOpts uses when no window is given.
    const synodicHorizon = defaultSweepOpts(
      from.elements.orbitRadiusAu,
      to.elements.orbitRadiusAu,
      mu,
      undefined,
    ).departHorizonDays;
    if (directOpts.departHorizonDays > synodicHorizon) {
      directOpts = { ...directOpts, departHorizonDays: synodicHorizon };
    }
  }
  for (const c of sweepTransfers(from.elements, to.elements, mu, directOpts)) {
    const dv = needDv
      ? terminalDv(from.endpoint, fromState, c.vInfDepart, "depart") +
        terminalDv(to.endpoint, toState, c.vInfArrive, "arrive")
      : 0;
    tryAccept(
      dv,
      c.tofDays,
      c.departDay,
      () => toRoute(from, to, fromState, toState, centralId, c),
    );
  }

  if (maxAssists >= 1) {
    for (const via of flybyBodies) {
      const opt1 = defaultSweepOpts(
        from.elements.orbitRadiusAu,
        via.elements.orbitRadiusAu,
        mu,
        opts.departWindowDays,
      );
      const opt2 = defaultSweepOpts(
        via.elements.orbitRadiusAu,
        to.elements.orbitRadiusAu,
        mu,
        opts.departWindowDays,
      );
      const departHorizon = Math.max(
        opt1.departHorizonDays,
        opt2.departHorizonDays,
      );
      const dStep = step(0, departHorizon, ASSIST_DEPART_SAMPLES);
      const t1Step = step(opt1.tofMinDays, opt1.tofMaxDays, ASSIST_TOF_SAMPLES);
      const t2Step = step(opt2.tofMinDays, opt2.tofMaxDays, ASSIST_TOF_SAMPLES);
      for (let i = 0; i < ASSIST_DEPART_SAMPLES; i++) {
        const departDay = i * dStep;
        const sFrom = stateAt(from.elements, mu, departDay);
        for (let j = 0; j < ASSIST_TOF_SAMPLES; j++) {
          const tof1 = opt1.tofMinDays + j * t1Step;
          if (tof1 <= 0) continue;
          // Pre-leg LB knows only Σtof; monotonic in j (tof ascends) → break, not continue.
          if (score(0, tof1, departDay) > bestP) break;
          const flybyDay = departDay + tof1;
          const sVia = stateAt(via.elements, mu, flybyDay);
          const leg1 = solveLeg(sFrom.position, sVia.position, tof1, mu);
          if (!leg1) continue;
          const vInfDepart = vInfMag(leg1.v1, sFrom.velocity);
          if (vInfDepart > MAX_VINF_MPS) continue;
          const departDv = needDv
            ? terminalDv(from.endpoint, fromState, vInfDepart, "depart")
            : 0;
          // departDv is not monotonic in j → continue, not break.
          if (score(departDv, tof1, departDay) > bestP) continue;
          for (let k = 0; k < ASSIST_TOF_SAMPLES; k++) {
            const tof2 = opt2.tofMinDays + k * t2Step;
            if (tof2 <= 0) continue;
            if (score(departDv, tof1 + tof2, departDay) > bestP) break;
            const sTo = stateAt(to.elements, mu, flybyDay + tof2);
            const leg2 = solveLeg(sVia.position, sTo.position, tof2, mu);
            if (!leg2) continue;
            const vInfArrive = vInfMag(leg2.v2, sTo.velocity);
            if (vInfArrive > MAX_VINF_MPS) continue;
            const fb = flybyVia(via, sVia.velocity, leg1.v2, leg2.v1);
            if (!fb) continue;
            const fullDv = needDv
              ? departDv + mpsToKmps(fb.deltaV) +
                terminalDv(to.endpoint, toState, vInfArrive, "arrive")
              : 0;
            tryAccept(
              fullDv,
              // Match buildAssistRoute's duration exactly so the comparison key and the
              // stored route.duration are bit-identical.
              sumPrecise([tof1, tof2]),
              departDay,
              () =>
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
    }
  }

  if (maxAssists >= 2) {
    for (const f1 of flybyBodies) {
      for (const f2 of flybyBodies) {
        if (f1.id === f2.id) continue;
        const opt1 = defaultSweepOpts(
          from.elements.orbitRadiusAu,
          f1.elements.orbitRadiusAu,
          mu,
          opts.departWindowDays,
        );
        const opt2 = defaultSweepOpts(
          f1.elements.orbitRadiusAu,
          f2.elements.orbitRadiusAu,
          mu,
          opts.departWindowDays,
        );
        const opt3 = defaultSweepOpts(
          f2.elements.orbitRadiusAu,
          to.elements.orbitRadiusAu,
          mu,
          opts.departWindowDays,
        );
        const departHorizon = Math.max(
          opt1.departHorizonDays,
          opt2.departHorizonDays,
          opt3.departHorizonDays,
        );
        const dStep = step(0, departHorizon, DOUBLE_DEPART_SAMPLES);
        const t1Step = step(
          opt1.tofMinDays,
          opt1.tofMaxDays,
          DOUBLE_TOF_SAMPLES,
        );
        const t2Step = step(
          opt2.tofMinDays,
          opt2.tofMaxDays,
          DOUBLE_TOF_SAMPLES,
        );
        const t3Step = step(
          opt3.tofMinDays,
          opt3.tofMaxDays,
          DOUBLE_TOF_SAMPLES,
        );
        for (let i = 0; i < DOUBLE_DEPART_SAMPLES; i++) {
          const departDay = i * dStep;
          const sFrom = stateAt(from.elements, mu, departDay);
          for (let j = 0; j < DOUBLE_TOF_SAMPLES; j++) {
            const tof1 = opt1.tofMinDays + j * t1Step;
            if (tof1 <= 0) continue;
            if (score(0, tof1, departDay) > bestP) break;
            const f1Day = departDay + tof1;
            const sF1 = stateAt(f1.elements, mu, f1Day);
            const leg1 = solveLeg(sFrom.position, sF1.position, tof1, mu);
            if (!leg1) continue;
            const vInfDepart = vInfMag(leg1.v1, sFrom.velocity);
            if (vInfDepart > MAX_VINF_MPS) continue;
            const departDv = needDv
              ? terminalDv(from.endpoint, fromState, vInfDepart, "depart")
              : 0;
            if (score(departDv, tof1, departDay) > bestP) continue;
            for (let k = 0; k < DOUBLE_TOF_SAMPLES; k++) {
              const tof2 = opt2.tofMinDays + k * t2Step;
              if (tof2 <= 0) continue;
              if (score(departDv, tof1 + tof2, departDay) > bestP) break;
              const f2Day = f1Day + tof2;
              const sF2 = stateAt(f2.elements, mu, f2Day);
              const leg2 = solveLeg(sF1.position, sF2.position, tof2, mu);
              if (!leg2) continue;
              const fb1 = flybyVia(f1, sF1.velocity, leg1.v2, leg2.v1);
              if (!fb1) continue;
              const dvKnown2 = needDv ? departDv + mpsToKmps(fb1.deltaV) : 0;
              if (score(dvKnown2, tof1 + tof2, departDay) > bestP) continue;
              for (let l = 0; l < DOUBLE_TOF_SAMPLES; l++) {
                const tof3 = opt3.tofMinDays + l * t3Step;
                if (tof3 <= 0) continue;
                if (score(dvKnown2, tof1 + tof2 + tof3, departDay) > bestP) break;
                const sTo = stateAt(to.elements, mu, f2Day + tof3);
                const leg3 = solveLeg(sF2.position, sTo.position, tof3, mu);
                if (!leg3) continue;
                const vInfArrive = vInfMag(leg3.v2, sTo.velocity);
                if (vInfArrive > MAX_VINF_MPS) continue;
                const fb2 = flybyVia(f2, sF2.velocity, leg2.v2, leg3.v1);
                if (!fb2) continue;
                const fullDv = needDv
                  ? dvKnown2 + mpsToKmps(fb2.deltaV) +
                    terminalDv(to.endpoint, toState, vInfArrive, "arrive")
                  : 0;
                tryAccept(
                  fullDv,
                  sumPrecise([tof1, tof2, tof3]),
                  departDay,
                  () =>
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
      }
    }
  }

  return incumbent;
}
