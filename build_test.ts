import { assertEquals, assertExists } from "@std/assert";
import { build } from "./build.ts";

Deno.test("bundle builds and produces deterministic system", async () => {
  await build();

  const bundleUrl = new URL("./renderer/generator.bundle.js", import.meta.url);
  const mod = await import(bundleUrl.href);

  assertExists(mod.generateSolarSystem);
  assertExists(mod.allObjects);
  assertExists(mod.knownObjects);

  const a = mod.generateSolarSystem({ seed: 42 });
  const b = mod.generateSolarSystem({ seed: 42 });
  assertEquals(a.seed, 42);
  assertEquals(a, b);
});
