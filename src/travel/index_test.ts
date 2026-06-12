import { assertEquals, assertThrows } from "@std/assert";
import { generateSolarSystem } from "../core/generator.ts";
import { travelOptions } from "./index.ts";
import { EndState, RouteNodeKind } from "./types.ts";

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
  if (!giant42) {
    throw new Error("seed 42 expected to have a planet with >= 2 moons");
  }
  const m1 = giant42.moons[0].id;
  const m2 = giant42.moons[1].id;
  const routes = travelOptions(sys42, { obj: m1, type: EndState.Orbit }, {
    obj: m2,
    type: EndState.Orbit,
  });
  if (routes.length === 0) throw new Error("expected routes");
  assertEquals(routes[0].bodies, [m1, m2]);
  assertEquals(routes[0].legs.length, 1);
  assertEquals(routes[0].legs[0].centralBodyId, giant42.id);
  if (!(routes[0].totalDeltaV > 0)) throw new Error("expected positive Δv");
  if (!(routes[0].duration > 0)) throw new Error("expected positive duration");
});

Deno.test("travelOptions: moon → non-parent planet routes through a Transit node", () => {
  if (!giant42) {
    throw new Error("seed 42 expected to have a planet with >= 2 moons");
  }
  const moonId = giant42.moons[0].id;
  const planet = sys42.objects.find((o) => o.id !== giant42.id);
  if (!planet) throw new Error("seed 42 expected a second planet");
  const routes = travelOptions(
    sys42,
    { obj: moonId, type: EndState.Orbit },
    { obj: planet.id, type: EndState.Orbit },
  );
  if (routes.length === 0) throw new Error("expected routes");
  const r = routes[0];
  assertEquals(r.bodies, [moonId, giant42.id, planet.id]);
  assertEquals(r.legs.length, 2);
  assertEquals(r.legs[0].centralBodyId, giant42.id); // planetocentric escape
  assertEquals(r.legs[1].centralBodyId, sys42.star.id); // heliocentric spine
  if (r.nodes[1].kind !== RouteNodeKind.Transit) {
    throw new Error("expected a Transit node");
  }
  if (!(r.totalDeltaV > 0)) throw new Error("expected positive Δv");
});

Deno.test("travelOptions: planet → moon routes through the moon's parent", () => {
  if (!giant42) {
    throw new Error("seed 42 expected to have a planet with >= 2 moons");
  }
  const moonId = giant42.moons[0].id;
  const planet = sys42.objects.find((o) => o.id !== giant42.id);
  if (!planet) throw new Error("seed 42 expected a second planet");
  const routes = travelOptions(
    sys42,
    { obj: planet.id, type: EndState.Orbit },
    { obj: moonId, type: EndState.Surface },
  );
  if (routes.length === 0) throw new Error("expected routes");
  const r = routes[0];
  assertEquals(r.bodies, [planet.id, giant42.id, moonId]);
  assertEquals(r.legs.length, 2);
  assertEquals(r.legs[0].centralBodyId, sys42.star.id); // heliocentric spine
  assertEquals(r.legs[1].centralBodyId, giant42.id); // planetocentric capture leg
  if (r.nodes[1].kind !== RouteNodeKind.Transit) {
    throw new Error("expected a Transit node");
  }
  if (!(r.totalDeltaV > 0)) throw new Error("expected positive Δv");
});

Deno.test("travelOptions: moon → moon across different parents has two Transits and three legs", () => {
  // Two planets that each have at least one moon (different parents).
  const withMoons = sys42.objects.filter((o) => o.moons.length > 0);
  if (withMoons.length < 2) {
    throw new Error("seed 42 expected to have >= 2 planets with moons");
  }
  const parentA = withMoons[0];
  const parentB = withMoons[1];
  const moonA = parentA.moons[0].id;
  const moonB = parentB.moons[0].id;

  const routes = travelOptions(
    sys42,
    { obj: moonA, type: EndState.Orbit },
    { obj: moonB, type: EndState.Surface },
  );
  if (routes.length === 0) throw new Error("expected routes");
  const r = routes[0];
  assertEquals(r.bodies, [moonA, parentA.id, parentB.id, moonB]);
  assertEquals(r.legs.length, 3);
  assertEquals(r.nodes.length, 4);
  assertEquals(r.legs[0].centralBodyId, parentA.id); // planetocentric escape
  assertEquals(r.legs[1].centralBodyId, sys42.star.id); // heliocentric spine
  assertEquals(r.legs[2].centralBodyId, parentB.id); // planetocentric capture
  if (r.nodes[1].kind !== RouteNodeKind.Transit) {
    throw new Error("expected escape Transit node");
  }
  if (r.nodes[2].kind !== RouteNodeKind.Transit) {
    throw new Error("expected capture Transit node");
  }
  // node times must be monotonically non-decreasing
  for (let i = 1; i < r.nodes.length; i++) {
    if (!(r.nodes[i].time >= r.nodes[i - 1].time)) {
      throw new Error("node times must be monotonic");
    }
  }
  if (!(r.totalDeltaV > 0)) throw new Error("expected positive Δv");
});
