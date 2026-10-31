/** Feature scope: cuts and added material limited to chosen bodies (docs/adr/0011-multi-body-parts.md). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { RebuildResult } from '../../src/kernel/protocol.ts';
import type { BoxFeature, CylinderFeature, Feature } from '../../src/shared/model/feature.ts';
import type { FaceNameRef } from '../../src/shared/model/reference.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

// Two overlapping bodies: a block (x −50 … 50) and a slab of its own across it (x −20 … 80), both z 0 … 20.
const block: BoxFeature = { id: 'block', type: 'box', operation: 'add', width: 100, depth: 60, height: 20, position: [0, 0, 0] };
const slab: BoxFeature = { id: 'slab', type: 'box', operation: 'add', merge: false, width: 100, depth: 20, height: 20, position: [30, 0, 0] };
const BLOCK = 100 * 60 * 20;
const SLAB = 100 * 20 * 20;
const blockFace: FaceNameRef = { kind: 'face', name: 'block:left', at: [-50, 0, 10] };
const slabFace: FaceNameRef = { kind: 'face', name: 'slab:right', at: [80, 0, 10] };
// A bore through both where they overlap (x 10).
const bore = (scope?: FaceNameRef[]): CylinderFeature => ({ id: 'bore', type: 'cylinder', operation: 'cut', radius: 5, height: 40, axis: 'z', position: [10, 0, -10], ...(scope ? { scope } : {}) });
const BORE = Math.PI * 25 * 20;

function build(features: Feature[]): RebuildResult {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}
const volume = (result: RebuildResult) => result.captures[0]?.properties?.volume ?? Number.NaN;
const bodyVolume = (features: Feature[], face: string) => {
  const names = build(features).captures[0]?.mesh?.naming;
  const body = names?.faceBodies?.[names.faces.indexOf(face)] ?? -1;
  return kernel.bodyProperties({ features, bodies: [body] }).volume;
};

describe('feature scope', () => {
  it('cuts every body it reaches without a scope', () => {
    const features = [block, slab, bore()];
    expect(bodyVolume(features, 'block:left')).toBeCloseTo(BLOCK - BORE, 3);
    expect(bodyVolume(features, 'slab:right')).toBeCloseTo(SLAB - BORE, 3);
  });

  it('cuts only the bodies of its scope', () => {
    const features = [block, slab, bore([slabFace])];
    expect(build(features).features[2]?.status).toBe('ok');
    expect(bodyVolume(features, 'block:left')).toBeCloseTo(BLOCK, 3);
    expect(bodyVolume(features, 'slab:right')).toBeCloseTo(SLAB - BORE, 3);
  });

  it('merges added material only with the bodies of its scope', () => {
    // A cube touching both bodies on top, merged only with the slab: two bodies stay.
    const cube: BoxFeature = { id: 'cube', type: 'box', operation: 'add', width: 20, depth: 20, height: 10, position: [10, 0, 20], scope: [slabFace] };
    const result = build([block, slab, cube]);
    expect(new Set(result.captures[0]?.mesh?.naming.faceBodies ?? []).size).toBe(2);
    expect(bodyVolume([block, slab, cube], 'block:left')).toBeCloseTo(BLOCK, 3);
  });

  it('removes nothing when the scope holds no body the cut reaches, and tells a gone body', () => {
    const away = build([block, slab, { ...bore([blockFace]), position: [70, 0, -10] }]);
    expect(away.features[2]?.warning?.code).toBe('cut-nothing');
    expect(volume(away)).toBeCloseTo(volume(build([block, slab])), 3);
    expect(build([block, slab, bore([{ kind: 'face', name: 'gone:face', at: [500, 500, 500] }])]).features[2]?.error?.code).toBe('body-missing');
  });
});
