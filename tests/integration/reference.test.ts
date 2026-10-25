/** Reference planes, axes and points built on standard planes, faces, edges, vertices and each other. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { AxisFeature, BoxFeature, CylinderFeature, ExtrudeFeature, Feature, PlaneFeature, PointFeature, SketchFeature, Vec3 } from '../../src/shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf, vertexCount, vertexPosition, vertexRefOf, type BodyNaming } from '../../src/shared/model/naming.ts';
import type { GeometryRef, ReferenceGeometry } from '../../src/shared/model/reference.ts';
import { frameOnPlane, type SketchEntity } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const hole: CylinderFeature = { id: 'hole', type: 'cylinder', operation: 'cut', radius: 8, height: 60, axis: 'z', position: [20, 0, -10] };
const top: GeometryRef = { kind: 'standard-plane', plane: 'top' };
const front: GeometryRef = { kind: 'standard-plane', plane: 'front' };
const right: GeometryRef = { kind: 'standard-plane', plane: 'right' };

const plane = (id: string, method: PlaneFeature['method'], references: GeometryRef[], extra: Partial<PlaneFeature> = {}): PlaneFeature => ({
  id, type: 'plane', method, references, distance: 10, angle: 45, flip: false, ...extra,
});
const axis = (id: string, method: AxisFeature['method'], references: GeometryRef[]): AxisFeature => ({ id, type: 'axis', method, references });
const point = (id: string, method: PointFeature['method'], references: GeometryRef[], at: Vec3 = [0, 0, 0]): PointFeature => ({
  id, type: 'point', method, references, x: at[0], y: at[1], z: at[2],
});

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

function namingOf(features: Feature[]): BodyNaming {
  const naming = build(features).captures[0]?.mesh?.naming;
  if (!naming) throw new Error('no body');
  return naming;
}

/** The computed geometry of feature `id`. */
function geometry(features: Feature[], id: string): ReferenceGeometry | undefined {
  return build(features).features.find((result) => result.id === id)?.reference;
}

const close = (values: readonly number[]) => values.map((value) => expect.closeTo(value, 9));
/** Bounding boxes are enlarged by OCCT's tolerance (1e-7). */
const near = (values: readonly number[]) => values.map((value) => expect.closeTo(value, 6));

