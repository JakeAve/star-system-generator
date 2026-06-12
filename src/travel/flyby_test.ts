import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  evaluateFlyby,
  maxTurnAngle,
  periapsisForTurn,
  turnAngle,
} from "./flyby.ts";
import type { EndpointBody } from "./terminal.ts";

const EARTH: EndpointBody = { mu: 3.986e14, radiusM: 6.371e6 };

Deno.test("turnAngle: tighter periapsis and slower v∞ bend the path more", () => {
  const close = turnAngle(5000, EARTH.radiusM, EARTH.mu);
  const far = turnAngle(5000, EARTH.radiusM * 4, EARTH.mu);
  if (!(close > far)) throw new Error("closer periapsis should turn more");
  const slow = turnAngle(3000, EARTH.radiusM, EARTH.mu);
  const fast = turnAngle(9000, EARTH.radiusM, EARTH.mu);
  if (!(slow > fast)) throw new Error("slower v∞ should turn more");
});

Deno.test("periapsisForTurn: inverts turnAngle", () => {
  const rp = EARTH.radiusM * 2.3;
  const turn = turnAngle(5000, rp, EARTH.mu);
  assertAlmostEquals(periapsisForTurn(5000, turn, EARTH.mu), rp, 1);
});

Deno.test("maxTurnAngle: achieved at periapsis = body radius", () => {
  assertAlmostEquals(
    maxTurnAngle(5000, EARTH),
    turnAngle(5000, EARTH.radiusM, EARTH.mu),
    1e-12,
  );
});

Deno.test("evaluateFlyby: a feasible unpowered turn costs no Δv", () => {
  const vIn = { x: 5000, y: 0 };
  // Rotate by 0.4 rad — well within Earth's ~1.6 rad capacity at this v∞.
  const a = 0.4;
  const vOut = {
    x: vIn.x * Math.cos(a) - vIn.y * Math.sin(a),
    y: vIn.x * Math.sin(a) + vIn.y * Math.cos(a),
  };
  const fb = evaluateFlyby(vIn, vOut, EARTH);
  assertAlmostEquals(fb.deltaV, 0, 1e-6);
  assertAlmostEquals(fb.turnAngle, a, 1e-6);
  assertAlmostEquals(fb.vInfinity, 5000, 1e-9);
  if (!(fb.periapsisRadius >= EARTH.radiusM)) {
    throw new Error("periapsis must not dip below the body radius");
  }
});

Deno.test("evaluateFlyby: a speed change requires a powered burn", () => {
  const vIn = { x: 5000, y: 0 };
  const vOut = { x: 6000, y: 0 }; // same direction, faster — pure magnitude change
  const fb = evaluateFlyby(vIn, vOut, EARTH);
  assertAlmostEquals(fb.deltaV, 1000, 1e-6);
});

Deno.test("evaluateFlyby: a turn beyond capacity clamps periapsis at the body radius", () => {
  const vIn = { x: 8000, y: 0 };
  const dMax = maxTurnAngle(8000, EARTH);
  // Demand 1.5× the achievable bend.
  const a = dMax * 1.5;
  const vOut = {
    x: vIn.x * Math.cos(a) - vIn.y * Math.sin(a),
    y: vIn.x * Math.sin(a) + vIn.y * Math.cos(a),
  };
  const fb = evaluateFlyby(vIn, vOut, EARTH);
  assertAlmostEquals(fb.periapsisRadius, EARTH.radiusM, 1);
  assertEquals(fb.turnAngle <= dMax + 1e-9, true);
  if (!(fb.deltaV > 0)) throw new Error("excess turn must cost Δv");
});

Deno.test("evaluateFlyby: a speed change during a deep turn is discounted by Oberth", () => {
  // A 1.0 rad turn (within Earth's ~1.6 rad capacity at this v∞) forces a finite, fairly
  // deep periapsis. Asking for a faster outgoing v∞ then costs far less than the naive
  // v∞-space chord, because the burn happens deep in the well.
  const vIn = { x: 5000, y: 0 };
  const a = 1.0;
  const speedOut = 6000;
  const vOut = {
    x: speedOut * Math.cos(a),
    y: speedOut * Math.sin(a),
  };
  const fb = evaluateFlyby(vIn, vOut, EARTH);

  // Naive v∞-space chord (the old, Oberth-blind cost): rotate vIn by the turn, magnitude
  // preserved, then measure the straight-line gap to vOut.
  const ax = vIn.x * Math.cos(a) - vIn.y * Math.sin(a);
  const ay = vIn.x * Math.sin(a) + vIn.y * Math.cos(a);
  const naiveChord = Math.hypot(vOut.x - ax, vOut.y - ay); // == 1000 here

  if (!(fb.deltaV > 0)) throw new Error("a speed change still needs a burn");
  if (!(fb.deltaV < naiveChord)) {
    throw new Error(
      `Oberth should discount the burn: got ${fb.deltaV}, chord ${naiveChord}`,
    );
  }
  // Sanity on the closed form: Δv = |√(vOut²+2μ/rp) − √(vIn²+2μ/rp)| at the turn's periapsis.
  const k = 2 * EARTH.mu / fb.periapsisRadius;
  const expected = Math.abs(
    Math.sqrt(speedOut * speedOut + k) - Math.sqrt(5000 * 5000 + k),
  );
  assertAlmostEquals(fb.deltaV, expected, 1e-6);
  if (!Number.isFinite(fb.periapsisRadius)) {
    throw new Error("a turning flyby must have a finite periapsis");
  }
});
