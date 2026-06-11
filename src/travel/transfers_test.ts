import { assertAlmostEquals } from "@std/assert";
import { hohmann, sweepTransfers } from "./transfers.ts";
import { AU_M, muStar } from "./units.ts";

const MU = muStar(1);

Deno.test("hohmann: 1 AU → 1.524 AU burns ≈ 2.94 / 2.65 km/s", () => {
  const h = hohmann(1 * AU_M, 1.524 * AU_M, MU);
  assertAlmostEquals(h.dvDepart / 1000, 2.94, 0.05); // km/s
  assertAlmostEquals(h.dvArrive / 1000, 2.65, 0.05);
});

Deno.test("sweepTransfers: cheapest candidate ≈ Hohmann total for circular coplanar orbits", () => {
  const from = { orbitRadiusAu: 1, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0 };
  const to = { orbitRadiusAu: 1.524, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0.5 };
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
  assertAlmostEquals((best.vInfDepart + best.vInfArrive) / 1000, hohmannTotalKmps, 0.3);
});

Deno.test("sweepTransfers: produces only finite candidates", () => {
  const from = { orbitRadiusAu: 1, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0 };
  const to = { orbitRadiusAu: 1.524, eccentricity: 0, periapsisAngle: 0, orbitalPhase: 0.5 };
  const cands = sweepTransfers(from, to, MU, {
    departHorizonDays: 800, departSamples: 30, tofMinDays: 100, tofMaxDays: 700, tofSamples: 30,
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
