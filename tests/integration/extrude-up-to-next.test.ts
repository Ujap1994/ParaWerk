/** Extrusions up to the next face of the body and up to curved faces. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CylinderFeature, ExtrudeFeature, Feature, PlaneFeature, ShellFeature, SketchFeature } from '../../src/shared/model/feature.ts';
import type { GeometryRef } from '../../src/shared/model/reference.ts';
import { frameOnPlane, type SketchEntity } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

/** The four points and lines of a rectangle from (x0, y0) to (x1, y1), ids prefixed with `p`. */
function rect(p: string, x0: number, y0: number, x1: number, y1: number): SketchEntity[] {
  const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return [
    ...corners.map(([x, y], i): SketchEntity => ({ id: `${p}${i}`, type: 'point', x, y })),
    ...corners.map((_, i): SketchEntity => ({ id: `${p}l${i}`, type: 'line', p1: `${p}${i}`, p2: `${p}${(i + 1) % 4}` })),
  ];
}

const sketchOn = (plane: SketchFeature['plane'], ...entities: SketchEntity[][]): SketchFeature => ({ id: 's', type: 'sketch', plane, sketch: { entities: entities.flat(), constraints: [] } });
const onTop = (...entities: SketchEntity[][]) => sketchOn({ kind: 'standard', plane: 'top' }, ...entities);
/** A sketch on a reference plane `height` above the top plane. */
const above = (height: number, ...entities: SketchEntity[][]): [PlaneFeature, SketchFeature] => [
  { id: 'p', type: 'plane', method: 'offset', references: [{ kind: 'standard-plane', plane: 'top' }], distance: height, angle: 45, flip: false },
  sketchOn({ kind: 'feature', feature: 'p', frame: frameOnPlane([0, 0, height], [0, 0, 1]) }, ...entities),
];
const box = (id: string, width: number, depth: number, height: number, position: [number, number, number]): BoxFeature => ({ id, type: 'box', operation: 'add', width, depth, height, position });
const extrude = (overrides: Partial<ExtrudeFeature>): ExtrudeFeature => ({ id: 'e', type: 'extrude', operation: 'add', sketch: 's', depth: 5, direction: 'normal', end: 'upToNext', ...overrides });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;
const last = (features: Feature[]) => build(features).features.at(-1);

describe('extrude up to next', () => {
  // 100 × 60 × 40, 20 above the top plane.
  const roof = box('roof', 100, 60, 40, [0, 0, 20]);

  it('adds material until it meets the body', () => {
    expect(volumeOf([roof, onTop(rect('a', 0, 0, 10, 10)), extrude({})])).toBeCloseTo(240_000 + 100 * 20, 4);
    // Reversed, up to a floor below.
    expect(volumeOf([box('floor', 100, 60, 10, [0, 0, -30]), onTop(rect('a', 0, 0, 10, 10)), extrude({ direction: 'reverse' })])).toBeCloseTo(60_000 + 100 * 20, 4);
    const result = build([roof, onTop(rect('a', 0, 0, 10, 10)), extrude({})]);
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['e:start', 'e:side:al0']));
  });

  it('follows a body that is not flat where it is met', () => {
    // A rib hanging 10 below the roof over half of the outline.
    const rib = box('rib', 5, 60, 10, [2.5, 0, 10]);
    expect(volumeOf([roof, rib, onTop(rect('a', 0, 0, 10, 10)), extrude({})])).toBeCloseTo(240_000 + 3000 + 5 * 10 * 10 + 5 * 10 * 20, 4);
  });

  it('reports an outline the body does not stop and a body behind the sketch', () => {
    // Half of the outline passes the roof.
    expect(last([box('roof', 100, 60, 40, [-45, 0, 20]), onTop(rect('a', 0, 0, 10, 10)), extrude({})])?.error?.code).toBe('end-missed');
    expect(last([box('floor', 100, 60, 40, [0, 0, -60]), onTop(rect('a', 0, 0, 10, 10)), extrude({})])?.error?.code).toBe('end-behind');
    expect(last([onTop(rect('a', 0, 0, 10, 10)), extrude({})])?.error?.code).toBe('no-body');
  });

  it('cuts through the first wall only', () => {
    // A closed box with walls of 5: the cut from the top face goes through the top wall, not the floor.
    const hollow: Feature[] = [box('box', 100, 60, 40, [0, 0, 0]), { id: 'shell', type: 'shell', thickness: 5, faces: [], outward: false } satisfies ShellFeature];
    const shelled = 240_000 - 90 * 50 * 30;
    const onFace = sketchOn({ kind: 'face', face: 0, name: 'box:top', frame: { origin: [0, 0, 40], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } }, rect('a', 0, 0, 10, 10));
    const lid = build([...hollow, onFace, extrude({ operation: 'cut', direction: 'reverse' })]).captures[0]?.properties;
    expect(lid?.volume).toBeCloseTo(shelled - 500, 3);
    // The hole is in the lid: the center of mass moves down.
    expect(lid?.center[2]).toBeCloseTo((shelled * 20 - 500 * 37.5) / (shelled - 500), 6);
    expect(volumeOf([...hollow, onFace, extrude({ operation: 'cut', direction: 'reverse', end: 'throughAll' })])).toBeCloseTo(shelled - 1000, 3);
    // From a plane above the box, across the gap; from below, through the floor.
    const fromAbove = build([...hollow, ...above(50, rect('a', 0, 0, 10, 10)), extrude({ operation: 'cut', direction: 'reverse' })]).captures[0]?.properties;
    expect(fromAbove?.center[2]).toBeCloseTo((shelled * 20 - 500 * 37.5) / (shelled - 500), 6);
    const fromBelow = build([...hollow, ...above(-10, rect('a', 0, 0, 10, 10)), extrude({ operation: 'cut' })]).captures[0]?.properties;
    expect(fromBelow?.center[2]).toBeCloseTo((shelled * 20 - 500 * 2.5) / (shelled - 500), 6);
  });

  it('cuts each outline through the first material it meets', () => {
    // A plate (z 0 to 10) with a boss (z 10 to 30); one outline over the boss, one over the plate.
    const plate = box('plate', 100, 60, 10, [0, 0, 0]);
    const boss = box('boss', 20, 20, 20, [30, 0, 10]);
    const sketch = above(50, rect('a', 25, -5, 35, 5), rect('b', -35, -5, -25, 5));
    const volume = 60_000 + 8000;
    expect(volumeOf([plate, boss, ...sketch, extrude({ operation: 'cut', direction: 'reverse' })])).toBeCloseTo(volume - 100 * 30 - 100 * 10, 3);
    expect(last([plate, boss, ...above(50, rect('a', 200, 0, 210, 10)), extrude({ operation: 'cut', direction: 'reverse' })])?.error?.code).toBe('end-missed');
  });
});

