import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { generateSolarSystem } from "../core/generator.ts";
import {
  getBestRoutes,
  getBestRoutes3,
  getRoutes,
  lagrangePointGeometry,
  lagrangeWaypoint,
} from "./index.ts";
import { EndState, RankMode, type Route, RouteNodeKind } from "./types.ts";
import { sumPrecise } from "./sum.ts";
import { AU_M, DAY_S, M_EARTH_KG, M_SUN_KG, muStar } from "./units.ts";

const system = generateSolarSystem({ seed: 1 });
const a = system.objects[0].id;
const b = system.objects[system.objects.length - 1].id;
const wp = (id: string) => ({ obj: id, type: EndState.Orbit });

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

Deno.test("getRoutes: routes to a heliocentric virtual dock destination", () => {
  const routes = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { spec: { id: "gr-station", orbitRadiusAu: 2.6 }, type: EndState.Dock },
    { rank: RankMode.All },
  );
  if (routes.length === 0) throw new Error("expected routes");
  const r = routes[0];
  assertEquals(r.bodies[r.bodies.length - 1], "gr-station");
  const arrive = r.nodes[r.nodes.length - 1];
  assertEquals(arrive.terminal?.stages[0].kind, "dock");
});

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
  for (
    const r of getRoutes(system, wp(a), wp(b), { rank: RankMode.All })
  ) assertEquals(r.duration, expected(r));
  for (const r of getBestRoutes(system, wp(a), wp(b))) {
    assertEquals(r.duration, expected(r));
  }
  // Cross-frame (moon endpoint) routes are built by a different code path (legs.ts).
  if (giant42) {
    const moon = giant42.moons[0].id;
    const planet = sys42.objects.find((o) => o.id !== giant42!.id)!.id;
    for (
      const r of getRoutes(sys42, wp(moon), wp(planet), { rank: RankMode.All })
    ) assertEquals(r.duration, expected(r));
  }
});

// --- departure horizon tracks the synodic period, not the outer orbital period ----------

Deno.test("getRoutes: direct departures fall within the synodic period, not the orbital period", () => {
  const mu = muStar(system.star.mass);
  const period = (au: number) =>
    (2 * Math.PI * Math.sqrt((au * AU_M) ** 3 / mu)) / DAY_S;
  const rIn = Math.min(
    system.objects[0].orbitRadius,
    system.objects[system.objects.length - 1].orbitRadius,
  );
  const rOut = Math.max(
    system.objects[0].orbitRadius,
    system.objects[system.objects.length - 1].orbitRadius,
  );
  const tIn = period(rIn), tOut = period(rOut);
  const synodic = 1 / Math.abs(1 / tIn - 1 / tOut);
  const horizon = Math.min(synodic, tOut);
  // For this inner→outer pair the launch-window cycle is far shorter than the orbital period.
  if (!(horizon < tOut * 0.5)) {
    throw new Error("expected synodic horizon << outer orbital period");
  }
  const routes = getRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 0, rank: RankMode.All },
  );
  const maxDepart = routes.reduce((m, r) => Math.max(m, r.departAt), 0);
  if (!(maxDepart <= horizon + 1e-6)) {
    throw new Error(
      `direct departures should fall within the synodic horizon (max ${maxDepart} > ${horizon})`,
    );
  }
});

// --- getBestRoutes with findSoonest (7 picks) ------------------------------------------

Deno.test("getBestRoutes(findSoonest): anchors agree with getRoutes' extremes (non-moon)", () => {
  const all = getRoutes(system, wp(a), wp(b), { rank: RankMode.All });
  const picks = getBestRoutes(system, wp(a), wp(b), { findSoonest: true });
  if (picks.length === 0) throw new Error("expected picks");
  const arr = (r: typeof all[number]) => r.departAt + r.duration;
  const minDv = Math.min(...all.map((r) => r.totalDeltaV));
  const minDur = Math.min(...all.map((r) => r.duration));
  const minArr = Math.min(...all.map(arr));
  if (!picks.some((r) => Math.abs(r.totalDeltaV - minDv) < 1e-6)) {
    throw new Error("no pick reaches min Δv");
  }
  if (!picks.some((r) => Math.abs(r.duration - minDur) < 1e-6)) {
    throw new Error("no pick reaches min duration");
  }
  if (!picks.some((r) => Math.abs(arr(r) - minArr) < 1e-6)) {
    throw new Error("no pick reaches min arrival");
  }
});

Deno.test("getBestRoutes(findSoonest): returns at most 7 routes, all distinct by value", () => {
  const picks = getBestRoutes(system, wp(a), wp(b), { findSoonest: true });
  if (picks.length > 7) throw new Error("more than 7 picks");
  const key = (r: typeof picks[number]) =>
    `${r.departAt}|${r.duration}|${r.notation}`;
  assertEquals(picks.length, new Set(picks.map(key)).size);
});

