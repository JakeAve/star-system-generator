import { assertEquals } from "@std/assert";
import { createCanvasOrrery } from "./engine.ts";

Deno.test("createCanvasOrrery is a factory function", () => {
  assertEquals(typeof createCanvasOrrery, "function");
});

Deno.test("createCanvasOrrery throws clearly when given no container", () => {
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    (createCanvasOrrery as any)(null);
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});
