import { assertEquals } from "@std/assert";
import { sumPrecise } from "./sum.ts";

Deno.test("sumPrecise: leading/trailing zeros do not change the result", () => {
  const tof = 6321.934766970728;
  assertEquals(sumPrecise([0, tof, 0]), tof);
});

Deno.test("sumPrecise: avoids the cancellation that naive summation suffers", () => {
  // Naive left-to-right: 1e16 + 1 rounds back to 1e16, then - 1e16 = 0 (the 1 is lost).
  const parts = [1e16, 1, -1e16];
  assertEquals(parts.reduce((a, b) => a + b, 0), 0); // demonstrates the drift
  assertEquals(sumPrecise(parts), 1); // correctly rounded
});

Deno.test("sumPrecise: order-independent", () => {
  const a = [0.1, 0.2, 0.3, 1e15, -1e15];
  const b = [-1e15, 0.3, 1e15, 0.2, 0.1];
  assertEquals(sumPrecise(a), sumPrecise(b));
});
