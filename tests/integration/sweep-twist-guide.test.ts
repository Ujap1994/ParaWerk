/** Sweeps that twist about their path, and sweeps that follow a guide curve. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { Feature, SketchFeature, SweepFeature } from '../../src/shared/model/feature.ts';
import type { SketchEntity, SketchPlaneRef } from '../../src/shared/model/sketch.ts';

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
const front: SketchPlaneRef = { kind: 'standard', plane: 'front' };
const top: SketchPlaneRef = { kind: 'standard', plane: 'top' };

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

// A path of 50 along y on the top plane, starting at the origin.
const path = sketch('path', top, P('a', 0, 0), P('b', 0, 50), L('ab', 'a', 'b'));
const sweep = (more: Partial<SweepFeature> = {}): SweepFeature => ({ id: 's', type: 'sweep', operation: 'add', sketch: 'profile', path: 'path', ...more });

describe('twisted sweep', () => {
  // A 20 × 4 rectangle on the front plane around the origin (x ±10, z ±2).
  const bar = sketch('profile', front, P('p1', -10, -2), P('p2', 10, -2), P('p3', 10, 2), P('p4', -10, 2), L('l1', 'p1', 'p2'), L('l2', 'p2', 'p3'), L('l3', 'p3', 'p4'), L('l4', 'p4', 'p1'));

  it('turns the profile about the path, keeping its volume', () => {
    const plain = build([bar, path, sweep()]).captures[0]?.properties;
    expect(plain?.volume).toBeCloseTo(80 * 50, 3);
    expect(plain?.bboxMax[2]).toBeCloseTo(2, 3);
    const twisted = build([bar, path, sweep({ twist: 90 })]);
    expect(twisted.features.at(-1)?.status).toBe('ok');
    const properties = twisted.captures[0]?.properties;
    expect(Math.abs((properties?.volume ?? 0) / 4000 - 1)).toBeLessThan(1e-3);
    // On the way a corner reaches √(10² + 2²) above the path (at about 79°); at the end the bar stands upright.
    expect(properties?.bboxMax[2]).toBeCloseTo(Math.sqrt(104), 2);
    expect(properties?.bboxMax[0]).toBeCloseTo(Math.sqrt(104), 2);
    expect(properties?.bboxMax[1]).toBeCloseTo(50, 3);
    expect(twisted.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['s:side:l1', 's:start', 's:end']));
  });

  it('takes outlines without holes only', () => {
    const ring = sketch('profile', front, P('m', 0, 0), { id: 'o', type: 'circle', center: 'm', radius: 5 }, { id: 'i', type: 'circle', center: 'm', radius: 2 });
    expect(build([ring, path, sweep({ twist: 45 })]).features.at(-1)?.error?.code).toBe('sweep-holes');
  });
});

describe('guided sweep', () => {
  // A circle of radius 5 around the start of the path, and a guide from its edge drifting out to 10.
  const circle = sketch('profile', front, P('m', 0, 0), { id: 'k', type: 'circle', center: 'm', radius: 5 });
  const guide = sketch('guide', top, P('g1', 5, 0), P('g2', 10, 50), L('g', 'g1', 'g2'));

  it('grows the profile with the distance of the guide from the path', () => {
    const result = build([circle, path, guide, sweep({ guide: 'guide' })]);
    expect(result.features.at(-1)?.status).toBe('ok');
    // A frustum from radius 5 to 10 over 50.
    const frustum = (Math.PI * 50 * (25 + 50 + 100)) / 3;
    expect(Math.abs((result.captures[0]?.properties?.volume ?? 0) / frustum - 1)).toBeLessThan(2e-3);
    expect(result.captures[0]?.properties?.bboxMax[0]).toBeCloseTo(10, 2);
    // Drawing in towards the path, the profile shrinks.
    const inwards = sketch('guide', top, P('g1', 5, 0), P('g2', 2.5, 50), L('g', 'g1', 'g2'));
    const smaller = (Math.PI * 50 * (25 + 12.5 + 6.25)) / 3;
    expect(Math.abs((build([circle, path, inwards, sweep({ guide: 'guide' })]).captures[0]?.properties?.volume ?? 0) / smaller - 1)).toBeLessThan(2e-3);
  });

  it('keeps the profile as it is along a guide at a constant distance', () => {
    // A straight guide beside a straight path, and an arc beside an arc: a cylinder and a quarter torus.
    const parallel = sketch('guide', top, P('g1', 5, 0), P('g2', 5, 50), L('g', 'g1', 'g2'));
    expect(build([circle, path, parallel, sweep({ guide: 'guide' })]).captures[0]?.properties?.volume).toBeCloseTo(Math.PI * 25 * 50, 3);
    const bend = sketch('path', top, P('c', 50, 0), P('s', 50, 50), P('e', 0, 0), { id: 'r', type: 'arc', center: 'c', start: 's', end: 'e' });
    const beside = sketch('guide', top, P('c2', 50, 0), P('s2', 50, 45), P('e2', 5, 0), { id: 'r2', type: 'arc', center: 'c2', start: 's2', end: 'e2' });
    const result = build([circle, bend, beside, sweep({ guide: 'guide' })]);
    expect(Math.abs((result.captures[0]?.properties?.volume ?? 0) / (Math.PI * 25 * (Math.PI / 2) * 50) - 1)).toBeLessThan(1e-4);
  });

  it('reports guides it cannot follow', () => {
    expect(build([circle, path, sweep({ guide: 'gone' })]).features.at(-1)?.error?.code).toBe('guide-missing');
    const broken = sketch('guide', top, P('g1', 5, 0), P('g2', 6, 20), P('g3', 8, 30), P('g4', 10, 50), L('a', 'g1', 'g2'), L('b', 'g3', 'g4'));
    expect(build([circle, path, broken, sweep({ guide: 'guide' })]).features.at(-1)?.error?.code).toBe('guide-gaps');
  });
});
