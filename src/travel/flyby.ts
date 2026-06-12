// src/travel/flyby.ts
// Analytic gravity assist: hyperbolic flyby geometry and the powered periapsis burn that
// reconciles an incoming hyperbolic-excess vector with a desired outgoing one.
import type { EndpointBody } from "./terminal.ts";

/** Hyperbolic turn angle (rad) for a flyby at `periapsisRadius` (m) with excess speed `vInf` (m/s). */
export function turnAngle(
  vInf: number,
  periapsisRadius: number,
  mu: number,
): number {
  const e = 1 + (periapsisRadius * vInf * vInf) / mu; // hyperbolic eccentricity
  return 2 * Math.asin(1 / e);
}

/** Maximum turn (rad) for excess speed `vInf`, achieved at periapsis = body radius. */
export function maxTurnAngle(vInf: number, body: EndpointBody): number {
  return turnAngle(vInf, body.radiusM, body.mu);
}

/** Periapsis radius (m) that yields turn angle `turn` for excess speed `vInf`. */
export function periapsisForTurn(
  vInf: number,
  turn: number,
  mu: number,
): number {
  const e = 1 / Math.sin(turn / 2);
  return ((e - 1) * mu) / (vInf * vInf);
}

export interface FlybyResult {
  /** Powered periapsis burn closing the residual after the free turn, m/s (0 = unpowered). */
  deltaV: number;
  /** Closest approach from the body center, m (>= body radius). */
  periapsisRadius: number;
  /** Bend actually imparted to the velocity, rad. */
  turnAngle: number;
  /** Incoming hyperbolic excess speed, m/s. */
  vInfinity: number;
}

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

/**
 * Take incoming excess `vInfIn` (vector, body frame) to outgoing `vInfOut`. The flyby rotates
 * the velocity for free up to the maximum turn at periapsis = body radius; the magnitude is
 * conserved by an unpowered swing. Any residual (excess turn or speed change) is closed by a
 * powered periapsis burn whose cost is the vector gap to the achievable outgoing velocity.
 */
export function evaluateFlyby(
  vInfIn: { x: number; y: number },
  vInfOut: { x: number; y: number },
  body: EndpointBody,
): FlybyResult {
  const vIn = Math.hypot(vInfIn.x, vInfIn.y);
  const vOut = Math.hypot(vInfOut.x, vInfOut.y);
  const cosT = clamp(
    (vInfIn.x * vInfOut.x + vInfIn.y * vInfOut.y) / (vIn * vOut),
    -1,
    1,
  );
  const theta = Math.acos(cosT); // required bend between in and out
  const dMax = maxTurnAngle(vIn, body);
  const achieved = Math.min(theta, dMax);
  const periapsisRadius = achieved >= dMax
    ? body.radiusM
    : periapsisForTurn(vIn, achieved, body.mu);
  // Best unpowered result: vInfIn rotated by `achieved` toward vInfOut, magnitude preserved.
  const cross = vInfIn.x * vInfOut.y - vInfIn.y * vInfOut.x;
  const sign = cross >= 0 ? 1 : -1;
  const ang = sign * achieved;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const ax = vInfIn.x * c - vInfIn.y * s;
  const ay = vInfIn.x * s + vInfIn.y * c;
  const deltaV = Math.hypot(vInfOut.x - ax, vInfOut.y - ay);
  return { deltaV, periapsisRadius, turnAngle: achieved, vInfinity: vIn };
}
