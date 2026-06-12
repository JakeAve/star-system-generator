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
 * the velocity for free up to the maximum turn at periapsis = body radius. Any residual is a
 * powered burn: the speed-change part is charged at periapsis (Oberth-correct, so it shrinks
 * the deeper the pass), and any turn the swing-by cannot deliver is charged in v∞ space. The
 * burn is an approximation — Level 2 (see /tmp/todo) couples r_p to the outgoing hyperbola.
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
  // Magnitude change is charged at periapsis (Oberth): a burn deep in the well, where the
  // speed is √(v∞² + 2μ/r_p), buys far more than the same burn out in v∞ space. With no turn
  // (r_p → ∞) the 2μ/r_p term vanishes and a pure speed change costs full price, as it should.
  const k = 2 * body.mu / periapsisRadius; // 0 when periapsisRadius is Infinity
  const vPeriIn = Math.sqrt(vIn * vIn + k);
  const vPeriOut = Math.sqrt(vOut * vOut + k);
  const dvMag = Math.abs(vPeriOut - vPeriIn);
  // Turn the flyby cannot deliver for free still costs a direction change, which a periapsis
  // burn cannot buy cheaply — charge it in v∞ space at the outgoing speed.
  const turnDeficit = Math.max(0, theta - dMax);
  const dvTurn = 2 * vOut * Math.sin(turnDeficit / 2);
  const deltaV = dvMag + dvTurn;
  return { deltaV, periapsisRadius, turnAngle: achieved, vInfinity: vIn };
}
