/**
 * Thin features: walls of a thickness along the curves of a sketch, instead of the areas they enclose.
 *
 * The curves (lines, arcs and circles that are not construction geometry) form chains that meet end to
 * end; open chains become walls with square ends, closed chains rings. Each chain is offset exactly to
 * one side, the other side or half to each: offset lines stay lines, offset arcs and circles share their
 * center. At corners the offsets meet where they cross (a sharp corner); on the outside of a very sharp
 * corner an arc around the corner joins them instead. The walls are a profile like any other, so
 * extrusions and revolutions build them with all their options. Wall faces are named after their curve
 * and side ("<curve>:left|right" for open chains, "<curve>:inner|outer" for closed ones), the ends of open
 * chains "<curve>:start|end", arcs around sharp corners "<curve>:<next curve>:join".
 */

import { polygonArea, Vertices, type Profile, type ProfileEdge, type ProfileLoop, type ProfileRegion } from './profile.ts';
import { ORIGIN_ID, type SketchData } from './sketch.ts';
import type { Point2 } from './spline.ts';

/**
 * Where the walls go: to one side of the curves (outside a closed outline, to the right of an open
 * chain walked from its lower left end), to the other side, or half to each.
 */
export type ThinSide = 'one' | 'other' | 'both';

export const THIN_SIDES: readonly ThinSide[] = ['one', 'other', 'both'];

export const DEFAULT_THIN_THICKNESS = 2;

/** Why the walls cannot be built: no curves, a curve that cannot be offset, a branch, or walls too thick for the curves. */
export type ThinProblem =
  | { code: 'thin-empty' }
  | { code: 'thin-unsupported'; curve: string }
  | { code: 'thin-branching'; at: Point2 }
  | { code: 'thin-too-thick' };

type Edge = Extract<ProfileEdge, { kind: 'line' | 'arc' }>;

interface Step {
  /** The sketch curve. */
  id: string;
  edge: Edge;
}

const ARC_STEPS = 24;

const sub = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point2, b: Point2): Point2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Point2, s: number): Point2 => [a[0] * s, a[1] * s];
const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];
const distance = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const polar = (center: Point2, radius: number, angle: number): Point2 => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];

function startOf(edge: Edge): Point2 {
  return edge.kind === 'line' ? edge.from : polar(edge.center, edge.radius, edge.start);
}

function endOf(edge: Edge): Point2 {
  return edge.kind === 'line' ? edge.to : polar(edge.center, edge.radius, edge.end);
}

function reversed(edge: Edge): Edge {
  return edge.kind === 'line' ? { kind: 'line', from: edge.to, to: edge.from } : { ...edge, start: edge.end, end: edge.start, ccw: !edge.ccw };
}

/** Unit tangent of an edge at its start or end, in its direction. */
function tangent(edge: Edge, atEnd: boolean): Point2 {
  if (edge.kind === 'line') {
    const d = sub(edge.to, edge.from);
    return scale(d, 1 / Math.hypot(d[0], d[1]));
  }
  const angle = atEnd ? edge.end : edge.start;
  const sign = edge.ccw ? 1 : -1;
  return [-Math.sin(angle) * sign, Math.cos(angle) * sign];
}

/** Points along an edge (its end left out), for areas and crossing checks. */
function sample(edge: Edge): Point2[] {
  if (edge.kind === 'line') return [edge.from];
  const sweep = edge.end - edge.start;
  const steps = Math.max(4, Math.ceil((ARC_STEPS * Math.abs(sweep)) / Math.PI));
  return Array.from({ length: steps }, (_, i) => polar(edge.center, edge.radius, edge.start + (sweep * i) / steps));
}

const polylineOf = (edges: readonly Edge[]): Point2[] => edges.flatMap(sample);

/** The edge moved `offset` to its left (negative: right); null when an arc would shrink to nothing. */
function offsetEdge(edge: Edge, offset: number, tolerance: number): Edge | null {
  if (edge.kind === 'line') {
    const n: Point2 = [-tangent(edge, false)[1], tangent(edge, false)[0]];
    return { kind: 'line', from: add(edge.from, scale(n, offset)), to: add(edge.to, scale(n, offset)) };
  }
  // Walking counterclockwise, left is towards the center.
  const radius = edge.ccw ? edge.radius - offset : edge.radius + offset;
  return radius > tolerance ? { ...edge, radius } : null;
}

