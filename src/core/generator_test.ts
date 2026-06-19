// system-seeder-2/generator_test.ts

import { assert, assertEquals } from "@std/assert";
import { RNG } from "./rng.ts";
import { makeMoon, massFromRadiusDensity, M_EARTH_IN_SOLAR, rsig } from "./generator.ts";

Deno.test("rsig: rounds to 4 significant figures at any magnitude", () => {
  assertEquals(rsig(94.041), 94.04);
  assertEquals(rsig(527.31), 527.3);
  assertEquals(rsig(0.054321), 0.05432);
  assertEquals(rsig(0.0002), 0.0002);
});

Deno.test("rsig: preserves very small values (no zero-collapse)", () => {
  assertEquals(rsig(4e-13), 4e-13);
  assertEquals(rsig(2.4e-10), 2.4e-10);
});

Deno.test("rsig: honors the sig parameter", () => {
  assertEquals(rsig(94.041, 2), 94);
  assertEquals(rsig(94.041, 6), 94.041);
});

Deno.test("rsig: maps zero to zero", () => {
  assertEquals(rsig(0), 0);
});

Deno.test("massFromRadiusDensity: Earth-unit point gives 1 M⊕", () => {
  assertEquals(massFromRadiusDensity(1.0, 1.0), 1);
});

Deno.test("massFromRadiusDensity: zero radius or density gives zero", () => {
  assertEquals(massFromRadiusDensity(0, 1.0), 0);
  assertEquals(massFromRadiusDensity(1.0, 0), 0);
});

Deno.test("massFromRadiusDensity: Jupiter-scale gives hundreds of M⊕", () => {
  // radius 11.2 R⊕, density 0.24 rel => ~337 M⊕
  const m = massFromRadiusDensity(11.2, 0.24);
  assert(m > 300 && m < 360, `expected ~337 M⊕, got ${m}`);
});

Deno.test("massFromRadiusDensity: comet-scale stays nonzero", () => {
  // radius 0.0002 R⊕, density 0.05 rel => ~4e-13 M⊕
  const m = massFromRadiusDensity(0.0002, 0.05);
  assertEquals(m, 4e-13);
  assert(Number.isFinite(m), `expected finite, got ${m}`);
});

Deno.test("RNG: same seed produces same sequence", () => {
  const r1 = new RNG(12345);
  const r2 = new RNG(12345);
  for (let i = 0; i < 20; i++) {
    assertEquals(r1.next(), r2.next());
  }
});

Deno.test("RNG: different seeds produce different sequences", () => {
  const r1 = new RNG(1);
  const r2 = new RNG(2);
  const seq1 = Array.from({ length: 10 }, () => r1.next());
  const seq2 = Array.from({ length: 10 }, () => r2.next());
  assert(seq1.some((v, i) => v !== seq2[i]));
});

import { DEFAULT_CONFIG } from "./config.ts";
import {
  CelestialObject,
  MigrationArchetype,
  ObjectType,
  Resource,
} from "./types.ts";

Deno.test("config: all ObjectTypes have resource weights", () => {
  for (const type of Object.values(ObjectType)) {
    const weights = DEFAULT_CONFIG.resourceWeights[type];
    assert(weights !== undefined, `Missing weights for ${type}`);
    for (const r of Object.values(Resource)) {
      assert(
        typeof weights[r] === "number",
        `Missing resource ${r} in ${type} weights`,
      );
    }
  }
});

Deno.test("config: all Resources have frost-line multipliers", () => {
  for (const r of Object.values(Resource)) {
    const m = DEFAULT_CONFIG.frostLineMultipliers[r];
    assert(m !== undefined, `Missing frost multiplier for ${r}`);
    assert(m.inner >= 0 && m.outer >= 0);
  }
});

Deno.test("config: all MigrationArchetypes have profiles with slots", () => {
  for (const arch of Object.values(MigrationArchetype)) {
    const profile = DEFAULT_CONFIG.archetypeProfiles[arch];
    assert(profile !== undefined, `Missing profile for ${arch}`);
    assert(profile.slots.length > 0, `No slots for ${arch}`);
  }
});

