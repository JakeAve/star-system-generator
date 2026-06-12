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
  transfer: { a: number; e: number }; // a in AU about centralBodyId
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
}

export interface TravelOptions {
  maxAssists?: number; // default 2; Phase 1 treats as direct-only
  rank?: RankMode; // default Pareto
  topN?: number;
  weights?: { time: number; deltaV: number };
  departWindowDays?: number; // cap depart times to [0, window) days from now; default = outer period
}
