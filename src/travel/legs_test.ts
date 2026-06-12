import {
  buildCrossFrameRoute,
  type CrossFrameEndpoint,
  planetoAppendage,
} from "./legs.ts";
import type { TransferCandidate } from "./transfers.ts";
import { EndState, RouteNodeKind } from "./types.ts";
import { auToM, mToAu } from "./units.ts";

Deno.test("planetoAppendage: outputs are positive and self-consistent", () => {
  const parent = { mu: 1.2e8 * 1e6, radiusM: 6.0e7 }; // giant μ (m³/s²), radius (m)
  const moonOrbitRadiusM = auToM(0.01); // moon orbit about parent
  const a = planetoAppendage(parent, moonOrbitRadiusM);
  if (!(a.legDeltaVMps > 0)) {
    throw new Error("expected positive injection burn");
  }
  if (!(a.moonVInfMps > 0)) throw new Error("expected positive moon v∞");
  if (!(a.tofDays > 0)) throw new Error("expected positive time of flight");
  // transfer semi-major axis (AU about parent) sits between low orbit and moon orbit
  const lowAu = mToAu(parent.radiusM);
  if (!(a.aAu > lowAu && a.aAu < 0.01)) {
    throw new Error("a must be between radii");
  }
  if (!(a.e > 0 && a.e < 1)) throw new Error("e must be a valid ellipse");
});

Deno.test("planetoAppendage: a closer moon is cheaper to reach than a far one", () => {
  const parent = { mu: 1.2e8 * 1e6, radiusM: 6.0e7 };
  const near = planetoAppendage(parent, auToM(0.005));
  const far = planetoAppendage(parent, auToM(0.05));
  if (!(far.tofDays > near.tofDays)) {
    throw new Error("farther moon → longer flight");
  }
  if (!(far.legDeltaVMps > near.legDeltaVMps)) {
    throw new Error("farther moon → larger injection burn");
  }
});

const dummyElements = {
  orbitRadiusAu: 5,
  eccentricity: 0,
  periapsisAngle: 0,
  orbitalPhase: 0,
};

const candidate: TransferCandidate = {
  departDay: 100,
  tofDays: 400,
  arriveDay: 500,
  v1: { x: 0, y: 0 },
  v2: { x: 0, y: 0 },
  vInfDepart: 6000,
  vInfArrive: 8000,
  aAu: 4,
  e: 0.9,
};

Deno.test("buildCrossFrameRoute: planet → moon yields a Transit node and two legs", () => {
  const from: CrossFrameEndpoint = {
    id: "P",
    endState: EndState.Orbit,
    body: { mu: 4.0e14, radiusM: 6.4e6 },
    anchorId: "P",
    anchorElements: dummyElements,
  };
  const to: CrossFrameEndpoint = {
    id: "M",
    endState: EndState.Surface,
    body: { mu: 6.0e12, radiusM: 1.7e6 },
    anchorId: "G",
    anchorElements: dummyElements,
    parent: { body: { mu: 1.2e14, radiusM: 6.0e7 }, moonOrbitRadiusM: 1.5e9 },
  };
  const route = buildCrossFrameRoute(from, to, "star", candidate);
  if (!route) throw new Error("expected a route");
  assertSequence(route.bodies, ["P", "G", "M"]);
  if (route.legs.length !== 2) throw new Error("expected 2 legs");
  if (route.nodes.length !== 3) throw new Error("expected 3 nodes");
  if (route.legs[0].centralBodyId !== "star") {
    throw new Error("first leg heliocentric");
  }
  if (route.legs[1].centralBodyId !== "G") {
    throw new Error("second leg planetocentric");
  }
  if (route.nodes[1].kind !== RouteNodeKind.Transit) {
    throw new Error("middle node is a Transit");
  }
  if (!(route.nodes[1].deltaV > 0)) {
    throw new Error("Transit carries a capture burn");
  }
  if (!(route.totalDeltaV > 0)) throw new Error("expected positive Δv");
  if (route.departAt !== 100) {
    throw new Error("planet origin departs at candidate.departDay");
  }
  if (!(route.nodes[2].time > route.nodes[1].time)) {
    throw new Error("monotonic times");
  }
});

