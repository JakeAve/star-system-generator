// src/travel/terminal.ts
import {
  EndState,
  type TerminalStage,
  type TerminalTransfer,
} from "./types.ts";
import { mpsToKmps } from "./units.ts";

export interface EndpointBody {
  mu: number; // m³/s²
  radiusM: number; // m (low circular orbit radius = surface radius)
}

/** Oberth-effective burn (m/s) to capture from / escape to hyperbolic excess vInf. */
export function oberthBurn(body: EndpointBody, vInf: number): number {
  const vHyp = Math.sqrt(vInf * vInf + 2 * body.mu / body.radiusM);
  const vCirc = Math.sqrt(body.mu / body.radiusM);
  return vHyp - vCirc;
}

/** Δv (m/s) to descend from / ascend to low orbit (cancel circular velocity, vacuum). */
function surfaceBurn(body: EndpointBody): number {
  return Math.sqrt(body.mu / body.radiusM);
}

/**
 * Build the endpoint body's own SOI↔end-state sequence.
 * Arrive: capture[(+descent)]. Depart: (ascent+)escape. Intercept: empty.
 */
export function buildTerminal(
  body: EndpointBody,
  endState: EndState,
  vInf: number, // m/s
  phase: "depart" | "arrive",
): TerminalTransfer {
  if (endState === EndState.Intercept) {
    return { endState, phase, stages: [], totalDeltaV: 0, duration: 0 };
  }
  const soiBurn: TerminalStage = {
    kind: phase === "arrive" ? "capture" : "escape",
    deltaV: mpsToKmps(oberthBurn(body, vInf)),
    vInfinity: mpsToKmps(vInf),
  };
  const surface: TerminalStage = {
    kind: phase === "arrive" ? "descent" : "ascent",
    deltaV: mpsToKmps(surfaceBurn(body)),
  };
  const stages: TerminalStage[] = [];
  if (endState === EndState.Surface) {
    if (phase === "arrive") stages.push(soiBurn, surface);
    else stages.push(surface, soiBurn);
  } else {
    stages.push(soiBurn);
  }
  const totalDeltaV = stages.reduce((sum, s) => sum + s.deltaV, 0);
  return { endState, phase, stages, totalDeltaV, duration: 0 };
}
