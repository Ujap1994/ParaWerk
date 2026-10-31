/** Moving and copying bodies of a part (docs/adr/0011-multi-body-parts.md). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { RebuildResult } from '../../src/kernel/protocol.ts';
import { defaultFeature, type AxisFeature, type BoxFeature, type CylinderFeature, type EdgeNameRef, type Feature, type MoveBodyFeature } from '../../src/shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf, type BodyNaming } from '../../src/shared/model/naming.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

// A plate (x −50 … 50, y −30 … 30, z 0 … 10) and a puck of its own on it at x 30.
const plate: BoxFeature = { id: 'plate', type: 'box', operation: 'add', width: 100, depth: 60, height: 10, position: [0, 0, 0] };
const puck: CylinderFeature = { id: 'puck', type: 'cylinder', operation: 'add', merge: false, radius: 5, height: 8, axis: 'z', position: [30, 0, 10] };
const PLATE = 100 * 60 * 10;
const PUCK = Math.PI * 25 * 8;
const puckFace = { kind: 'face' as const, name: 'puck:top', at: [30, 0, 18] as [number, number, number] };
const move = (more: Partial<MoveBodyFeature> = {}): MoveBodyFeature => ({ ...(defaultFeature('moveBody', 'move') as MoveBodyFeature), bodies: [puckFace], ...more });

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

describe('move body', () => {
  it('shifts a body and keeps the names of its faces', () => {
    const result = build([plate, puck, move({ dx: -60, dy: 10 })]);
    expect(result.features[2]?.status).toBe('ok');
    expect(bodies(result)).toBe(2);
    expect(volume(result)).toBeCloseTo(PLATE + PUCK, 3);
    // The puck now spans x −35 … −25: the plate still starts at −50.
    expect(naming(result).faces).toEqual(expect.arrayContaining(['puck:top', 'puck:side']));
    const top = naming(result).faces.indexOf('puck:top');
    expect(naming(result).facePlanes[6 * top]).toBeCloseTo(-30, 6);
    expect(naming(result).facePlanes[6 * top + 1]).toBeCloseTo(10, 6);
  });

  it('copies a body as a body of its own, its faces named after the feature', () => {
    const result = build([plate, puck, move({ dx: 0, dy: -20, copy: true })]);
    expect(bodies(result)).toBe(3);
    expect(volume(result)).toBeCloseTo(PLATE + 2 * PUCK, 3);
    expect(naming(result).faces).toEqual(expect.arrayContaining(['puck:top', 'move:puck:top']));
  });

  it('turns a body about an axis', () => {
    const zAxis: AxisFeature = { id: 'z', type: 'axis', method: 'twoPlanes', references: [{ kind: 'standard-plane', plane: 'front' }, { kind: 'standard-plane', plane: 'right' }] };
    const result = build([plate, puck, zAxis, move({ method: 'rotate', references: [{ kind: 'feature', feature: 'z' }], angle: 90 })]);
    expect(result.features[3]?.status).toBe('ok');
    // x 30 turned by 90° about z: y 30.
    const top = naming(result).faces.indexOf('puck:top');
    expect(naming(result).facePlanes[6 * top]).toBeCloseTo(0, 6);
    expect(naming(result).facePlanes[6 * top + 1]).toBeCloseTo(30, 6);
  });

  it('keeps a fillet on the moved body when the move changes', () => {
    const base = [plate, puck, move({ dx: -60 })];
    const round: Feature = { id: 'round', type: 'fillet', radius: 1, edges: [edgeBetween(base, 'puck:top', 'puck:side')] };
    expect(build([...base, round]).features.map((feature) => feature.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    const further = build([plate, puck, move({ dx: -70 }), round]);
    expect(further.features.map((feature) => [feature.status, feature.warning?.code])).toEqual([
      ['ok', undefined],
      ['ok', undefined],
      ['ok', undefined],
      ['ok', undefined],
    ]);
  });

  it('tells when no body is picked or the axis is missing', () => {
    expect(build([plate, puck, move({ bodies: [] })]).features[2]?.error?.code).toBe('move-bodies');
    expect(build([plate, puck, move({ method: 'rotate', references: [] })]).features[2]?.error?.code).toBe('reference-missing');
  });
});