describe('reference planes', () => {
  it('offsets a standard plane, also to the other side', () => {
    expect(geometry([plane('p', 'offset', [top], { distance: 25 })], 'p')).toEqual({
      kind: 'plane',
      frame: { origin: close([0, 0, 25]), xDir: close([1, 0, 0]), yDir: close([0, 1, 0]), normal: close([0, 0, 1]) },
    });
    expect(geometry([plane('p', 'offset', [top], { distance: 25, flip: true })], 'p')).toMatchObject({ frame: { origin: close([0, 0, -25]), normal: close([0, 0, 1]) } });
  });

  it('follows the face it is offset from when the body changes', () => {
    const offset = plane('p', 'offset', [{ kind: 'face', name: 'box:top', at: [10, 10, 40] }], { distance: 10 });
    expect(geometry([box, offset], 'p')).toMatchObject({ frame: { origin: close([0, 0, 50]) } });
    expect(geometry([{ ...box, height: 60 }, offset], 'p')).toMatchObject({ frame: { origin: close([0, 0, 70]) } });
  });

  it('turns a plane around an axis by an angle', () => {
    const zAxis = axis('z', 'twoPlanes', [front, right]);
    const turned = plane('p', 'angle', [front, { kind: 'feature', feature: 'z' }], { angle: 30 });
    expect(geometry([zAxis], 'z')).toEqual({ kind: 'axis', point: close([0, 0, 0]), direction: close([0, 0, 1]) });
    expect(geometry([zAxis, turned], 'p')).toMatchObject({ frame: { normal: close([0.5, -Math.sqrt(3) / 2, 0]) } });
    // The axis has to lie parallel to the plane.
    const tilted = build([zAxis, plane('p', 'angle', [top, { kind: 'feature', feature: 'z' }])]);
    expect(tilted.features[1]?.error?.code).toBe('reference-not-parallel');
  });

  it('goes through three vertices, and reports points on one line', () => {
    const naming = namingOf([box]);
    const corner = (at: Vec3) => {
      const index = Array.from({ length: vertexCount(naming) }, (_, v) => v).find((v) => vertexPosition(naming, v).every((value, k) => Math.abs(value - (at[k] ?? 0)) < 1e-9));
      const ref = index === undefined ? null : vertexRefOf(naming, index);
      if (!ref) throw new Error(`no vertex at ${at.join(', ')}`);
      return ref;
    };
    const slanted = plane('p', 'threePoints', [corner([-50, -30, 0]), corner([50, -30, 0]), corner([50, 30, 40])]);
    const result = geometry([box, slanted], 'p');
    const n = [0, -40, 60].map((value) => value / Math.hypot(40, 60));
    expect(result).toMatchObject({ frame: { normal: close(n) } });
    const line = build([box, plane('p', 'threePoints', [corner([-50, -30, 0]), corner([50, -30, 0]), { kind: 'origin' }])]);
    expect(line.features[1]?.status).toBe('ok');
    const same = build([box, plane('p', 'threePoints', [corner([-50, -30, 0]), corner([50, -30, 0]), corner([50, -30, 0])])]);
    expect(same.features[1]?.error?.code).toBe('reference-collinear');
  });

  it('lies midway between two parallel faces, and halves the angle between two others', () => {
    const left: GeometryRef = { kind: 'face', name: 'box:left', at: [-50, 0, 20] };
    const rightFace: GeometryRef = { kind: 'face', name: 'box:right', at: [50, 0, 20] };
    expect(geometry([{ ...box, position: [10, 0, 0] }, plane('p', 'midPlane', [left, rightFace])], 'p')).toMatchObject({ frame: { origin: close([10, 0, 0]), normal: close([-1, 0, 0]) } });
    expect(geometry([plane('p', 'midPlane', [front, right])], 'p')).toMatchObject({ frame: { normal: close([-Math.SQRT1_2, -Math.SQRT1_2, 0]) } });
  });

  it('goes through a point parallel to a plane', () => {
    expect(geometry([point('q', 'coordinates', [], [3, 4, 5]), plane('p', 'throughPoint', [top, { kind: 'feature', feature: 'q' }])], 'p')).toMatchObject({
      frame: { origin: close([0, 0, 5]), normal: close([0, 0, 1]) },
    });
  });

  it('reports a reference that is missing or of the wrong kind', () => {
    expect(build([plane('p', 'offset', [])]).features[0]?.error).toEqual({ code: 'reference-missing', detail: '1' });
    expect(build([box, plane('p', 'offset', [{ kind: 'face', name: 'nothing:here', at: [0, 0, 99] }])]).features[1]?.error?.code).toBe('reference-missing');
    expect(build([point('q', 'coordinates', []), plane('p', 'offset', [{ kind: 'feature', feature: 'q' }])]).features[1]?.error).toEqual({ code: 'reference-kind', detail: '1' });
  });
});