import { settlementCap } from "./generator.ts";

Deno.test("settlementCap: gasGiant returns 0", () => {
  assertEquals(
    settlementCap(ObjectType.GasGiant, 8.0, DEFAULT_CONFIG, 0, 5.0),
    0,
  );
});

Deno.test("settlementCap: iceGiant returns 0", () => {
  assertEquals(
    settlementCap(ObjectType.IceGiant, 7.0, DEFAULT_CONFIG, 0, 5.0),
    0,
  );
});

Deno.test("settlementCap: asteroid always returns 1", () => {
  assertEquals(
    settlementCap(ObjectType.Asteroid, 2.0, DEFAULT_CONFIG, 0, 5.0),
    1,
  );
});

Deno.test("settlementCap: inner moon scales with radiusMultiplier 7 (min 1)", () => {
  // parentOrbit 1.0 < frostLine 5.0 => moonInner { min:1, radiusMultiplier:7 }
  // radius=0.1 => max(1, floor(0.7)) = max(1,0) = 1
  assertEquals(
    settlementCap(ObjectType.Moon, 0.1, DEFAULT_CONFIG, 1.0, 5.0),
    1,
  );
  // radius=0.42 (Ganymede) => max(1, floor(2.94)) = 2
  assertEquals(
    settlementCap(ObjectType.Moon, 0.42, DEFAULT_CONFIG, 1.0, 5.0),
    2,
  );
});

Deno.test("settlementCap: outer moon uses moonOuter (min 2)", () => {
  // parentOrbit 8.0 >= frostLine 5.0 => moonOuter { min:2, radiusMultiplier:7 }
  // radius=0.05 => max(2, floor(0.35)) = max(2,0) = 2
  assertEquals(
    settlementCap(ObjectType.Moon, 0.05, DEFAULT_CONFIG, 8.0, 5.0),
    2,
  );
  // radius=0.42 => max(2, floor(2.94)) = max(2,2) = 2
  assertEquals(
    settlementCap(ObjectType.Moon, 0.42, DEFAULT_CONFIG, 8.0, 5.0),
    2,
  );
});

Deno.test("settlementCap: dwarfPlanet is flat 2 over its R⊕ range", () => {
  // dwarfPlanet { min:2, radiusMultiplier:5 }; radius 0.07–0.19 => floor(<1)=0 => 2
  assertEquals(
    settlementCap(ObjectType.DwarfPlanet, 0.07, DEFAULT_CONFIG, 0, 5.0),
    2,
  );
  assertEquals(
    settlementCap(ObjectType.DwarfPlanet, 0.19, DEFAULT_CONFIG, 0, 5.0),
    2,
  );
});

Deno.test("settlementCap: rockyPlanet scales with radiusMultiplier 1.5 (1–3)", () => {
  // radius=1.0 (Earth) => max(1, floor(1.5)) = 1
  assertEquals(
    settlementCap(ObjectType.RockyPlanet, 1.0, DEFAULT_CONFIG, 0, 5.0),
    1,
  );
  // radius=2.0 (super-Earth) => max(1, floor(3.0)) = 3
  assertEquals(
    settlementCap(ObjectType.RockyPlanet, 2.0, DEFAULT_CONFIG, 0, 5.0),
    3,
  );
});

import { generateDeposits } from "./generator.ts";
import { ResourceDeposit } from "./types.ts";

Deno.test("generateDeposits: all deposits use valid Resource values", () => {
  const validResources = new Set(Object.values(Resource));
  const rng = new RNG(1);
  const frostLineAU = 2.7;
  const deposits = generateDeposits(
    rng,
    ObjectType.RockyPlanet,
    DEFAULT_CONFIG,
    0.5,
    frostLineAU,
  );
  for (const d of deposits) {
    assert(validResources.has(d.resource), `Invalid resource: ${d.resource}`);
    assert(d.abundance >= 0 && d.abundance <= 1.0);
    assertEquals(d.confidence, 0);
  }
});

