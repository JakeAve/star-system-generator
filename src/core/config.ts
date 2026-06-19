import {
  ArchetypeProfile,
  EccentricitySpec,
  GeneratorConfig,
  MigrationArchetype,
  ObjectType,
  Resource,
  ResourceWeights,
  SpectralType,
} from "./types.ts";

// ── Resource weights (base probabilities before frost-line scaling) ────────────

export const RESOURCE_WEIGHTS: Record<ObjectType, ResourceWeights> = {
  [ObjectType.Star]: {
    [Resource.Water]: 0,
    [Resource.Organics]: 0,
    [Resource.Silicates]: 0,
    [Resource.Metals]: 0,
    [Resource.HeavyMetals]: 0,
    [Resource.Volatiles]: 0,
  },
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
  // Caps scale with radius (R⊕): cap = max(min, floor(radius × radiusMultiplier)).
  // Resulting bands — rockyPlanet/super-Earth 1–3, moonInner 1–2, moonOuter 2, dwarfPlanet 2.
  // moonOuter: moons whose parent is beyond the frost line — richer, more viable.
  moonInner: { min: 1, radiusMultiplier: 7 },
  moonOuter: { min: 2, radiusMultiplier: 7 },
  dwarfPlanet: { min: 2, radiusMultiplier: 5 },
  rockyPlanet: { min: 1, radiusMultiplier: 1.5 },
  comet: { min: 1, max: 2 },
};

// ── Radius ranges (Earth radii, R⊕) ───────────────────────────────────────────

export const RADIUS_RANGES: GeneratorConfig["radiusRanges"] = {
  rockyPlanet: { min: 0.38, max: 1.0 }, // Mercury (0.38) → Earth (1.0)
  gasGiant: { min: 8, max: 13 }, // Saturn (9.1) / Jupiter (11.2), allow puffy → 13
  iceGiant: { min: 3.8, max: 4.2 }, // Neptune (3.9) / Uranus (4.0)
  superEarth: { min: 1.0, max: 2.0 }, // Earth → ~2 R⊕ (above this → mini-Neptune)
  dwarfPlanet: { min: 0.07, max: 0.19 }, // Ceres (0.073) → Pluto (0.186)
  moon: { min: 0.05, max: 0.42 }, // small captured rock → Ganymede (0.41)
  asteroid: { min: 0.001, max: 0.045 }, // ~6 km boulder → Vesta (0.041)
  comet: { min: 0.0002, max: 0.005 }, // ~1 km → ~32 km nucleus
};

// ── Density ranges (relative to Earth, ρ⊕ = 1) ────────────────────────────────
// Mass is derived: mass_M⊕ = density × radius_R⊕³. Earth density = 5.51 g/cm³.

export const DENSITY_RANGES: GeneratorConfig["densityRanges"] = {
  rockyPlanet: { min: 0.71, max: 1.0 }, // Mars (3.9 g/cc) → Earth (5.51)
  gasGiant: { min: 0.13, max: 0.24 }, // Saturn (0.69) → Jupiter (1.33)
  iceGiant: { min: 0.23, max: 0.30 }, // Uranus (1.27) → Neptune (1.64)
  moon: { min: 0.35, max: 0.64 }, // Ganymede (1.94) → Io (3.53)
  asteroid: { min: 0.24, max: 0.63 }, // rubble pile (1.3) → Vesta (3.46)
  dwarfPlanet: { min: 0.34, max: 0.45 }, // Pluto (1.85) → Eris (2.5)
  superEarth: { min: 0.9, max: 1.2 }, // rocky, slightly denser than Earth
  comet: { min: 0.05, max: 0.11 }, // porous ice (0.3 → 0.6 g/cc)
};

// ── Eccentricity defaults ─────────────────────────────────────────────────────

export const ECCENTRICITY_DEFAULTS: Record<
  ObjectType,
  EccentricitySpec
