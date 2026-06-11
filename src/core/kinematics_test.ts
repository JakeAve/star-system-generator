import { assertEquals, assertAlmostEquals } from "@std/assert";
import {
  AU_SCALE,
  angleAtTime,
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

Deno.test("orbitPosition: angle 0 sits at (c+a, 0)", () => {
  const pos = orbitPosition(10, 8, 2, 0);
  assertAlmostEquals(pos.x, 12);
  assertAlmostEquals(pos.y, 0);
});

Deno.test("orbitPosition: quarter turn sits at (c, b)", () => {
  const pos = orbitPosition(10, 8, 2, Math.PI / 2);
  assertAlmostEquals(pos.x, 2);
  assertAlmostEquals(pos.y, 8);
});

Deno.test("orbitPosition: periapsisAngle rotates the orbit about the focus", () => {
  // Unrotated point (c+a, 0) = (12, 0); rotating by +π/2 → (0, 12).
  const pos = orbitPosition(10, 8, 2, 0, Math.PI / 2);
  assertAlmostEquals(pos.x, 0, 1e-9);
  assertAlmostEquals(pos.y, 12);
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
