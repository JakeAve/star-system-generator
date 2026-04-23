// system-seeder-2/generator.ts

import {
  CelestialObject,
  GeneratorConfig,
  MigrationArchetype,
  ObjectType,
  Resource,
  ResourceDeposit,
  ResourceWeights,
  SolarSystem,
  SpectralType,
  Star,
} from "./types.ts";
import { generateName, resetNameCounter, RNG } from "./rng.ts";
import { DEFAULT_CONFIG, pickArchetypeWeights } from "./config.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

// nextId is created as a closure inside generateSolarSystem; builder functions
// receive it as a parameter so there is no module-level mutable state.

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── Settlement cap ────────────────────────────────────────────────────────────

export function settlementCap(
  type: ObjectType,
  radius: number,
  config: GeneratorConfig,
  parentOrbitAU: number,
  frostLineAU: number,
): number {
  const sc = config.settlementConfig;
  if (type === ObjectType.GasGiant) return sc.gasGiant.cap!;
  if (type === ObjectType.IceGiant) return sc.iceGiant.cap!;
  if (type === ObjectType.Asteroid) return sc.asteroid.cap!;
  if (type === ObjectType.Moon) {
    const entry = parentOrbitAU >= frostLineAU ? sc.moonOuter : sc.moonInner;
    return Math.max(entry.min!, Math.floor(radius / entry.radiusDivisor!));
  }
  if (type === ObjectType.DwarfPlanet) {
    const e = sc.dwarfPlanet;
    return Math.max(e.min!, Math.floor(radius / e.radiusDivisor!));
  }
  // Comets set their own cap in makeComet via rng.int — settlementCap is not called for them
  if (type === ObjectType.Comet) throw new Error("settlementCap: comets set their own cap via rng.int in makeComet");
  // rockyPlanet
  const e = sc.rockyPlanet;
  return Math.max(e.min!, Math.floor(radius * e.radiusMultiplier!));
}

// ── Deposit generation ────────────────────────────────────────────────────────

export function generateDeposits(
  rng: RNG,
  type: ObjectType,
  config: GeneratorConfig,
  orbitAU: number,
  frostLineAU: number,
  waterBonus: number = 0,
): ResourceDeposit[] {
  const isOuter = orbitAU >= frostLineAU;
  const base = config.resourceWeights[type];

  // Build effective weights: base × frost-line multiplier
  const effectiveWeights: ResourceWeights = {} as ResourceWeights;
  for (const resource of Object.values(Resource)) {
    const mult = config.frostLineMultipliers[resource];
    let w = base[resource] * (isOuter ? mult.outer : mult.inner);
    if (resource === Resource.Water && waterBonus > 0) w += waterBonus * 2;
    effectiveWeights[resource] = w;
  }

  const count = rng.int(
    config.depositsPerObject.min,
    config.depositsPerObject.max,
  );
  const candidates = Object.values(Resource).filter((r) =>
    effectiveWeights[r] > 0
  );
  const chosen = new Set<Resource>();

  while (chosen.size < Math.min(count, candidates.length)) {
    const options = candidates
      .filter((r) => !chosen.has(r))
      .map((r) => ({ value: r, weight: effectiveWeights[r] }));
    if (options.length === 0) break;
    chosen.add(rng.weightedPick(options));
  }

  return [...chosen].map((resource) => {
    const isRich = rng.next() < config.richDepositChance;
    let abundance = isRich ? rng.float(0.65, 1.0) : rng.float(0.05, 0.60);
    if (resource === Resource.Water && waterBonus > 0) {
      abundance = Math.min(1.0, abundance + waterBonus);
    }
    return {
      resource,
      abundance: r2(abundance),
      confidence: 0,
    };
  });
}

// ── Star generator ────────────────────────────────────────────────────────────

