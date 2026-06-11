import { assertEquals } from "@std/assert";
import { EndState, RankMode, RouteNodeKind } from "./types.ts";

Deno.test("types: enum string values are stable", () => {
  assertEquals(RouteNodeKind.Depart, "depart");
  assertEquals(RouteNodeKind.Arrive, "arrive");
  assertEquals(RouteNodeKind.Flyby, "flyby");
  assertEquals(RouteNodeKind.Transit, "transit");
  assertEquals(EndState.Orbit, "orbit");
  assertEquals(EndState.Surface, "surface");
  assertEquals(EndState.Intercept, "intercept");
  assertEquals(RankMode.Pareto, "pareto");
});
