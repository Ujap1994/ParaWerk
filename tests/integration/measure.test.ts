/** Measuring faces, edges and vertices of a body: distances, angles, centers. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { MeasureTarget } from '../../src/kernel/measure.ts';
import type { BoxFeature, CylinderFeature, Feature } from '../../src/shared/model/feature.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const bore = (id: string, x: number, radius: number): CylinderFeature => ({ id, type: 'cylinder', operation: 'cut', radius, height: 60, axis: 'z', position: [x, 0, -10] });
const part: Feature[] = [box, bore('left', -30, 5), bore('right', 25, 8)];

function naming() {
  const mesh = kernel.rebuild({ features: part, captures: [part.length - 1], knownMeshKeys: [], withProperties: false }).result.captures[0]?.mesh;
  if (!mesh) throw new Error('no body');
  return mesh.naming;
}

function face(name: string): MeasureTarget {
  const index = naming().faces.indexOf(name);
  if (index < 0) throw new Error(`no face ${name}`);
  return { kind: 'face', index };
}

/** The edge between two named faces. */
function edge(a: string, b: string): MeasureTarget {
  const names = naming();
  const faces = [names.faces.indexOf(a), names.faces.indexOf(b)].sort((x, y) => x - y);
  for (let e = 0; e < names.edgeFaces.length / 2; e++) {
    const pair = [names.edgeFaces[2 * e], names.edgeFaces[2 * e + 1]].sort((x, y) => (x ?? 0) - (y ?? 0));
    if (pair[0] === faces[0] && pair[1] === faces[1]) return { kind: 'edge', index: e };
  }
  throw new Error(`no edge between ${a} and ${b}`);
}

/** The vertex nearest to a point. */
function vertex(x: number, y: number, z: number): MeasureTarget {
  const p = naming().vertexPositions;
  let best = 0;
  for (let v = 1; v < p.length / 3; v++) {
    const d = Math.hypot((p[3 * v] ?? 0) - x, (p[3 * v + 1] ?? 0) - y, (p[3 * v + 2] ?? 0) - z);
    const b = Math.hypot((p[3 * best] ?? 0) - x, (p[3 * best + 1] ?? 0) - y, (p[3 * best + 2] ?? 0) - z);
    if (d < b) best = v;
  }
  return { kind: 'vertex', index: best };
}

const measure = (...targets: MeasureTarget[]) => kernel.measure({ features: part, targets });

describe('measure', () => {
  it('describes one face, edge or vertex', () => {
    const top = measure(face('box:top'));
    expect(top.entities[0]).toMatchObject({ kind: 'face', geometry: { kind: 'plane' } });
    expect(top.entities[0]?.kind === 'face' && top.entities[0].geometry.area).toBeCloseTo(6000 - Math.PI * (25 + 64), 6);
    const rim = measure(edge('box:top', 'right:side'));
    expect(rim.entities[0]).toMatchObject({ kind: 'edge', geometry: { kind: 'circle', radius: 8 } });
    expect(measure(vertex(50, 30, 40)).entities[0]).toEqual({ kind: 'vertex', position: [50, 30, 40] });
    expect(top.distance).toBeUndefined();
  });

  it('measures parallel faces, perpendicular faces and an edge against a face', () => {
    const across = measure(face('box:left'), face('box:right'));
    expect(across.distance?.value).toBeCloseTo(100, 9);
    expect(across.normalDistance).toBeCloseTo(100, 9);
    expect(across.angle).toBeCloseTo(0, 9);
    const corner = measure(face('box:left'), face('box:top'));
    expect(corner.distance?.value).toBeCloseTo(0, 9);
    expect(corner.angle).toBeCloseTo(90, 9);
    expect(corner.normalDistance).toBeUndefined();
    // A vertical edge stands at 90° to the top face.
    expect(measure(edge('box:front', 'box:left'), face('box:top')).angle).toBeCloseTo(90, 9);
  });

  it('measures the distance of bore axes and of circle centers, and from a vertex to an axis', () => {
    const bores = measure(face('left:side'), face('right:side'));
    expect(bores.centerDistance?.value).toBeCloseTo(55, 9);
    // The walls of the bores are 55 − 5 − 8 = 42 mm apart.
    expect(bores.distance?.value).toBeCloseTo(42, 6);
    const rims = measure(edge('box:top', 'left:side'), edge('box:top', 'right:side'));
    expect(rims.centerDistance).toMatchObject({ value: expect.closeTo(55, 9), from: [-30, 0, 40], to: [25, 0, 40] });
    const corner = measure(vertex(50, 30, 40), face('right:side'));
    expect(corner.centerDistance?.value).toBeCloseTo(Math.hypot(25, 30), 9);
    // Between two vertices only the distance is given.
    const diagonal = measure(vertex(-50, -30, 0), vertex(50, 30, 40));
    expect(diagonal.distance?.value).toBeCloseTo(Math.hypot(100, 60, 40), 9);
    expect(diagonal.centerDistance).toBeUndefined();
  });
});
