import { assertEquals } from "@std/assert";
import { createOrrery } from "./engine.ts";

Deno.test("createOrrery is a factory function", () => {
  assertEquals(typeof createOrrery, "function");
});

Deno.test("createOrrery throws clearly when given no container", () => {
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    (createOrrery as any)(null);
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});
