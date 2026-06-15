// src/travel/index.ts
import type { CelestialObject, SolarSystem } from "../core/types.ts";
import { ObjectType } from "../core/types.ts";
import {
  balanceBoxes,
  dedupeRoutes,
  findCrossFrameRoutes,
  findDirectRoutes,
  findDoubleAssistRoutes,
  findSingleAssistRoutes,
  projectRoutes,
  rankRoutes,
  searchBest,
  selectBestRoutes,
  selectBestRoutes2,
  type UtopiaBox,
  utopiaDist,
  validateWindow,
} from "./search.ts";
import type { BodyRef } from "./search.ts";
import type { CrossFrameEndpoint } from "./legs.ts";
import { auToM, M_EARTH_KG, M_SUN_KG, muBody, muStar, R_EARTH_M } from "./units.ts";
import type { OrbitElements } from "./state.ts";
import {
  EndState,
  RankMode,
  type Route,
  type RouteOptions,
  type SweepMode,
  type TravelOptions,
  type Waypoint,
} from "./types.ts";
import { DEFAULT_REFRAME } from "./recurrence.ts";

/** Planet/giant bodies are the only eligible gravity-assist flyby targets. */
const FLYBY_TYPES = new Set<ObjectType>([
  ObjectType.RockyPlanet,
  ObjectType.GasGiant,
  ObjectType.IceGiant,
]);

function elementsOf(o: CelestialObject): OrbitElements {
  return {
    orbitRadiusAu: o.orbitRadius,
    eccentricity: o.eccentricity,
    periapsisAngle: o.periapsisAngle,
    orbitalPhase: o.orbitalPhase,
  };
}

function bodyRefOf(o: CelestialObject): BodyRef {
  return {
    id: o.id,
    elements: elementsOf(o),
    endpoint: { mu: muBody(o.mass), radiusM: o.radius * R_EARTH_M },
  };
}

type ResolvedWaypoint =
  | { kind: "heliocentric"; ref: BodyRef }
  | { kind: "crossframe"; endpoint: CrossFrameEndpoint; selfRef: BodyRef };

/**
 * Resolve a waypoint to either a heliocentric BodyRef or a cross-frame endpoint.
 * Real planets and heliocentric { spec } bodies are heliocentric; real moons and
 * planetocentric { pSpec } bodies are cross-frame. The crossframe arm also carries
 * selfRef: the parent-relative BodyRef used for same-parent (shared-anchor) routing,
 * which preserves a real moon's full orbital elements. Virtual bodies are massless
 * and support only Intercept or Dock.
 */
function resolveWaypoint(
  wp: Waypoint,
  index: Map<string, { obj: CelestialObject; isMoon: boolean }>,
): ResolvedWaypoint {
  if ("spec" in wp) {
    assertVirtualEndState(wp.type);
    const s = wp.spec;
    return {
      kind: "heliocentric",
      ref: {
        id: s.id ?? `virtual:${s.orbitRadiusAu}au`,
        elements: {
          orbitRadiusAu: s.orbitRadiusAu,
          eccentricity: s.eccentricity ?? 0,
          periapsisAngle: s.periapsisAngle ?? 0,
          orbitalPhase: s.orbitalPhase ?? 0,
        },
        endpoint: { mu: 0, radiusM: 0 },
      },
    };
  }
  if ("pSpec" in wp) {
    assertVirtualEndState(wp.type);
    const s = wp.pSpec;
    const parent = index.get(s.parentId);
    if (!parent) throw new Error(`unknown parent body: ${s.parentId}`);
    if (parent.isMoon) {
      throw new Error("pSpec parentId must be a planet, not a moon");
    }
    const id = s.id ?? `virtual:${s.parentId}:${s.orbitRadiusAu}au`;
    return {
      kind: "crossframe",
      endpoint: {
        id,
        endState: wp.type,
        body: { mu: 0, radiusM: 0 },
        anchorId: parent.obj.id,
        anchorElements: elementsOf(parent.obj),
        parent: {
          body: {
            mu: muBody(parent.obj.mass),
            radiusM: parent.obj.radius * R_EARTH_M,
          },
          moonOrbitRadiusM: auToM(s.orbitRadiusAu),
        },
      },
      // selfRef: parent-relative BodyRef for same-parent (shared-anchor) Hohmann routing.
      // A pSpec station has no eccentricity/phase, so its self orbit is circular.
      selfRef: {
        id,
        elements: {
          orbitRadiusAu: s.orbitRadiusAu,
          eccentricity: 0,
          periapsisAngle: 0,
          orbitalPhase: 0,
        },
        endpoint: { mu: 0, radiusM: 0 },
      },
    };
  }
  // Real bodies have a sphere of influence; Dock (kill-all-relative-velocity rendezvous)
  // is only meaningful for massless virtual bodies.
  if (wp.type === EndState.Dock) {
    throw new Error("Dock is only supported for virtual bodies");
  }
  const entry = index.get(wp.obj);
  if (!entry) throw new Error(`unknown body: ${wp.obj}`);
  if (entry.isMoon) {
    return {
      kind: "crossframe",
      endpoint: crossFrameEndpointOf(entry, wp.type, index),
      selfRef: bodyRefOf(entry.obj),
    };
  }
  return { kind: "heliocentric", ref: bodyRefOf(entry.obj) };
}

