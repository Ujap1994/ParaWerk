/**
 * Patterns and mirror images of features: the rigid motions (and mirrors) that place the copies.
 * A transformation is 12 numbers, the rows of a 3 × 4 matrix: rotation or mirror, then translation.
 */

import type { Vec3 } from './feature.ts';

export type Transform = readonly number[];

/** Most copies a pattern may make (limits damaged or hostile files and accidental huge patterns). */
export const MAX_PATTERN_COUNT = 1000;

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
};

/** Copies 1 … count − 1 along `direction`, `spacing` apart (copy 0 is the original). */
export function linearTransforms(direction: Vec3, spacing: number, count: number): Transform[] {
  const d = unit(direction);
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => {
    const s = (i + 1) * spacing;
    return [1, 0, 0, d[0] * s, 0, 1, 0, d[1] * s, 0, 0, 1, d[2] * s];
  });
}

/** Rotation by `angle` radians around the line through `point` along `axis` (Rodrigues). */
export function rotation(point: Vec3, axis: Vec3, angle: number): Transform {
  const [x, y, z] = unit(axis);
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const t = 1 - c;
  const r = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ] as const;
  // The axis point stays where it is: translation = point − R · point.
  const moved = r.map((row) => row[0] * point[0] + row[1] * point[1] + row[2] * point[2]);
  return r.flatMap((row, i) => [row[0], row[1], row[2], (point[i] ?? 0) - (moved[i] ?? 0)]);
}

/**
 * Copies 1 … count − 1 around an axis: evenly all round for a full turn (360°), else spread over `angle`
 * degrees with the last copy at the end.
 */
export function circularTransforms(point: Vec3, axis: Vec3, angle: number, count: number): Transform[] {
  const step = angle >= 360 ? 360 / count : angle / Math.max(1, count - 1);
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => rotation(point, axis, ((i + 1) * step * Math.PI) / 180));
}

/** The mirror image through the plane through `point` with `normal`. */
export function mirrorTransform(point: Vec3, normal: Vec3): Transform {
  const n = unit(normal);
  const d = 2 * (point[0] * n[0] + point[1] * n[1] + point[2] * n[2]);
  return [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) - 2 * (n[i] ?? 0) * (n[j] ?? 0)).concat(d * (n[i] ?? 0)));
}

export function transformPoint(m: Transform, p: Vec3): Vec3 {
  return [0, 1, 2].map((i) => (m[4 * i] ?? 0) * p[0] + (m[4 * i + 1] ?? 0) * p[1] + (m[4 * i + 2] ?? 0) * p[2] + (m[4 * i + 3] ?? 0)) as Vec3;
}

export function transformDirection(m: Transform, d: Vec3): Vec3 {
  return [0, 1, 2].map((i) => (m[4 * i] ?? 0) * d[0] + (m[4 * i + 1] ?? 0) * d[1] + (m[4 * i + 2] ?? 0) * d[2]) as Vec3;
}
