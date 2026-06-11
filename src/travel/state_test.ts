import { assertAlmostEquals } from "@std/assert";
import { conic, stateAt } from "./state.ts";
import { AU_M, muStar } from "./units.ts";

const MU = muStar(1); // 1 solar mass central body

Deno.test("stateAt: circular orbit has |r|=a and speed=circular velocity", () => {
  const a = 1; // AU
  const s = stateAt(
    { orbitRadiusAu: a, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0 },
    MU,
    0,
  );
  const r = Math.hypot(s.position.x, s.position.y);
  const v = Math.hypot(s.velocity.x, s.velocity.y);
  assertAlmostEquals(r, a * AU_M, a * AU_M * 1e-9);
  assertAlmostEquals(v, Math.sqrt(MU / (a * AU_M)), 1); // 1 m/s
});

Deno.test("stateAt: at periapsis (phase 0) r=a(1-e) and speed matches vis-viva", () => {
  const a = 1.5, e = 0.3;
  const s = stateAt(
    { orbitRadiusAu: a, eccentricity: e, periapsisAngle: 0, orbitalPhase: 0 },
    MU,
    0,
  );
  const aM = a * AU_M;
  const r = Math.hypot(s.position.x, s.position.y);
  const v = Math.hypot(s.velocity.x, s.velocity.y);
  assertAlmostEquals(r, aM * (1 - e), aM * 1e-9);
  assertAlmostEquals(v, Math.sqrt(MU * (2 / r - 1 / aM)), 1); // 1 m/s
});

Deno.test("stateAt: speed matches vis-viva at an arbitrary later time", () => {
  const a = 2, e = 0.25;
  const periodDays = Math.sqrt(a ** 3) * 365.25;
  const s = stateAt(
    {
      orbitRadiusAu: a,
      eccentricity: e,
      periapsisAngle: 0.7,
      orbitalPhase: 0.1,
    },
    MU,
    periodDays * 0.37,
  );
  const aM = a * AU_M;
  const r = Math.hypot(s.position.x, s.position.y);
  const v = Math.hypot(s.velocity.x, s.velocity.y);
  assertAlmostEquals(v, Math.sqrt(MU * (2 / r - 1 / aM)), 1); // 1 m/s
});

Deno.test("conic: recovers a and e from a state vector", () => {
  const a = 1.8, e = 0.4;
  const s = stateAt(
    {
      orbitRadiusAu: a,
      eccentricity: e,
      periapsisAngle: 1.1,
      orbitalPhase: 0.22,
    },
    MU,
    123,
  );
  const c = conic(s.position, s.velocity, MU);
  assertAlmostEquals(c.aAu, a, 1e-6);
  assertAlmostEquals(c.e, e, 1e-6);
});