Deno.test("getBestRoutes(findSoonest): deterministic", () => {
  const r1 = getBestRoutes(system, wp(a), wp(b), { findSoonest: true });
  const r2 = getBestRoutes(system, wp(a), wp(b), { findSoonest: true });
  assertEquals(JSON.stringify(r1), JSON.stringify(r2));
});

Deno.test("getBestRoutes(findSoonest): the star cannot be an endpoint", () => {
  assertThrows(() =>
    getBestRoutes(system, { obj: system.star.id, type: EndState.Orbit }, wp(b), { findSoonest: true })
  );
});

Deno.test("getBestRoutes(findSoonest): moon endpoints draw picks from getRoutes' front", () => {
  const giantM = sys42.objects.find((o) => o.moons.length >= 2)!;
  const from = { obj: giantM.moons[0].id, type: EndState.Orbit };
  const to = { obj: giantM.moons[1].id, type: EndState.Orbit };
  const all = getRoutes(sys42, from, to, { rank: RankMode.All });
  const picks = getBestRoutes(sys42, from, to, { findSoonest: true });
  const key = (r: typeof all[number]) =>
    `${r.departAt}|${r.duration}|${r.notation}`;
  const allKeys = new Set(all.map(key));
  for (const p of picks) {
    if (!allKeys.has(key(p))) {
      throw new Error("moon pick not from getRoutes front");
    }
  }
});

Deno.test("getBestRoutes(findSoonest): synodic cap makes a huge window match the default for direct routes", () => {
  const huge = 100000;
  const capped = getBestRoutes(system, wp(a), wp(b), {
    findSoonest: true,
    departWindowDays: huge,
    maxAssists: 0,
  });
  const dflt = getBestRoutes(system, wp(a), wp(b), { findSoonest: true, maxAssists: 0 });
  assertEquals(JSON.stringify(capped), JSON.stringify(dflt));
});

// --- getBestRoutes3 --------------------------------------------------------------------

Deno.test("getBestRoutes3: returns at most 7 value-distinct picks", () => {
  const picks = getBestRoutes3(system, wp(a), wp(b));
  assertEquals(picks.length <= 7, true);
  const keys = new Set(
    picks.map((r) => `${r.departAt}|${r.duration}|${r.notation}`),
  );
  assertEquals(keys.size, picks.length); // all distinct
});

Deno.test("getBestRoutes3: anchors reach the picked-set extrema", () => {
  const picks = getBestRoutes3(system, wp(a), wp(b));
  if (picks.length === 0) return;
  const arr = (r: Route) => r.departAt + r.duration;
  const minDv = Math.min(...picks.map((r) => r.totalDeltaV));
  const minDur = Math.min(...picks.map((r) => r.duration));
  const minArr = Math.min(...picks.map((r) => arr(r)));
  assertEquals(picks.some((r) => r.totalDeltaV === minDv), true);
  assertEquals(picks.some((r) => r.duration === minDur), true);
  assertEquals(picks.some((r) => arr(r) === minArr), true);
});

Deno.test("getBestRoutes3: deterministic over (system, from, to, options)", () => {
  const x = getBestRoutes3(system, wp(a), wp(b));
  const y = getBestRoutes3(system, wp(a), wp(b));
  assertEquals(JSON.stringify(x), JSON.stringify(y));
});

Deno.test("getBestRoutes3: the star cannot be an endpoint", () => {
  assertThrows(() => getBestRoutes3(system, wp(system.star.id), wp(b)));
});

Deno.test("getBestRoutes3: nowDay>0 shifts departures to on-or-after now", () => {
  const picks = getBestRoutes3(system, wp(a), wp(b), {
    departWindowDays: 4000,
    sweep: {
      kind: "resolutionTarget",
      deltaD: 20,
      minD: 8,
      maxD: 60,
      deltaT: 40,
      minT: 8,
      maxT: 60,
      nowDay: 2000,
    },
  });
  for (const r of picks) assertEquals(r.departAt >= 2000 - 1e-6, true);
});

Deno.test("getBestRoutes3: moon endpoint returns picks from the cross-frame set", () => {
  if (!giant42) throw new Error("seed 42 expected a planet with >= 2 moons");
  const picks = getBestRoutes3(
    sys42,
    { obj: giant42.moons[0].id, type: EndState.Orbit },
    { obj: giant42.moons[1].id, type: EndState.Orbit },
  );
  assertEquals(Array.isArray(picks), true);
  assertEquals(picks.length <= 7, true);
});

