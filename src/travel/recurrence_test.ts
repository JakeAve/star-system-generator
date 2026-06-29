import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  combinedRecurrenceDays,
  orbitalPeriodDays,
  reframeCount,
  synodicPeriodDays,
} from "./recurrence.ts";
import { muStar } from "./units.ts";

Deno.test("orbitalPeriodDays: matches 2π√(a³/μ) and grows with radius", () => {
  const mu = muStar(1);
  const t1 = orbitalPeriodDays(1, mu);
  const t2 = orbitalPeriodDays(4, mu); // a×4 → period ×8 (Kepler's third law)
  assertAlmostEquals(t2 / t1, 8, 1e-6);
});

Deno.test("synodicPeriodDays: Earth/Mars-like periods give ≈779.8 days", () => {
  assertAlmostEquals(synodicPeriodDays(365.25, 687), 779.8, 1.0);
});

Deno.test("synodicPeriodDays: equal periods are non-finite (coorbital)", () => {
  assertEquals(Number.isFinite(synodicPeriodDays(400, 400)), false);
});

Deno.test("combinedRecurrenceDays: commensurate chain returns the LCM", () => {
  // LCM(10, 15) = 30; cap is large so no clamp.
  assertAlmostEquals(combinedRecurrenceDays([10, 15], 1e6), 30, 1.0);
  // LCM(10, 20) = 20.
  assertAlmostEquals(combinedRecurrenceDays([10, 20], 1e6), 20, 1.0);
});

Deno.test("combinedRecurrenceDays: incommensurate chain falls back to C·max", () => {
  // 10 and 10π never re-phase within tolerance → fallback min(C·max, cap).
  const C = 12, max = 10 * Math.PI;
  assertAlmostEquals(
    combinedRecurrenceDays([10, 10 * Math.PI], 1e6),
    C * max,
    1.0,
  );
});

Deno.test("combinedRecurrenceDays: caps at the outer period", () => {
  // LCM would be 30 but the cap is 25 → capped.
  assertAlmostEquals(combinedRecurrenceDays([10, 15], 25), 25, 1e-9);
});

Deno.test("combinedRecurrenceDays: all-coorbital (non-finite) returns the cap", () => {
  assertEquals(combinedRecurrenceDays([Infinity], 500), 500);
  assertEquals(combinedRecurrenceDays([], 500), 500);
});

Deno.test("reframeCount: unclamped uses exact spacing anchored at 0", () => {
  // span 100, Δ 5 → floor(100/5)+1 = 21 samples, step 5, exact.
  const r = reframeCount(100, 5, 4, 120);
  assertEquals(r.count, 21);
  assertAlmostEquals(r.step, 5, 1e-12);
  assertEquals(r.exact, true);
});

Deno.test("reframeCount: clamp at max coarsens to even spacing over the span", () => {
  // raw 21 > max 10 → 10 samples spread over the span, step = 100/9, not exact.
  const r = reframeCount(100, 5, 4, 10);
  assertEquals(r.count, 10);
  assertAlmostEquals(r.step, 100 / 9, 1e-9);
  assertEquals(r.exact, false);
});

Deno.test("reframeCount: clamp at min densifies a tiny span", () => {
  // raw floor(8/5)+1 = 2 < min 6 → 6 samples over the span, not exact.
  const r = reframeCount(8, 5, 6, 120);
  assertEquals(r.count, 6);
  assertAlmostEquals(r.step, 8 / 5, 1e-9);
  assertEquals(r.exact, false);
});

Deno.test("reframeCount: degenerate span yields a single sample", () => {
  const r = reframeCount(0, 5, 6, 120);
  assertEquals(r.count >= 1, true);
});
