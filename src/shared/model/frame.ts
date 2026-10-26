/**
 * Coordinate systems as frames: an origin and three perpendicular unit axes. Positions, inertia tensors
 * and exported geometry can be given in such a frame instead of the model's own axes.
 */

import type { Vec3 } from './feature.ts';

export interface Frame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  zDir: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A point of the model in the frame's coordinates. */
export function pointIn(frame: Frame, point: Vec3): Vec3 {
  const d: Vec3 = [point[0] - frame.origin[0], point[1] - frame.origin[1], point[2] - frame.origin[2]];
  return [dot(d, frame.xDir), dot(d, frame.yDir), dot(d, frame.zDir)];
}

/** A symmetric tensor (xx, yy, zz, xy, xz, yz) about the model axes, turned into the frame's axes (Rᵀ I R). */
export function tensorIn(frame: Frame, [xx, yy, zz, xy, xz, yz]: readonly [number, number, number, number, number, number]): [number, number, number, number, number, number] {
  const times = (v: Vec3): Vec3 => [xx * v[0] + xy * v[1] + xz * v[2], xy * v[0] + yy * v[1] + yz * v[2], xz * v[0] + yz * v[1] + zz * v[2]];
  const [x, y, z] = [frame.xDir, frame.yDir, frame.zDir];
  return [dot(x, times(x)), dot(y, times(y)), dot(z, times(z)), dot(x, times(y)), dot(x, times(z)), dot(y, times(z))];
}

/** The transformation from model coordinates into the frame's: 12 numbers, the rows of a 3 × 4 matrix. */
export function frameTransform(frame: Frame): number[] {
  const rows = [frame.xDir, frame.yDir, frame.zDir];
  return rows.flatMap((axis) => [...axis, -dot(axis, frame.origin)]);
}