function generateStar(rng: RNG, config: GeneratorConfig): Star {
  const type = rng.weightedPick(config.starWeights);
  const [luMin, luMax] = config.starLuminosity[type];
  const [mMin, mMax] = config.starMass[type];
  const [rMin, rMax] = config.starRadius[type];
  const luminosity = rng.float(luMin, luMax);
  return {
    spectralType: type,
    luminosity: r2(luminosity),
    habitableZoneAU: r2(Math.sqrt(luminosity)),
    mass: r2(rng.float(mMin, mMax)),
    radius: r2(rng.float(rMin, rMax)),
  };
}

// ── Moon builder ──────────────────────────────────────────────────────────────

function makeMoon(
  rng: RNG,
  nextId: () => string,
  index: number,
  parentId: string,
  parentOrbitAU: number,
  config: GeneratorConfig,
  frostLineAU: number,
  captured: boolean,
): CelestialObject {
  const rr = config.radiusRanges.moon;
  const mr = config.massRanges.moon;
  const radius = r3(rng.float(rr.min, rr.max));
  const eccRange = captured
    ? config.capturedMoonEccentricity
    : config.eccentricityDefaults[ObjectType.Moon];
  const moonOrbitAU = parentOrbitAU *
    rng.float(config.moonOrbitFraction.min, config.moonOrbitFraction.max);
  const orbitPeriod = Math.round(
    rng.float(config.moonOrbitPeriodDays.min, config.moonOrbitPeriodDays.max),
  );
  const tidallyLocked = orbitPeriod < config.tidalLockThresholdDays.moon;
  const rotationPeriodDays = tidallyLocked ? orbitPeriod : r2(
    rng.float(
      config.rotationPeriodDays.moon.min,
      config.rotationPeriodDays.moon.max,
    ),
  );

  return {
    id: nextId(),
    name: generateName(rng, ObjectType.Moon, index),
    type: ObjectType.Moon,
    orbitRadius: r3(moonOrbitAU),
    orbitPeriod,
    eccentricity: r3(rng.float(eccRange.min, eccRange.max)),
    radius,
    mass: r2(rng.float(mr.min, mr.max)),
    settlementCap: settlementCap(
      ObjectType.Moon,
      radius,
      config,
      parentOrbitAU,
      frostLineAU,
    ),
    deposits: generateDeposits(
      rng,
      ObjectType.Moon,
      config,
      parentOrbitAU,
      frostLineAU,
    ),
    moons: [],
    parentId,
    knownAtStart: false,
    capturedMoon: captured || undefined,
    orbitalPhase: r2(rng.float(0, 1)),
    rotationPeriodDays,
    tidallyLocked,
  };
}

// ── Rocky planet / super-Earth builder ───────────────────────────────────────

function makeRockyPlanet(
  rng: RNG,
  nextId: () => string,
  orbitAU: number,
  index: number,
  eccentricity: number,
  moonCount: number,
  radiusRange: { min: number; max: number },
  massRange: { min: number; max: number },
  waterBonus: number,
  config: GeneratorConfig,
  frostLineAU: number,
  starMass: number,
): CelestialObject {
  const id = nextId();
  const mr = massRange;
  const radius = r2(rng.float(radiusRange.min, radiusRange.max));
  const orbitPeriod = Math.round(Math.sqrt(orbitAU ** 3 / starMass) * 365);
  const tidallyLocked = orbitPeriod < config.tidalLockThresholdDays.planet;
  const rotationPeriodDays = tidallyLocked ? orbitPeriod : r2(
    rng.float(
      config.rotationPeriodDays.rockyPlanet.min,
      config.rotationPeriodDays.rockyPlanet.max,
    ),
  );

  return {
    id,
    name: generateName(rng, ObjectType.RockyPlanet, index),
    type: ObjectType.RockyPlanet,
    orbitRadius: r2(orbitAU),
    orbitPeriod,
    eccentricity,
    radius,
    mass: r2(rng.float(mr.min, mr.max)),
    settlementCap: settlementCap(
      ObjectType.RockyPlanet,
      radius,
      config,
      0,
      frostLineAU,
    ),
    deposits: generateDeposits(
      rng,
      ObjectType.RockyPlanet,
      config,
      orbitAU,
      frostLineAU,
      waterBonus,
    ),
    moons: Array.from(
      { length: moonCount },
      (_, i) =>
        makeMoon(rng, nextId, i, id, orbitAU, config, frostLineAU, false),
    ),
    knownAtStart: false,
    orbitalPhase: r2(rng.float(0, 1)),
    rotationPeriodDays,
    tidallyLocked,
  };
}

