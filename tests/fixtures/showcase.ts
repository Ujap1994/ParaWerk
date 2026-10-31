/**
 * The feature showcase: one large part that uses nearly every feature of ParaWerk, built the way a user
 * would build it – sketches on faces, edges and faces picked in the body, features on features. The
 * integration test builds it, edits it at early features and checks it; scripts/write-showcase.ts saves it
 * as docs/examples/feature-showcase.pwpart to open in ParaWerk.
 *
 * The part: a 160 × 100 × 12 base plate (a corner of it at x −80, y −50) with a drafted, grooved boss and
 * a ring of holes on it, a drafted and shelled housing (a body of its own, joined at the end) with a
 * window and a gusset, a spring, a loft, a threaded pin, a rounded tab, patterns of holes, a swept
 * channel, pockets, columns and surfaces.
 */
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { RebuildResult } from '../../src/kernel/protocol.ts';
import { hashString } from '../../src/shared/hash.ts';
import {
  defaultFeature,
  type AxisFeature,
  type BoxFeature,
  type ChamferFeature,
  type CsysFeature,
  type CylinderFeature,
  type EdgeNameRef,
  type ExtrudeFeature,
  type Feature,
  type FilletFeature,
  type HoleFeature,
  type MirrorFeature,
  type PatternFeature,
  type PlaneFeature,
  type PointFeature,
  type RevolveFeature,
  type SketchFeature,
  type Vec3,
} from '../../src/shared/model/feature.ts';
import type { Configurations } from '../../src/shared/model/configurations.ts';
import { standardHoleDimensions } from '../../src/shared/model/hole.ts';
import { edgeFaceNames, edgeRefOf, faceRefOf, vertexFaceNames, vertexPosition, type BodyNaming } from '../../src/shared/model/naming.ts';
import type { FaceNameRef, GeometryRef } from '../../src/shared/model/reference.ts';
import { frameOnPlane, type SketchEntity, type SketchFrame, type SketchPlaneRef } from '../../src/shared/model/sketch.ts';

// ------------------------------------------------------------------ building blocks

const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const C = (id: string, x: number, y: number, radius: number): SketchEntity[] => [P(`${id}c`, x, y), { id, type: 'circle', center: `${id}c`, radius }];
/** A rectangle drawn round from its first corner: lines <p>a (bottom), <p>b (right), <p>c (top), <p>d (left). */
const rect = (p: string, x0: number, y0: number, x1: number, y1: number): SketchEntity[] => [
  P(`${p}1`, x0, y0), P(`${p}2`, x1, y0), P(`${p}3`, x1, y1), P(`${p}4`, x0, y1),
  L(`${p}a`, `${p}1`, `${p}2`), L(`${p}b`, `${p}2`, `${p}3`), L(`${p}c`, `${p}3`, `${p}4`), L(`${p}d`, `${p}4`, `${p}1`),
];
/** A closed polygon with lines <p>0, <p>1, ... */
const polygon = (p: string, points: [number, number][]): SketchEntity[] => [
  ...points.map(([x, y], i) => P(`${p}p${i}`, x, y)),
  ...points.map((_, i) => L(`${p}${i}`, `${p}p${i}`, `${p}p${(i + 1) % points.length}`)),
];

const TOP: SketchPlaneRef = { kind: 'standard', plane: 'top' };
const FRONT: SketchPlaneRef = { kind: 'standard', plane: 'front' };
const RIGHT_PLANE: GeometryRef = { kind: 'standard-plane', plane: 'right' };
const FRONT_PLANE: GeometryRef = { kind: 'standard-plane', plane: 'front' };
const TOP_PLANE: GeometryRef = { kind: 'standard-plane', plane: 'top' };
const feature = (id: string): GeometryRef => ({ kind: 'feature', feature: id });

