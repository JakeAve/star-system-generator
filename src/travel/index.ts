// src/travel/index.ts
import type { CelestialObject, SolarSystem } from "../core/types.ts";
import { ObjectType } from "../core/types.ts";
import {
  findCrossFrameRoutes,
  findDirectRoutes,
  findDoubleAssistRoutes,
  findSingleAssistRoutes,
  rankRoutes,
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
 * Compute ranked direct travel routes between two non-moon bodies.
 * Phase 1: heliocentric, direct (no gravity assists), no moon endpoints.
 */
export function travelOptions(
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
    { rank: RankMode.All },
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
  const candidates = [...direct];
  candidates.push(
    ...findSingleAssistRoutes(
      fromRef,
      toRef,
      from.type,
      to.type,
      flybyBodies,
      mu,
      system.star.id,
      { rank: RankMode.All },
    ),
  );
  if (assists >= 2) {
    candidates.push(
      ...findDoubleAssistRoutes(
        fromRef,
        toRef,
        from.type,
        to.type,
        flybyBodies,
        mu,
        system.star.id,
        { rank: RankMode.All },
      ),
    );
  }
  return rankRoutes(candidates, options);
}
