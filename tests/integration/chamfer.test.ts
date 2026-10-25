/** Chamfers with two distances, or a distance and an angle, measured from one face of each edge. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, ChamferFeature, Feature } from '../../src/shared/model/feature.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const BOX = 100 * 60 * 40;
/** The 100 mm edge between the top and the front face. */
const edge = { kind: 'edge' as const, faces: ['box:front', 'box:top'] as [string, string], at: [0, -30, 40] as [number, number, number] };
const chamfer = (overrides: Partial<ChamferFeature>): ChamferFeature => ({ id: 'bevel', type: 'chamfer', distance: 4, edges: [edge], ...overrides });

function removed(features: Feature[]): number {
  const result = kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
  expect(result.features.at(-1)?.status).toBe('ok');
  return BOX - (result.captures[0]?.properties?.volume ?? NaN);
}

describe('uneven chamfers', () => {
  it('cuts a triangle of the two distances along the edge', () => {
    expect(removed([box, chamfer({})])).toBeCloseTo((4 * 4 * 100) / 2, 6);
    expect(removed([box, chamfer({ method: 'distances', distance2: 2 })])).toBeCloseTo((4 * 2 * 100) / 2, 6);
    // Flipped, the distances swap faces: the same volume, another shape.
    expect(removed([box, chamfer({ method: 'distances', distance2: 2, flip: true })])).toBeCloseTo((4 * 2 * 100) / 2, 6);
  });

  it('goes as far as the angle reaches: 45° is the same on both faces', () => {
    expect(removed([box, chamfer({ method: 'angle', angle: 45 })])).toBeCloseTo((4 * 4 * 100) / 2, 6);
    // At 30° from the first face the bevel reaches 4 · tan 30° along the other face.
    expect(removed([box, chamfer({ method: 'angle', angle: 30 })])).toBeCloseTo((4 * 4 * Math.tan(Math.PI / 6) * 100) / 2, 6);
  });

  it('measures the distance on the other face when flipped', () => {
    const shape = (flip: boolean) => {
      const result = kernel.rebuild({ features: [box, chamfer({ method: 'distances', distance2: 1, flip })], captures: [1], knownMeshKeys: [], withProperties: true }).result;
      return result.captures[0]?.properties?.center ?? [NaN, NaN, NaN];
    };
    // The bevel lies differently, so the center of mass moves.
    const [a, b] = [shape(false), shape(true)];
    expect(Math.hypot(a[1] - b[1], a[2] - b[2])).toBeGreaterThan(1e-4);
  });
});
