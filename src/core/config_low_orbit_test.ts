import { assertEquals } from "@std/assert";
import { DEFAULT_CONFIG } from "./config.ts";

Deno.test("DEFAULT_CONFIG: lowOrbitAltitudeFraction defaults to 0.05", () => {
  assertEquals(DEFAULT_CONFIG.lowOrbitAltitudeFraction, 0.05);
});
