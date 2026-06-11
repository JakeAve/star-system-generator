import type { EndpointBody } from "./terminal.ts";
import { hohmann } from "./transfers.ts";
import { mToAu, sToDay } from "./units.ts";

/**
 * Hohmann appendage between a low circular orbit at the parent's radius and a moon's
 * orbit radius (both about the parent). The parent-side orbit has free phase, so no
 * moon-phasing wait is needed and this is a pure closed-form transfer.
 */
export function planetoAppendage(
  parent: EndpointBody,
  moonOrbitRadiusM: number,
): {
  legDeltaVMps: number;
  moonVInfMps: number;
  tofDays: number;
  aAu: number;
  e: number;
} {
  const rLow = parent.radiusM;
  const rMoon = moonOrbitRadiusM;
  const h = hohmann(rLow, rMoon, parent.mu);
  return {
    legDeltaVMps: h.dvDepart, // low-orbit-side injection/circularization burn
    moonVInfMps: h.dvArrive, // moon-orbit-side velocity mismatch = capture/escape v∞
    tofDays: sToDay(h.tof),
    aAu: mToAu((rLow + rMoon) / 2),
    e: Math.abs(rMoon - rLow) / (rMoon + rLow),
  };
}
