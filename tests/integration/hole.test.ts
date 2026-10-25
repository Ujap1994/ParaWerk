/** Holes for metric screws, cut by the kernel at the free points of a sketch. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import { defaultFeature, type BoxFeature, type Feature, type FilletFeature, type HoleFeature, type SketchFeature } from '../../src/shared/model/feature.ts';
import { DRILL_POINT_ANGLE, standardHoleDimensions } from '../../src/shared/model/hole.ts';
import { edgeFaceNames, edgeRefOf } from '../../src/shared/model/naming.ts';
import { frameOnPlane, type SketchEntity, type SketchPlaneRef } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const plate: BoxFeature = { id: 'plate', type: 'box', operation: 'add', width: 100, depth: 60, height: 20, position: [0, 0, 0] };
const PLATE = 100 * 60 * 20;
const onTop: SketchPlaneRef = { kind: 'face', face: 5, frame: frameOnPlane([0, 0, 20], [0, 0, 1]), name: 'plate:top' };
const P = (id: string, x: number, y: number, construction = false): SketchEntity => ({ id, type: 'point', x, y, ...(construction ? { construction } : {}) });

/** Two points for holes on the top face, and a construction line whose end points get no hole. */
const positions = (plane: SketchPlaneRef = onTop): SketchFeature => ({
  id: 'positions',
  type: 'sketch',
  plane,
  sketch: { entities: [P('a', -30, 0), P('b', 30, 0), P('c', 0, -20), P('d', 0, 20), { id: 'l', type: 'line', p1: 'c', p2: 'd', construction: true }, P('e', 10, 10, true)], constraints: [] },
});

function hole(overrides: Partial<HoleFeature> = {}): HoleFeature {
  const base = { ...(defaultFeature('hole', 'hole') as HoleFeature), sketch: 'positions' };
  const kind = overrides.kind ?? base.kind;
  return { ...base, ...standardHoleDimensions(kind, overrides.size ?? base.size, overrides.fit ?? base.fit), ...overrides };
}

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;
const cylinder = (d: number, h: number) => (Math.PI * d * d * h) / 4;
const cone = (d1: number, d2: number, h: number) => (Math.PI * h * (d1 * d1 + d1 * d2 + d2 * d2)) / 12;
const tip = (d: number) => cone(d, 0, d / 2 / Math.tan((DRILL_POINT_ANGLE * Math.PI) / 360));

describe('holes', () => {
  it('drills clearance holes through the plate at the free points of the sketch', () => {
    const result = build([plate, positions(), hole()]);
    expect(result.features[2]?.status).toBe('ok');
    // Two holes: the end points of the construction line and the construction point get none.
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(PLATE - 2 * cylinder(6.6, 20), 4);
    // ISO 273 fine and coarse series.
    expect(volumeOf([plate, positions(), hole({ fit: 'close' })])).toBeCloseTo(PLATE - 2 * cylinder(6.4, 20), 4);
    expect(volumeOf([plate, positions(), hole({ fit: 'loose' })])).toBeCloseTo(PLATE - 2 * cylinder(7, 20), 4);
  });

  it('ends blind holes in a 118° drill point', () => {
    expect(volumeOf([plate, positions(), hole({ end: 'blind', depth: 10 })])).toBeCloseTo(PLATE - 2 * (cylinder(6.6, 10) + tip(6.6)), 4);
  });

  it('cuts counterbores and countersinks', () => {
    // DIN 974-1 for ISO 4762 M6: Ø 11 × 6.4 over a Ø 6.6 hole.
    expect(volumeOf([plate, positions(), hole({ kind: 'counterbore' })])).toBeCloseTo(PLATE - 2 * (cylinder(11, 6.4) + cylinder(6.6, 13.6)), 4);
    // 90° countersink Ø 13.7 over a Ø 6.6 hole.
    const sink = (13.7 - 6.6) / 2;
    expect(volumeOf([plate, positions(), hole({ kind: 'countersink' })])).toBeCloseTo(PLATE - 2 * (cone(13.7, 6.6, sink) + cylinder(6.6, 20 - sink)), 4);
  });

  it('drills the tap drill of a tapped hole as deep as the thread and four turns more', () => {
    const tapped = hole({ kind: 'tapped', end: 'blind' });
    expect(tapped).toMatchObject({ diameter: 5, threadDepth: 12, depth: 16 });
    expect(volumeOf([plate, positions(), tapped])).toBeCloseTo(PLATE - 2 * (cylinder(5, 16) + tip(5)), 4);
  });

  it('drills into the material from a plane beside the part, or the other way', () => {
    // On the top plane (z = 0, normal up) the holes go down, away from the plate: nothing is cut.
    const below = positions({ kind: 'standard', plane: 'top' });
    expect(volumeOf([plate, below, hole()])).toBeCloseTo(PLATE, 4);
    // Holes that miss the part are built, with a warning.
    expect(build([plate, below, hole()]).features[2]).toMatchObject({ status: 'ok', warning: { code: 'cut-nothing' } });
    expect(build([plate, below, hole({ reverse: true })]).features[2]?.warning).toBeUndefined();
    expect(volumeOf([plate, below, hole({ reverse: true })])).toBeCloseTo(PLATE - 2 * cylinder(6.6, 20), 4);
  });

  it('reports a sketch without points for holes and dimensions that do not fit', () => {
    const empty: SketchFeature = { ...positions(), sketch: { entities: [], constraints: [] } };
    expect(build([plate, empty, hole()]).features[2]?.error?.code).toBe('hole-no-points');
    expect(build([plate, positions(), hole({ kind: 'counterbore', counterboreDiameter: 5 })]).features[2]?.error).toEqual({ code: 'hole-invalid', detail: 'counterbore' });
    expect(build([plate, positions(), hole({ kind: 'tapped', end: 'blind', threadDepth: 20 })]).features[2]?.error).toEqual({ code: 'hole-invalid', detail: 'thread' });
    expect(build([positions({ kind: 'standard', plane: 'top' }), hole()]).features[1]?.error?.code).toBe('no-body');
  });

  it('keeps a fillet on the rim of a hole when the hole gets bigger', () => {
    const features = [plate, positions(), hole()];
    const naming = build(features).captures[0]?.mesh?.naming;
    if (!naming) throw new Error('no body');
    const rim = Array.from({ length: naming.edgeFaces.length / 2 }, (_, e) => e).find((e) => edgeFaceNames(naming, e).join('|') === 'hole:0:side:wall|plate:top');
    const ref = rim === undefined ? null : edgeRefOf(naming, rim);
    if (!ref) throw new Error('no rim edge');
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 1, edges: [ref] };
    for (const size of ['M6', 'M8', 'M10']) {
      const result = build([plate, positions(), hole({ size }), fillet]);
      expect(result.features.map((feature) => feature.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
      expect(result.features[3]?.healedEdges).toBeUndefined();
    }
  });
});
