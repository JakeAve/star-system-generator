// Pure geometry helpers shared by both renderers. Points are coordinate
// arrays (e.g. [x, y] for 2D, [x, y, z] for 3D); helpers are dimension-agnostic.

/** Component-wise average of a non-empty list of equal-length points. */
export function centroidOf(points: number[][]): number[] {
  if (points.length === 0) {
    throw new Error("centroidOf: requires at least one point");
  }
  const dims = points[0].length;
  const sum = new Array(dims).fill(0);
  for (const p of points) {
    for (let i = 0; i < dims; i++) sum[i] += p[i];
  }
  return sum.map((s) => s / points.length);
}

/** Largest Euclidean distance from `center` to any point. */
export function enclosingRadius(points: number[][], center: number[]): number {
  let max = 0;
  for (const p of points) {
    let d2 = 0;
    for (let i = 0; i < center.length; i++) {
      const d = p[i] - center[i];
      d2 += d * d;
    }
    max = Math.max(max, Math.sqrt(d2));
  }
  return max;
}
