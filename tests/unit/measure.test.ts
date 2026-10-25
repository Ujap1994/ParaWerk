/** Angles, normal distances and center distances between measured entities (src/kernel/measure.ts). */
import { describe, expect, it } from 'vitest';
import { relateEntities, type MeasuredEntity } from '../../src/kernel/measure.ts';
import type { Vec3 } from '../../src/shared/model/feature.ts';

const plane = (point: Vec3, normal: Vec3): MeasuredEntity => ({ kind: 'face', geometry: { kind: 'plane', area: 1, center: point, plane: { point, normal } } });
const line = (start: Vec3, end: Vec3): MeasuredEntity => ({
  kind: 'edge',
  geometry: { kind: 'line', length: 1, start, end, middle: start, axis: [end[0] - start[0], end[1] - start[1], end[2] - start[2]] },
});
const cylinder = (point: Vec3, direction: Vec3): MeasuredEntity => ({ kind: 'face', geometry: { kind: 'cylinder', area: 1, center: point, axis: { point, direction }, radius: 2 } });
const circle = (center: Vec3): MeasuredEntity => ({ kind: 'edge', geometry: { kind: 'circle', length: 1, start: center, end: center, middle: center, center, axis: [0, 0, 1], radius: 3 } });
const vertex = (position: Vec3): MeasuredEntity => ({ kind: 'vertex', position });

describe('relating measured entities', () => {
  it('gives angles between planes, between lines and between a line and a plane', () => {
    expect(relateEntities(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 0], [0, 1, 1])).angle).toBeCloseTo(45, 9);
    // Opposite normals: parallel planes, 0°, with their distance along the normal.
    expect(relateEntities(plane([0, 0, 0], [0, 0, 1]), plane([5, 5, 12], [0, 0, -1]))).toMatchObject({ angle: 0, normalDistance: 12 });
    expect(relateEntities(line([0, 0, 0], [1, 0, 0]), line([0, 0, 0], [1, 1, 0])).angle).toBeCloseTo(45, 9);
    // A line at 30° to the plane (60° to its normal).
    const tilted = line([0, 0, 0], [Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6)]);
    expect(relateEntities(tilted, plane([0, 0, 0], [0, 0, 1])).angle).toBeCloseTo(30, 9);
    expect(relateEntities(plane([0, 0, 0], [0, 0, 1]), vertex([1, 2, 3])).angle).toBeUndefined();
  });

  it('gives center distances of circles, axes and vertices', () => {
    expect(relateEntities(circle([0, 0, 0]), circle([3, 4, 0])).centerDistance).toEqual({ value: 5, from: [0, 0, 0], to: [3, 4, 0] });
    // Parallel axes 10 apart.
    expect(relateEntities(cylinder([0, 0, 0], [0, 0, 1]), cylinder([10, 0, 7], [0, 0, 1])).centerDistance?.value).toBeCloseTo(10, 12);
    // Skew axes: the x axis and a line parallel to y at z = 4.
    const skew = relateEntities(cylinder([0, 0, 0], [1, 0, 0]), cylinder([2, 5, 4], [0, 1, 0])).centerDistance;
    expect(skew?.value).toBeCloseTo(4, 12);
    expect(skew?.from.map((v) => +v.toFixed(9) + 0)).toEqual([2, 0, 0]);
    expect(skew?.to.map((v) => +v.toFixed(9) + 0)).toEqual([2, 0, 4]);
    // From a vertex to an axis, and back.
    expect(relateEntities(vertex([3, 4, 9]), cylinder([0, 0, 0], [0, 0, 1])).centerDistance).toMatchObject({ value: 5, from: [3, 4, 9], to: [0, 0, 9] });
    expect(relateEntities(cylinder([0, 0, 0], [0, 0, 1]), vertex([3, 4, 9])).centerDistance).toMatchObject({ value: 5, from: [0, 0, 9], to: [3, 4, 9] });
    expect(relateEntities(vertex([0, 0, 0]), vertex([1, 1, 1])).centerDistance).toBeUndefined();
  });
});
