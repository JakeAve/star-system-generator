// src/travel/lambert.ts
// Universal-variable Lambert solver (Curtis, Algorithm 5.2), specialized to 2D.

function stumpffC(z: number): number {
  if (z > 1e-9) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-9) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2;
}

function stumpffS(z: number): number {
  if (z > 1e-9) {
    const sz = Math.sqrt(z);
    return (sz - Math.sin(sz)) / (sz * sz * sz);
  }
  if (z < -1e-9) {
    const sz = Math.sqrt(-z);
    return (Math.sinh(sz) - sz) / (sz * sz * sz);
  }
  return 1 / 6;
}

export interface LambertSolution {
  v1: { x: number; y: number }; // m/s at r1
  v2: { x: number; y: number }; // m/s at r2
}

/**
 * Solve Lambert's problem in 2D. r1, r2 in m; tof in s; mu in m³/s².
 * `prograde` picks the transfer direction (counter-clockwise = prograde).
 */
export function solveLambert(
  r1: { x: number; y: number },
  r2: { x: number; y: number },
  tof: number,
  mu: number,
  prograde = true,
): LambertSolution {
  const r1m = Math.hypot(r1.x, r1.y);
  const r2m = Math.hypot(r2.x, r2.y);
  const crossZ = r1.x * r2.y - r1.y * r2.x;
  const cosDth = (r1.x * r2.x + r1.y * r2.y) / (r1m * r2m);
  let dth = Math.acos(Math.min(1, Math.max(-1, cosDth)));
  if (prograde ? crossZ < 0 : crossZ >= 0) dth = 2 * Math.PI - dth;

  const A = Math.sin(dth) * Math.sqrt((r1m * r2m) / (1 - Math.cos(dth)));

  const yOf = (z: number): number =>
    r1m + r2m + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));

  const Fof = (z: number): number => {
    const yz = yOf(z);
    const c = stumpffC(z);
    return Math.pow(yz / c, 1.5) * stumpffS(z) + A * Math.sqrt(yz) -
      Math.sqrt(mu) * tof;
  };

  // Newton iteration on z with a numerical derivative (robust for game-grade accuracy).
  let z = 0;
  for (let i = 0; i < 200; i++) {
    const dz = 1e-3;
    const f = Fof(z);
    const dF = (Fof(z + dz) - Fof(z - dz)) / (2 * dz);
    const zn = z - f / dF;
    if (!Number.isFinite(zn)) break;
    if (Math.abs(zn - z) < 1e-8) {
      z = zn;
      break;
    }
    z = zn;
  }

  const yz = yOf(z);
  const f = 1 - yz / r1m;
  const g = A * Math.sqrt(yz / mu);
  const gdot = 1 - yz / r2m;
  return {
    v1: { x: (r2.x - f * r1.x) / g, y: (r2.y - f * r1.y) / g },
    v2: { x: (gdot * r2.x - r1.x) / g, y: (gdot * r2.y - r1.y) / g },
  };
}