/** Build a cross-frame endpoint descriptor. A planet anchors to itself; a moon to its parent. */
function crossFrameEndpointOf(
  entry: { obj: CelestialObject; isMoon: boolean },
  endState: EndState,
  index: Map<string, { obj: CelestialObject; isMoon: boolean }>,
): CrossFrameEndpoint {
  const o = entry.obj;
  const body = { mu: muBody(o.mass), radiusM: o.radius * R_EARTH_M };
  if (!entry.isMoon) {
    return {
      id: o.id,
      endState,
      body,
      anchorId: o.id,
      anchorElements: elementsOf(o),
    };
  }
  const parent = index.get(o.parentId!);
  if (!parent) throw new Error(`unknown parent body: ${o.parentId}`);
  return {
    id: o.id,
    endState,
    body,
    anchorId: parent.obj.id,
    anchorElements: elementsOf(parent.obj),
    parent: {
      body: {
        mu: muBody(parent.obj.mass),
        radiusM: parent.obj.radius * R_EARTH_M,
      },
      moonOrbitRadiusM: auToM(o.orbitRadius),
    },
  };
}

/** Treat a heliocentric body as a self-anchored cross-frame endpoint (no parent appendage). */
function heliocentricToCrossFrame(
  ref: BodyRef,
  endState: EndState,
): CrossFrameEndpoint {
  return {
    id: ref.id,
    endState,
    body: ref.endpoint,
    anchorId: ref.id,
    anchorElements: ref.elements,
  };
}

/** Virtual bodies have no SOI: only Intercept (fly-through) or Dock (rendezvous) make sense. */
function assertVirtualEndState(type: EndState): void {
  if (type === EndState.Orbit || type === EndState.Surface) {
    throw new Error("virtual bodies only support Intercept or Dock");
  }
}

/** Reject the star as an endpoint. Only meaningful for real ({ obj }) waypoints. */
function assertNotStar(
  wp: Waypoint,
  index: Map<string, { obj: CelestialObject; isMoon: boolean }>,
): void {
  if ("obj" in wp && index.get(wp.obj)?.obj.type === ObjectType.Star) {
    throw new Error("the star cannot be a travel endpoint");
  }
}

/** Flatten a system into id → {object, isMoon}. IDs are globally unique. */
function flatten(
  system: SolarSystem,
): Map<string, { obj: CelestialObject; isMoon: boolean }> {
  const map = new Map<string, { obj: CelestialObject; isMoon: boolean }>();
  map.set(system.star.id, { obj: system.star, isMoon: false });
  for (const o of system.objects) {
    map.set(o.id, { obj: o, isMoon: false });
    for (const m of o.moons) map.set(m.id, { obj: m, isMoon: true });
  }
  return map;
}

/**
 * Compute ranked travel routes between two bodies. Planet↔planet transfers are
 * heliocentric; moon endpoints are handled via a planetocentric leg (same-parent
 * moon→moon) or cross-frame routing (everything else). Planet↔planet routes also
 * include gravity-assist candidates up to `maxAssists` (default 2, capped at
 * double-assist).
 */
