import { planetoAppendage } from "./legs.ts";
import { auToM, mToAu } from "./units.ts";

Deno.test("planetoAppendage: outputs are positive and self-consistent", () => {
  const parent = { mu: 1.2e8 * 1e6, radiusM: 6.0e7 }; // giant μ (m³/s²), radius (m)
  const moonOrbitRadiusM = auToM(0.01); // moon orbit about parent
  const a = planetoAppendage(parent, moonOrbitRadiusM);
  if (!(a.legDeltaVMps > 0)) {
    throw new Error("expected positive injection burn");
  }
  if (!(a.moonVInfMps > 0)) throw new Error("expected positive moon v∞");
  if (!(a.tofDays > 0)) throw new Error("expected positive time of flight");
  // transfer semi-major axis (AU about parent) sits between low orbit and moon orbit
  const lowAu = mToAu(parent.radiusM);
  if (!(a.aAu > lowAu && a.aAu < 0.01)) {
    throw new Error("a must be between radii");
  }
  if (!(a.e > 0 && a.e < 1)) throw new Error("e must be a valid ellipse");
});

Deno.test("planetoAppendage: a closer moon is cheaper to reach than a far one", () => {
  const parent = { mu: 1.2e8 * 1e6, radiusM: 6.0e7 };
  const near = planetoAppendage(parent, auToM(0.005));
  const far = planetoAppendage(parent, auToM(0.05));
  if (!(far.tofDays > near.tofDays)) {
    throw new Error("farther moon → longer flight");
  }
  if (!(far.legDeltaVMps > near.legDeltaVMps)) {
    throw new Error("farther moon → larger injection burn");
  }
});
