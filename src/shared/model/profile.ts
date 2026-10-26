/**
 * Profiles of sketches: the closed outlines that extrude and revolve turn into faces.
 *
 * Every closed outline of the sketch (construction geometry and open curves do not count) bounds
 * material; an outline inside another one cuts a hole into it, an outline inside a hole is material
 * again (even-odd nesting). Curves that meet at their end points form outlines; lines that only divide
 * an outline from within do not split it. Curves that cross each other are reported, because the
 * outlines would be ambiguous.
 *
 * The edges keep the exact geometry: lines, arcs, circles, ellipses and splines as cubic Bézier spans in
 * the spline's own parameter, so the kernel can build them without approximation.
 */

import { ORIGIN_ID, type SketchData, type SketchEntity, type SketchSpline } from './sketch.ts';
import { closestOnSpline, splineAt, splineEnd, splinePolyline, splineThrough, type Point2, type SplineGeometry, type SplineRange } from './spline.ts';

/** One curve of a profile loop in sketch coordinates, oriented in the direction the loop runs. */
export type ProfileEdge =
  | { kind: 'line'; from: Point2; to: Point2 }
  /** From angle `start` to angle `end` around `center`, counterclockwise if `ccw` (angles in radians). */
  | { kind: 'arc'; center: Point2; radius: number; start: number; end: number; ccw: boolean }
  | { kind: 'circle'; center: Point2; radius: number; ccw: boolean }
  /** `axis` is the unit direction of the semi-axis `a`; `b` lies to its left. */
  | { kind: 'ellipse'; center: Point2; axis: Point2; a: number; b: number; ccw: boolean }
  /**
   * A cubic B-spline made of Bézier spans: poles 3k+1, knots k+1 (strictly increasing), every inner knot
   * shared by two spans. Exact for ParaWerk's splines, which are cubic between their fit points.
   */
  | { kind: 'bspline'; poles: Point2[]; knots: number[] };

/** A closed loop of edges; outer loops run counterclockwise, holes clockwise. */
export interface ProfileLoop {
  edges: ProfileEdge[];
  /** The sketch curves of the loop, in order. */
  curves: string[];
  /** Signed area (positive for counterclockwise), from a fine polyline. */
  area: number;
  /** The fine polyline the area comes from, in the direction of the loop. */
  polygon: Point2[];
}

export interface ProfileRegion {
  outer: ProfileLoop;
  holes: ProfileLoop[];
}

export type ProfileProblem = { kind: 'crossing'; curves: [string, string]; at: Point2 };

export interface Profile {
  regions: ProfileRegion[];
  problems: ProfileProblem[];
}

/** Segments per span of a curve's polyline (for areas, containment and crossing checks). */
const POLYLINE_STEPS = 24;

export interface Curve {
  id: string;
  /** Vertex ids at the start and the end (equal for closed curves). */
  from: number;
  to: number;
  polyline: Point2[];
  /** Direction and signed curvature where the curve leaves its start, and (backwards) its end. */
  leaveStart: { angle: number; curvature: number };
  leaveEnd: { angle: number; curvature: number };
  edge(forward: boolean): ProfileEdge;
}

function cross(a: Point2, b: Point2): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function polygonArea(points: readonly Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) area += cross(points[i] as Point2, points[(i + 1) % points.length] as Point2);
  return area / 2;
}

/** Leaving direction (angle) and signed curvature of a curve with first and second derivative d1, d2. */
function departure(d1: Point2, d2: Point2): { angle: number; curvature: number } {
  const speed = Math.hypot(d1[0], d1[1]);
  return { angle: Math.atan2(d1[1], d1[0]), curvature: speed > 0 ? cross(d1, d2) / speed ** 3 : 0 };
}

/** The spline of a sketch entity with the stretch it shows (trim ends projected onto the curve). */
function trimmedSpline(curve: SketchSpline, positions: ReadonlyMap<string, Point2>): { spline: SplineGeometry; range: SplineRange } | null {
  const points = curve.points.map((id) => positions.get(id));
  if (points.some((p) => p === undefined)) return null;
  const spline = splineThrough(points as Point2[]);
  if (!spline) return null;
  const at = (id: string | undefined, fallback: number): number | null => {
    if (id === undefined) return fallback;
    const p = positions.get(id);
    return p ? closestOnSpline(spline, p, true).s : null;
  };
  const from = at(curve.start, 0);
  const to = at(curve.end, splineEnd(spline));
  if (from === null || to === null) return null;
  return { spline, range: from <= to ? [from, to] : [to, from] };
}

