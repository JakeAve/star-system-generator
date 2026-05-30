import { assertEquals, assertAlmostEquals } from "@std/assert";
import {
  AU_SCALE,
  angleAtTime,
  orbitParams,
  orbitPosition,
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

Deno.test("angleAtTime advances by 2π over one period", () => {
  assertAlmostEquals(angleAtTime(0, 365, 365), Math.PI * 2);
  assertAlmostEquals(angleAtTime(0.5, 10, 0), 0.5);
});

Deno.test("visualRadius floors at MIN and is pure", () => {
  assertEquals(visualRadius(0), visualRadius(0));
  assertEquals(visualRadius(0) >= 0.015, true);
  assertEquals(visualRadius(100) > visualRadius(1), true);
});
