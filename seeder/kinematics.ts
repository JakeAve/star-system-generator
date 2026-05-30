// Layer 1 — pure orbital geometry shared by every renderer.
// Output coordinates are in the orbital plane as {x, y}; engines map to their
// own space (3D: x→x, y→z; 2D: x→x, y→y).

/** Three.js / canvas world units per 1 AU (planet orbits). */
export const AU_SCALE = 100;
/** Multiplier applied on top of AU_SCALE for moon orbits. */
export const MOON_ORBIT_SCALE = 1;
/** log-radius visual scale factor. */
export const BODY_SCALE = 0.025;
/** Floor so zero-radius bodies still render as a visible dot. */
export const MIN_VISUAL_RADIUS = 0.015;
/** 1 solar radius ≈ 109 Earth radii (for sizing the star against planets). */
export const SOLAR_TO_EARTH_RADII = 109;

export interface OrbitParams {
  /** semi-major axis (world units) */
  a: number;
  /** semi-minor axis (world units) */
  b: number;
  /** focus offset so the parent sits at one focus */
  c: number;
}

export function orbitParams(
  orbitRadius: number,
  eccentricity: number,
  isMoon: boolean,
): OrbitParams {
  const scale = isMoon ? AU_SCALE * MOON_ORBIT_SCALE : AU_SCALE;
  const a = orbitRadius * scale;
  const e = Math.min(eccentricity ?? 0, 0.999);
  const b = a * Math.sqrt(1 - e * e);
  const c = a * e;
  return { a, b, c };
}

export function orbitPosition(
  a: number,
  b: number,
  c: number,
  angle: number,
): { x: number; y: number } {
  return { x: c + a * Math.cos(angle), y: b * Math.sin(angle) };
}

/** Orbital angle at a given elapsed time (days). */
export function angleAtTime(
  initialAngle: number,
  orbitPeriod: number,
  elapsedDays: number,
): number {
  return initialAngle + ((Math.PI * 2) / orbitPeriod) * elapsedDays;
}

export function visualRadius(r: number): number {
  return Math.max(MIN_VISUAL_RADIUS, Math.log1p(r) * BODY_SCALE);
}