Deno.test("generateDeposits: inner rocky planet gets more silicates than water", () => {
  let silicatesCount = 0;
  let waterCount = 0;
  const frostLineAU = 2.7;
  for (let i = 0; i < 200; i++) {
    const rng = new RNG(i);
    const deps = generateDeposits(
      rng,
      ObjectType.RockyPlanet,
      DEFAULT_CONFIG,
      0.5,
      frostLineAU,
    );
    if (deps.some((d: ResourceDeposit) => d.resource === Resource.Silicates)) {
      silicatesCount++;
    }
    if (deps.some((d: ResourceDeposit) => d.resource === Resource.Water)) {
      waterCount++;
    }
  }
  assert(
    silicatesCount > waterCount,
    `Expected silicates (${silicatesCount}) > water (${waterCount}) inner rocky`,
  );
});

Deno.test("generateDeposits: outer body gets more water than inner body of same type", () => {
  const frostLineAU = 2.7;
  let innerWater = 0;
  let outerWater = 0;
  for (let i = 0; i < 200; i++) {
    const r1 = new RNG(i * 1000);
    const inner = generateDeposits(
      r1,
      ObjectType.RockyPlanet,
      DEFAULT_CONFIG,
      0.5,
      frostLineAU,
    );
    if (inner.some((d: ResourceDeposit) => d.resource === Resource.Water)) {
      innerWater++;
    }
    const r2 = new RNG(i * 1000 + 1);
    const outer = generateDeposits(
      r2,
      ObjectType.RockyPlanet,
      DEFAULT_CONFIG,
      5.0,
      frostLineAU,
    );
    if (outer.some((d: ResourceDeposit) => d.resource === Resource.Water)) {
      outerWater++;
    }
  }
  assert(
    outerWater > innerWater,
    `Expected outer water (${outerWater}) > inner water (${innerWater})`,
  );
});

Deno.test("generateDeposits: outer gas giant gets high volatiles", () => {
  const frostLineAU = 2.7;
  let volatileCount = 0;
  for (let i = 0; i < 100; i++) {
    const rng = new RNG(i);
    const deps = generateDeposits(
      rng,
      ObjectType.GasGiant,
      DEFAULT_CONFIG,
      10.0,
      frostLineAU,
    );
    if (deps.some((d: ResourceDeposit) => d.resource === Resource.Volatiles)) {
      volatileCount++;
    }
  }
  // Outer gas giants should almost always have volatiles
  assert(
    volatileCount > 80,
    `Expected >80 volatile hits, got ${volatileCount}`,
  );
});

Deno.test("generateDeposits: waterBonus increases water occurrence", () => {
  const frostLineAU = 2.7;
  let withBonus = 0;
  let withoutBonus = 0;
  for (let i = 0; i < 200; i++) {
    const r1 = new RNG(i * 500);
    const bonusDeps = generateDeposits(
      r1,
      ObjectType.RockyPlanet,
      DEFAULT_CONFIG,
      0.5,
      frostLineAU,
      0.25,
    );
    if (bonusDeps.some((d: ResourceDeposit) => d.resource === Resource.Water)) {
      withBonus++;
    }
    const r2 = new RNG(i * 500);
    const noBonusDeps = generateDeposits(
      r2,
      ObjectType.RockyPlanet,
      DEFAULT_CONFIG,
      0.5,
      frostLineAU,
      0,
    );
    if (
      noBonusDeps.some((d: ResourceDeposit) => d.resource === Resource.Water)
    ) withoutBonus++;
  }
  assert(
    withBonus > withoutBonus,
    `Expected bonus (${withBonus}) > no bonus (${withoutBonus})`,
  );
});

import { allObjects, generateSolarSystem, knownObjects } from "./generator.ts";

Deno.test("generateSolarSystem: same seed produces identical output", () => {
  const s1 = generateSolarSystem({ seed: 12345 });
  const s2 = generateSolarSystem({ seed: 12345 });
  assertEquals(s1, s2);
});

