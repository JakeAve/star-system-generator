// src/travel/index.ts
import type { CelestialObject, SolarSystem } from "../core/types.ts";
import { ObjectType } from "../core/types.ts";
import {
  dedupeRoutes,
  findCrossFrameRoutes,
  findDirectRoutes,
  findDoubleAssistRoutes,
  findSingleAssistRoutes,
  rankRoutes,
  searchBest,
  selectBestRoutes,
  selectBestRoutes2,
  type UtopiaBox,
  utopiaDist,
} from "./search.ts";
import type { BodyRef } from "./search.ts";
import type { CrossFrameEndpoint } from "./legs.ts";
import { auToM, muBody, muStar, R_EARTH_M } from "./units.ts";
import type { OrbitElements } from "./state.ts";
import {
  type EndState,
  RankMode,
  type Route,
  type TravelOptions,
  type Waypoint,
} from "./types.ts";

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
  const index = flatten(system);
  const f = index.get(from.obj);
  const t = index.get(to.obj);
  if (!f) throw new Error(`unknown body: ${from.obj}`);
  if (!t) throw new Error(`unknown body: ${to.obj}`);
  if (f.obj.type === ObjectType.Star || t.obj.type === ObjectType.Star) {
    throw new Error("the star cannot be a travel endpoint");
  }
  if (f.isMoon || t.isMoon) {
    // Same-parent moon→moon: a single planetocentric leg (Phase 1b).
    if (f.isMoon && t.isMoon && f.obj.parentId === t.obj.parentId) {
      const parent = index.get(f.obj.parentId!);
      if (!parent) throw new Error(`unknown parent body: ${f.obj.parentId}`);
      return findDirectRoutes(
        bodyRefOf(f.obj),
        bodyRefOf(t.obj),
        from.type,
        to.type,
        muBody(parent.obj.mass),
        parent.obj.id,
        options,
      );
    }
    const fromEp = crossFrameEndpointOf(f, from.type, index);
    const toEp = crossFrameEndpointOf(t, to.type, index);
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
    bodyRefOf(f.obj),
    bodyRefOf(t.obj),
    from.type,
    to.type,
    mu,
    system.star.id,
    { rank: RankMode.All, departWindowDays: options.departWindowDays },
  );
  // Default maxAssists is 2; the search is capped at depth 2 (double assist).
  const assists = Math.min(options.maxAssists ?? 2, 2);
  if (assists < 1) return rankRoutes(direct, options);
  const flybyBodies: BodyRef[] = [];
  for (const o of system.objects) {
    if (o.id === f.obj.id || o.id === t.obj.id) continue;
    if (FLYBY_TYPES.has(o.type)) flybyBodies.push(bodyRefOf(o));
  }
  const fromRef = bodyRefOf(f.obj);
  const toRef = bodyRefOf(t.obj);
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
      { rank: RankMode.All, departWindowDays: options.departWindowDays },
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
        { rank: RankMode.All, departWindowDays: options.departWindowDays },
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
  options: TravelOptions = {},
  includeGoldilocks = true,
): Route[] {
  const index = flatten(system);
  const f = index.get(from.obj);
  const t = index.get(to.obj);
  if (!f) throw new Error(`unknown body: ${from.obj}`);
  if (!t) throw new Error(`unknown body: ${to.obj}`);
  if (f.obj.type === ObjectType.Star || t.obj.type === ObjectType.Star) {
    throw new Error("the star cannot be a travel endpoint");
  }
  if (f.isMoon || t.isMoon) {
    // No gravity-assist variants exist for moon topologies, so the candidate set from getRoutes
    // is small enough to enumerate fully; pick fastest/cheapest/goldilocks from it.
    const all = getRoutes(system, from, to, { ...options, rank: RankMode.All });
    return selectBestRoutes(all, includeGoldilocks);
  }
  const mu = muStar(system.star.mass);
  const assists = Math.min(options.maxAssists ?? 2, 2);
  const flybyBodies: BodyRef[] = [];
  for (const o of system.objects) {
    if (o.id === f.obj.id || o.id === t.obj.id) continue;
    if (FLYBY_TYPES.has(o.type)) flybyBodies.push(bodyRefOf(o));
  }
  const fromRef = bodyRefOf(f.obj);
  const toRef = bodyRefOf(t.obj);
  const window = { departWindowDays: options.departWindowDays };
  const fastest = searchBest(
    "duration",
    fromRef,
    toRef,
    from.type,
    to.type,
    flybyBodies,
    mu,
    system.star.id,
    assists,
    window,
  );
  const cheapest = searchBest(
    "deltaV",
    fromRef,
    toRef,
    from.type,
    to.type,
    flybyBodies,
    mu,
    system.star.id,
    assists,
    window,
  );

  let goldilocks: Route | null = null;
  if (includeGoldilocks && fastest && cheapest && fastest !== cheapest) {
    // The two anchors define the normalisation box; seed the bound with the closer anchor so
    // the goldilocks search only keeps strictly-better interior compromises.
    const box: UtopiaBox = {
      dvMin: cheapest.totalDeltaV,
      dvMax: fastest.totalDeltaV,
      durMin: fastest.duration,
      durMax: cheapest.duration,
    };
    const dAnchor = (r: Route) =>
      utopiaDist(r.totalDeltaV, r.duration, r.departAt + r.duration, box);
    const seedBest = Math.min(dAnchor(fastest), dAnchor(cheapest));
    const seedRoute = dAnchor(fastest) <= dAnchor(cheapest)
      ? fastest
      : cheapest;
    goldilocks = searchBest(
      "goldilocks",
      fromRef,
      toRef,
      from.type,
      to.type,
      flybyBodies,
      mu,
      system.star.id,
      assists,
      {
        box,
        initialBest: seedBest,
        initialIncumbent: seedRoute,
        departWindowDays: options.departWindowDays,
      },
    );
  }

  const out: Route[] = [];
  for (const r of [fastest, goldilocks, cheapest]) {
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

/**
 * Experimental Tier-C counterpart to getBestRoutes (kept beside it as a benchmark control). Runs
 * the three single-objective anchors (cheapest/fastest/soonest) as branch-and-bound passes, then
 * four balance passes seeded from those anchors (cheapest×fastest, cheapest×soonest,
 * fastest×soonest, and the triple), value-dedupes, and returns a bare Route[]. The default
 * departure horizon is one synodic period; a departWindowDays restricts direct departures to
 * [0, min(window, T_syn)). Moon endpoints have no assist variants, so they delegate to getRoutes
 * and select the same seven picks via selectBestRoutes2.
 */
export function getBestRoutes2(
  system: SolarSystem,
  from: Waypoint,
  to: Waypoint,
  options: TravelOptions = {},
): Route[] {
  const index = flatten(system);
  const f = index.get(from.obj);
  const t = index.get(to.obj);
  if (!f) throw new Error(`unknown body: ${from.obj}`);
  if (!t) throw new Error(`unknown body: ${to.obj}`);
  if (f.obj.type === ObjectType.Star || t.obj.type === ObjectType.Star) {
    throw new Error("the star cannot be a travel endpoint");
  }
  if (f.isMoon || t.isMoon) {
    const all = getRoutes(system, from, to, { ...options, rank: RankMode.All });
    return selectBestRoutes2(all);
  }
  const mu = muStar(system.star.mass);
  const assists = Math.min(options.maxAssists ?? 2, 2);
  const flybyBodies: BodyRef[] = [];
  for (const o of system.objects) {
    if (o.id === f.obj.id || o.id === t.obj.id) continue;
    if (FLYBY_TYPES.has(o.type)) flybyBodies.push(bodyRefOf(o));
  }
  const fromRef = bodyRefOf(f.obj);
  const toRef = bodyRefOf(t.obj);
  const arr = (r: Route) => r.departAt + r.duration;

  const passOpts = {
    departWindowDays: options.departWindowDays,
    capDirectDepartAtSynodic: true as const,
  };
  const anchor = (obj: "deltaV" | "duration" | "arrival") =>
    searchBest(
      obj,
      fromRef,
      toRef,
      from.type,
      to.type,
      flybyBodies,
      mu,
      system.star.id,
      assists,
      passOpts,
    );
  const cheapest = anchor("deltaV");
  const fastest = anchor("duration");
  const soonest = anchor("arrival");
  if (!cheapest && !fastest && !soonest) return [];

  const balance = (box: UtopiaBox, anchors: (Route | null)[]): Route | null => {
    const present = anchors.filter((r): r is Route => r !== null);
    if (present.length < 2) return present[0] ?? null;
    let initialBest = Infinity;
    let initialIncumbent: Route | null = null;
    for (const r of present) {
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

  const cf = (cheapest && fastest)
    ? balance(
      {
        dvMin: cheapest.totalDeltaV,
        dvMax: fastest.totalDeltaV,
        durMin: fastest.duration,
        durMax: cheapest.duration,
      },
      [cheapest, fastest],
    )
    : null;
  const cs = (cheapest && soonest)
    ? balance(
      {
        dvMin: cheapest.totalDeltaV,
        dvMax: soonest.totalDeltaV,
        arrMin: arr(soonest),
        arrMax: arr(cheapest),
      },
      [cheapest, soonest],
    )
    : null;
  const fs = (fastest && soonest)
    ? balance(
      {
        durMin: fastest.duration,
        durMax: soonest.duration,
        arrMin: arr(soonest),
        arrMax: arr(fastest),
      },
      [fastest, soonest],
    )
    : null;
  const triple = (cheapest && fastest && soonest)
    ? balance(
      {
        dvMin: cheapest.totalDeltaV,
        dvMax: Math.max(fastest.totalDeltaV, soonest.totalDeltaV),
        durMin: fastest.duration,
        durMax: Math.max(cheapest.duration, soonest.duration),
        arrMin: arr(soonest),
        arrMax: Math.max(arr(cheapest), arr(fastest)),
      },
      [cheapest, fastest, soonest],
    )
    : null;

  return dedupeRoutes([cheapest, fastest, soonest, cf, cs, fs, triple]);
}
