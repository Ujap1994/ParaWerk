/** Projected curves (onto faces, sketch on sketch) and composite curves, and sweeps along them. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CompositeCurveFeature, CylinderFeature, Feature, PlaneFeature, ProjectedCurveFeature, SketchFeature, SweepFeature, Vec3 } from '../../src/shared/model/feature.ts';
import type { ReferenceGeometry } from '../../src/shared/model/reference.ts';
import { frameOnPlane, type SketchEntity, type SketchPlaneRef } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const sketch = (id: string, plane: SketchPlaneRef, ...entities: SketchEntity[]): SketchFeature => ({ id, type: 'sketch', plane, sketch: { entities, constraints: [] } });
const top: SketchPlaneRef = { kind: 'standard', plane: 'top' };

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

/** The drawn geometry of the last feature, a curve. */
function curveOf(features: Feature[]): Extract<ReferenceGeometry, { kind: 'curve' }> {
  const result = build(features).features.at(-1);
  expect(result?.error).toBeUndefined();
  const geometry = result?.reference;
  if (geometry?.kind !== 'curve') throw new Error(`no curve: ${JSON.stringify(result)}`);
  return geometry;
}

const points = (curve: Extract<ReferenceGeometry, { kind: 'curve' }>): Vec3[] => curve.polylines.flat();

describe('projected curve onto faces', () => {
  // A shaft of radius 20 along x (x from -50 to 50) and a line at y = 10 on the top plane through its axis.
  const shaft: CylinderFeature = { id: 'c', type: 'cylinder', operation: 'add', radius: 20, height: 100, axis: 'x', position: [-50, 0, 0] };
  const line = sketch('s', top, P('a', -40, 10), P('b', 40, 10), L('ab', 'a', 'b'));
  const project = (more: Partial<ProjectedCurveFeature> = {}): ProjectedCurveFeature => ({
    id: 'p', type: 'projectedCurve', method: 'faces', sketch: 's', faces: [{ kind: 'face', name: 'c:side', at: [0, 0, 20] }], side: 'both', sketch2: '', ...more,
  });

  it('lands on the faces on both sides of the sketch, or on one', () => {
    const both = curveOf([shaft, line, project()]);
    expect(both.chains).toBe(2);
    expect(both.length).toBeCloseTo(160, 3);
    const up = curveOf([shaft, line, project({ side: 'normal' })]);
    expect(up.chains).toBe(1);
    expect(up.length).toBeCloseTo(80, 3);
    // On the shaft above the sketch: z = √(20² − 10²).
    for (const [, y, z] of points(up)) {
      expect(y).toBeCloseTo(10, 3);
      expect(z).toBeCloseTo(Math.sqrt(300), 3);
    }
    const down = curveOf([shaft, line, project({ side: 'reverse' })]);
    expect(points(down)[0]?.[2]).toBeCloseTo(-Math.sqrt(300), 3);
  });

  it('reports what it cannot build', () => {
    expect(build([shaft, line, project({ faces: [] })]).features.at(-1)?.error?.code).toBe('curve-faces');
    expect(build([line, project()]).features.at(-1)?.error?.code).toBe('no-body');
    const away = sketch('s', top, P('a', -40, 30), P('b', 40, 30), L('ab', 'a', 'b'));
    expect(build([shaft, away, project()]).features.at(-1)?.error?.code).toBe('curve-missed');
    expect(build([shaft, sketch('s', top), project()]).features.at(-1)?.error?.code).toBe('curve-empty');
  });

  it('follows the body when it changes', () => {
    const thicker = { ...shaft, radius: 25 };
    const up = curveOf([thicker, line, project({ side: 'normal', faces: [{ kind: 'face', name: 'c:side', at: [0, 0, 25] }] })]);
    expect(points(up)[0]?.[2]).toBeCloseTo(Math.sqrt(625 - 100), 3);
  });
});

