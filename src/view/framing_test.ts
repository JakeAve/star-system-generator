import { assertAlmostEquals, assertEquals } from "@std/assert";
import { centroidOf, enclosingRadius } from "./framing.ts";

Deno.test("centroidOf: single point returns that point", () => {
  assertEquals(centroidOf([[3, 4]]), [3, 4]);
});

Deno.test("centroidOf: averages 2D points", () => {
  assertEquals(centroidOf([[0, 0], [4, 2]]), [2, 1]);
});

Deno.test("centroidOf: averages 3D points", () => {
  assertEquals(centroidOf([[0, 0, 0], [6, 3, 9]]), [3, 1.5, 4.5]);
});

Deno.test("enclosingRadius: zero for a single point at center", () => {
  assertEquals(enclosingRadius([[2, 2]], [2, 2]), 0);
});

Deno.test("enclosingRadius: max distance from center (2D)", () => {
  const pts = [[0, 0], [3, 4]];
  const c = centroidOf(pts); // [1.5, 2]
  assertAlmostEquals(enclosingRadius(pts, c), 2.5, 1e-9);
});

Deno.test("enclosingRadius: works in 3D", () => {
  assertEquals(enclosingRadius([[0, 0, 0], [0, 0, 2]], [0, 0, 0]), 2);
});
