/**
 * Regression suite for persistent naming (docs/adr/0002-persistent-naming.md): edits of earlier
 * features change the topology, and the fillets and chamfers after them must keep their edges.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, ChamferFeature, CylinderFeature, EdgeNameRef, ExtrudeFeature, Feature, FilletFeature, RevolveFeature, SketchFeature } from '../../src/shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf, resolveEdgeRefs, type BodyNaming } from '../../src/shared/model/naming.ts';
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
/** Rectangle with lines ra (bottom), rb (right), rc (top), rd (left). */
const rectangle = (x0: number, y0: number, x1: number, y1: number): SketchEntity[] => [
  P('r1', x0, y0), P('r2', x1, y0), P('r3', x1, y1), P('r4', x0, y1),
  L('ra', 'r1', 'r2'), L('rb', 'r2', 'r3'), L('rc', 'r3', 'r4'), L('rd', 'r4', 'r1'),
];
const sketch = (entities: SketchEntity[]): SketchFeature => ({ id: 'sketch', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities, constraints: [] } });
const extrude: ExtrudeFeature = { id: 'extrude', type: 'extrude', operation: 'add', sketch: 'sketch', depth: 10, direction: 'normal', end: 'blind' };
const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const hole: CylinderFeature = { id: 'hole', type: 'cylinder', operation: 'cut', radius: 8, height: 60, axis: 'z', position: [0, 0, -10] };

function build(features: Feature[], captures = [features.length - 1]) {
  const { result } = kernel.rebuild({ features, captures, knownMeshKeys: [], withProperties: true });
  return result;
}

/** The naming of the body after feature `index`. */
function namingAfter(features: Feature[], index: number): BodyNaming {
  const naming = build(features, [index]).captures[0]?.mesh?.naming;
  if (!naming) throw new Error('no body');
  return naming;
}

/** The edge between the two named faces, as a reference picked in the body after feature `index`. */
function pick(features: Feature[], index: number, a: string, b: string): EdgeNameRef {
  const naming = namingAfter(features, index);
  const faces = [a, b].sort().join('|');
  const edge = Array.from({ length: naming.edgeFaces.length / 2 }, (_, i) => i).find((i) => edgeFaceNames(naming, i).join('|') === faces);
  const ref = edge === undefined ? null : edgeRefOf(naming, edge);
  if (!ref) throw new Error(`no edge between ${a} and ${b}`);
  return ref;
}

/** Volume a fillet of radius r removes along a straight edge of length l between perpendicular faces. */
const filletLoss = (r: number, l: number) => (1 - Math.PI / 4) * r * r * l;

describe('face names', () => {
  it('names faces after the feature and the role that made them', () => {
    const naming = namingAfter([box, hole], 1);
    expect(new Set(naming.faces)).toEqual(new Set(['box:left', 'box:right', 'box:front', 'box:back', 'box:bottom', 'box:top', 'hole:side']));
  });

  it('names the sides of extrusions and revolutions after their sketch curves', () => {
    const extruded = namingAfter([sketch(rectangle(0, 0, 20, 10)), extrude], 1);
    expect(new Set(extruded.faces)).toEqual(new Set(['extrude:side:ra', 'extrude:side:rb', 'extrude:side:rc', 'extrude:side:rd', 'extrude:start', 'extrude:end']));
    const revolve: RevolveFeature = { id: 'revolve', type: 'revolve', operation: 'add', sketch: 'sketch', axis: 'rd', angle: 90, direction: 'normal' };
    const revolved = namingAfter([sketch(rectangle(0, 0, 20, 10)), revolve], 1);
    // The axis line rd sweeps no face.
    expect(new Set(revolved.faces)).toEqual(new Set(['revolve:side:ra', 'revolve:side:rb', 'revolve:side:rc', 'revolve:start', 'revolve:end']));
  });

  it('keeps the names of modified faces through booleans and fillets', () => {
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 3, edges: [pick([box, hole], 1, 'box:top', 'box:front')] };
    const naming = namingAfter([box, hole, fillet], 2);
    const filletFaces = naming.faces.filter((name) => name.startsWith('fillet:'));
    expect(filletFaces).toHaveLength(1);
    expect(naming.faces.filter((name) => !name.startsWith('fillet:')).sort()).toEqual(['box:back', 'box:bottom', 'box:front', 'box:left', 'box:right', 'box:top', 'hole:side']);
  });
});

