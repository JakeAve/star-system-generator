// src/travel/state.ts
import { solveKepler } from "../core/kinematics.ts";
import { AU_M, DAY_S } from "./units.ts";

export interface OrbitElements {
  orbitRadiusAu: number; // semi-major axis about the central body, AU
  eccentricity: number;
  periapsisAngle: number; // argument of periapsis, radians
  orbitalPhase: number; // mean-anomaly fraction at t=0, 0..1
}

export interface StateVector {
  position: { x: number; y: number }; // m, relative to central body
  velocity: { x: number; y: number }; // m/s, relative to central body
}

/**
 * State vector at elapsed time `tDays`. Physical mean motion n = √(μ/a³) (vis-viva
 * consistent); standard perifocal frame (periapsis on +x at E=0), rotated by periapsisAngle.
 */
export function stateAt(el: OrbitElements, muCentral: number, tDays: number): StateVector {
  const a = el.orbitRadiusAu * AU_M;
  const e = Math.min(Math.max(el.eccentricity, 0), 0.999);
  const n = Math.sqrt(muCentral / (a * a * a)); // rad/s
  const M = el.orbitalPhase * 2 * Math.PI + n * tDays * DAY_S;
  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const px = a * (cosE - e);
  const py = b * sinE;
  const dEdt = n / (1 - e * cosE); // dE/dt, rad/s
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
