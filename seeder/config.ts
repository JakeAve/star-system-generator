import {
  ArchetypeProfile,
  GeneratorConfig,
  MigrationArchetype,
  ObjectType,
  Resource,
  ResourceWeights,
  SpectralType,
} from "./types.ts";

// ── Resource weights (base probabilities before frost-line scaling) ────────────

export const RESOURCE_WEIGHTS: Record<ObjectType, ResourceWeights> = {
  [ObjectType.RockyPlanet]: {
    [Resource.Water]: 0.3,
    [Resource.Organics]: 0.2,
    [Resource.Silicates]: 1.0,
    [Resource.Metals]: 0.9,
    [Resource.HeavyMetals]: 0.5,
    [Resource.Volatiles]: 0.1,
  },
  // Gas giants: volatiles-dominant. Frost-line multipliers make inner giants near-barren.
  [ObjectType.GasGiant]: {
    [Resource.Water]: 0.5,
    [Resource.Organics]: 0.2,
    [Resource.Silicates]: 0.0,
    [Resource.Metals]: 0.0,
    [Resource.HeavyMetals]: 0.1,
    [Resource.Volatiles]: 2.0,
  },
  // Ice giants always spawn beyond frost line; outer multipliers always apply.
  [ObjectType.IceGiant]: {
    [Resource.Water]: 1.6,
    [Resource.Organics]: 0.5,
    [Resource.Silicates]: 0.1,
    [Resource.Metals]: 0.1,
    [Resource.HeavyMetals]: 0.1,
    [Resource.Volatiles]: 1.4,
  },
  [ObjectType.Moon]: {
    [Resource.Water]: 0.5,
    [Resource.Organics]: 0.2,
    [Resource.Silicates]: 0.7,
    [Resource.Metals]: 0.8,
    [Resource.HeavyMetals]: 0.6,
    [Resource.Volatiles]: 0.2,
  },
  [ObjectType.Asteroid]: {
    [Resource.Water]: 0.2,
    [Resource.Organics]: 0.1,
    [Resource.Silicates]: 0.8,
    [Resource.Metals]: 0.9,
    [Resource.HeavyMetals]: 1.2,
    [Resource.Volatiles]: 0.1,
  },
  [ObjectType.DwarfPlanet]: {
    [Resource.Water]: 0.7,
    [Resource.Organics]: 0.1,
    [Resource.Silicates]: 0.6,
    [Resource.Metals]: 0.5,
    [Resource.HeavyMetals]: 0.4,
    [Resource.Volatiles]: 0.5,
  },
  [ObjectType.Comet]: {
    [Resource.Water]: 2.0,
    [Resource.Volatiles]: 1.8,
    [Resource.Organics]: 0.8,
    [Resource.Silicates]: 0.05,
    [Resource.Metals]: 0.0,
    [Resource.HeavyMetals]: 0.0,
  },
};

// ── Frost-line multipliers ────────────────────────────────────────────────────
// Applied to base weight: effectiveWeight = baseWeight × (inner | outer)

export const FROST_LINE_MULTIPLIERS: Record<
  Resource,
  { inner: number; outer: number }
> = {
  [Resource.Water]: { inner: 0.2, outer: 1.6 },
  [Resource.Organics]: { inner: 0.3, outer: 0.8 },
  [Resource.Silicates]: { inner: 1.2, outer: 0.7 },
  [Resource.Metals]: { inner: 1.1, outer: 0.6 },
  [Resource.HeavyMetals]: { inner: 0.9, outer: 0.8 },
  [Resource.Volatiles]: { inner: 0.1, outer: 1.8 },
};

// ── Settlement config ─────────────────────────────────────────────────────────

export const SETTLEMENT_CONFIG: GeneratorConfig["settlementConfig"] = {
  gasGiant: { cap: 0 },
  iceGiant: { cap: 0 },
  asteroid: { cap: 1 },
  // moonOuter: moons whose parent is beyond the frost line — richer, more viable
  moonInner: { min: 1, radiusDivisor: 2 },
  moonOuter: { min: 2, radiusDivisor: 2 },
  dwarfPlanet: { min: 2, radiusDivisor: 3 },
  rockyPlanet: { min: 1, radiusMultiplier: 1.5 },
  comet: { min: 1, max: 2 },
};

// ── Radius ranges (relative units 1–10) ──────────────────────────────────────

