/** Full rounds: a center face replaced by half a cylinder tangent to it and to two parallel side faces. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CylinderFeature, Feature, FilletFeature, Vec3 } from '../../src/shared/model/feature.ts';
import type { FaceNameRef } from '../../src/shared/model/reference.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const box = (id: string, width: number, depth: number, height: number, position: Vec3): BoxFeature => ({ id, type: 'box', operation: 'add', width, depth, height, position });
const face = (name: string, at: Vec3): FaceNameRef => ({ kind: 'face', name, at });
const round = (refs: FaceNameRef[]): FilletFeature => ({ id: 'r', type: 'fillet', radius: 1, edges: [], method: 'fullRound', round: refs });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

// A plate 100 × 60 × 10 with a rib 80 long, 6 wide and 20 high on top.
const plate = box('p', 100, 60, 10, [0, 0, 0]);
const rib = box('rib', 80, 6, 20, [0, 0, 10]);
const ribRound = round([face('rib:front', [0, -3, 20]), face('rib:top', [0, 0, 30]), face('rib:back', [0, 3, 20])]);

describe('full round', () => {
  it('rounds the top of a rib over its length', () => {
    const result = build([plate, rib, ribRound]);
    expect(result.features.at(-1)?.status).toBe('ok');
    // The top 3 mm of the rib become half a cylinder of radius 3.
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(60_000 + 80 * 6 * 17 + 80 * (Math.PI * 9) / 2, 4);
    expect(result.captures[0]?.mesh?.naming.faces).toContain('r:round');
    expect(result.captures[0]?.mesh?.naming.faces).not.toContain('rib:top');
  });

  it('rounds the end of a tab and keeps a hole through the rounded part', () => {
    // The right end of the plate between its top and bottom faces: radius 5.
    const end = round([face('p:top', [0, 0, 10]), face('p:right', [50, 0, 5]), face('p:bottom', [0, 0, 0])]);
    expect(build([plate, end]).captures[0]?.properties?.volume).toBeCloseTo(95 * 60 * 10 + 60 * (Math.PI * 25) / 2, 4);
    // A hole through the rib top (a cross bore along y) stays a hole.
    const bore: CylinderFeature = { id: 'h', type: 'cylinder', operation: 'cut', radius: 1, height: 20, axis: 'y', position: [20, -10, 28] };
    const withBore = build([plate, rib, bore, ribRound]);
    expect(withBore.features.at(-1)?.status).toBe('ok');
    const plain = build([plate, rib, ribRound]).captures[0]?.properties?.volume ?? NaN;
    expect(withBore.captures[0]?.properties?.volume).toBeLessThan(plain - 1);
  });

  it('reports faces that do not fit, are missing or gone', () => {
    // Front and top are at a right angle, not parallel.
    const crooked = round([face('rib:front', [0, -3, 20]), face('rib:back', [0, 3, 20]), face('rib:top', [0, 0, 30])]);
    expect(build([plate, rib, crooked]).features.at(-1)?.error?.code).toBe('round-sides');
    expect(build([plate, rib, round([face('rib:front', [0, -3, 20])])]).features.at(-1)?.error?.code).toBe('round-faces');
    const gone = round([face('rib:front', [0, -3, 20]), face('x:top', [0, 0, 500]), face('rib:back', [0, 3, 20])]);
    expect(build([plate, rib, gone]).features.at(-1)?.error).toEqual({ code: 'round-face-missing', detail: '2' });
  });

  it('follows the rib when it changes', () => {
    const taller = build([plate, { ...rib, height: 30 }, ribRound]);
    expect(taller.captures[0]?.properties?.volume).toBeCloseTo(60_000 + 80 * 6 * 27 + 80 * (Math.PI * 9) / 2, 4);
  });
});

describe('face fillet', () => {
  const block = box('b', 100, 60, 40, [0, 0, 0]);
  const top = face('b:top', [0, 0, 40]);
  const front = face('b:front', [0, -30, 20]);
  const faceFillet = (refs: FaceNameRef[], radius = 5): FilletFeature => ({ id: 'r', type: 'fillet', radius, edges: [], method: 'faces', round: refs });
  const edgeFillet: FilletFeature = { id: 'r', type: 'fillet', radius: 5, edges: [{ kind: 'edge', faces: ['b:front', 'b:top'], at: [0, -30, 40] }] };
  const volume = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;

  it('rounds an outer corner like an edge fillet, also over a chamfer between the faces', () => {
    expect(volume([block, faceFillet([top, front])])).toBeCloseTo(240_000 - 25 * (1 - Math.PI / 4) * 100, 4);
    expect(volume([block, faceFillet([top, front])])).toBeCloseTo(volume([block, edgeFillet]), 4);
    // A 2 mm chamfer lies inside what a 5 mm round takes away.
    const chamfer: Feature = { id: 'c', type: 'chamfer', distance: 2, edges: [{ kind: 'edge', faces: ['b:front', 'b:top'], at: [0, -30, 40] }] };
    const over = build([block, chamfer, faceFillet([top, front])]);
    expect(over.features.at(-1)?.status).toBe('ok');
    expect(over.captures[0]?.properties?.volume).toBeCloseTo(240_000 - 25 * (1 - Math.PI / 4) * 100, 4);
    expect(over.captures[0]?.mesh?.naming.faces).toContain('r:round');
  });

  it('fills an inner corner', () => {
    // An L: a floor and a wall at its left end; the corner between the floor's top and the wall's inner face.
    const floor = box('f', 100, 60, 10, [0, 0, 0]);
    const wall = box('w', 10, 60, 50, [-45, 0, 10]);
    const corner = faceFillet([face('f:top', [0, 0, 10]), face('w:right', [-40, 0, 30])]);
    expect(volume([floor, wall, corner])).toBeCloseTo(60_000 + 30_000 + 25 * (1 - Math.PI / 4) * 60, 4);
  });

  it('reports faces that cannot be rounded', () => {
    expect(build([block, faceFillet([top, front], 200)]).features.at(-1)?.error?.code).toBe('round-radius');
    expect(build([block, faceFillet([top, face('b:bottom', [0, 0, 0])])]).features.at(-1)?.error?.code).toBe('round-planes');
    expect(build([block, faceFillet([top])]).features.at(-1)?.error).toEqual({ code: 'round-faces', detail: '1/2' });
  });
});
