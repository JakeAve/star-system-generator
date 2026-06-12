import { assertAlmostEquals, assertEquals } from "@std/assert";
import { findCrossFrameRoutes, findDirectRoutes } from "./search.ts";
import type { CrossFrameEndpoint } from "./legs.ts";
import { muBody, muStar, R_EARTH_M } from "./units.ts";
import { EndState, RankMode, RouteNodeKind } from "./types.ts";

const MU = muStar(1);

const fromBody = {
  id: "p1",
  elements: {
    orbitRadiusAu: 1,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0,
  },
  endpoint: { mu: 3.986e14, radiusM: 6.371e6 },
};
const toBody = {
  id: "p2",
  elements: {
    orbitRadiusAu: 1.524,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0.5,
  },
  endpoint: { mu: 4.28e13, radiusM: 3.39e6 },
};

Deno.test("findDirectRoutes: returns a self-consistent orbit→orbit route", () => {
  const routes = findDirectRoutes(
    fromBody,
    toBody,
    EndState.Orbit,
    EndState.Orbit,
    MU,
    "star",
    {
      rank: RankMode.Pareto,
    },
  );
  if (routes.length === 0) throw new Error("expected at least one route");
  const r = routes[0];
  assertEquals(r.bodies, ["p1", "p2"]);
  assertEquals(r.legs.length, 1);
  assertEquals(r.legs[0].centralBodyId, "star");
  assertEquals(r.nodes.length, 2);
  const sumTerminals = r.nodes[0].terminal!.totalDeltaV +
    r.nodes[1].terminal!.totalDeltaV;
  assertAlmostEquals(r.totalDeltaV, sumTerminals, 1e-9);
  assertAlmostEquals(r.duration, r.nodes[1].time - r.departAt, 1e-9);
});

Deno.test("findDirectRoutes: intercept destination is cheaper than orbit", () => {
  const orbit = findDirectRoutes(
    fromBody,
    toBody,
    EndState.Orbit,
    EndState.Orbit,
    MU,
    "star",
    {},
  )[0];
  const intercept = findDirectRoutes(
    fromBody,
    toBody,
    EndState.Orbit,
    EndState.Intercept,
    MU,
    "star",
    {},
  )[0];
  if (!(intercept.totalDeltaV < orbit.totalDeltaV)) {
    throw new Error("intercept should cost less than orbit capture");
  }
});

Deno.test("findDirectRoutes: pareto set is Δv-sorted and non-dominated", () => {
  const routes = findDirectRoutes(
    fromBody,
    toBody,
    EndState.Orbit,
    EndState.Orbit,
    MU,
    "star",
    {
      rank: RankMode.Pareto,
    },
  );
  for (let i = 1; i < routes.length; i++) {
    if (routes[i].totalDeltaV < routes[i - 1].totalDeltaV) {
      throw new Error("not Δv-sorted");
    }
    if (routes[i].duration >= routes[i - 1].duration) {
      throw new Error("not non-dominated");
    }
  }
});

Deno.test("findDirectRoutes: planetocentric grid is scaled to the central mass (finds the Hohmann-energy transfer)", () => {
  const muPlanet = muBody(300); // ~gas-giant central body
  const moonA = {
    id: "mA",
    elements: {
      orbitRadiusAu: 0.10,
      eccentricity: 0,
      periapsisAngle: 0,
      orbitalPhase: 0,
    },
    endpoint: { mu: muBody(0.02), radiusM: 1.7e6 },
  };
  const moonB = {
    id: "mB",
    elements: {
      orbitRadiusAu: 0.16,
      eccentricity: 0,
      periapsisAngle: 0,
      orbitalPhase: 0.4,
    },
    endpoint: { mu: muBody(0.02), radiusM: 1.7e6 },
  };
  const routes = findDirectRoutes(
    moonA,
    moonB,
    EndState.Orbit,
    EndState.Orbit,
    muPlanet,
    "planet",
    {},
  );
  if (routes.length === 0) throw new Error("expected routes");
  assertEquals(routes[0].legs[0].centralBodyId, "planet");
  const a = routes[0].legs[0].transfer.a;
  if (!(a > 0.09 && a < 0.17)) {
    throw new Error(
      `leg semi-major axis ${a} AU is not Hohmann-scale; grid likely mis-scaled`,
    );
  }
});

Deno.test("findCrossFrameRoutes: planet → moon produces Transit-bearing routes", () => {
  const mu = muStar(1); // 1 solar mass
  const from: CrossFrameEndpoint = {
    id: "P",
    endState: EndState.Orbit,
    body: { mu: muBody(1), radiusM: R_EARTH_M },
    anchorId: "P",
    anchorElements: {
      orbitRadiusAu: 1,
      eccentricity: 0,
      periapsisAngle: 0,
      orbitalPhase: 0,
    },
  };
  const to: CrossFrameEndpoint = {
    id: "M",
    endState: EndState.Orbit,
    body: { mu: muBody(0.02), radiusM: R_EARTH_M * 0.3 },
    anchorId: "G",
    anchorElements: {
      orbitRadiusAu: 5,
      eccentricity: 0,
      periapsisAngle: 0,
      orbitalPhase: 1.2,
    },
    parent: {
      body: { mu: muBody(300), radiusM: R_EARTH_M * 11 },
      moonOrbitRadiusM: 1.5e9,
    },
  };
  const routes = findCrossFrameRoutes(from, to, "star", mu, {
    rank: RankMode.All,
  });
  if (routes.length === 0) throw new Error("expected routes");
  for (const r of routes) {
    if (r.bodies.length !== 3) throw new Error("expected [P, G, M]");
    if (r.nodes[1].kind !== RouteNodeKind.Transit) {
      throw new Error("middle node Transit");
    }
    if (!(r.departAt >= 0)) throw new Error("departAt must be non-negative");
    if (!(r.totalDeltaV > 0)) throw new Error("positive Δv");
  }
});