export const RADIUS_RANGES: GeneratorConfig["radiusRanges"] = {
  rockyPlanet: { min: 0.055, max: 1.0 }, // Mercury (0.055) → Earth (1.0)
  gasGiant: { min: 14, max: 318 }, // Uranus (14) → Jupiter (318)
  iceGiant: { min: 14, max: 17 }, // Uranus (14) → Neptune (17)
  superEarth: { min: 1.5, max: 10 }, // just above Earth → ~10 M⊕
  dwarfPlanet: { min: 0.001, max: 0.022 }, // Ceres (0.00015) → Pluto (0.0022) -- very tiny!
  moon: { min: 0.001, max: 0.025 }, // small captured rock → Ganymede (0.025)
  asteroid: { min: 0.000001, max: 0.0002 }, // boulders → Vesta (0.000045)
  comet: { min: 0.000001, max: 0.0005 },
};

// ── Mass ranges (relative units 1–10) ────────────────────────────────────────

export const MASS_RANGES: GeneratorConfig["massRanges"] = {
  rockyPlanet: { min: 1, max: 8 },
  gasGiant: { min: 5, max: 10 },
  iceGiant: { min: 3, max: 7 },
  moon: { min: 0.5, max: 3 },
  asteroid: { min: 0.1, max: 2 },
  dwarfPlanet: { min: 0.5, max: 2 },
  superEarth: { min: 2, max: 10 }, // just above rocky max → ~10 M⊕
  comet: { min: 0.1, max: 2 },
};

// ── Eccentricity defaults ─────────────────────────────────────────────────────

export const ECCENTRICITY_DEFAULTS: Record<
  ObjectType,
  { min: number; max: number }
> = {
  [ObjectType.RockyPlanet]: { min: 0.0, max: 0.1 },
  [ObjectType.GasGiant]: { min: 0.0, max: 0.1 },
  [ObjectType.IceGiant]: { min: 0.0, max: 0.08 },
  [ObjectType.Moon]: { min: 0.0, max: 0.05 },
  [ObjectType.Asteroid]: { min: 0.05, max: 0.45 },
  [ObjectType.DwarfPlanet]: { min: 0.02, max: 0.2 },
  [ObjectType.Comet]: { min: 0.7, max: 0.97 },
};

export const CAPTURED_MOON_ECCENTRICITY = { min: 0.1, max: 0.5 };

// ── Star luminosity ranges ────────────────────────────────────────────────────

export const STAR_LUMINOSITY: Record<SpectralType, [number, number]> = {
  [SpectralType.M]: [0.01, 0.08],
  [SpectralType.K]: [0.1, 0.6],
  [SpectralType.G]: [0.6, 1.5],
  [SpectralType.F]: [1.5, 3.5],
  [SpectralType.A]: [4, 50],
  [SpectralType.B]: [100, 5000],
  [SpectralType.O]: [10000, 200000],
};

export const STAR_RADIUS: Record<SpectralType, [number, number]> = {
  [SpectralType.M]: [0.11, 0.51],
  [SpectralType.K]: [0.74, 0.85],
  [SpectralType.G]: [0.93, 1.05],
  [SpectralType.F]: [1.2, 1.3],
  [SpectralType.A]: [1.7, 2.5],
  [SpectralType.B]: [3.8, 7.4],
  [SpectralType.O]: [9.8, 12],
};

export const STAR_MASS: Record<SpectralType, [number, number]> = {
  [SpectralType.M]: [0.1, 0.45],
  [SpectralType.K]: [0.45, 0.8],
  [SpectralType.G]: [0.8, 1.1],
  [SpectralType.F]: [1.1, 1.7],
  [SpectralType.A]: [1.7, 2.4],
  [SpectralType.B]: [2.5, 15],
  [SpectralType.O]: [15, 60],
};

export const STAR_WEIGHTS: Array<{ value: SpectralType; weight: number }> = [
  { value: SpectralType.M, weight: 3 },
  { value: SpectralType.K, weight: 2 },
  { value: SpectralType.G, weight: 2 },
  { value: SpectralType.F, weight: 1 },
  { value: SpectralType.A, weight: 0.2 },
  { value: SpectralType.B, weight: 0.01 },
  { value: SpectralType.O, weight: 0.001 },
];

// ── Archetype profiles ────────────────────────────────────────────────────────
// Each profile has a `slots[]` array. The generator iterates slots, fires each
// (subject to `probability`), and spawns `countRange` objects per slot.
// auRange values are hz multipliers (actual AU = value × star.habitableZoneAU).

