// src/travel/sum.ts
// Correctly-rounded summation via Math.sumPrecise (TC39 proposal-math-sum, ES2025).
// Falls back to a Neumaier compensated sum for browsers that have not yet shipped it.
// The two implementations are numerically equivalent for all-positive inputs (route durations).
const nativeSumPrecise =
  typeof (Math as unknown as Record<string, unknown>).sumPrecise ===
      "function"
    ? (Math as unknown as { sumPrecise(values: Iterable<number>): number })
      .sumPrecise.bind(Math)
    : null;

function neumaierSum(values: Iterable<number>): number {
  let sum = 0;
  let c = 0;
  for (const v of values) {
    const t = sum + v;
    c += Math.abs(sum) >= Math.abs(v) ? (sum - t) + v : (v - t) + sum;
    sum = t;
  }
  return sum + c;
}

/**
 * Sum a list of floats with a single final rounding. Used for route durations: summing the
 * positive leg/terminal components avoids the catastrophic cancellation of differencing two
 * large absolute timeline values (arriveTime - departAt), so equal-time routes at different
 * departure dates produce bit-identical durations.
 */
export function sumPrecise(parts: number[]): number {
  return nativeSumPrecise ? nativeSumPrecise(parts) : neumaierSum(parts);
}
