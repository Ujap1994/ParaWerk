/**
 * The reference suite of the Gate 2 exit criterion (ROADMAP.md, Phase 2): parts modeled the way a user
 * would model them – sketches on faces, edges and faces picked in the body, holes, patterns, shells –
 * each edited at an early feature. After every edit all features still build, none of them warns about
 * references it lost, and the part really changed.
 */
import { strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { RebuildResult } from '../../src/kernel/protocol.ts';
import { hashString } from '../../src/shared/hash.ts';
import {
  defaultFeature,
  type AxisFeature,
  type BoxFeature,
  type ChamferFeature,
  type CylinderFeature,
  type EdgeNameRef,
  type ExtrudeFeature,
  type Feature,
  type FilletFeature,
  type HoleFeature,
  type ImportFeature,
  type MirrorFeature,
  type PatternFeature,
  type PlaneFeature,
  type RevolveFeature,
  type ShellFeature,
  type SketchFeature,
  type Vec3,
} from '../../src/shared/model/feature.ts';
import { standardHoleDimensions } from '../../src/shared/model/hole.ts';
import { edgeFaceNames, edgeRefOf, faceRefOf, vertexFaceNames, vertexPosition, type BodyNaming } from '../../src/shared/model/naming.ts';
import type { FaceNameRef, GeometryRef } from '../../src/shared/model/reference.ts';
import { frameOnPlane, type SketchEntity, type SketchPlaneRef } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;
/** A STEP file of a 60 × 40 × 20 block, for the import models. */
let blockStep: string;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
  blockStep = strFromU8(kernel.exportModel({ features: [box('src', 60, 40, 20)], format: 'step' }));
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

// ------------------------------------------------------------------ building blocks

const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const C = (id: string, x: number, y: number, radius: number): SketchEntity[] => [P(`${id}c`, x, y), { id, type: 'circle', center: `${id}c`, radius }];
/** A rectangle with lines <p>a (bottom), <p>b (right), <p>c (top), <p>d (left). */
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

const sketch = (id: string, plane: SketchPlaneRef, entities: SketchEntity[]): SketchFeature => ({ id, type: 'sketch', plane, sketch: { entities, constraints: [] } });
const extrude = (id: string, from: string, depth: number, more: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({ ...(defaultFeature('extrude', id) as ExtrudeFeature), sketch: from, depth, ...more });
const revolve = (id: string, from: string, axis: string, more: Partial<RevolveFeature> = {}): RevolveFeature => ({ ...(defaultFeature('revolve', id) as RevolveFeature), sketch: from, axis, ...more });
function box(id: string, width: number, depth: number, height: number, position: Vec3 = [0, 0, 0], operation: BoxFeature['operation'] = 'add'): BoxFeature {
  return { id, type: 'box', operation, width, depth, height, position };
}
function cylinder(id: string, radius: number, height: number, position: Vec3, operation: CylinderFeature['operation'] = 'add', axis: CylinderFeature['axis'] = 'z'): CylinderFeature {
  return { id, type: 'cylinder', operation, radius, height, axis, position };
}
const fillet = (id: string, radius: number, edges: EdgeNameRef[]): FilletFeature => ({ id, type: 'fillet', radius, edges });
const chamfer = (id: string, distance: number, edges: EdgeNameRef[], more: Partial<ChamferFeature> = {}): ChamferFeature => ({ id, type: 'chamfer', distance, edges, ...more });
function hole(id: string, from: string, more: Partial<HoleFeature> = {}): HoleFeature {
  const base = { ...(defaultFeature('hole', id) as HoleFeature), sketch: from };
  const kind = more.kind ?? base.kind;
  return { ...base, ...standardHoleDimensions(kind, more.size ?? base.size, more.fit ?? base.fit), ...more };
}
const pattern = (id: string, more: Partial<PatternFeature>): PatternFeature => ({ ...(defaultFeature('pattern', id) as PatternFeature), ...more });
const mirror = (id: string, more: Partial<MirrorFeature>): MirrorFeature => ({ ...(defaultFeature('mirror', id) as MirrorFeature), ...more });
const shell = (id: string, faces: FaceNameRef[], thickness: number, outward = false): ShellFeature => ({ id, type: 'shell', faces, thickness, outward });
const offsetPlane = (id: string, from: GeometryRef, distance: number): PlaneFeature => ({ ...(defaultFeature('plane', id) as PlaneFeature), method: 'offset', references: [from], distance });
const zAxis = (id: string): AxisFeature => ({ id, type: 'axis', method: 'twoPlanes', references: [FRONT_PLANE, RIGHT_PLANE] });
const imported = (id: string, operation: ImportFeature['operation'] = 'add'): ImportFeature => ({ id, type: 'import', operation, file: 'block.step', hash: hashString(blockStep), data: blockStep });

// ------------------------------------------------------------------ picking, as in the 3D view

function build(features: Feature[]): RebuildResult {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

function namingOf(features: Feature[]): BodyNaming {
  const naming = build(features).captures[0]?.mesh?.naming;
  if (!naming) throw new Error('no body');
  return naming;
}

/** Every edge between the two named faces of the body after `features`. */
function edges(features: Feature[], ...pairs: [string, string][]): EdgeNameRef[] {
  const naming = namingOf(features);
  return pairs.flatMap(([a, b]) => {
    const key = [a, b].sort().join('|');
    const found = Array.from({ length: naming.edgeFaces.length / 2 }, (_, e) => e).filter((e) => edgeFaceNames(naming, e).join('|') === key);
    if (found.length === 0) throw new Error(`no edge between ${a} and ${b}`);
    return found.flatMap((e) => {
      const ref = edgeRefOf(naming, e);
      return ref ? [ref] : [];
    });
  });
}

/** The middle of a named face (its vertices' average) and the face's index and plane. */
function face(features: Feature[], name: string): { index: number; at: Vec3; normal: Vec3; naming: BodyNaming } {
  const naming = namingOf(features);
  const index = naming.faces.indexOf(name);
  if (index < 0) throw new Error(`no face ${name}`);
  const corners = Array.from({ length: naming.vertexPositions.length / 3 }, (_, v) => v).filter((v) => vertexFaceNames(naming, v).includes(name));
  const sum = corners.reduce<Vec3>((acc, v) => {
    const p = vertexPosition(naming, v);
    return [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]];
  }, [0, 0, 0]);
  const at: Vec3 = [sum[0] / corners.length, sum[1] / corners.length, sum[2] / corners.length];
  const plane = naming.facePlanes.slice(6 * index, 6 * index + 6);
  return { index, at, normal: [plane[3] ?? 0, plane[4] ?? 0, plane[5] ?? 1], naming };
}

/** A sketch plane on a named planar face (sketch coordinates are the world's, projected onto it). */
function onFace(features: Feature[], name: string): SketchPlaneRef {
  const { index, at, normal } = face(features, name);
  return { kind: 'face', face: index, frame: frameOnPlane(at, normal), name };
}

function faceRef(features: Feature[], name: string): FaceNameRef {
  const { index, at, naming } = face(features, name);
  const ref = faceRefOf(naming, index, at);
  if (!ref) throw new Error(`no reference to ${name}`);
  return ref;
}

// ------------------------------------------------------------------ edits of early features

type Edit = (features: Feature[]) => Feature[];

const set = (id: string, patch: Record<string, unknown> | null): Edit => (features) => features.map((f) => (f.id === id ? ({ ...f, ...(patch ?? {}) } as Feature) : f));
/** Moves sketch points: `points` maps point ids to new coordinates. */
const movePoints = (id: string, points: Record<string, [number, number]>): Edit => (features) =>
  features.map((f) =>
    f.id === id && f.type === 'sketch'
      ? { ...f, sketch: { ...f.sketch, entities: f.sketch.entities.map((e) => (e.type === 'point' && points[e.id] ? { ...e, x: points[e.id]?.[0] ?? e.x, y: points[e.id]?.[1] ?? e.y } : e)) } }
      : f,
  );
const setCircle = (id: string, circle: string, radius: number): Edit => (features) =>
  features.map((f) => (f.id === id && f.type === 'sketch' ? { ...f, sketch: { ...f.sketch, entities: f.sketch.entities.map((e) => (e.id === circle && e.type === 'circle' ? { ...e, radius } : e)) } } : f));
const insertAfter = (id: string, feature: Feature): Edit => (features) => {
  const at = features.findIndex((f) => f.id === id) + 1;
  return [...features.slice(0, at), feature, ...features.slice(at)];
};
const suppress = (id: string): Edit => set(id, { suppressed: true });

interface Model {
  name: string;
  build(): Feature[];
  edits: [string, Edit][];
}

// ------------------------------------------------------------------ the models

const MODELS: Model[] = [
  {
    name: 'plate with rounded corners and four clearance holes',
    build() {
      const base = [sketch('s', TOP, rect('r', -50, -30, 50, 30)), extrude('plate', 's', 8)];
      const holes = [sketch('pts', onFace(base, 'plate:end'), [P('a', -40, -20), P('b', 40, -20), P('c', 40, 20), P('d', -40, 20)]), hole('h', 'pts', { size: 'M5' })];
      const withHoles = [...base, ...holes];
      return [...withHoles, fillet('round', 6, edges(withHoles, ['plate:side:ra', 'plate:side:rb'], ['plate:side:rb', 'plate:side:rc'], ['plate:side:rc', 'plate:side:rd'], ['plate:side:rd', 'plate:side:ra']))];
    },
    edits: [
      ['wider plate', movePoints('s', { r2: [60, -30], r3: [60, 30] })],
      ['thicker plate', set('plate', { depth: 12 })],
      ['bigger holes', set('h', standardHoleDimensions('simple', 'M6', 'normal'))],
    ],
  },
  {
    name: 'L bracket with a rounded inner corner and a hole in each leg',
    build() {
      const base = [sketch('s', FRONT, polygon('l', [[0, 0], [60, 0], [60, 8], [8, 8], [8, 50], [0, 50]])), extrude('bracket', 's', 30, { direction: 'reverse' })];
      const inner = fillet('inner', 5, edges(base, ['bracket:side:l2', 'bracket:side:l3']));
      // On top of the foot, in the middle of the bracket's width.
      const holes = [sketch('pts', onFace(base, 'bracket:side:l2'), [P('a', 35, 15)]), hole('h', 'pts')];
      return [...base, inner, ...holes];
    },
    edits: [
      ['longer foot', movePoints('s', { lp1: [70, 0], lp2: [70, 8] })],
      ['thicker legs', movePoints('s', { lp2: [60, 10], lp3: [10, 10], lp4: [10, 50] })],
      ['wider bracket', set('bracket', { depth: 40 })],
    ],
  },
  {
    name: 'boss on a plate, rounded at its base',
    build() {
      const base = [sketch('s', TOP, rect('r', -40, -40, 40, 40)), extrude('plate', 's', 10)];
      const boss = [sketch('b', onFace(base, 'plate:end'), C('k', 0, 0, 15)), extrude('boss', 'b', 20)];
      const withBoss = [...base, ...boss];
      return [...withBoss, fillet('foot', 3, edges(withBoss, ['boss:side:k', 'plate:end']))];
    },
    edits: [
      ['thicker plate', set('plate', { depth: 16 })],
      ['bigger boss', setCircle('b', 'k', 20)],
      ['taller boss', set('boss', { depth: 30 })],
    ],
  },
  {
    name: 'block with a pocket rounded at its floor',
    build() {
      const base = [box('b', 100, 60, 40)];
      const pocket = [sketch('s', onFace(base, 'b:top'), rect('p', -30, -15, 30, 15)), extrude('pocket', 's', 15, { operation: 'cut', direction: 'reverse' })];
      const withPocket = [...base, ...pocket];
      return [...withPocket, fillet('floor', 3, edges(withPocket, ['pocket:start', 'pocket:side:pa'], ['pocket:start', 'pocket:side:pc']))];
    },
    edits: [
      ['taller block', set('b', { height: 50 })],
      ['deeper pocket', set('pocket', { depth: 25 })],
      ['longer pocket', movePoints('s', { p2: [35, -15], p3: [35, 15] })],
    ],
  },
  {
    name: 'turned shaft with chamfered ends',
    build() {
      const section = sketch('s', FRONT, [...polygon('h', [[0, 0], [12, 0], [12, 80], [0, 80]]), P('x1', 0, -10), P('x2', 0, 90), { id: 'axis', type: 'line', p1: 'x1', p2: 'x2', construction: true }]);
      const base = [section, revolve('shaft', 's', 'axis')];
      return [...base, chamfer('ends', 1.5, edges(base, ['shaft:side:h0', 'shaft:side:h1'], ['shaft:side:h1', 'shaft:side:h2']))];
    },
    edits: [
      ['longer shaft', movePoints('s', { hp2: [12, 100], hp3: [0, 100] })],
      ['thicker shaft', movePoints('s', { hp1: [15, 0], hp2: [15, 80] })],
    ],
  },
  {
    name: 'enclosure with rounded corners, shelled open at the top',
    build() {
      const base = [box('b', 120, 80, 45)];
      const rounded = [...base, fillet('corners', 8, edges(base, ['b:front', 'b:left'], ['b:front', 'b:right'], ['b:back', 'b:right'], ['b:back', 'b:left']))];
      return [...rounded, shell('wall', [faceRef(rounded, 'b:top')], 2.5)];
    },
    edits: [
      ['taller enclosure', set('b', { height: 55 })],
      ['larger corner radius', set('corners', { radius: 10 })],
      ['thicker walls', set('wall', { thickness: 3 })],
    ],
  },
  {
    name: 'flange with a circular pattern of bolt holes',
    build() {
      const base = [cylinder('disk', 50, 12, [0, 0, 0]), cylinder('bore', 15, 30, [0, 0, -5], 'cut'), zAxis('z')];
      const holes = [sketch('pts', onFace(base, 'disk:top'), [P('a', 38, 0)]), hole('h', 'pts', { size: 'M8' })];
      return [...base, ...holes, pattern('ring', { method: 'circular', references: [{ kind: 'feature', feature: 'z' }], features: ['h'], count: 6 })];
    },
    edits: [
      ['thicker flange', set('disk', { height: 16 })],
      ['bigger bore', set('bore', { radius: 18 })],
      ['eight holes', set('ring', { count: 8 })],
    ],
  },
  {
    name: 'rail with a linear pattern of bosses',
    build() {
      const base = [box('rail', 200, 30, 10, [0, 0, 0])];
      const boss = [sketch('s', onFace(base, 'rail:top'), C('k', -80, 0, 6)), extrude('boss', 's', 12)];
      return [...base, ...boss, pattern('row', { references: [RIGHT_PLANE], features: ['boss'], count: 5, spacing: 40 })];
    },
    edits: [
      ['higher rail', set('rail', { height: 14 })],
      ['closer bosses', set('row', { spacing: 30 })],
      ['more bosses', set('row', { count: 6, spacing: 30 })],
    ],
  },
  {
    name: 'mirrored slots in a plate',
    build() {
      const base = [box('plate', 120, 60, 10)];
      const slot = [sketch('s', onFace(base, 'plate:top'), rect('q', 20, -5, 45, 5)), extrude('slot', 's', 10, { operation: 'cut', direction: 'reverse', end: 'throughAll' })];
      return [...base, ...slot, mirror('m', { references: [RIGHT_PLANE], features: ['slot'] })];
    },
    edits: [
      ['wider plate', set('plate', { width: 140 })],
      ['longer slot', movePoints('s', { q2: [50, -5], q3: [50, 5] })],
    ],
  },
  {
    name: 'block with a boss on an offset reference plane',
    build() {
      const base = [box('b', 80, 60, 20)];
      const plane = offsetPlane('p', { kind: 'face', name: 'b:top', at: [0, 0, 20] }, 15);
      const top = [plane, sketch('s', { kind: 'feature', feature: 'p', frame: frameOnPlane([0, 0, 35], [0, 0, 1]) }, C('k', 0, 0, 10)), extrude('post', 's', 15, { direction: 'reverse' })];
      return [...base, ...top];
    },
    edits: [
      ['taller block', set('b', { height: 25 })],
      ['higher plane', set('p', { distance: 20 })],
    ],
  },
  {
    name: 'post extruded up to a reference plane',
    build() {
      const base = [box('b', 60, 60, 10), offsetPlane('p', TOP_PLANE, 50)];
      const post = [sketch('s', onFace(base, 'b:top'), C('k', 0, 0, 8)), extrude('post', 's', 10, { end: 'upToSurface', endRef: { kind: 'feature', feature: 'p' } })];
      const withPost = [...base, ...post];
      return [...withPost, fillet('foot', 2, edges(withPost, ['post:side:k', 'b:top']))];
    },
    edits: [
      ['higher plane', set('p', { distance: 60 })],
      ['thicker base', set('b', { height: 14 })],
    ],
  },
  {
    name: 'countersunk holes with rounded rims',
    build() {
      const base = [box('plate', 100, 50, 12)];
      const holes = [sketch('pts', onFace(base, 'plate:top'), [P('a', -30, 0), P('b', 30, 0)]), hole('h', 'pts', { kind: 'countersink', size: 'M5' })];
      return [...base, ...holes, chamfer('edges', 1, edges([...base, ...holes], ['plate:top', 'plate:front'], ['plate:top', 'plate:back']))];
    },
    edits: [
      ['thicker plate', set('plate', { height: 15 })],
      ['bigger screws', set('h', standardHoleDimensions('countersink', 'M6', 'normal'))],
    ],
  },
  {
    name: 'block with blind tapped holes',
    build() {
      const base = [box('b', 60, 40, 30)];
      const holes = [sketch('pts', onFace(base, 'b:top'), [P('a', -15, 0), P('b', 15, 0)]), hole('h', 'pts', { kind: 'tapped', end: 'blind' })];
      return [...base, ...holes, fillet('top', 2, edges([...base, ...holes], ['b:top', 'b:front']))];
    },
    edits: [
      ['taller block', set('b', { height: 40 })],
      ['deeper threads', set('h', { threadDepth: 15, depth: 19 })],
    ],
  },
  {
    name: 'two blocks joined with a rounded seam',
    build() {
      const base = [box('a', 80, 40, 20), box('b', 20, 40, 40, [30, 0, 20])];
      return [...base, fillet('seam', 4, edges(base, ['a:top', 'b:left']))];
    },
    edits: [
      ['taller riser', set('b', { height: 50 })],
      ['longer base', set('a', { width: 100 })],
    ],
  },
  {
    name: 'block chamfered all round its top',
    build() {
      const base = [box('b', 70, 50, 30)];
      return [...base, chamfer('top', 2, edges(base, ['b:top', 'b:front'], ['b:top', 'b:right'], ['b:top', 'b:back'], ['b:top', 'b:left']))];
    },
    edits: [
      ['bigger block', set('b', { width: 90, depth: 60 })],
      ['a bore inserted before the chamfer', insertAfter('b', cylinder('bore', 10, 50, [0, 0, -10], 'cut'))],
    ],
  },
  {
    name: 'fillets that survive a cut inserted before them',
    build() {
      const base = [box('b', 100, 60, 40)];
      return [...base, fillet('round', 5, edges(base, ['b:top', 'b:front'], ['b:top', 'b:back']))];
    },
    edits: [
      ['a pocket inserted before the fillets', insertAfter('b', box('slot', 30, 20, 10, [0, 0, 35], 'cut'))],
      ['a boss inserted before the fillets', insertAfter('b', cylinder('boss', 10, 20, [30, 0, 40]))],
    ],
  },
  {
    name: 'fillet on edges that a suppressed cut does not touch',
    build() {
      const base = [box('b', 100, 60, 40), cylinder('bore', 10, 60, [20, 0, -10], 'cut')];
      return [...base, fillet('round', 4, edges(base, ['b:front', 'b:left'], ['b:back', 'b:left']))];
    },
    edits: [
      ['bore suppressed', suppress('bore')],
      ['bore moved', set('bore', { position: [10, 0, -10] })],
    ],
  },
  {
    name: 'drafted boss with a rounded top',
    build() {
      const base = [box('b', 80, 80, 10)];
      const boss = [sketch('s', onFace(base, 'b:top'), rect('q', -20, -20, 20, 20)), extrude('boss', 's', 25, { draft: 5 })];
      const withBoss = [...base, ...boss];
      return [...withBoss, fillet('rim', 2, edges(withBoss, ['boss:end', 'boss:side:qa'], ['boss:end', 'boss:side:qc']))];
    },
    edits: [
      ['steeper draft', set('boss', { draft: 8 })],
      ['taller boss', set('boss', { depth: 30 })],
      ['thicker base', set('b', { height: 15 })],
    ],
  },
  {
    name: 'plate extruded both ways with a hole through all',
    build() {
      const base = [sketch('s', TOP, rect('r', -40, -25, 40, 25)), extrude('plate', 's', 10, { direction: 'two', depth2: 6 })];
      return [...base, cylinder('bore', 8, 40, [0, 0, -20], 'cut'), fillet('round', 3, edges(base, ['plate:side:ra', 'plate:side:rb']))];
    },
    edits: [
      ['deeper second side', set('plate', { depth2: 9 })],
      ['wider plate', movePoints('s', { r2: [50, -25], r3: [50, 25] })],
    ],
  },
  {
    name: 'imported block with a pocket and a rounded edge',
    build() {
      const base = [imported('block')];
      const pocket = [box('pocket', 20, 20, 10, [0, 0, 15], 'cut')];
      const withPocket = [...base, ...pocket];
      const naming = namingOf(base);
      // Any edge between two imported faces at the top of the block.
      const top = Array.from({ length: naming.edgeFaces.length / 2 }, (_, e) => e).find((e) => {
        const ref = edgeRefOf(naming, e);
        return ref !== null && Math.abs(ref.at[2] - 20) < 1e-6 && Math.abs(ref.at[1] + 20) < 1e-6;
      });
      const ref = top === undefined ? null : edgeRefOf(naming, top);
      if (!ref) throw new Error('no top edge');
      return [...withPocket, fillet('round', 2, [ref])];
    },
    edits: [
      ['deeper pocket', set('pocket', { height: 14, position: [0, 0, 8] })],
      ['pocket moved', set('pocket', { position: [10, 0, 15] })],
    ],
  },
  {
    name: 'shaft with a turned groove and rounded shoulders',
    build() {
      const section = sketch('s', FRONT, [...polygon('h', [[0, 0], [15, 0], [15, 60], [0, 60]]), P('x1', 0, -10), P('x2', 0, 70), { id: 'axis', type: 'line', p1: 'x1', p2: 'x2', construction: true }]);
      const base = [section, revolve('shaft', 's', 'axis')];
      const groove = [sketch('g', FRONT, [...polygon('q', [[12, 25], [20, 25], [20, 30], [12, 30]]), P('y1', 0, -10), P('y2', 0, 70), { id: 'gaxis', type: 'line', p1: 'y1', p2: 'y2', construction: true }]), revolve('cut', 'g', 'gaxis', { operation: 'cut' })];
      const withGroove = [...base, ...groove];
      return [...withGroove, fillet('ends', 1, edges(withGroove, ['shaft:side:h0', 'shaft:side:h1']))];
    },
    edits: [
      ['thicker shaft', movePoints('s', { hp1: [18, 0], hp2: [18, 60] })],
      ['groove moved', movePoints('g', { qp0: [12, 35], qp1: [20, 35], qp2: [20, 40], qp3: [12, 40] })],
    ],
  },
  {
    name: 'cut on a sketch of a plane at an angle',
    build() {
      const base = [box('b', 80, 60, 40)];
      const axis: AxisFeature = { id: 'ax', type: 'axis', method: 'twoPlanes', references: [TOP_PLANE, FRONT_PLANE] };
      const tilted: PlaneFeature = { ...(defaultFeature('plane', 'tilt') as PlaneFeature), method: 'angle', references: [TOP_PLANE, { kind: 'feature', feature: 'ax' }], angle: 20 };
      const cut = [axis, tilted, sketch('s', { kind: 'feature', feature: 'tilt', frame: frameOnPlane([0, 0, 0], [0, 0, 1]) }, rect('q', -10, -10, 10, 10)), extrude('slot', 's', 10, { operation: 'cut', direction: 'both', end: 'throughAll' })];
      return [...base, ...cut, fillet('round', 3, edges(base, ['b:front', 'b:left']))];
    },
    edits: [
      ['steeper plane', set('tilt', { angle: 30 })],
      ['bigger block', set('b', { width: 90 })],
    ],
  },
  {
    name: 'closed cavity with a filling hole',
    build() {
      const base = [box('b', 60, 60, 60)];
      const hollow = [...base, shell('cavity', [], 4)];
      return [...hollow, cylinder('fill', 3, 20, [0, 0, 50], 'cut')];
    },
    edits: [
      ['thicker walls', set('cavity', { thickness: 6 })],
      ['bigger block', set('b', { width: 70, depth: 70 })],
    ],
  },
  {
    name: 'row of holes made by a pattern of a hole feature',
    build() {
      const base = [box('bar', 160, 30, 12)];
      const holes = [sketch('pts', onFace(base, 'bar:top'), [P('a', -60, 0)]), hole('h', 'pts')];
      return [...base, ...holes, pattern('row', { references: [RIGHT_PLANE], features: ['h'], count: 5, spacing: 30 })];
    },
    edits: [
      ['thicker bar', set('bar', { height: 16 })],
      ['denser row', set('row', { count: 7, spacing: 20 })],
    ],
  },
  {
    name: 'fillets and chamfers on different edges',
    build() {
      const base = [box('b', 90, 50, 30)];
      const rounded = [...base, fillet('round', 4, edges(base, ['b:front', 'b:left'], ['b:front', 'b:right']))];
      return [...rounded, chamfer('bevel', 2, edges(rounded, ['b:top', 'b:back']))];
    },
    edits: [
      ['larger fillets', set('round', { radius: 6 })],
      ['taller block', set('b', { height: 40 })],
    ],
  },
  {
    name: 'uneven chamfer on a block',
    build() {
      const base = [box('b', 60, 40, 30)];
      return [...base, chamfer('bevel', 5, edges(base, ['b:top', 'b:front']), { method: 'distances', distance2: 2 })];
    },
    edits: [
      ['longer block', set('b', { width: 80 })],
      ['distance and angle', set('bevel', { method: 'angle', angle: 30 })],
    ],
  },
  {
    name: 'block with a bore whose rim is rounded',
    build() {
      const base = [box('b', 80, 60, 30), cylinder('bore', 12, 50, [0, 0, -10], 'cut')];
      return [...base, fillet('rim', 2, edges(base, ['b:top', 'bore:side']))];
    },
    edits: [
      ['bigger bore', set('bore', { radius: 15 })],
      ['taller block', set('b', { height: 40 })],
      ['bore moved', set('bore', { position: [10, 5, -10] })],
    ],
  },
  {
    name: 'stacked bosses, each sketched on the one below',
    build() {
      const base = [box('b', 80, 80, 10)];
      const first = [sketch('s1', onFace(base, 'b:top'), C('k1', 0, 0, 25)), extrude('boss1', 's1', 10)];
      const second = [sketch('s2', onFace([...base, ...first], 'boss1:end'), C('k2', 0, 0, 12)), extrude('boss2', 's2', 15)];
      const all = [...base, ...first, ...second];
      return [...all, fillet('step', 2, edges(all, ['boss2:side:k2', 'boss1:end']))];
    },
    edits: [
      ['taller first boss', set('boss1', { depth: 16 })],
      ['thicker base', set('b', { height: 14 })],
      ['smaller second boss', setCircle('s2', 'k2', 9)],
    ],
  },
  {
    name: 'spline-shaped plate with rounded edges',
    build() {
      const outline = [P('a', -40, 0), P('b', 0, 20), P('c', 40, 0), { id: 'curve', type: 'spline', points: ['a', 'b', 'c'] } as SketchEntity, L('bottom', 'c', 'a')];
      const base = [sketch('s', TOP, outline), extrude('plate', 's', 6)];
      return [...base, fillet('round', 1, edges(base, ['plate:end', 'plate:side:bottom']))];
    },
    edits: [
      ['higher arch', movePoints('s', { b: [0, 28] })],
      ['thicker plate', set('plate', { depth: 9 })],
    ],
  },
  {
    name: 'mirrored bosses with rounded feet',
    build() {
      const base = [box('plate', 120, 50, 10)];
      const boss = [sketch('s', onFace(base, 'plate:top'), C('k', 35, 0, 10)), extrude('boss', 's', 20)];
      const mirrored = [...base, ...boss, mirror('m', { references: [RIGHT_PLANE], features: ['boss'] })];
      return [...mirrored, fillet('foot', 2, edges([...base, ...boss], ['boss:side:k', 'plate:top']))];
    },
    edits: [
      ['taller bosses', set('boss', { depth: 25 })],
      ['thicker plate', set('plate', { height: 14 })],
    ],
  },
  {
    name: 'column extruded up to the next face, joining a plate to a roof',
    build() {
      const base = [box('b', 100, 60, 10), box('roof', 100, 60, 8, [0, 0, 40])];
      const column = [sketch('s', onFace(base, 'b:top'), C('k', 0, 0, 8)), extrude('col', 's', 10, { end: 'upToNext' })];
      const joined = [...base, ...column];
      return [...joined, fillet('foot', 2, edges(joined, ['col:side:k', 'b:top']))];
    },
    edits: [
      ['higher roof', set('roof', { position: [0, 0, 50] })],
      ['thicker plate', set('b', { height: 14 })],
      ['wider column', setCircle('s', 'k', 11)],
    ],
  },
  {
    name: 'filling hole cut up to the next face through the lid of a closed box',
    build() {
      const base = [box('b', 70, 50, 40)];
      const hollow = [...base, shell('cavity', [], 4)];
      const fill = [sketch('s', onFace(base, 'b:top'), C('k', 10, 0, 5)), extrude('fill', 's', 5, { operation: 'cut', direction: 'reverse', end: 'upToNext' })];
      const all = [...hollow, ...fill];
      return [...all, chamfer('rim', 1, edges(all, ['fill:side:k', 'b:top']))];
    },
    edits: [
      ['thicker walls', set('cavity', { thickness: 6 })],
      ['taller box', set('b', { height: 50 })],
    ],
  },
  {
    name: 'boss extruded up to the curved surface of a shaft',
    build() {
      const base = [box('b', 80, 60, 10), cylinder('shaft', 15, 60, [0, -30, 45], 'add', 'y')];
      const boss = [sketch('s', onFace(base, 'b:top'), rect('q', -6, -6, 6, 6)), extrude('boss', 's', 10, { end: 'upToSurface', endRef: { kind: 'face', name: 'shaft:side', at: [0, 0, 30] } })];
      const all = [...base, ...boss];
      return [...all, fillet('foot', 1.5, edges(all, ['boss:side:qa', 'b:top']))];
    },
    edits: [
      ['thicker shaft', set('shaft', { radius: 18 })],
      ['lower shaft', set('shaft', { position: [0, -30, 40] })],
      ['gap of 3', set('boss', { endOffset: 3 })],
    ],
  },
];

describe('reference models', () => {
  it('has at least 30 parts', () => {
    expect(MODELS.length).toBeGreaterThanOrEqual(30);
  });

  /** Volume, center of mass and bounding box, rounded: what tells parts apart. */
  function signature(result: RebuildResult): string {
    const props = result.captures[0]?.properties;
    if (!props) return 'none';
    return [props.volume, ...props.center, ...props.bboxMin, ...props.bboxMax].map((value) => value.toFixed(4)).join(' ');
  }

  /** Every feature builds and none warns; the message says which feature of which part failed. */
  function expectClean(result: RebuildResult, label: string): void {
    const problems = result.features.flatMap((feature) =>
      feature.status === 'error' ? [`${feature.id}: ${feature.error?.code} ${feature.error?.detail ?? ''}`] : feature.warning ? [`${feature.id}: warning ${feature.warning.code}`] : [],
    );
    expect(problems, label).toEqual([]);
  }

  it.each(MODELS.map((model) => [model.name, model] as const))('%s', (_name, model) => {
    const features = model.build();
    const base = build(features);
    expectClean(base, model.name);
    expect(base.captures[0]?.properties?.volume, model.name).toBeGreaterThan(0);
    for (const [label, edit] of model.edits) {
      const result = build(edit(features));
      expectClean(result, `${model.name}: ${label}`);
      // The edit did something: the part has another size, shape or place.
      expect(signature(result), `${model.name}: ${label} changes the part`).not.toBe(signature(base));
    }
  });
});