Deno.test("generateSolarSystem: objects sorted ascending by orbitRadius", () => {
  const system = generateSolarSystem({ seed: 42 });
  for (let i = 1; i < system.objects.length; i++) {
    assert(
      system.objects[i].orbitRadius >= system.objects[i - 1].orbitRadius,
      `Object ${i} at ${system.objects[i].orbitRadius} AU < previous ${
        system.objects[i - 1].orbitRadius
      } AU`,
    );
  }
});

Deno.test("generateSolarSystem: no moons in top-level objects array", () => {
  const system = generateSolarSystem({ seed: 7 });
  assert(
    system.objects.every((o) => o.type !== ObjectType.Moon),
    "Found moon in top-level objects",
  );
});

Deno.test("generateSolarSystem: all deposits use new Resource enum values", () => {
  const validResources = new Set(Object.values(Resource));
  for (let seed = 0; seed < 10; seed++) {
    const system = generateSolarSystem({ seed });
    for (const obj of allObjects(system)) {
      for (const dep of obj.deposits) {
        assert(
          validResources.has(dep.resource),
          `Invalid resource '${dep.resource}' in seed ${seed}`,
        );
      }
    }
  }
});

Deno.test("generateSolarSystem: no IcePlanet objects (only IceGiant)", () => {
  for (let seed = 0; seed < 20; seed++) {
    const system = generateSolarSystem({ seed });
    for (const obj of allObjects(system)) {
      assert(
        (obj.type as string) !== "icePlanet",
        `Found deprecated icePlanet type in seed ${seed}`,
      );
    }
  }
});

Deno.test("allObjects: includes nested moons", () => {
  const system = generateSolarSystem({ seed: 1 });
  const all = allObjects(system);
  const moons = all.filter((o) => o.type === ObjectType.Moon);
  // All moons must have a parentId
  assert(moons.every((m) => m.parentId !== undefined), "Moon without parentId");
  // allObjects count >= top-level count
  assert(all.length >= system.objects.length);
});

Deno.test("knownObjects: all are knownAtStart and subset of allObjects", () => {
  const system = generateSolarSystem({ seed: 42 });
  const all = allObjects(system);
  const known = knownObjects(system);
  const allIds = new Set(all.map((o) => o.id));
  assert(known.every((k) => k.knownAtStart === true));
  assert(known.every((k) => allIds.has(k.id)));
});

Deno.test("generateSolarSystem: HotJupiter has primary gas giant < 0.15 AU", () => {
  let found = false;
  for (let seed = 0; seed < 500; seed++) {
    const system = generateSolarSystem({ seed });
    if (system.migrationHistory !== MigrationArchetype.HotJupiter) continue;
    const primary = system.objects.find((o) => o.type === ObjectType.GasGiant);
    if (primary) {
      assert(
        primary.orbitRadius < 0.15,
        `HotJupiter primary at ${primary.orbitRadius} AU — expected < 0.15`,
      );
      found = true;
      break;
    }
  }
  assert(found, "Could not find a HotJupiter system in 500 seeds");
});

Deno.test("orbitalPhase is between 0 and 1", () => {
  const system = generateSolarSystem({ seed: 1 });
  for (const obj of allObjects(system)) {
    assert(
      obj.orbitalPhase >= 0 && obj.orbitalPhase <= 1,
      `${obj.id} orbitalPhase ${obj.orbitalPhase} out of range`,
    );
  }
});

Deno.test("tidally locked planets have rotationPeriodDays === orbitPeriod", () => {
  let checkedAny = false;
  for (let seed = 0; seed < 20; seed++) {
    const system = generateSolarSystem({ seed });
    for (const obj of allObjects(system)) {
      if (obj.tidallyLocked) {
        assertEquals(
          obj.rotationPeriodDays,
          obj.orbitPeriod,
          `${obj.id} (seed ${seed}) tidallyLocked but rotationPeriodDays ${obj.rotationPeriodDays} !== orbitPeriod ${obj.orbitPeriod}`,
        );
        checkedAny = true;
      }
    }
  }
  assert(
    checkedAny,
    "No tidally locked bodies found in 20 systems — adjust threshold or seeds",
  );
});