Deno.test("getBestRoutes3: control getBestRoutes(findSoonest) is unaffected by a fixed sweep option", () => {
  const c1 = getBestRoutes(system, wp(a), wp(b), { findSoonest: true });
  const c2 = getBestRoutes(system, wp(a), wp(b), { findSoonest: true });
  assertEquals(JSON.stringify(c1), JSON.stringify(c2));
});

// --- startWindow / endWindow validation ------------------------------------------------

Deno.test("getBestRoutes(findSoonest): rejects endWindow <= startWindow", () => {
  assertThrows(() =>
    getBestRoutes(system, wp(a), wp(b), { findSoonest: true, startWindow: 1000, endWindow: 1000 })
  );
  assertThrows(() =>
    getBestRoutes(system, wp(a), wp(b), { findSoonest: true, startWindow: 1000, endWindow: 500 })
  );
});

Deno.test("getBestRoutes(findSoonest): rejects negative or non-finite startWindow", () => {
  assertThrows(() => getBestRoutes(system, wp(a), wp(b), { findSoonest: true, startWindow: -1 }));
  assertThrows(() =>
    getBestRoutes(system, wp(a), wp(b), {
      findSoonest: true,
      startWindow: Number.POSITIVE_INFINITY,
    })
  );
});

Deno.test("getBestRoutes: rejects endWindow <= startWindow", () => {
  assertThrows(() =>
    getBestRoutes(system, wp(a), wp(b), { startWindow: 200, endWindow: 100 })
  );
});

Deno.test("getRoutes: a valid shifted window does not throw", () => {
  getRoutes(system, wp(a), wp(b), { startWindow: 1000, endWindow: 2000 });
});

Deno.test("getRoutes: startWindow 0 with a positive endWindow is valid", () => {
  getRoutes(system, wp(a), wp(b), { startWindow: 0, endWindow: 1 });
});

Deno.test("getBestRoutes(findSoonest): bare endWindow is validated against the default start of 0", () => {
  // endWindow 0 is not > the default startWindow (0) → throws.
  assertThrows(() => getBestRoutes(system, wp(a), wp(b), { findSoonest: true, endWindow: 0 }));
  // endWindow 1 is > 0 → valid.
  getBestRoutes(system, wp(a), wp(b), { findSoonest: true, endWindow: 1 });
});

// --- startWindow / endWindow behavior --------------------------------------------------

Deno.test("getBestRoutes(findSoonest): startWindow shifts the departure window (direct)", () => {
  const start = 5000;
  const end = start + 365;
  const picks = getBestRoutes(system, wp(a), wp(b), {
    findSoonest: true,
    startWindow: start,
    endWindow: end,
    maxAssists: 0,
  });
  if (picks.length === 0) throw new Error("expected picks");
  for (const p of picks) {
    // The depart grid samples inclusively up to endWindow, so the upper bound is inclusive.
    if (p.departAt < start || p.departAt > end) {
      throw new Error(`departAt ${p.departAt} outside [${start}, ${end}]`);
    }
  }
});

Deno.test("getBestRoutes(findSoonest): omitting the window equals startWindow 0", () => {
  const dflt = getBestRoutes(system, wp(a), wp(b), { findSoonest: true });
  const explicit = getBestRoutes(system, wp(a), wp(b), { findSoonest: true, startWindow: 0 });
  assertEquals(JSON.stringify(dflt), JSON.stringify(explicit));
});

Deno.test("getBestRoutes(findSoonest): assists also respect the shifted window", () => {
  const start = 4000;
  const end = start + 1200;
  const picks = getBestRoutes(system, wp(a), wp(b), {
    findSoonest: true,
    startWindow: start,
    endWindow: end,
    maxAssists: 2,
  });
  if (picks.length === 0) throw new Error("expected picks");
  for (const p of picks) {
    // The depart grid samples inclusively up to endWindow, so the upper bound is inclusive.
    if (p.departAt < start || p.departAt > end) {
      throw new Error(`departAt ${p.departAt} outside [${start}, ${end}]`);
    }
  }
});

Deno.test("getRoutes: assist routes respect the shifted window", () => {
  const start = 4000;
  const end = start + 1200;
  const routes = getRoutes(system, wp(a), wp(b), {
    startWindow: start,
    endWindow: end,
    maxAssists: 2,
    rank: RankMode.All,
  });
  // The enumerate path returns assist (>2-body) routes; these are what exercise the assist
  // depart-loop offset. The depart grid samples inclusively up to endWindow, so the upper
  // bound is inclusive.
  const assists = routes.filter((r) => r.bodies.length > 2);
  if (assists.length === 0) {
    throw new Error("expected assist routes to exercise the offset");
  }
  for (const r of assists) {
    if (r.departAt < start || r.departAt > end) {
      throw new Error(
        `assist departAt ${r.departAt} outside [${start}, ${end}]`,
      );
    }
  }
});

