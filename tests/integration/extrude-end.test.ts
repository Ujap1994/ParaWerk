/** Extrusions up to a surface (also at an angle, with an offset) or up to a vertex. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, ExtrudeFeature, Feature, PlaneFeature, PointFeature, SketchFeature } from '../../src/shared/model/feature.ts';
import type { GeometryRef } from '../../src/shared/model/reference.ts';
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
/** A 10 × 10 square on the top plane (z = 0). */
const square: SketchFeature = {
  id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' },
  sketch: { entities: [P('a', 0, 0), P('b', 10, 0), P('c', 10, 10), P('d', 0, 10), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a')], constraints: [] },
};
const top: GeometryRef = { kind: 'standard-plane', plane: 'top' };
const offsetPlane = (distance: number, flip = false): PlaneFeature => ({ id: 'p', type: 'plane', method: 'offset', references: [top], distance, angle: 45, flip });
const point = (id: string, x: number, y: number, z: number): PointFeature => ({ id, type: 'point', method: 'coordinates', references: [], x, y, z });
const extrude = (overrides: Partial<ExtrudeFeature>): ExtrudeFeature => ({ id: 'e', type: 'extrude', operation: 'add', sketch: 's', depth: 5, direction: 'normal', end: 'upToSurface', ...overrides });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;

describe('extrude up to a surface', () => {
  it('stops at a parallel plane, before it or past it by an offset', () => {
    const plane: GeometryRef = { kind: 'feature', feature: 'p' };
    expect(volumeOf([offsetPlane(25), square, extrude({ endRef: plane })])).toBeCloseTo(2500, 6);
    expect(volumeOf([offsetPlane(25), square, extrude({ endRef: plane, endOffset: 5 })])).toBeCloseTo(2000, 6);
    expect(volumeOf([offsetPlane(25), square, extrude({ endRef: plane, endOffset: 5, endBeyond: true })])).toBeCloseTo(3000, 6);
    // Reversed, down to a plane below.
    expect(volumeOf([offsetPlane(15, true), square, extrude({ endRef: plane, direction: 'reverse' })])).toBeCloseTo(1500, 6);
  });

  it('is cut off along a plane at an angle', () => {
    // The plane z = 20 + x through three points.
    const points = [point('q1', 0, 0, 20), point('q2', 0, 10, 20), point('q3', 10, 0, 30)];
    const slanted: PlaneFeature = { id: 'p', type: 'plane', method: 'threePoints', references: points.map((q) => ({ kind: 'feature', feature: q.id })), distance: 0, angle: 0, flip: false };
    const result = build([...points, slanted, square, extrude({ endRef: { kind: 'feature', feature: 'p' } })]);
    expect(result.features.at(-1)?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(10 * (200 + 50), 4);
    expect(result.captures[0]?.mesh?.naming.faces).toContain('e:end');
  });

  it('follows the face it goes up to', () => {
    const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 100] };
    const face: GeometryRef = { kind: 'face', name: 'box:bottom', at: [0, 0, 100] };
    expect(volumeOf([box, square, extrude({ endRef: face })])).toBeCloseTo(240_000 + 100 * 100, 4);
    expect(volumeOf([{ ...box, position: [0, 0, 80] }, square, extrude({ endRef: face })])).toBeCloseTo(240_000 + 100 * 80, 4);
  });

  it('reports a plane behind the sketch, one along the extrusion and a missing one', () => {
    const plane: GeometryRef = { kind: 'feature', feature: 'p' };
    expect(build([offsetPlane(25, true), square, extrude({ endRef: plane })]).features[2]?.error?.code).toBe('end-behind');
    expect(build([square, extrude({ endRef: { kind: 'standard-plane', plane: 'front' } })]).features[1]?.error?.code).toBe('end-parallel');
    expect(build([square, extrude({})]).features[1]?.error?.code).toBe('reference-missing');
  });
});

describe('extrude up to a vertex', () => {
  it('goes as far as the vertex lies along the normal', () => {
    expect(volumeOf([point('v', 50, 50, 33), square, extrude({ end: 'upToVertex', endRef: { kind: 'feature', feature: 'v' } })])).toBeCloseTo(3300, 6);
    expect(build([point('v', 0, 0, -5), square, extrude({ end: 'upToVertex', endRef: { kind: 'feature', feature: 'v' } })]).features[2]?.error?.code).toBe('end-behind');
  });
});

describe('cuts that remove nothing', () => {
  it('warns about a cut along the outward normal of a face, but not about one into the part', () => {
    const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
    const onTop: SketchFeature = { ...square, plane: { kind: 'face', face: 5, name: 'box:top', frame: { origin: [0, 0, 40], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } } };
    const cut = (direction: ExtrudeFeature['direction']) => extrude({ operation: 'cut', end: 'blind', depth: 5, direction });
    const outward = build([box, onTop, cut('normal')]);
    expect(outward.features[2]).toMatchObject({ status: 'ok', warning: { code: 'cut-nothing' } });
    expect(outward.captures[0]?.properties?.volume).toBeCloseTo(240_000, 4);
    const inward = build([box, onTop, cut('reverse')]);
    expect(inward.features[2]?.warning).toBeUndefined();
    expect(inward.captures[0]?.properties?.volume).toBeCloseTo(240_000 - 500, 4);
  });
});
