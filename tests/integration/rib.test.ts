/** Ribs: walls from the open curves of a sketch up to the body. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, Feature, PlaneFeature, RibFeature, SketchFeature, Vec3 } from '../../src/shared/model/feature.ts';
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
const sketch = (plane: SketchPlaneRef, ...entities: SketchEntity[]): SketchFeature => ({ id: 's', type: 'sketch', plane, sketch: { entities, constraints: [] } });
const box = (id: string, width: number, depth: number, height: number, position: Vec3): BoxFeature => ({ id, type: 'box', operation: 'add', width, depth, height, position });
const rib = (more: Partial<RibFeature> = {}): RibFeature => ({ id: 'r', type: 'rib', sketch: 's', thickness: 4, direction: 'parallel', flip: false, ...more });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;

// An angle bracket: a floor (z 0 to 10) and a wall at its left end (x −50 to −40, up to z 70).
const floor = box('f', 100, 60, 10, [0, 0, 0]);
const wall = box('w', 10, 60, 60, [-45, 0, 10]);
const bracket = 60_000 + 36_000;
// On the front plane (x, z): a line from the wall at z 50 down to the floor at x 10.
const gusset = sketch({ kind: 'standard', plane: 'front' }, P('a', -40, 50), P('b', 10, 10), L('ab', 'a', 'b'));

describe('rib', () => {
  it('fills the corner between a line and the walls within the sketch plane', () => {
    // A triangle of 50 × 40, 4 thick.
    const result = build([floor, wall, gusset, rib()]);
    expect(result.features.at(-1)?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(bracket + 1000 * 4, 3);
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['r:side:ab:a', 'r:side:ab:b', 'r:start']));
    // The other side of the line is open: flipped, the rib still finds the corner.
    expect(volumeOf([floor, wall, gusset, rib({ flip: true })])).toBeCloseTo(bracket + 1000 * 4, 3);
  });

  it('grows along the sketch normal down to a plate', () => {
    const plate = box('p', 100, 60, 10, [0, 0, 0]);
    const plane: PlaneFeature = { id: 'up', type: 'plane', method: 'offset', references: [{ kind: 'standard-plane', plane: 'top' }], distance: 30, angle: 45, flip: false };
    const line = sketch({ kind: 'feature', feature: 'up', frame: frameOnPlane([0, 0, 30], [0, 0, 1]) }, P('a', -20, 0), P('b', 20, 0), L('ab', 'a', 'b'));
    // 40 long, 4 wide (square ends), 20 down to the plate.
    expect(volumeOf([plate, plane, line, rib({ direction: 'normal' })])).toBeCloseTo(60_000 + 40 * 4 * 20, 3);
  });

  it('reports curves a rib within its plane cannot follow and a rib that meets nothing', () => {
    const arc = sketch({ kind: 'standard', plane: 'front' }, P('m', 0, 30), P('a', 20, 30), P('b', -20, 30), { id: 'k', type: 'arc', center: 'm', start: 'a', end: 'b' });
    expect(build([floor, wall, arc, rib()]).features.at(-1)?.error).toEqual({ code: 'rib-curves', detail: 'k' });
    const away = sketch({ kind: 'standard', plane: 'front' }, P('a', 100, 100), P('b', 120, 120), L('ab', 'a', 'b'));
    expect(['end-missed', 'end-behind']).toContain(build([floor, wall, away, rib()]).features.at(-1)?.error?.code);
  });
});
