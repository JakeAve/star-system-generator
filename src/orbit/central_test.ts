import { assertAlmostEquals, assertEquals } from "@std/assert";
import { MigrationArchetype, ObjectType, SpectralType, type CelestialObject, type SolarSystem } from "../core/types.ts";
import { R_EARTH_M, R_SUN_M } from "../travel/units.ts";
import { bodyMu, outerBoundM, surfaceRadiusM } from "./central.ts";

// Minimal body factory — only the fields the orbit layer reads.
function body(partial: Partial<CelestialObject>): CelestialObject {
  return {
    id: "x", name: "x", type: ObjectType.RockyPlanet,
    orbitRadius: 1, orbitPeriod: 0, eccentricity: 0,
    radius: 1, mass: 1, settlementCap: 0, deposits: [], moons: [],
    knownAtStart: true, orbitalPhase: 0, periapsisAngle: 0,
    retrograde: false, rotationPeriodDays: 1, tidallyLocked: false,
    ...partial,
  };
}

const star = body({
  id: "star", type: ObjectType.Star, mass: 1, radius: 1, orbitRadius: 0,
  spectralType: SpectralType.G, luminosity: 1, habitableZoneAU: 1,
}) as SolarSystem["star"];

function system(objects: CelestialObject[]): SolarSystem {
  return { seed: 1, star, migrationHistory: MigrationArchetype.DynamicallyCold, objects };
}

Deno.test("bodyMu: Earth-mass planet ≈ 3.986e14", () => {
  assertAlmostEquals(bodyMu(body({ mass: 1 })), 3.986e14, 2e12);
});

Deno.test("bodyMu: 1-solar-mass star ≈ 1.327e20", () => {
  assertAlmostEquals(bodyMu(star), 1.327e20, 5e17);
});

Deno.test("surfaceRadiusM: planet uses Earth radii, star uses solar radii", () => {
  assertAlmostEquals(surfaceRadiusM(body({ radius: 2 })), 2 * R_EARTH_M, 1);
  assertAlmostEquals(surfaceRadiusM(star), 1 * R_SUN_M, 1);
});

Deno.test("outerBoundM: star is unbounded (null)", () => {
  assertEquals(outerBoundM(star, system([])), null);
});

Deno.test("outerBoundM: planet uses SOI w.r.t. star (positive, < orbit radius)", () => {
  const planet = body({ id: "p", type: ObjectType.RockyPlanet, mass: 1, orbitRadius: 1 });
  const r = outerBoundM(planet, system([planet]));
  // Earth SOI ≈ 9.2e8 m
  assertAlmostEquals(r as number, 9.2e8, 1e8);
});

Deno.test("outerBoundM: moon uses its own Hill radius within parent", () => {
  const moon = body({ id: "m", type: ObjectType.Moon, parentId: "p", mass: 0.0123, orbitRadius: 0.00257 });
  const planet = body({ id: "p", type: ObjectType.RockyPlanet, mass: 1, orbitRadius: 1, moons: [moon] });
  const r = outerBoundM(moon, system([planet]));
  // Hill radius of Moon ≈ 6.1e7 m
  assertAlmostEquals(r as number, 6.1e7, 1e7);
});