Deno.test("non-locked bodies have rotationPeriodDays within config range", () => {
  const cfg = DEFAULT_CONFIG;
  const typeRanges: Array<
    [import("./types.ts").ObjectType, { min: number; max: number }]
  > = [
    [ObjectType.GasGiant, cfg.rotationPeriodDays.gasGiant],
    [ObjectType.IceGiant, cfg.rotationPeriodDays.iceGiant],
    [ObjectType.RockyPlanet, cfg.rotationPeriodDays.rockyPlanet],
    [ObjectType.Asteroid, cfg.rotationPeriodDays.asteroid],
    [ObjectType.DwarfPlanet, cfg.rotationPeriodDays.dwarfPlanet],
    [ObjectType.Moon, cfg.rotationPeriodDays.moon],
    [ObjectType.Comet, cfg.rotationPeriodDays.comet],
  ];
  for (let seed = 0; seed < 10; seed++) {
    const system = generateSolarSystem({ seed });
    for (const obj of allObjects(system)) {
      if (obj.tidallyLocked) continue;
      const entry = typeRanges.find(([t]) => t === obj.type);
      if (!entry) continue;
      const [, range] = entry;
      assert(
        obj.rotationPeriodDays >= range.min &&
          obj.rotationPeriodDays <= range.max,
        `${obj.type} seed ${seed} rotationPeriodDays ${obj.rotationPeriodDays} outside [${range.min}, ${range.max}]`,
      );
    }
  }
});

Deno.test("generateSolarSystem: CompactMultiplanet has no moons on inner planets", () => {
  let found = false;
  for (let seed = 0; seed < 500; seed++) {
    const system = generateSolarSystem({ seed });
    if (system.migrationHistory !== MigrationArchetype.CompactMultiplanet) {
      continue;
    }
    const rockies = system.objects.filter((o) =>
      o.type === ObjectType.RockyPlanet
    );
    assert(
      rockies.every((p) => p.moons.length === 0),
      "CompactMultiplanet rocky planet has moons",
    );
    found = true;
    break;
  }
  assert(found, "Could not find a CompactMultiplanet system in 500 seeds");
});

Deno.test("comets have eccentricity in [0.6, 0.97]", () => {
  let checked = 0;
  for (let seed = 0; seed < 100; seed++) {
    const system = generateSolarSystem({ seed });
    for (const obj of system.objects) {
      if (obj.type !== ObjectType.Comet) continue;
      assert(
        obj.eccentricity >= 0.6 && obj.eccentricity <= 0.97,
        `Comet seed ${seed} eccentricity ${obj.eccentricity} outside [0.6, 0.97]`,
      );
      checked++;
    }
  }
  assert(checked > 0, "No comets found in 100 systems to check eccentricity");
});

Deno.test("comets have no moons and are never knownAtStart", () => {
  let checked = 0;
  for (let seed = 0; seed < 50; seed++) {
    const system = generateSolarSystem({ seed });
    for (const obj of system.objects) {
      if (obj.type !== ObjectType.Comet) continue;
      assertEquals(obj.moons.length, 0, `Comet ${obj.id} has moons`);
      assertEquals(obj.knownAtStart, false, `Comet ${obj.id} is knownAtStart`);
      checked++;
    }
  }
  assert(checked > 0, "No comets found in 50 systems");
});

Deno.test("comets have settlementCap between 1 and 2", () => {
  let checked = 0;
  for (let seed = 0; seed < 50; seed++) {
    const system = generateSolarSystem({ seed });
    for (const obj of system.objects) {
      if (obj.type !== ObjectType.Comet) continue;
      assert(
        obj.settlementCap >= 1 && obj.settlementCap <= 2,
        `Comet ${obj.id} settlementCap ${obj.settlementCap} outside [1, 2]`,
      );
      checked++;
    }
  }
  assert(checked > 0, "No comets found in 50 systems");
});

