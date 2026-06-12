import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  findCrossFrameRoutes,
  findDirectRoutes,
  findDoubleAssistRoutes,
  findSingleAssistRoutes,
  searchBest,
  utopiaDist,
} from "./search.ts";
import type { BodyRef, UtopiaBox } from "./search.ts";
import type { CrossFrameEndpoint } from "./legs.ts";
import { AU_M, DAY_S, muBody, muStar, R_EARTH_M } from "./units.ts";
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

Deno.test("utopiaDist: 2-axis (Δv, duration) box matches the legacy normalized distance", () => {
  const box: UtopiaBox = { dvMin: 10, dvMax: 20, durMin: 100, durMax: 300 };
  // A point at the utopia corner has distance 0; the opposite corner has distance √2.
  // arrival is absent from the box, so the arr argument must be ignored.
  assertAlmostEquals(utopiaDist(10, 100, 99999, box), 0, 1e-12);
  assertAlmostEquals(utopiaDist(20, 300, 0, box), Math.SQRT2, 1e-12);
  assertAlmostEquals(utopiaDist(15, 200, 12345, box), Math.hypot(0.5, 0.5), 1e-12);
});

Deno.test("utopiaDist: arrival axis participates only when the box carries arr ranges", () => {
  const box: UtopiaBox = { dvMin: 0, dvMax: 10, arrMin: 1000, arrMax: 2000 };
  // duration absent → ignored; arrival contributes.
  assertAlmostEquals(utopiaDist(0, 5e9, 1000, box), 0, 1e-12);
  assertAlmostEquals(utopiaDist(10, 0, 2000, box), Math.SQRT2, 1e-12);
});

Deno.test("utopiaDist: 3-axis triple box normalizes all three", () => {
  const box: UtopiaBox = {
    dvMin: 0, dvMax: 10, durMin: 0, durMax: 10, arrMin: 0, arrMax: 10,
  };
  assertAlmostEquals(utopiaDist(0, 0, 0, box), 0, 1e-12);
  assertAlmostEquals(utopiaDist(10, 10, 10, box), Math.sqrt(3), 1e-12);
});

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

// An inner planet, an outer planet, and a giant in between to swing past.
const inner: BodyRef = {
  id: "inner",
  elements: {
    orbitRadiusAu: 1,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0,
  },
  endpoint: { mu: muBody(1), radiusM: R_EARTH_M },
};
const outer: BodyRef = {
  id: "outer",
  elements: {
    orbitRadiusAu: 9.5,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0.3,
  },
  endpoint: { mu: muBody(95), radiusM: R_EARTH_M * 9 },
};
const giant: BodyRef = {
  id: "giant",
  elements: {
    orbitRadiusAu: 5.2,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0.6,
  },
  endpoint: { mu: muBody(318), radiusM: R_EARTH_M * 11 },
};

Deno.test("findSingleAssistRoutes: produces well-formed 3-body flyby routes", () => {
  const routes = findSingleAssistRoutes(
    inner,
    outer,
    EndState.Orbit,
    EndState.Orbit,
    [giant],
    MU,
    "star",
    { rank: RankMode.All },
  );
  if (routes.length === 0) {
    throw new Error("expected at least one assist route");
  }
  for (const r of routes) {
    assertEquals(r.bodies, ["inner", "giant", "outer"]);
    assertEquals(r.nodes.length, 3);
    assertEquals(r.legs.length, 2);
    assertEquals(r.nodes[1].kind, RouteNodeKind.Flyby);
    assertEquals(r.legs[0].centralBodyId, "star");
    assertEquals(r.legs[1].centralBodyId, "star");
    if (r.nodes[1].flyby === undefined) {
      throw new Error("flyby node must carry geometry");
    }
    if (!Number.isFinite(r.totalDeltaV)) throw new Error("Δv must be finite");
    for (let i = 1; i < r.nodes.length; i++) {
      if (!(r.nodes[i].time >= r.nodes[i - 1].time)) {
        throw new Error("node times must be monotonic");
      }
    }
  }
});

