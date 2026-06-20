import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { conic, type OrbitElements, stateAt, transferConic } from "./state.ts";
import { AU_M, muStar } from "./units.ts";

const MU = muStar(1); // 1 solar mass central body

Deno.test("stateAt: circular orbit has |r|=a and speed=circular velocity", () => {
  const a = 1; // AU
  const s = stateAt(
    { orbitRadiusAu: a, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0, retrograde: false },
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
    { orbitRadiusAu: a, eccentricity: e, periapsisAngle: 0, orbitalPhase: 0, retrograde: false },
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
      retrograde: false,
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
      retrograde: false,
    },
    MU,
    123,
  );
  const c = conic(s.position, s.velocity, MU);
  assertAlmostEquals(c.aAu, a, 1e-6);
  assertAlmostEquals(c.e, e, 1e-6);
});

Deno.test("transferConic recovers orientation and swept anomaly span from a known ellipse", () => {
  // A known prograde ellipse about a 1-solar-mass star.
  const mu = muStar(1);
  const el = {
    orbitRadiusAu: 1.5,
    eccentricity: 0.2,
    periapsisAngle: 0.7, // argument of periapsis we expect to recover
    orbitalPhase: 0,
    retrograde: false,
  };
  const s1 = stateAt(el, mu, 0);
  const s2 = stateAt(el, mu, 80); // 80 days later along the same orbit
  const tc = transferConic(s1.position, s1.velocity, s2.position, mu);

  // a and e match the source orbit.
  assertAlmostEquals(tc.aAu, 1.5, 1e-3);
  assertAlmostEquals(tc.e, 0.2, 1e-3);
  // argPeriapsis matches the source argument of periapsis.
  assertAlmostEquals(tc.argPeriapsis, 0.7, 1e-3);
  // Sampling the conic at nu1 reproduces r1's direction (perifocal -> world).
  const ang1 = Math.atan2(s1.position.y, s1.position.x);
  assertAlmostEquals(((tc.nu1 + tc.argPeriapsis) % (2 * Math.PI)), ((ang1) + 2 * Math.PI) % (2 * Math.PI), 1e-3);
  // Prograde motion sweeps forward: nu2 > nu1.
  if (!(tc.nu2 > tc.nu1)) throw new Error(`expected nu2 > nu1, got ${tc.nu1} -> ${tc.nu2}`);
  // Backward-compatible a/e agree with the legacy conic().
  const c = conic(s1.position, s1.velocity, mu);
  assertAlmostEquals(tc.aAu, c.aAu, 1e-9);
  assertAlmostEquals(tc.e, c.e, 1e-9);
});

Deno.test("stateAt: retrograde sweeps clockwise (mirror of prograde across the periapsis axis)", () => {
  const base = {
    orbitRadiusAu: 1,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0, // start on +x axis
  };
  const pro: OrbitElements = { ...base, retrograde: false };
  const retro: OrbitElements = { ...base, retrograde: true };

  const t = 30; // days; a small slice of a ~365-day orbit
  const sp = stateAt(pro, MU, t);
  const sr = stateAt(retro, MU, t);

  // Same starting axis → equal x; opposite angular sense → opposite y.
  assertAlmostEquals(sr.position.x, sp.position.x, 1);
  assertAlmostEquals(sr.position.y, -sp.position.y, 1);
  assert(sp.position.y > 0, "prograde sweeps to +y");
  assert(sr.position.y < 0, "retrograde sweeps to -y");
});

Deno.test("stateAt: retrograde reverses the specific angular momentum sign", () => {
  const el: OrbitElements = {
    orbitRadiusAu: 1,
    eccentricity: 0.1,
    periapsisAngle: 0.3,
    orbitalPhase: 0.2,
    retrograde: true,
  };
  const s = stateAt(el, MU, 0);
  const h = s.position.x * s.velocity.y - s.position.y * s.velocity.x;
  assert(h < 0, "retrograde => h = r x v < 0");

  const pro = stateAt({ ...el, retrograde: false }, MU, 0);
  const hp = pro.position.x * pro.velocity.y - pro.position.y * pro.velocity.x;
  assert(hp > 0, "prograde => h > 0");
});
