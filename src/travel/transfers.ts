// src/travel/transfers.ts
import { solveLambert } from "./lambert.ts";
import { type OrbitElements, stateAt, transferConic } from "./state.ts";
import { DAY_S } from "./units.ts";
import { reframeCount } from "./recurrence.ts";

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
  argPeriapsis: number; // radians, argument of periapsis about the central body
  nu1: number; // radians, true anomaly at departure
  nu2: number; // radians, true anomaly at arrival (nu1 -> nu2 in swept direction)
  phaseDay?: number; // reframe: canonical depart sample D (== departDay here)
  recurDays?: number; // reframe: recurrence period T_recur to tag the candidate with
}

export interface SweepOpts {
  departStartDay?: number; // absolute first departure day; defaults to 0
  departHorizonDays: number;
  departSamples: number;
  tofMinDays: number;
  tofMaxDays: number;
  tofSamples: number;
}

/** Resolution-target overrides for sweepTransfers: fixed spacing on each axis plus the recurrence
 * period to stamp on every emitted candidate. When present, departSamples/tofSamples are ignored. */
export interface ReframeSweep {
  deltaD: number;
  minD: number;
  maxD: number;
  deltaT: number;
  minT: number;
  maxT: number;
  recurDays: number;
}

/** Relative threshold for skipping near-collinear (transfer angle ≈ 0 or π) geometries
 * where the Lambert formulation is singular and can return a wrong-but-finite result. */
const COLLINEAR_EPS = 1e-6;

/** Absolute v∞ ceiling (m/s). Real interplanetary transfers are tens of km/s; anything
 * above this is a near-singular Lambert artifact (finite but garbage) and is discarded. */
const MAX_VINF_MPS = 1e6; // 1000 km/s

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
  reframe?: ReframeSweep,
): TransferCandidate[] {
  const out: TransferCandidate[] = [];
  let departSamples: number, dStep: number;
  let tofSamples: number, tStep: number;
  if (reframe) {
    const d = reframeCount(
      opts.departHorizonDays,
      reframe.deltaD,
      reframe.minD,
      reframe.maxD,
    );
    const t = reframeCount(
      opts.tofMaxDays - opts.tofMinDays,
      reframe.deltaT,
      reframe.minT,
      reframe.maxT,
    );
    departSamples = d.count;
    dStep = d.step;
    tofSamples = t.count;
    tStep = t.step;
  } else {
    departSamples = opts.departSamples;
    dStep = opts.departHorizonDays / Math.max(1, opts.departSamples - 1);
    tofSamples = opts.tofSamples;
    tStep = (opts.tofMaxDays - opts.tofMinDays) /
      Math.max(1, opts.tofSamples - 1);
  }
  const departStartDay = opts.departStartDay ?? 0;
  for (let i = 0; i < departSamples; i++) {
    const departDay = departStartDay + i * dStep;
    const sFrom = stateAt(from, mu, departDay);
    const r1 = Math.hypot(sFrom.position.x, sFrom.position.y);
    for (let j = 0; j < tofSamples; j++) {
      const tofDays = opts.tofMinDays + j * tStep;
      if (tofDays <= 0) continue;
      const arriveDay = departDay + tofDays;
      const sTo = stateAt(to, mu, arriveDay);
      // Skip near-collinear geometry (transfer angle ≈ 0 or π): singular Lambert.
      const crossZ = sFrom.position.x * sTo.position.y -
        sFrom.position.y * sTo.position.x;
      const r2 = Math.hypot(sTo.position.x, sTo.position.y);
      if (Math.abs(crossZ) < COLLINEAR_EPS * r1 * r2) continue;
      const evalArc = (prograde: boolean) => {
        const { v1, v2 } = solveLambert(
          sFrom.position,
          sTo.position,
          tofDays * DAY_S,
          mu,
          prograde,
        );
        if (!Number.isFinite(v1.x) || !Number.isFinite(v2.x)) return null;
        const vInfDepart = Math.hypot(
          v1.x - sFrom.velocity.x,
          v1.y - sFrom.velocity.y,
        );
        const vInfArrive = Math.hypot(
          v2.x - sTo.velocity.x,
          v2.y - sTo.velocity.y,
        );
        if (vInfDepart > MAX_VINF_MPS || vInfArrive > MAX_VINF_MPS) return null;
        const c = transferConic(sFrom.position, v1, sTo.position, mu);
        if (!Number.isFinite(c.aAu) || !Number.isFinite(c.e)) return null;
        return { v1, v2, vInfDepart, vInfArrive, c };
      };

      const arcs = [evalArc(true), evalArc(false)].filter(
        (x): x is NonNullable<typeof x> => x !== null,
      );
      if (arcs.length === 0) continue;
      const pick = arcs.reduce((m, x) =>
        x.vInfDepart + x.vInfArrive < m.vInfDepart + m.vInfArrive ? x : m
      );

      out.push({
        departDay,
        tofDays,
        arriveDay,
        v1: pick.v1,
        v2: pick.v2,
        vInfDepart: pick.vInfDepart,
        vInfArrive: pick.vInfArrive,
        aAu: pick.c.aAu,
        e: pick.c.e,
        argPeriapsis: pick.c.argPeriapsis,
        nu1: pick.c.nu1,
        nu2: pick.c.nu2,
        ...(reframe
          ? { phaseDay: departDay, recurDays: reframe.recurDays }
          : {}),
      });
    }
  }
  return out;
}