describe('extrude up to a curved face', () => {
  // Radius 20 along y, its axis 60 above the top plane.
  const shaft: CylinderFeature = { id: 'cyl', type: 'cylinder', operation: 'add', radius: 20, height: 60, axis: 'y', position: [0, -30, 60] };
  const side: GeometryRef = { kind: 'face', name: 'cyl:side', at: [0, 0, 40] };
  const cylinder = Math.PI * 400 * 60;
  /** The volume under a circle of radius r around z = 60 over the 10 × 10 square at x 0 to 10. */
  const column = (r: number) => 10 * (600 - (5 * Math.sqrt(r * r - 100) + ((r * r) / 2) * Math.asin(10 / r)));
  const upTo = (overrides: Partial<ExtrudeFeature>) => extrude({ end: 'upToSurface', endRef: side, ...overrides });

  it('ends on the surface, before it or past it by an offset', () => {
    const result = build([shaft, onTop(rect('a', 0, 0, 10, 10)), upTo({})]);
    expect(result.features.at(-1)?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(cylinder + column(20), 2);
    expect(volumeOf([shaft, onTop(rect('a', 0, 0, 10, 10)), upTo({ endOffset: 5 })])).toBeCloseTo(cylinder + column(25), 2);
    // Past the surface, a cut takes away what lies between the surface and the offset.
    expect(volumeOf([shaft, onTop(rect('a', 0, 0, 10, 10)), upTo({ operation: 'cut', endOffset: 5, endBeyond: true })])).toBeCloseTo(cylinder - (column(15) - column(20)), 2);
    // Reversed, down to a shaft below.
    const below: CylinderFeature = { ...shaft, position: [0, -30, -60] };
    expect(volumeOf([below, onTop(rect('a', 0, 0, 10, 10)), upTo({ direction: 'reverse', endRef: { kind: 'face', name: 'cyl:side', at: [0, 0, -40] } })])).toBeCloseTo(cylinder + column(20), 2);
  });

  it('names the end face after the extrusion', () => {
    // Stopped 5 before the shaft, the end face is the extrusion's own.
    const result = build([shaft, onTop(rect('a', 0, 0, 10, 10)), upTo({ endOffset: 5 })]);
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['e:end', 'e:start', 'cyl:side']));
  });

  it('reports an outline the surface does not stop', () => {
    expect(last([shaft, onTop(rect('a', 30, 0, 40, 10)), upTo({})])?.error?.code).toBe('end-missed');
  });
});
