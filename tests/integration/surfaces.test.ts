/** Surfaces: offset from faces, knit together, thickened or filled into solids. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, Feature, KnitFeature, OffsetSurfaceFeature, ThickenFeature } from '../../src/shared/model/feature.ts';
import type { FaceNameRef, ReferenceGeometry } from '../../src/shared/model/reference.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

// A box x −50 … 50, y −30 … 30, z 0 … 40.
const box: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const BOX = 240_000;
const face = (name: string, at: [number, number, number]): FaceNameRef => ({ kind: 'face', name: `b:${name}`, at });
const top = face('top', [0, 0, 40]);
const front = face('front', [0, -30, 20]);
const all = [top, face('bottom', [0, 0, 0]), front, face('back', [0, 30, 20]), face('left', [-50, 0, 20]), face('right', [50, 0, 20])];
const offset = (id: string, faces: FaceNameRef[], distance: number): OffsetSurfaceFeature => ({ id, type: 'offsetSurface', faces, distance });
const thicken = (more: Partial<ThickenFeature>): ThickenFeature => ({ id: 't', type: 'thicken', surface: 's', thickness: 5, side: 'normal', fill: false, ...more });

function surfaceOf(features: Feature[]): Extract<ReferenceGeometry, { kind: 'surface' }> {
  const result = build(features).features.at(-1);
  expect(result?.error).toBeUndefined();
  if (result?.reference?.kind !== 'surface') throw new Error(`no surface: ${JSON.stringify(result?.error)}`);
  return result.reference;
}

describe('offset surface', () => {
  it('copies faces or moves them along their normals', () => {
    const copy = surfaceOf([box, offset('s', [top], 0)]);
    expect(copy).toMatchObject({ faces: 1, closed: false });
    expect(copy.area).toBeCloseTo(6000, 3);
    expect(copy.indices.length).toBeGreaterThan(0);
    const lifted = surfaceOf([box, offset('s', [top], 10)]);
    expect(lifted.area).toBeCloseTo(6000, 3);
    // The triangles lie 10 above the top.
    for (let i = 2; i < lifted.positions.length; i += 3) expect(lifted.positions[i]).toBeCloseTo(50, 3);
    // Two faces at an edge: the offset rounds over it.
    const corner = surfaceOf([box, offset('s', [top, front], 5)]);
    expect(corner.area).toBeCloseTo(6000 + 4000 + (Math.PI / 2) * 5 * 100, 1);
  });

  it('encloses a volume when all faces of the box are taken', () => {
    expect(surfaceOf([box, offset('s', all, 0)])).toMatchObject({ faces: 6, closed: true });
  });

  it('reports surfaces it cannot make', () => {
    expect(build([box, offset('s', [], 5)]).features.at(-1)?.error?.code).toBe('surface-faces');
    expect(build([offset('s', [top], 5)]).features.at(-1)?.error?.code).toBe('no-body');
  });
});

describe('knit', () => {
  it('joins surfaces into one', () => {
    const knit: KnitFeature = { id: 'k', type: 'knit', surfaces: ['s1', 's2'] };
    const joined = surfaceOf([box, offset('s1', [top], 0), offset('s2', [front], 0), knit]);
    expect(joined).toMatchObject({ faces: 2, closed: false });
    expect(joined.area).toBeCloseTo(10_000, 3);
    expect(build([box, { ...knit, surfaces: ['gone'] }]).features.at(-1)?.error?.code).toBe('surface-missing');
  });
});

describe('thicken', () => {
  const lid = offset('s', [top], 0);

  it('grows a solid from a surface, on either side or both', () => {
    // On top of the box: fused, or a body of its own.
    expect(build([box, lid, thicken({})]).captures[0]?.properties?.volume).toBeCloseTo(BOX + 30_000, 2);
    const separate = build([box, lid, thicken({ merge: false })]);
    expect(new Set(separate.captures[0]?.mesh?.naming.faceBodies ?? []).size).toBe(2);
    // Into the box it adds nothing; half each way adds half.
    expect(build([box, lid, thicken({ side: 'reverse' })]).captures[0]?.properties?.volume).toBeCloseTo(BOX, 2);
    expect(build([box, lid, thicken({ side: 'both' })]).captures[0]?.properties?.volume).toBeCloseTo(BOX + 15_000, 2);
  });

  it('fills a closed surface', () => {
    const shell = offset('s', all, 0);
    const filled = build([box, shell, thicken({ fill: true, merge: false })]);
    expect(filled.features.at(-1)?.status).toBe('ok');
    expect(filled.captures[0]?.properties?.volume).toBeCloseTo(2 * BOX, 2);
    expect(build([box, lid, thicken({ fill: true })]).features.at(-1)?.error?.code).toBe('surface-open');
    expect(build([box, thicken({})]).features.at(-1)?.error?.code).toBe('surface-missing');
  });
});
