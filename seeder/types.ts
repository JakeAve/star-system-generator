// system-seeder-2/types.ts

export enum Resource {
  Water = "water",
  Organics = "organics",
  Silicates = "silicates",
  Metals = "metals",
  HeavyMetals = "heavyMetals",
  Volatiles = "volatiles",
}

export enum ObjectType {
  RockyPlanet = "rockyPlanet",
  GasGiant = "gasGiant",
  IceGiant = "iceGiant",
  Moon = "moon",
  Asteroid = "asteroid",
  DwarfPlanet = "dwarfPlanet",
}

export enum MigrationArchetype {
  DynamicallyCold = "dynamicallyCold",
  WarmJupiter = "warmJupiter",
  HotJupiter = "hotJupiter",
  GrandTack = "grandTack",
  CompactMultiplanet = "compactMultiplanet",
}

export enum SpectralType {
  A = "A",
  B = "B",
  O = "O",
  M = "M",
  K = "K",
  G = "G",
  F = "F",
}

export interface ResourceDeposit {
  resource: Resource;
  /** True richness 0–1, hidden from players */
  abundance: number;
  /** Player belief 0–1, starts at 0 */
  confidence: number;
}

export interface CelestialObject {
  id: string;
  name: string;
  type: ObjectType;
  /** AU from star (moons: AU from parent) */
  orbitRadius: number;
  /** Days for full orbit */
  orbitPeriod: number;
  /** 0 = circle, ~0.2 = elliptical */
  eccentricity: number;
  /** Relative 1–10 */
  radius: number;
  /** Relative 1–10 */
  mass: number;
  settlementCap: number;
  deposits: ResourceDeposit[];
  /** Non-empty for planets/giants */
  moons: CelestialObject[];
  /** Set for moons only */
  parentId?: string;
  knownAtStart: boolean;
  capturedMoon?: boolean;
  orbitalPhase: number;
  rotationPeriodDays: number;
  tidallyLocked: boolean;
}

export interface Star {
  spectralType: SpectralType;
  /** Relative to Sol */
  luminosity: number;
  /** Hz centre in AU */
  habitableZoneAU: number;
  mass: number; // solar masses
  radius: number; // solar radii
}

export interface SolarSystem {
  seed: number;
  star: Star;
  migrationHistory: MigrationArchetype;
  /** Top-level bodies only (no moons), sorted ascending by orbitRadius */
  objects: CelestialObject[];
}

export type ResourceWeights = Record<Resource, number>;

export interface SettlementEntry {
  cap?: number;
  min?: number;
  radiusDivisor?: number;
  radiusMultiplier?: number;
}

/**
 * A generation slot inside an archetype profile.
 * The generator fires each slot once per system (subject to `probability`),
 * spawning `countRange` objects with AU in `auRange * hz`.
 */
export interface GenerationSlot {
  objectType: ObjectType | "superEarth";
  countRange: { min: number; max: number };
  /** AU range as hz multipliers */
  auRange: { min: number; max: number };
  moonsRange?: { min: number; max: number };
  /** Overrides per-type eccentricity default for objects in this slot */
  eccentricityRange?: { min: number; max: number };
  /** Grand Tack water enrichment bonus (0–1) */
  waterBonus?: number;
  capturedMoons?: boolean;
  /** First N objects from this slot are knownAtStart */
  knownCount?: number;
  /** Chance an asteroid body is promoted to DwarfPlanet (0–1) */
  dwarfPlanetChance?: number;
  /** Chance this entire slot fires; default 1.0 (always) */
  probability?: number;
  /**
   * Resonant orbit spacing: each successive planet's AU = previous × random(min, max).
   * When set, auRange.min is the first planet's starting AU (hz multiplier);
   * auRange.max is unused.
   */
  resonantSpacing?: { min: number; max: number };
}

export interface ArchetypeProfile {
  weight: Partial<Record<SpectralType, number>>;
  description: string;
  slots: GenerationSlot[];
}

export interface GeneratorConfig {
  seed?: number;
  depositsPerObject: { min: number; max: number };
  /** Probability a deposit rolls abundant (>0.65 abundance) */
  richDepositChance: number;
  /** frostLine AU = habitableZoneAU × this */
  frostLineAUFactor: number;
  radiusRanges: {
    rockyPlanet: { min: number; max: number };
    gasGiant: { min: number; max: number };
    iceGiant: { min: number; max: number };
    moon: { min: number; max: number };
    asteroid: { min: number; max: number };
    dwarfPlanet: { min: number; max: number };
    superEarth: { min: number; max: number };
  };
  massRanges: {
    rockyPlanet: { min: number; max: number };
    gasGiant: { min: number; max: number };
    iceGiant: { min: number; max: number };
    moon: { min: number; max: number };
    asteroid: { min: number; max: number };
    dwarfPlanet: { min: number; max: number };
    superEarth: { min: number; max: number };
  };
  /** Default eccentricity range per object type; overridden by slot.eccentricityRange */
  eccentricityDefaults: Record<ObjectType, { min: number; max: number }>;
  capturedMoonEccentricity: { min: number; max: number };
  resourceWeights: Record<ObjectType, ResourceWeights>;
  frostLineMultipliers: Record<Resource, { inner: number; outer: number }>;
  settlementConfig: {
    gasGiant: SettlementEntry;
    iceGiant: SettlementEntry;
    asteroid: SettlementEntry;
    moonInner: SettlementEntry;
    moonOuter: SettlementEntry;
    dwarfPlanet: SettlementEntry;
    rockyPlanet: SettlementEntry;
  };
  archetypeProfiles: Record<MigrationArchetype, ArchetypeProfile>;
  starLuminosity: Record<SpectralType, [number, number]>;
  starMass: Record<SpectralType, [number, number]>;
  starRadius: Record<SpectralType, [number, number]>;
  starWeights: Array<{ value: SpectralType; weight: number }>;
  moonOrbitFraction: { min: number; max: number };
  moonOrbitPeriodDays: { min: number; max: number };
  tidalLockThresholdDays: { planet: number; moon: number };
  rotationPeriodDays: {
    gasGiant: { min: number; max: number };
    iceGiant: { min: number; max: number };
    rockyPlanet: { min: number; max: number };
    asteroid: { min: number; max: number };
    dwarfPlanet: { min: number; max: number };
    moon: { min: number; max: number };
  };
}
