// src/travel/state.ts
import { solveKepler } from "../core/kinematics.ts";
import { AU_M, DAY_S } from "./units.ts";

export interface OrbitElements {
  orbitRadiusAu: number; // semi-major axis about the central body, AU
  eccentricity: number;
  periapsisAngle: number; // argument of periapsis, radians
  orbitalPhase: number; // mean-anomaly fraction at t=0, 0..1
  retrograde: boolean; // true = orbit traversed in the reverse (clockwise) sense
}

export interface StateVector {
  position: { x: number; y: number }; // m, relative to central body
  velocity: { x: number; y: number }; // m/s, relative to central body
}

/**
 * State vector at elapsed time `tDays`. Physical mean motion n = √(μ/a³) (vis-viva
 * consistent); standard perifocal frame (periapsis on +x at E=0), rotated by periapsisAngle.
 */
export function stateAt(
  el: OrbitElements,
  muCentral: number,
  tDays: number,
): StateVector {
  const a = el.orbitRadiusAu * AU_M;
  const e = Math.min(Math.max(el.eccentricity, 0), 0.999);
  const n = Math.sqrt(muCentral / (a * a * a)); // rad/s (magnitude)
  const signedN = el.retrograde ? -n : n;
  const M = el.orbitalPhase * 2 * Math.PI + signedN * tDays * DAY_S;
  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const px = a * (cosE - e);
  const py = b * sinE;
  const dEdt = signedN / (1 - e * cosE); // dE/dt, rad/s (carries the sign)
  const vx = -a * sinE * dEdt;
  const vy = b * cosE * dEdt;
  const c = Math.cos(el.periapsisAngle);
  const s = Math.sin(el.periapsisAngle);
  return {
    position: { x: px * c - py * s, y: px * s + py * c },
    velocity: { x: vx * c - vy * s, y: vx * s + vy * c },
  };
}

/** Recover the conic (semi-major axis in AU, eccentricity) from a 2D state vector. */
export function conic(
  r: { x: number; y: number },
  v: { x: number; y: number },
  mu: number,
): { aAu: number; e: number } {
  const rm = Math.hypot(r.x, r.y);
  const v2 = v.x * v.x + v.y * v.y;
  const energy = v2 / 2 - mu / rm;
  const aM = -mu / (2 * energy);
  const h = r.x * v.y - r.y * v.x; // specific angular momentum (z)
  const e = Math.sqrt(Math.max(0, 1 - (h * h) / (aM * mu)));
  return { aAu: aM / AU_M, e };
}

export interface TransferConic {
  aAu: number; // semi-major axis about the central body, AU
  e: number; // eccentricity
  argPeriapsis: number; // radians, argument of periapsis in the central-body frame
  nu1: number; // radians, true anomaly at r1 (departure)
  nu2: number; // radians, true anomaly at r2 (arrival); nu1 -> nu2 walks the swept direction
}

/**
 * Full conic for a transfer leg from departure state (r1, v1) to arrival position r2.
 * Extends conic() with orientation (argument of periapsis) and the swept true-anomaly
 * span. nu1 -> nu2 follows the direction of motion (sign of angular momentum), so the
 * short-/long-way distinction and orbit sense are unambiguous for a renderer.
 */
export function transferConic(
  r1: { x: number; y: number },
  v1: { x: number; y: number },
  r2: { x: number; y: number },
  mu: number,
): TransferConic {
  const rm = Math.hypot(r1.x, r1.y);
  const v2sq = v1.x * v1.x + v1.y * v1.y;
  const energy = v2sq / 2 - mu / rm;
  const aM = -mu / (2 * energy);
  const h = r1.x * v1.y - r1.y * v1.x; // specific angular momentum (z); sign = sense
  const e = Math.sqrt(Math.max(0, 1 - (h * h) / (aM * mu)));

  // Eccentricity vector e_vec = ((|v|^2 - mu/r) r - (r·v) v) / mu ; points to periapsis.
  const rv = r1.x * v1.x + r1.y * v1.y;
  const f = v2sq - mu / rm;
  const ex = (f * r1.x - rv * v1.x) / mu;
  const ey = (f * r1.y - rv * v1.y) / mu;
  const eMag = Math.hypot(ex, ey);
  const argPeriapsis = eMag > 1e-9
    ? Math.atan2(ey, ex)
    : Math.atan2(r1.y, r1.x); // near-circular: anchor orientation to r1

  const TWO_PI = 2 * Math.PI;
  let nu1 = Math.atan2(r1.y, r1.x) - argPeriapsis;
  nu1 = ((nu1 % TWO_PI) + TWO_PI) % TWO_PI;

  // Swept angle r1 -> r2 in the direction of motion (prograde h>0 sweeps CCW/positive).
  let dTheta = Math.atan2(r2.y, r2.x) - Math.atan2(r1.y, r1.x);
  if (h >= 0) {
    while (dTheta <= 0) dTheta += TWO_PI;
    while (dTheta > TWO_PI) dTheta -= TWO_PI;
  } else {
    while (dTheta >= 0) dTheta -= TWO_PI;
    while (dTheta < -TWO_PI) dTheta += TWO_PI;
  }

  return { aAu: aM / AU_M, e, argPeriapsis, nu1, nu2: nu1 + dTheta };
}