// ── Gas giant builder ─────────────────────────────────────────────────────────

function makeGasGiant(
  rng: RNG,
  nextId: () => string,
  orbitAU: number,
  index: number,
  eccentricity: number,
  moonCount: number,
  capturedMoons: boolean,
  config: GeneratorConfig,
  frostLineAU: number,
  starMass: number,
): CelestialObject {
  const id = nextId();
  const rr = config.radiusRanges.gasGiant;
  const mr = config.massRanges.gasGiant;
  const radius = r2(rng.float(rr.min, rr.max));
  const orbitPeriod = Math.round(Math.sqrt(orbitAU ** 3 / starMass) * 365);
  const tidallyLocked = orbitPeriod < config.tidalLockThresholdDays.planet;
  const rotationPeriodDays = tidallyLocked ? orbitPeriod : r2(
    rng.float(
      config.rotationPeriodDays.gasGiant.min,
      config.rotationPeriodDays.gasGiant.max,
    ),
  );

  return {
    id,
    name: generateName(rng, ObjectType.GasGiant, index),
    type: ObjectType.GasGiant,
    orbitRadius: r2(orbitAU),
    orbitPeriod,
    eccentricity,
    radius,
    mass: r2(rng.float(mr.min, mr.max)),
    settlementCap: settlementCap(
      ObjectType.GasGiant,
      radius,
      config,
      0,
      frostLineAU,
    ),
    deposits: generateDeposits(
      rng,
      ObjectType.GasGiant,
      config,
      orbitAU,
      frostLineAU,
    ),
    moons: Array.from(
      { length: moonCount },
      (_, i) =>
        makeMoon(
          rng,
          nextId,
          i,
          id,
          orbitAU,
          config,
          frostLineAU,
          capturedMoons,
        ),
    ),
    knownAtStart: false,
    orbitalPhase: r2(rng.float(0, 1)),
    rotationPeriodDays,
    tidallyLocked,
  };
}

// ── Ice giant builder ─────────────────────────────────────────────────────────

function makeIceGiant(
  rng: RNG,
  nextId: () => string,
  orbitAU: number,
  index: number,
  eccentricity: number,
  moonCount: number,
  config: GeneratorConfig,
  frostLineAU: number,
  starMass: number,
): CelestialObject {
  const id = nextId();
  const rr = config.radiusRanges.iceGiant;
  const mr = config.massRanges.iceGiant;
  const radius = r2(rng.float(rr.min, rr.max));
  const orbitPeriod = Math.round(Math.sqrt(orbitAU ** 3 / starMass) * 365);
  const tidallyLocked = orbitPeriod < config.tidalLockThresholdDays.planet;
  const rotationPeriodDays = tidallyLocked ? orbitPeriod : r2(
    rng.float(
      config.rotationPeriodDays.iceGiant.min,
      config.rotationPeriodDays.iceGiant.max,
    ),
  );

  return {
    id,
    name: generateName(rng, ObjectType.IceGiant, index),
    type: ObjectType.IceGiant,
    orbitRadius: r2(orbitAU),
    orbitPeriod,
    eccentricity,
    radius,
    mass: r2(rng.float(mr.min, mr.max)),
    settlementCap: settlementCap(
      ObjectType.IceGiant,
      radius,
      config,
      0,
      frostLineAU,
    ),
    deposits: generateDeposits(
      rng,
      ObjectType.IceGiant,
      config,
      orbitAU,
      frostLineAU,
    ),
    moons: Array.from(
      { length: moonCount },
      (_, i) =>
        makeMoon(rng, nextId, i, id, orbitAU, config, frostLineAU, false),
    ),
    knownAtStart: false,
    orbitalPhase: r2(rng.float(0, 1)),
    rotationPeriodDays,
    tidallyLocked,
  };
}

