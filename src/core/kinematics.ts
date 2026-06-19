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
  const e = Math.min(Math.max(eccentricity ?? 0, 0), 0.999);
  const b = a * Math.sqrt(1 - e * e);
  const c = a * e;
  return { a, b, c };
}

export function orbitPosition(
  a: number,
  b: number,
  c: number,
  angle: number,
  periapsisAngle = 0,
): { x: number; y: number } {
  // Ellipse in its perifocal frame: parent at the focus (origin), periapsis on +x
  // at angle (eccentric anomaly) 0. Standard form x = a·cos E − c, so the body moves
  // fastest at periapsis when E is advanced via the mean-anomaly Kepler solve.
  const px = a * Math.cos(angle) - c;
  const py = b * Math.sin(angle);
  if (periapsisAngle === 0) return { x: px, y: py };
  // Rotate about the focus (origin) by the argument of periapsis.
  const cos = Math.cos(periapsisAngle);
  const sin = Math.sin(periapsisAngle);
  return { x: px * cos - py * sin, y: px * sin + py * cos };
}

/** Orbital angle at a given elapsed time (days). */
export function angleAtTime(
  initialAngle: number,
  orbitPeriod: number,
  elapsedDays: number,
  retrograde = false,
): number {
  const sign = retrograde ? -1 : 1;
  return initialAngle + sign * ((Math.PI * 2) / orbitPeriod) * elapsedDays;
}

/**
 * Solve Kepler's equation M = E − e·sin E for the eccentric anomaly E (radians),
 * given mean anomaly M and eccentricity e, via Newton–Raphson.
 *
 * For e === 0 the input is returned unchanged (E = M), which keeps circular-orbit
 * motion identical to the previous linear-angle behavior.
 */
export function solveKepler(meanAnomaly: number, eccentricity: number): number {
  const e = Math.min(Math.max(eccentricity, 0), 0.999);
  if (e === 0) return meanAnomaly;
  // Normalize M to [-π, π] for fast, stable Newton convergence.
  const twoPi = Math.PI * 2;
  let M = meanAnomaly % twoPi;
  if (M > Math.PI) M -= twoPi;
  else if (M < -Math.PI) M += twoPi;
  // Initial guess: M for mild e, π·sign(M) near parabolic.
  let E = e < 0.8 ? M : Math.PI * (M < 0 ? -1 : 1);
  for (let i = 0; i < 30; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Eccentric anomaly (radians) at a given elapsed time — the angle to pass to
 * `orbitPosition`. Advances the MEAN anomaly linearly (`angleAtTime`), then solves
 * Kepler's equation. For e === 0 this reduces exactly to `angleAtTime`.
 */
export function eccentricAngleAtTime(
  initialMeanAngle: number,
  orbitPeriod: number,
  elapsedDays: number,
  eccentricity: number,
  retrograde = false,
): number {
  return solveKepler(
    angleAtTime(initialMeanAngle, orbitPeriod, elapsedDays, retrograde),
    eccentricity,
  );
}

export function visualRadius(r: number): number {
  return Math.max(MIN_VISUAL_RADIUS, Math.log1p(r) * BODY_SCALE);
}
