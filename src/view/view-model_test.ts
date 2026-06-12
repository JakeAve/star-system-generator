import { assertAlmostEquals, assertEquals } from "@std/assert";
import { generateSolarSystem } from "../core/generator.ts";
import { buildViewModel } from "./view-model.ts";
import { orbitParams, orbitPosition, solveKepler } from "../core/kinematics.ts";
import {
  MigrationArchetype,
  ObjectType,
  SolarSystem,
  SpectralType,
} from "../core/types.ts";

function singlePlanetSystem(
  eccentricity: number,
  orbitalPhase: number,
): SolarSystem {
  const star = {
    id: "star",
    name: "G-type Star",
    type: ObjectType.Star as const,
    spectralType: SpectralType.G,
    luminosity: 1,
    habitableZoneAU: 1,
    orbitRadius: 0,
    orbitPeriod: 0,
    eccentricity: 0,
    radius: 1,
    mass: 1,
    settlementCap: 0,
    deposits: [],
    moons: [],
    orbitalPhase: 0,
    periapsisAngle: 0,
    rotationPeriodDays: 0,
    tidallyLocked: false,
    knownAtStart: true,
  };
  const planet = {
    id: "p1",
    name: "Planet",
    type: ObjectType.RockyPlanet,
    orbitRadius: 1,
    orbitPeriod: 365,
    eccentricity,
    radius: 1,
    mass: 1,
    settlementCap: 0,
    deposits: [],
    moons: [],
    orbitalPhase,
    periapsisAngle: 0,
    rotationPeriodDays: 1,
    tidallyLocked: false,
    knownAtStart: true,
  };
  return {
    seed: 1,
    star,
    migrationHistory: MigrationArchetype.DynamicallyCold,
    objects: [planet],
  };
}

Deno.test("buildViewModel returns a star body first", () => {
  const sys = generateSolarSystem({ seed: 42 });
  const vm = buildViewModel(sys, 0);
  assertEquals(vm[0].type, "star");
  assertEquals(vm[0].parentId, null);
  assertEquals(vm[0].position, { x: 0, y: 0 });
});

Deno.test("buildViewModel includes every object and moon exactly once", () => {
  const sys = generateSolarSystem({ seed: 42 });
  const moonCount = sys.objects.reduce((n, o) => n + (o.moons?.length ?? 0), 0);
  const vm = buildViewModel(sys, 0);
  assertEquals(vm.length, 1 + sys.objects.length + moonCount);
});

Deno.test("buildViewModel is deterministic for the same system + time", () => {
  const sys = generateSolarSystem({ seed: 7 });
  assertEquals(buildViewModel(sys, 123), buildViewModel(sys, 123));
});

Deno.test("buildViewModel: moon world position is relative to its parent", () => {
  const sys = generateSolarSystem({ seed: 42 });
  const vm = buildViewModel(sys, 50);
  const moon = vm.find((b) => b.parentId !== null && b.type === "moon");
  if (moon) {
    const parent = vm.find((b) => b.id === moon.parentId)!;
    assertEquals(typeof moon.position.x, "number");
    assertEquals(
      moon.position.x !== parent.position.x ||
        moon.position.y !== parent.position.y,
      true,
    );
  }
});

Deno.test("buildViewModel: star body id matches system.star.id", () => {
  const system = generateSolarSystem({ seed: 42 });
  const vm = buildViewModel(system, 0);
  const starBody = vm.find((b) => b.type === "star");
  assertEquals(starBody?.id, system.star.id);
});

Deno.test("buildViewModel: eccentric body placed by Kepler solve at t=0", () => {
  const e = 0.5, phase = 0.25;
  const vm = buildViewModel(singlePlanetSystem(e, phase), 0);
  const planet = vm.find((b) => b.id === "p1")!;
  const { a, b, c } = orbitParams(1, e, false);
  const E = solveKepler(phase * Math.PI * 2, e);
  const expected = orbitPosition(a, b, c, E, 0);
  assertAlmostEquals(planet.position.x, expected.x, 1e-9);
  assertAlmostEquals(planet.position.y, expected.y, 1e-9);
});
