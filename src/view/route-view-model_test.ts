import { assertAlmostEquals, assertEquals } from "@std/assert";
import { buildRouteViewModel, hitTestRoutes, chevronsAlong} from "./route-view-model.ts";
import type { RouteView } from "./route-view-model.ts";
import { buildViewModel } from "./view-model.ts";
import { generateSolarSystem } from "../core/generator.ts";
import { getBestRoutes } from "../travel/index.ts";
import { EndState, RouteNodeKind } from "../travel/types.ts";

function twoPlanetSystem() {
  // A deterministic seed that yields >= 2 planets; pick from the generator.
  return generateSolarSystem({ seed: 16 });
}

Deno.test("buildRouteViewModel produces leg polylines, nodes, and ghosts in world units", () => {
  const sys = twoPlanetSystem();
  const planets = sys.objects.filter((o) => o.type !== "asteroid" && o.moons !== undefined);
  if (planets.length < 2) throw new Error("fixture system needs >= 2 planets; pick another seed");
  const from = planets[0].id;
  const to = planets[1].id;
  const route = getBestRoutes(
    sys,
    { obj: from, type: EndState.Orbit },
    { obj: to, type: EndState.Orbit },
  )[0];
  if (!route) throw new Error("no route found for fixture pair");

  const view = buildRouteViewModel(sys, route);

  // One polyline per leg, each non-empty.
  assertEquals(view.legs.length, route.legs.length);
  for (const leg of view.legs) {
    if (leg.points.length < 2) throw new Error("leg polyline too short");
    for (const p of leg.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("non-finite point");
    }
  }

  // One node view per route node, positioned at the body's location at that node's time.
  assertEquals(view.nodes.length, route.nodes.length);
  const atDepart = buildViewModel(sys, route.nodes[0].time);
  const departBody = atDepart.find((b) => b.id === route.nodes[0].bodyId)!;
  assertAlmostEquals(view.nodes[0].x, departBody.position.x, 1e-6);
  assertAlmostEquals(view.nodes[0].y, departBody.position.y, 1e-6);

  // A heliocentric first leg starts at the depart node position (star fixed at origin).
  const firstLeg = view.legs[0];
  if (route.legs[0].centralBodyId === sys.star.id) {
    assertAlmostEquals(firstLeg.points[0].x, view.nodes[0].x, 1.0); // within ~1 world unit
    assertAlmostEquals(firstLeg.points[0].y, view.nodes[0].y, 1.0);
  }

  // Ghosts exist for the node bodies.
  if (view.ghosts.length === 0) throw new Error("expected ghost bodies");
});


Deno.test("buildRouteViewModel: id/color opts and enriched leg/node fields", () => {
  const sys = generateSolarSystem({ seed: 16 });
  const planets = sys.objects.filter((o) => o.type !== "asteroid" && o.moons !== undefined);
  const from = planets[0].id, to = planets[1].id;
  const route = getBestRoutes(
    sys,
    { obj: from, type: EndState.Orbit },
    { obj: to, type: EndState.Orbit },
  )[0];

  // Default id = notation, color undefined.
  const def = buildRouteViewModel(sys, route);
  assertEquals(def.id, route.notation);
  assertEquals(def.color, undefined);

  // Opts honored.
  const view = buildRouteViewModel(sys, route, { id: "fleet-A", color: "#ff3333" });
  assertEquals(view.id, "fleet-A");
  assertEquals(view.color, "#ff3333");

  // Leg view carries the source leg's descriptors.
  const leg0 = view.legs[0], src = route.legs[0];
  assertEquals(leg0.fromBodyId, src.fromBodyId);
  assertEquals(leg0.toBodyId, src.toBodyId);
  assertEquals(leg0.departTime, src.departTime);
  assertEquals(leg0.arriveTime, src.arriveTime);
  assertEquals(leg0.timeOfFlight, src.timeOfFlight);
  assertEquals(leg0.deltaV, src.deltaV);
  assertEquals(leg0.transfer.a, src.transfer.a);
  assertEquals(leg0.transfer.argPeriapsis, src.transfer.argPeriapsis);

  // Node view carries kind + optional vInfinity (undefined on plain depart/arrive is fine).
  const node0 = view.nodes[0], nsrc = route.nodes[0];
  assertEquals(node0.kind, nsrc.kind);
  assertEquals(node0.vInfinity, nsrc.vInfinity);
});

