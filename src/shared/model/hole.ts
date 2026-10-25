/**
 * Holes for ISO metric screws: clearance holes, counterbores, countersinks and tapped holes, with their
 * standard dimensions and the half section the kernel turns into the hole.
 *
 * Sources of the standard values (all of them can be changed per hole):
 *   pitch            ISO 261 / ISO 262, coarse thread
 *   tap drill        ISO 2306, 6H
 *   clearance hole   ISO 273, series fine, medium, coarse
 *   counterbore      DIN 974-1 for cap screws ISO 4762 (with a medium clearance hole)
 *   countersink 90°  head diameter of countersunk screws ISO 10642 (M1.6–M2.5: ISO 2009) plus 0.3 mm
 */

import type { HoleFeature, HoleFit, HoleKind, Vec3 } from './feature.ts';
import type { Profile, ProfileEdge } from './profile.ts';
import type { SketchData } from './sketch.ts';
import type { Point2 } from './spline.ts';

export interface MetricSize {
  size: string;
  /** Nominal (major) diameter. */
  d: number;
  pitch: number;
  tapDrill: number;
  /** ISO 273: fine, medium, coarse. */
  clearance: readonly [number, number, number];
  counterbore: readonly [diameter: number, depth: number];
  /** Countersink diameter at the surface (90°); absent where there is no countersunk screw. */
  countersink?: number;
}

export const METRIC_SIZES: readonly MetricSize[] = [
  { size: 'M1.6', d: 1.6, pitch: 0.35, tapDrill: 1.25, clearance: [1.7, 1.8, 2], counterbore: [3.5, 1.8], countersink: 3.3 },
  { size: 'M2', d: 2, pitch: 0.4, tapDrill: 1.6, clearance: [2.2, 2.4, 2.6], counterbore: [4.4, 2.3], countersink: 4.1 },
  { size: 'M2.5', d: 2.5, pitch: 0.45, tapDrill: 2.05, clearance: [2.7, 2.9, 3.1], counterbore: [5.4, 2.8], countersink: 5 },
  { size: 'M3', d: 3, pitch: 0.5, tapDrill: 2.5, clearance: [3.2, 3.4, 3.6], counterbore: [6.5, 3.4], countersink: 7 },
  { size: 'M4', d: 4, pitch: 0.7, tapDrill: 3.3, clearance: [4.3, 4.5, 4.8], counterbore: [8, 4.4], countersink: 9.3 },
  { size: 'M5', d: 5, pitch: 0.8, tapDrill: 4.2, clearance: [5.3, 5.5, 5.8], counterbore: [10, 5.4], countersink: 11.5 },
  { size: 'M6', d: 6, pitch: 1, tapDrill: 5, clearance: [6.4, 6.6, 7], counterbore: [11, 6.4], countersink: 13.7 },
  { size: 'M8', d: 8, pitch: 1.25, tapDrill: 6.8, clearance: [8.4, 9, 10], counterbore: [15, 8.6], countersink: 18.2 },
  { size: 'M10', d: 10, pitch: 1.5, tapDrill: 8.5, clearance: [10.5, 11, 12], counterbore: [18, 10.6], countersink: 22.7 },
  { size: 'M12', d: 12, pitch: 1.75, tapDrill: 10.2, clearance: [13, 13.5, 14.5], counterbore: [20, 12.6], countersink: 27.2 },
  { size: 'M14', d: 14, pitch: 2, tapDrill: 12, clearance: [15, 15.5, 16.5], counterbore: [24, 14.6], countersink: 31.1 },
  { size: 'M16', d: 16, pitch: 2, tapDrill: 14, clearance: [17, 17.5, 18.5], counterbore: [26, 16.6], countersink: 33.9 },
  { size: 'M20', d: 20, pitch: 2.5, tapDrill: 17.5, clearance: [21, 22, 24], counterbore: [33, 20.6], countersink: 40.6 },
  { size: 'M24', d: 24, pitch: 3, tapDrill: 21, clearance: [25, 26, 28], counterbore: [40, 24.8] },
  { size: 'M30', d: 30, pitch: 3.5, tapDrill: 26.5, clearance: [31, 33, 35], counterbore: [48, 30.8] },
];

