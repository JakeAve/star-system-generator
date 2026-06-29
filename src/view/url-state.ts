// Pure parse/serialize of the viewer's URL query state. No DOM access.
// Seed lives in the hash and is handled separately by each page bootstrap.

export type FocusMode = "lock" | "frame";

export interface ViewState {
  /** ids to highlight (rings). */
  hl: string[];
  /** ids the camera targets. */
  focus: string[];
  /** explicit camera mode, or null to fall back to the default-by-count rule. */
  mode: FocusMode | null;
}

function idList(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse a `location.search` string (with or without leading "?") into state. */
export function parseViewState(search: string): ViewState {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const rawMode = params.get("mode");
  const mode: FocusMode | null = rawMode === "lock" || rawMode === "frame"
    ? rawMode
    : null;
  return {
    hl: idList(params.get("hl")),
    focus: idList(params.get("focus")),
    mode,
  };
}

/** Apply the default-by-count rule: single focus → lock, multiple → frame. */
export function resolveFocusMode(
  focus: string[],
  mode: FocusMode | null,
): FocusMode {
  if (mode === "lock" || mode === "frame") return mode;
  return focus.length > 1 ? "frame" : "lock";
}

/** Serialize state to a query string (no leading "?"). Omits empty params;
 *  `mode` is written (resolved) only when `focus` is non-empty. */
export function serializeViewState(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.hl.length > 0) params.set("hl", state.hl.join(","));
  if (state.focus.length > 0) {
    params.set("focus", state.focus.join(","));
    params.set("mode", resolveFocusMode(state.focus, state.mode));
  }
  return params.toString();
}
