// @jakeave/star-seeder — main entry (core generator + config + kinematics + view-model)
export { allObjects, generateSolarSystem, knownObjects } from "./src/core/generator.ts";
export { DEFAULT_CONFIG, pickArchetypeWeights } from "./src/core/config.ts";
export { deepMerge, resolveConfig } from "./src/core/config-merge.ts";
export {
  AU_SCALE,
  angleAtTime,
  BODY_SCALE,
  eccentricAngleAtTime,
  MIN_VISUAL_RADIUS,
  MOON_ORBIT_SCALE,
  orbitParams,
  orbitPosition,
  SOLAR_TO_EARTH_RADII,
  solveKepler,
  visualRadius,
} from "./src/core/kinematics.ts";
export { buildViewModel } from "./src/view/view-model.ts";
export type { ViewBody } from "./src/view/view-model.ts";
export type {
  ArchetypeProfile,
  CelestialObject,
  DeepPartial,
  GenerationSlot,
  GeneratorConfig,
  ResourceDeposit,
  SolarSystem,
  Star,
} from "./src/core/types.ts";
export {
  MigrationArchetype,
  ObjectType,
  Resource,
  SpectralType,
} from "./src/core/types.ts";
