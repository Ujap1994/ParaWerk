/**
 * Paths of sketches: the one chain of curves a sweep follows. Lines, arcs, ellipses and splines that are
 * not construction geometry join end to end into a single chain, open or closed, or one closed curve
 * (a circle, an ellipse, a closed spline) is the whole path.
 */

import { curvesOf, sketchSize, Vertices, type Curve, type ProfileEdge } from './profile.ts';
import { ORIGIN_ID, type SketchData } from './sketch.ts';
import type { Point2 } from './spline.ts';

export interface SketchPath {
  /** The edges in the direction the path runs. */
  edges: ProfileEdge[];
  /** The sketch curve of each edge. */
  curves: string[];
  closed: boolean;
}

/** Why a sketch is no path: no curves, curves that branch, or curves that do not form one chain. */
export type PathProblem = { code: 'path-empty' } | { code: 'path-branching'; at: Point2 } | { code: 'path-gaps' };

export function sketchPath(sketch: SketchData): SketchPath | PathProblem {
  const positions = new Map<string, Point2>([[ORIGIN_ID, [0, 0]]]);
  for (const entity of sketch.entities) if (entity.type === 'point') positions.set(entity.id, [entity.x, entity.y]);
  const vertices = new Vertices(1e-7 * sketchSize(positions, sketch.entities));
  const { open, closed } = curvesOf(sketch, vertices);
  if (open.length === 0 && closed.length === 0) return { code: 'path-empty' };
  if (closed.length > 0) {
    const curve = closed[0];
    if (closed.length > 1 || open.length > 0 || !curve) return { code: 'path-gaps' };
    return { edges: [curve.edge(true)], curves: [curve.id], closed: true };
  }
  const at = new Map<number, Curve[]>();
  for (const curve of open) {
    at.set(curve.from, [...(at.get(curve.from) ?? []), curve]);
    at.set(curve.to, [...(at.get(curve.to) ?? []), curve]);
  }
  for (const [vertex, curves] of at) if (curves.length > 2) return { code: 'path-branching', at: vertices.points[vertex] as Point2 };
  // An open chain starts at one of its two free ends, a closed one anywhere.
  const ends = [...at].filter(([, curves]) => curves.length === 1).map(([vertex]) => vertex);
  let vertex = ends.length > 0 ? Math.min(...ends) : (open[0] as Curve).from;
  const used = new Set<Curve>();
  const path: SketchPath = { edges: [], curves: [], closed: ends.length === 0 };
  for (let curve = at.get(vertex)?.[0]; curve && !used.has(curve); ) {
    used.add(curve);
    const forward = curve.from === vertex;
    path.edges.push(curve.edge(forward));
    path.curves.push(curve.id);
    vertex = forward ? curve.to : curve.from;
    curve = at.get(vertex)?.find((next) => !used.has(next));
  }
  return used.size === open.length ? path : { code: 'path-gaps' };
}

/** Where an edge starts or (`end`) ends. */
export function edgePoint(edge: ProfileEdge, end: boolean): Point2 {
  switch (edge.kind) {
    case 'line':
      return end ? edge.to : edge.from;
    case 'arc': {
      const angle = end ? edge.end : edge.start;
      return [edge.center[0] + edge.radius * Math.cos(angle), edge.center[1] + edge.radius * Math.sin(angle)];
    }
    case 'circle':
      return [edge.center[0] + edge.radius, edge.center[1]];
    case 'ellipse':
      return [edge.center[0] + edge.a * edge.axis[0], edge.center[1] + edge.a * edge.axis[1]];
    case 'bspline':
      return (end ? edge.poles.at(-1) : edge.poles[0]) as Point2;
  }
}

function reversedEdge(edge: ProfileEdge): ProfileEdge {
  switch (edge.kind) {
    case 'line':
      return { kind: 'line', from: edge.to, to: edge.from };
    case 'arc':
      return { ...edge, start: edge.end, end: edge.start, ccw: !edge.ccw };
    case 'circle':
    case 'ellipse':
      return { ...edge, ccw: !edge.ccw };
    case 'bspline': {
      const [first, last] = [edge.knots[0] as number, edge.knots.at(-1) as number];
      return { kind: 'bspline', poles: [...edge.poles].reverse(), knots: edge.knots.map((knot) => first + last - knot).reverse() };
    }
  }
}

/** The same path walked the other way. */
export function reversedPath(path: SketchPath): SketchPath {
  return { edges: [...path.edges].reverse().map(reversedEdge), curves: [...path.curves].reverse(), closed: path.closed };
}