export const HOLE_KINDS: readonly HoleKind[] = ['simple', 'counterbore', 'countersink', 'tapped'];
export const HOLE_FITS: readonly HoleFit[] = ['close', 'normal', 'loose'];

/** Angle of the cone that a twist drill leaves at the bottom of a blind hole. */
export const DRILL_POINT_ANGLE = 118;

export function metricSize(size: string): MetricSize | undefined {
  return METRIC_SIZES.find((entry) => entry.size === size);
}

/** The sizes a kind of hole is offered in (countersinks only where countersunk screws exist). */
export function sizesFor(kind: HoleKind): MetricSize[] {
  return METRIC_SIZES.filter((entry) => kind !== 'countersink' || entry.countersink !== undefined);
}

const roundUp = (value: number, step: number) => Math.ceil(value / step - 1e-9) * step;

/** The dimensions of a hole of this kind, size and fit (clearance holes), from the tables above. */
export function standardHoleDimensions(
  kind: HoleKind,
  size: string,
  fit: HoleFit,
): Pick<HoleFeature, 'diameter' | 'depth' | 'counterboreDiameter' | 'counterboreDepth' | 'countersinkDiameter' | 'countersinkAngle' | 'threadDepth'> | null {
  const entry = metricSize(size);
  if (!entry) return null;
  const clearance = entry.clearance[HOLE_FITS.indexOf(fit)] ?? entry.clearance[1];
  // A thread twice as deep as the screw is thick; the tap drill goes four turns further.
  const threadDepth = 2 * entry.d;
  return {
    diameter: kind === 'tapped' ? entry.tapDrill : clearance,
    depth: kind === 'tapped' ? roundUp(threadDepth + 4 * entry.pitch, 0.5) : 2 * entry.d,
    counterboreDiameter: entry.counterbore[0],
    counterboreDepth: entry.counterbore[1],
    countersinkDiameter: entry.countersink ?? 2 * entry.d,
    countersinkAngle: 90,
    threadDepth,
  };
}

/**
 * Where holes go: the points of the sketch that are not ends or centers of curves and not construction
 * geometry. Curves (construction lines, for example) can position them.
 */
export function holePositions(sketch: SketchData): Point2[] {
  const used = new Set<string>();
  for (const entity of sketch.entities) {
    switch (entity.type) {
      case 'line':
        used.add(entity.p1).add(entity.p2);
        break;
      case 'circle':
        used.add(entity.center);
        break;
      case 'arc':
        used.add(entity.center).add(entity.start).add(entity.end);
        break;
      case 'ellipse':
        used.add(entity.center).add(entity.major).add(entity.minor);
        break;
      case 'spline':
        for (const id of [...entity.points, entity.start, entity.end]) if (id) used.add(id);
        break;
      case 'point':
        break;
    }
  }
  return sketch.entities.flatMap((entity) => (entity.type === 'point' && !entity.construction && !used.has(entity.id) ? [[entity.x, entity.y] as const] : []));
}

/**
 * How deep a hole goes through all: as far as the body's box reaches from the farthest hole center along
 * its direction, and a little more. `placements` holds per hole its center and direction (6 values).
 */
export function throughDepth(min: Vec3, max: Vec3, placements: readonly number[]): number {
  let depth = 0;
  for (let k = 0; k + 5 < placements.length; k += 6) {
    const [px, py, pz, dx, dy, dz] = placements.slice(k, k + 6) as [number, number, number, number, number, number];
    for (let corner = 0; corner < 8; corner++) {
      const p: Vec3 = [corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]];
      depth = Math.max(depth, (p[0] - px) * dx + (p[1] - py) * dy + (p[2] - pz) * dz);
    }
  }
  return depth + 1 + 0.01 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/** A thread shown as circles of its nominal diameter where it starts and ends (it is not modeled). */
