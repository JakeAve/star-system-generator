import { assertEquals, assertThrows } from "@std/assert";
import { generateSolarSystem } from "../core/generator.ts";
import { travelOptions } from "./index.ts";
import { EndState } from "./types.ts";

const system = generateSolarSystem({ seed: 1 });
const a = system.objects[0].id;
const b = system.objects[system.objects.length - 1].id;

Deno.test("travelOptions: returns ranked routes between two non-moon bodies", () => {
  const routes = travelOptions(system, { obj: a, type: EndState.Orbit }, { obj: b, type: EndState.Orbit });
  if (routes.length === 0) throw new Error("expected routes");
  assertEquals(routes[0].bodies, [a, b]);
  if (!(routes[0].totalDeltaV > 0)) throw new Error("expected positive Δv");
});

Deno.test("travelOptions: unknown id throws", () => {
  assertThrows(
    () => travelOptions(system, { obj: "nope", type: EndState.Orbit }, { obj: b, type: EndState.Orbit }),
    Error,
    "unknown body",
  );
});

Deno.test("travelOptions: moon endpoint throws in Phase 1", () => {
  const parent = system.objects.find((o) => o.moons.length > 0);
  if (!parent) return; // seed has no moons
  const moonId = parent.moons[0].id;
  assertThrows(
    () => travelOptions(system, { obj: a, type: EndState.Orbit }, { obj: moonId, type: EndState.Orbit }),
    Error,
    "moon endpoints",
  );
});

Deno.test("travelOptions: determinism — identical inputs give identical output", () => {
  const r1 = travelOptions(system, { obj: a, type: EndState.Orbit }, { obj: b, type: EndState.Orbit });
  const r2 = travelOptions(system, { obj: a, type: EndState.Orbit }, { obj: b, type: EndState.Orbit });
  assertEquals(JSON.stringify(r1), JSON.stringify(r2));
});
