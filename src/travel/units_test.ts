import { assertAlmostEquals } from "@std/assert";
import {
  AU_M,
  auToM,
  dayToS,
  hillRadius,
  M_SUN_IN_EARTH,
  muBody,
  muStar,
  R_SUN_M,
  sphereOfInfluence,
} from "./units.ts";

Deno.test("muStar: 1 solar mass ≈ 1.327e20 m³/s²", () => {
  assertAlmostEquals(muStar(1), 1.327e20, 5e17);
});

Deno.test("muBody: 1 Earth mass ≈ 3.986e14 m³/s²", () => {
  assertAlmostEquals(muBody(1), 3.986e14, 2e12);
});

Deno.test("sphereOfInfluence: Earth around Sun ≈ 9.2e8 m", () => {
  const r = sphereOfInfluence(AU_M, 1, 332946);
  assertAlmostEquals(r, 9.2e8, 5e7);
});

Deno.test("conversions: auToM and dayToS", () => {
  assertAlmostEquals(auToM(1), 1.495978707e11, 1);
  assertAlmostEquals(dayToS(1), 86400, 1e-6);
});

Deno.test("R_SUN_M: solar radius ≈ 6.957e8 m", () => {
  assertAlmostEquals(R_SUN_M, 6.957e8, 1e6);
});

Deno.test("M_SUN_IN_EARTH: ≈ 333000 Earth masses", () => {
  assertAlmostEquals(M_SUN_IN_EARTH, 333000, 2000);
});

Deno.test("hillRadius: Earth's Moon Hill sphere ≈ 6.1e7 m", () => {
  // Moon orbits Earth at 3.844e8 m; m_moon/m_earth ≈ 0.0123
  const r = hillRadius(3.844e8, 0.0123, 1);
  assertAlmostEquals(r, 6.1e7, 5e6);
});