/** Where the curves the two edges lie on (lines without end, whole circles) cross. */
function intersections(a: Edge, b: Edge): Point2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const [r, s] = [sub(a.to, a.from), sub(b.to, b.from)];
    const denominator = cross(r, s);
    if (Math.abs(denominator) < 1e-12 * dot(r, r) * dot(s, s) || denominator === 0) return [];
    return [add(a.from, scale(r, cross(sub(b.from, a.from), s) / denominator))];
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    const d = distance(a.center, b.center);
    if (d === 0 || d > a.radius + b.radius || d < Math.abs(a.radius - b.radius)) return [];
    const along = (a.radius ** 2 - b.radius ** 2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2));
    const u = scale(sub(b.center, a.center), 1 / d);
    const m = add(a.center, scale(u, along));
    return [add(m, scale([-u[1], u[0]], h)), add(m, scale([u[1], -u[0]], h))];
  }
  const [line, arc] = (a.kind === 'line' ? [a, b] : [b, a]) as [Extract<Edge, { kind: 'line' }>, Extract<Edge, { kind: 'arc' }>];
  const r = sub(line.to, line.from);
  const f = sub(line.from, arc.center);
  const [qa, qb, qc] = [dot(r, r), 2 * dot(f, r), dot(f, f) - arc.radius ** 2];
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].map((t) => add(line.from, scale(r, t)));
}

/** The angle of `point` around an arc's center, taken near `near` (no jump by a full turn). */
function angleNear(center: Point2, point: Point2, near: number): number {
  let angle = Math.atan2(point[1] - center[1], point[0] - center[0]);
  while (angle - near > Math.PI) angle -= 2 * Math.PI;
  while (near - angle > Math.PI) angle += 2 * Math.PI;
  return angle;
}

function withEnd(edge: Edge, point: Point2): Edge {
  return edge.kind === 'line' ? { ...edge, to: point } : { ...edge, end: angleNear(edge.center, point, edge.end) };
}

function withStart(edge: Edge, point: Point2): Edge {
  return edge.kind === 'line' ? { ...edge, from: point } : { ...edge, start: angleNear(edge.center, point, edge.start) };
}

/** Whether an offset edge still runs the way the original does (trimming at a corner did not turn it over). */
function sameWay(original: Edge, edge: Edge, tolerance: number): boolean {
  if (edge.kind === 'line') return dot(sub(edge.to, edge.from), sub(endOf(original), startOf(original))) > tolerance * tolerance;
  const sweep = edge.end - edge.start;
  return (edge.ccw ? sweep : -sweep) > tolerance / edge.radius && Math.abs(sweep) < 2 * Math.PI;
}

/** A sharp corner reaching further out than this many wall thicknesses gets an arc around it instead. */
const MITER_LIMIT = 4;

/**
 * The chain moved `offset` to its left, with its pieces joined at the corners; `names` gives the wall
 * name of each piece. Null when the walls are too thick for the curves.
 */
function offsetChain(steps: readonly Step[], closed: boolean, offset: number, name: (id: string) => string, tolerance: number): { edges: Edge[]; names: string[] } | null {
  if (offset === 0) return { edges: steps.map((step) => step.edge), names: steps.map((step) => name(step.id)) };
  const pieces: (Edge | null)[] = steps.map((step) => offsetEdge(step.edge, offset, tolerance));
  if (pieces.some((piece) => piece === null)) return null;
  const edges = pieces as Edge[];
  const names = steps.map((step) => name(step.id));
  // Joins between piece i and the next; inserted arcs are collected per corner.
  const joins = new Map<number, { edge: Edge; name: string }>();
  const corners = closed ? steps.length : steps.length - 1;
  for (let i = 0; i < corners; i++) {
    const j = (i + 1) % steps.length;
    const [a, b] = [edges[i] as Edge, edges[j] as Edge];
    const [p, q] = [endOf(a), startOf(b)];
    if (distance(p, q) <= tolerance) continue;
    const corner = endOf((steps[i] as Step).edge);
    // Turning left puts the left offsets on the inside of the corner, where they cross.
    const turn = cross(tangent((steps[i] as Step).edge, true), tangent((steps[j] as Step).edge, false));
    const inside = turn > 0 === offset > 0;
    const candidates = intersections(a, b).sort((u, v) => distance(u, corner) - distance(v, corner));
    const meet = candidates[0];
    if (meet && (inside || distance(meet, corner) <= MITER_LIMIT * Math.abs(offset))) {
      edges[i] = withEnd(a, meet);
      edges[j] = withStart(edges[j] as Edge, meet);
      continue;
    }
    if (inside) return null;
    // Outside a very sharp corner: an arc around the corner from one offset to the next.
    const start = Math.atan2(p[1] - corner[1], p[0] - corner[0]);
    const end = angleNear(corner, q, start);
    joins.set(i, { edge: { kind: 'arc', center: corner, radius: Math.abs(offset), start, end, ccw: end > start }, name: `${(steps[i] as Step).id}:${(steps[j] as Step).id}:join` });
  }
  if (edges.some((edge, i) => !sameWay((steps[i] as Step).edge, edge, tolerance))) return null;
  const result: { edges: Edge[]; names: string[] } = { edges: [], names: [] };
  edges.forEach((edge, i) => {
    result.edges.push(edge);
    result.names.push(names[i] as string);
    const join = joins.get(i);
    if (join) {
      result.edges.push(join.edge);
      result.names.push(join.name);
    }
  });
  return result;
}