describe('edits of earlier features', () => {
  it('keeps the fillet on its edge when the sketch changes and gets a hole', () => {
    const before = [sketch(rectangle(0, 0, 20, 10)), extrude];
    const corner = pick(before, 1, 'extrude:side:rb', 'extrude:side:rc');
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 2, edges: [corner] };

    // Wider, the bottom line split in two and a hole: more faces and edges, so the edge indices change.
    const split = rectangle(0, 0, 30, 10).map((e) => (e.id === 'ra' ? L('ra', 'r1', 'm') : e));
    const edited = [sketch([...split, P('m', 10, 0), L('rx', 'm', 'r2'), P('c', 8, 5), { id: 'h', type: 'circle', center: 'c', radius: 2 }]), extrude];
    const oldIndex = resolveEdgeRefs([corner], namingAfter(before, 1))[0]?.index;
    const newIndex = resolveEdgeRefs([corner], namingAfter(edited, 1))[0]?.index;
    expect(newIndex).toBeDefined();
    expect(newIndex).not.toBe(oldIndex);

    const result = build([...edited, fillet]);
    expect(result.features[2]?.status).toBe('ok');
    // The rounded corner is the one at (30, 10): the fillet runs along the 10 mm high vertical edge.
    expect(result.captures[0]?.properties?.volume).toBeCloseTo((300 - 4 * Math.PI) * 10 - filletLoss(2, 10), 3);
    expect(result.captures[0]?.properties?.bboxMax[0]).toBeCloseTo(30, 6);
  });

  it('keeps the fillet on its edge when a cut is inserted before it', () => {
    const edge = pick([box], 0, 'box:top', 'box:front');
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 3, edges: [edge] };
    const side: CylinderFeature = { ...hole, id: 'side', radius: 5, height: 120, axis: 'x', position: [-60, 0, 20] };
    const result = build([box, side, fillet]);
    expect(result.features[2]?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(240_000 - 25 * Math.PI * 100 - filletLoss(3, 100), 2);
  });

  it('keeps a fillet on a fillet face when the first fillet changes', () => {
    const first: FilletFeature = { id: 'first', type: 'fillet', radius: 3, edges: [pick([box], 0, 'box:top', 'box:front')] };
    const round = namingAfter([box, first], 1).faces.find((name) => name.startsWith('first:'));
    if (!round) throw new Error('no fillet face');
    const chamfer: ChamferFeature = { id: 'chamfer', type: 'chamfer', distance: 1, edges: [pick([box, first], 1, round, 'box:left')] };
    for (const radius of [3, 5, 8]) {
      const result = build([box, { ...first, radius }, chamfer]);
      expect(result.features.map((feature) => feature.status)).toEqual(['ok', 'ok', 'ok']);
    }
  });

  it('reports an edge that an earlier change removed', () => {
    const before = [sketch(rectangle(0, 0, 20, 10)), extrude];
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 1, edges: [pick(before, 1, 'extrude:side:rb', 'extrude:side:rc')] };
    // A rounded corner in the sketch: lines rb and rc no longer meet.
    const rounded = sketch([
      P('r1', 0, 0), P('r2', 20, 0), P('t1', 20, 7), P('t2', 17, 10), P('m', 17, 7), P('r4', 0, 10),
      L('ra', 'r1', 'r2'), L('rb', 'r2', 't1'), { id: 'arc', type: 'arc', center: 'm', start: 't1', end: 't2' }, L('rc', 't2', 'r4'), L('rd', 'r4', 'r1'),
    ]);
    const result = build([rounded, extrude, fillet]);
    expect(result.features[2]?.status).toBe('error');
    expect(result.features[2]?.error?.code).toBe('edge-missing');
  });

  it('finds an edge again by position when its face was renamed, and heals the reference', () => {
    const before = [sketch(rectangle(0, 0, 20, 10)), extrude];
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 1, edges: [pick(before, 1, 'extrude:side:rc', 'extrude:end')] };
    // Line rc deleted and drawn again: same place, new id.
    const redrawn = sketch(rectangle(0, 0, 20, 10).map((e) => (e.id === 'rc' ? { ...e, id: 'rx' } : e)));
    const result = build([redrawn, extrude, fillet]);
    expect(result.features[2]?.status).toBe('ok');
    const healed = result.features[2]?.healedEdges;
    expect(healed).toEqual([{ kind: 'edge', faces: ['extrude:end', 'extrude:side:rx'], at: [10, 10, 10].map((v) => expect.closeTo(v, 6)) }]);
    // Taking the healed reference over makes it exact again.
    const again = build([redrawn, extrude, { ...fillet, edges: healed ?? [] }]);
    expect(again.features[2]?.healedEdges).toBeUndefined();
  });

  it('converts edge indices of older files into names', () => {
    const naming = namingAfter([box], 0);
    const index = Array.from({ length: 12 }, (_, i) => i).find((i) => edgeFaceNames(naming, i).join('|') === 'box:front|box:top');
    if (index === undefined) throw new Error('edge not found');
    const result = build([box, { id: 'fillet', type: 'fillet', radius: 2, edges: [{ kind: 'edge-index', index }] }]);
    expect(result.features[1]?.status).toBe('ok');
    expect(result.features[1]?.healedEdges).toEqual([{ kind: 'edge', faces: ['box:front', 'box:top'], at: [0, -30, 40].map((v) => expect.closeTo(v, 6)) }]);
  });

  it('picks the nearer of two edges between the same faces', () => {
    // A cross hole through a tube meets its outer face on both sides (the seam of the hole splits one side in two edges).
    const tube: CylinderFeature = { id: 'tube', type: 'cylinder', operation: 'add', radius: 20, height: 60, axis: 'z', position: [0, 0, 0] };
    const bore: CylinderFeature = { id: 'bore', type: 'cylinder', operation: 'cut', radius: 15, height: 80, axis: 'z', position: [0, 0, -10] };
    const cross: CylinderFeature = { id: 'cross', type: 'cylinder', operation: 'cut', radius: 5, height: 60, axis: 'x', position: [-30, 0, 30] };
    const naming = namingAfter([tube, bore, cross], 2);
    const entries = Array.from({ length: naming.edgeFaces.length / 2 }, (_, i) => i).filter((i) => edgeFaceNames(naming, i).join('|') === 'cross:side|tube:side');
    const refs = entries.map((i) => edgeRefOf(naming, i)).filter((ref) => ref !== null);
    expect(new Set(refs.map((ref) => Math.sign(ref.at[0])))).toEqual(new Set([1, -1]));
    expect(resolveEdgeRefs(refs, naming).map((match) => match?.index)).toEqual(entries);
    // With a larger tube the edges move outwards; each reference still finds an edge on its own side.
    const larger = namingAfter([{ ...tube, radius: 25 }, bore, cross], 2);
    const moved = resolveEdgeRefs(refs, larger).map((match) => (match ? (larger.edgeMidpoints[3 * match.index] ?? 0) : 0));
    expect(moved.map(Math.sign)).toEqual(refs.map((ref) => Math.sign(ref.at[0])));
  });
});