Deno.test("findSingleAssistRoutes: totalDeltaV sums both terminals and the flyby burn", () => {
  const routes = findSingleAssistRoutes(
    inner,
    outer,
    EndState.Orbit,
    EndState.Orbit,
    [giant],
    MU,
    "star",
    { rank: RankMode.All },
  );
  const r = routes[0];
  const expected = r.nodes[0].terminal!.totalDeltaV +
    r.nodes[1].deltaV +
    r.nodes[2].terminal!.totalDeltaV;
  assertAlmostEquals(r.totalDeltaV, expected, 1e-9);
});

Deno.test("findSingleAssistRoutes: notation marks powered (+) vs unpowered (*) flybys", () => {
  const routes = findSingleAssistRoutes(
    inner,
    outer,
    EndState.Orbit,
    EndState.Orbit,
    [giant],
    MU,
    "star",
    { rank: RankMode.All },
  );
  for (const r of routes) {
    const marker = r.nodes[1].deltaV > 1e-6 ? "+giant" : "*giant";
    assertEquals(r.notation, `inner@o > ${marker} > outer@o`);
  }
});

Deno.test("findSingleAssistRoutes: deterministic", () => {
  const a = findSingleAssistRoutes(
    inner,
    outer,
    EndState.Orbit,
    EndState.Orbit,
    [
      giant,
    ],
    MU,
    "star",
    {},
  );
  const b = findSingleAssistRoutes(
    inner,
    outer,
    EndState.Orbit,
    EndState.Orbit,
    [
      giant,
    ],
    MU,
    "star",
    {},
  );
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

const giant2: BodyRef = {
  id: "giant2",
  elements: {
    orbitRadiusAu: 7,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0.15,
  },
  endpoint: { mu: muBody(95), radiusM: R_EARTH_M * 9 },
};
const farOuter: BodyRef = {
  id: "farOuter",
  elements: {
    orbitRadiusAu: 19,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0.7,
  },
  endpoint: { mu: muBody(17), radiusM: R_EARTH_M * 4 },
};

Deno.test("findDoubleAssistRoutes: produces well-formed 4-body double-flyby routes", () => {
  const routes = findDoubleAssistRoutes(
    inner,
    farOuter,
    EndState.Orbit,
    EndState.Orbit,
    [giant, giant2],
    MU,
    "star",
    { rank: RankMode.All },
  );
  if (routes.length === 0) throw new Error("expected double-assist routes");
  for (const r of routes) {
    assertEquals(r.bodies.length, 4);
    assertEquals(r.bodies[0], "inner");
    assertEquals(r.bodies[3], "farOuter");
    // the two middle bodies are distinct flyby planets
    if (r.bodies[1] === r.bodies[2]) {
      throw new Error("the two flyby bodies must be distinct");
    }
    assertEquals(r.nodes.length, 4);
    assertEquals(r.legs.length, 3);
    assertEquals(r.nodes[1].kind, RouteNodeKind.Flyby);
    assertEquals(r.nodes[2].kind, RouteNodeKind.Flyby);
    for (const l of r.legs) assertEquals(l.centralBodyId, "star");
    if (!Number.isFinite(r.totalDeltaV)) throw new Error("Δv must be finite");
    for (let i = 1; i < r.nodes.length; i++) {
      if (!(r.nodes[i].time >= r.nodes[i - 1].time)) {
        throw new Error("node times must be monotonic");
      }
    }
  }
});

Deno.test("findDoubleAssistRoutes: totalDeltaV sums both terminals and both flyby burns", () => {
  const routes = findDoubleAssistRoutes(
    inner,
    farOuter,
    EndState.Orbit,
    EndState.Orbit,
    [giant, giant2],
    MU,
    "star",
    { rank: RankMode.All },
  );
  const r = routes[0];
  const expected = r.nodes[0].terminal!.totalDeltaV +
    r.nodes[1].deltaV +
    r.nodes[2].deltaV +
    r.nodes[3].terminal!.totalDeltaV;
  assertAlmostEquals(r.totalDeltaV, expected, 1e-9);
});

Deno.test("findDoubleAssistRoutes: notation lists both flyby markers in order", () => {
  const routes = findDoubleAssistRoutes(
    inner,
    farOuter,
    EndState.Orbit,
    EndState.Orbit,
    [giant, giant2],
    MU,
    "star",
    { rank: RankMode.All },
  );
  for (const r of routes) {
    const m1 = (r.nodes[1].deltaV > 1e-6 ? "+" : "*") + r.bodies[1];
    const m2 = (r.nodes[2].deltaV > 1e-6 ? "+" : "*") + r.bodies[2];
    assertEquals(r.notation, `inner@o > ${m1} > ${m2} > farOuter@o`);
  }
});

Deno.test("findDoubleAssistRoutes: deterministic", () => {
  const a = findDoubleAssistRoutes(
    inner,
    farOuter,
    EndState.Orbit,
    EndState.Orbit,
    [giant, giant2],
    MU,
    "star",
    {},
  );
  const b = findDoubleAssistRoutes(
    inner,
    farOuter,
    EndState.Orbit,
    EndState.Orbit,
    [giant, giant2],
    MU,
    "star",
    {},
  );
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

Deno.test("searchBest: arrival objective minimizes departAt + duration", () => {
  const best = searchBest(
    "arrival", inner, outer, EndState.Orbit, EndState.Orbit, [giant], MU, "star", 2, {},
  );
  if (!best) throw new Error("expected a route");
  const arrival = best.departAt + best.duration;
  const all = findSingleAssistRoutes(
    inner, outer, EndState.Orbit, EndState.Orbit, [giant], MU, "star", { rank: RankMode.All },
  ).concat(
    findDirectRoutes(inner, outer, EndState.Orbit, EndState.Orbit, MU, "star", { rank: RankMode.All }),
  );
  const minArrival = Math.min(...all.map((r) => r.departAt + r.duration));
  assertAlmostEquals(arrival, minArrival, 1e-6);
});

Deno.test("searchBest: arrival ties broken by least Δv", () => {
  const best = searchBest(
    "arrival", inner, outer, EndState.Orbit, EndState.Orbit, [giant], MU, "star", 2, {},
  )!;
  const all = findDirectRoutes(
    inner, outer, EndState.Orbit, EndState.Orbit, MU, "star", { rank: RankMode.All },
  );
  const bestArr = best.departAt + best.duration;
  for (const r of all) {
    if (Math.abs((r.departAt + r.duration) - bestArr) < 1e-9) {
      if (r.totalDeltaV < best.totalDeltaV - 1e-9) {
        throw new Error("arrival tiebreak failed to pick least Δv");
      }
    }
  }
});

Deno.test("searchBest: capDirectDepartAtSynodic bounds a direct departure to one synodic period", () => {
  const huge = 100000;
  const capped = searchBest(
    "deltaV", fromBody, toBody, EndState.Orbit, EndState.Orbit, [], MU, "star", 0,
    { departWindowDays: huge, capDirectDepartAtSynodic: true },
  )!;
  if (!Number.isFinite(capped.departAt)) throw new Error("expected finite departAt");

  // Synodic horizon, mirroring defaultSweepOpts (not exported): orbital period
  // T = 2π√(a³/μ) in days; synodic = 1/|1/T_in − 1/T_out|, capped at the outer period.
  const periodDays = (au: number) => {
    const m = au * AU_M;
    return (2 * Math.PI * Math.sqrt((m * m * m) / MU)) / DAY_S;
  };
  const tIn = periodDays(Math.min(fromBody.elements.orbitRadiusAu, toBody.elements.orbitRadiusAu));
  const tOut = periodDays(Math.max(fromBody.elements.orbitRadiusAu, toBody.elements.orbitRadiusAu));
  const horizon = Math.min(1 / Math.abs(1 / tIn - 1 / tOut), tOut);

  // The cap must bound the direct departure to within one synodic horizon.
  if (capped.departAt > horizon + 1e-6) {
    throw new Error(`expected departAt <= ${horizon}, got ${capped.departAt}`);
  }
  // And it must actually pull the departure in vs. the huge uncapped window.
  const uncapped = searchBest(
    "deltaV", fromBody, toBody, EndState.Orbit, EndState.Orbit, [], MU, "star", 0,
    { departWindowDays: huge },
  )!;
  if (!(capped.departAt < uncapped.departAt)) {
    throw new Error("cap did not pull the departure in");
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