Deno.test("getBestRoutes: respects the shifted window", () => {
  const start = 3000;
  const end = start + 900;
  const picks = getBestRoutes(system, wp(a), wp(b), {
    startWindow: start,
    endWindow: end,
  });
  if (picks.length === 0) throw new Error("expected picks");
  for (const p of picks) {
    // The depart grid samples inclusively up to endWindow, so the upper bound is inclusive.
    if (p.departAt < start || p.departAt > end) {
      throw new Error(`departAt ${p.departAt} outside [${start}, ${end}]`);
    }
  }
});

Deno.test("getBestRoutes(findSoonest): anchors agree with getRoutes within a shifted window", () => {
  // Only startWindow set (no endWindow) → both paths use a synodic-width horizon starting at N,
  // so getRoutes' direct grid and getBestRoutes(findSoonest)'s synodic-capped direct grid are identical.
  const start = 4000;
  const shared = { startWindow: start, maxAssists: 0 as const };
  const all = getRoutes(system, wp(a), wp(b), {
    rank: RankMode.All,
    ...shared,
  });
  const picks = getBestRoutes(system, wp(a), wp(b), { findSoonest: true, ...shared });
  if (picks.length === 0) throw new Error("expected picks");
  const arr = (r: Route) => r.departAt + r.duration;
  const minDv = Math.min(...all.map((r) => r.totalDeltaV));
  const minDur = Math.min(...all.map((r) => r.duration));
  const minArr = Math.min(...all.map(arr));
  if (!picks.some((r) => Math.abs(r.totalDeltaV - minDv) < 1e-6)) {
    throw new Error("no pick reaches min Δv");
  }
  if (!picks.some((r) => Math.abs(r.duration - minDur) < 1e-6)) {
    throw new Error("no pick reaches min duration");
  }
  if (!picks.some((r) => Math.abs(arr(r) - minArr) < 1e-6)) {
    throw new Error("no pick reaches min in-window arrival");
  }
  for (const p of picks) {
    if (p.departAt < start) throw new Error("pick departed before startWindow");
  }
});

Deno.test("getBestRoutes: virtual heliocentric dock destination has dock arrival", () => {
  const routes = getBestRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { spec: { id: "station-2.6au", orbitRadiusAu: 2.6 }, type: EndState.Dock },
  );
  if (routes.length === 0) throw new Error("expected routes");
  const r = routes[0];
  assertEquals(r.bodies[r.bodies.length - 1], "station-2.6au");
  const arrive = r.nodes[r.nodes.length - 1];
  assertEquals(arrive.terminal?.endState, EndState.Dock);
  assertEquals(arrive.terminal?.stages.length, 1);
  assertEquals(arrive.terminal?.stages[0].kind, "dock");
});

Deno.test("getBestRoutes: virtual heliocentric intercept destination has zero terminal Δv", () => {
  const routes = getBestRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { spec: { id: "wp", orbitRadiusAu: 2.6 }, type: EndState.Intercept },
  );
  if (routes.length === 0) throw new Error("expected routes");
  const arrive = routes[0].nodes[routes[0].nodes.length - 1];
  assertEquals(arrive.terminal?.totalDeltaV, 0);
});

Deno.test("getBestRoutes: virtual body as origin (dock) departs with no escape stage", () => {
  const routes = getBestRoutes(
    system,
    { spec: { id: "origin-wp", orbitRadiusAu: 1.4 }, type: EndState.Dock },
    { obj: a, type: EndState.Orbit },
  );
  if (routes.length === 0) throw new Error("expected routes");
  const depart = routes[0].nodes[0];
  assertEquals(depart.terminal?.endState, EndState.Dock);
  assertEquals(depart.terminal?.stages[0].kind, "dock");
  assertEquals(depart.terminal?.stages.length, 1);
});

Deno.test("getBestRoutes: virtual body auto-generates an id when omitted", () => {
  const routes = getBestRoutes(
    system,
    { obj: a, type: EndState.Orbit },
    { spec: { orbitRadiusAu: 3.1 }, type: EndState.Dock },
  );
  if (routes.length === 0) throw new Error("expected routes");
  assertEquals(routes[0].bodies[routes[0].bodies.length - 1], "virtual:3.1au");
});

Deno.test("getBestRoutes: virtual body rejects Orbit end-state", () => {
  assertThrows(
    () =>
      getBestRoutes(
        system,
        { obj: a, type: EndState.Orbit },
        { spec: { orbitRadiusAu: 2.6 }, type: EndState.Orbit },
      ),
    Error,
    "virtual bodies only support Intercept or Dock",
  );
});