Deno.test("comets produce water and volatiles deposits more than metals", () => {
  let waterCount = 0;
  let volatileCount = 0;
  let metalCount = 0;
  for (let seed = 0; seed < 100; seed++) {
    const system = generateSolarSystem({ seed });
    for (const obj of system.objects) {
      if (obj.type !== ObjectType.Comet) continue;
      for (const dep of obj.deposits) {
        if (dep.resource === Resource.Water) waterCount++;
        if (dep.resource === Resource.Volatiles) volatileCount++;
        if (dep.resource === Resource.Metals) metalCount++;
      }
    }
  }
  assert(waterCount > 0, "Comets should produce water deposits");
  assert(volatileCount > 0, "Comets should produce volatiles deposits");
  assertEquals(metalCount, 0, "Comets should never produce metal deposits");
});

Deno.test("generateSolarSystem: comets appear across seeds", () => {
  let cometCount = 0;
  for (let seed = 0; seed < 50; seed++) {
    const system = generateSolarSystem({ seed });
    cometCount += system.objects.filter((o) =>
      o.type === ObjectType.Comet
    ).length;
  }
  assert(cometCount > 0, "No comets found in 50 systems");
});

Deno.test("generateSolarSystem: star has an obj_N id", () => {
  const system = generateSolarSystem({ seed: 42 });
  assert(typeof system.star.id === "string", "star.id should be a string");
  assert(
    /^obj_\d+$/.test(system.star.id),
    `star.id "${system.star.id}" does not match obj_N format`,
  );
});

Deno.test("generateSolarSystem: all IDs are unique including the star", () => {
  const system = generateSolarSystem({ seed: 42 });
  const ids = allObjects(system).map((o) => o.id);
  const unique = new Set(ids);
  assertEquals(unique.size, ids.length, "Duplicate IDs found in system");
});

Deno.test("generateSolarSystem: star gets obj_1 (first nextId call)", () => {
  const system = generateSolarSystem({ seed: 42 });
  assertEquals(system.star.id, "obj_1");
});

Deno.test("allObjects: star is first element", () => {
  const system = generateSolarSystem({ seed: 42 });
  assertEquals(allObjects(system)[0], system.star);
});

Deno.test("allObjects: count includes star", () => {
  const system = generateSolarSystem({ seed: 42 });
  const celestialCount = system.objects.flatMap((o) => [o, ...o.moons]).length;
  assertEquals(allObjects(system).length, celestialCount + 1);
});

// Flatten every non-star body (top-level + moons) across many seeds.
function allNonStarBodies(seedCount: number) {
  const out: CelestialObject[] = [];
  for (let seed = 1; seed <= seedCount; seed++) {
    const sys = generateSolarSystem({ seed });
    for (const obj of sys.objects) {
      out.push(obj);
      for (const moon of obj.moons) out.push(moon);
    }
  }
  return out;
}

const SWEPT_BODIES = allNonStarBodies(50);

Deno.test("generator: no non-star body has zero/non-finite radius or mass", () => {
  for (const b of SWEPT_BODIES) {
    assert(
      b.radius > 0 && Number.isFinite(b.radius),
      `${b.type} radius ${b.radius}`,
    );
    assert(b.mass > 0 && Number.isFinite(b.mass), `${b.type} mass ${b.mass}`);
  }
});

Deno.test("generator: recomputed density (mass / radius³) lands in the type's band", () => {
  const d = DEFAULT_CONFIG.densityRanges;
  const bandFor = (type: string) => {
    switch (type) {
      case ObjectType.RockyPlanet:
        // covers rocky + super-Earth (both ObjectType.RockyPlanet); widen upper bound
        return { min: d.rockyPlanet.min, max: d.superEarth.max };
      case ObjectType.GasGiant:
        return d.gasGiant;
      case ObjectType.IceGiant:
        return d.iceGiant;
      case ObjectType.Moon:
        return d.moon;
      case ObjectType.Asteroid:
        return d.asteroid;
      case ObjectType.DwarfPlanet:
        return d.dwarfPlanet;
      case ObjectType.Comet:
        return d.comet;
      default:
        return null;
    }
  };
  for (const b of SWEPT_BODIES) {
    const band = bandFor(b.type);
    if (!band) continue;
    const recomputed = b.mass / b.radius ** 3;
    const lo = band.min * 0.97;
    const hi = band.max * 1.03;
    assert(
      recomputed >= lo && recomputed <= hi,
      `${b.type} density ${recomputed} outside [${lo}, ${hi}] (r=${b.radius}, m=${b.mass})`,
    );
  }
});

