import { assertAlmostEquals, assertEquals } from "@std/assert";
import { buildTerminal } from "./terminal.ts";
import { EndState } from "./types.ts";
import { muBody, R_EARTH_M } from "./units.ts";

const body = { mu: muBody(1), radiusM: R_EARTH_M }; // Earth-like
const vInf = 3000; // m/s

Deno.test("buildTerminal: intercept is free", () => {
  const t = buildTerminal(body, EndState.Intercept, vInf, "arrive");
  assertEquals(t.totalDeltaV, 0);
  assertEquals(t.stages.length, 0);
});

Deno.test("buildTerminal: orbit capture matches Oberth formula", () => {
  const t = buildTerminal(body, EndState.Orbit, vInf, "arrive");
  const vHyp = Math.sqrt(vInf * vInf + 2 * body.mu / body.radiusM);
  const vCirc = Math.sqrt(body.mu / body.radiusM);
  assertAlmostEquals(t.totalDeltaV, (vHyp - vCirc) / 1000, 1e-3); // km/s
  assertEquals(t.stages[0].kind, "capture");
});

Deno.test("buildTerminal: surface > orbit > intercept in Δv", () => {
  const i = buildTerminal(body, EndState.Intercept, vInf, "arrive").totalDeltaV;
  const o = buildTerminal(body, EndState.Orbit, vInf, "arrive").totalDeltaV;
  const s = buildTerminal(body, EndState.Surface, vInf, "arrive").totalDeltaV;
  if (!(s > o && o > i)) {
    throw new Error(`expected surface>orbit>intercept, got ${s},${o},${i}`);
  }
});

Deno.test("buildTerminal: near-massless body → capture Δv ≈ vInf (rendezvous)", () => {
  const tiny = { mu: muBody(1e-8), radiusM: 1e5 };
  const t = buildTerminal(tiny, EndState.Orbit, vInf, "arrive");
  assertAlmostEquals(t.totalDeltaV, vInf / 1000, 0.01);
});

Deno.test("buildTerminal: depart phase emits ascent then escape for surface", () => {
  const t = buildTerminal(body, EndState.Surface, vInf, "depart");
  assertEquals(t.phase, "depart");
  assertEquals(t.stages.map((s) => s.kind), ["ascent", "escape"]);
});
