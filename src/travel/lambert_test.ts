import { assertAlmostEquals } from "@std/assert";
import { solveLambert } from "./lambert.ts";
import { stateAt } from "./state.ts";
import { AU_M, DAY_S, muStar } from "./units.ts";

const MU = muStar(1);

Deno.test("solveLambert: recovers the velocities of a known short-way arc", () => {
  const a = 1.4, e = 0.2;
  const el = {
    orbitRadiusAu: a,
    eccentricity: e,
    periapsisAngle: 0.5,
    orbitalPhase: 0.05,
  };
  const periodDays = Math.sqrt(a ** 3) * 365.25;
  const t1 = periodDays * 0.05;
  const t2 = periodDays * 0.20; // < half period → short-way prograde
  const s1 = stateAt(el, MU, t1);
  const s2 = stateAt(el, MU, t2);
  const tof = (t2 - t1) * DAY_S;
  const { v1, v2 } = solveLambert(s1.position, s2.position, tof, MU, true);
  assertAlmostEquals(v1.x, s1.velocity.x, 5); // m/s
  assertAlmostEquals(v1.y, s1.velocity.y, 5);
  assertAlmostEquals(v2.x, s2.velocity.x, 5);
  assertAlmostEquals(v2.y, s2.velocity.y, 5);
});

Deno.test("solveLambert: 90°-apart points on a 1 AU circle give a prograde departure", () => {
  const r1 = { x: AU_M, y: 0 };
  const r2 = { x: 0, y: AU_M };
  const tofDays = 80;
  const { v1 } = solveLambert(r1, r2, tofDays * DAY_S, MU, true);
  assertAlmostEquals(Math.sign(v1.y), 1, 0); // moving counter-clockwise
});
