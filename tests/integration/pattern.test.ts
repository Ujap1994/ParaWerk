/** Linear and circular patterns and mirror images of features. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import { defaultFeature, type AxisFeature, type BoxFeature, type CylinderFeature, type ExtrudeFeature, type Feature, type HoleFeature, type MirrorFeature, type PatternFeature, type SketchFeature } from '../../src/shared/model/feature.ts';
import { circularTransforms, linearTransforms, mirrorTransform, transformPoint } from '../../src/shared/model/pattern.ts';
import type { GeometryRef } from '../../src/shared/model/reference.ts';
import { frameOnPlane } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const plate: BoxFeature = { id: 'plate', type: 'box', operation: 'add', width: 200, depth: 100, height: 10, position: [0, 0, 0] };
const PLATE = 200 * 100 * 10;
const boss: CylinderFeature = { id: 'boss', type: 'cylinder', operation: 'add', radius: 5, height: 10, axis: 'z', position: [-60, 0, 10] };
const BOSS = Math.PI * 25 * 10;
const right: GeometryRef = { kind: 'standard-plane', plane: 'right' };
const front: GeometryRef = { kind: 'standard-plane', plane: 'front' };

const pattern = (overrides: Partial<PatternFeature>): PatternFeature => ({ ...(defaultFeature('pattern', 'pattern') as PatternFeature), ...overrides });
const mirror = (overrides: Partial<MirrorFeature>): MirrorFeature => ({ ...(defaultFeature('mirror', 'mirror') as MirrorFeature), ...overrides });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;

describe('transformations', () => {
  it('moves, turns and mirrors points', () => {
    expect(linearTransforms([2, 0, 0], 10, 3).map((m) => transformPoint(m, [1, 2, 3]))).toEqual([[11, 2, 3], [21, 2, 3]]);
    const turned = circularTransforms([10, 0, 0], [0, 0, 1], 360, 4).map((m) => transformPoint(m, [20, 0, 5]).map((v) => Math.round(v * 1e9) / 1e9 + 0));
    expect(turned).toEqual([[10, 10, 5], [0, 0, 5], [10, -10, 5]]);
    // A partial angle puts the last copy at its end.
    expect(circularTransforms([0, 0, 0], [0, 0, 1], 90, 3).map((m) => transformPoint(m, [1, 0, 0]).map((v) => Math.round(v * 1e9) / 1e9 + 0))).toEqual([
      [Math.round(Math.SQRT1_2 * 1e9) / 1e9, Math.round(Math.SQRT1_2 * 1e9) / 1e9, 0],
      [0, 1, 0],
    ]);
    expect(transformPoint(mirrorTransform([5, 0, 0], [1, 0, 0]), [8, 1, 2])).toEqual([2, 1, 2]);
  });
});

describe('patterns', () => {
  it('copies a boss along the normal of a plane', () => {
    const result = build([plate, boss, pattern({ references: [right], features: ['boss'], count: 4, spacing: 30 })]);
    expect(result.features[2]?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(PLATE + 4 * BOSS, 4);
    expect(result.captures[0]?.properties?.bboxMax[0]).toBeCloseTo(100, 6);
    // The copies' faces are named after the pattern, the copied feature and the copy.
    const names = result.captures[0]?.mesh?.naming.faces ?? [];
    expect(names).toEqual(expect.arrayContaining(['boss:side', 'pattern:boss:0:boss:side', 'pattern:boss:2:boss:top']));
  });

  it('copies extruded cuts the other way along an edge direction', () => {
    const sketch: SketchFeature = {
      id: 'circle', type: 'sketch', plane: { kind: 'face', face: 5, name: 'plate:top', frame: frameOnPlane([0, 0, 10], [0, 0, 1]) },
      sketch: { entities: [{ id: 'm', type: 'point', x: 60, y: 0 }, { id: 'c', type: 'circle', center: 'm', radius: 4 }], constraints: [] },
    };
    const cut: ExtrudeFeature = { id: 'cut', type: 'extrude', operation: 'cut', sketch: 'circle', depth: 10, direction: 'reverse', end: 'throughAll' };
    const result = build([plate, sketch, cut, pattern({ references: [right], features: ['cut'], count: 3, spacing: 40, flip: true })]);
    expect(result.features[3]?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(PLATE - 3 * Math.PI * 16 * 10, 3);
  });

  it('copies holes around an axis, all round or over an angle', () => {
    const disk: CylinderFeature = { id: 'disk', type: 'cylinder', operation: 'add', radius: 50, height: 10, axis: 'z', position: [0, 0, 0] };
    const points: SketchFeature = {
      id: 'points', type: 'sketch', plane: { kind: 'face', face: 2, name: 'disk:top', frame: frameOnPlane([0, 0, 10], [0, 0, 1]) },
      sketch: { entities: [{ id: 'p', type: 'point', x: 35, y: 0 }], constraints: [] },
    };
    const hole: HoleFeature = { ...(defaultFeature('hole', 'hole') as HoleFeature), sketch: 'points' };
    const zAxis: AxisFeature = { id: 'z', type: 'axis', method: 'twoPlanes', references: [front, right] };
    const around = pattern({ method: 'circular', references: [{ kind: 'feature', feature: 'z' }], features: ['hole'], count: 6 });
    const DISK = Math.PI * 2500 * 10;
    const HOLE = Math.PI * 3.3 * 3.3 * 10;
    expect(volumeOf([disk, points, hole, zAxis, around])).toBeCloseTo(DISK - 6 * HOLE, 3);
    const result = build([disk, points, hole, zAxis, { ...around, angle: 90, count: 3 }]);
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(DISK - 3 * HOLE, 3);
    expect(result.features.map((feature) => feature.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
  });
});

describe('mirror', () => {
  it('mirrors a boss and holes through a plane', () => {
    expect(volumeOf([plate, boss, mirror({ references: [right], features: ['boss'] })])).toBeCloseTo(PLATE + 2 * BOSS, 4);
    const result = build([plate, boss, mirror({ references: [right], features: ['boss'] })]);
    expect(result.captures[0]?.properties?.bboxMin[0]).toBeCloseTo(-100, 6);
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['mirror:boss:0:boss:side']));
  });
});

describe('what cannot be copied', () => {
  it('reports missing, unsupported and unchosen features and a missing direction', () => {
    const fillet: Feature = { id: 'round', type: 'fillet', radius: 1, edges: [{ kind: 'edge-index', index: 0 }] };
    expect(build([plate, boss, pattern({ references: [right], features: [] })]).features[2]?.error?.code).toBe('pattern-empty');
    expect(build([plate, boss, pattern({ references: [right], features: ['gone'] })]).features[2]?.error).toEqual({ code: 'pattern-seed-missing', detail: '1' });
    expect(build([plate, fillet, pattern({ references: [right], features: ['round'] })]).features[2]?.error?.code).toBe('pattern-unsupported');
    expect(build([plate, boss, pattern({ references: [], features: ['boss'] })]).features[2]?.error?.code).toBe('reference-missing');
    expect(build([plate, { ...boss, suppressed: true }, pattern({ references: [right], features: ['boss'] })]).features[2]?.error?.code).toBe('pattern-seed-missing');
  });
});
