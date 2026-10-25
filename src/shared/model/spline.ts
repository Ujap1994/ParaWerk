/**
 * Splines through points: a natural cubic spline (C2, no bending at its ends) parameterized by chord
 * length. The fit points are ordinary sketch points, so they snap, take relations and dimensions and
 * are moved by the solver; the curve follows from them.
 */

export type Point2 = readonly [number, number];

export interface SplineGeometry {
  /** The fit points without consecutive duplicates. */
  points: Point2[];
  /** Parameter (cumulative chord length) at each point. */
  knots: number[];
  /** Second derivatives at each point, per coordinate. */
  second: Point2[];
}

/** Second derivatives of a natural cubic spline through values y at parameters t (tridiagonal solve). */
function naturalSecondDerivatives(t: readonly number[], y: readonly number[]): number[] {
  const n = t.length - 1;
  const m = new Array<number>(n + 1).fill(0);
  if (n < 2) return m;
  // Thomas algorithm for the interior equations; the ends have m = 0.
  const diagonal = new Array<number>(n + 1).fill(0);
  const right = new Array<number>(n + 1).fill(0);
  const upper = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i++) {
    const h0 = (t[i] as number) - (t[i - 1] as number);
    const h1 = (t[i + 1] as number) - (t[i] as number);
    diagonal[i] = 2 * (h0 + h1);
    upper[i] = h1;
    right[i] = 6 * (((y[i + 1] as number) - (y[i] as number)) / h1 - ((y[i] as number) - (y[i - 1] as number)) / h0);
    if (i > 1) {
      const factor = h0 / (diagonal[i - 1] as number);
      diagonal[i] = (diagonal[i] as number) - factor * (upper[i - 1] as number);
      right[i] = (right[i] as number) - factor * (right[i - 1] as number);
    }
  }
  for (let i = n - 1; i >= 1; i--) m[i] = ((right[i] as number) - (upper[i] as number) * (m[i + 1] as number)) / (diagonal[i] as number);
  return m;
}

