import { assertEquals, assertThrows } from "@std/assert";
import { generateSolarSystem } from "../core/generator.ts";
import { getBestRoutes, getRoutes } from "./index.ts";
import { EndState, RankMode, type Route, RouteNodeKind } from "./types.ts";
import { sumPrecise } from "./sum.ts";

const system = generateSolarSystem({ seed: 1 });
const a = system.objects[0].id;
const b = system.objects[system.objects.length - 1].id;

Deno.test("getRoutes: returns ranked routes between two non-moon bodies", () => {
  const routes = getRoutes(system, { obj: a, type: EndState.Orbit }, {
    obj: b,
    type: EndState.Orbit,
  });
  if (routes.length === 0) throw new Error("expected routes");
  // The endpoints are fixed; the cheapest route may insert a gravity-assist flyby between.
  assertEquals(routes[0].bodies[0], a);
  assertEquals(routes[0].bodies[routes[0].bodies.length - 1], b);
  if (!(routes[0].totalDeltaV > 0)) throw new Error("expected positive Δv");
});

Deno.test("getRoutes: maxAssists 0 yields only direct (two-body) routes", () => {
  const routes = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 0, rank: RankMode.All },
  );
  if (routes.length === 0) throw new Error("expected routes");
  for (const r of routes) assertEquals(r.bodies.length, 2);
});

Deno.test("getRoutes: enabling assists adds gravity-assist candidates", () => {
  const direct = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 0, rank: RankMode.All },
  );
  const withAssist = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 1, rank: RankMode.All },
  );
  if (!(withAssist.length > direct.length)) {
    throw new Error("single-assist search should add candidate routes");
  }
  const flyby = withAssist.find((r) => r.bodies.length === 3);
  if (!flyby) throw new Error("expected at least one three-body flyby route");
  assertEquals(flyby.nodes[1].kind, RouteNodeKind.Flyby);
  assertEquals(flyby.bodies[0], a);
  assertEquals(flyby.bodies[2], b);
});

Deno.test("getRoutes: maxAssists 1 never returns a four-body (double-assist) route", () => {
  const routes = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 1, rank: RankMode.All },
  );
  for (const r of routes) {
    if (r.bodies.length > 3) throw new Error("depth-1 cap exceeded");
  }
});

Deno.test("getRoutes: maxAssists 2 enables double-assist (four-body) routes", () => {
  const single = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 1, rank: RankMode.All },
  );
  const double = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 2, rank: RankMode.All },
  );
  if (!(double.length > single.length)) {
    throw new Error("depth-2 search should add candidate routes");
  }
  const quad = double.find((r) => r.bodies.length === 4);
  if (!quad) {
    throw new Error("expected at least one four-body double-assist route");
  }
  assertEquals(quad.nodes[1].kind, RouteNodeKind.Flyby);
  assertEquals(quad.nodes[2].kind, RouteNodeKind.Flyby);
  assertEquals(quad.bodies[0], a);
  assertEquals(quad.bodies[3], b);
  assertEquals(quad.legs.length, 3);
});

Deno.test("getRoutes: maxAssists is capped at depth 2 (a value of 3 matches 2)", () => {
  const two = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 2, rank: RankMode.All },
  );
  const three = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 3, rank: RankMode.All },
  );
  assertEquals(JSON.stringify(three), JSON.stringify(two));
});

Deno.test("getRoutes: unknown id throws", () => {
  assertThrows(
    () =>
      getRoutes(system, { obj: "nope", type: EndState.Orbit }, {
        obj: b,
        type: EndState.Orbit,
      }),
    Error,
    "unknown body",
  );
});

Deno.test("getRoutes: determinism — identical inputs give identical output", () => {
  const r1 = getRoutes(system, { obj: a, type: EndState.Orbit }, {
    obj: b,
    type: EndState.Orbit,
  });
  const r2 = getRoutes(system, { obj: a, type: EndState.Orbit }, {
    obj: b,
    type: EndState.Orbit,
  });
  assertEquals(JSON.stringify(r1), JSON.stringify(r2));
});

// Seed 42 has a gas giant (obj_28) with several moons — used for same-parent routing.
const sys42 = generateSolarSystem({ seed: 42 });
const giant42 = sys42.objects.find((o) => o.moons.length >= 2);

