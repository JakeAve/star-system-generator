// src/travel/types.ts

/** Role of a body within a route. */
export enum RouteNodeKind {
  Depart = "depart",
  Arrive = "arrive",
  Flyby = "flyby",
  Transit = "transit",
}

/** Final state achieved at an endpoint (or required start-state for departure). */
export enum EndState {
  Intercept = "intercept",
  Orbit = "orbit",
  Surface = "surface",
}

/** How to rank and trim the returned route set. */
export enum RankMode {
  Pareto = "pareto",
  TopN = "topN",
  All = "all",
}

export interface FlybyGeometry {
  periapsisRadius: number; // km, from body center; >= body radius
  vInfinity: number; // km/s
  turnAngle: number; // radians
}

export interface Waypoint {
  obj: string; // body id
  type: EndState;
}

export interface TerminalStage {
  kind: "capture" | "escape" | "descent" | "ascent";
  deltaV: number; // km/s
  vInfinity?: number; // km/s, capture/escape
}

export interface TerminalTransfer {
  endState: EndState;
  phase: "depart" | "arrive";
  stages: TerminalStage[];
  totalDeltaV: number; // km/s
  duration: number; // days (local surface ops); 0 for orbit/intercept
}

export interface RouteNode {
  bodyId: string;
  time: number; // absolute day, t=0 = "now"
  kind: RouteNodeKind;
  deltaV: number; // km/s; burn at this node
  flyby?: FlybyGeometry; // kind === Flyby
  vInfinity?: number; // km/s; kind === Transit
  terminal?: TerminalTransfer; // kind === Depart/Arrive
}

export interface RouteLeg {
  fromBodyId: string;
  toBodyId: string;
  centralBodyId: string; // star (heliocentric) or planet (planetocentric)
  departTime: number; // day
  arriveTime: number; // day
  timeOfFlight: number; // days
  transfer: {
    a: number; // AU, semi-major axis about centralBodyId
    e: number; // eccentricity
    argPeriapsis: number; // radians, argument of periapsis in the centralBodyId frame
    nu1: number; // radians, true anomaly at departure
    nu2: number; // radians, true anomaly at arrival (nu1 -> nu2 in swept direction)
  };
  deltaV: number; // km/s; injection at leg start
}

export interface Route {
  bodies: string[];
  nodes: RouteNode[]; // nodes.length === bodies.length
  legs: RouteLeg[]; // legs.length === nodes.length - 1
  departAt: number; // day
  duration: number; // days
  totalDeltaV: number; // km/s
  notation: string;
  // Schedule-aware reframe tags (getBestRoutes3 only; undefined on the fixed default path).
  // phaseDay = the route's canonical depart sample D ∈ [0, recurDays); recurDays = its recurrence
  // period (synodic for direct, T_combined for assist). Used by projectRoutes to map the route to
  // its soonest in-window occurrence.
  phaseDay?: number;
  recurDays?: number;
}

/**
 * Sampling strategy for the porkchop/assist sweeps. The default (`"fixed"`, or omitted) is the
 * legacy fixed-sample-count behavior used by getRoutes/getBestRoutes/getBestRoutes2 — byte-
 * identical to today. `"resolutionTarget"` samples at fixed spacing (Δd on depart, Δt on tof)
 * over the recurrence period and tags routes for window projection; used only by getBestRoutes3.
 */
export type SweepMode =
  | { kind: "fixed" }
  | {
    kind: "resolutionTarget";
    deltaD: number;
    minD: number;
    maxD: number;
    deltaT: number;
    minT: number;
    maxT: number;
    nowDay: number; // t0 for projection; window is taken from departWindowDays
  };

export interface TravelOptions {
  maxAssists?: number; // default 2; Phase 1 treats as direct-only
  rank?: RankMode; // default Pareto
  topN?: number;
  weights?: { time: number; deltaV: number };
  departWindowDays?: number; // cap depart times to [0, window) days from now; default = outer period
  sweep?: SweepMode; // default "fixed"; "resolutionTarget" enables the getBestRoutes3 reframe
}
