import { assertEquals } from "@std/assert";
import { resolveConfig } from "./config-merge.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { ObjectType } from "./types.ts";

Deno.test("resolveConfig with no overrides returns DEFAULT_CONFIG values", () => {
  const cfg = resolveConfig({});
  assertEquals(cfg.richDepositChance, DEFAULT_CONFIG.richDepositChance);
  assertEquals(cfg.radiusRanges.rockyPlanet, DEFAULT_CONFIG.radiusRanges.rockyPlanet);
});

Deno.test("resolveConfig deep-merges nested object, keeping sibling keys", () => {
  const cfg = resolveConfig({ radiusRanges: { gasGiant: { min: 1, max: 2 } } });
  assertEquals(cfg.radiusRanges.gasGiant, { min: 1, max: 2 });
  assertEquals(cfg.radiusRanges.rockyPlanet, DEFAULT_CONFIG.radiusRanges.rockyPlanet);
});

Deno.test("resolveConfig replaces arrays wholesale (no element merge)", () => {
  const cfg = resolveConfig({ starWeights: [{ value: DEFAULT_CONFIG.starWeights[0].value, weight: 99 }] });
  assertEquals(cfg.starWeights.length, 1);
  assertEquals(cfg.starWeights[0].weight, 99);
});

Deno.test("resolveConfig does not mutate DEFAULT_CONFIG", () => {
  const before = DEFAULT_CONFIG.radiusRanges.gasGiant.min;
  resolveConfig({ radiusRanges: { gasGiant: { min: -1, max: -1 } } });
  assertEquals(DEFAULT_CONFIG.radiusRanges.gasGiant.min, before);
});

Deno.test("resolveConfig keeps top-level scalar override and passes seed through", () => {
  const cfg = resolveConfig({ seed: 7, richDepositChance: 0.9 });
  assertEquals(cfg.seed, 7);
  assertEquals(cfg.richDepositChance, 0.9);
  assertEquals(cfg.resourceWeights[ObjectType.RockyPlanet], DEFAULT_CONFIG.resourceWeights[ObjectType.RockyPlanet]);
});