function fakeRoute(id: string, opts: {
  nodes?: { x: number; y: number }[];
  legPoints?: { x: number; y: number }[];
}): RouteView {
  return {
    id,
    legs: opts.legPoints
      ? [{
        centralBodyId: "star", fromBodyId: "a", toBodyId: "b",
        departTime: 0, arriveTime: 10, timeOfFlight: 10, deltaV: 1,
        transfer: { a: 1, e: 0, argPeriapsis: 0, nu1: 0, nu2: Math.PI },
        points: opts.legPoints,
      }]
      : [],
    nodes: (opts.nodes ?? []).map((p, i) => ({
      id: `n${i}`, kind: RouteNodeKind.Depart, x: p.x, y: p.y, time: 0, deltaV: 0,
    })),
    ghosts: [],
  };
}

Deno.test("hitTestRoutes: hits a node within radius", () => {
  const r = fakeRoute("R", { nodes: [{ x: 100, y: 100 }] });
  const hit = hitTestRoutes([r], 103, 99, 10);
  assertEquals(hit?.kind, "node");
  assertEquals(hit?.routeId, "R");
});

Deno.test("hitTestRoutes: hits a leg segment away from any node", () => {
  const r = fakeRoute("R", { legPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
  const hit = hitTestRoutes([r], 50, 4, 10);
  assertEquals(hit?.kind, "leg");
  assertEquals(hit?.routeId, "R");
});

Deno.test("hitTestRoutes: node beats leg at a shared endpoint", () => {
  const r = fakeRoute("R", { nodes: [{ x: 0, y: 0 }], legPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
  const hit = hitTestRoutes([r], 1, 0, 10);
  assertEquals(hit?.kind, "node");
});

Deno.test("hitTestRoutes: nearest route wins", () => {
  const a = fakeRoute("A", { nodes: [{ x: 0, y: 0 }] });
  const b = fakeRoute("B", { nodes: [{ x: 5, y: 0 }] });
  const hit = hitTestRoutes([a, b], 4, 0, 10);
  assertEquals(hit?.routeId, "B");
});

Deno.test("hitTestRoutes: a near leg beats a farther node on another route", () => {
  // Route A: a leg along y=0. Route B: a node off to the side, within radius but farther.
  const a = fakeRoute("A", { legPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
  const b = fakeRoute("B", { nodes: [{ x: 50, y: 9 }] });
  const hit = hitTestRoutes([a, b], 50, 2, 10); // leg dist 2 < node dist 7
  assertEquals(hit?.kind, "leg");
  assertEquals(hit?.routeId, "A");
});

Deno.test("hitTestRoutes: returns null outside radius", () => {
  const r = fakeRoute("R", { nodes: [{ x: 100, y: 100 }], legPoints: [{ x: 0, y: 0 }, { x: 50, y: 0 }] });
  assertEquals(hitTestRoutes([r], 500, 500, 10), null);
});

Deno.test("chevronsAlong: evenly spaced along a straight polyline, angle = travel direction", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const chevs = chevronsAlong(pts, 25, 0); // s = 0,25,50,75,100
  assertEquals(chevs.length, 5);
  assertEquals(chevs.map((c) => Math.round(c.x)), [0, 25, 50, 75, 100]);
  for (const c of chevs) assertAlmostEquals(c.angle, 0, 1e-9); // pointing +x toward end
});

Deno.test("chevronsAlong: phase shifts placements forward", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const chevs = chevronsAlong(pts, 25, 0.5); // s = 12.5, 37.5, 62.5, 87.5
  assertEquals(chevs.map((c) => c.x), [12.5, 37.5, 62.5, 87.5]);
});

Deno.test("chevronsAlong: angle follows the bend across segments", () => {
  // Right turn: east then north.
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
  const chevs = chevronsAlong(pts, 25, 0); // s=0,25 on seg1 (ang 0); s=75,100 clearly on seg2 (ang pi/2)
  assertAlmostEquals(chevs[0].angle, 0, 1e-9); // east leg
  assertAlmostEquals(chevs[3].angle, Math.PI / 2, 1e-9); // north leg (s=75, mid seg2)
});

Deno.test("chevronsAlong: degenerate input returns empty", () => {
  assertEquals(chevronsAlong([{ x: 0, y: 0 }], 25, 0), []);
  assertEquals(chevronsAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0, 0), []);
});
