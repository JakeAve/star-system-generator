// src/travel/recurrence.ts
// Pure recurrence + resolution-target sampling math for the schedule-aware reframe
// (getBestRoutes3). No engine dependencies — just the periodicity arithmetic.
import { AU_M, DAY_S } from "./units.ts";

/** Default resolution-target knobs for getBestRoutes3. Tunable; swept in the benchmark.
 * Direct uses minD/maxD/minT/maxT; assist additionally clamps at maxDAssist/maxTAssist so the
 * dense direct reframe is never hostage to assist cost. tau/C govern the T_combined estimate. */
export const DEFAULT_REFRAME = {
  deltaD: 5, // depart-axis spacing, days
  minD: 12,
  maxD: 120,
  deltaT: 10, // tof-axis spacing, days
  minT: 12,
  maxT: 120,
  maxDAssist: 16, // hard ceilings for the multi-dimensional assist grids
  maxTAssist: 16,
  tau: 0.001, // relative tolerance for "re-phases to an integer multiple"
  C: 12, // T_combined is capped at C·max(Sᵢ)
} as const;

/** Orbital period (days) at semi-major radius `au` about a body of parameter `mu`: T = 2π√(a³/μ). */
export function orbitalPeriodDays(au: number, mu: number): number {
  const m = au * AU_M;
  return (2 * Math.PI * Math.sqrt((m * m * m) / mu)) / DAY_S;
}

/** Synodic period (days) between two orbital periods. Non-finite for (near-)equal periods. */
export function synodicPeriodDays(periodA: number, periodB: number): number {
  return 1 / Math.abs(1 / periodA - 1 / periodB);
}

/**
 * Approximate capped LCM of a chain's from-relative synodic periods `Sᵢ` (the assist recurrence
 * `T_combined`). Non-finite/non-positive entries (near-coorbital pairs) are dropped — handled by
 * the `cap`. Returns `cap` when no finite period remains.
 *
 * L starts at S₁; for each subsequent Sᵢ we find the smallest m ≥ 1 with m·L within relative
 * tolerance τ of an integer multiple of Sᵢ, then set L = m·L. If the running L exceeds C·max(Sᵢ),
 * or no m converges within MAX_M, we fall back to min(C·max(Sᵢ), cap) — never worse-bounded than
 * the old max(Sᵢ) horizon. The final result is min(L, C·max(Sᵢ), cap).
 */
export function combinedRecurrenceDays(
  relativeSynodics: number[],
  cap: number,
  tau: number = DEFAULT_REFRAME.tau,
  C: number = DEFAULT_REFRAME.C,
): number {
  const finite = relativeSynodics.filter((s) => Number.isFinite(s) && s > 0);
  if (finite.length === 0) return cap;
  const maxS = Math.max(...finite);
  const ceiling = Math.min(C * maxS, cap);
  const MAX_M = 100;
  let L = finite[0];
  for (let idx = 1; idx < finite.length; idx++) {
    const s = finite[idx];
    let m = 1;
    for (; m <= MAX_M; m++) {
      const x = (m * L) / s;
      if (Math.abs(x - Math.round(x)) < tau) break;
    }
    if (m > MAX_M) return ceiling; // never re-phased within tolerance
    L *= m;
    if (L > ceiling) return ceiling;
  }
  return Math.min(L, ceiling);
}

/**
 * Resolution-target sample count over `span` at spacing `delta`, clamped to [min, max].
 * - Unclamped (`min ≤ raw ≤ max`): exact — `count` samples at `i·delta`, anchored at 0, so a
 *   narrower span's samples are a strict subset of a wider one's (windows nest by construction).
 * - Clamped: `count` samples spread evenly over `span` (`step = span/(count-1)`), `exact = false`
 *   (nesting may break — the cost ceiling / density floor takes precedence).
 */
export function reframeCount(
  span: number,
  delta: number,
  min: number,
  max: number,
): { count: number; step: number; exact: boolean } {
  const raw = Math.max(1, Math.floor(span / delta) + 1);
  const count = Math.min(max, Math.max(min, raw));
  if (count === raw) return { count, step: delta, exact: true };
  return { count, step: count > 1 ? span / (count - 1) : 0, exact: false };
}
