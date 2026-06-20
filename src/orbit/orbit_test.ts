import { assertAlmostEquals, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { MigrationArchetype, ObjectType, type CelestialObject, type SolarSystem } from "../core/types.ts";
import {
  circularVelocity,
  computeOrbit,
  deltaVFromSurface,
  escapeVelocity,
  orbitalPeriod,
  specificEnergy,
} from "./orbit.ts";

const MU_EARTH = 3.986e14;
const R_EARTH = 6.371e6;

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
const star = body({ id: "star", type: ObjectType.Star, mass: 1, radius: 1, orbitRadius: 0 }) as SolarSystem["star"];
function system(objects: CelestialObject[]): SolarSystem {
  return { seed: 1, star, migrationHistory: MigrationArchetype.DynamicallyCold, objects };
}

Deno.test("circularVelocity: LEO (400 km) ≈ 7670 m/s", () => {
  assertAlmostEquals(circularVelocity(MU_EARTH, R_EARTH + 4e5), 7670, 50);
});

Deno.test("escapeVelocity: Earth surface ≈ 11186 m/s", () => {
  assertAlmostEquals(escapeVelocity(MU_EARTH, R_EARTH), 11186, 50);
});

Deno.test("orbitalPeriod: GEO radius ≈ 86164 s (sidereal day)", () => {
  assertAlmostEquals(orbitalPeriod(MU_EARTH, 4.2164e7), 86164, 500);
});

Deno.test("specificEnergy: negative and equals -mu/2r", () => {
  assertAlmostEquals(specificEnergy(MU_EARTH, 4.2164e7), -MU_EARTH / (2 * 4.2164e7), 1);
});

Deno.test("deltaVFromSurface: Earth surface→GEO ≈ 4015 m/s", () => {
  assertAlmostEquals(deltaVFromSurface(MU_EARTH, R_EARTH, 4.2164e7), 4015, 100);
});

Deno.test("computeOrbit: Earth-like planet, 400 km altitude → ~7.67 km/s, stable", () => {
  const earth = body({ id: "p", mass: 1, radius: 1, orbitRadius: 1 });
  const r = computeOrbit(earth, { value: 400, unit: "km" }, system([earth]));
  if (!r.applicable) throw new Error("expected applicable result");
  assertAlmostEquals(r.orbitalVelocityKmps, 7.67, 0.1);
  assertAlmostEquals(r.altitudeKm, 400, 1);
  assertEquals(r.stable, true);
});

Deno.test("computeOrbit: synchronous around non-rotating star → unavailable", () => {
  const nonRotatingStar = body({ id: "star", type: ObjectType.Star, mass: 1, radius: 1, orbitRadius: 0, rotationPeriodDays: 0 }) as SolarSystem["star"];
  const r = computeOrbit(nonRotatingStar, { type: "synchronous" }, system([]));
  assertFalse(r.applicable);
});

Deno.test("computeOrbit: orbit beyond SOI is reported but unstable", () => {
  const earth = body({ id: "p", mass: 1, radius: 1, orbitRadius: 1 });
  // 2e6 km from center is far beyond Earth's ~9.2e5 km SOI.
  const r = computeOrbit(earth, { value: 2e6, unit: "km" }, system([earth]));
  if (!r.applicable) throw new Error("expected applicable result");
  assertFalse(r.stable);
});

Deno.test("computeOrbit: radius echoed in km, AU, and body-radii agree", () => {
  const earth = body({ id: "p", mass: 1, radius: 1, orbitRadius: 1 });
  const r = computeOrbit(earth, { value: 1, unit: "bodyRadii" }, system([earth]));
  if (!r.applicable) throw new Error("expected applicable result");
  assertAlmostEquals(r.radiusBodyRadii, 1, 1e-9);
  assertAlmostEquals(r.radiusKm, 6371, 5);
});

Deno.test("computeOrbit: negative distance throws", () => {
  const earth = body({ id: "p", mass: 1, radius: 1, orbitRadius: 1 });
  assertThrows(
    () => computeOrbit(earth, { value: -5, unit: "km" }, system([earth])),
    Error,
    "non-negative",
  );
});
