// system-seeder-2/generator_test.ts

import {
  assert,
  assertEquals,
} from "@std/assert";
import { RNG } from "./rng.ts";

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
import { MigrationArchetype, ObjectType, Resource } from "./types.ts";

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

Deno.test("settlementCap: inner moon uses moonInner (min 1)", () => {
  // parentOrbit 1.0 < frostLine 5.0 => moonInner { min:1, radiusDivisor:2 }
  // radius=1 => max(1, floor(1/2)) = max(1,0) = 1
  assertEquals(
    settlementCap(ObjectType.Moon, 1.0, DEFAULT_CONFIG, 1.0, 5.0),
    1,
  );
  // radius=4 => max(1, floor(4/2)) = 2
  assertEquals(
    settlementCap(ObjectType.Moon, 4.0, DEFAULT_CONFIG, 1.0, 5.0),
    2,
  );
});

Deno.test("settlementCap: outer moon uses moonOuter (min 2)", () => {
  // parentOrbit 8.0 >= frostLine 5.0 => moonOuter { min:2, radiusDivisor:2 }
  // radius=1 => max(2, floor(1/2)) = max(2,0) = 2
  assertEquals(
    settlementCap(ObjectType.Moon, 1.0, DEFAULT_CONFIG, 8.0, 5.0),
    2,
  );
  // radius=6 => max(2, floor(6/2)) = max(2,3) = 3
  assertEquals(
    settlementCap(ObjectType.Moon, 6.0, DEFAULT_CONFIG, 8.0, 5.0),
    3,
  );
});

Deno.test("settlementCap: dwarfPlanet min 2 radiusDivisor 3", () => {
  // radius=3 => max(2, floor(3/3)) = max(2,1) = 2
  assertEquals(
    settlementCap(ObjectType.DwarfPlanet, 3.0, DEFAULT_CONFIG, 0, 5.0),
    2,
  );
  // radius=9 => max(2, floor(9/3)) = max(2,3) = 3
  assertEquals(
    settlementCap(ObjectType.DwarfPlanet, 9.0, DEFAULT_CONFIG, 0, 5.0),
    3,
  );
});

Deno.test("settlementCap: rockyPlanet scales with radiusMultiplier 1.5", () => {
  // radius=4 => max(1, floor(4*1.5)) = max(1,6) = 6
  assertEquals(
    settlementCap(ObjectType.RockyPlanet, 4.0, DEFAULT_CONFIG, 0, 5.0),
    6,
  );
  // radius=1 => max(1, floor(1*1.5)) = max(1,1) = 1
  assertEquals(
    settlementCap(ObjectType.RockyPlanet, 1.0, DEFAULT_CONFIG, 0, 5.0),
    1,
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