Deno.test("buildCrossFrameRoute: moon origin pushes departAt earlier than the heliocentric leg", () => {
  const from: CrossFrameEndpoint = {
    id: "M",
    endState: EndState.Orbit,
    body: { mu: 6.0e12, radiusM: 1.7e6 },
    anchorId: "G",
    anchorElements: dummyElements,
    parent: { body: { mu: 1.2e14, radiusM: 6.0e7 }, moonOrbitRadiusM: 1.5e9 },
  };
  const to: CrossFrameEndpoint = {
    id: "P",
    endState: EndState.Orbit,
    body: { mu: 4.0e14, radiusM: 6.4e6 },
    anchorId: "P",
    anchorElements: dummyElements,
  };
  const route = buildCrossFrameRoute(from, to, "star", candidate);
  if (!route) throw new Error("expected a route");
  assertSequence(route.bodies, ["M", "G", "P"]);
  if (route.legs.length !== 2) throw new Error("expected 2 legs");
  if (route.nodes.length !== 3) throw new Error("expected 3 nodes");
  if (route.legs[0].centralBodyId !== "G") {
    throw new Error("escape leg is planetocentric");
  }
  if (route.legs[1].centralBodyId !== "star") {
    throw new Error("heliocentric leg");
  }
  if (route.nodes[0].time !== route.departAt) {
    throw new Error("origin node time equals departAt");
  }
  if (!(route.departAt < 100)) {
    throw new Error("moon origin departs before the heliocentric leg");
  }
  if (route.legs[1].departTime !== 100) {
    throw new Error("heliocentric leg flies at candidate.departDay");
  }
});

Deno.test("buildCrossFrameRoute: moon → moon across different parents has two Transits and three legs", () => {
  const from: CrossFrameEndpoint = {
    id: "Ma",
    endState: EndState.Orbit,
    body: { mu: 6.0e12, radiusM: 1.7e6 },
    anchorId: "Ga",
    anchorElements: dummyElements,
    parent: { body: { mu: 1.2e14, radiusM: 6.0e7 }, moonOrbitRadiusM: 1.5e9 },
  };
  const to: CrossFrameEndpoint = {
    id: "Mb",
    endState: EndState.Surface,
    body: { mu: 4.0e12, radiusM: 1.4e6 },
    anchorId: "Gb",
    anchorElements: dummyElements,
    parent: { body: { mu: 9.0e13, radiusM: 5.0e7 }, moonOrbitRadiusM: 2.0e9 },
  };
  const route = buildCrossFrameRoute(from, to, "star", candidate);
  if (!route) throw new Error("expected a route");
  assertSequence(route.bodies, ["Ma", "Ga", "Gb", "Mb"]);
  if (route.legs.length !== 3) throw new Error("expected 3 legs");
  if (route.nodes.length !== 4) throw new Error("expected 4 nodes");
  if (route.legs[0].centralBodyId !== "Ga") {
    throw new Error("escape leg around Ga");
  }
  if (route.legs[1].centralBodyId !== "star") {
    throw new Error("middle leg heliocentric");
  }
  if (route.legs[2].centralBodyId !== "Gb") {
    throw new Error("capture leg around Gb");
  }
  if (route.nodes[1].kind !== RouteNodeKind.Transit) {
    throw new Error("escape Transit");
  }
  if (route.nodes[2].kind !== RouteNodeKind.Transit) {
    throw new Error("capture Transit");
  }
  if (!(route.nodes[1].deltaV > 0)) throw new Error("escape Transit burn");
  if (!(route.nodes[2].deltaV > 0)) throw new Error("capture Transit burn");
  if (!(route.departAt < 100)) {
    throw new Error("moon origin departs before the heliocentric leg");
  }
  if (route.legs[1].departTime !== 100) {
    throw new Error("heliocentric leg flies at candidate.departDay");
  }
  // times strictly increase across all nodes
  for (let i = 1; i < route.nodes.length; i++) {
    if (!(route.nodes[i].time >= route.nodes[i - 1].time)) {
      throw new Error("node times must be monotonic");
    }
  }
  if (!(route.totalDeltaV > 0)) throw new Error("expected positive Δv");
});

function assertSequence(actual: string[], expected: string[]) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
