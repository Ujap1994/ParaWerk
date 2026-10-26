/** Thin features: extrusions and revolutions of walls along the sketch curves. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, ExtrudeFeature, Feature, RevolveFeature, SketchFeature } from '../../src/shared/model/feature.ts';
import type { SketchEntity } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const onTop = (...entities: SketchEntity[]): SketchFeature => ({ id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities, constraints: [] } });
const extrude = (more: Partial<ExtrudeFeature>): ExtrudeFeature => ({ id: 'e', type: 'extrude', operation: 'add', sketch: 's', depth: 10, direction: 'normal', end: 'blind', thin: 'one', thickness: 2, ...more });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;

/** An L of two lines: 40 along x, then 30 up. */
const ell = onTop(P('a', 0, 0), P('b', 40, 0), P('c', 40, 30), L('ab', 'a', 'b'), L('bc', 'b', 'c'));
const square = onTop(P('a', 0, 0), P('b', 20, 0), P('c', 20, 20), P('d', 0, 20), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a'));

describe('thin extrusions', () => {
  it('extrudes walls along open curves', () => {
    expect(volumeOf([ell, extrude({})])).toBeCloseTo((42 * 2 + 30 * 2) * 10, 6);
    expect(volumeOf([ell, extrude({ thin: 'both', thickness: 4 })])).toBeCloseTo((42 * 4 + 28 * 4) * 10, 6);
    const result = build([ell, extrude({ thin: 'both', thickness: 4 })]);
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['e:side:ab:left', 'e:side:ab:right', 'e:side:bc:end', 'e:start', 'e:end']));
  });

  it('makes a closed outline a tube, with the other options of an extrusion', () => {
    expect(volumeOf([square, extrude({})])).toBeCloseTo((24 * 24 - 400) * 10, 6);
    expect(volumeOf([square, extrude({ thin: 'other', direction: 'two', depth2: 5 })])).toBeCloseTo((400 - 16 * 16) * 15, 6);
    // A thin cut through a block: a square groove.
    const block: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 60, depth: 60, height: 10, position: [10, 10, -10] };
    expect(volumeOf([block, square, extrude({ operation: 'cut', direction: 'reverse', end: 'throughAll' })])).toBeCloseTo(36_000 - (24 * 24 - 400) * 10, 6);
  });

  it('reports walls that cannot be built', () => {
    expect(build([square, extrude({ thin: 'other', thickness: 30 })]).features[1]?.error?.code).toBe('thin-too-thick');
    const spline = onTop(P('a', 0, 0), P('b', 10, 5), P('c', 20, 0), { id: 'sp', type: 'spline', points: ['a', 'b', 'c'] });
    expect(build([spline, extrude({})]).features[1]?.error).toEqual({ code: 'thin-unsupported', detail: 'sp' });
  });
});

describe('thin revolutions', () => {
  it('turns a wall into a tube', () => {
    // A line from (10, 0) to (10, 30) beside the axis x = 0, walls outward: a tube 10 to 12 in radius.
    const profile: SketchFeature = {
      id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'front' },
      sketch: { entities: [P('a', 10, 0), P('b', 10, 30), L('ab', 'a', 'b'), P('o', 0, 0), P('t', 0, 10), { ...L('axis', 'o', 't'), construction: true } as SketchEntity], constraints: [] },
    };
    const revolve: RevolveFeature = { id: 'r', type: 'revolve', operation: 'add', sketch: 's', axis: 'axis', angle: 360, direction: 'normal', thin: 'one', thickness: 2 };
    const volume = volumeOf([profile, revolve]);
    // One side of the line walked upwards is to its right, away from the axis.
    expect(volume).toBeCloseTo(Math.PI * (144 - 100) * 30, 4);
    expect(volumeOf([profile, { ...revolve, thin: 'other' }])).toBeCloseTo(Math.PI * (100 - 64) * 30, 4);
  });
});
