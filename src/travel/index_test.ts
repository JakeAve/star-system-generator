import { assertEquals, assertThrows } from "@std/assert";
import { generateSolarSystem } from "../core/generator.ts";
import { travelOptions } from "./index.ts";
import { EndState } from "./types.ts";

const system = generateSolarSystem({ seed: 1 });
const a = system.objects[0].id;
const b = system.objects[system.objects.length - 1].id;

Deno.test("travelOptions: returns ranked routes between two non-moon bodies", () => {
  const routes = travelOptions(system, { obj: a, type: EndState.Orbit }, {
    obj: b,
    type: EndState.Orbit,
  });
  if (routes.length === 0) throw new Error("expected routes");
  assertEquals(routes[0].bodies, [a, b]);
  if (!(routes[0].totalDeltaV > 0)) throw new Error("expected positive Δv");
});

Deno.test("travelOptions: unknown id throws", () => {
  assertThrows(
    () =>
      travelOptions(system, { obj: "nope", type: EndState.Orbit }, {
        obj: b,
        type: EndState.Orbit,
      }),
    Error,
    "unknown body",
  );
});

Deno.test("travelOptions: moon endpoint throws in Phase 1", () => {
  const parent = system.objects.find((o) => o.moons.length > 0);
  if (!parent) return; // seed has no moons
  const moonId = parent.moons[0].id;
  assertThrows(
    () =>
      travelOptions(system, { obj: a, type: EndState.Orbit }, {
        obj: moonId,
        type: EndState.Orbit,
      }),
    Error,
    "moon endpoints",
  );
});

Deno.test("travelOptions: determinism — identical inputs give identical output", () => {
  const r1 = travelOptions(system, { obj: a, type: EndState.Orbit }, {
    obj: b,
    type: EndState.Orbit,
  });
  const r2 = travelOptions(system, { obj: a, type: EndState.Orbit }, {
    obj: b,
    type: EndState.Orbit,
  });
  assertEquals(JSON.stringify(r1), JSON.stringify(r2));
});

// Seed 42 has a gas giant (obj_28) with several moons — used for same-parent routing.
const sys42 = generateSolarSystem({ seed: 42 });
const giant42 = sys42.objects.find((o) => o.moons.length >= 2);

Deno.test("travelOptions: same-parent moon→moon returns a planetocentric route", () => {
  if (!giant42) throw new Error("seed 42 expected to have a planet with >= 2 moons");
  const m1 = giant42.moons[0].id;
  const m2 = giant42.moons[1].id;
  const routes = travelOptions(sys42, { obj: m1, type: EndState.Orbit }, { obj: m2, type: EndState.Orbit });
  if (routes.length === 0) throw new Error("expected routes");
  assertEquals(routes[0].bodies, [m1, m2]);
  assertEquals(routes[0].legs.length, 1);
  assertEquals(routes[0].legs[0].centralBodyId, giant42.id);
  if (!(routes[0].totalDeltaV > 0)) throw new Error("expected positive Δv");
  if (!(routes[0].duration > 0)) throw new Error("expected positive duration");
});

Deno.test("travelOptions: moon → non-sibling planet still throws (Phase 1c)", () => {
  if (!giant42) throw new Error("seed 42 expected to have a planet with >= 2 moons");
  const m1 = giant42.moons[0].id;
  const planet = sys42.objects[0].id; // a top-level planet, not the moon's parent
  assertThrows(
    () => travelOptions(sys42, { obj: m1, type: EndState.Orbit }, { obj: planet, type: EndState.Orbit }),
    Error,
    "Phase 1c",
  );
});
