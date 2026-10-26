/**
 * Geometry kernel benchmarks (Node, OCCT WebAssembly).
 * Run: npm run bench:kernel   Results: bench/results/kernel-<platform>-<arch>.json
 * KERNEL_BACKEND=replicad benchmarks the prebuilt Phase 0 build instead (suite "kernel-replicad").
 */
import type { ShapeHandle } from '../../src/kernel/backend.ts';
import { createKernel } from '../../src/kernel/create.ts';
import type { BackendName } from '../../src/kernel/kernel.ts';
import { displayQuality } from '../../src/kernel/mesh-quality.ts';
import type { RebuildRequest } from '../../src/kernel/protocol.ts';
import { defaultFeature, type Feature, type Vec3 } from '../../src/shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf, resolveEdgeRefs } from '../../src/shared/model/naming.ts';
import { calibration, measure, meta, printReport, summarize, writeReport, type BenchReport, type CaseResult } from '../lib.ts';

const cases: Record<string, CaseResult> = {};
cases['calibration'] = calibration();

const backendName = (process.env.KERNEL_BACKEND ?? 'parawerk') as BackendName;
const initStart = performance.now();
const kernel = await createKernel(backendName);
cases['kernel.init'] = summarize([performance.now() - initStart]);
cases['kernel.warmUp'] = summarize([kernel.warmUp()]);

const request = (features: Feature[], withProperties = false): RebuildRequest => ({
  features,
  captures: [features.length - 1],
  knownMeshKeys: [],
  withProperties,
});

const box = (width: number): Feature => ({ id: 'base', type: 'box', operation: 'add', width, depth: 60, height: 40, position: [0, 0, 0] });

/** A plate with a grid of `holes` drilled holes, one feature per hole. */
function plate(holes: number, width = 400): Feature[] {
  const side = Math.ceil(Math.sqrt(holes));
  const pitch = 360 / side;
  const features: Feature[] = [{ id: 'plate', type: 'box', operation: 'add', width, depth: 400, height: 12, position: [0, 0, 0] }];
  for (let i = 0; i < holes; i++) {
    features.push({
      id: `hole${i}`,
      type: 'cylinder',
      operation: 'cut',
      radius: 4,
      height: 20,
      axis: 'z',
      position: [-180 + pitch / 2 + (i % side) * pitch, -180 + pitch / 2 + Math.floor(i / side) * pitch, -4],
    });
  }
  return features;
}

cases['box.rebuild'] = measure((i) => kernel.rebuild(request([box(100 + i)])), { iterations: 30 });

const allEdges = Array.from({ length: 12 }, (_, index) => ({ kind: 'edge-index' as const, index }));
cases['fillet.12edges.rebuild'] = measure(
  (i) => kernel.rebuild(request([box(100), { id: 'f', type: 'fillet', radius: 3 + (i % 5) * 0.25, edges: allEdges }])),
  { iterations: 20 },
);

for (const holes of [10, 50, 100]) {
  const features = plate(holes);
  cases[`plate.${holes}holes.fullRebuild`] = {
    ...measure((i) => kernel.rebuild(request(plate(holes, 400 + (i + 3) * 0.01))), { iterations: holes >= 100 ? 3 : 5, warmup: 1 }),
    info: { features: features.length },
  };
}

// Editing the last feature of a 101-feature part must only rebuild that feature.
const big = plate(100);
kernel.rebuild(request(big));
cases['plate.100holes.editLast'] = measure((i) => {
  const edited = [...big];
  const last = big[big.length - 1] as Extract<Feature, { type: 'cylinder' }>;
  edited[edited.length - 1] = { ...last, radius: 3 + (i % 5) * 0.2 };
  kernel.rebuild(request(edited));
}, { iterations: 10 });

