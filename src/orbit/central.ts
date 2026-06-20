// src/orbit/central.ts
// Resolve the central body's μ, surface radius, and the stable orbit band.

import { type CelestialObject, ObjectType, type SolarSystem } from "../core/types.ts";
import {
  AU_M,
  hillRadius,
  M_SUN_IN_EARTH,
  muBody,
  muStar,
  R_EARTH_M,
  R_SUN_M,
  sphereOfInfluence,
} from "../travel/units.ts";

/** Gravitational parameter μ = GM (m³/s²) for any body. */
export function bodyMu(body: CelestialObject): number {
  return body.type === ObjectType.Star ? muStar(body.mass) : muBody(body.mass);
}

/** Surface (mean) radius of the body in meters. */
export function surfaceRadiusM(body: CelestialObject): number {
  const unit = body.type === ObjectType.Star ? R_SUN_M : R_EARTH_M;
  return body.radius * unit;
}

/** Find the top-level object that owns this moon. */
function parentOf(
  moon: CelestialObject,
  system: SolarSystem,
): CelestialObject | undefined {
  return system.objects.find((o) => o.id === moon.parentId);
}

/**
 * Outer edge of the body's gravitational dominance (m), or null if unbounded.
 * Moon → its own Hill radius within its parent planet.
 * Planet/dwarf/asteroid/comet → sphere of influence w.r.t. the star.
 * Star → null (no parent to capture satellites).
 */
export function outerBoundM(
  body: CelestialObject,
  system: SolarSystem,
): number | null {
  if (body.type === ObjectType.Star) return null;

  if (body.type === ObjectType.Moon) {
    const parent = parentOf(body, system);
    if (!parent) return null;
    // moon.orbitRadius is AU from the parent; masses are both in M⊕.
    return hillRadius(body.orbitRadius * AU_M, body.mass, parent.mass);
  }

  // Top-level object: SOI relative to the star. Star mass → Earth masses for consistency.
  const starMassEarth = system.star.mass * M_SUN_IN_EARTH;
  return sphereOfInfluence(body.orbitRadius * AU_M, body.mass, starMassEarth);
}

/** The stable orbit band in meters: surface up to the outer gravitational bound. */
export function stabilityBand(
  body: CelestialObject,
  system: SolarSystem,
): { rMinM: number; rMaxM: number | null } {
  return { rMinM: surfaceRadiusM(body), rMaxM: outerBoundM(body, system) };
}