Deno.test("generator: gas giants are tens-to-hundreds of M⊕, ice giants low tens", () => {
  const bodies = SWEPT_BODIES;
  for (const g of bodies.filter((b) => b.type === ObjectType.GasGiant)) {
    assert(g.mass > 50 && g.mass < 600, `gas giant mass ${g.mass}`);
  }
  for (const i of bodies.filter((b) => b.type === ObjectType.IceGiant)) {
    assert(i.mass > 10 && i.mass < 30, `ice giant mass ${i.mass}`);
  }
});

Deno.test("eccentricity model: most planets are near-circular", () => {
  const sys = generateSolarSystem({ seed: 7 });
  const planets = allObjects(sys).filter((b) =>
    b.type === ObjectType.RockyPlanet ||
    b.type === ObjectType.GasGiant ||
    b.type === ObjectType.IceGiant
  );
  if (planets.length > 0) {
    const eccs = planets.map((p) => p.eccentricity).sort((a, b) => a - b);
    const median = eccs[Math.floor(eccs.length / 2)];
    assert(
      median < 0.1,
      `median planet eccentricity ${median} should be < 0.1`,
    );
    for (const p of planets) {
      assert(
        p.eccentricity <= 0.15 + 1e-9,
        `planet ecc ${p.eccentricity} exceeds max`,
      );
    }
  }
});

Deno.test("eccentricity model: comets remain highly eccentric", () => {
  // Seed 7 is known to contain a comet (see scan); assert any comet is high-e.
  const sys = generateSolarSystem({ seed: 7 });
  const comets = allObjects(sys).filter((b) => b.type === ObjectType.Comet);
  assert(comets.length > 0, "seed 7 should produce at least one comet");
  for (const c of comets) {
    assert(
      c.eccentricity >= 0.6,
      `comet ecc ${c.eccentricity} should be >= 0.6`,
    );
  }
});

Deno.test("eccentricity model: no body reaches parabolic (e < 1)", () => {
  for (const seed of [1, 2, 3, 7, 42, 100]) {
    for (const b of allObjects(generateSolarSystem({ seed }))) {
      assert(
        b.eccentricity < 1,
        `seed ${seed}: ${b.name} has e=${b.eccentricity}`,
      );
    }
  }
});