> = {
  [ObjectType.Star]: { sigma: 0.0, max: 0.0 },
  [ObjectType.RockyPlanet]: { sigma: 0.04, max: 0.15 },
  [ObjectType.GasGiant]: { sigma: 0.04, max: 0.15 },
  [ObjectType.IceGiant]: { sigma: 0.035, max: 0.12 },
  [ObjectType.Moon]: { sigma: 0.01, max: 0.05 },
  [ObjectType.Asteroid]: { sigma: 0.10, max: 0.40 },
  [ObjectType.DwarfPlanet]: { sigma: 0.15, max: 0.50 },
  [ObjectType.Comet]: { min: 0.6, max: 0.97 },
};

export const CAPTURED_MOON_ECCENTRICITY = { min: 0.1, max: 0.5 };

// ── Captured-moon broadening ─────────────────────────────────────────────────

/** Per-parent-type probability that a given moon is captured (irregular). */
export const CAPTURE_PROBABILITY_DEFAULTS: Record<ObjectType, number> = {
  [ObjectType.GasGiant]: 0.35,
  [ObjectType.IceGiant]: 0.35,
  [ObjectType.RockyPlanet]: 0.05,
  [ObjectType.DwarfPlanet]: 0.05, // no builder makes dwarf moons today; unused for now
  [ObjectType.Star]: 0,
  [ObjectType.Moon]: 0,
  [ObjectType.Asteroid]: 0,
  [ObjectType.Comet]: 0,
};

/** Probability a captured moon orbits retrograde. */
export const CAPTURED_MOON_RETROGRADE = 0.75;

// ── Retrograde defaults ──────────────────────────────────────────────────────

export const RETROGRADE_DEFAULTS: Record<ObjectType, number> = {
  [ObjectType.Star]: 0,
  [ObjectType.RockyPlanet]: 0.02,
  [ObjectType.GasGiant]: 0.02,
  [ObjectType.IceGiant]: 0.02,
  [ObjectType.Moon]: 0.0,
  [ObjectType.Asteroid]: 0.03,
  [ObjectType.DwarfPlanet]: 0.03,
  [ObjectType.Comet]: 0.45,
};

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
        {
          objectType: ObjectType.Comet,
          countRange: { min: 3, max: 8 },
          auRange: { min: 30, max: 120 },
          probability: 0.8,
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
          eccentricityRange: { sigma: 0.25, max: 0.5 },
          retrogradeProbability: 0.10,
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
        {
          objectType: ObjectType.Comet,
          countRange: { min: 4, max: 10 },
          auRange: { min: 35, max: 130 },
          probability: 0.8,
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
          eccentricityRange: { sigma: 0.02, max: 0.05 },
          capturedMoons: true,
          retrogradeProbability: 0.15,
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
        {
          objectType: ObjectType.Comet,
          countRange: { min: 2, max: 5 },
          auRange: { min: 40, max: 150 },
          probability: 0.8,
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
        {
          objectType: ObjectType.Comet,
          countRange: { min: 6, max: 14 },
          auRange: { min: 25, max: 100 },
          probability: 0.8,
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
        {
          objectType: ObjectType.Comet,
          countRange: { min: 2, max: 6 },
          auRange: { min: 30, max: 100 },
          probability: 0.8,
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
  densityRanges: DENSITY_RANGES,
  eccentricityDefaults: ECCENTRICITY_DEFAULTS,
  capturedMoonEccentricity: CAPTURED_MOON_ECCENTRICITY,
  captureProbabilityDefaults: CAPTURE_PROBABILITY_DEFAULTS,
  capturedMoonRetrograde: CAPTURED_MOON_RETROGRADE,
  retrogradeDefaults: RETROGRADE_DEFAULTS,
  resourceWeights: RESOURCE_WEIGHTS,
  frostLineMultipliers: FROST_LINE_MULTIPLIERS,
  settlementConfig: SETTLEMENT_CONFIG,
  archetypeProfiles: ARCHETYPE_PROFILES,
  starLuminosity: STAR_LUMINOSITY,
  starMass: STAR_MASS,
  starRadius: STAR_RADIUS,
  starWeights: STAR_WEIGHTS,
  regularMoonHillRange: { min: 0.05, max: 0.25 },
  capturedMoonHillRange: { min: 0.30, max: 0.60 },
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