describe('projected curve sketch on sketch', () => {
  it('is where the curves of two sketches meet', () => {
    // Seen from above a line along x, seen from the front a line rising 30 over 50.
    const plan = sketch('s', top, P('a', 0, 0), P('b', 50, 0), L('ab', 'a', 'b'));
    const side = sketch('t', { kind: 'standard', plane: 'front' }, P('c', 0, 0), P('d', 50, 30), L('cd', 'c', 'd'));
    const curve = curveOf([plan, side, { id: 'p', type: 'projectedCurve', method: 'sketch', sketch: 's', faces: [], side: 'both', sketch2: 't' }]);
    expect(curve.chains).toBe(1);
    expect(curve.length).toBeCloseTo(Math.hypot(50, 30), 3);
    for (const [x, y, z] of points(curve)) {
      expect(y).toBeCloseTo(0, 4);
      expect(z).toBeCloseTo((x * 30) / 50, 3);
    }
    // A sweep along it: a circle on the right plane through its start, as long as the curve is along x.
    const circle = sketch('o', { kind: 'standard', plane: 'right' }, P('m', 0, 0), { id: 'k', type: 'circle', center: 'm', radius: 2 });
    const sweep: SweepFeature = { id: 'w', type: 'sweep', operation: 'add', sketch: 'o', path: 'p' };
    const result = build([plan, side, { id: 'p', type: 'projectedCurve', method: 'sketch', sketch: 's', faces: [], side: 'both', sketch2: 't' }, circle, sweep]);
    expect(result.features.at(-1)?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(Math.PI * 4 * 50, 1);
  });

  it('reports sketches whose curves do not meet', () => {
    const plan = sketch('s', top, P('a', 0, 0), P('b', 50, 0), L('ab', 'a', 'b'));
    const far = sketch('t', { kind: 'standard', plane: 'front' }, P('c', 100, 0), P('d', 150, 30), L('cd', 'c', 'd'));
    expect(build([plan, far, { id: 'p', type: 'projectedCurve', method: 'sketch', sketch: 's', faces: [], side: 'both', sketch2: 't' }]).features.at(-1)?.error?.code).toBe('curve-missed');
  });
});

describe('composite curve', () => {
  // A block from x 0 to 100, y −30 to 30, z 0 to 40.
  const block: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [50, 0, 0] };
  const frontTop = { kind: 'edge' as const, faces: ['b:front', 'b:top'] as [string, string], at: [50, -30, 40] as Vec3 };
  const rightTop = { kind: 'edge' as const, faces: ['b:right', 'b:top'] as [string, string], at: [100, 0, 40] as Vec3 };
  const backTop = { kind: 'edge' as const, faces: ['b:back', 'b:top'] as [string, string], at: [50, 30, 40] as Vec3 };
  const leftTop = { kind: 'edge' as const, faces: ['b:left', 'b:top'] as [string, string], at: [0, 0, 40] as Vec3 };
  const composite = (more: Partial<CompositeCurveFeature>): CompositeCurveFeature => ({ id: 'cc', type: 'compositeCurve', edges: [], curves: [], ...more });

  it('joins edges end to end', () => {
    const corner = curveOf([block, composite({ edges: [frontTop, rightTop] })]);
    expect(corner).toMatchObject({ chains: 1, closed: false });
    expect(corner.length).toBeCloseTo(160, 4);
    const around = curveOf([block, composite({ edges: [frontTop, rightTop, backTop, leftTop] })]);
    expect(around).toMatchObject({ chains: 1, closed: true });
    expect(around.length).toBeCloseTo(320, 4);
  });

  it('reports edges that do not form one chain, and edges that are gone', () => {
    expect(build([block, composite({ edges: [frontTop, backTop] })]).features.at(-1)?.error?.code).toBe('path-gaps');
    expect(build([block, composite({})]).features.at(-1)?.error?.code).toBe('curve-empty');
    // Names of faces that are not there, far from every edge.
    const gone = { kind: 'edge' as const, faces: ['x:front', 'x:top'] as [string, string], at: [500, 500, 500] as Vec3 };
    expect(build([block, composite({ edges: [gone] })]).features.at(-1)?.error?.code).toBe('curve-edge-missing');
  });

  it('joins edges with sketch curves and is the path of a sweep', () => {
    // The front top edge, then 40 further along x in a sketch on a plane at the height of the top.
    const plane: PlaneFeature = { id: 'pl', type: 'plane', method: 'offset', references: [{ kind: 'standard-plane', plane: 'top' }], distance: 40, angle: 45, flip: false };
    const further = sketch('s', { kind: 'feature', feature: 'pl', frame: frameOnPlane([0, 0, 40], [0, 0, 1]) }, P('a', 100, -30), P('b', 140, -30), L('ab', 'a', 'b'));
    const path = composite({ edges: [frontTop], curves: ['s'] });
    const curve = curveOf([block, plane, further, path]);
    expect(curve).toMatchObject({ chains: 1, closed: false });
    expect(curve.length).toBeCloseTo(140, 4);
    // A wire of radius 2 around the edge and beyond: a quarter of it lies in the block along the edge.
    const wire = sketch('o', { kind: 'standard', plane: 'right' }, P('m', -30, 40), { id: 'k', type: 'circle', center: 'm', radius: 2 });
    const sweep: SweepFeature = { id: 'w', type: 'sweep', operation: 'add', sketch: 'o', path: 'cc' };
    const result = build([block, plane, further, path, wire, sweep]);
    expect(result.features.at(-1)?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(240_000 + Math.PI * 4 * (0.75 * 100 + 40), 0);
  });

  it('joins earlier curves', () => {
    const corner = composite({ id: 'c1', edges: [frontTop] });
    const more = composite({ id: 'c2', edges: [rightTop], curves: ['c1'] });
    expect(curveOf([block, corner, more]).length).toBeCloseTo(160, 4);
  });
});
