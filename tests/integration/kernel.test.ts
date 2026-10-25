import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { BackendName, Kernel } from '../../src/kernel/kernel.ts';
import type { RebuildRequest } from '../../src/kernel/protocol.ts';
import type { BoxFeature, CylinderFeature, ExtrudeFeature, Feature, FilletFeature, SketchFeature } from '../../src/shared/model/feature.ts';
import { frameOnPlane, type SketchEntity } from '../../src/shared/model/sketch.ts';
import { splinePolyline, splineThrough } from '../../src/shared/model/spline.ts';

describe.each(['parawerk', 'replicad'] as BackendName[])('%s backend', (backendName) => {
  let kernel: Kernel;

  beforeAll(async () => {
    kernel = await createKernel(backendName);
  });

  afterAll(() => {
    kernel[Symbol.dispose]();
  });

  const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
  const allEdges = Array.from({ length: 12 }, (_, index) => ({ kind: 'edge-index' as const, index }));

  function request(features: Feature[], overrides: Partial<RebuildRequest> = {}): RebuildRequest {
    return { features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true, ...overrides };
  }

  function finalState(features: Feature[], overrides: Partial<RebuildRequest> = {}) {
    const { result } = kernel.rebuild(request(features, overrides));
    const state = result.captures[0];
    if (!state) throw new Error('no capture');
    return { result, state };
  }

  /** Volume of a box whose 12 edges are rounded with radius r (including the spherical corners). */
  function roundedBoxVolume(a: number, b: number, c: number, r: number): number {
    const [x, y, z] = [a - 2 * r, b - 2 * r, c - 2 * r];
    return x * y * z + 2 * r * (x * y + x * z + y * z) + Math.PI * r * r * (x + y + z) + (4 / 3) * Math.PI * r ** 3;
  }

  describe('geometry', () => {
    it('builds a box with exact volume, area and topology', () => {
      const { state } = finalState([box]);
      expect(state.properties?.volume).toBeCloseTo(240_000, 6);
      expect(state.properties?.area).toBeCloseTo(24_800, 6);
      expect(state.properties?.center).toEqual([0, 0, 20].map((v) => expect.closeTo(v, 9)));
      expect(state.faceCount).toBe(6);
      expect(state.edgeCount).toBe(12);
      expect(state.mesh?.faceRanges.length).toBe(12);
      expect(state.mesh?.edgeRanges.length).toBe(24);
    });

    it('rounds all edges of a box to the analytic volume', () => {
      const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };
      const { state } = finalState([box, fillet]);
      expect(state.properties?.volume).toBeCloseTo(roundedBoxVolume(100, 60, 40, 5), 2);
      expect(state.faceCount).toBe(26);
    });

    it('cuts and adds cylinders', () => {
      const hole: CylinderFeature = { id: 'hole', type: 'cylinder', operation: 'cut', radius: 10, height: 60, axis: 'z', position: [0, 0, -10] };
      const boss: CylinderFeature = { id: 'boss', type: 'cylinder', operation: 'add', radius: 10, height: 20, axis: 'z', position: [30, 0, 40] };
      const cut = finalState([box, hole]).state;
      expect(cut.properties?.volume).toBeCloseTo(240_000 - Math.PI * 100 * 40, 4);
      const both = finalState([box, hole, boss]).state;
      expect(both.properties?.volume).toBeCloseTo(240_000 - Math.PI * 100 * 40 + Math.PI * 100 * 20, 4);
    });

    it('chamfers edges', () => {
      const chamfer: Feature = { id: 'chamfer', type: 'chamfer', distance: 2, edges: [{ kind: 'edge-index', index: 0 }] };
      const { state, result } = finalState([box, chamfer]);
      expect(result.features[1]?.status).toBe('ok');
      // A 45° chamfer removes a triangular prism along the edge.
      const edgeLength = [100, 60, 40].find((length) => Math.abs(state.properties!.volume - (240_000 - 2 * length)) < 1e-6);
      expect(edgeLength).toBeDefined();
    });
  });

  describe('incremental rebuild', () => {
    it('reuses cached features and recomputes from the first change', () => {
      const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };
      kernel.rebuild(request([box, fillet]));
      const again = kernel.rebuild(request([box, fillet])).result;
      expect(again.timings.rebuiltFeatures).toBe(0);
      expect(again.features.every((f) => f.cached)).toBe(true);

      const changed = kernel.rebuild(request([box, { ...fillet, radius: 4 }])).result;
      expect(changed.timings.rebuiltFeatures).toBe(1);
      expect(changed.features[0]?.cached).toBe(true);
    });

    it('does not rebuild when only a name changes', () => {
      kernel.rebuild(request([box]));
      const renamed = kernel.rebuild(request([{ ...box, name: 'Base plate' }])).result;
      expect(renamed.timings.rebuiltFeatures).toBe(0);
    });

    it('skips mesh payloads the client already has', () => {
      const first = finalState([box]).state;
      expect(first.mesh).toBeDefined();
      const second = finalState([box], { knownMeshKeys: [first.meshKey!] }).state;
      expect(second.mesh).toBeUndefined();
      expect(second.meshKey).toBe(first.meshKey);
    });

    it('passes the body through suppressed features', () => {
      const hole: CylinderFeature = { id: 'hole', type: 'cylinder', operation: 'cut', radius: 10, height: 60, axis: 'z', position: [0, 0, -10], suppressed: true };
      const { state, result } = finalState([box, hole]);
      expect(result.features[1]?.status).toBe('suppressed');
      expect(state.properties?.volume).toBeCloseTo(240_000, 6);
    });

    it('passes the body through sketches and keeps later features cached when a sketch changes', () => {
      const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };
      const sketch: Feature = { id: 'sketch', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [], constraints: [] } };
      const first = finalState([box, sketch, fillet]);
      expect(first.result.features.map((f) => f.status)).toEqual(['ok', 'ok', 'ok']);
      expect(first.state.properties?.volume).toBeCloseTo(roundedBoxVolume(100, 60, 40, 5), 3);

      const edited = { ...sketch, sketch: { entities: [{ id: 'p', type: 'point' as const, x: 3, y: 4 }], constraints: [] } };
      const second = kernel.rebuild(request([box, edited, fillet], { knownMeshKeys: [first.state.meshKey!] })).result;
      expect(second.timings.rebuiltFeatures).toBe(0);
      expect(second.captures[0]?.meshKey).toBe(first.state.meshKey);
    });

    it('captures intermediate states', () => {
      const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };
      const { result } = kernel.rebuild(request([box, fillet], { captures: [-1, 0, 1] }));
      expect(result.captures.map((c) => c.index)).toEqual([-1, 0, 1]);
      expect(result.captures[0]?.meshKey).toBeNull();
      expect(result.captures[1]?.faceCount).toBe(6);
      expect(result.captures[2]?.faceCount).toBe(26);
    });
  });

  describe('feature errors never crash the rebuild', () => {
    it('reports a cut as first feature', () => {
      const { result, state } = finalState([{ ...box, operation: 'cut' }]);
      expect(result.features[0]?.error?.code).toBe('first-must-add');
      expect(state.meshKey).toBeNull();
    });

    it('reports missing and invalid edge selections', () => {
      const noEdges = finalState([box, { id: 'f', type: 'fillet', radius: 2, edges: [] }]).result;
      expect(noEdges.features[1]?.error?.code).toBe('no-edges');
      const missing = finalState([box, { id: 'f', type: 'fillet', radius: 2, edges: [{ kind: 'edge-index', index: 99 }] }]).result;
      expect(missing.features[1]?.error?.code).toBe('edge-missing');
    });

    it('keeps the previous body when a fillet is too large', () => {
      const { result, state } = finalState([box, { id: 'f', type: 'fillet', radius: 50, edges: allEdges }]);
      expect(result.features[1]?.status).toBe('error');
      expect(result.features[1]?.error?.code).toBe('operation-failed');
      expect(state.properties?.volume).toBeCloseTo(240_000, 6);
    });

    it('reports a cut that removes everything', () => {
      const big: BoxFeature = { ...box, id: 'big', operation: 'cut', width: 200, depth: 200, height: 200, position: [0, 0, -50] };
      const { result } = finalState([box, big]);
      expect(result.features[1]?.error?.code).toBe('empty-result');
    });
  });

  describe('export', () => {
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 5, edges: allEdges };

    it('writes STEP that reads back with the same volume', () => {
      const bytes = kernel.exportModel({ features: [box, fillet], format: 'step' });
      expect(new TextDecoder().decode(bytes.slice(0, 13))).toBe('ISO-10303-21;');
      const shape = kernel.backend.importStep(bytes);
      try {
        expect(kernel.backend.massProperties(shape).volume).toBeCloseTo(roundedBoxVolume(100, 60, 40, 5), 1);
      } finally {
        kernel.backend.release(shape);
      }
    });

    it('writes a consistent binary STL', () => {
      const bytes = kernel.exportModel({ features: [box, fillet], format: 'stl' });
      const triangles = new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);
      expect(triangles).toBeGreaterThan(1000);
      expect(bytes.length).toBe(84 + 50 * triangles);
    });

    it('refuses to export an empty document', () => {
      expect(() => kernel.exportModel({ features: [], format: 'step' })).toThrow();
    });
  });

  describe('memory', () => {
    // WebAssembly memory never shrinks, so steady growth over many rebuilds means a leak.
    // Growth happens in large steps; the budget allows one step but not a trend.
    const budget = 8 * 1024 * 1024;

    function growth(runs: number, features: (i: number) => Feature[]): number {
      for (let i = 0; i < 20; i++) kernel.rebuild(request(features(i)));
      const before = kernel.memoryStats().wasmHeapBytes;
      for (let i = 0; i < runs; i++) kernel.rebuild(request(features(i)));
      return kernel.memoryStats().wasmHeapBytes - before;
    }

    it('does not leak in boolean operations', () => {
      const hole = (i: number): CylinderFeature => ({ id: 'hole', type: 'cylinder', operation: 'cut', radius: 5 + (i % 7), height: 60, axis: 'z', position: [20, 0, -10] });
      expect(growth(300, (i) => [box, hole(i)])).toBeLessThanOrEqual(budget);
    });

    it('does not leak in fillets, meshing and mass properties', () => {
      // The prebuilt replicad build keeps roughly 100–250 KB per fillet rebuild (ADR 0001, issue 6);
      // for it this is a ceiling that fails if the leak gets worse. ParaWerk's own kernel must not leak.
      const fillet = (i: number): FilletFeature => ({ id: 'fillet', type: 'fillet', radius: 2 + (i % 5) * 0.5, edges: allEdges });
      const limit = backendName === 'replicad' ? 64 * 1024 * 1024 : budget;
      expect(growth(backendName === 'replicad' ? 150 : 400, (i) => [box, fillet(i)])).toBeLessThanOrEqual(limit);
    });
  });

  describe('display edges', () => {
    it('hides the seam edge of a cylinder but keeps edge indices stable', () => {
      const cylinder: CylinderFeature = { id: 'c', type: 'cylinder', operation: 'add', radius: 10, height: 20, axis: 'z', position: [0, 0, 0] };
      const { state } = finalState([cylinder]);
      // A cylinder has 3 edges: two circles and one seam.
      expect(state.edgeCount).toBe(3);
      const ranges = state.mesh!.edgeRanges;
      const counts = Array.from({ length: ranges.length / 2 }, (_, i) => ranges[i * 2 + 1]);
      expect(counts.filter((count) => count === 0)).toHaveLength(1);
    });
  });

  describe('exact face and edge geometry', () => {
    it('describes a cylinder with exact planes, circles and radius', () => {
      const cylinder: CylinderFeature = { id: 'c', type: 'cylinder', operation: 'add', radius: 20, height: 30, axis: 'z', position: [0, 0, 0] };
      const mesh = finalState([cylinder]).state.mesh!;
      const kinds = mesh.faceInfo.map((f) => f.kind).sort();
      expect(kinds).toEqual(['cylinder', 'plane', 'plane']);
      const lateral = mesh.faceInfo.find((f) => f.kind === 'cylinder')!;
      expect(lateral.radius).toBeCloseTo(20, 9);
      expect(lateral.area).toBeCloseTo(2 * Math.PI * 20 * 30, 6);
      for (const cap of mesh.faceInfo.filter((f) => f.kind === 'plane')) expect(cap.area).toBeCloseTo(Math.PI * 400, 6);
      const circles = mesh.edgeInfo.filter((e) => e.kind === 'circle');
      expect(circles).toHaveLength(2);
      for (const circle of circles) {
        expect(circle.radius).toBeCloseTo(20, 9);
        expect(circle.length).toBeCloseTo(2 * Math.PI * 20, 6);
      }
    });

    it('describes box faces as planes and edges as lines with exact lengths', () => {
      const mesh = finalState([box]).state.mesh!;
      expect(mesh.faceInfo.every((f) => f.kind === 'plane')).toBe(true);
      expect(mesh.edgeInfo.map((e) => Math.round(e.length)).sort((a, b) => a - b)).toEqual([40, 40, 40, 40, 60, 60, 60, 60, 100, 100, 100, 100]);
    });

    it.runIf(backendName === 'parawerk')('gives planar faces their exact plane with the normal pointing out of the material', () => {
      const hole: CylinderFeature = { id: 'h', type: 'cylinder', operation: 'cut', radius: 10, height: 40, axis: 'z', position: [0, 0, 20] };
      const mesh = finalState([box, hole]).state.mesh!;
      const planes = mesh.faceInfo.flatMap((f) => (f.plane ? [f.plane] : []));
      expect(planes).toHaveLength(mesh.faceInfo.filter((f) => f.kind === 'plane').length);
      expect(mesh.faceInfo.find((f) => f.kind === 'cylinder')?.plane).toBeUndefined();
      // Normal and signed distance from the origin of each planar face.
      const describe = planes.map(({ point, normal }) => [...normal.map((v) => Math.round(v) + 0), Math.round(point[0] * normal[0] + point[1] * normal[1] + point[2] * normal[2])].join(' '));
      expect(describe.sort()).toEqual(['-1 0 0 50', '0 -1 0 30', '0 0 -1 0', '0 0 1 20', '0 0 1 40', '0 1 0 30', '1 0 0 50'].sort());
      for (const { normal } of planes) expect(Math.hypot(...normal)).toBeCloseTo(1, 12);
    });
  });
});