/** Whether a closed polyline crosses itself (segments that do not share a point). */
function crossesItself(points: readonly Point2[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [a, b] = [points[i] as Point2, points[(i + 1) % n] as Point2];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [c, d] = [points[j] as Point2, points[(j + 1) % n] as Point2];
      const [r, s] = [sub(b, a), sub(d, c)];
      const denominator = cross(r, s);
      if (denominator === 0) continue;
      const t = cross(sub(c, a), s) / denominator;
      const u = cross(sub(c, a), r) / denominator;
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return true;
    }
  }
  return false;
}

function loop(edges: Edge[], names: string[]): ProfileLoop {
  const polygon = polylineOf(edges);
  return { edges, curves: names, area: polygonArea(polygon), polygon };
}

function reversedLoop(edges: readonly Edge[], names: readonly string[]): { edges: Edge[]; names: string[] } {
  return { edges: [...edges].reverse().map(reversed), names: [...names].reverse() };
}

/** The sketch's curves as chains of edges, each walked in one direction. */
function chainsOf(sketch: SketchData): { chains: { steps: Step[]; closed: boolean }[]; circles: { id: string; center: Point2; radius: number }[] } | ThinProblem {
  const positions = new Map<string, Point2>([[ORIGIN_ID, [0, 0]]]);
  for (const entity of sketch.entities) if (entity.type === 'point') positions.set(entity.id, [entity.x, entity.y]);
  let size = 1;
  for (const [x, y] of positions.values()) size = Math.max(size, Math.abs(x), Math.abs(y));
  const vertices = new Vertices(1e-7 * size);
  const curves: { step: Step; from: number; to: number }[] = [];
  const circles: { id: string; center: Point2; radius: number }[] = [];
  for (const entity of sketch.entities) {
    if (entity.type === 'point' || entity.construction) continue;
    if (entity.type === 'line') {
      const [a, b] = [positions.get(entity.p1), positions.get(entity.p2)];
      if (!a || !b || distance(a, b) === 0) continue;
      curves.push({ step: { id: entity.id, edge: { kind: 'line', from: a, to: b } }, from: vertices.of(a), to: vertices.of(b) });
    } else if (entity.type === 'arc') {
      const [c, s, e] = [positions.get(entity.center), positions.get(entity.start), positions.get(entity.end)];
      if (!c || !s || !e) continue;
      const radius = distance(s, c);
      if (radius === 0) continue;
      const start = Math.atan2(s[1] - c[1], s[0] - c[0]);
      let sweep = Math.atan2(e[1] - c[1], e[0] - c[0]) - start;
      while (sweep <= 0) sweep += 2 * Math.PI;
      curves.push({ step: { id: entity.id, edge: { kind: 'arc', center: c, radius, start, end: start + sweep, ccw: true } }, from: vertices.of(s), to: vertices.of(e) });
    } else if (entity.type === 'circle') {
      const c = positions.get(entity.center);
      if (c && entity.radius > 0) circles.push({ id: entity.id, center: c, radius: entity.radius });
    } else {
      return { code: 'thin-unsupported', curve: entity.id };
    }
  }
  const at = new Map<number, number[]>();
  curves.forEach((curve, i) => {
    at.set(curve.from, [...(at.get(curve.from) ?? []), i]);
    at.set(curve.to, [...(at.get(curve.to) ?? []), i]);
  });
  for (const [vertex, list] of at) if (list.length > 2) return { code: 'thin-branching', at: vertices.points[vertex] as Point2 };
  const used = new Set<number>();
  const walk = (vertex: number, first: number): Step[] => {
    const steps: Step[] = [];
    for (let v = vertex, i: number | undefined = first; i !== undefined && !used.has(i); ) {
      used.add(i);
      const curve = curves[i] as (typeof curves)[number];
      const forward = curve.from === v;
      steps.push({ id: curve.step.id, edge: forward ? curve.step.edge : reversed(curve.step.edge) });
      v = forward ? curve.to : curve.from;
      i = (at.get(v) ?? []).find((other) => !used.has(other));
    }
    return steps;
  };
  const chains: { steps: Step[]; closed: boolean }[] = [];
  // Open chains start at a free end, so every one is walked whole.
  for (const [vertex, list] of at) if (list.length === 1 && !used.has(list[0] as number)) chains.push({ steps: walk(vertex, list[0] as number), closed: false });
  curves.forEach((curve, i) => {
    if (!used.has(i)) chains.push({ steps: walk(curve.from, i), closed: true });
  });
  return { chains, circles };
}

