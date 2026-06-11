import { assertAlmostEquals } from "@std/assert";
import { AU_M, auToM, dayToS, muBody, muStar, sphereOfInfluence } from "./units.ts";

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
