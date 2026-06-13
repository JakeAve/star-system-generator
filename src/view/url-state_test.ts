import { assertEquals } from "@std/assert";
import {
  parseViewState,
  resolveFocusMode,
  serializeViewState,
} from "./url-state.ts";

Deno.test("parseViewState: empty query yields empty state", () => {
  assertEquals(parseViewState(""), { hl: [], focus: [], mode: null });
});

Deno.test("parseViewState: splits comma lists and trims/drops blanks", () => {
  const s = parseViewState("?hl=obj_3, obj_7 ,&focus=obj_7");
  assertEquals(s.hl, ["obj_3", "obj_7"]);
  assertEquals(s.focus, ["obj_7"]);
});

Deno.test("parseViewState: keeps only valid mode values", () => {
  assertEquals(parseViewState("?focus=obj_1&mode=lock").mode, "lock");
  assertEquals(parseViewState("?focus=obj_1&mode=frame").mode, "frame");
  assertEquals(parseViewState("?focus=obj_1&mode=bogus").mode, null);
  assertEquals(parseViewState("?focus=obj_1").mode, null);
});

Deno.test("resolveFocusMode: explicit mode wins", () => {
  assertEquals(resolveFocusMode(["a", "b"], "lock"), "lock");
  assertEquals(resolveFocusMode(["a"], "frame"), "frame");
});

Deno.test("resolveFocusMode: default is lock for single, frame for multiple", () => {
  assertEquals(resolveFocusMode(["a"], null), "lock");
  assertEquals(resolveFocusMode(["a", "b"], null), "frame");
});

Deno.test("serializeViewState: omits empty params", () => {
  assertEquals(serializeViewState({ hl: [], focus: [], mode: null }), "");
  assertEquals(
    serializeViewState({ hl: ["obj_3"], focus: [], mode: "lock" }),
    "hl=obj_3",
  );
});

Deno.test("serializeViewState: includes resolved mode when focus present", () => {
  assertEquals(
    serializeViewState({ hl: ["obj_7"], focus: ["obj_7"], mode: null }),
    "hl=obj_7&focus=obj_7&mode=lock",
  );
  assertEquals(
    serializeViewState({ hl: [], focus: ["obj_3", "obj_7"], mode: null }),
    "focus=obj_3%2Cobj_7&mode=frame",
  );
});

Deno.test("serializeViewState then parseViewState round-trips", () => {
  const state = { hl: ["obj_3", "obj_7"], focus: ["obj_7"], mode: "lock" as const };
  const parsed = parseViewState("?" + serializeViewState(state));
  assertEquals(parsed, state);
});
