import { assertAlmostEquals, assertEquals } from "@std/assert";
import { buildRouteViewModel } from "./route-view-model.ts";
import { buildViewModel } from "./view-model.ts";
import { generateSolarSystem } from "../core/generator.ts";
import { getBestRoutes } from "../travel/index.ts";
import { EndState } from "../travel/types.ts";

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
