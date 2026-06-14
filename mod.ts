// @jakeave/star-seeder — main entry (core generator + config + kinematics + view-model)
export {
  allObjects,
  generateSolarSystem,
  knownObjects,
} from "./src/core/generator.ts";
export { DEFAULT_CONFIG, pickArchetypeWeights } from "./src/core/config.ts";
export { deepMerge, resolveConfig } from "./src/core/config-merge.ts";
export {
  angleAtTime,
  AU_SCALE,
  BODY_SCALE,
  eccentricAngleAtTime,
  MIN_VISUAL_RADIUS,
  MOON_ORBIT_SCALE,
  orbitParams,
  orbitPosition,
  SOLAR_TO_EARTH_RADII,
  solveKepler,
  visualRadius,
} from "./src/core/kinematics.ts";
export { buildViewModel } from "./src/view/view-model.ts";
export type { ViewBody } from "./src/view/view-model.ts";
export {
  parseViewState,
  resolveFocusMode,
  serializeViewState,
} from "./src/view/url-state.ts";
export type { FocusMode, ViewState } from "./src/view/url-state.ts";
export type {
  ArchetypeProfile,
  CelestialObject,
  DeepPartial,
  GenerationSlot,
  GeneratorConfig,
  ResourceDeposit,
  SolarSystem,
  Star,
} from "./src/core/types.ts";
export {
  MigrationArchetype,
  ObjectType,
  Resource,
  SpectralType,
} from "./src/core/types.ts";
export {
  getBestRoutes,
  getBestRoutes3,
  getRoutes,
} from "./src/travel/index.ts";
export {
  buildRouteViewModel,
  routeViewForPick,
  routeViewsForPick,
} from "./src/view/route-view-model.ts";
export type {
  RouteGhostView,
  RouteLegView,
  RouteNodeView,
  RoutePickTarget,
  RouteView,
} from "./src/view/route-view-model.ts";
export type {
  Route,
  RouteLeg,
  RouteNode,
  RouteOptions,
  TerminalTransfer,
  TravelOptions,
  Waypoint,
} from "./src/travel/types.ts";
export { EndState, RankMode, RouteNodeKind } from "./src/travel/types.ts";
