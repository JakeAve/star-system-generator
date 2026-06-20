// src/orbit/orbit.ts
// Circular-orbit physics and the public computeOrbit entry point.

import { type CelestialObject, type GeneratorConfig, ObjectType, type SolarSystem } from "../core/types.ts";
import { DEFAULT_CONFIG } from "../core/config.ts";
import { AU_M, DAY_S, mpsToKmps, mToAu } from "../travel/units.ts";
import { bodyMu, stabilityBand, surfaceRadiusM } from "./central.ts";
import type { OrbitResult, OrbitSpec, OrbitUnavailable } from "./types.ts";

/** Circular orbital velocity (m/s): √(μ/r). */
export function circularVelocity(mu: number, rM: number): number {
  return Math.sqrt(mu / rM);
}

/** Orbital period (s): 2π√(r³/μ). */
export function orbitalPeriod(mu: number, rM: number): number {
  return 2 * Math.PI * Math.sqrt(rM ** 3 / mu);
}

/** Escape velocity at radius r (m/s): √(2μ/r). */
export function escapeVelocity(mu: number, rM: number): number {
  return Math.sqrt((2 * mu) / rM);
}

/** Specific orbital energy (J/kg): −μ/2r. */
export function specificEnergy(mu: number, rM: number): number {
  return -mu / (2 * rM);
}

/**
 * Ideal two-burn Hohmann Δv (m/s) from a circular orbit grazing the surface
 * (r0 = surfaceM) to the circular target orbit (rM): burn 1 raises apoapsis to
 * rM, burn 2 circularizes. Ignores atmospheric drag, gravity losses, and the
 * body's rotational launch assist — a clean physics lower bound.
 */
export function deltaVFromSurface(mu: number, surfaceM: number, rM: number): number {
  if (rM === surfaceM) return 0;
  const a = (surfaceM + rM) / 2; // transfer-ellipse semi-major axis
  const vc0 = Math.sqrt(mu / surfaceM);
  const vc1 = Math.sqrt(mu / rM);
  const vPeri = Math.sqrt(mu * (2 / surfaceM - 1 / a));
  const vApo = Math.sqrt(mu * (2 / rM - 1 / a));
  return Math.abs(vPeri - vc0) + Math.abs(vc1 - vApo);
}

/** Resolve an OrbitSpec to an orbital radius in meters, or null when a named orbit cannot resolve. */
function resolveRadiusM(
  spec: OrbitSpec,
  body: CelestialObject,
  mu: number,
  surfaceM: number,
  config: GeneratorConfig,
): { rM: number } | { reason: string } {
  if ("unit" in spec) {
    if (!(spec.value >= 0)) {
      throw new Error(`orbit distance must be non-negative, got ${spec.value}`);
    }
    switch (spec.unit) {
      case "km":
        return { rM: surfaceM + spec.value * 1000 };
      case "bodyRadii":
        return { rM: spec.value * surfaceM };
      case "AU":
        return { rM: spec.value * AU_M };
    }
  }
  switch (spec.type) {
    case "low":
      return { rM: surfaceM * (1 + config.lowOrbitAltitudeFraction) };
    case "synchronous": {
      if (!(body.rotationPeriodDays > 0)) {
        return { reason: "central body does not rotate; no synchronous orbit exists" };
      }
      const tS = body.rotationPeriodDays * DAY_S;
      const rM = Math.cbrt((mu * tS ** 2) / (4 * Math.PI ** 2));
      return { rM };
    }
  }
}

/**
 * Compute circular-orbit parameters for a satellite around `body`.
 * Returns OrbitUnavailable (not an error) when a named orbit cannot resolve.
 */
export function computeOrbit(
  body: CelestialObject,
  spec: OrbitSpec,
  system: SolarSystem,
  config: GeneratorConfig = DEFAULT_CONFIG,
): OrbitResult | OrbitUnavailable {
  const mu = bodyMu(body);
  const surfaceM = surfaceRadiusM(body);

  const resolved = resolveRadiusM(spec, body, mu, surfaceM, config);
  if ("reason" in resolved) return { applicable: false, spec, reason: resolved.reason };
  const { rM } = resolved;

  const { rMinM, rMaxM } = stabilityBand(body, system);
  const stable = rM >= rMinM && (rMaxM === null || rM <= rMaxM);

  return {
    applicable: true,
    orbitalVelocityKmps: mpsToKmps(circularVelocity(mu, rM)),
    periodSeconds: orbitalPeriod(mu, rM),
    periodDays: orbitalPeriod(mu, rM) / DAY_S,
    escapeVelocityKmps: mpsToKmps(escapeVelocity(mu, rM)),
    specificEnergyJperKg: specificEnergy(mu, rM),
    deltaVFromSurfaceKmps: mpsToKmps(deltaVFromSurface(mu, surfaceM, rM)),
    radiusKm: rM / 1000,
    radiusAu: mToAu(rM),
    radiusBodyRadii: rM / surfaceM,
    altitudeKm: (rM - surfaceM) / 1000,
    stable,
    band: { rMinKm: rMinM / 1000, rMaxKm: rMaxM === null ? null : rMaxM / 1000 },
    appliedSpec: "unit" in spec
      ? { kind: "distance", unit: spec.unit, value: spec.value }
      : { kind: "named", type: spec.type },
  };
}