const sketch = (id: string, name: string, plane: SketchPlaneRef, entities: SketchEntity[]): SketchFeature => ({ id, name, type: 'sketch', plane, sketch: { entities, constraints: [] } });
const extrude = (id: string, name: string, from: string, depth: number, more: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({ ...(defaultFeature('extrude', id) as ExtrudeFeature), name, sketch: from, depth, ...more });
function hole(id: string, name: string, from: string, more: Partial<HoleFeature> = {}): HoleFeature {
  const base = { ...(defaultFeature('hole', id) as HoleFeature), name, sketch: from };
  const kind = more.kind ?? base.kind;
  return { ...base, ...standardHoleDimensions(kind, more.size ?? base.size, more.fit ?? base.fit), ...more };
}
const pattern = (id: string, name: string, more: Partial<PatternFeature>): PatternFeature => ({ ...(defaultFeature('pattern', id) as PatternFeature), name, ...more });

// ------------------------------------------------------------------ picking, as in the 3D view

export class ShowcaseBuilder {
  readonly features: Feature[] = [];
  private readonly kernel: Kernel;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
  }

  add(...features: Feature[]): this {
    this.features.push(...features);
    return this;
  }

  build(features: Feature[] = this.features): RebuildResult {
    return this.kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
  }

  naming(): BodyNaming {
    const naming = this.build().captures[0]?.mesh?.naming;
    if (!naming) throw new Error('no body');
    return naming;
  }

  /** Every edge between the two named faces of the body so far. */
  edges(...pairs: [string, string][]): EdgeNameRef[] {
    const naming = this.naming();
    return pairs.flatMap(([a, b]) => {
      const key = [a, b].sort().join('|');
      const found = Array.from({ length: naming.edgeFaces.length / 2 }, (_, e) => e).filter((e) => edgeFaceNames(naming, e).join('|') === key);
      if (found.length === 0) throw new Error(`no edge between ${a} and ${b}; faces: ${naming.faces.filter((name) => name.startsWith(a.split(':')[0] ?? a)).join(', ')}`);
      return found.flatMap((e) => edgeRefOf(naming, e) ?? []);
    });
  }

  /** The middle of a named face (its vertices' average), its index and its plane. */
  face(name: string): { index: number; at: Vec3; normal: Vec3; naming: BodyNaming } {
    const naming = this.naming();
    const index = naming.faces.indexOf(name);
    if (index < 0) throw new Error(`no face ${name} in ${naming.faces.join(', ')}`);
    const corners = Array.from({ length: naming.vertexPositions.length / 3 }, (_, v) => v).filter((v) => vertexFaceNames(naming, v).includes(name));
    const sum = corners.reduce<Vec3>((acc, v) => {
      const p = vertexPosition(naming, v);
      return [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]];
    }, [0, 0, 0]);
    const at: Vec3 = corners.length > 0 ? [sum[0] / corners.length, sum[1] / corners.length, sum[2] / corners.length] : [0, 0, 0];
    const plane = naming.facePlanes.slice(6 * index, 6 * index + 6);
    return { index, at, normal: [plane[3] ?? 0, plane[4] ?? 0, plane[5] ?? 1], naming };
  }

  /** A sketch plane on a named planar face (sketch coordinates are the world's, projected onto it). */
  onFace(name: string): SketchPlaneRef {
    const { index, at, normal } = this.face(name);
    return { kind: 'face', face: index, frame: frameOnPlane(at, normal), name };
  }

  /** A face picked at a point of it (for faces whose vertices do not give a point on them). */
  faceRef(name: string, at?: Vec3): FaceNameRef {
    const found = this.face(name);
    const ref = faceRefOf(found.naming, found.index, at ?? found.at);
    if (!ref) throw new Error(`no reference to ${name}`);
    return ref;
  }

  /** Where the reference plane `id` lies, as the kernel builds it. */
  planeFrame(id: string): SketchFrame {
    const result = this.build().features.find((candidate) => candidate.id === id);
    if (result?.reference?.kind !== 'plane') throw new Error(`no plane ${id}: ${JSON.stringify(result?.error)}`);
    return result.reference.frame;
  }

  /** The edge of the body so far whose middle is nearest to `point`. */
  edgeNear(point: Vec3): EdgeNameRef {
    const naming = this.naming();
    let best: EdgeNameRef | null = null;
    let distance = Infinity;
    for (let e = 0; e < naming.edgeFaces.length / 2; e++) {
      const ref = edgeRefOf(naming, e);
      if (!ref) continue;
      const d = Math.hypot(ref.at[0] - point[0], ref.at[1] - point[1], ref.at[2] - point[2]);
      if (d < distance) [best, distance] = [ref, d];
    }
    if (!best || distance > 1) throw new Error(`no edge at ${point.join(', ')} (nearest ${distance.toFixed(2)} mm away)`);
    return best;
  }

  /** The planar face through `point` whose outward normal is `normal` (to pick a body by a face of it). */
  faceAt(point: Vec3, normal: Vec3): FaceNameRef {
    const naming = this.naming();
    const index = naming.faces.findIndex((_, i) => {
      const plane = Array.from(naming.facePlanes.slice(6 * i, 6 * i + 6));
      if (!plane.every(Number.isFinite)) return false;
      const along = (point[0] - (plane[0] as number)) * (plane[3] as number) + (point[1] - (plane[1] as number)) * (plane[4] as number) + (point[2] - (plane[2] as number)) * (plane[5] as number);
      const facing = (plane[3] as number) * normal[0] + (plane[4] as number) * normal[1] + (plane[5] as number) * normal[2];
      return Math.abs(along) < 1e-6 && facing > 0.999;
    });
    const ref = index >= 0 ? faceRefOf(naming, index, point) : null;
    if (!ref) throw new Error(`no face through ${point.join(', ')} facing ${normal.join(', ')}`);
    return ref;
  }

  /** The first face whose name starts with `prefix`. */
  faceStarting(prefix: string): FaceNameRef {
    const name = this.naming().faces.find((candidate) => candidate.startsWith(prefix));
    if (!name) throw new Error(`no face ${prefix}…`);
    return this.faceRef(name);
  }

  /** A sketch plane on the reference plane `id`, and a function that gives world points in its coordinates. */
  onPlane(id: string): { plane: SketchPlaneRef; at(point: Vec3): [number, number] } {
    const frame = this.planeFrame(id);
    return { plane: { kind: 'feature', feature: id, frame }, at: (point) => ShowcaseBuilder.toSketch(frame, point) };
  }

  /** A point in the world in the coordinates of a sketch on a plane. */
  static toSketch(frame: SketchFrame, [x, y, z]: Vec3): [number, number] {
    const d = [x - frame.origin[0], y - frame.origin[1], z - frame.origin[2]];
    const dot = (a: readonly number[]) => (d[0] ?? 0) * (a[0] ?? 0) + (d[1] ?? 0) * (a[1] ?? 0) + (d[2] ?? 0) * (a[2] ?? 0);
    return [dot(frame.xDir), dot(frame.yDir)];
  }
}