export function getRoutes(
  system: SolarSystem,
  from: Waypoint,
  to: Waypoint,
  options: TravelOptions = {},
): Route[] {
  validateWindow(options);
  const index = flatten(system);
  // Reject the star before resolving (resolveWaypoint has no system context for spec bodies).
  assertNotStar(from, index);
  assertNotStar(to, index);
  const fromR = resolveWaypoint(from, index);
  const toR = resolveWaypoint(to, index);
  if (fromR.kind === "crossframe" || toR.kind === "crossframe") {
    const fromEp = fromR.kind === "crossframe"
      ? fromR.endpoint
      : heliocentricToCrossFrame(fromR.ref, from.type);
    const toEp = toR.kind === "crossframe"
      ? toR.endpoint
      : heliocentricToCrossFrame(toR.ref, to.type);
    // Same-parent (shared anchor): a single planetocentric Hohmann, no heliocentric spine.
    if (
      fromR.kind === "crossframe" &&
      toR.kind === "crossframe" &&
      fromEp.anchorId === toEp.anchorId
    ) {
      const parent = index.get(fromEp.anchorId);
      if (!parent) throw new Error(`unknown parent body: ${fromEp.anchorId}`);
      return findDirectRoutes(
        fromR.selfRef,
        toR.selfRef,
        from.type,
        to.type,
        muBody(parent.obj.mass),
        parent.obj.id,
        options,
      );
    }
    if (fromEp.anchorId === toEp.anchorId) {
      // A moon and its own parent planet share an anchor; the heliocentric spine degenerates.
      throw new Error(
        "travel between a moon and its own parent is not yet supported",
      );
    }
    return findCrossFrameRoutes(
      fromEp,
      toEp,
      system.star.id,
      muStar(system.star.mass),
      options,
    );
  }
  const mu = muStar(system.star.mass);
  const direct = findDirectRoutes(
    fromR.ref,
    toR.ref,
    from.type,
    to.type,
    mu,
    system.star.id,
    {
      rank: RankMode.All,
      departWindowDays: options.departWindowDays,
      startWindow: options.startWindow,
      endWindow: options.endWindow,
    },
  );
  // Default maxAssists is 2; the search is capped at depth 2 (double assist).
  const assists = Math.min(options.maxAssists ?? 2, 2);
  if (assists < 1) return rankRoutes(direct, options);
  const flybyBodies: BodyRef[] = [];
  for (const o of system.objects) {
    if (o.id === fromR.ref.id || o.id === toR.ref.id) continue;
    if (FLYBY_TYPES.has(o.type)) flybyBodies.push(bodyRefOf(o));
  }
  const fromRef = fromR.ref;
  const toRef = toR.ref;
  // Concatenate rather than push(...spread): assist searches can return tens of
  // thousands of candidates, which would overflow the argument limit of push.
  let candidates = direct.concat(
    findSingleAssistRoutes(
      fromRef,
      toRef,
      from.type,
      to.type,
      flybyBodies,
      mu,
      system.star.id,
      {
        rank: RankMode.All,
        departWindowDays: options.departWindowDays,
        startWindow: options.startWindow,
        endWindow: options.endWindow,
      },
    ),
  );
  if (assists >= 2) {
    candidates = candidates.concat(
      findDoubleAssistRoutes(
        fromRef,
        toRef,
        from.type,
        to.type,
        flybyBodies,
        mu,
        system.star.id,
        {
          rank: RankMode.All,
          departWindowDays: options.departWindowDays,
          startWindow: options.startWindow,
          endWindow: options.endWindow,
        },
      ),
    );
  }
  return rankRoutes(candidates, options);
}

/**
 * Branch-and-bound counterpart to getRoutes. Instead of enumerating every candidate and
 * Pareto-filtering, it runs single-objective searches and returns the "picks": fastest,
 * cheapest, and (when `includeGoldilocks`) the goldilocks compromise — the feasible route
 * nearest the (minΔv, minTime) utopia corner.
 *
 * Planet↔planet endpoints use branch-and-bound (searchBest) over the same grid as getRoutes —
 * the picks match the corresponding Pareto-front routes, but with the candidate set pruned to
 * keep the assist search affordable. Moon endpoints have no assist variants, so their candidate
 * sets are small; there it delegates to getRoutes and selects the same three picks, leaving the
 * two APIs in agreement.
 */