/** Cubic Bézier spans of a spline stretch: poles and knots (the spline's own parameter). */
function bezierSpans(spline: SplineGeometry, range: SplineRange): { poles: Point2[]; knots: number[] } {
  const [from, to] = range;
  const knots = [from, ...spline.knots.filter((knot) => knot > from && knot < to), to];
  const poles: Point2[] = [splineAt(spline, from).point];
  for (let i = 1; i < knots.length; i++) {
    const [a, b] = [knots[i - 1] as number, knots[i] as number];
    const [start, end] = [splineAt(spline, a), splineAt(spline, b)];
    const third = (b - a) / 3;
    poles.push(
      [start.point[0] + start.tangent[0] * third, start.point[1] + start.tangent[1] * third],
      [end.point[0] - end.tangent[0] * third, end.point[1] - end.tangent[1] * third],
      end.point,
    );
  }
  return { poles, knots };
}

/** Merges end points that lie in the same place into vertices. */
export class Vertices {
  private readonly cells = new Map<string, number[]>();
  readonly points: Point2[] = [];
  private readonly tolerance: number;

  constructor(tolerance: number) {
    this.tolerance = tolerance;
  }

  of(p: Point2): number {
    const size = this.tolerance * 4;
    const [cx, cy] = [Math.floor(p[0] / size), Math.floor(p[1] / size)];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const index of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = this.points[index] as Point2;
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= this.tolerance) return index;
        }
      }
    }
    const index = this.points.push(p) - 1;
    const key = `${cx},${cy}`;
    this.cells.set(key, [...(this.cells.get(key) ?? []), index]);
    return index;
  }
}

export function sketchSize(positions: ReadonlyMap<string, Point2>, entities: readonly SketchEntity[]): number {
  let size = 1;
  for (const [x, y] of positions.values()) size = Math.max(size, Math.abs(x), Math.abs(y));
  for (const entity of entities) if (entity.type === 'circle') size = Math.max(size, entity.radius);
  return size;
}

/** Closed curves (circles, ellipses, closed splines) as loops of their own. */
export interface ClosedCurve {
  id: string;
  polyline: Point2[];
  edge(ccw: boolean): ProfileEdge;
}