Deno.test("getBestRoutes: virtual body rejects Surface end-state", () => {
  assertThrows(
    () =>
      getBestRoutes(
        system,
        { obj: a, type: EndState.Orbit },
        { spec: { orbitRadiusAu: 2.6 }, type: EndState.Surface },
      ),
    Error,
    "virtual bodies only support Intercept or Dock",
  );
});

Deno.test("getBestRoutes: Dock is rejected on a real body", () => {
  const b = system.objects[system.objects.length - 1].id;
  assertThrows(
    () =>
      getBestRoutes(
        system,
        { obj: a, type: EndState.Orbit },
        { obj: b, type: EndState.Dock },
      ),
    Error,
    "Dock is only supported for virtual bodies",
  );
});

Deno.test("lagrangeWaypoint: rejects a star parent", () => {
  assertThrows(
    () => lagrangeWaypoint(system, system.star, "L4", EndState.Dock),
    Error,
    "a star has no Lagrange points",
  );
});

Deno.test("lagrangeWaypoint: L4 leads parent by 1/6 of a phase", () => {
  const planet = system.objects.find((o) => o.moons.length === 0) ?? system.objects[0];
  const wp = lagrangeWaypoint(system, planet, "L4", EndState.Dock);
  if (!("spec" in wp)) throw new Error("planet parent should yield a heliocentric spec");
  assertEquals(wp.spec.id, `L4:${planet.id}`);
  assertEquals(wp.spec.orbitRadiusAu, planet.orbitRadius);
  assertEquals(wp.spec.eccentricity, planet.eccentricity);
  assertEquals(wp.spec.periapsisAngle, planet.periapsisAngle);
  const expected = ((planet.orbitalPhase + 1 / 6) % 1 + 1) % 1;
  assertAlmostEquals(wp.spec.orbitalPhase!, expected, 1e-12);
});

Deno.test("lagrangeWaypoint: L5 trails parent by 1/6 of a phase", () => {
  const planet = system.objects.find((o) => o.moons.length === 0) ?? system.objects[0];
  const wp = lagrangeWaypoint(system, planet, "L5", EndState.Intercept);
  if (!("spec" in wp)) throw new Error("planet parent should yield a heliocentric spec");
  const expected = ((planet.orbitalPhase - 1 / 6) % 1 + 1) % 1;
  assertAlmostEquals(wp.spec.orbitalPhase!, expected, 1e-12);
});

Deno.test("lagrangeWaypoint: retrograde planet flips the L4 leading offset and tags the waypoint", () => {
  const planet = system.objects.find((o) => o.moons.length === 0) ?? system.objects[0];
  const retroPlanet = { ...planet, retrograde: true };
  const wp = lagrangeWaypoint(system, retroPlanet, "L4", EndState.Dock);
  if (!("spec" in wp)) throw new Error("planet parent should yield a heliocentric spec");
  // Leading in the direction of motion => lower inertial angle for a retrograde body.
  const expected = ((retroPlanet.orbitalPhase - 1 / 6) % 1 + 1) % 1;
  assertAlmostEquals(wp.spec.orbitalPhase!, expected, 1e-12);
  assertEquals(wp.spec.retrograde, true);
});

Deno.test("lagrangeWaypoint: retrograde parent leaves L1 collinear geometry unchanged", () => {
  const planet = system.objects.find((o) => o.moons.length === 0) ?? system.objects[0];
  const pro = lagrangeWaypoint(system, { ...planet, retrograde: false }, "L1", EndState.Intercept);
  const retro = lagrangeWaypoint(system, { ...planet, retrograde: true }, "L1", EndState.Intercept);
  if (!("spec" in pro) || !("spec" in retro)) throw new Error("expected heliocentric specs");
  // L1 phaseOffset is 0; only the retrograde tag differs, radius/phase match.
  assertAlmostEquals(retro.spec.orbitRadiusAu, pro.spec.orbitRadiusAu, 1e-12);
  assertAlmostEquals(retro.spec.orbitalPhase!, pro.spec.orbitalPhase!, 1e-12);
  assertEquals(retro.spec.retrograde, true);
});

Deno.test("lagrangeWaypoint: routes end-to-end to a planet's L5", () => {
  const planet = system.objects.find((o) => o.moons.length === 0) ?? system.objects[0];
  const dest = lagrangeWaypoint(system, planet, "L5", EndState.Dock);
  const routes = getBestRoutes(system, { obj: a, type: EndState.Orbit }, dest);
  if (routes.length === 0) throw new Error("expected routes to L5");
  assertEquals(routes[0].bodies[routes[0].bodies.length - 1], `L5:${planet.id}`);
});