export const ARCHETYPE_PROFILES: Record<MigrationArchetype, ArchetypeProfile> =
  {
    [MigrationArchetype.DynamicallyCold]: {
      weight: { M: 1, K: 3, G: 4, F: 3, A: 3, B: 3, O: 3 },
      description:
        "Dynamically cold — gas giants stayed outer, inner system undisturbed.",
      slots: [
        {
          objectType: ObjectType.RockyPlanet,
          countRange: { min: 1, max: 4 },
          auRange: { min: 0.15, max: 0.8 },
          moonsRange: { min: 0, max: 2 },
        },
        {
          objectType: ObjectType.RockyPlanet,
          countRange: { min: 1, max: 2 },
          auRange: { min: 0.85, max: 1.25 },
          moonsRange: { min: 0, max: 2 },
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 5, max: 15 },
          auRange: { min: 1.5, max: 2.8 },
          probability: 0.7,
          dwarfPlanetChance: 0.1,
        },
        {
          objectType: ObjectType.GasGiant,
          countRange: { min: 1, max: 4 },
          auRange: { min: 3.5, max: 15.0 },
          moonsRange: { min: 2, max: 8 },
          knownCount: 2,
        },
        {
          objectType: ObjectType.IceGiant,
          countRange: { min: 0, max: 2 },
          auRange: { min: 12.0, max: 20.0 },
          moonsRange: { min: 1, max: 5 },
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 3, max: 12 },
          auRange: { min: 20.0, max: 50.0 },
          dwarfPlanetChance: 0.15,
        },
      ],
    },

    [MigrationArchetype.WarmJupiter]: {
      weight: { M: 0, K: 2, G: 3, F: 4, A: 4, B: 4, O: 4 },
      description:
        "Warm Jupiter — gas giant stalled mid-system, inner planets scarce.",
      slots: [
        {
          objectType: ObjectType.RockyPlanet,
          countRange: { min: 0, max: 1 },
          auRange: { min: 0.15, max: 0.8 },
          moonsRange: { min: 0, max: 1 },
        },
        // Primary warm Jupiter: eccentric from the gravitational chaos that moved it
        {
          objectType: ObjectType.GasGiant,
          countRange: { min: 1, max: 1 },
          auRange: { min: 0.15, max: 1.0 },
          moonsRange: { min: 1, max: 5 },
          eccentricityRange: { min: 0.1, max: 0.4 },
          knownCount: 1,
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 7, max: 21 },
          auRange: { min: 1.5, max: 2.8 },
          probability: 0.6,
          dwarfPlanetChance: 0.1,
        },
        {
          objectType: ObjectType.GasGiant,
          countRange: { min: 0, max: 2 },
          auRange: { min: 3.0, max: 10.0 },
          moonsRange: { min: 2, max: 6 },
          knownCount: 1,
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 3, max: 12 },
          auRange: { min: 20.0, max: 50.0 },
          dwarfPlanetChance: 0.15,
        },
      ],
    },

    [MigrationArchetype.HotJupiter]: {
      weight: { M: 0, K: 1, G: 2, F: 3, A: 3, B: 3, O: 3 },
      description:
        "Hot Jupiter — completed migration to <0.1 AU, inner system cleared.",
      slots: [
        // Tidally circularised primary; any moons are likely captured
        {
          objectType: ObjectType.GasGiant,
          countRange: { min: 1, max: 1 },
          auRange: { min: 0.02, max: 0.09 },
          moonsRange: { min: 0, max: 1 },
          eccentricityRange: { min: 0.0, max: 0.05 },
          capturedMoons: true,
          knownCount: 1,
        },
        {
          objectType: ObjectType.GasGiant,
          countRange: { min: 0, max: 1 },
          auRange: { min: 4.0, max: 12.0 },
          moonsRange: { min: 2, max: 6 },
          knownCount: 1,
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 2, max: 8 },
          auRange: { min: 1.5, max: 2.8 },
          probability: 0.3,
          dwarfPlanetChance: 0.1,
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 3, max: 12 },
          auRange: { min: 20.0, max: 50.0 },
          dwarfPlanetChance: 0.15,
        },
      ],
    },

    [MigrationArchetype.GrandTack]: {
      weight: { M: 0, K: 3, G: 4, F: 2, A: 2, B: 2, O: 2 },
      description:
        "Grand Tack — giant migrated in then reversed, inner worlds water-enriched.",
      slots: [
        {
          objectType: ObjectType.RockyPlanet,
          countRange: { min: 1, max: 4 },
          auRange: { min: 0.15, max: 0.8 },
          moonsRange: { min: 0, max: 2 },
          waterBonus: 0.25,
        },
        {
          objectType: ObjectType.RockyPlanet,
          countRange: { min: 1, max: 2 },
          auRange: { min: 0.85, max: 1.25 },
          moonsRange: { min: 0, max: 2 },
          waterBonus: 0.25,
        },
        // Dense asteroid belt stirred by the tack
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 9, max: 27 },
          auRange: { min: 1.5, max: 2.8 },
          probability: 0.9,
          dwarfPlanetChance: 0.1,
        },
        // Requires at least 2 gas giants (the pair that caused the tack)
        {
          objectType: ObjectType.GasGiant,
          countRange: { min: 2, max: 3 },
          auRange: { min: 3.0, max: 5.5 },
          moonsRange: { min: 2, max: 7 },
          knownCount: 2,
        },
        {
          objectType: ObjectType.GasGiant,
          countRange: { min: 0, max: 2 },
          auRange: { min: 5.5, max: 12.0 },
          moonsRange: { min: 2, max: 6 },
        },
        {
          objectType: ObjectType.IceGiant,
          countRange: { min: 0, max: 2 },
          auRange: { min: 12.0, max: 20.0 },
          moonsRange: { min: 1, max: 5 },
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 3, max: 12 },
          auRange: { min: 20.0, max: 50.0 },
          dwarfPlanetChance: 0.15,
        },
      ],
    },

    [MigrationArchetype.CompactMultiplanet]: {
      weight: { M: 5, K: 3, G: 1, F: 0, A: 0, B: 0, O: 0 },
      description:
        "Compact multiplanet — no migration, tight super-Earth system (TRAPPIST-1 type).",
      slots: [
        // Resonant spacing: each planet ~1.3–1.6× the previous planet's orbit
        {
          objectType: "superEarth",
          countRange: { min: 4, max: 8 },
          auRange: { min: 0.04, max: 2.0 },
          moonsRange: { min: 0, max: 0 },
          resonantSpacing: { min: 1.3, max: 1.6 },
          waterBonus: 0.25,
        },
        {
          objectType: ObjectType.GasGiant,
          countRange: { min: 0, max: 1 },
          auRange: { min: 5.0, max: 15.0 },
          moonsRange: { min: 0, max: 2 },
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 3, max: 9 },
          auRange: { min: 2.0, max: 5.0 },
          probability: 0.4,
          dwarfPlanetChance: 0.1,
        },
        {
          objectType: ObjectType.Asteroid,
          countRange: { min: 3, max: 12 },
          auRange: { min: 20.0, max: 50.0 },
          dwarfPlanetChance: 0.15,
        },
      ],
    },
  };

