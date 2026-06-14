import { assertAlmostEquals, assertEquals } from "@std/assert";
import { buildTerminal, oberthBurn } from "./terminal.ts";
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

Deno.test("oberthBurn: hyperbolic→circular burn is positive and grows with v∞", () => {
  const body = { mu: 1.2e8, radiusM: 6.0e7 }; // giant-ish, m³/s² and m
  const slow = oberthBurn(body, 1000); // 1 km/s excess
  const fast = oberthBurn(body, 8000); // 8 km/s excess
  if (!(slow > 0)) throw new Error("expected positive burn");
  if (!(fast > slow)) throw new Error("higher v∞ must cost more");
});

Deno.test("buildTerminal: dock arrive is a single velocity-kill stage", () => {
  const t = buildTerminal(body, EndState.Dock, vInf, "arrive");
  assertEquals(t.stages.length, 1);
  assertEquals(t.stages[0].kind, "dock");
  assertAlmostEquals(t.stages[0].deltaV, vInf / 1000, 1e-9); // km/s
  assertAlmostEquals(t.totalDeltaV, vInf / 1000, 1e-9);
  assertEquals(t.phase, "arrive");
});

Deno.test("buildTerminal: dock depart is a single velocity-kill stage", () => {
  const t = buildTerminal(body, EndState.Dock, vInf, "depart");
  assertEquals(t.stages.length, 1);
  assertEquals(t.stages[0].kind, "dock");
  assertAlmostEquals(t.totalDeltaV, vInf / 1000, 1e-9);
  assertEquals(t.phase, "depart");
});

Deno.test("buildTerminal: dock ignores body mu/radius (massless station)", () => {
  const massless = { mu: 0, radiusM: 0 };
  const t = buildTerminal(massless, EndState.Dock, vInf, "arrive");
  assertAlmostEquals(t.totalDeltaV, vInf / 1000, 1e-9);
  if (!Number.isFinite(t.totalDeltaV)) throw new Error("dock Δv must be finite");
});