Deno.test("getRoutes: same-parent moon→moon returns a planetocentric route", () => {
  if (!giant42) {
    throw new Error("seed 42 expected to have a planet with >= 2 moons");
  }
  const m1 = giant42.moons[0].id;
  const m2 = giant42.moons[1].id;
  const routes = getRoutes(sys42, { obj: m1, type: EndState.Orbit }, {
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

Deno.test("getRoutes: moon → non-parent planet routes through a Transit node", () => {
  if (!giant42) {
    throw new Error("seed 42 expected to have a planet with >= 2 moons");
  }
  const moonId = giant42.moons[0].id;
  const planet = sys42.objects.find((o) => o.id !== giant42.id);
  if (!planet) throw new Error("seed 42 expected a second planet");
  const routes = getRoutes(
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

Deno.test("getRoutes: planet → moon routes through the moon's parent", () => {
  if (!giant42) {
    throw new Error("seed 42 expected to have a planet with >= 2 moons");
  }
  const moonId = giant42.moons[0].id;
  const planet = sys42.objects.find((o) => o.id !== giant42.id);
  if (!planet) throw new Error("seed 42 expected a second planet");
  const routes = getRoutes(
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

// --- getBestRoutes ---------------------------------------------------------------------

/** Same route by value: identical body sequence and (within fp tolerance) Δv and duration. */
function sameRoute(x: Route, y: Route): boolean {
  if (x.bodies.length !== y.bodies.length) return false;
  for (let i = 0; i < x.bodies.length; i++) {
    if (x.bodies[i] !== y.bodies[i]) return false;
  }
  return Math.abs(x.totalDeltaV - y.totalDeltaV) < 1e-9 &&
    Math.abs(x.duration - y.duration) < 1e-9;
}

Deno.test("getBestRoutes: returns fastest/cheapest picks for two non-moon bodies", () => {
  const picks = getBestRoutes(system, { obj: a, type: EndState.Orbit }, {
    obj: b,
    type: EndState.Orbit,
  });
  if (picks.length === 0) throw new Error("expected picks");
  // 1–3 picks: fastest, (goldilocks), cheapest — collapsing when they coincide.
  if (picks.length > 3) throw new Error("expected at most 3 picks");
  for (const r of picks) {
    assertEquals(r.bodies[0], a);
    assertEquals(r.bodies[r.bodies.length - 1], b);
  }
});

Deno.test("getBestRoutes: picks agree with getRoutes' extremes (non-moon)", () => {
  const all = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { rank: RankMode.All },
  );
  const picks = getBestRoutes(system, { obj: a, type: EndState.Orbit }, {
    obj: b,
    type: EndState.Orbit,
  });
  const minDur = Math.min(...all.map((r) => r.duration));
  const minDv = Math.min(...all.map((r) => r.totalDeltaV));
  const fastest = picks.reduce((m, r) => (r.duration < m.duration ? r : m));
  const cheapest = picks.reduce((m, r) =>
    r.totalDeltaV < m.totalDeltaV ? r : m
  );
  if (Math.abs(fastest.duration - minDur) > 1e-6) {
    throw new Error("fastest pick is not the global min-duration route");
  }
  if (Math.abs(cheapest.totalDeltaV - minDv) > 1e-6) {
    throw new Error("cheapest pick is not the global min-Δv route");
  }
});

Deno.test("getBestRoutes: the star cannot be an endpoint", () => {
  assertThrows(
    () =>
      getBestRoutes(system, { obj: system.star.id, type: EndState.Orbit }, {
        obj: b,
        type: EndState.Orbit,
      }),
    Error,
    "star cannot be a travel endpoint",
  );
});

// Moon endpoints: getBestRoutes delegates to getRoutes and picks from its front, so every
// pick must be one of getRoutes' candidates (the two APIs stay in agreement).
const moonEndpointCases: Array<
  { name: string; from: () => string; to: () => string }
> = [
  {
    name: "same-parent moon→moon",
    from: () => giant42!.moons[0].id,
    to: () => giant42!.moons[1].id,
  },
  {
    name: "moon → non-parent planet",
    from: () => giant42!.moons[0].id,
    to: () => sys42.objects.find((o) => o.id !== giant42!.id)!.id,
  },
  {
    name: "planet → moon",
    from: () => sys42.objects.find((o) => o.id !== giant42!.id)!.id,
    to: () => giant42!.moons[0].id,
  },
  {
    name: "moon → moon across different parents",
    from: () => sys42.objects.filter((o) => o.moons.length > 0)[0].moons[0].id,
    to: () => sys42.objects.filter((o) => o.moons.length > 0)[1].moons[0].id,
  },
];

for (const tc of moonEndpointCases) {
  Deno.test(`getBestRoutes: ${tc.name} returns picks drawn from getRoutes' front`, () => {
    if (!giant42) {
      throw new Error("seed 42 expected to have a planet with >= 2 moons");
    }
    const from = { obj: tc.from(), type: EndState.Orbit };
    const to = { obj: tc.to(), type: EndState.Orbit };
    const all = getRoutes(sys42, from, to, { rank: RankMode.All });
    const picks = getBestRoutes(sys42, from, to);

    if (picks.length === 0) throw new Error("expected picks");
    if (picks.length > 3) throw new Error("expected at most 3 picks");
    // Every pick is one of getRoutes' candidate routes (by value).
    for (const p of picks) {
      if (!all.some((c) => sameRoute(p, c))) {
        throw new Error("pick is not present in getRoutes' candidate set");
      }
      if (!(p.totalDeltaV > 0)) throw new Error("expected positive Δv");
    }
    // fastest pick is the global min-duration route; cheapest is the global min-Δv route.
    const minDur = Math.min(...all.map((r) => r.duration));
    const minDv = Math.min(...all.map((r) => r.totalDeltaV));
    const fastest = picks.reduce((m, r) => (r.duration < m.duration ? r : m));
    const cheapest = picks.reduce((m, r) =>
      r.totalDeltaV < m.totalDeltaV ? r : m
    );
    if (Math.abs(fastest.duration - minDur) > 1e-9) {
      throw new Error("fastest pick is not the global min-duration route");
    }
    if (Math.abs(cheapest.totalDeltaV - minDv) > 1e-9) {
      throw new Error("cheapest pick is not the global min-Δv route");
    }
  });
}

Deno.test("getBestRoutes: moon endpoints are deterministic", () => {
  if (!giant42) throw new Error("seed 42 expected a planet with >= 2 moons");
  const from = { obj: giant42.moons[0].id, type: EndState.Orbit };
  const to = { obj: giant42.moons[1].id, type: EndState.Orbit };
  const r1 = getBestRoutes(sys42, from, to);
  const r2 = getBestRoutes(sys42, from, to);
  assertEquals(JSON.stringify(r1), JSON.stringify(r2));
});

Deno.test("getRoutes: moon → moon across different parents has two Transits and three legs", () => {
  // Two planets that each have at least one moon (different parents).
  const withMoons = sys42.objects.filter((o) => o.moons.length > 0);
  if (withMoons.length < 2) {
    throw new Error("seed 42 expected to have >= 2 planets with moons");
  }
  const parentA = withMoons[0];
  const parentB = withMoons[1];
  const moonA = parentA.moons[0].id;
  const moonB = parentB.moons[0].id;

  const routes = getRoutes(
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

// --- duration: precise, departure-date-independent (no large-number cancellation) -------

Deno.test("duration: equal-TOF routes share one duration regardless of departure date", () => {
  const routes = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { rank: RankMode.All },
  );
  // Direct routes: a single time-of-flight fully determines duration (terminals are 0).
  // Many depart days share each TOF; their durations must be bit-identical, not drift.
  const byTof = new Map<number, Route[]>();
  for (const r of routes) {
    if (r.legs.length !== 1) continue;
    const tof = r.legs[0].timeOfFlight;
    const g = byTof.get(tof) ?? [];
    g.push(r);
    byTof.set(tof, g);
  }
  let checked = 0;
  for (const group of byTof.values()) {
    if (group.length < 2) continue;
    checked++;
    for (const r of group) assertEquals(r.duration, group[0].duration);
  }
  if (checked === 0) {
    throw new Error(
      "expected >=1 set of same-TOF routes at different departures",
    );
  }
});

Deno.test("duration: equals the precise sum of its components (getRoutes & getBestRoutes)", () => {
  const expected = (r: Route) =>
    sumPrecise([
      ...r.legs.map((l) => l.timeOfFlight),
      ...r.nodes.filter((n) => n.terminal).map((n) => n.terminal!.duration),
    ]);
  const wp = (id: string) => ({ obj: id, type: EndState.Orbit });
  for (
    const r of getRoutes(system, wp(a), wp(b), { rank: RankMode.All })
  ) assertEquals(r.duration, expected(r));
  for (const r of getBestRoutes(system, wp(a), wp(b))) {
    assertEquals(r.duration, expected(r));
  }
});
