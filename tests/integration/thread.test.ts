/** Modeled ISO metric threads on bolts and in holes. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CylinderFeature, Feature, ThreadFeature } from '../../src/shared/model/feature.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const h = (p: number) => (Math.sqrt(3) / 2) * p;
/** Volume per turn of a trapezoid groove between radii r0 (width w0) and r1 (width w1). */
function perTurn(r0: number, w0: number, r1: number, w1: number): number {
  const area = ((w0 + w1) / 2) * (r1 - r0);
  const centroid = r0 + ((r1 - r0) * (w0 + 2 * w1)) / (3 * (w0 + w1));
  return area * 2 * Math.PI * centroid;
}
const thread = (face: string, at: [number, number, number], more: Partial<ThreadFeature> = {}): ThreadFeature => ({
  id: 't', type: 'thread', faces: [{ kind: 'face', name: face, at }], size: 'M6', pitch: 1, length: 10, reverse: false, leftHand: false, ...more,
});

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;

describe('modeled threads', () => {
  // An M6 bolt: radius 3, 20 long.
  const bolt: CylinderFeature = { id: 'bolt', type: 'cylinder', operation: 'add', radius: 3, height: 20, axis: 'z', position: [0, 0, 0] };
  const plain = Math.PI * 9 * 20;

  it('cuts the groove of an external thread into a bolt', () => {
    const result = build([bolt, thread('bolt:side', [3, 0, 10])]);
    expect(result.features.at(-1)?.status).toBe('ok');
    // Between the root (width P/4) and the crest (width 7P/8), ten turns.
    expect(plain - (result.captures[0]?.properties?.volume ?? NaN)).toBeCloseTo(perTurn(3 - (5 * h(1)) / 8, 1 / 4, 3, 7 / 8) * 10, 2);
    expect(result.captures[0]?.mesh?.naming.faces).toContain('t:thread');
    // Left-handed and from the other end: as much material.
    expect(volumeOf([bolt, thread('bolt:side', [3, 0, 10], { leftHand: true, reverse: true })])).toBeCloseTo(result.captures[0]?.properties?.volume ?? NaN, 2);
  });

  it('cuts the groove of an internal thread into the wall of a hole, at most as long as the face', () => {
    const minor = 3 - (5 * h(1)) / 8;
    const block: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 20, depth: 20, height: 12, position: [0, 0, 0] };
    const hole: CylinderFeature = { id: 'hole', type: 'cylinder', operation: 'cut', radius: minor, height: 14, axis: 'z', position: [0, 0, -1] };
    const before = volumeOf([block, hole]);
    const result = build([block, hole, thread('hole:side', [minor, 0, 6], { length: 8 })]);
    expect(result.features.at(-1)?.status).toBe('ok');
    // From the wall (width 3P/4) to the major radius (width P/8), eight turns.
    expect(before - (result.captures[0]?.properties?.volume ?? NaN)).toBeCloseTo(perTurn(minor, 3 / 4, 3, 1 / 8) * 8, 2);
    // Longer than the 12 deep hole: as long as the hole.
    expect(volumeOf([block, hole, thread('hole:side', [minor, 0, 6], { length: 50 })])).toBeCloseTo(volumeOf([block, hole, thread('hole:side', [minor, 0, 6], { length: 12 })]), 3);
  });

  it('reports a face that is not a cylinder and a thread without a face', () => {
    const box: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 20, depth: 20, height: 12, position: [0, 0, 0] };
    expect(build([box, thread('b:top', [0, 0, 12])]).features.at(-1)?.error?.code).toBe('thread-face');
    expect(build([box, { ...thread('b:top', [0, 0, 12]), faces: [] }]).features.at(-1)?.error?.code).toBe('thread-face');
  });
});