Deno.test("eccentricity model: generation is deterministic per seed", () => {
  const a = generateSolarSystem({ seed: 7 });
  const b = generateSolarSystem({ seed: 7 });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ── Retrograde field tests ─────────────────────────────────────────────────────

function nonStarNonMoonBodies(sys: ReturnType<typeof generateSolarSystem>) {
  return sys.objects.filter(
    (o) => o.type !== ObjectType.Star && o.type !== ObjectType.Moon,
  );
}

Deno.test("generation: retrograde=1.0 marks every eligible body retrograde", () => {
  const sys = generateSolarSystem({
    seed: 42,
    retrogradeDefaults: {
      [ObjectType.Star]: 0,
      [ObjectType.RockyPlanet]: 1,
      [ObjectType.GasGiant]: 1,
      [ObjectType.IceGiant]: 1,
      [ObjectType.Moon]: 0,
      [ObjectType.Asteroid]: 1,
      [ObjectType.DwarfPlanet]: 1,
      [ObjectType.Comet]: 1,
    },
  });
  const bodies = nonStarNonMoonBodies(sys);
  assert(bodies.length > 0, "expected at least one eligible body");
  assert(
    bodies.every((b) => b.retrograde === true),
    "all eligible bodies should be retrograde",
  );
});

Deno.test("generation: retrograde=0 leaves everything prograde; moons/star always prograde", () => {
  const sys = generateSolarSystem({
    seed: 42,
    retrogradeDefaults: {
      [ObjectType.Star]: 0,
      [ObjectType.RockyPlanet]: 0,
      [ObjectType.GasGiant]: 0,
      [ObjectType.IceGiant]: 0,
      [ObjectType.Moon]: 0,
      [ObjectType.Asteroid]: 0,
      [ObjectType.DwarfPlanet]: 0,
      [ObjectType.Comet]: 0,
    },
    capturedMoonRetrograde: 0,
  });
  assertEquals(sys.star.retrograde, false);
  for (const o of sys.objects) {
    assertEquals(o.retrograde, false);
    for (const m of o.moons) assertEquals(m.retrograde, false);
  }
});

Deno.test("generation: moons stay prograde even at high body retrograde rate", () => {
  const sys = generateSolarSystem({
    seed: 7,
    retrogradeDefaults: {
      [ObjectType.Star]: 0,
      [ObjectType.RockyPlanet]: 1,
      [ObjectType.GasGiant]: 1,
      [ObjectType.IceGiant]: 1,
      [ObjectType.Moon]: 0,
      [ObjectType.Asteroid]: 1,
      [ObjectType.DwarfPlanet]: 1,
      [ObjectType.Comet]: 1,
    },
    capturedMoonRetrograde: 0,
  });
  for (const o of sys.objects) {
    for (const m of o.moons) assertEquals(m.retrograde, false);
  }
});

// ── makeMoon: captured-moon broadening (Phase 2) ─────────────────────────────

function idGen() {
  let n = 0;
  return () => `m${n++}`;
}

// Helper: expected Hill radius (AU) for the moon's parent.
function hillAU(parentOrbitAU: number, parentMass: number, starMass: number) {
  return parentOrbitAU * Math.cbrt((parentMass * M_EARTH_IN_SOLAR) / (3 * starMass));
}

Deno.test("makeMoon: captureProbability=1 yields a captured moon with wide ecc and far distance", () => {
  const rng = new RNG(42);
  const m = makeMoon(rng, idGen(), 0, "p", 5.0, 300, 1.0, DEFAULT_CONFIG, 2.7, 1.0);
  assertEquals(m.capturedMoon, true);
  assert(m.eccentricity >= 0.1 && m.eccentricity <= 0.5, `ecc ${m.eccentricity}`);
  const ratio = m.orbitRadius / hillAU(5.0, 300, 1.0);
  assert(ratio >= 0.30 - 1e-3 && ratio <= 0.60 + 1e-3, `captured band ratio ${ratio}`);
});

Deno.test("makeMoon: captureProbability=0 yields a regular prograde moon, close in", () => {
  const rng = new RNG(42);
  const m = makeMoon(rng, idGen(), 0, "p", 5.0, 300, 1.0, DEFAULT_CONFIG, 2.7, 0.0);
  assertEquals(m.capturedMoon, undefined);
  assertEquals(m.retrograde, false);
  assert(m.eccentricity <= 0.05, `regular ecc ${m.eccentricity}`);
  const ratio = m.orbitRadius / hillAU(5.0, 300, 1.0);
  assert(ratio >= 0.05 - 1e-3 && ratio <= 0.25 + 1e-3, `regular band ratio ${ratio}`);
});

Deno.test("makeMoon: captured moon honors capturedMoonRetrograde (=1 all retrograde, =0 none)", () => {
  const allRetro = { ...DEFAULT_CONFIG, capturedMoonRetrograde: 1 };
  const noRetro = { ...DEFAULT_CONFIG, capturedMoonRetrograde: 0 };
  const a = makeMoon(new RNG(7), idGen(), 0, "p", 5.0, 300, 1.0, allRetro, 2.7, 1.0);
  const b = makeMoon(new RNG(7), idGen(), 0, "p", 5.0, 300, 1.0, noRetro, 2.7, 1.0);
  assertEquals(a.retrograde, true);
  assertEquals(b.retrograde, false);
});

Deno.test("makeMoon: regular moon never retrograde even if capturedMoonRetrograde=1", () => {
  const allRetro = { ...DEFAULT_CONFIG, capturedMoonRetrograde: 1 };
  const m = makeMoon(new RNG(7), idGen(), 0, "p", 5.0, 300, 1.0, allRetro, 2.7, 0.0);
  assertEquals(m.retrograde, false);
});