// ── Asteroid / dwarf planet builder ──────────────────────────────────────────

function makeAsteroid(
  rng: RNG,
  nextId: () => string,
  type: ObjectType.Asteroid | ObjectType.DwarfPlanet,
  orbitAU: number,
  index: number,
  eccentricity: number,
  config: GeneratorConfig,
  frostLineAU: number,
  starMass: number,
): CelestialObject {
  const rr = type === ObjectType.DwarfPlanet
    ? config.radiusRanges.dwarfPlanet
    : config.radiusRanges.asteroid;
  const mr = type === ObjectType.DwarfPlanet
    ? config.massRanges.dwarfPlanet
    : config.massRanges.asteroid;
  const radius = type === ObjectType.DwarfPlanet
    ? r3(rng.float(rr.min, rr.max))
    : r2(rng.float(rr.min, rr.max));
  const rotRange = type === ObjectType.DwarfPlanet
    ? config.rotationPeriodDays.dwarfPlanet
    : config.rotationPeriodDays.asteroid;

  return {
    id: nextId(),
    name: generateName(rng, type, index),
    type,
    orbitRadius: r2(orbitAU),
    orbitPeriod: Math.round(Math.sqrt(orbitAU ** 3 / starMass) * 365),
    eccentricity,
    radius,
    mass: r2(rng.float(mr.min, mr.max)),
    settlementCap: settlementCap(type, radius, config, 0, frostLineAU),
    deposits: generateDeposits(rng, type, config, orbitAU, frostLineAU),
    moons: [],
    knownAtStart: false,
    orbitalPhase: r2(rng.float(0, 1)),
    rotationPeriodDays: r2(rng.float(rotRange.min, rotRange.max)),
    tidallyLocked: false,
  };
}

// ── Comet builder ─────────────────────────────────────────────────────────────

function makeComet(
  rng: RNG,
  nextId: () => string,
  orbitAU: number,
  index: number,
  eccentricity: number,
  config: GeneratorConfig,
  frostLineAU: number,
  starMass: number,
): CelestialObject {
  const rr = config.radiusRanges.comet;
  const mr = config.massRanges.comet;
  const radius = r3(rng.float(rr.min, rr.max));
  const rotRange = config.rotationPeriodDays.comet;

  return {
    id: nextId(),
    name: generateName(rng, ObjectType.Comet, index),
    type: ObjectType.Comet,
    orbitRadius: r2(orbitAU),
    orbitPeriod: Math.round(Math.sqrt(orbitAU ** 3 / starMass) * 365),
    eccentricity,
    radius,
    mass: r2(rng.float(mr.min, mr.max)),
    settlementCap: rng.int(
      config.settlementConfig.comet.min!,
      config.settlementConfig.comet.max!,
    ),
    deposits: generateDeposits(rng, ObjectType.Comet, config, orbitAU, frostLineAU),
    moons: [],
    knownAtStart: false,
    orbitalPhase: r2(rng.float(0, 1)),
    rotationPeriodDays: r2(rng.float(rotRange.min, rotRange.max)),
    tidallyLocked: false,
  };
}

// ── Archetype picker ──────────────────────────────────────────────────────────

function pickArchetype(
  rng: RNG,
  spectralType: SpectralType,
): MigrationArchetype {
  return rng.weightedPick(pickArchetypeWeights(spectralType));
}

// ── Main generator ────────────────────────────────────────────────────────────

