import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { RNG } from "./rng.ts";

Deno.test("rayleigh: sigma=0 always returns 0", () => {
  const rng = new RNG(123);
  for (let i = 0; i < 50; i++) assertEquals(rng.rayleigh(0, 0.5), 0);
});

Deno.test("rayleigh: all draws lie in [0, max]", () => {
  const rng = new RNG(7);
  for (let i = 0; i < 10000; i++) {
    const e = rng.rayleigh(0.1, 0.4);
    assert(e >= 0 && e <= 0.4, `out of range: ${e}`);
  }
});

Deno.test("rayleigh: mean approximates sigma*sqrt(pi/2)", () => {
  const rng = new RNG(42);
  const sigma = 0.1;
  const N = 100000;
  let sum = 0;
  // Large max so clamping does not bias the mean.
  for (let i = 0; i < N; i++) sum += rng.rayleigh(sigma, 100);
  const mean = sum / N;
  assertAlmostEquals(mean, sigma * Math.sqrt(Math.PI / 2), 0.005);
});

Deno.test("rayleigh: deterministic for a given seed", () => {
  const a = new RNG(99);
  const b = new RNG(99);
  for (let i = 0; i < 20; i++) {
    assertEquals(a.rayleigh(0.1, 0.4), b.rayleigh(0.1, 0.4));
  }
});

Deno.test("rayleigh: consumes exactly one next() (stream alignment)", () => {
  // A rayleigh draw must advance the stream identically to a float draw,
  // so a subsequent next() matches what follows a single next() consumption.
  const a = new RNG(5);
  a.rayleigh(0.1, 0.4);
  const afterRayleigh = a.next();
  const b = new RNG(5);
  b.next(); // one consumption
  const afterOneNext = b.next();
  assertEquals(afterRayleigh, afterOneNext);
});
