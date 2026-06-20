// src/orbit/index.ts — public entry for the orbit physics calculator.
export {
  circularVelocity,
  computeOrbit,
  deltaVFromSurface,
  escapeVelocity,
  orbitalPeriod,
  specificEnergy,
} from "./orbit.ts";
export type {
  AppliedSpec,
  DistanceUnit,
  NamedOrbitType,
  OrbitBand,
  OrbitResult,
  OrbitSpec,
  OrbitUnavailable,
} from "./types.ts";