kernel.rebuild(request(big));
const shape = (kernel as unknown as { rebuilder: { shapeAfter(i: number): ShapeHandle | null } }).rebuilder.shapeAfter(big.length - 1);
if (shape) {
  let triangles = 0;
  cases['plate.100holes.mesh'] = measure(() => {
    const mesh = kernel.backend.mesh(shape, displayQuality(560), 'bench');
    triangles = mesh.indices.length / 3;
  }, { iterations: 10 });
  cases['plate.100holes.mesh'].info = { triangles };
  cases['plate.100holes.massProperties'] = measure(() => kernel.backend.massProperties(shape), { iterations: 10 });
  if (backendName === 'parawerk') {
    // What a fillet of the 100 upper hole edges spends on finding them: the body's names, then the references.
    const naming = kernel.backend.naming(shape);
    const refs = Array.from({ length: naming.edgeFaces.length / 2 }, (_, edge) => edge)
      .filter((edge) => edgeFaceNames(naming, edge).includes('plate:top'))
      .flatMap((edge) => edgeRefOf(naming, edge) ?? []);
    cases['plate.100holes.resolveEdges'] = {
      ...measure(() => resolveEdgeRefs(refs, kernel.backend.naming(shape)), { iterations: 10 }),
      info: { references: refs.length },
    };
  }
}
// The same plate as one sketch (outline and 100 circles) extruded in one feature; then a spline profile.
if (backendName === 'parawerk') {
  const sketchPlate = (holes: number, width: number): Feature[] => {
    const side = Math.ceil(Math.sqrt(holes));
    const pitch = 360 / side;
    const [w, d] = [width / 2, 200];
    const entities: Extract<Feature, { type: 'sketch' }>['sketch']['entities'] = [
      { id: 'a', type: 'point', x: -w, y: -d }, { id: 'b', type: 'point', x: w, y: -d }, { id: 'c', type: 'point', x: w, y: d }, { id: 'd', type: 'point', x: -w, y: d },
      { id: 'ab', type: 'line', p1: 'a', p2: 'b' }, { id: 'bc', type: 'line', p1: 'b', p2: 'c' }, { id: 'cd', type: 'line', p1: 'c', p2: 'd' }, { id: 'da', type: 'line', p1: 'd', p2: 'a' },
    ];
    for (let i = 0; i < holes; i++) {
      entities.push({ id: `m${i}`, type: 'point', x: -180 + pitch / 2 + (i % side) * pitch, y: -180 + pitch / 2 + Math.floor(i / side) * pitch });
      entities.push({ id: `h${i}`, type: 'circle', center: `m${i}`, radius: 4 });
    }
    return [
      { id: 'sketch', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities, constraints: [] } },
      { id: 'extrude', type: 'extrude', operation: 'add', sketch: 'sketch', depth: 12, direction: 'normal', end: 'blind' },
    ];
  };
  cases['extrude.plate100holes.rebuild'] = measure((i) => kernel.rebuild(request(sketchPlate(100, 400 + (i + 1) * 0.01))), { iterations: 5, warmup: 1 });
  // The same 100 holes as one hole feature (M8 clearance holes at the points of a sketch on the top face).
  const holePlate = (holes: number, width: number): Feature[] => {
    const side = Math.ceil(Math.sqrt(holes));
    const pitch = 360 / side;
    const points: Extract<Feature, { type: 'sketch' }>['sketch']['entities'] = [];
    for (let i = 0; i < holes; i++) points.push({ id: `m${i}`, type: 'point', x: -180 + pitch / 2 + (i % side) * pitch, y: -180 + pitch / 2 + Math.floor(i / side) * pitch });
    const top = { origin: [0, 0, 12] as Vec3, xDir: [1, 0, 0] as Vec3, yDir: [0, 1, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    return [
      { id: 'plate', type: 'box', operation: 'add', width, depth: 400, height: 12, position: [0, 0, 0] },
      { id: 'points', type: 'sketch', plane: { kind: 'face', face: 5, name: 'plate:top', frame: top }, sketch: { entities: points, constraints: [] } },
      { ...(defaultFeature('hole', 'holes') as Extract<Feature, { type: 'hole' }>), sketch: 'points', size: 'M8', diameter: 9 },
    ];
  };
  cases['hole.plate100holes.rebuild'] = measure((i) => kernel.rebuild(request(holePlate(100, 400 + (i + 1) * 0.01))), { iterations: 5, warmup: 1 });
  const wave = (points: number): Feature[] => {
    const entities: Extract<Feature, { type: 'sketch' }>['sketch']['entities'] = [];
    for (let i = 0; i < points; i++) entities.push({ id: `f${i}`, type: 'point', x: i * 10, y: 20 + 8 * Math.sin(i * 0.7) });
    const last = (points - 1) * 10;
    entities.push(
      { id: 's', type: 'spline', points: entities.map((entity) => entity.id) },
      { id: 'lo', type: 'point', x: 0, y: 0 }, { id: 'lr', type: 'point', x: last, y: 0 },
      { id: 'right', type: 'line', p1: `f${points - 1}`, p2: 'lr' }, { id: 'base', type: 'line', p1: 'lr', p2: 'lo' }, { id: 'left', type: 'line', p1: 'lo', p2: 'f0' },
    );
    return [
      { id: 'sketch', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities, constraints: [] } },
      { id: 'extrude', type: 'extrude', operation: 'add', sketch: 'sketch', depth: 10, direction: 'normal', end: 'blind' },
    ];
  };
  cases['extrude.spline100.rebuildWithProperties'] = measure((i) => kernel.rebuild(request(wave(100 + (i % 2)), true)), { iterations: 5, warmup: 1 });
  // The same spline outline (on the front plane, beside the z axis) revolved a full turn: a vase.
  const vase = (points: number): Feature[] => {
    const [sketch] = wave(points) as [Extract<Feature, { type: 'sketch' }>];
    const entities = [
      ...sketch.sketch.entities.map((entity) => (entity.type === 'point' ? { ...entity, x: entity.y + 5, y: entity.x } : entity)),
      { id: 'a1', type: 'point' as const, x: 0, y: -5 }, { id: 'a2', type: 'point' as const, x: 0, y: 5 },
      { id: 'axis', type: 'line' as const, p1: 'a1', p2: 'a2', construction: true },
    ];
    return [
      { ...sketch, plane: { kind: 'standard', plane: 'front' }, sketch: { entities, constraints: [] } },
      { id: 'revolve', type: 'revolve', operation: 'add', sketch: 'sketch', axis: 'axis', angle: 360, direction: 'normal' },
    ];
  };
  cases['revolve.spline100.rebuildWithProperties'] = measure((i) => kernel.rebuild(request(vase(100 + (i % 2)), true)), { iterations: 5, warmup: 1 });
  // Up to next: 25 holes cut through the lid of a closed box (not its floor), from a plane above it.
  // Only the sketch and the cut change between runs: the box and its cavity come from the cache.
  const lidHoles = (radius: number): Feature[] => {
    const entities: Extract<Feature, { type: 'sketch' }>['sketch']['entities'] = [];
    for (let i = 0; i < 25; i++) {
      entities.push({ id: `m${i}`, type: 'point', x: -120 + (i % 5) * 60, y: -120 + Math.floor(i / 5) * 60 });
      entities.push({ id: `h${i}`, type: 'circle', center: `m${i}`, radius });
    }
    const above = { origin: [0, 0, 60] as Vec3, xDir: [1, 0, 0] as Vec3, yDir: [0, 1, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    return [
      { id: 'box', type: 'box', operation: 'add', width: 300, depth: 300, height: 40, position: [0, 0, 0] },
      { id: 'cavity', type: 'shell', thickness: 4, faces: [], outward: false },
      { id: 'plane', type: 'plane', method: 'offset', references: [{ kind: 'standard-plane', plane: 'top' }], distance: 60, angle: 45, flip: false },
      { id: 'sketch', type: 'sketch', plane: { kind: 'feature', feature: 'plane', frame: above }, sketch: { entities, constraints: [] } },
      { id: 'cut', type: 'extrude', operation: 'cut', sketch: 'sketch', depth: 10, direction: 'reverse', end: 'upToNext' },
    ];
  };
  // A modeled M10 thread over 20 mm on a screw (13 turns of the ISO groove swept along a helix).
  const screw = (length: number): Feature[] => [
    { id: 'shank', type: 'cylinder', operation: 'add', radius: 5, height: 30, axis: 'z', position: [0, 0, 0] },
    { id: 'thread', type: 'thread', faces: [{ kind: 'face', name: 'shank:side', at: [5, 0, 10] }], size: 'M10', pitch: 1.5, length, reverse: false, leftHand: false },
  ];
  cases['thread.m10x20.rebuild'] = measure((i) => kernel.rebuild(request(screw(20 + (i + 1) * 0.01))), { iterations: 3, warmup: 1 });
  // A compression spring: a wire of Ø2 swept along a helix of 10 turns around a circle of Ø20, with its properties.
  const spring = (pitch: number): Feature[] => [
    { id: 'base', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [{ id: 'o', type: 'point', x: 0, y: 0 }, { id: 'c', type: 'circle', center: 'o', radius: 10 }], constraints: [] } },
    { id: 'helix', type: 'helix', sketch: 'base', pitch, turns: 10, startAngle: 0, leftHand: false, reverse: false },
    { id: 'wire', type: 'sketch', plane: { kind: 'standard', plane: 'front' }, sketch: { entities: [{ id: 'm', type: 'point', x: 10, y: 0 }, { id: 'w', type: 'circle', center: 'm', radius: 1 }], constraints: [] } },
    { id: 'spring', type: 'sweep', operation: 'add', sketch: 'wire', path: 'helix' },
  ];
  cases['sweep.spring10turns.rebuildWithProperties'] = measure((i) => kernel.rebuild(request(spring(5 + (i + 1) * 0.01), true)), { iterations: 3, warmup: 1 });
  // A cut through 20 overlapping bodies (body by body, docs/adr/0011-multi-body-parts.md), and through the
  // same boxes merged into one body. Only the cut changes between runs.
  const row = (merge: boolean, radius: number): Feature[] => [
    ...Array.from({ length: 20 }, (_, k): Feature => ({ id: `b${k}`, type: 'box', operation: 'add', ...(merge || k === 0 ? {} : { merge: false }), width: 20, depth: 30, height: 30, position: [k * 15, 0, 0] })),
    { id: 'bore', type: 'cylinder', operation: 'cut', radius, height: 400, axis: 'x', position: [-20, 0, 15] },
  ];
  for (const merge of [false, true]) {
    kernel.rebuild(request(row(merge, 5)));
    cases[`bodies.20${merge ? 'merged' : 'overlapping'}.cutThrough`] = measure((i) => kernel.rebuild(request(row(merge, 5 + (i + 1) * 0.01))), { iterations: 5, warmup: 1 });
  }
  kernel.rebuild(request(lidHoles(5)));
  cases['extrude.upToNext.cut25outlines'] = measure((i) => kernel.rebuild(request(lidHoles(5 + (i + 1) * 0.01))), { iterations: 5, warmup: 1 });
}

// A part with many features as users build them: per boss a sketch on the plate's top face, the extrusion
// and a fillet on its rim (3 features each). Editing the last feature must stay cheap at 301 features;
// an early edit rebuilds everything after it.
if (backendName === 'parawerk') {
  const bossPart = (bosses: number, depth = 10): Feature[] => {
    const side = Math.ceil(Math.sqrt(bosses));
    const pitch = 600 / side;
    const top = { origin: [0, 0, 10] as Vec3, xDir: [1, 0, 0] as Vec3, yDir: [0, 1, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const features: Feature[] = [{ id: 'plate', type: 'box', operation: 'add', width: 640, depth: 640, height: 10, position: [0, 0, 0] }];
    for (let i = 0; i < bosses; i++) {
      const [x, y] = [-300 + pitch / 2 + (i % side) * pitch, -300 + pitch / 2 + Math.floor(i / side) * pitch];
      features.push(
        { id: `s${i}`, type: 'sketch', plane: { kind: 'face', face: 5, name: 'plate:top', frame: top }, sketch: { entities: [{ id: 'm', type: 'point', x, y }, { id: 'k', type: 'circle', center: 'm', radius: 8 }], constraints: [] } },
        { id: `b${i}`, type: 'extrude', operation: 'add', sketch: `s${i}`, depth: i === 0 ? depth : 10, direction: 'normal', end: 'blind' },
        { id: `f${i}`, type: 'fillet', radius: 1.5, edges: [{ kind: 'edge', faces: [`b${i}:end`, `b${i}:side:k`], at: [x + 8, y, 10 + (i === 0 ? depth : 10)] }] },
      );
    }
    return features;
  };
  for (const bosses of [33, 100]) {
    const features = bossPart(bosses);
    const label = `bosses.${features.length}features`;
    cases[`${label}.fullRebuild`] = {
      ...measure((i) => kernel.rebuild(request(bossPart(bosses).map((feature) => (feature.id === 'plate' ? { ...feature, height: 10 + (i + 1) * 1e-3 } : feature)))), { iterations: bosses >= 100 ? 1 : 3, warmup: 0 }),
      info: { features: features.length },
    };
    kernel.rebuild(request(features));
    cases[`${label}.editLast`] = measure((i) => {
      const edited = [...features];
      const last = features[features.length - 1] as Extract<Feature, { type: 'fillet' }>;
      edited[edited.length - 1] = { ...last, radius: 1 + (i % 5) * 0.1 };
      kernel.rebuild(request(edited));
    }, { iterations: 5 });
  }
}

cases['plate.100holes.exportStep'] = measure(() => kernel.exportModel({ features: big, format: 'step' }), { iterations: 5, warmup: 1 });
cases['plate.100holes.exportStl'] = measure(() => kernel.exportModel({ features: big, format: 'stl' }), { iterations: 5, warmup: 1 });
cases['memory.wasmHeapMb'] = { ...summarize([0]), info: { mb: Math.round(kernel.memoryStats().wasmHeapBytes / 1048576) } };

const report: BenchReport = { suite: backendName === 'parawerk' ? 'kernel' : `kernel-${backendName}`, meta: meta(), cases };
printReport(report);
console.log(`Results written to ${writeReport(report)}`);