export function getBestRoutes(
  system: SolarSystem,
  from: Waypoint,
  to: Waypoint,
  options: RouteOptions = {},
): Route[] {
  const {
    findFastest = true,
    findCheapest = true,
    findSoonest = false,
    balance = true,
    capAtSynodic = true,
    maxAssists: maxAssistsOpt,
    startWindow,
    endWindow,
    departWindowDays,
  } = options;

  validateWindow({ startWindow, endWindow, departWindowDays });

  const index = flatten(system);
  assertNotStar(from, index);
  assertNotStar(to, index);
  const fromR = resolveWaypoint(from, index);
  const toR = resolveWaypoint(to, index);

  if (fromR.kind === "crossframe" || toR.kind === "crossframe") {
    const all = getRoutes(system, from, to, {
      rank: RankMode.All,
      maxAssists: maxAssistsOpt,
      startWindow,
      endWindow,
      departWindowDays,
    });
    return findSoonest ? selectBestRoutes2(all) : selectBestRoutes(all, balance);
  }

  const mu = muStar(system.star.mass);
  const assists = Math.min(maxAssistsOpt ?? 2, 2);
  const flybyBodies: BodyRef[] = [];
  for (const o of system.objects) {
    if (o.id === fromR.ref.id || o.id === toR.ref.id) continue;
    if (FLYBY_TYPES.has(o.type)) flybyBodies.push(bodyRefOf(o));
  }
  const fromRef = fromR.ref;
  const toRef = toR.ref;

  const passOpts = {
    startWindow,
    endWindow,
    departWindowDays,
    ...(capAtSynodic ? { capDirectDepartAtSynodic: true as const } : {}),
  };

  const runAnchor = (obj: "deltaV" | "duration" | "arrival") =>
    searchBest(obj, fromRef, toRef, from.type, to.type, flybyBodies, mu, system.star.id, assists, passOpts);

  const cheapest = findCheapest ? runAnchor("deltaV") : null;
  const fastest = findFastest ? runAnchor("duration") : null;
  const soonest = findSoonest ? runAnchor("arrival") : null;

  if (!balance) {
    return dedupeRoutes([cheapest, fastest, soonest]);
  }

  const arr = (r: Route) => r.departAt + r.duration;

  const runBalance = (box: UtopiaBox, seeds: (Route | null)[]): Route | null => {
    let initialBest = Infinity;
    let initialIncumbent: Route | null = null;
    for (const r of seeds) {
      if (!r) continue;
      const d = utopiaDist(r.totalDeltaV, r.duration, arr(r), box);
      if (d < initialBest) {
        initialBest = d;
        initialIncumbent = r;
      }
    }
    return searchBest(
      "goldilocks",
      fromRef,
      toRef,
      from.type,
      to.type,
      flybyBodies,
      mu,
      system.star.id,
      assists,
      { box, initialBest, initialIncumbent, ...passOpts },
    );
  };

  // 3 anchors: 4 balance passes
  if (cheapest && fastest && soonest) {
    const boxes = balanceBoxes(cheapest, fastest, soonest);
    const cf = runBalance(boxes.cf, [cheapest, fastest]);
    const cs = runBalance(boxes.cs, [cheapest, soonest]);
    const fs = runBalance(boxes.fs, [fastest, soonest]);
    const triple = runBalance(boxes.triple, [cheapest, fastest, soonest]);
    return dedupeRoutes([cheapest, fastest, soonest, cf, cs, fs, triple]);
  }

  // 2 anchors: 1 balance pass with the appropriate utopia box
  if (cheapest && fastest) {
    const box: UtopiaBox = {
      dvMin: cheapest.totalDeltaV,
      dvMax: fastest.totalDeltaV,
      durMin: fastest.duration,
      durMax: cheapest.duration,
    };
    return dedupeRoutes([fastest, runBalance(box, [fastest, cheapest]), cheapest]);
  }
  if (cheapest && soonest) {
    const box: UtopiaBox = {
      dvMin: cheapest.totalDeltaV,
      dvMax: soonest.totalDeltaV,
      arrMin: arr(soonest),
      arrMax: arr(cheapest),
    };
    return dedupeRoutes([soonest, runBalance(box, [soonest, cheapest]), cheapest]);
  }
  if (fastest && soonest) {
    const box: UtopiaBox = {
      durMin: fastest.duration,
      durMax: soonest.duration,
      arrMin: arr(soonest),
      arrMax: arr(fastest),
    };
    return dedupeRoutes([fastest, runBalance(box, [fastest, soonest]), soonest]);
  }

  return dedupeRoutes([cheapest, fastest, soonest]);
}

