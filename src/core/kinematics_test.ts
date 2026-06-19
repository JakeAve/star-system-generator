import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  angleAtTime,
  AU_SCALE,
  eccentricAngleAtTime,
  orbitParams,
  orbitPosition,
  solveKepler,
  visualRadius,
} from "./kinematics.ts";

Deno.test("orbitParams: circular orbit has b == a and c == 0", () => {
  const { a, b, c } = orbitParams(1, 0, false);
  assertEquals(a, AU_SCALE);
  assertEquals(b, AU_SCALE);
  assertEquals(c, 0);
});

Deno.test("orbitParams: eccentric orbit shrinks b and offsets c", () => {
  const { a, b, c } = orbitParams(1, 0.5, false);
  assertAlmostEquals(b, a * Math.sqrt(1 - 0.25));
  assertAlmostEquals(c, a * 0.5);
});

Deno.test("orbitParams: moon uses moon scale", () => {
  const planet = orbitParams(1, 0, false);
  const moon = orbitParams(1, 0, true);
  assertEquals(moon.a, planet.a);
});

Deno.test("orbitPosition: angle 0 sits at periapsis (a-c, 0)", () => {
  const pos = orbitPosition(10, 8, 2, 0);
  assertAlmostEquals(pos.x, 8);
  assertAlmostEquals(pos.y, 0);
});

Deno.test("orbitPosition: quarter turn sits at (-c, b)", () => {
  const pos = orbitPosition(10, 8, 2, Math.PI / 2);
  assertAlmostEquals(pos.x, -2);
  assertAlmostEquals(pos.y, 8);
});

Deno.test("orbitPosition: periapsisAngle rotates the orbit about the focus", () => {
  // Unrotated periapsis (a-c, 0) = (8, 0); rotating by +π/2 → (0, 8).
  const pos = orbitPosition(10, 8, 2, 0, Math.PI / 2);
  assertAlmostEquals(pos.x, 0, 1e-9);
  assertAlmostEquals(pos.y, 8);
});

Deno.test("orbital motion: closer AND faster at periapsis than apoapsis (Kepler's 2nd law)", () => {
  const e = 0.6;
  const { a, b, c } = orbitParams(1, e, false);
  const period = 100;
  const dt = 0.5;
  // orbitalPhase 0 → mean anomaly 0 → E=0 → periapsis at t=0; apoapsis at half a period.
  const sample = (t: number) => {
    const e0 = eccentricAngleAtTime(0, period, t, e);
    const e1 = eccentricAngleAtTime(0, period, t + dt, e);
    const p0 = orbitPosition(a, b, c, e0, 0);
    const p1 = orbitPosition(a, b, c, e1, 0);
    return {
      radius: Math.hypot(p0.x, p0.y),
      speed: Math.hypot(p1.x - p0.x, p1.y - p0.y),
    };
  };
  const peri = sample(0);
  const apo = sample(period / 2);
  // Distances: periapsis = a(1-e), apoapsis = a(1+e).
  assertAlmostEquals(peri.radius, a * (1 - e), 1e-6);
  assertAlmostEquals(apo.radius, a * (1 + e), 1e-6);
  // Speed must be greater at periapsis (guards against the apse/speed inversion).
  if (!(peri.speed > apo.speed)) {
    throw new Error(
      `periapsis speed ${peri.speed} must exceed apoapsis speed ${apo.speed}`,
    );
  }
});

Deno.test("orbitPosition: periapsisAngle defaults to no rotation", () => {
  const rotated = orbitPosition(10, 8, 2, Math.PI / 3, 0);
  const plain = orbitPosition(10, 8, 2, Math.PI / 3);
  assertAlmostEquals(rotated.x, plain.x);
  assertAlmostEquals(rotated.y, plain.y);
});

Deno.test("angleAtTime advances by 2π over one period", () => {
  assertAlmostEquals(angleAtTime(0, 365, 365), Math.PI * 2);
  assertAlmostEquals(angleAtTime(0.5, 10, 0), 0.5);
});

Deno.test("solveKepler: e=0 returns the mean anomaly unchanged", () => {
  assertEquals(solveKepler(0, 0), 0);
  assertEquals(solveKepler(1.234, 0), 1.234);
  assertEquals(solveKepler(-2.5, 0), -2.5);
});

Deno.test("solveKepler: result satisfies Kepler's equation M = E - e*sin(E)", () => {
  for (const e of [0.1, 0.3, 0.6, 0.9]) {
    for (const M of [-2.0, -0.5, 0.3, 1.7, 3.0]) {
      const E = solveKepler(M, e);
      const recovered = E - e * Math.sin(E);
      const twoPi = Math.PI * 2;
      let m = ((M % twoPi) + twoPi) % twoPi;
      if (m > Math.PI) m -= twoPi;
      assertAlmostEquals(recovered, m, 1e-9);
    }
  }
});

Deno.test("solveKepler: known value (M=π/2, e=0.5) ~ 2.0210", () => {
  assertAlmostEquals(solveKepler(Math.PI / 2, 0.5), 2.020980, 1e-5);
});

Deno.test("solveKepler: converges for high eccentricity", () => {
  const e = 0.95;
  const E = solveKepler(0.05, e);
  assertAlmostEquals(E - e * Math.sin(E), 0.05, 1e-9);
});

Deno.test("eccentricAngleAtTime: e=0 equals angleAtTime exactly", () => {
  assertEquals(
    eccentricAngleAtTime(0.5, 365, 100, 0),
    angleAtTime(0.5, 365, 100),
  );
});

Deno.test("eccentricAngleAtTime: applies Kepler solve for e>0", () => {
  const e = 0.4;
  const mean = angleAtTime(0.2, 365, 90);
  assertEquals(eccentricAngleAtTime(0.2, 365, 90, e), solveKepler(mean, e));
});

Deno.test("visualRadius floors at MIN and is pure", () => {
  assertEquals(visualRadius(0), visualRadius(0));
  assertEquals(visualRadius(0) >= 0.015, true);
  assertEquals(visualRadius(100) > visualRadius(1), true);
});

Deno.test("angleAtTime: retrograde negates the angular-rate advance", () => {
  const prograde = angleAtTime(0, 100, 25, false);
  const retro = angleAtTime(0, 100, 25, true);
  // prograde advances +π/2 over a quarter period; retrograde the opposite.
  assertEquals(prograde, (Math.PI * 2 / 100) * 25);
  assertEquals(retro, -prograde);
});

Deno.test("angleAtTime: defaults to prograde when retrograde omitted", () => {
  assertEquals(angleAtTime(0.5, 100, 25), angleAtTime(0.5, 100, 25, false));
});

Deno.test("eccentricAngleAtTime: retrograde traverses the same ellipse in reverse", () => {
  // Negating the rate at +t equals advancing prograde to -t (same mean anomaly),
  // so the eccentric anomaly matches for any e and any initial phase.
  const retro = eccentricAngleAtTime(0.5, 100, 25, 0.3, true);
  const progradeReversed = eccentricAngleAtTime(0.5, 100, -25, 0.3, false);
  assertEquals(retro, progradeReversed);
});