export function splineThrough(input: readonly Point2[]): SplineGeometry | null {
  const points: Point2[] = [];
  for (const p of input) {
    const last = points.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-12) points.push(p);
  }
  if (points.length < 2) return null;
  const knots = [0];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point2, points[i] as Point2];
    knots.push((knots[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const mx = naturalSecondDerivatives(knots, points.map((p) => p[0]));
  const my = naturalSecondDerivatives(knots, points.map((p) => p[1]));
  return { points, knots, second: mx.map((m, i) => [m, my[i] as number]) };
}

/** Total parameter range (chord length) of the spline. */
export function splineEnd(spline: SplineGeometry): number {
  return spline.knots[spline.knots.length - 1] as number;
}

/** The span (index of its first fit point) that contains parameter s; the first or last span outside the curve. */
function spanAt(spline: SplineGeometry, s: number): number {
  const knots = spline.knots;
  let [low, high] = [0, knots.length - 2];
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (s >= (knots[middle] as number)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Point, first and second derivative of span i at parameter s (the span's cubic, also outside it). */
function evaluateSpan(spline: SplineGeometry, i: number, s: number): SplineSample {
  const { points, knots, second } = spline;
  const h = (knots[i + 1] as number) - (knots[i] as number);
  const a = ((knots[i + 1] as number) - s) / h;
  const b = (s - (knots[i] as number)) / h;
  const value = (k: 0 | 1): [number, number, number] => {
    const [y0, y1] = [(points[i] as Point2)[k], (points[i + 1] as Point2)[k]];
    const [m0, m1] = [(second[i] as Point2)[k], (second[i + 1] as Point2)[k]];
    return [
      a * y0 + b * y1 + (((a * a * a - a) * m0 + (b * b * b - b) * m1) * h * h) / 6,
      (y1 - y0) / h + ((-(3 * a * a - 1) * m0 + (3 * b * b - 1) * m1) * h) / 6,
      a * m0 + b * m1,
    ];
  };
  const [x, y] = [value(0), value(1)];
  return { point: [x[0], y[0]], tangent: [x[1], y[1]], bend: [x[2], y[2]] };
}

/** A point of the spline with its first and second derivative by the parameter. */
export interface SplineSample {
  point: Point2;
  tangent: Point2;
  bend: Point2;
}

/**
 * Point and derivatives at parameter s. Beyond its ends the spline continues straight along its end
 * tangents; a natural spline does not bend at its ends, so the continued curve is still smooth (C2).
 */
export function splineAt(spline: SplineGeometry, s: number): SplineSample {
  const end = splineEnd(spline);
  if (s >= 0 && s <= end) return evaluateSpan(spline, spanAt(spline, s), s);
  const [i, from] = s < 0 ? [0, 0] : [spline.knots.length - 2, end];
  const { point, tangent } = evaluateSpan(spline, i, from);
  const d = s - from;
  return { point: [point[0] + d * tangent[0], point[1] + d * tangent[1]], tangent, bend: [0, 0] };
}

/** The point at parameter s (0 … total chord length); clamped to the ends. */
export function splinePoint(spline: SplineGeometry, s: number): Point2 {
  return splineAt(spline, Math.max(0, Math.min(splineEnd(spline), s))).point;
}

/** A stretch of a spline by parameter, from ≤ to; it may reach beyond the ends (the straight continuations). */
export type SplineRange = readonly [number, number];

/** The whole spline, from its first to its last fit point. */
export function fullRange(spline: SplineGeometry): SplineRange {
  return [0, splineEnd(spline)];
}

/**
 * Parameters from range[0] to range[1]: `perSpan` steps for every span (or straight continuation) the
 * range covers, fewer for a part of a span; the fit points inside the range are hit exactly.
 */
function rangeParameters(spline: SplineGeometry, range: SplineRange, perSpan: number): number[] {
  const [from, to] = range;
  const breaks = [from, ...spline.knots.filter((knot) => knot > from && knot < to), to];
  const end = splineEnd(spline);
  const result = [from];
  for (let i = 1; i < breaks.length; i++) {
    const [a, b] = [breaks[i - 1] as number, breaks[i] as number];
    // The span this piece lies in (straight continuations count as one span of their own length).
    const span = a >= end || b <= 0 ? b - a : (spline.knots[spanAt(spline, (a + b) / 2) + 1] as number) - (spline.knots[spanAt(spline, (a + b) / 2)] as number);
    const steps = Math.max(1, Math.ceil((perSpan * (b - a)) / Math.max(span, 1e-300)));
    for (let k = 1; k <= steps; k++) result.push(k === steps ? b : a + ((b - a) * k) / steps);
  }
  return result;
}

/** Coarse samples per span when searching the spline. */
const SEARCH_SAMPLES = 8;

export interface SplineProjection {
  /** Parameter of the nearest point. */
  s: number;
  at: Point2;
  distance: number;
  /** The distance, positive left of the spline's direction (from its first towards its last point). */
  signed: number;
}

/**
 * The point of the spline (or of the stretch `range`) nearest to p: coarse samples along every span, then
 * Newton steps on the parameter. With `extended`, the straight continuations beyond the ends count as
 * part of the curve, which keeps the signed distance smooth near the ends (the solver needs that).
 */
export function closestOnSpline(spline: SplineGeometry, p: Point2, extended = false, range: SplineRange = fullRange(spline)): SplineProjection {
  const end = splineEnd(spline);
  const squared = (q: Point2) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
  let s = range[0];
  let best = Infinity;
  for (const candidate of rangeParameters(spline, range, SEARCH_SAMPLES)) {
    const value = squared(splineAt(spline, candidate).point);
    if (value < best) [s, best] = [candidate, value];
  }
  if (extended) {
    // The straight continuations: exact projections onto the end tangents.
    for (const [from, side] of [[0, -1], [end, 1]] as const) {
      const { point, tangent } = splineAt(spline, from);
      const along = ((p[0] - point[0]) * tangent[0] + (p[1] - point[1]) * tangent[1]) / Math.max(tangent[0] ** 2 + tangent[1] ** 2, 1e-300);
      if (along * side <= 0) continue;
      const candidate = from + along;
      const value = squared(splineAt(spline, candidate).point);
      if (value < best) [s, best] = [candidate, value];
    }
  }
  const limit = (value: number) => (extended ? value : Math.max(range[0], Math.min(range[1], value)));
  for (let iteration = 0; iteration < 24; iteration++) {
    const { point, tangent, bend } = splineAt(spline, s);
    const [dx, dy] = [point[0] - p[0], point[1] - p[1]];
    // Half the derivative of the squared distance, and its derivative.
    const f = dx * tangent[0] + dy * tangent[1];
    const df = tangent[0] ** 2 + tangent[1] ** 2 + dx * bend[0] + dy * bend[1];
    if (!(df > 0)) break;
    const next = limit(s - f / df);
    if (Math.abs(next - s) <= 1e-15 * Math.max(1, end)) {
      s = next;
      break;
    }
    if (squared(splineAt(spline, next).point) > squared(point)) break;
    s = next;
  }
  const { point, tangent } = splineAt(spline, s);
  const distance = Math.sqrt(squared(point));
  const cross = tangent[0] * (p[1] - point[1]) - tangent[1] * (p[0] - point[0]);
  return { s, at: point, distance, signed: cross === 0 ? 0 : Math.sign(cross) * distance };
}

/**
 * Parameters where `signed` (evaluated at points of the spline) changes its sign, from samples along
 * every span (of `range`) refined by bisection; for crossings of the spline with other curves.
 */
export function splineRoots(spline: SplineGeometry, signed: (p: Point2) => number, samplesPerSpan = 16, range: SplineRange = fullRange(spline)): number[] {
  const roots: number[] = [];
  const valueAt = (s: number) => signed(splineAt(spline, s).point);
  const [first, ...rest] = rangeParameters(spline, range, samplesPerSpan);
  let [previousS, previous] = [first as number, valueAt(first as number)];
  if (previous === 0) roots.push(previousS);
  for (const s of rest) {
    const value = valueAt(s);
    if (value === 0) roots.push(s);
    else if (previous !== 0 && Number.isFinite(value) && Number.isFinite(previous) && Math.sign(value) !== Math.sign(previous)) {
      let [low, high, lowValue] = [previousS, s, previous];
      for (let step = 0; step < 60; step++) {
        const middle = (low + high) / 2;
        const middleValue = valueAt(middle);
        if (Math.sign(middleValue) === Math.sign(lowValue)) [low, lowValue] = [middle, middleValue];
        else high = middle;
      }
      roots.push((low + high) / 2);
    }
    [previousS, previous] = [s, value];
  }
  return roots;
}

/** The spline (or the stretch `range` of it) as a polyline with `perSpan` segments between neighboring fit points. */
export function splinePolyline(spline: SplineGeometry, perSpan: number, range: SplineRange = fullRange(spline)): Point2[] {
  return rangeParameters(spline, range, perSpan).map((s) => splineAt(spline, s).point);
}

/**
 * Segments per span that keep the polyline within `tolerance` of the curve: the chord deviation of a
 * cubic is at most h²·|f''|/8 over a span of length h.
 */
export function segmentsPerSpan(spline: SplineGeometry, tolerance: number): number {
  let worst = 1;
  for (let i = 1; i < spline.knots.length; i++) {
    const h = (spline.knots[i] as number) - (spline.knots[i - 1] as number);
    const bend = Math.max(Math.hypot(...(spline.second[i - 1] as Point2)), Math.hypot(...(spline.second[i] as Point2)));
    worst = Math.max(worst, Math.ceil(h * Math.sqrt(bend / (8 * Math.max(tolerance, 1e-12)))));
  }
  return Math.min(256, worst);
}

/** Length of the spline or of the stretch `range` (from a fine polyline). */
export function splineLength(spline: SplineGeometry, range: SplineRange = fullRange(spline)): number {
  const polyline = splinePolyline(spline, 32, range);
  let length = 0;
  for (let i = 1; i < polyline.length; i++) length += Math.hypot((polyline[i] as Point2)[0] - (polyline[i - 1] as Point2)[0], (polyline[i] as Point2)[1] - (polyline[i - 1] as Point2)[1]);
  return length;
}
