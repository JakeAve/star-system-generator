// src/travel/sum.ts
// Correctly-rounded, order-independent float summation via Math.sumPrecise
// (TC39 proposal-math-sum, ES2025). Runtimes ship it, but Deno's lib types do not declare
// it yet, hence the narrow cast.
const mathSumPrecise = (Math as unknown as {
  sumPrecise(values: Iterable<number>): number;
}).sumPrecise;

/**
 * Sum a list of floats with a single final rounding. Used for route durations: summing the
 * positive leg/terminal components avoids the catastrophic cancellation of differencing two
 * large absolute timeline values (arriveTime - departAt), so equal-time routes at different
 * departure dates produce bit-identical durations.
 */
export function sumPrecise(parts: number[]): number {
  return mathSumPrecise(parts);
}