describe('extrude from sketches (parawerk backend)', () => {
  let kernel: Kernel;

  beforeAll(async () => {
    kernel = await createKernel('parawerk');
  });

  afterAll(() => {
    kernel[Symbol.dispose]();
  });

  const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
  const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
  const rectangle = (x0: number, y0: number, x1: number, y1: number): SketchEntity[] => [
    P('r1', x0, y0), P('r2', x1, y0), P('r3', x1, y1), P('r4', x0, y1),
    L('ra', 'r1', 'r2'), L('rb', 'r2', 'r3'), L('rc', 'r3', 'r4'), L('rd', 'r4', 'r1'),
  ];
  const sketchFeature = (id: string, entities: SketchEntity[], plane: SketchFeature['plane'] = { kind: 'standard', plane: 'top' }): SketchFeature => ({
    id, type: 'sketch', plane, sketch: { entities, constraints: [] },
  });
  const extrude = (overrides: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({ id: 'extrude', type: 'extrude', operation: 'add', sketch: 'sketch', depth: 10, direction: 'normal', ...overrides });

  function build(features: Feature[]) {
    const { result } = kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true });
    const state = result.captures[0];
    if (!state) throw new Error('no capture');
    return { result, state };
  }

  it('extrudes a plate with a hole to the exact volume', () => {
    const plate = sketchFeature('sketch', [...rectangle(-20, -10, 20, 10), P('c', 0, 0), { id: 'hole', type: 'circle', center: 'c', radius: 5 }]);
    const { state, result } = build([plate, extrude()]);
    expect(result.features[1]?.status).toBe('ok');
    expect(state.properties?.volume).toBeCloseTo((800 - 25 * Math.PI) * 10, 4);
    expect(state.properties?.bboxMin[2]).toBeCloseTo(0, 6);
    expect(state.properties?.bboxMax[2]).toBeCloseTo(10, 6);
    // Outer sides, the hole wall, top and bottom.
    expect(state.faceCount).toBe(4 + 1 + 2);
  });

  it('extrudes a slot of lines and arcs backwards and a profile around the mid-plane', () => {
    const slot = sketchFeature('sketch', [
      P('c1', 0, 0), P('c2', 40, 0), P('a', 0, -10), P('b', 40, -10), P('c', 40, 10), P('d', 0, 10),
      L('bottom', 'a', 'b'), L('top', 'c', 'd'),
      { id: 'right', type: 'arc', center: 'c2', start: 'b', end: 'c' },
      { id: 'left', type: 'arc', center: 'c1', start: 'd', end: 'a' },
    ]);
    const reverse = build([slot, extrude({ direction: 'reverse', depth: 5 })]).state;
    expect(reverse.properties?.volume).toBeCloseTo((800 + 100 * Math.PI) * 5, 4);
    expect(reverse.properties?.bboxMin[2]).toBeCloseTo(-5, 6);
    const both = build([slot, extrude({ direction: 'both', depth: 8 })]).state;
    expect(both.properties?.bboxMin[2]).toBeCloseTo(-4, 6);
    expect(both.properties?.bboxMax[2]).toBeCloseTo(4, 6);
  });

  it('extrudes splines exactly and ellipses as holes', () => {
    const fit: [number, number][] = [[0, 0], [20, 15], [40, 5], [60, 0]];
    const wave = sketchFeature('sketch', [
      ...fit.map(([x, y], i) => P(`f${i}`, x, y)),
      { id: 's', type: 'spline', points: ['f0', 'f1', 'f2', 'f3'] },
      P('low', 60, -10), P('origin2', 0, -10), L('down', 'f3', 'low'), L('base', 'low', 'origin2'), L('up', 'origin2', 'f0'),
      P('e', 30, -2), P('ea', 36, -2), P('eb', 30, 1), { id: 'ell', type: 'ellipse', center: 'e', major: 'ea', minor: 'eb' },
    ]);
    const spline = splineThrough(fit);
    if (!spline) throw new Error('no spline');
    // Area under the spline down to y = -10, from a very fine polygon, minus the ellipse.
    const curve = splinePolyline(spline, 2000);
    let area = 0;
    const polygon: [number, number][] = [...curve.map(([x, y]): [number, number] => [x, y]), [60, -10], [0, -10]];
    for (let i = 0; i < polygon.length; i++) {
      const [a, b] = [polygon[i] as [number, number], polygon[(i + 1) % polygon.length] as [number, number]];
      area += (a[0] * b[1] - b[0] * a[1]) / 2;
    }
    area = Math.abs(area) - Math.PI * 6 * 3;
    const { state, result } = build([wave, extrude({ depth: 4 })]);
    expect(result.features[1]?.status).toBe('ok');
    expect((state.properties?.volume as number) / (area * 4)).toBeCloseTo(1, 6);
    // The spline stays one smooth face (not one face per span).
    expect(state.faceCount).toBe(4 + 1 + 2);
  });

  it('cuts into a body from a sketch on its top face, and follows sketch edits', () => {
    const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
    const onTop = (radius: number) =>
      sketchFeature('sketch', [P('c', 10, 0), { id: 'hole', type: 'circle', center: 'c', radius }], { kind: 'face', face: 5, frame: frameOnPlane([0, 0, 40], [0, 0, 1]) });
    const cut = extrude({ operation: 'cut', direction: 'reverse', depth: 25 });
    expect(build([box, onTop(10), cut]).state.properties?.volume).toBeCloseTo(240_000 - Math.PI * 100 * 25, 4);
    // Changing the sketch rebuilds the cut.
    expect(build([box, onTop(5), cut]).state.properties?.volume).toBeCloseTo(240_000 - Math.PI * 25 * 25, 4);
  });

  it('explains missing sketches, crossing curves and sketches without outlines', () => {
    const errorOf = (features: Feature[]) => kernel.rebuild({ features, captures: [], knownMeshKeys: [], withProperties: false }).result.features.at(-1)?.error?.code;
    expect(errorOf([extrude({ sketch: 'nowhere' })])).toBe('sketch-missing');
    const crossing = sketchFeature('sketch', [...rectangle(0, 0, 20, 20), P('x1', 10, -5), P('x2', 10, 25), L('x', 'x1', 'x2')]);
    expect(errorOf([crossing, extrude()])).toBe('profile-crossing');
    expect(errorOf([sketchFeature('sketch', [P('a', 0, 0), P('b', 10, 0), L('l', 'a', 'b')]), extrude()])).toBe('profile-empty');
  });
});