/** Lexicographic order of points with a tolerance on x. */
const before = (a: Point2, b: Point2, tolerance: number) => a[0] < b[0] - tolerance || (Math.abs(a[0] - b[0]) <= tolerance && a[1] < b[1]);

/**
 * The walls along the curves of a sketch as a profile: one region per chain of curves. `thickness` is
 * the wall thickness; `side` says where the walls go (see ThinSide).
 */
export function thinProfile(sketch: SketchData, side: ThinSide, thickness: number): Profile | ThinProblem {
  const found = chainsOf(sketch);
  if ('code' in found) return found;
  const { chains, circles } = found;
  if (chains.length === 0 && circles.length === 0) return { code: 'thin-empty' };
  // Offsets to the left of the walking direction; the default side is the right one.
  const [left, right] = side === 'one' ? [0, -thickness] : side === 'other' ? [thickness, 0] : [thickness / 2, -thickness / 2];
  const regions: ProfileRegion[] = [];
  for (const circle of circles) {
    // Walked counterclockwise, left is inside.
    const [inner, outer] = [circle.radius - left, circle.radius - right];
    if (!(inner > 1e-9 * circle.radius)) return { code: 'thin-too-thick' };
    const ring = (radius: number, ccw: boolean, name: string): ProfileLoop => {
      const polygon = Array.from({ length: 2 * ARC_STEPS }, (_, i) => polar(circle.center, radius, ((ccw ? 1 : -1) * 2 * Math.PI * i) / (2 * ARC_STEPS)));
      return { edges: [{ kind: 'circle', center: circle.center, radius, ccw }], curves: [name], area: polygonArea(polygon), polygon };
    };
    regions.push({ outer: ring(outer, true, `${circle.id}:outer`), holes: [ring(inner, false, `${circle.id}:inner`)] });
  }
  for (const chain of chains) {
    let steps = chain.steps;
    const polyline = polylineOf(steps.map((step) => step.edge));
    const size = Math.max(1, ...polyline.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
    const tolerance = 1e-9 * size;
    const flip = () => steps.map((step) => ({ id: step.id, edge: reversed(step.edge) })).reverse();
    // A closed chain runs counterclockwise (left is inside), an open one from its lower left end.
    if (chain.closed ? polygonArea(polyline) < 0 : before(endOf((steps.at(-1) as Step).edge), startOf((steps[0] as Step).edge), 1e-7 * size)) steps = flip();
    // Walls are named after their side, whichever of them lies on the curves: switching sides keeps the names.
    const a = offsetChain(steps, chain.closed, left, (id) => `${id}:${chain.closed ? 'inner' : 'left'}`, tolerance);
    const b = offsetChain(steps, chain.closed, right, (id) => `${id}:${chain.closed ? 'outer' : 'right'}`, tolerance);
    if (!a || !b) return { code: 'thin-too-thick' };
    let region: ProfileRegion;
    if (chain.closed) {
      // The right offset is the outer loop (counterclockwise), the left one the hole (clockwise).
      const hole = reversedLoop(a.edges, a.names);
      region = { outer: loop(b.edges, b.names), holes: [loop(hole.edges, hole.names)] };
      const inner = region.holes[0] as ProfileLoop;
      if (!(region.outer.area > 0) || !(inner.area < 0) || crossesItself(region.outer.polygon) || crossesItself(inner.polygon)) return { code: 'thin-too-thick' };
    } else {
      // Along the right offset, across the end, back along the left offset and across the start.
      const [first, last] = [(steps[0] as Step).id, (steps.at(-1) as Step).id];
      const back = reversedLoop(a.edges, a.names);
      const edges: Edge[] = [...b.edges, { kind: 'line', from: endOf(b.edges.at(-1) as Edge), to: endOf(a.edges.at(-1) as Edge) }, ...back.edges, { kind: 'line', from: startOf(a.edges[0] as Edge), to: startOf(b.edges[0] as Edge) }];
      const names = [...b.names, `${last}:end`, ...back.names, `${first}:start`];
      let outline = loop(edges, names);
      if (outline.area < 0) {
        const turned = reversedLoop(edges, names);
        outline = loop(turned.edges, turned.names);
      }
      if (crossesItself(outline.polygon)) return { code: 'thin-too-thick' };
      region = { outer: outline, holes: [] };
    }
    regions.push(region);
  }
  return { regions, problems: [] };
}
