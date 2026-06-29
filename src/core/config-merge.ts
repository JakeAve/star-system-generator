import type { DeepPartial, GeneratorConfig } from "./types.ts";
import { DEFAULT_CONFIG } from "./config.ts";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(target: T, source: DeepPartial<T>): T {
  const out: Record<string, unknown> = isPlainObject(target)
    ? { ...(target as Record<string, unknown>) }
    : (target as unknown as Record<string, unknown>);
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const sVal = (source as Record<string, unknown>)[key];
    const tVal = out[key];
    if (sVal === undefined) continue;
    if (isPlainObject(sVal) && isPlainObject(tVal)) {
      out[key] = deepMerge(tVal, sVal as DeepPartial<typeof tVal>);
    } else if (isPlainObject(sVal)) {
      out[key] = deepMerge({}, sVal as DeepPartial<unknown>);
    } else {
      out[key] = sVal;
    }
  }
  return out as T;
}

export function resolveConfig(
  overrides: DeepPartial<GeneratorConfig> = {},
): GeneratorConfig {
  return deepMerge(DEFAULT_CONFIG, overrides);
}
