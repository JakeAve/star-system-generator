import { assertAlmostEquals, assertEquals } from "@std/assert";
import { hohmann, sweepTransfers } from "./transfers.ts";
import { AU_M, muStar } from "./units.ts";

const MU = muStar(1);

Deno.test("hohmann: 1 AU → 1.524 AU burns ≈ 2.94 / 2.65 km/s", () => {
  const h = hohmann(1 * AU_M, 1.524 * AU_M, MU);
  assertAlmostEquals(h.dvDepart / 1000, 2.94, 0.05); // km/s
  assertAlmostEquals(h.dvArrive / 1000, 2.65, 0.05);
});

Deno.test("sweepTransfers: cheapest candidate ≈ Hohmann total for circular coplanar orbits", () => {
  const from = {
    orbitRadiusAu: 1,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0,
    retrograde: false,
  };
  const to = {
    orbitRadiusAu: 1.524,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0.5,
    retrograde: false,
  };
  const cands = sweepTransfers(from, to, MU, {
    departHorizonDays: 800,
    departSamples: 40,
    tofMinDays: 200,
    tofMaxDays: 400,
    tofSamples: 40,
  });
  const h = hohmann(1 * AU_M, 1.524 * AU_M, MU);
  const hohmannTotalKmps = (h.dvDepart + h.dvArrive) / 1000;
  const best = cands.reduce((m, c) =>
    c.vInfDepart + c.vInfArrive < m.vInfDepart + m.vInfArrive ? c : m
  );
  assertAlmostEquals(
    (best.vInfDepart + best.vInfArrive) / 1000,
    hohmannTotalKmps,
    0.3,
  );
});

Deno.test("sweepTransfers: produces only finite candidates", () => {
  const from = {
    orbitRadiusAu: 1,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0,
    retrograde: false,
  };
  const to = {
    orbitRadiusAu: 1.524,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0.5,
    retrograde: false,
  };
  const cands = sweepTransfers(from, to, MU, {
    departHorizonDays: 800,
    departSamples: 30,
    tofMinDays: 100,
    tofMaxDays: 700,
    tofSamples: 30,
  });
  if (cands.length === 0) throw new Error("expected candidates");
  for (const c of cands) {
    if (!Number.isFinite(c.vInfDepart) || !Number.isFinite(c.vInfArrive)) {
      throw new Error("non-finite candidate leaked through");
    }
    if (!Number.isFinite(c.aAu) || !Number.isFinite(c.e)) {
      throw new Error("non-finite conic leaked through");
    }
  }
});

Deno.test("sweepTransfers: discards physically-absurd v∞ artifacts", () => {
  const from = {
    orbitRadiusAu: 1,
    eccentricity: 0,
    periapsisAngle: 0,
    orbitalPhase: 0,
    retrograde: false,
  };
  const to = {
    orbitRadiusAu: 5.2,
    eccentricity: 0.05,
    periapsisAngle: 0.3,
    orbitalPhase: 0.25,
    retrograde: false,
  };
  const cands = sweepTransfers(from, to, MU, {
    departHorizonDays: 4000,
    departSamples: 60,
    tofMinDays: 50,
    tofMaxDays: 5000,
    tofSamples: 60,
  });
  if (cands.length === 0) throw new Error("expected candidates");
  for (const c of cands) {
    if (c.vInfDepart > 1e6 || c.vInfArrive > 1e6) {
      throw new Error(`absurd v∞ leaked: ${c.vInfDepart}, ${c.vInfArrive}`);
    }
  }
});

Deno.test("sweepTransfers: reframe samples depart at exact Δd spacing and tags candidates", () => {
  const mu = muStar(1);
  const from = { orbitRadiusAu: 1, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0, retrograde: false };
  const to = { orbitRadiusAu: 1.2, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0.3, retrograde: false };
  const opts = {
    departHorizonDays: 60,
    departSamples: 0, // ignored under reframe
    tofMinDays: 50,
    tofMaxDays: 130,
    tofSamples: 0, // ignored under reframe
  };
  const reframe = {
    deltaD: 5, minD: 4, maxD: 120, deltaT: 10, minT: 4, maxT: 120, recurDays: 200,
  };
  const cands = sweepTransfers(from, to, mu, opts, reframe);
  for (const c of cands) {
    assertEquals(c.recurDays, 200);
    assertEquals(c.phaseDay, c.departDay);
  }
  const departs = [...new Set(cands.map((c) => c.departDay))].sort((a, b) => a - b);
  for (const d of departs) assertAlmostEquals((d / 5) % 1, 0, 1e-9);
});

Deno.test("sweepTransfers: reframe windows nest (narrow depart set ⊆ wide depart set)", () => {
  const mu = muStar(1);
  const from = { orbitRadiusAu: 1, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0, retrograde: false };
  const to = { orbitRadiusAu: 1.2, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0.3, retrograde: false };
  const reframe = {
    deltaD: 5, minD: 4, maxD: 120, deltaT: 10, minT: 4, maxT: 120, recurDays: 500,
  };
  const base = { departSamples: 0, tofMinDays: 50, tofMaxDays: 130, tofSamples: 0 };
  const wide = sweepTransfers(from, to, mu, { ...base, departHorizonDays: 100 }, reframe);
  const narrow = sweepTransfers(from, to, mu, { ...base, departHorizonDays: 40 }, reframe);
  const wideSet = new Set(wide.map((c) => Math.round(c.departDay * 1e6) / 1e6));
  const narrowDeparts = [...new Set(narrow.map((c) => Math.round(c.departDay * 1e6) / 1e6))];
  for (const d of narrowDeparts) assertEquals(wideSet.has(d), true);
});

Deno.test("sweepTransfers: no reframe arg leaves candidates untagged (fixed path)", () => {
  const mu = muStar(1);
  const from = { orbitRadiusAu: 1, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0, retrograde: false };
  const to = { orbitRadiusAu: 1.2, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0.3, retrograde: false };
  const cands = sweepTransfers(from, to, mu, {
    departHorizonDays: 200, departSamples: 12, tofMinDays: 50, tofMaxDays: 130, tofSamples: 12,
  });
  for (const c of cands) {
    assertEquals(c.phaseDay, undefined);
    assertEquals(c.recurDays, undefined);
  }
});

Deno.test("sweepTransfers tags each candidate with the full transfer conic", () => {
  // Two coplanar circular orbits about a 1-solar-mass star.
  const mu = muStar(1);
  const from = { orbitRadiusAu: 1, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0, retrograde: false };
  const to = { orbitRadiusAu: 1.6, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0.3, retrograde: false };
  const cands = sweepTransfers(from, to, mu, {
    departHorizonDays: 200,
    departSamples: 4,
    tofMinDays: 60,
    tofMaxDays: 260,
    tofSamples: 4,
  });
  if (cands.length === 0) throw new Error("expected at least one candidate");
  for (const c of cands) {
    if (!Number.isFinite(c.argPeriapsis)) throw new Error("argPeriapsis not finite");
    if (!Number.isFinite(c.nu1) || !Number.isFinite(c.nu2)) {
      throw new Error("nu span not finite");
    }
  }
});