export interface CosmeticThread {
  point: Vec3;
  /** Into the material, unit length. */
  direction: Vec3;
  radius: number;
  depth: number;
}

/** The threads of tapped holes; `depth` is how deep they go (the thread depth, or through all). */
export function holeThreads(hole: HoleFeature, placements: readonly number[], depth: number): CosmeticThread[] {
  const size = metricSize(hole.size);
  if (hole.kind !== 'tapped' || !size) return [];
  const threads: CosmeticThread[] = [];
  for (let k = 0; k + 5 < placements.length; k += 6) {
    const [px, py, pz, dx, dy, dz] = placements.slice(k, k + 6) as [number, number, number, number, number, number];
    threads.push({ point: [px, py, pz], direction: [dx, dy, dz], radius: size.d / 2, depth });
  }
  return threads;
}

/** Why the dimensions of a hole do not fit together; null when they do. */
export function holeProblem(hole: HoleFeature): 'counterbore' | 'countersink' | 'thread' | null {
  const blind = hole.end === 'blind';
  if (hole.kind === 'counterbore' && (hole.counterboreDiameter <= hole.diameter || (blind && hole.counterboreDepth >= hole.depth))) return 'counterbore';
  if (hole.kind === 'countersink') {
    if (hole.countersinkDiameter <= hole.diameter || !(hole.countersinkAngle > 0 && hole.countersinkAngle < 180)) return 'countersink';
    const sink = (hole.countersinkDiameter - hole.diameter) / 2 / Math.tan((hole.countersinkAngle * Math.PI) / 360);
    if (blind && sink >= hole.depth) return 'countersink';
  }
  if (hole.kind === 'tapped' && (blind && hole.threadDepth > hole.depth)) return 'thread';
  return null;
}

/**
 * The half section of a hole for the kernel: x is the distance from the axis, y the depth into the
 * material, from the surface (y = 0) to `depth` (plus the drill point of a blind hole). The edges are named
 * after what they make: the counterbore or countersink, the wall, the drill point or bottom, the axis.
 */
export function holeProfile(hole: HoleFeature, depth: number, throughAll: boolean): Profile {
  const r = hole.diameter / 2;
  const points: { at: Point2; role: string }[] = [{ at: [0, 0], role: 'entry' }];
  if (hole.kind === 'counterbore') {
    const rc = hole.counterboreDiameter / 2;
    points.push({ at: [rc, 0], role: 'counterbore' }, { at: [rc, hole.counterboreDepth], role: 'counterboreFloor' }, { at: [r, hole.counterboreDepth], role: 'wall' });
  } else if (hole.kind === 'countersink') {
    const rs = hole.countersinkDiameter / 2;
    const sink = (rs - r) / Math.tan((hole.countersinkAngle * Math.PI) / 360);
    points.push({ at: [rs, 0], role: 'countersink' }, { at: [r, sink], role: 'wall' });
  } else {
    points.push({ at: [r, 0], role: 'wall' });
  }
  if (throughAll) {
    points.push({ at: [r, depth], role: 'bottom' }, { at: [0, depth], role: 'axis' });
  } else {
    const tip = r / Math.tan((DRILL_POINT_ANGLE * Math.PI) / 360);
    points.push({ at: [r, depth], role: 'tip' }, { at: [0, depth + tip], role: 'axis' });
  }
  // Each point starts the edge that leaves it; the loop runs counterclockwise (outward first, then down).
  const edges: ProfileEdge[] = points.map((point, i) => ({ kind: 'line', from: point.at, to: (points[(i + 1) % points.length] as { at: Point2 }).at }));
  const curves = points.map((point) => point.role);
  const polygon = points.map((point) => point.at);
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [a, b] = [polygon[i] as Point2, polygon[(i + 1) % polygon.length] as Point2];
    area += (a[0] * b[1] - b[0] * a[1]) / 2;
  }
  return { regions: [{ outer: { edges, curves, area, polygon }, holes: [] }], problems: [] };
}