/** Build the default resolution-target sweep mode for getBestRoutes3 from DEFAULT_REFRAME. */
function defaultReframe(
  nowDay: number,
): Extract<SweepMode, { kind: "resolutionTarget" }> {
  return {
    kind: "resolutionTarget",
    deltaD: DEFAULT_REFRAME.deltaD,
    minD: DEFAULT_REFRAME.minD,
    maxD: DEFAULT_REFRAME.maxD,
    deltaT: DEFAULT_REFRAME.deltaT,
    minT: DEFAULT_REFRAME.minT,
    maxT: DEFAULT_REFRAME.maxT,
    nowDay,
  };
}

/**
 * EXPERIMENTAL — not for production use. Third, parallel route function: the full schedule-aware
 * reframe, kept beside getBestRoutes and getBestRoutes2 as a benchmark control. Instead of
 * branch-and-bound, it SCANS once at resolution-target density over the recurrence horizon
 * (synodic for direct, T_combined for assist), PROJECTS every tagged opportunity to its soonest
 * occurrence at/after `nowDay` within the window, then SELECTS the 7 Tier-C picks via
 * selectBestRoutes2. Slowest of the three by design — no pruning. Sampling is opt-in
 * (`options.sweep`); when the caller passes no resolutionTarget sweep, getBestRoutes3 supplies the
 * DEFAULT_REFRAME mode (nowDay 0). Moon endpoints have no assist variants, so they delegate to
 * getRoutes (with the reframe sweep) and select from the projected cross-frame candidates.
 *
 * Benchmark verdict (see bench/report_resolution.ts, 2026-06-13): the resolution-target reframe
 * does NOT improve pick values in this circular/coplanar engine. getBestRoutes2's fixed 36-sample
 * grid already finds the cheapest/fastest/soonest optima to within ~0.1 km/s and 0 days, even over
 * a 471-year horizon — because Δv is nearly phase-invariant for circular orbits, so depart-axis
 * density (the reframe's whole advantage) barely moves the answer. getBestRoutes3 costs ~50-150×
 * more (seconds vs ~0.1s) for that ~0 gain and OOMs on systems with >=7 flyby bodies (the
 * no-pruning O(flyby^2) scan). Its only genuine differentiators are the provable window-nesting
 * guarantee and the `nowDay` soonest-occurrence projection (a scheduling feature, unrelated to
 * resolution, that could be grafted onto getBestRoutes2 cheaply). Revisit only when orbital
 * eccentricity lands (which would make Δv phase-sensitive and resolution start to matter).
 */
export function getBestRoutes3(
  system: SolarSystem,
  from: Waypoint,
  to: Waypoint,
  options: TravelOptions = {},
): Route[] {
  const index = flatten(system);
  assertNotStar(from, index);
  assertNotStar(to, index);
  const fromR = resolveWaypoint(from, index);
  const toR = resolveWaypoint(to, index);
  // The reframe sweep: caller-supplied resolutionTarget mode, else the DEFAULT_REFRAME defaults.
  const sweep = options.sweep?.kind === "resolutionTarget"
    ? options.sweep
    : defaultReframe(0);
  const nowDay = sweep.nowDay;
  const scanOpts: TravelOptions = { ...options, rank: RankMode.All, sweep };

  if (fromR.kind === "crossframe" || toR.kind === "crossframe") {
    const all = getRoutes(system, from, to, scanOpts);
    const projected = projectRoutes(all, nowDay, options.departWindowDays);
    return selectBestRoutes2(projected);
  }

  const mu = muStar(system.star.mass);
  const assists = Math.min(options.maxAssists ?? 2, 2);
  const flybyBodies: BodyRef[] = [];
  for (const o of system.objects) {
    if (o.id === fromR.ref.id || o.id === toR.ref.id) continue;
    if (FLYBY_TYPES.has(o.type)) flybyBodies.push(bodyRefOf(o));
  }
  const fromRef = fromR.ref;
  const toRef = toR.ref;

  // Scan once (no branch-and-bound): direct + single + double assist, all tagged for projection.
  let candidates = findDirectRoutes(
    fromRef,
    toRef,
    from.type,
    to.type,
    mu,
    system.star.id,
    scanOpts,
  );
  if (assists >= 1) {
    candidates = candidates.concat(
      findSingleAssistRoutes(
        fromRef,
        toRef,
        from.type,
        to.type,
        flybyBodies,
        mu,
        system.star.id,
        scanOpts,
      ),
    );
  }
  if (assists >= 2) {
    candidates = candidates.concat(
      findDoubleAssistRoutes(
        fromRef,
        toRef,
        from.type,
        to.type,
        flybyBodies,
        mu,
        system.star.id,
        scanOpts,
      ),
    );
  }

  const projected = projectRoutes(candidates, nowDay, options.departWindowDays);
  return selectBestRoutes2(projected);
}