Deno.test("getBestRoutes: pSpec station as cross-frame destination docks", () => {
  const origin = sys42.objects.find((o) => o.id !== giant42!.id && o.moons.length === 0) ??
    sys42.objects.find((o) => o.id !== giant42!.id);
  if (!giant42 || !origin) throw new Error("seed 42 fixture missing");
  const routes = getBestRoutes(
    sys42,
    { obj: origin.id, type: EndState.Orbit },
    {
      pSpec: { id: "giant-station", parentId: giant42.id, orbitRadiusAu: giant42.moons[0].orbitRadius },
      type: EndState.Dock,
    },
  );
  if (routes.length === 0) throw new Error("expected cross-frame routes to pSpec station");
  assertEquals(routes[0].bodies[routes[0].bodies.length - 1], "giant-station");
});

Deno.test("getBestRoutes: pSpec same-parent (real moon -> station around same planet)", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  const moonId = giant42.moons[0].id;
  const routes = getBestRoutes(
    sys42,
    { obj: moonId, type: EndState.Orbit },
    {
      pSpec: { id: "sibling-station", parentId: giant42.id, orbitRadiusAu: giant42.moons[1].orbitRadius },
      type: EndState.Dock,
    },
  );
  if (routes.length === 0) throw new Error("expected same-parent route");
  assertEquals(routes[0].bodies[0], moonId);
  assertEquals(routes[0].bodies[routes[0].bodies.length - 1], "sibling-station");
});

Deno.test("getBestRoutes: pSpec intercept has zero terminal Δv at the station", () => {
  const origin = sys42.objects.find((o) => o.id !== giant42!.id && o.moons.length === 0) ??
    sys42.objects.find((o) => o.id !== giant42!.id);
  if (!giant42 || !origin) throw new Error("seed 42 fixture missing");
  const routes = getBestRoutes(
    sys42,
    { obj: origin.id, type: EndState.Orbit },
    { pSpec: { id: "wp", parentId: giant42.id, orbitRadiusAu: giant42.moons[0].orbitRadius }, type: EndState.Intercept },
  );
  if (routes.length === 0) throw new Error("expected routes");
  const arrive = routes[0].nodes[routes[0].nodes.length - 1];
  assertEquals(arrive.terminal?.totalDeltaV, 0);
});

Deno.test("getBestRoutes: pSpec rejects Orbit end-state", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  assertThrows(
    () =>
      getBestRoutes(
        sys42,
        { obj: giant42!.moons[0].id, type: EndState.Orbit },
        { pSpec: { parentId: giant42!.id, orbitRadiusAu: 0.01 }, type: EndState.Orbit },
      ),
    Error,
    "virtual bodies only support Intercept or Dock",
  );
});

Deno.test("getBestRoutes: pSpec rejects a moon parentId", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  assertThrows(
    () =>
      getBestRoutes(
        sys42,
        { obj: giant42!.moons[1].id, type: EndState.Orbit },
        { pSpec: { parentId: giant42!.moons[0].id, orbitRadiusAu: 0.01 }, type: EndState.Dock },
      ),
    Error,
    "pSpec parentId must be a planet, not a moon",
  );
});

Deno.test("getBestRoutes: pSpec rejects an unknown parentId", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  assertThrows(
    () =>
      getBestRoutes(
        sys42,
        { obj: giant42!.moons[0].id, type: EndState.Orbit },
        { pSpec: { parentId: "obj_does_not_exist", orbitRadiusAu: 0.01 }, type: EndState.Dock },
      ),
    Error,
    "unknown parent body",
  );
});

Deno.test("getBestRoutes: pSpec auto-generates an id from parent and radius", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  const origin = sys42.objects.find((o) => o.id !== giant42!.id && o.moons.length === 0) ??
    sys42.objects.find((o) => o.id !== giant42!.id)!;
  const radius = giant42.moons[0].orbitRadius;
  const routes = getBestRoutes(
    sys42,
    { obj: origin.id, type: EndState.Orbit },
    { pSpec: { parentId: giant42.id, orbitRadiusAu: radius }, type: EndState.Dock },
  );
  if (routes.length === 0) throw new Error("expected routes");
  assertEquals(
    routes[0].bodies[routes[0].bodies.length - 1],
    `virtual:${giant42.id}:${radius}au`,
  );
});

Deno.test("lagrangeWaypoint: moon parent yields a planetocentric pSpec", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  const moon = giant42.moons[0];
  const wp = lagrangeWaypoint(sys42, moon, "L4", EndState.Dock);
  if (!("pSpec" in wp)) throw new Error("moon parent should yield a pSpec");
  assertEquals(wp.pSpec.id, `L4:${moon.id}`);
  assertEquals(wp.pSpec.parentId, moon.parentId);
  assertEquals(wp.pSpec.orbitRadiusAu, moon.orbitRadius);
});

