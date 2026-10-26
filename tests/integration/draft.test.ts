/** Draft: faces tilted about a neutral plane. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, DraftFeature, Feature, Vec3 } from '../../src/shared/model/feature.ts';
import type { FaceNameRef, GeometryRef } from '../../src/shared/model/reference.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

/** 100 × 60 × 40 on the top plane. */
const box: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const face = (name: string, at: Vec3): FaceNameRef => ({ kind: 'face', name, at });
const sides = [face('b:front', [0, -30, 20]), face('b:back', [0, 30, 20]), face('b:left', [-50, 0, 20]), face('b:right', [50, 0, 20])];
const bottom: GeometryRef = { kind: 'face', name: 'b:bottom', at: [0, 0, 0] };
const draft = (more: Partial<DraftFeature>): DraftFeature => ({ id: 'd', type: 'draft', method: 'neutralPlane', references: [{ kind: 'standard-plane', plane: 'top' }], faces: sides, angle: 5, flip: false, ...more });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

/** A box whose sides lean in by `angle` from the bottom up: a frustum of rectangles. */
function frustum(width: number, depth: number, height: number, angle: number): number {
  const shrink = height * Math.tan((angle * Math.PI) / 180);
  const [w2, d2] = [width - 2 * shrink, depth - 2 * shrink];
  return (height / 6) * (width * depth + w2 * d2 + (width + w2) * (depth + d2));
}

describe('draft', () => {
  it('tilts the sides about the neutral plane', () => {
    const result = build([box, draft({})]);
    expect(result.features.at(-1)?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(frustum(100, 60, 40, 5), 4);
    // The faces keep their names.
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['b:front', 'b:back', 'b:left', 'b:right']));
    // About the bottom face pulled down, the box widens upwards instead.
    expect(build([box, draft({ references: [bottom] })]).captures[0]?.properties?.volume).toBeGreaterThan(240_000);
    expect(build([box, draft({ flip: true })]).captures[0]?.properties?.volume).toBeGreaterThan(240_000);
  });

  it('drafts only the picked faces and warns about faces that are gone', () => {
    const one = build([box, draft({ faces: [sides[0] as FaceNameRef] })]);
    const shrink = 40 * Math.tan((5 * Math.PI) / 180);
    expect(one.captures[0]?.properties?.volume).toBeCloseTo(240_000 - 100 * (40 * shrink) / 2, 4);
    const gone = face('x:side', [0, 0, 500]);
    expect(build([box, draft({ faces: [sides[0] as FaceNameRef, gone] })]).features.at(-1)).toMatchObject({ status: 'ok', warning: { code: 'draft-face-missing', detail: '1' } });
  });

  it('reports faces that cannot be tilted and a draft without faces', () => {
    // The top is at a right angle to the pull direction.
    expect(build([box, draft({ faces: [face('b:top', [0, 0, 40])] })]).features.at(-1)?.error).toEqual({ code: 'draft-face', detail: '1' });
    expect(build([box, draft({ faces: [] })]).features.at(-1)?.error?.code).toBe('draft-faces');
  });
});
