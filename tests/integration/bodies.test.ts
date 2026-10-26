/** Parts of several bodies: separate bodies, cuts and merges body by body, combining and deleting bodies. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CombineFeature, CylinderFeature, Feature } from '../../src/shared/model/feature.ts';
import type { FaceNameRef } from '../../src/shared/model/reference.ts';

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

// Body a: x −50 … 50, y −30 … 30, z 0 … 40. Body b, of its own: x 30 … 70, y −20 … 20, z 20 … 60.
const a: BoxFeature = { id: 'a', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const b: BoxFeature = { id: 'b', type: 'box', operation: 'add', merge: false, width: 40, depth: 40, height: 40, position: [50, 0, 20] };
const A = 240_000;
const B = 64_000;
const SHARED = 20 * 40 * 20;
const topOfA: FaceNameRef = { kind: 'face', name: 'a:top', at: [0, 0, 40] };
const topOfB: FaceNameRef = { kind: 'face', name: 'b:top', at: [50, 0, 60] };
const combine = (operation: CombineFeature['operation'], bodies: FaceNameRef[]): CombineFeature => ({ id: 'c', type: 'combine', operation, bodies });
const bodiesOf = (result: ReturnType<typeof build>) => new Set(result.captures[0]?.mesh?.naming.faceBodies ?? []).size;

describe('separate bodies', () => {
  it('keeps a body of its own that overlaps the other', () => {
    const result = build([a, b]);
    expect(bodiesOf(result)).toBe(2);
    // Mass properties count every body.
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(A + B, 3);
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['a:top', 'b:top']));
    // Merged (the default), the same boxes are one body.
    const merged = build([a, { ...b, merge: true }]);
    expect(bodiesOf(merged)).toBe(1);
    expect(merged.captures[0]?.properties?.volume).toBeCloseTo(A + B - SHARED, 3);
  });

  it('cuts every body a cut reaches, each on its own', () => {
    // A shaft of radius 5 along z through both bodies at x = 40.
    const bore: CylinderFeature = { id: 'h', type: 'cylinder', operation: 'cut', radius: 5, height: 100, axis: 'z', position: [40, 0, -10] };
    const result = build([a, b, bore]);
    expect(bodiesOf(result)).toBe(2);
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(A - Math.PI * 25 * 40 + (B - Math.PI * 25 * 40), 2);
  });

  it('merges added material with the bodies it touches, all into one', () => {
    // A bar across both bodies above a: it touches both.
    const bar: BoxFeature = { id: 'bar', type: 'box', operation: 'add', width: 120, depth: 10, height: 10, position: [10, 0, 40] };
    const result = build([a, b, bar]);
    expect(bodiesOf(result)).toBe(1);
    // A, B and the bar, without what they share: a and b 16 000, the bar and b 20 · 10 · 10 (x 30 … 50 … 70 above z 40).
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(A + B + 12_000 - SHARED - 40 * 10 * 10, 2);
    // A bar away from both becomes a body of its own.
    const away = build([a, b, { ...bar, position: [0, 100, 0] }]);
    expect(bodiesOf(away)).toBe(3);
  });
});

describe('features on one of overlapping bodies', () => {
  it('shells, drafts and threads only the body their faces belong to', () => {
    // a shelled 3 thick, open at its top: the cube b stays solid.
    const shelled = build([a, b, { id: 's', type: 'shell', thickness: 3, faces: [topOfA], outward: false }]);
    expect(shelled.features.at(-1)?.status).toBe('ok');
    expect(bodiesOf(shelled)).toBe(2);
    expect(shelled.captures[0]?.properties?.volume).toBeCloseTo(A - 94 * 54 * 37 + B, 1);
    // Two sides of b drafted 5° about its bottom: each adds half of 40 · 40 · tan 5° · 40.
    const drafted = build([a, b, {
      id: 'd', type: 'draft', method: 'neutralPlane', references: [{ kind: 'face', name: 'b:bottom', at: [50, 0, 20] }],
      faces: [{ kind: 'face', name: 'b:front', at: [50, -20, 40] }, { kind: 'face', name: 'b:back', at: [50, 20, 40] }], angle: 5, flip: false,
    }]);
    expect(drafted.captures[0]?.properties?.volume).toBeCloseTo(A + B + 2 * 0.5 * 40 * 40 * Math.tan((5 * Math.PI) / 180) * 40, 0);
    // A thread on a pin of its own that stands in a.
    const pin: CylinderFeature = { id: 'p', type: 'cylinder', operation: 'add', merge: false, radius: 5, height: 30, axis: 'z', position: [-30, 0, 30] };
    const before = build([a, pin]).captures[0]?.properties?.volume ?? 0;
    const threaded = build([a, pin, { id: 't', type: 'thread', faces: [{ kind: 'face', name: 'p:side', at: [-25, 0, 50] }], size: 'M10', pitch: 1.5, length: 10, reverse: false, leftHand: false }]);
    expect(threaded.features.at(-1)?.status).toBe('ok');
    expect(threaded.captures[0]?.properties?.volume).toBeLessThan(before - 50);
  });

  it('reports faces of different bodies in one feature', () => {
    const result = build([a, b, { id: 'f', type: 'fillet', radius: 3, edges: [], method: 'faces', round: [topOfA, { kind: 'face', name: 'b:front', at: [50, -20, 40] }] }]);
    expect(result.features.at(-1)?.error?.code).toBe('faces-bodies');
  });
});

describe('combine and delete bodies', () => {
  it('fuses, subtracts and intersects bodies', () => {
    const add = build([a, b, combine('add', [topOfA, topOfB])]);
    expect(add.features.at(-1)?.status).toBe('ok');
    expect(bodiesOf(add)).toBe(1);
    expect(add.captures[0]?.properties?.volume).toBeCloseTo(A + B - SHARED, 3);
    const subtract = build([a, b, combine('subtract', [topOfA, topOfB])]);
    expect(bodiesOf(subtract)).toBe(1);
    expect(subtract.captures[0]?.properties?.volume).toBeCloseTo(A - SHARED, 3);
    // The other way round: b minus a.
    expect(build([a, b, combine('subtract', [topOfB, topOfA])]).captures[0]?.properties?.volume).toBeCloseTo(B - SHARED, 3);
    const common = build([a, b, combine('common', [topOfA, topOfB])]);
    expect(common.captures[0]?.properties?.volume).toBeCloseTo(SHARED, 3);
    // Faces keep their names through the combination.
    expect(subtract.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['a:top', 'a:bottom']));
  });

  it('leaves bodies it does not pick', () => {
    const third: BoxFeature = { id: 'd', type: 'box', operation: 'add', merge: false, width: 10, depth: 10, height: 10, position: [0, 100, 0] };
    const result = build([a, b, third, combine('add', [topOfA, topOfB])]);
    expect(bodiesOf(result)).toBe(2);
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(A + B - SHARED + 1000, 3);
  });

  it('deletes bodies', () => {
    const result = build([a, b, { id: 'x', type: 'deleteBody', bodies: [topOfB] }]);
    expect(bodiesOf(result)).toBe(1);
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(A, 3);
    expect(build([a, b, { id: 'x', type: 'deleteBody', bodies: [topOfA, topOfB] }]).features.at(-1)?.error?.code).toBe('empty-result');
  });

  it('reports what it cannot combine', () => {
    expect(build([a, b, combine('add', [topOfA])]).features.at(-1)?.error?.code).toBe('combine-bodies');
    // Two faces of the same body are one body.
    expect(build([a, b, combine('add', [topOfA, { kind: 'face', name: 'a:bottom', at: [0, 0, 0] }])]).features.at(-1)?.error?.code).toBe('combine-bodies');
    expect(build([a, b, combine('add', [topOfA, { kind: 'face', name: 'z:top', at: [500, 500, 500] }])]).features.at(-1)?.error?.code).toBe('body-missing');
    // Far apart, two bodies have nothing in common.
    const far = { ...b, position: [0, 100, 0] as [number, number, number] };
    expect(build([a, far, combine('common', [topOfA, { kind: 'face', name: 'b:top', at: [0, 100, 40] }])]).features.at(-1)?.error?.code).toBe('empty-result');
  });
});