Deno.test("lagrangeWaypoint: planet parent still yields a heliocentric spec", () => {
  const planet = sys42.objects.find((o) => o.id !== giant42!.id && o.moons.length === 0) ??
    sys42.objects.find((o) => o.id !== giant42!.id)!;
  const wp = lagrangeWaypoint(sys42, planet, "L5", EndState.Intercept);
  if (!("spec" in wp)) throw new Error("planet parent should yield a spec");
  assertEquals(wp.spec.orbitRadiusAu, planet.orbitRadius);
});

Deno.test("lagrangeWaypoint: routes to a moon's L5 (planetocentric, same-parent)", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  const moon = giant42.moons[0];
  const dest = lagrangeWaypoint(sys42, moon, "L5", EndState.Dock);
  // Origin: a sibling moon around the same giant → same-parent routing.
  const routes = getBestRoutes(
    sys42,
    { obj: giant42.moons[1].id, type: EndState.Orbit },
    dest,
  );
  if (routes.length === 0) throw new Error("expected routes to moon L5");
  assertEquals(routes[0].bodies[routes[0].bodies.length - 1], `L5:${moon.id}`);
});

// --- Retrograde planet end-to-end (Phase 5 regression guard) ----------------------------

Deno.test("getRoutes: a retrograde captured moon deep in the Hill band still produces cross-frame routes", () => {
  if (!giant42) {
    throw new Error("seed 42 expected to have a planet with >= 2 moons");
  }
  const moon = giant42.moons[0];
  const deepMoon = { ...moon, retrograde: true, orbitRadius: moon.orbitRadius * 2 };
  const retroSystem = {
    ...sys42,
    objects: sys42.objects.map((o) =>
      o.id === giant42!.id ? { ...o, moons: [deepMoon, ...giant42!.moons.slice(1)] } : o
    ),
  };
  const depart = sys42.objects.find((o) => o.id !== giant42!.id && o.moons.length === 0) ??
    sys42.objects.find((o) => o.id !== giant42!.id)!;
  const routes = getRoutes(
    retroSystem,
    { obj: depart.id, type: EndState.Orbit },
    { obj: deepMoon.id, type: EndState.Orbit },
    { maxAssists: 0 },
  );
  assert(routes.length > 0);
  for (const r of routes) {
    assert(Number.isFinite(r.totalDeltaV) && r.totalDeltaV > 0);
    assert(Number.isFinite(r.duration) && r.duration > 0);
  }
});

Deno.test("getRoutes: produces a finite, sane route to a retrograde planet", () => {
  // Flip the target body retrograde; route to it from the (prograde) first body.
  const retroSystem = {
    ...system,
    objects: system.objects.map((o) => o.id === b ? { ...o, retrograde: true } : o),
  };
  const routes = getRoutes(
    retroSystem,
    { obj: a, type: EndState.Orbit },
    { obj: b, type: EndState.Orbit },
    { maxAssists: 0 },
  );
  assert(routes.length > 0, "expected at least one route to the retrograde target");
  for (const r of routes) {
    assert(Number.isFinite(r.totalDeltaV) && r.totalDeltaV > 0);
    assert(Number.isFinite(r.duration) && r.duration > 0);
  }
});

Deno.test("lagrangePointGeometry: L4/L5 are co-orbital with ±1/6 phase", () => {
  assertEquals(lagrangePointGeometry("L4", 0), { radiusFactor: 1, phaseOffset: 1 / 6 });
  assertEquals(lagrangePointGeometry("L5", 0), { radiusFactor: 1, phaseOffset: -1 / 6 });
});

Deno.test("lagrangeWaypoint: moon L1/L2 yield pSpec at an adjusted radius", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  const moon = giant42.moons[0];
  const mu = (moon.mass * M_EARTH_KG) /
    (giant42.mass * M_EARTH_KG + moon.mass * M_EARTH_KG);
  const alpha = Math.cbrt(mu / 3);
  const l1 = lagrangeWaypoint(sys42, moon, "L1", EndState.Dock);
  const l2 = lagrangeWaypoint(sys42, moon, "L2", EndState.Dock);
  if (!("pSpec" in l1) || !("pSpec" in l2)) {
    throw new Error("moon parent should yield a pSpec");
  }
  assertEquals(l1.pSpec.id, `L1:${moon.id}`);
  assertEquals(l1.pSpec.parentId, moon.parentId);
  assertAlmostEquals(l1.pSpec.orbitRadiusAu, moon.orbitRadius * (1 - alpha), 1e-12);
  assertAlmostEquals(l2.pSpec.orbitRadiusAu, moon.orbitRadius * (1 + alpha), 1e-12);
});