/** Body mass in kg, normalizing the unit split (stars: M☉; everything else: M⊕). */
function massKg(body: CelestialObject): number {
  return body.type === ObjectType.Star
    ? body.mass * M_SUN_KG
    : body.mass * M_EARTH_KG;
}

/** A Lagrange point, equilateral (L4/L5) or collinear (L1/L2/L3). */
export type LagrangePoint = "L1" | "L2" | "L3" | "L4" | "L5";

/**
 * Geometry of a Lagrange point relative to the parent's orbit: a multiplier on
 * the parent's orbit radius and a phase offset (fraction of an orbit).
 * - Equilateral (L4/L5): same radius, ±1/6 phase. Mass-independent; `mu` unused.
 * - Collinear (L1/L2/L3): first-order Hill-radius approximations.
 *   L1 = a·(1 − α), L2 = a·(1 + α) with α = (μ/3)^(1/3); L3 = a·(1 + 5μ/12) at 180°.
 */
export function lagrangePointGeometry(
  point: LagrangePoint,
  mu: number,
): { radiusFactor: number; phaseOffset: number } {
  switch (point) {
    case "L4":
      return { radiusFactor: 1, phaseOffset: 1 / 6 };
    case "L5":
      return { radiusFactor: 1, phaseOffset: -1 / 6 };
    case "L1":
      return { radiusFactor: 1 - Math.cbrt(mu / 3), phaseOffset: 0 };
    case "L2":
      return { radiusFactor: 1 + Math.cbrt(mu / 3), phaseOffset: 0 };
    case "L3":
      return { radiusFactor: 1 + (5 * mu) / 12, phaseOffset: 0.5 };
  }
}

/**
 * Build a waypoint at a parent body's Lagrange point.
 * - Equilateral (L4 leading +60°, L5 trailing -60°): co-orbital with the parent.
 * - Collinear (L1 inner, L2 outer, L3 opposite the central body): radius offset
 *   by a first-order Hill-radius approximation of the parent/central mass ratio.
 * Frames:
 * - Planet (or minor-body) parent → heliocentric virtual body (`spec`), carrying
 *   the radius/phase offset.
 * - Moon parent → planetocentric virtual body (`pSpec`). Planetocentric routing
 *   is free-phase, so the phase offset is NOT carried — in particular L3's 180°
 *   is intentionally not represented; only its radius offset is.
 * Only Intercept or Dock are meaningful (a massless point has no SOI).
 */
export function lagrangeWaypoint(
  system: SolarSystem,
  parent: CelestialObject,
  point: LagrangePoint,
  type: EndState.Intercept | EndState.Dock,
): Waypoint {
  if (parent.type === ObjectType.Star) {
    throw new Error("lagrangeWaypoint: a star has no Lagrange points to anchor to");
  }

  // Central body: the star for a planet, the parent planet for a moon.
  const central = parent.type === ObjectType.Moon
    ? flatten(system).get(parent.parentId!)?.obj
    : system.star;
  if (!central) {
    throw new Error("lagrangeWaypoint: could not resolve the central body");
  }

  const mParent = massKg(parent);
  const mu = mParent / (massKg(central) + mParent);
  const { radiusFactor, phaseOffset } = lagrangePointGeometry(point, mu);
  const radius = parent.orbitRadius * radiusFactor;

  if (parent.type === ObjectType.Moon) {
    // Planetocentric: co-orbital appendage routing is free-phase, so the phase
    // offset is not carried (L3's 180° is dropped); only the radius offset is.
    return {
      pSpec: {
        id: `${point}:${parent.id}`,
        parentId: parent.parentId!,
        orbitRadiusAu: radius,
      },
      type,
    };
  }

  // Heliocentric: co-orbital with the planet around the star.
  return {
    spec: {
      id: `${point}:${parent.id}`,
      orbitRadiusAu: radius,
      eccentricity: parent.eccentricity,
      periapsisAngle: parent.periapsisAngle,
      orbitalPhase: ((parent.orbitalPhase + phaseOffset) % 1 + 1) % 1,
    },
    type,
  };
}
