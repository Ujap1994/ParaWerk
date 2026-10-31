/** Splitting bodies by a plane or a surface into bodies of their own (docs/adr/0011-multi-body-parts.md). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { RebuildResult } from '../../src/kernel/protocol.ts';
import { defaultFeature, type BoxFeature, type EdgeNameRef, type Feature, type OffsetSurfaceFeature, type SplitFeature } from '../../src/shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf, type BodyNaming } from '../../src/shared/model/naming.ts';
import type { GeometryRef } from '../../src/shared/model/reference.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

// x −50 … 50, y −30 … 30, z 0 … 40
const block: BoxFeature = { id: 'block', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const BLOCK = 100 * 60 * 40;
const right: GeometryRef = { kind: 'standard-plane', plane: 'right' };
const split = (more: Partial<SplitFeature> = {}): SplitFeature => ({ ...(defaultFeature('split', 'split') as SplitFeature), references: [right], ...more });

function build(features: Feature[]): RebuildResult {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const naming = (result: RebuildResult): BodyNaming => {
  const found = result.captures[0]?.mesh?.naming;
  if (!found) throw new Error('no body');
  return found;
};
const bodies = (result: RebuildResult) => new Set(naming(result).faceBodies ?? []).size;
const volume = (result: RebuildResult) => result.captures[0]?.properties?.volume ?? Number.NaN;

function edgeBetween(features: Feature[], a: string, b: string): EdgeNameRef {
  const names = naming(build(features));
  const key = [a, b].sort().join('|');
  for (let e = 0; e < names.edgeFaces.length / 2; e++) {
    if (edgeFaceNames(names, e).join('|') === key) {
      const ref = edgeRefOf(names, e);
      if (ref) return ref;
    }
  }
  throw new Error(`no edge between ${a} and ${b}`);
}

describe('split', () => {
  it('splits a block at a plane into two bodies, the cut faces named after their side', () => {
    const result = build([block, split()]);
    expect(result.features[1]?.status).toBe('ok');
    expect(bodies(result)).toBe(2);
    expect(volume(result)).toBeCloseTo(BLOCK, 3);
    expect(naming(result).faces).toEqual(expect.arrayContaining(['split:cut:normal', 'split:cut:reverse']));
  });

  it('keeps only the pieces on one side of the plane', () => {
    // The right plane's normal points along +x.
    const along = build([block, split({ keep: 'normal' })]);
    expect(bodies(along)).toBe(1);
    expect(volume(along)).toBeCloseTo(BLOCK / 2, 3);
    expect(along.captures[0]?.properties?.bboxMin[0]).toBeCloseTo(0, 6);
    const against = build([block, split({ keep: 'reverse' })]);
    expect(against.captures[0]?.properties?.bboxMax[0]).toBeCloseTo(0, 6);
  });

  it('splits only the bodies the plane crosses', () => {
    const beside: BoxFeature = { id: 'beside', type: 'box', operation: 'add', merge: false, width: 20, depth: 20, height: 20, position: [100, 0, 0] };
    const result = build([block, beside, split({ references: [{ kind: 'standard-plane', plane: 'right' }] })]);
    expect(bodies(result)).toBe(3);
    expect(volume(result)).toBeCloseTo(BLOCK + 8000, 3);
  });

  it('splits along a surface', () => {
    // The top face offset 10 into the block: a slab of 10 on top, the rest below.
    const inside: OffsetSurfaceFeature = { ...(defaultFeature('offsetSurface', 'inside') as OffsetSurfaceFeature), distance: -10, faces: [{ kind: 'face', name: 'block:top', at: [0, 0, 40] }] };
    const result = build([block, inside, split({ method: 'surface', references: [], surface: 'inside' })]);
    expect(result.features[2]?.status).toBe('ok');
    expect(bodies(result)).toBe(2);
    expect(volume(result)).toBeCloseTo(BLOCK, 3);
  });

  it('tells when the plane crosses no body', () => {
    const away = build([block, { ...(defaultFeature('plane', 'away') as Feature & { type: 'plane' }), method: 'offset', references: [right], distance: 80, angle: 45, flip: false }, split({ references: [{ kind: 'feature', feature: 'away' }] })]);
    expect(away.features[2]?.error?.code).toBe('split-nothing');
    expect(build([block, split({ method: 'surface', references: [], surface: 'gone' })]).features[1]?.error?.code).toBe('surface-missing');
  });

  it('keeps a fillet on a cut face when the block changes', () => {
    const base = [block, split()];
    const round: Feature = { id: 'round', type: 'fillet', radius: 3, edges: [edgeBetween(base, 'split:cut:normal', 'block:top')] };
    const result = build([...base, round]);
    expect(result.features.map((feature) => feature.status)).toEqual(['ok', 'ok', 'ok']);
    const taller = build([{ ...block, height: 50 }, split(), round]);
    expect(taller.features.map((feature) => [feature.status, feature.warning?.code])).toEqual([
      ['ok', undefined],
      ['ok', undefined],
      ['ok', undefined],
    ]);
  });
});