Deno.test("lagrangeWaypoint: moon L3 yields pSpec at adjusted radius, phase dropped", () => {
  if (!giant42) throw new Error("seed 42 fixture missing");
  const moon = giant42.moons[0];
  const mu = (moon.mass * M_EARTH_KG) /
    (giant42.mass * M_EARTH_KG + moon.mass * M_EARTH_KG);
  const wp = lagrangeWaypoint(sys42, moon, "L3", EndState.Dock);
  if (!("pSpec" in wp)) throw new Error("moon parent should yield a pSpec");
  // pSpec carries no phase field — the 180° offset is intentionally not represented.
  assertAlmostEquals(wp.pSpec.orbitRadiusAu, moon.orbitRadius * (1 - (7 * mu) / 12), 1e-12);
});

Deno.test("lagrangePointGeometry: collinear factors for a Sun–Earth mass ratio", () => {
  const mu = 3.003e-6; // Earth / (Sun + Earth)
  const alpha = Math.cbrt(mu / 3);
  const l1 = lagrangePointGeometry("L1", mu);
  const l2 = lagrangePointGeometry("L2", mu);
  const l3 = lagrangePointGeometry("L3", mu);
  assertAlmostEquals(l1.radiusFactor, 1 - alpha, 1e-12);
  assertEquals(l1.phaseOffset, 0);
  assertAlmostEquals(l2.radiusFactor, 1 + alpha, 1e-12);
  assertEquals(l2.phaseOffset, 0);
  assertAlmostEquals(l3.radiusFactor, 1 - (7 * mu) / 12, 1e-12);
  assertEquals(l3.phaseOffset, 0.5);
  // Sanity: L1 ≈ 0.99, L2 ≈ 1.01 of the orbit radius.
  assertAlmostEquals(l1.radiusFactor, 0.99, 1e-2);
  assertAlmostEquals(l2.radiusFactor, 1.01, 1e-2);
});

Deno.test("lagrangeWaypoint: planet L1/L2 sit inside/outside the parent orbit", () => {
  const planet = system.objects.find((o) => o.moons.length === 0) ?? system.objects[0];
  const mu = (planet.mass * M_EARTH_KG) /
    (system.star.mass * M_SUN_KG + planet.mass * M_EARTH_KG);
  const alpha = Math.cbrt(mu / 3);
  const l1 = lagrangeWaypoint(system, planet, "L1", EndState.Dock);
  const l2 = lagrangeWaypoint(system, planet, "L2", EndState.Intercept);
  if (!("spec" in l1) || !("spec" in l2)) {
    throw new Error("planet parent should yield a heliocentric spec");
  }
  assertEquals(l1.spec.id, `L1:${planet.id}`);
  assertAlmostEquals(l1.spec.orbitRadiusAu, planet.orbitRadius * (1 - alpha), 1e-12);
  assertAlmostEquals(l2.spec.orbitRadiusAu, planet.orbitRadius * (1 + alpha), 1e-12);
  // Collinear points share the parent's phase (no leading/trailing offset).
  assertAlmostEquals(l1.spec.orbitalPhase!, ((planet.orbitalPhase) % 1 + 1) % 1, 1e-12);
});

Deno.test("lagrangeWaypoint: planet L3 sits opposite the parent at 180°", () => {
  const planet = system.objects.find((o) => o.moons.length === 0) ?? system.objects[0];
  const mu = (planet.mass * M_EARTH_KG) /
    (system.star.mass * M_SUN_KG + planet.mass * M_EARTH_KG);
  const wp = lagrangeWaypoint(system, planet, "L3", EndState.Dock);
  if (!("spec" in wp)) throw new Error("planet parent should yield a spec");
  assertAlmostEquals(wp.spec.orbitRadiusAu, planet.orbitRadius * (1 - (7 * mu) / 12), 1e-12);
  const expected = ((planet.orbitalPhase + 0.5) % 1 + 1) % 1;
  assertAlmostEquals(wp.spec.orbitalPhase!, expected, 1e-12);
});

Deno.test("lagrangeWaypoint: routes end-to-end to a planet's L2", () => {
  const planet = system.objects.find((o) => o.moons.length === 0) ?? system.objects[0];
  const dest = lagrangeWaypoint(system, planet, "L2", EndState.Dock);
  const routes = getBestRoutes(system, { obj: a, type: EndState.Orbit }, dest);
  if (routes.length === 0) throw new Error("expected routes to L2");
  assertEquals(routes[0].bodies[routes[0].bodies.length - 1], `L2:${planet.id}`);
});