export function curvesOf(sketch: SketchData, vertices: Vertices): { open: Curve[]; closed: ClosedCurve[] } {
  const positions = new Map<string, Point2>([[ORIGIN_ID, [0, 0]]]);
  for (const entity of sketch.entities) if (entity.type === 'point') positions.set(entity.id, [entity.x, entity.y]);
  const open: Curve[] = [];
  const closed: ClosedCurve[] = [];
  for (const entity of sketch.entities) {
    if (entity.type === 'point' || entity.construction) continue;
    if (entity.type === 'line') {
      const [a, b] = [positions.get(entity.p1), positions.get(entity.p2)];
      if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) === 0) continue;
      const direction: Point2 = [b[0] - a[0], b[1] - a[1]];
      open.push({
        id: entity.id,
        from: vertices.of(a),
        to: vertices.of(b),
        polyline: [a, b],
        leaveStart: departure(direction, [0, 0]),
        leaveEnd: departure([-direction[0], -direction[1]], [0, 0]),
        edge: (forward) => (forward ? { kind: 'line', from: a, to: b } : { kind: 'line', from: b, to: a }),
      });
    } else if (entity.type === 'arc') {
      const [c, s, e] = [positions.get(entity.center), positions.get(entity.start), positions.get(entity.end)];
      if (!c || !s || !e) continue;
      const radius = Math.hypot(s[0] - c[0], s[1] - c[1]);
      if (radius === 0) continue;
      const start = Math.atan2(s[1] - c[1], s[0] - c[0]);
      let sweep = Math.atan2(e[1] - c[1], e[0] - c[0]) - start;
      while (sweep <= 0) sweep += 2 * Math.PI;
      const end = start + sweep;
      const at = (angle: number): Point2 => [c[0] + radius * Math.cos(angle), c[1] + radius * Math.sin(angle)];
      const steps = Math.max(4, Math.ceil((POLYLINE_STEPS * sweep) / Math.PI));
      const polyline = Array.from({ length: steps + 1 }, (_, i) => (i === 0 ? s : i === steps ? at(end) : at(start + (sweep * i) / steps)));
      const tangent = (angle: number, sign: number): Point2 => [-Math.sin(angle) * radius * sign, Math.cos(angle) * radius * sign];
      const inward = (angle: number): Point2 => [-Math.cos(angle) * radius, -Math.sin(angle) * radius];
      open.push({
        id: entity.id,
        from: vertices.of(s),
        to: vertices.of(e),
        polyline,
        leaveStart: departure(tangent(start, 1), inward(start)),
        leaveEnd: departure(tangent(end, -1), inward(end)),
        edge: (forward) => (forward ? { kind: 'arc', center: c, radius, start, end, ccw: true } : { kind: 'arc', center: c, radius, start: end, end: start, ccw: false }),
      });
    } else if (entity.type === 'circle') {
      const c = positions.get(entity.center);
      if (!c || !(entity.radius > 0)) continue;
      const steps = POLYLINE_STEPS * 2;
      const polyline = Array.from({ length: steps }, (_, i): Point2 => [c[0] + entity.radius * Math.cos((2 * Math.PI * i) / steps), c[1] + entity.radius * Math.sin((2 * Math.PI * i) / steps)]);
      closed.push({ id: entity.id, polyline, edge: (ccw) => ({ kind: 'circle', center: c, radius: entity.radius, ccw }) });
    } else if (entity.type === 'ellipse') {
      const [c, major, minor] = [positions.get(entity.center), positions.get(entity.major), positions.get(entity.minor)];
      if (!c || !major || !minor) continue;
      const a = Math.hypot(major[0] - c[0], major[1] - c[1]);
      const b = Math.hypot(minor[0] - c[0], minor[1] - c[1]);
      if (a === 0 || b === 0) continue;
      const axis: Point2 = [(major[0] - c[0]) / a, (major[1] - c[1]) / a];
      const normal: Point2 = [-axis[1], axis[0]];
      const steps = POLYLINE_STEPS * 2;
      const polyline = Array.from({ length: steps }, (_, i): Point2 => {
        const t = (2 * Math.PI * i) / steps;
        const [x, y] = [a * Math.cos(t), b * Math.sin(t)];
        return [c[0] + x * axis[0] + y * normal[0], c[1] + x * axis[1] + y * normal[1]];
      });
      closed.push({ id: entity.id, polyline, edge: (ccw) => ({ kind: 'ellipse', center: c, axis, a, b, ccw }) });
    } else {
      const trimmed = trimmedSpline(entity, positions);
      if (!trimmed) continue;
      const { spline, range } = trimmed;
      const polyline = splinePolyline(spline, POLYLINE_STEPS, range);
      const [first, last] = [polyline[0] as Point2, polyline.at(-1) as Point2];
      const spans = bezierSpans(spline, range);
      const reversed = (): ProfileEdge => ({
        kind: 'bspline',
        poles: [...spans.poles].reverse(),
        knots: spans.knots.map((knot) => range[0] + range[1] - knot).reverse(),
      });
      const from = vertices.of(first);
      const to = vertices.of(last);
      if (from === to) {
        // A closed spline: a loop of its own.
        const ccw = polygonArea(polyline) > 0;
        closed.push({ id: entity.id, polyline: polyline.slice(0, -1), edge: (wantCcw) => (wantCcw === ccw ? { kind: 'bspline', ...spans } : reversed()) });
        continue;
      }
      const [start, end] = [splineAt(spline, range[0]), splineAt(spline, range[1])];
      open.push({
        id: entity.id,
        from,
        to,
        polyline,
        leaveStart: departure(start.tangent, start.bend),
        leaveEnd: departure([-end.tangent[0], -end.tangent[1]], end.bend),
        edge: (forward) => (forward ? { kind: 'bspline', ...spans } : reversed()),
      });
    }
  }
  return { open, closed };
}

/** Removes curves that end in a vertex no other curve reaches (they cannot bound anything). */
function pruneDangling(curves: Curve[]): Curve[] {
  let remaining = curves;
  for (;;) {
    const degree = new Map<number, number>();
    for (const curve of remaining) {
      degree.set(curve.from, (degree.get(curve.from) ?? 0) + 1);
      degree.set(curve.to, (degree.get(curve.to) ?? 0) + 1);
    }
    const kept = remaining.filter((curve) => (degree.get(curve.from) ?? 0) > 1 && (degree.get(curve.to) ?? 0) > 1);
    if (kept.length === remaining.length) return kept;
    remaining = kept;
  }
}

interface HalfEdge {
  curve: Curve;
  forward: boolean;
  /** Vertex it leaves and vertex it reaches. */
  from: number;
  to: number;
  leave: { angle: number; curvature: number };
}

