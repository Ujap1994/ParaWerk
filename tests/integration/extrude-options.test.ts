/** Extrusions in two directions and with a draft angle. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import { defaultFeature, type ExtrudeFeature, type Feature, type FilletFeature, type SketchFeature } from '../../src/shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf } from '../../src/shared/model/naming.ts';
import type { SketchEntity } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
/** A 40 × 20 rectangle on the top plane, centered on the origin. */
const square: SketchFeature = {
  id: 'sq',
  type: 'sketch',
  plane: { kind: 'standard', plane: 'top' },
  sketch: {
    entities: [P('a', -20, -10), P('b', 20, -10), P('c', 20, 10), P('d', -20, 10), { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' }, { id: 'l3', type: 'line', p1: 'c', p2: 'd' }, { id: 'l4', type: 'line', p1: 'd', p2: 'a' }],
    constraints: [],
  },
};
const extrude = (overrides: Partial<ExtrudeFeature>): ExtrudeFeature => ({ ...(defaultFeature('extrude', 'ex') as ExtrudeFeature), sketch: 'sq', depth: 10, ...overrides });

function build(features: Feature[]) {
  const result = kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
  return { result, props: result.captures[0]?.properties };
}

/** Volume of a w × d rectangle shrinking by t on every side over height h (∫ (w − 2kz)(d − 2kz) dz). */
const frustum = (w: number, d: number, t: number, h: number) => {
  const k = t / h;
  return w * d * h - k * (w + d) * h * h + (4 / 3) * k * k * h ** 3;
};

describe('extrude options', () => {
  it('extrudes different depths in two directions', () => {
    const { props } = build([square, extrude({ direction: 'two', depth: 10, depth2: 4 })]);
    expect(props?.volume).toBeCloseTo(40 * 20 * 14, 6);
    expect(props?.bboxMin[2]).toBeCloseTo(-4, 5);
    expect(props?.bboxMax[2]).toBeCloseTo(10, 5);
  });

  it('tapers the side faces towards the far end, or widens them', () => {
    const t = 10 * Math.tan((5 * Math.PI) / 180);
    expect(build([square, extrude({ draft: 5 })]).props?.volume).toBeCloseTo(frustum(40, 20, t, 10), 3);
    expect(build([square, extrude({ draft: 5, draftOutward: true })]).props?.volume).toBeCloseTo(frustum(40, 20, -t, 10), 3);
    // Reversed, it tapers downwards.
    const reversed = build([square, extrude({ draft: 5, direction: 'reverse' })]).props;
    expect(reversed?.volume).toBeCloseTo(frustum(40, 20, t, 10), 3);
    expect(reversed?.bboxMax[2]).toBeCloseTo(0, 5);
    // Both ways, each half tapers towards its own end.
    const both = build([square, extrude({ draft: 5, direction: 'two', depth: 10, depth2: 10 })]).props;
    expect(both?.volume).toBeCloseTo(2 * frustum(40, 20, t, 10), 3);
    expect(both?.center[2]).toBeCloseTo(0, 6);
  });

  it('keeps the names of the drafted faces, so a fillet stays on its edge', () => {
    const drafted = build([square, extrude({ draft: 5 })]).result.captures[0]?.mesh?.naming;
    if (!drafted) throw new Error('no body');
    expect(drafted.faces.filter((name) => name.startsWith('ex:side:'))).toHaveLength(4);
    const edge = Array.from({ length: drafted.edgeFaces.length / 2 }, (_, e) => e).find((e) => edgeFaceNames(drafted, e).join('|') === 'ex:end|ex:side:l1');
    const ref = edge === undefined ? null : edgeRefOf(drafted, edge);
    if (!ref) throw new Error('no edge');
    const fillet: FilletFeature = { id: 'round', type: 'fillet', radius: 1, edges: [ref] };
    for (const draft of [5, 8, 3]) {
      const { result } = build([square, extrude({ draft }), fillet]);
      expect(result.features.map((feature) => feature.status)).toEqual(['ok', 'ok', 'ok']);
    }
  });
});