// ── Archetype pick weights (by star spectral type) ────────────────────────────

export function pickArchetypeWeights(
  spectralType: SpectralType,
): Array<{ value: MigrationArchetype; weight: number }> {
  return (Object.keys(ARCHETYPE_PROFILES) as MigrationArchetype[])
    .map((a) => ({
      value: a,
      weight: ARCHETYPE_PROFILES[a].weight[spectralType] ?? 0,
    }))
    .filter((o) => o.weight > 0);
}

// ── DEFAULT_CONFIG ────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: GeneratorConfig = {
  depositsPerObject: { min: 2, max: 5 },
  richDepositChance: 0.25,
  frostLineAUFactor: 2.7,
  radiusRanges: RADIUS_RANGES,
  massRanges: MASS_RANGES,
  eccentricityDefaults: ECCENTRICITY_DEFAULTS,
  capturedMoonEccentricity: CAPTURED_MOON_ECCENTRICITY,
  resourceWeights: RESOURCE_WEIGHTS,
  frostLineMultipliers: FROST_LINE_MULTIPLIERS,
  settlementConfig: SETTLEMENT_CONFIG,
  archetypeProfiles: ARCHETYPE_PROFILES,
  starLuminosity: STAR_LUMINOSITY,
  starMass: STAR_MASS,
  starRadius: STAR_RADIUS,
  starWeights: STAR_WEIGHTS,
  moonOrbitFraction: { min: 0.02, max: 0.1 },
  moonOrbitPeriodDays: { min: 3, max: 120 },
  tidalLockThresholdDays: { planet: 10, moon: 80 },
  rotationPeriodDays: {
    gasGiant: { min: 0.3, max: 1.5 },
    iceGiant: { min: 0.6, max: 1.5 },
    rockyPlanet: { min: 0.5, max: 365 },
    asteroid: { min: 0.04, max: 1.0 },
    dwarfPlanet: { min: 0.25, max: 7.0 },
    moon: { min: 1.0, max: 30.0 },
    comet: { min: 0.25, max: 30.0 },
  },
};