// ------------------------------------------------------------------ the part

/** Builds the showcase part step by step; every step builds on the body of the steps before. */
export function buildShowcase(kernel: Kernel, step: string): Feature[] {
  const b = new ShowcaseBuilder(kernel);

  // Variables, the base plate (drawn round from its corner, so opposite edges run opposite ways) and a boss.
  b.add(
    { id: 'vars', type: 'variables', variables: [{ name: 'thickness', expression: '12' }, { name: 'bossHeight', expression: '30' }] },
    sketch('base', 'Base outline', TOP, rect('r', -80, -50, 80, 50)),
    { ...extrude('plate', 'Base plate', 'base', 12), expressions: { depth: 'thickness' } },
  );
  b.add(
    sketch('bossSketch', 'Boss circle', b.onFace('plate:end'), C('k', 40, 0, 22)),
    { ...extrude('boss', 'Boss', 'bossSketch', 30, { draft: 2 }), expressions: { depth: 'bossHeight' } },
  );
  // A groove around the boss: a revolved cut around a centerline in the front plane (through the boss axis).
  b.add(
    sketch('grooveSketch', 'Groove section', FRONT, [...polygon('g', [[57, 21], [66, 21], [66, 25], [57, 25]]), P('a1', 40, 0), P('a2', 40, 60), { id: 'axis', type: 'line', p1: 'a1', p2: 'a2', construction: true }]),
    { ...(defaultFeature('revolve') as RevolveFeature), id: 'groove', name: 'Groove', sketch: 'grooveSketch', axis: 'axis', operation: 'cut' },
  );
  // A counterbored M8 bore through the boss, a ring of six M3 holes around it on a reference axis.
  b.add(sketch('boreSketch', 'Bore position', b.onFace('boss:end'), [P('c', 40, 0)]), hole('bore', 'M8 counterbore', 'boreSketch', { kind: 'counterbore', size: 'M8' }));
  const bossAxis: AxisFeature = { id: 'bossAxis', name: 'Boss axis', type: 'axis', method: 'reference', references: [b.faceRef('bore:0:side:wall')] };
  b.add(bossAxis);
  b.add(
    sketch('ringSketch', 'Ring hole', b.onFace('boss:end'), [P('h', 54, 0)]),
    hole('ringHole', 'M3 tapped hole', 'ringSketch', { kind: 'tapped', size: 'M3', end: 'blind', depth: 8, threadDepth: 6 }),
    pattern('ring', 'Hole ring', { method: 'circular', references: [feature('bossAxis')], features: ['ringHole'], count: 6 }),
  );
  // A row of clearance holes along the front edge, the row copied into a grid, the grid mirrored to the right.
  b.add(sketch('cornerSketch', 'Corner hole', b.onFace('plate:end'), [P('h', -70, -40)]), hole('cornerHole', 'M5 clearance hole', 'cornerSketch', { size: 'M5' }));
  const frontEdge = b.edges(['plate:end', 'plate:side:ra']);
  const leftEdge = b.edges(['plate:end', 'plate:side:rd']);
  b.add(
    pattern('row', 'Hole row', { references: frontEdge, features: ['cornerHole'], count: 3, spacing: 15 }),
    // The left edge runs from the back to the front: Other direction turns the copies into the plate.
    pattern('grid', 'Hole grid', { references: leftEdge, features: ['row'], count: 2, spacing: 10, flip: true }),
    { ...(defaultFeature('mirror') as MirrorFeature), id: 'mirrorGrid', name: 'Mirrored grid', references: [RIGHT_PLANE], features: ['grid'] },
  );
  // The plate's vertical corners rounded; the boss rounded at its foot.
  b.add({ id: 'corners', name: 'Corner fillets', type: 'fillet', radius: 8, edges: b.edges(['plate:side:ra', 'plate:side:rb'], ['plate:side:rb', 'plate:side:rc'], ['plate:side:rc', 'plate:side:rd'], ['plate:side:rd', 'plate:side:ra']) } satisfies FilletFeature);
  b.add({ id: 'bossFoot', name: 'Boss foot', type: 'fillet', radius: 3, edges: b.edges(['boss:side:k', 'plate:end']) } satisfies FilletFeature);
  // A tab at the right end with a full round at its end and a hole through it.
  b.add({ id: 'tab', name: 'Tab', type: 'box', operation: 'add', width: 24, depth: 20, height: 6, position: [90, 0, 2] } satisfies BoxFeature);
  b.add({ id: 'tabRound', name: 'Tab full round', type: 'fillet', method: 'fullRound', radius: 4, edges: [], round: [b.faceRef('tab:top'), b.faceRef('tab:right'), b.faceRef('tab:bottom')] } satisfies FilletFeature);
  b.add(sketch('tabHoleSketch', 'Tab hole', b.onFace('tab:top'), [P('h', 94, 0)]), hole('tabHole', 'M4 countersink', 'tabHoleSketch', { kind: 'countersink', size: 'M4' }));
  // A pin with a chamfered top and a modeled M10 thread.
  b.add({ id: 'pin', name: 'Pin', type: 'cylinder', operation: 'add', radius: 5, height: 25, axis: 'z', position: [-60, -10, 12] } satisfies CylinderFeature);
  b.add({ id: 'pinChamfer', name: 'Pin chamfer', type: 'chamfer', method: 'angle', distance: 1, angle: 30, edges: b.edges(['pin:top', 'pin:side']) } satisfies ChamferFeature);
  b.add({ ...(defaultFeature('thread') as Feature & { type: 'thread' }), id: 'pinThread', name: 'M10 thread', faces: [b.faceRef('pin:side', [-55, -10, 20])], size: 'M10', pitch: 1.5, length: 12, reverse: true });
  // A housing, kept as a body of its own while it is built: drafted about the plate's top plane, rounded,
  // shelled open at the top, with a window cut by a tool body; then joined to the plate.
  b.add({ ...(defaultFeature('plane') as PlaneFeature), id: 'deck', name: 'Deck plane', method: 'offset', references: [TOP_PLANE], distance: 12, expressions: { distance: 'thickness' } });
  b.add(
    sketch('housingSketch', 'Housing outline', b.onFace('plate:end'), rect('h', -75, 0, -15, 45)),
    extrude('housing', 'Housing', 'housingSketch', 30, { merge: false }),
  );
  b.add({
    ...(defaultFeature('draft') as Feature & { type: 'draft' }), id: 'housingDraft', name: 'Housing draft', references: [feature('deck')], angle: 3,
    faces: ['ha', 'hb', 'hc', 'hd'].map((line) => b.faceRef(`housing:side:${line}`)),
  });
  b.add({
    id: 'housingCorners', name: 'Housing corners', type: 'fillet', radius: 5,
    edges: b.edges(['housing:side:ha', 'housing:side:hb'], ['housing:side:hb', 'housing:side:hc'], ['housing:side:hc', 'housing:side:hd'], ['housing:side:hd', 'housing:side:ha']),
  } satisfies FilletFeature);
  b.add({ id: 'housingShell', name: 'Housing shell', type: 'shell', thickness: 2, outward: false, faces: [b.faceRef('housing:end')] });
  b.add({ id: 'windowTool', name: 'Window tool', type: 'box', operation: 'add', merge: false, width: 10, depth: 10, height: 10, position: [-45, 0, 26] } satisfies BoxFeature);
  b.add({ ...(defaultFeature('combine') as Feature & { type: 'combine' }), id: 'window', name: 'Window', operation: 'subtract', bodies: [b.faceRef('housing:side:hd'), b.faceRef('windowTool:top')] });
  b.add({ ...(defaultFeature('combine') as Feature & { type: 'combine' }), id: 'join', name: 'Join housing', operation: 'add', bodies: [b.faceRef('plate:start'), b.faceRef('housing:side:hd')] });
  // A gusset in front of the housing, in a plane parallel to the right plane through a reference point.
  b.add({ ...(defaultFeature('point') as PointFeature), id: 'gussetPoint', name: 'Gusset point', method: 'coordinates', x: -25, y: -10, z: 12, expressions: { z: 'thickness' } });
  b.add({ ...(defaultFeature('plane') as PlaneFeature), id: 'gussetPlane', name: 'Gusset plane', method: 'throughPoint', references: [RIGHT_PLANE, feature('gussetPoint')] });
  const gusset = b.onPlane('gussetPlane');
  const [g1, g2] = [gusset.at([-25, -10, 12]), gusset.at([-25, 0.6, 22])];
  b.add(sketch('gussetSketch', 'Gusset line', gusset.plane, [P('g1', g1[0], g1[1]), P('g2', g2[0], g2[1]), L('gl', 'g1', 'g2')]));
  b.add({ ...(defaultFeature('rib') as Feature & { type: 'rib' }), id: 'gusset', name: 'Gusset', sketch: 'gussetSketch', thickness: 4 });

  // A compression spring: a helix around a circle on the plate, a wire profile at its start, swept along it.
  b.add(sketch('springBase', 'Spring circle', b.onFace('plate:end'), C('s', 0, 35, 6)));
  b.add({ ...(defaultFeature('helix') as Feature & { type: 'helix' }), id: 'helix', name: 'Spring helix', sketch: 'springBase', pitch: 4, turns: 5, startAngle: 0 });
  b.add({ ...(defaultFeature('point') as PointFeature), id: 'springPoint', name: 'Spring start', method: 'coordinates', x: 6, y: 35, z: 12, expressions: { z: 'thickness' } });
  b.add({ ...(defaultFeature('plane') as PlaneFeature), id: 'springPlane', name: 'Spring plane', method: 'throughPoint', references: [FRONT_PLANE, feature('springPoint')] });
  const wire = b.onPlane('springPlane');
  const wireAt = wire.at([6, 35, 12]);
  b.add(sketch('springWire', 'Spring wire', wire.plane, C('w', wireAt[0], wireAt[1], 1)));
  b.add({ ...(defaultFeature('sweep') as Feature & { type: 'sweep' }), id: 'spring', name: 'Spring', sketch: 'springWire', path: 'helix' });

  // A post lofted from a square on the plate to a circle on a plane 40 above the top plane.
  b.add(sketch('postBottom', 'Post square', b.onFace('plate:end'), rect('q', -8, -8, 8, 8)));
  b.add({ ...(defaultFeature('plane') as PlaneFeature), id: 'postTop', name: 'Post top plane', method: 'offset', references: [TOP_PLANE], distance: 40 });
  const top = b.onPlane('postTop');
  const topAt = top.at([0, 0, 40]);
  b.add(sketch('postTopSketch', 'Post circle', top.plane, C('t', topAt[0], topAt[1], 6)));
  b.add({ ...(defaultFeature('loft') as Feature & { type: 'loft' }), id: 'post', name: 'Post', sketches: ['postBottom', 'postTopSketch'] });

  // A channel swept along a spline in the top face: a half-round groove.
  b.add(sketch('channelPath', 'Channel path', b.onFace('plate:end'), [P('c1', -25, -40), P('c2', -10, -38), P('c3', 5, -33), { id: 'path', type: 'spline', points: ['c1', 'c2', 'c3'] }]));
  b.add({ ...(defaultFeature('point') as PointFeature), id: 'channelPoint', name: 'Channel start', method: 'coordinates', x: -25, y: -40, z: 12, expressions: { z: 'thickness' } });
  b.add({ ...(defaultFeature('plane') as PlaneFeature), id: 'channelPlane', name: 'Channel plane', method: 'throughPoint', references: [RIGHT_PLANE, feature('channelPoint')] });
  const section = b.onPlane('channelPlane');
  const sectionAt = section.at([-25, -40, 12]);
  b.add(sketch('channelSection', 'Channel section', section.plane, C('cs', sectionAt[0], sectionAt[1], 3)));
  b.add({ ...(defaultFeature('sweep') as Feature & { type: 'sweep' }), id: 'channel', name: 'Channel', operation: 'cut', sketch: 'channelSection', path: 'channelPath' });

  // A slot cut through all, an elliptical pocket, and a column up to the next face from a plane above.
  b.add(sketch('slotSketch', 'Slot', b.onFace('plate:end'), [
    P('s1', -30, -28), P('s2', -12, -28), P('s3', -12, -22), P('s4', -30, -22), P('sc1', -30, -25), P('sc2', -12, -25),
    L('sa', 's1', 's2'), { id: 'sb', type: 'arc', center: 'sc2', start: 's2', end: 's3' }, L('sc', 's3', 's4'), { id: 'sd', type: 'arc', center: 'sc1', start: 's4', end: 's1' },
  ]));
  b.add(extrude('slot', 'Slot cut', 'slotSketch', 10, { operation: 'cut', direction: 'reverse', end: 'throughAll' }));
  b.add(sketch('ellipseSketch', 'Ellipse', b.onFace('plate:end'), [P('ec', 25, -40), P('em', 31, -40), P('en', 25, -37), { id: 'e', type: 'ellipse', center: 'ec', major: 'em', minor: 'en' }]));
  b.add(extrude('ellipsePocket', 'Elliptical pocket', 'ellipseSketch', 3, { operation: 'cut', direction: 'reverse' }));
  b.add({ ...(defaultFeature('plane') as PlaneFeature), id: 'high', name: 'High plane', method: 'offset', references: [TOP_PLANE], distance: 60 });
  const high = b.onPlane('high');
  const highAt = high.at([60, 30, 60]);
  b.add(sketch('columnSketch', 'Column circle', high.plane, C('col', highAt[0], highAt[1], 4)));
  b.add(extrude('column', 'Column up to next', 'columnSketch', 10, { end: 'upToNext', direction: 'reverse' }));
  // A pin up to the post's top plane, and a fence extruded as a thin feature from an open line.
  b.add(sketch('stubSketch', 'Stub circle', b.onFace('plate:end'), C('st', 65, -15, 3)));
  b.add(extrude('stub', 'Stub up to plane', 'stubSketch', 10, { end: 'upToSurface', endRef: feature('postTop') }));
  b.add(sketch('fenceSketch', 'Fence line', b.onFace('plate:end'), [P('f1', 20, 44), P('f2', 45, 44), P('f3', 70, 40), L('fa', 'f1', 'f2'), L('fb', 'f2', 'f3')]));
  b.add(extrude('fence', 'Fence', 'fenceSketch', 10, { thin: 'one', thickness: 2 }));
  // A block imported from a STEP file.
  b.add({ id: 'block', name: 'Imported block', type: 'import', operation: 'add', file: 'block.step', hash: hashString(step), data: step });

  // Edges: a chamfer of two distances on the boss rim, an equal one on the column top, a variable fillet
  // along the fence and a face fillet in the corner between the housing and the plate.
  b.add({ id: 'bossRim', name: 'Boss rim chamfer', type: 'chamfer', method: 'distances', distance: 1.5, distance2: 1, edges: b.edges(['boss:end', 'boss:side:k']) } satisfies ChamferFeature);
  b.add({ id: 'columnTop', name: 'Column chamfer', type: 'chamfer', distance: 1, edges: b.edges(['column:end', 'column:side:col']) } satisfies ChamferFeature);
  b.add({ id: 'fenceRound', name: 'Fence round', type: 'fillet', method: 'variable', radius: 0.3, radius2: 0.8, edges: [b.edgeNear([32.5, 45, 22])] } satisfies FilletFeature);
  b.add({ id: 'housingFoot', name: 'Housing foot', type: 'fillet', method: 'faces', radius: 2, edges: [], round: [b.faceRef('housing:side:hb'), b.faceRef('plate:end', [-5, -20, 12])] } satisfies FilletFeature);

  // Surfaces: the boss top offset 10 up and thickened into a lid of its own (deleted again at the end);
  // copies of two tab faces knit into one surface.
  b.add({ ...(defaultFeature('offsetSurface') as Feature & { type: 'offsetSurface' }), id: 'capSurface', name: 'Cap surface', distance: 10, faces: [b.faceRef('boss:end', [40, 15, 42])] });
  b.add({ ...(defaultFeature('thicken') as Feature & { type: 'thicken' }), id: 'lid', name: 'Lid', surface: 'capSurface', thickness: 3, merge: false });
  b.add({ ...(defaultFeature('offsetSurface') as Feature & { type: 'offsetSurface' }), id: 'tabCopyTop', name: 'Tab top copy', distance: 0, faces: [b.faceRef('tab:top')] });
  b.add({ ...(defaultFeature('offsetSurface') as Feature & { type: 'offsetSurface' }), id: 'tabCopyFront', name: 'Tab front copy', distance: 0, faces: [b.faceRef('tab:front')] });
  b.add({ ...(defaultFeature('knit') as Feature & { type: 'knit' }), id: 'tabSkin', name: 'Tab skin', surfaces: ['tabCopyTop', 'tabCopyFront'] });
  // The lid split in two slabs along a surface in its middle, then both slabs deleted.
  b.add({ ...(defaultFeature('offsetSurface') as Feature & { type: 'offsetSurface' }), id: 'midSurface', name: 'Lid middle', distance: 11.5, faces: [b.faceRef('boss:end', [40, 15, 42])] });
  b.add({ ...(defaultFeature('split') as Feature & { type: 'split' }), id: 'lidSplit', name: 'Split lid', method: 'surface', surface: 'midSurface' });
  b.add({ ...(defaultFeature('deleteBody') as Feature & { type: 'deleteBody' }), id: 'removeLid', name: 'Delete lid', bodies: [b.faceAt([40, 15, 55], [0, 0, 1]), b.faceAt([40, 15, 52], [0, 0, -1])] });

  // Curves: a line projected onto the top face, and the front, corner and right top edges joined into one.
  b.add(sketch('markSketch', 'Mark line', TOP, [P('m1', -20, -45), P('m2', 20, -45), L('m', 'm1', 'm2')]));
  b.add({ ...(defaultFeature('projectedCurve') as Feature & { type: 'projectedCurve' }), id: 'mark', name: 'Projected mark', sketch: 'markSketch', faces: [b.faceRef('plate:end', [0, -45, 12])] });
  b.add({ ...(defaultFeature('compositeCurve') as Feature & { type: 'compositeCurve' }), id: 'rim', name: 'Rim curve', edges: [b.edgeNear([0, -50, 12]), b.edgeNear([72 + 8 * Math.SQRT1_2, -42 - 8 * Math.SQRT1_2, 12]), b.edgeNear([80, 0, 12])] });

  // A coordinate system at the plate's corner, for exports and mass properties.
  b.add({ ...(defaultFeature('csys') as CsysFeature), id: 'cornerFrame', name: 'Corner frame', method: 'position', x: -80, y: -50, z: 0 });
  return b.features;
}

/** The configurations of the showcase: as built, and a compact variant without spring, column and fence. */
export const SHOWCASE_CONFIGURATIONS: Configurations = {
  active: 'standard',
  list: [
    { id: 'standard', name: 'Standard', variables: { thickness: '12', bossHeight: '30' }, suppressed: [] },
    { id: 'compact', name: 'Compact', variables: { thickness: '10', bossHeight: '20' }, suppressed: ['spring', 'column', 'columnTop', 'fence', 'fenceRound'] },
  ],
};

/** The STEP file the showcase imports: an 8 × 8 × 6 block on the plate, next to the spring. */
export function showcaseStep(kernel: Kernel): Uint8Array {
  return kernel.exportModel({ features: [{ id: 'src', type: 'box', operation: 'add', width: 8, depth: 8, height: 6, position: [-8, 20, 12] } satisfies BoxFeature], format: 'step' });
}
