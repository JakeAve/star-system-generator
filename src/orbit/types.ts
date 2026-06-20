// src/orbit/types.ts
// Public types for the orbit physics calculator.

/** Unit a distance spec is expressed in. km = altitude above surface; bodyRadii/AU = radius from center. */
export type DistanceUnit = "km" | "bodyRadii" | "AU";

/** Named orbits the API can resolve to a radius. */
export type NamedOrbitType = "low" | "synchronous";

/** How a caller asks for an orbit: an explicit distance, or a named orbit type. */
export type OrbitSpec =
  | { value: number; unit: DistanceUnit }
  | { type: NamedOrbitType };

/** What the spec actually resolved to. */
export type AppliedSpec =
  | { kind: "distance"; unit: DistanceUnit; value: number }
  | { kind: "named"; type: NamedOrbitType };

/** The stability band for the central body, in km. rMaxKm is null when unbounded (stars). */
export interface OrbitBand {
  rMinKm: number;
  rMaxKm: number | null;
}

/** Full orbital parameters for a circular orbit at the resolved radius. */
export interface OrbitResult {
  applicable: true;
  orbitalVelocityKmps: number;
  periodDays: number;
  periodSeconds: number;
  escapeVelocityKmps: number;
  specificEnergyJperKg: number;
  deltaVFromSurfaceKmps: number;
  radiusKm: number;
  radiusAu: number;
  radiusBodyRadii: number;
  altitudeKm: number;
  stable: boolean;
  band: OrbitBand;
  appliedSpec: AppliedSpec;
}

/** Returned (not thrown) when a named orbit cannot resolve to a radius — e.g. synchronous around a non-rotating star. */
export interface OrbitUnavailable {
  applicable: false;
  spec: OrbitSpec;
  reason: string;
}