export function generateSolarSystem(
  config: Partial<GeneratorConfig> = {},
): SolarSystem {
  let _idCounter = 0;
  const nextId = (): string => `obj_${++_idCounter}`;

  resetNameCounter();

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const seed = cfg.seed ?? Math.floor(Math.random() * 0xFFFFFFFF);
  const rng = new RNG(seed);
  const star = generateStar(rng, cfg);
  const archetype = pickArchetype(rng, star.spectralType);
  const profile = cfg.archetypeProfiles[archetype];
  const frostLineAU = star.habitableZoneAU * cfg.frostLineAUFactor;

  const objects: CelestialObject[] = [];
  let asteroidIdx = 0;
  let planetIdx = 0;
  let giantIdx = 0;
  let iceGiantIdx = 0;
  let cometIdx = 0;

  for (const slot of profile.slots) {
    if (slot.probability !== undefined && rng.next() > slot.probability) {
      continue;
    }

    const count = rng.int(slot.countRange.min, slot.countRange.max);
    let knownRemaining = slot.knownCount ?? 0;
    let prevAU = slot.auRange.min * star.habitableZoneAU;

    for (let i = 0; i < count; i++) {
      const hz = star.habitableZoneAU;

      // AU placement: resonant spacing or uniform random
      let orbitAU: number;
      if (slot.resonantSpacing) {
        orbitAU = i === 0 ? prevAU : prevAU *
          rng.float(slot.resonantSpacing.min, slot.resonantSpacing.max);
        prevAU = orbitAU;
      } else {
        orbitAU = rng.float(slot.auRange.min * hz, slot.auRange.max * hz);
      }

      const effectiveType = slot.objectType === "superEarth"
        ? ObjectType.RockyPlanet
        : slot.objectType;

      const isKnown = knownRemaining > 0;
      if (isKnown) knownRemaining--;

      const eccRange = slot.eccentricityRange ??
        cfg.eccentricityDefaults[effectiveType];
      const ecc = r3(rng.float(eccRange.min, eccRange.max));
      const moonCount = slot.moonsRange
        ? rng.int(slot.moonsRange.min, slot.moonsRange.max)
        : 0;

      let obj: CelestialObject;

      if (
        effectiveType === ObjectType.Asteroid ||
        effectiveType === ObjectType.DwarfPlanet
      ) {
        const isDwarf = rng.next() < (slot.dwarfPlanetChance ?? 0);
        const aType = isDwarf ? ObjectType.DwarfPlanet : ObjectType.Asteroid;
        obj = makeAsteroid(
          rng,
          nextId,
          aType,
          orbitAU,
          asteroidIdx++,
          ecc,
          cfg,
          frostLineAU,
          star.mass,
        );
      } else if (effectiveType === ObjectType.GasGiant) {
        obj = makeGasGiant(
          rng,
          nextId,
          orbitAU,
          giantIdx++,
          ecc,
          moonCount,
          slot.capturedMoons ?? false,
          cfg,
          frostLineAU,
          star.mass,
        );
      } else if (effectiveType === ObjectType.IceGiant) {
        obj = makeIceGiant(
          rng,
          nextId,
          orbitAU,
          iceGiantIdx++,
          ecc,
          moonCount,
          cfg,
          frostLineAU,
          star.mass,
        );
      } else if (effectiveType === ObjectType.Comet) {
        obj = makeComet(rng, nextId, orbitAU, cometIdx++, ecc, cfg, frostLineAU, star.mass);
      } else {
        // RockyPlanet or superEarth
        const radiusRange = slot.objectType === "superEarth"
          ? cfg.radiusRanges.superEarth
          : cfg.radiusRanges.rockyPlanet;
        const massRange = slot.objectType === "superEarth"
          ? cfg.massRanges.superEarth
          : cfg.massRanges.rockyPlanet;
        obj = makeRockyPlanet(
          rng,
          nextId,
          orbitAU,
          planetIdx++,
          ecc,
          moonCount,
          radiusRange,
          massRange,
          slot.waterBonus ?? 0,
          cfg,
          frostLineAU,
          star.mass,
        );
      }

      obj.knownAtStart = isKnown && obj.type !== ObjectType.Comet;
      objects.push(obj);
    }
  }

  objects.sort((a, b) => a.orbitRadius - b.orbitRadius);

  return { seed, star, migrationHistory: archetype, objects };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export function allObjects(system: SolarSystem): CelestialObject[] {
  return system.objects.flatMap((obj) => [obj, ...obj.moons]);
}

export function knownObjects(system: SolarSystem): CelestialObject[] {
  return allObjects(system).filter((o) => o.knownAtStart);
}
