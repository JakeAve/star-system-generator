// src/travel/index.ts
import type { CelestialObject, SolarSystem } from "../core/types.ts";
import { ObjectType } from "../core/types.ts";
import { type BodyRef, findDirectRoutes } from "./search.ts";
import { muBody, muStar, R_EARTH_M } from "./units.ts";
import type { OrbitElements } from "./state.ts";
import { type Route, type TravelOptions, type Waypoint } from "./types.ts";

function elementsOf(o: CelestialObject): OrbitElements {
  return {
    orbitRadiusAu: o.orbitRadius,
    eccentricity: o.eccentricity,
    periapsisAngle: o.periapsisAngle,
    orbitalPhase: o.orbitalPhase,
  };
}

function bodyRefOf(o: CelestialObject): BodyRef {
  return {
    id: o.id,
    elements: elementsOf(o),
    endpoint: { mu: muBody(o.mass), radiusM: o.radius * R_EARTH_M },
  };
}

/** Flatten a system into id → {object, isMoon}. IDs are globally unique. */
function flatten(system: SolarSystem): Map<string, { obj: CelestialObject; isMoon: boolean }> {
  const map = new Map<string, { obj: CelestialObject; isMoon: boolean }>();
  map.set(system.star.id, { obj: system.star, isMoon: false });
  for (const o of system.objects) {
    map.set(o.id, { obj: o, isMoon: false });
    for (const m of o.moons) map.set(m.id, { obj: m, isMoon: true });
  }
  return map;
}

/**
 * Compute ranked direct travel routes between two non-moon bodies.
 * Phase 1: heliocentric, direct (no gravity assists), no moon endpoints.
 */
export function travelOptions(
  system: SolarSystem,
  from: Waypoint,
  to: Waypoint,
  options: TravelOptions = {},
): Route[] {
  const index = flatten(system);
  const f = index.get(from.obj);
  const t = index.get(to.obj);
  if (!f) throw new Error(`unknown body: ${from.obj}`);
  if (!t) throw new Error(`unknown body: ${to.obj}`);
  if (f.isMoon || t.isMoon) throw new Error("moon endpoints are not supported until Phase 1b");
  if (f.obj.type === ObjectType.Star || t.obj.type === ObjectType.Star) {
    throw new Error("the star cannot be a travel endpoint");
  }
  return findDirectRoutes(
    bodyRefOf(f.obj),
    bodyRefOf(t.obj),
    from.type,
    to.type,
    muStar(system.star.mass),
    system.star.id,
    options,
  );
}