describe('reference axes and points', () => {
  it('takes the axis of a cylindrical face and of a circular edge', () => {
    const features = [box, hole];
    const naming = namingOf(features);
    expect(geometry([...features, axis('a', 'reference', [{ kind: 'face', name: 'hole:side', at: [28, 0, 20] }])], 'a')).toMatchObject({
      point: [expect.closeTo(20, 9), expect.closeTo(0, 9), expect.anything()],
      direction: close([0, 0, 1]),
    });
    const rim = Array.from({ length: naming.edgeFaces.length / 2 }, (_, e) => e).find((e) => edgeFaceNames(naming, e).join('|') === 'box:top|hole:side');
    const ref = rim === undefined ? null : edgeRefOf(naming, rim);
    if (!ref) throw new Error('no rim edge');
    expect(geometry([...features, point('c', 'center', [ref])], 'c')).toEqual({ kind: 'point', point: close([20, 0, 40]) });
  });

  it('goes through two points, and along the normal of a plane through a point', () => {
    const features: Feature[] = [point('a', 'coordinates', [], [1, 2, 3]), point('b', 'coordinates', [], [1, 2, 13])];
    expect(geometry([...features, axis('x', 'twoPoints', [{ kind: 'feature', feature: 'a' }, { kind: 'feature', feature: 'b' }])], 'x')).toEqual({
      kind: 'axis', point: close([1, 2, 3]), direction: close([0, 0, 1]),
    });
    expect(geometry([...features, axis('x', 'normal', [front, { kind: 'feature', feature: 'a' }])], 'x')).toEqual({ kind: 'axis', point: close([1, 2, 3]), direction: close([0, -1, 0]) });
  });

  it('meets an axis with a plane, and reports parallel ones', () => {
    const zAxis = axis('z', 'twoPlanes', [front, right]);
    const features: Feature[] = [zAxis, plane('p', 'offset', [top], { distance: 25 }), point('q', 'intersection', [{ kind: 'feature', feature: 'z' }, { kind: 'feature', feature: 'p' }])];
    expect(geometry(features, 'q')).toEqual({ kind: 'point', point: close([0, 0, 25]) });
    expect(build([zAxis, point('q', 'intersection', [{ kind: 'feature', feature: 'z' }, front])]).features[1]?.error?.code).toBe('reference-parallel');
    expect(build([axis('x', 'twoPlanes', [top, { kind: 'standard-plane', plane: 'top' }])]).features[0]?.error?.code).toBe('reference-parallel');
  });
});

describe('sketches on reference planes', () => {
  const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
  const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
  const square: SketchEntity[] = [P('a', 0, 0), P('b', 10, 0), P('c', 10, 10), P('d', 0, 10), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a')];
  const sketchOn = (frame = frameOnPlane([0, 0, 25], [0, 0, 1])): SketchFeature => ({ id: 's', type: 'sketch', plane: { kind: 'feature', feature: 'p', frame }, sketch: { entities: square, constraints: [] } });
  const extrude: ExtrudeFeature = { id: 'e', type: 'extrude', operation: 'add', sketch: 's', depth: 5, direction: 'normal', end: 'blind' };

  it('extrudes from the plane and follows it when the plane moves', () => {
    const at25 = build([plane('p', 'offset', [top], { distance: 25 }), sketchOn(), extrude]);
    expect(at25.captures[0]?.properties).toMatchObject({ volume: expect.closeTo(500, 6), bboxMin: near([0, 0, 25]), bboxMax: near([10, 10, 30]) });
    expect(at25.features[1]?.healedPlane).toBeUndefined();

    const at40 = build([plane('p', 'offset', [top], { distance: 40 }), sketchOn(), extrude]);
    expect(at40.captures[0]?.properties).toMatchObject({ bboxMin: near([0, 0, 40]) });
    expect(at40.features[1]?.healedPlane).toMatchObject({ kind: 'feature', feature: 'p', frame: { origin: close([0, 0, 40]) } });
  });

  it('keeps the sketch where it was when its plane is gone', () => {
    const result = build([{ ...plane('p', 'offset', [top]), suppressed: true }, sketchOn(), extrude]);
    expect(result.features[1]?.error?.code).toBe('plane-missing');
    expect(result.features[2]?.status).toBe('ok');
    expect(result.captures[0]?.properties).toMatchObject({ bboxMin: near([0, 0, 25]) });
  });
});

describe('references found again by position', () => {
  it('heals a face reference whose face was renamed', () => {
    // The top face of another box in the same place.
    const offset = plane('p', 'offset', [{ kind: 'face', name: 'old:top', at: [10, 10, 40] }], { distance: 5 });
    const result = build([box, offset]);
    expect(result.features[1]?.status).toBe('ok');
    expect(result.features[1]?.healedReferences).toEqual([{ kind: 'face', name: 'box:top', at: [10, 10, 40] }]);
  });
});
