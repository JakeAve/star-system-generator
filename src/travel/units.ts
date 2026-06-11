// src/travel/units.ts
// SI physical constants and unit conversions for the travel layer.

/** Newtonian gravitational constant, m³ kg⁻¹ s⁻². */
export const G = 6.674e-11;
/** Solar mass, kg. */
export const M_SUN_KG = 1.98892e30;
/** Earth mass, kg. */
export const M_EARTH_KG = 5.9722e24;
/** Astronomical unit, m. */
export const AU_M = 1.495978707e11;
/** Earth radius, m. */
export const R_EARTH_M = 6.371e6;
/** Seconds per day. */
export const DAY_S = 86400;

/** μ = G·M (m³/s²) for a star whose mass is given in solar masses. */
export function muStar(massSolar: number): number {
  return G * M_SUN_KG * massSolar;
}

/** μ = G·M (m³/s²) for a non-star body whose mass is given in Earth masses. */
export function muBody(massEarth: number): number {
  return G * M_EARTH_KG * massEarth;
}

/** Sphere-of-influence radius (m): a·(m_body/m_central)^(2/5). Masses in any consistent unit. */
export function sphereOfInfluence(
  aM: number,
  mBody: number,
  mCentral: number,
): number {
  return aM * Math.pow(mBody / mCentral, 2 / 5);
}

export const auToM = (au: number): number => au * AU_M;
export const mToAu = (m: number): number => m / AU_M;
export const dayToS = (d: number): number => d * DAY_S;
export const sToDay = (s: number): number => s / DAY_S;
export const mpsToKmps = (mps: number): number => mps / 1000;
export const kmpsToMps = (kmps: number): number => kmps * 1000;