/**
 * The outer boundaries of the connected groups of curves: walking every face of the planar graph
 * (each step takes the sharpest left turn) yields the bounded faces counterclockwise and the outer
 * boundary of each group clockwise. Boundaries that touch themselves are split into simple loops; the
 * back-and-forth over a curve that bridges two outlines encloses nothing and is dropped.
 */
function outerBoundaries(curves: readonly Curve[], minArea: number): HalfEdge[][] {
  const halves: HalfEdge[] = [];
  for (const curve of curves) {
    halves.push({ curve, forward: true, from: curve.from, to: curve.to, leave: curve.leaveStart });
    halves.push({ curve, forward: false, from: curve.to, to: curve.from, leave: curve.leaveEnd });
  }
  const twin = (index: number) => index ^ 1;
  // Half-edges leaving each vertex, counterclockwise; at equal angles the more left-turning one comes later.
  const around = new Map<number, number[]>();
  halves.forEach((half, index) => around.set(half.from, [...(around.get(half.from) ?? []), index]));
  for (const list of around.values()) {
    list.sort((i, j) => {
      const [a, b] = [(halves[i] as HalfEdge).leave, (halves[j] as HalfEdge).leave];
      const delta = a.angle - b.angle;
      return Math.abs(delta) > 1e-9 ? delta : a.curvature - b.curvature;
    });
  }
  const next = (index: number): number => {
    const back = twin(index);
    const list = around.get((halves[back] as HalfEdge).from) as number[];
    const position = list.indexOf(back);
    // The next half-edge clockwise from the way back keeps the face on the left.
    return list[(position - 1 + list.length) % list.length] as number;
  };
  const visited = new Uint8Array(halves.length);
  const result: HalfEdge[][] = [];
  for (let start = 0; start < halves.length; start++) {
    if (visited[start]) continue;
    const cycle: number[] = [];
    for (let index = start; !visited[index]; index = next(index)) {
      visited[index] = 1;
      cycle.push(index);
    }
    const loop = cycle.map((index) => halves[index] as HalfEdge);
    if (polygonArea(loopPolyline(loop)) < 0) result.push(...splitAtRepeats(loop).filter((part) => polygonArea(loopPolyline(part)) < -minArea));
  }
  return result;
}

/** Splits a cycle that passes a vertex more than once into simple cycles. */
function splitAtRepeats(loop: HalfEdge[]): HalfEdge[][] {
  const result: HalfEdge[][] = [];
  const stack: HalfEdge[] = [];
  const seen = new Map<number, number>();
  for (const half of loop) {
    const from = half.from;
    if (seen.has(from)) {
      const begin = seen.get(from) as number;
      result.push(stack.splice(begin));
      for (const [vertex, index] of [...seen]) if (index >= begin) seen.delete(vertex);
    }
    seen.set(from, stack.length);
    stack.push(half);
  }
  if (stack.length > 0) result.push(stack);
  return result;
}

function loopPolyline(loop: readonly HalfEdge[]): Point2[] {
  const points: Point2[] = [];
  for (const half of loop) {
    const polyline = half.forward ? half.curve.polyline : [...half.curve.polyline].reverse();
    points.push(...polyline.slice(0, -1));
  }
  return points;
}

/** Whether p lies inside the polygon (even-odd rule). */
function inside(polygon: readonly Point2[], p: Point2): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i] as Point2, polygon[j] as Point2];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

interface Outline {
  polygon: Point2[];
  area: number;
  /** The loop running counterclockwise or clockwise. */
  loop(ccw: boolean): ProfileLoop;
}

/** Proper crossings between curves (not where they meet at shared end points). */
function crossings(polylines: { id: string; points: Point2[]; ends: Point2[] }[], tolerance: number): ProfileProblem[] {
  const boxes = polylines.map(({ points }) => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return [Math.min(...xs) - tolerance, Math.min(...ys) - tolerance, Math.max(...xs) + tolerance, Math.max(...ys) + tolerance] as const;
  });
  const problems: ProfileProblem[] = [];
  for (let i = 0; i < polylines.length; i++) {
    for (let j = i + 1; j < polylines.length; j++) {
      const [a, b] = [boxes[i] as readonly number[], boxes[j] as readonly number[]];
      if ((a[0] as number) > (b[2] as number) || (b[0] as number) > (a[2] as number) || (a[1] as number) > (b[3] as number) || (b[1] as number) > (a[3] as number)) continue;
      const [first, second] = [polylines[i] as { id: string; points: Point2[]; ends: Point2[] }, polylines[j] as { id: string; points: Point2[]; ends: Point2[] }];
      const at = firstCrossing(first.points, second.points, [...first.ends, ...second.ends], tolerance);
      if (at) problems.push({ kind: 'crossing', curves: [first.id, second.id], at });
    }
  }
  return problems;
}

