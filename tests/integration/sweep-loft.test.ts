/** Sweeps along sketch paths and lofts through the outlines of several sketches. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, Feature, LoftFeature, PlaneFeature, SketchFeature, SweepFeature } from '../../src/shared/model/feature.ts';
import { frameOnPlane, type SketchEntity, type SketchPlaneRef } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const sketch = (id: string, plane: SketchPlaneRef, ...entities: SketchEntity[]): SketchFeature => ({ id, type: 'sketch', plane, sketch: { entities, constraints: [] } });
const square = (p: string, half: number): SketchEntity[] => [
  P(`${p}1`, -half, -half), P(`${p}2`, half, -half), P(`${p}3`, half, half), P(`${p}4`, -half, half),
  L(`${p}a`, `${p}1`, `${p}2`), L(`${p}b`, `${p}2`, `${p}3`), L(`${p}c`, `${p}3`, `${p}4`), L(`${p}d`, `${p}4`, `${p}1`),
];
/** A plane `height` above the top plane and a sketch on it. */
const above = (id: string, height: number, ...entities: SketchEntity[]): [PlaneFeature, SketchFeature] => [
  { id: `${id}-plane`, type: 'plane', method: 'offset', references: [{ kind: 'standard-plane', plane: 'top' }], distance: height, angle: 45, flip: false },
  sketch(id, { kind: 'feature', feature: `${id}-plane`, frame: frameOnPlane([0, 0, height], [0, 0, 1]) }, ...entities),
];

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;
const last = (features: Feature[]) => build(features).features.at(-1);

// A circle of radius 2 on the front plane (around the origin) and paths on the top plane starting there.
const circle = sketch('profile', { kind: 'standard', plane: 'front' }, P('m', 0, 0), { id: 'k', type: 'circle', center: 'm', radius: 2 });
const straight = sketch('path', { kind: 'standard', plane: 'top' }, P('a', 0, 0), P('b', 0, 50), L('ab', 'a', 'b'));
const sweep = (more: Partial<SweepFeature> = {}): SweepFeature => ({ id: 's', type: 'sweep', operation: 'add', sketch: 'profile', path: 'path', ...more });

describe('sweep', () => {
  it('sweeps an outline along a straight path, also one drawn the other way', () => {
    expect(volumeOf([circle, straight, sweep()])).toBeCloseTo(Math.PI * 4 * 50, 4);
    const backwards = sketch('path', { kind: 'standard', plane: 'top' }, P('a', 0, 50), P('b', 0, 0), L('ab', 'a', 'b'));
    expect(volumeOf([circle, backwards, sweep()])).toBeCloseTo(Math.PI * 4 * 50, 4);
    expect(build([circle, straight, sweep()]).captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['s:side:k', 's:start', 's:end']));
  });

  it('follows a line and a tangent arc', () => {
    // 30 straight, then a quarter turn of radius 20 to the right.
    const bend = sketch('path', { kind: 'standard', plane: 'top' }, P('a', 0, 0), P('b', 0, 30), P('c', 20, 30), P('d', 20, 50), L('ab', 'a', 'b'), { id: 'r', type: 'arc', center: 'c', start: 'd', end: 'b' });
    expect(volumeOf([circle, bend, sweep()])).toBeCloseTo(Math.PI * 4 * (30 + Math.PI * 10), 3);
  });

  it('cuts a groove along a path', () => {
    const block: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 20, depth: 120, height: 10, position: [0, 50, -5] };
    const groove = build([block, circle, straight, sweep({ operation: 'cut' })]);
    expect(groove.features.at(-1)?.status).toBe('ok');
    expect(groove.captures[0]?.properties?.volume).toBeCloseTo(24_000 - Math.PI * 4 * 50, 3);
  });

  it('reports paths it cannot follow', () => {
    const branching = sketch('path', { kind: 'standard', plane: 'top' }, P('a', 0, 0), P('b', 0, 50), P('c', 10, 0), P('d', -10, 0), L('ab', 'a', 'b'), L('ac', 'a', 'c'), L('ad', 'a', 'd'));
    expect(last([circle, branching, sweep()])?.error?.code).toBe('path-branching');
    const gaps = sketch('path', { kind: 'standard', plane: 'top' }, P('a', 0, 0), P('b', 0, 20), P('c', 0, 30), P('d', 0, 50), L('ab', 'a', 'b'), L('cd', 'c', 'd'));
    expect(last([circle, gaps, sweep()])?.error?.code).toBe('path-gaps');
    expect(last([circle, sketch('path', { kind: 'standard', plane: 'top' }), sweep()])?.error?.code).toBe('path-empty');
    expect(last([circle, sweep()])?.error?.code).toBe('sketch-missing');
  });
});

describe('loft', () => {
  const loft = (sketches: string[], more: Partial<LoftFeature> = {}): LoftFeature => ({ id: 'l', type: 'loft', operation: 'add', sketches, ...more });
  const bottom = sketch('s1', { kind: 'standard', plane: 'top' }, ...square('a', 10));

  it('joins a square to a smaller one above it', () => {
    // A frustum: h/3 · (A1 + A2 + √(A1·A2)).
    const frustum = 10 * (400 + 100 + 200);
    expect(volumeOf([bottom, ...above('s2', 30, ...square('b', 5)), loft(['s1', 's2'], { ruled: true })])).toBeCloseTo(frustum, 4);
    const smooth = build([bottom, ...above('s2', 30, ...square('b', 5)), loft(['s1', 's2'])]);
    expect(smooth.captures[0]?.properties?.volume).toBeCloseTo(frustum, 4);
    expect(smooth.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['l:side:aa', 'l:start', 'l:end']));
  });

  it('goes through three outlines and from a square to a circle', () => {
    const three = [bottom, ...above('s2', 30, ...square('b', 5)), ...above('s3', 60, ...square('c', 10)), loft(['s1', 's2', 's3'], { ruled: true })];
    expect(volumeOf(three)).toBeCloseTo(2 * 10 * (400 + 100 + 200), 4);
    const round = [bottom, ...above('s2', 40, P('m', 0, 0), { id: 'k', type: 'circle', center: 'm', radius: 8 }), loft(['s1', 's2'])];
    const result = build(round);
    expect(result.features.at(-1)?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeGreaterThan(40 * Math.PI * 64 * 0.9);
  });

  it('reports a single outline and sketches with more than one', () => {
    expect(last([bottom, loft(['s1'])])?.error?.code).toBe('loft-sections');
    const two = sketch('s2', { kind: 'standard', plane: 'top' }, ...square('a', 10), P('m', 50, 0), { id: 'k', type: 'circle', center: 'm', radius: 5 });
    expect(last([bottom, two, loft(['s1', 's2'])])?.error).toEqual({ code: 'loft-profile', detail: '2' });
  });
});

describe('copies of sweeps and lofts', () => {
  it('patterns a sweep', () => {
    const pattern: Feature = { id: 'row', type: 'pattern', method: 'linear', references: [{ kind: 'standard-plane', plane: 'right' }], features: ['s'], count: 3, spacing: 10, angle: 360, flip: false };
    expect(volumeOf([circle, straight, sweep(), pattern])).toBeCloseTo(3 * Math.PI * 4 * 50, 3);
  });
});
