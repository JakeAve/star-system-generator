// src/travel/transfers.ts
import { solveLambert } from "./lambert.ts";
import { conic, type OrbitElements, stateAt } from "./state.ts";
import { DAY_S } from "./units.ts";

export interface Hohmann {
  dvDepart: number; // m/s
  dvArrive: number; // m/s
  tof: number; // s
}

/** Closed-form Hohmann transfer between two coplanar circular orbits (radii in m). */
export function hohmann(r1: number, r2: number, mu: number): Hohmann {
  const at = (r1 + r2) / 2;
  const vc1 = Math.sqrt(mu / r1);
  const vc2 = Math.sqrt(mu / r2);
  const vp = Math.sqrt(mu * (2 / r1 - 1 / at));
  const va = Math.sqrt(mu * (2 / r2 - 1 / at));
  return {
    dvDepart: Math.abs(vp - vc1),
    dvArrive: Math.abs(vc2 - va),
    tof: Math.PI * Math.sqrt((at * at * at) / mu),
  };
}

export interface TransferCandidate {
  departDay: number;
  tofDays: number;
  arriveDay: number;
  v1: { x: number; y: number }; // m/s, heliocentric at departure
  v2: { x: number; y: number }; // m/s, heliocentric at arrival
  vInfDepart: number; // m/s, |v1 - vBodyAtDepart|
  vInfArrive: number; // m/s, |v2 - vBodyAtArrive|
  aAu: number; // transfer conic
  e: number;
}

export interface SweepOpts {
  departHorizonDays: number;
  departSamples: number;
  tofMinDays: number;
  tofMaxDays: number;
  tofSamples: number;
}

/** Relative threshold for skipping near-collinear (transfer angle ≈ 0 or π) geometries
 * where the Lambert formulation is singular and can return a wrong-but-finite result. */
const COLLINEAR_EPS = 1e-6;

/**
 * Porkchop sweep: for each (departDay, tof) on the grid, solve Lambert and record the
 * heliocentric departure/arrival velocities and the v∞ relative to the endpoint bodies.
 * Skips non-finite results and near-collinear geometries.
 */
export function sweepTransfers(
  from: OrbitElements,
  to: OrbitElements,
  mu: number,
  opts: SweepOpts,
): TransferCandidate[] {
  const out: TransferCandidate[] = [];
  const dStep = opts.departHorizonDays / Math.max(1, opts.departSamples - 1);
  const tStep = (opts.tofMaxDays - opts.tofMinDays) / Math.max(1, opts.tofSamples - 1);
  for (let i = 0; i < opts.departSamples; i++) {
    const departDay = i * dStep;
    const sFrom = stateAt(from, mu, departDay);
    const r1 = Math.hypot(sFrom.position.x, sFrom.position.y);
    for (let j = 0; j < opts.tofSamples; j++) {
      const tofDays = opts.tofMinDays + j * tStep;
      if (tofDays <= 0) continue;
      const arriveDay = departDay + tofDays;
      const sTo = stateAt(to, mu, arriveDay);
      // Skip near-collinear geometry (transfer angle ≈ 0 or π): singular Lambert.
      const crossZ = sFrom.position.x * sTo.position.y - sFrom.position.y * sTo.position.x;
      const r2 = Math.hypot(sTo.position.x, sTo.position.y);
      if (Math.abs(crossZ) < COLLINEAR_EPS * r1 * r2) continue;
      const { v1, v2 } = solveLambert(sFrom.position, sTo.position, tofDays * DAY_S, mu, true);
      if (!Number.isFinite(v1.x) || !Number.isFinite(v2.x)) continue;
      const vInfDepart = Math.hypot(v1.x - sFrom.velocity.x, v1.y - sFrom.velocity.y);
      const vInfArrive = Math.hypot(v2.x - sTo.velocity.x, v2.y - sTo.velocity.y);
      const c = conic(sFrom.position, v1, mu);
      if (!Number.isFinite(c.aAu) || !Number.isFinite(c.e)) continue;
      out.push({ departDay, tofDays, arriveDay, v1, v2, vInfDepart, vInfArrive, aAu: c.aAu, e: c.e });
    }
  }
  return out;
}