function firstCrossing(p: readonly Point2[], q: readonly Point2[], ends: readonly Point2[], tolerance: number): Point2 | null {
  for (let i = 1; i < p.length; i++) {
    const [a, b] = [p[i - 1] as Point2, p[i] as Point2];
    for (let j = 1; j < q.length; j++) {
      const [c, d] = [q[j - 1] as Point2, q[j] as Point2];
      const r: Point2 = [b[0] - a[0], b[1] - a[1]];
      const s: Point2 = [d[0] - c[0], d[1] - c[1]];
      const denominator = cross(r, s);
      if (Math.abs(denominator) < 1e-15) continue;
      const t = cross([c[0] - a[0], c[1] - a[1]], s) / denominator;
      const u = cross([c[0] - a[0], c[1] - a[1]], r) / denominator;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const at: Point2 = [a[0] + r[0] * t, a[1] + r[1] * t];
      // Meeting at an end point (shared or lying on the other curve) is how outlines connect.
      if (ends.some((end) => Math.hypot(end[0] - at[0], end[1] - at[1]) <= tolerance * 1e3)) continue;
      return at;
    }
  }
  return null;
}

/** The closed outlines of a sketch as regions with holes, ready to become faces. */
export function sketchProfile(sketch: SketchData): Profile {
  const positions = new Map<string, Point2>([[ORIGIN_ID, [0, 0]]]);
  for (const entity of sketch.entities) if (entity.type === 'point') positions.set(entity.id, [entity.x, entity.y]);
  const tolerance = 1e-7 * sketchSize(positions, sketch.entities);
  const vertices = new Vertices(tolerance);
  const { open, closed } = curvesOf(sketch, vertices);

  const problems = crossings(
    [
      ...open.map((curve) => ({ id: curve.id, points: curve.polyline, ends: [curve.polyline[0] as Point2, curve.polyline.at(-1) as Point2] })),
      ...closed.map((curve) => ({ id: curve.id, points: [...curve.polyline, curve.polyline[0] as Point2], ends: [] })),
    ],
    tolerance,
  );

  const outlines: Outline[] = [];
  for (const boundary of outerBoundaries(pruneDangling(open), (tolerance * 10) ** 2)) {
    // The boundary runs clockwise around its group; the outline of the group is the same loop reversed.
    const polygon = loopPolyline(boundary).reverse();
    const area = polygonArea(polygon);
    const forwardEdges = [...boundary].reverse().map((half) => half.curve.edge(!half.forward));
    const backwardEdges = boundary.map((half) => half.curve.edge(half.forward));
    const curves = [...boundary].reverse().map((half) => half.curve.id);
    outlines.push({
      polygon,
      area,
      loop: (ccw) =>
        ccw ? { edges: forwardEdges, curves, area, polygon } : { edges: backwardEdges, curves: [...curves].reverse(), area: -area, polygon: [...polygon].reverse() },
    });
  }
  for (const curve of closed) {
    const area = Math.abs(polygonArea(curve.polyline));
    const polygon = polygonArea(curve.polyline) > 0 ? curve.polyline : [...curve.polyline].reverse();
    outlines.push({ polygon, area, loop: (ccw) => ({ edges: [curve.edge(ccw)], curves: [curve.id], area: ccw ? area : -area, polygon: ccw ? polygon : [...polygon].reverse() }) });
  }

  // Even-odd nesting: the smallest outline around each one is its parent.
  outlines.sort((a, b) => b.area - a.area);
  const depth: number[] = [];
  const parent: number[] = [];
  outlines.forEach((outline, i) => {
    const probe = outline.polygon[0] as Point2;
    let found = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (inside((outlines[j] as Outline).polygon, probe)) {
        found = j;
        break;
      }
    }
    parent.push(found);
    depth.push(found < 0 ? 0 : (depth[found] as number) + 1);
  });
  const regions: ProfileRegion[] = [];
  const regionOf = new Map<number, ProfileRegion>();
  outlines.forEach((outline, i) => {
    if ((depth[i] as number) % 2 === 0) {
      const region = { outer: outline.loop(true), holes: [] };
      regionOf.set(i, region);
      regions.push(region);
    } else {
      regionOf.get(parent[i] as number)?.holes.push(outline.loop(false));
    }
  });
  return { regions, problems };
}
