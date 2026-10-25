/**
 * Measuring faces, edges and vertices of a body: what one of them is (area, length, radius, position),
 * and between two of them the shortest distance, the angle, the distance along the normal of parallel
 * planes and the distance of centers and axes.
 */

import type { Vec3 } from '../shared/model/feature.ts';
import type { EdgeGeometry, FaceGeometry } from './protocol.ts';

export type MeasureTarget = { kind: 'face' | 'edge' | 'vertex'; index: number };

export type MeasuredEntity = { kind: 'face'; geometry: FaceGeometry } | { kind: 'edge'; geometry: EdgeGeometry } | { kind: 'vertex'; position: Vec3 };

export interface MeasuredDistance {
  value: number;
  from: Vec3;
  to: Vec3;
}

export interface MeasureResult {
  entities: MeasuredEntity[];
  /** Two entities: the shortest distance between them, and where it is. */
  distance?: MeasuredDistance;
  /** Two planes or lines, or a plane and a line: the angle between them, 0° to 90°. */
  angle?: number;
  /** Two parallel planes: their distance along the normal. */
  normalDistance?: number;
  /** Circles, arcs, cylinders and spheres (with each other or a vertex): the distance of centers and axes. */
  centerDistance?: MeasuredDistance;
}

const PARALLEL = 1e-9;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
const finite = (a: Vec3 | undefined): a is Vec3 => a !== undefined && a.every(Number.isFinite);

/** A direction that decides angles: the normal of a plane (kind 'normal') or the direction of a line. */
type Direction = { kind: 'normal' | 'line'; vector: Vec3 };

function directionOf(entity: MeasuredEntity): Direction | null {
  if (entity.kind === 'face' && entity.geometry.kind === 'plane' && entity.geometry.plane) return { kind: 'normal', vector: unit(entity.geometry.plane.normal) };
  if (entity.kind === 'edge' && entity.geometry.kind === 'line' && finite(entity.geometry.axis)) return { kind: 'line', vector: unit(entity.geometry.axis) };
  return null;
}

/** A center (circles, spheres, vertices) or an axis (cylinders and other surfaces of revolution). */
type Center = { kind: 'point'; point: Vec3; round: boolean } | { kind: 'axis'; point: Vec3; direction: Vec3 };

function centerOf(entity: MeasuredEntity): Center | null {
  if (entity.kind === 'vertex') return { kind: 'point', point: entity.position, round: false };
  if (entity.kind === 'edge') {
    const { center } = entity.geometry;
    return (entity.geometry.kind === 'circle' || entity.geometry.kind === 'ellipse') && finite(center) ? { kind: 'point', point: center, round: true } : null;
  }
  const geometry = entity.geometry;
  if (geometry.kind === 'sphere' && geometry.sphereCenter) return { kind: 'point', point: geometry.sphereCenter, round: true };
  if (geometry.axis && finite(geometry.axis.point) && finite(geometry.axis.direction)) {
    const direction = unit(geometry.axis.direction);
    // The point of the axis level with the middle of the face, so lines between axes run through the part.
    const point = finite(geometry.center) ? add(geometry.axis.point, scale(direction, dot(sub(geometry.center, geometry.axis.point), direction))) : geometry.axis.point;
    return { kind: 'axis', point, direction };
  }
  return null;
}

/** The closest points of a point and a line. */
function pointToLine(point: Vec3, origin: Vec3, direction: Vec3): MeasuredDistance {
  const foot = add(origin, scale(direction, dot(sub(point, origin), direction)));
  return { value: length(sub(point, foot)), from: point, to: foot };
}

/** The closest points of two lines (any point of parallel lines). */
function lineToLine(p1: Vec3, d1: Vec3, p2: Vec3, d2: Vec3): MeasuredDistance {
  const n = cross(d1, d2);
  if (length(n) < PARALLEL) return pointToLine(p1, p2, d2);
  const w = sub(p1, p2);
  const b = dot(d1, d2);
  const d = dot(d1, w);
  const e = dot(d2, w);
  const denominator = 1 - b * b;
  const s = (b * e - d) / denominator;
  const t = (e - b * d) / denominator;
  const from = add(p1, scale(d1, s));
  const to = add(p2, scale(d2, t));
  return { value: length(sub(from, to)), from, to };
}

function centerDistanceOf(a: Center, b: Center): MeasuredDistance {
  if (a.kind === 'point' && b.kind === 'point') return { value: length(sub(a.point, b.point)), from: a.point, to: b.point };
  if (a.kind === 'point' && b.kind === 'axis') return pointToLine(a.point, b.point, b.direction);
  if (a.kind === 'axis' && b.kind === 'point') {
    const reverse = pointToLine(b.point, a.point, a.direction);
    return { value: reverse.value, from: reverse.to, to: reverse.from };
  }
  if (a.kind === 'axis' && b.kind === 'axis') return lineToLine(a.point, a.direction, b.point, b.direction);
  throw new Error('unreachable');
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

/** What can be said about two measured entities besides their shortest distance. */
export function relateEntities(a: MeasuredEntity, b: MeasuredEntity): Pick<MeasureResult, 'angle' | 'normalDistance' | 'centerDistance'> {
  const result: Pick<MeasureResult, 'angle' | 'normalDistance' | 'centerDistance'> = {};
  const [da, db] = [directionOf(a), directionOf(b)];
  if (da && db) {
    const cos = Math.min(1, Math.abs(dot(da.vector, db.vector)));
    // Between a line and a plane the angle is measured to the plane, not to its normal.
    result.angle = da.kind === db.kind ? degrees(Math.acos(cos)) : 90 - degrees(Math.acos(cos));
    if (da.kind === 'normal' && db.kind === 'normal' && 1 - cos < PARALLEL && a.kind === 'face' && b.kind === 'face' && a.geometry.plane && b.geometry.plane) {
      result.normalDistance = Math.abs(dot(sub(b.geometry.plane.point, a.geometry.plane.point), da.vector));
    }
  }
  const [ca, cb] = [centerOf(a), centerOf(b)];
  // Between two vertices the shortest distance says it all.
  const round = (center: Center) => center.kind === 'axis' || center.round;
  if (ca && cb && (round(ca) || round(cb))) result.centerDistance = centerDistanceOf(ca, cb);
  return result;
}
