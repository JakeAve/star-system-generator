// Layer 2 — plain-data "what to draw" for a system at a moment in time.
// No Three.js, no DOM. Engines consume this and render in their own space.

import { CelestialObject, SolarSystem } from "./types.ts";
import {
  angleAtTime,
  orbitParams,
  orbitPosition,
  SOLAR_TO_EARTH_RADII,
  visualRadius,
} from "./kinematics.ts";

export interface ViewBody {
  id: string;
  name: string;
  /** ObjectType value, or "star" for the central body. */
  type: string;
  /** id of the parent body (moons), else null. */
  parentId: string | null;
  /** ellipse semi-major/minor and focus offset (world units). */
  ellipse: { a: number; b: number; c: number };
  /** orbital-plane position at the requested time (world units). */
  position: { x: number; y: number };
  /** visual sphere/disc radius (world units). */
  visualR: number;
  /** original generator data (read-only) for panels/overlays. */
  data: CelestialObject | SolarSystem["star"];
}

function flatten(
  obj: CelestialObject,
  parentId: string | null,
  isMoon: boolean,
  out: ViewBody[],
): void {
  const { a, b, c } = orbitParams(obj.orbitRadius, obj.eccentricity, isMoon);
  out.push({
    id: obj.id,
    name: obj.name,
    type: obj.type,
    parentId,
    ellipse: { a, b, c },
    position: { x: 0, y: 0 },
    visualR: visualRadius(obj.radius),
    data: obj,
  });
  for (const moon of obj.moons ?? []) flatten(moon, obj.id, true, out);
}

/** Build the time-resolved view-model for a system at `elapsedDays`. */
export function buildViewModel(
  system: SolarSystem,
  elapsedDays: number,
): ViewBody[] {
  const bodies: ViewBody[] = [];

  bodies.push({
    id: "star",
    name: `${system.star.spectralType}-type Star`,
    type: "star",
    parentId: null,
    ellipse: { a: 0, b: 0, c: 0 },
    position: { x: 0, y: 0 },
    visualR: visualRadius(system.star.radius * SOLAR_TO_EARTH_RADII),
    data: system.star,
  });

  const sorted = [...system.objects].sort((a, b) => a.orbitRadius - b.orbitRadius);
  for (const obj of sorted) flatten(obj, null, false, bodies);

  // Resolve positions parent-before-child (parents precede their moons in `bodies`).
  const byId: Record<string, ViewBody> = {};
  for (const body of bodies) {
    byId[body.id] = body;
    if (body.type === "star") continue;
    const angle = angleAtTime(
      ((body.data as CelestialObject).orbitalPhase ?? 0) * Math.PI * 2,
      (body.data as CelestialObject).orbitPeriod || 1,
      elapsedDays,
    );
    const local = orbitPosition(body.ellipse.a, body.ellipse.b, body.ellipse.c, angle);
    if (body.parentId === null) {
      body.position = local;
    } else {
      const parent = byId[body.parentId];
      body.position = { x: parent.position.x + local.x, y: parent.position.y + local.y };
    }
  }

  return bodies;
}
