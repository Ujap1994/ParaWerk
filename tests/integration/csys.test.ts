/** Coordinate systems: where they lie, and exports written in them. */
import { strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CsysFeature, Feature } from '../../src/shared/model/feature.ts';
import { frameTransform, type Frame } from '../../src/shared/model/frame.ts';
import { hashString } from '../../src/shared/hash.ts';
import type { GeometryRef } from '../../src/shared/model/reference.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

/** 100 × 60 × 40 on the top plane (x −50…50, y −30…30, z 0…40). */
const box: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const csys = (more: Partial<CsysFeature>): CsysFeature => ({ id: 'c', type: 'csys', method: 'position', references: [], x: 0, y: 0, z: 0, angle: 0, flipX: false, flipY: false, ...more });

function frameOf(features: Feature[]): Frame {
  const result = kernel.rebuild({ features, captures: [], knownMeshKeys: [], withProperties: false }).result;
  const geometry = result.features.find((feature) => feature.id === 'c')?.reference;
  if (geometry?.kind !== 'csys') throw new Error(`no coordinate system: ${JSON.stringify(result.features.at(-1))}`);
  return geometry;
}

const close = (actual: readonly number[], expected: readonly number[], digits = 9) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i] ?? NaN, digits));

/** The extent of a binary STL's vertices: [min, max]. */
function stlBounds(bytes: Uint8Array): [number[], number[]] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const [min, max] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (let t = 0; t < count; t++) {
    for (let v = 0; v < 3; v++) {
      for (let k = 0; k < 3; k++) {
        const value = view.getFloat32(84 + 50 * t + 12 + 12 * v + 4 * k, true);
        min[k] = Math.min(min[k] as number, value);
        max[k] = Math.max(max[k] as number, value);
      }
    }
  }
  return [min, max];
}

describe('coordinate systems', () => {
  it('lie at a position, turned around Z', () => {
    const frame = frameOf([csys({ x: 10, y: 20, z: 30, angle: 90 })]);
    close(frame.origin, [10, 20, 30]);
    close(frame.xDir, [0, 1, 0]);
    close(frame.yDir, [-1, 0, 0]);
    close(frame.zDir, [0, 0, 1]);
    // Flipping X turns Z over as well: the axes stay right-handed.
    close(frameOf([csys({ flipX: true })]).zDir, [0, 0, -1]);
  });

  it('take their origin from a vertex and their axes from edges', () => {
    // At the top front left corner, X along the front top edge, Y towards the back.
    const corner: GeometryRef = { kind: 'vertex', faces: ['b:front', 'b:left', 'b:top'], at: [-50, -30, 40] };
    const front: GeometryRef = { kind: 'edge', faces: ['b:front', 'b:top'], at: [0, -30, 40] };
    const left: GeometryRef = { kind: 'edge', faces: ['b:left', 'b:top'], at: [-50, 0, 40] };
    const frame = frameOf([box, csys({ method: 'references', references: [corner, front, left] })]);
    close(frame.origin, [-50, -30, 40]);
    close(frame.xDir.map(Math.abs), [1, 0, 0]);
    close(frame.yDir.map(Math.abs), [0, 1, 0]);
    close(frame.zDir, [frame.xDir[1] * frame.yDir[2] - frame.xDir[2] * frame.yDir[1], frame.xDir[2] * frame.yDir[0] - frame.xDir[0] * frame.yDir[2], frame.xDir[0] * frame.yDir[1] - frame.xDir[1] * frame.yDir[0]]);
    // Two parallel directions do not make a coordinate system.
    const result = kernel.rebuild({ features: [box, csys({ method: 'references', references: [corner, front, front] })], captures: [], knownMeshKeys: [], withProperties: false }).result;
    expect(result.features[1]?.error?.code).toBe('reference-parallel');
  });

  it('export STL and STEP in their coordinates', () => {
    // On the top face, turned by 90°: the box lies below it, with its long side along Y.
    const frame = frameOf([box, csys({ z: 40, angle: 90 })]);
    const features = [box, csys({ z: 40, angle: 90 })];
    const [min, max] = stlBounds(kernel.exportModel({ features, format: 'stl', transform: frameTransform(frame) }));
    // STL stores single-precision floats.
    close(min, [-30, -50, -40], 5);
    close(max, [30, 50, 0], 5);
    // Without a coordinate system, the model's own coordinates.
    const [plainMin] = stlBounds(kernel.exportModel({ features, format: 'stl' }));
    close(plainMin, [-50, -30, 0], 5);
    // STEP: read back as an imported body.
    const step = strFromU8(kernel.exportModel({ features, format: 'step', transform: frameTransform(frame) }));
    const imported: Feature = { id: 'i', type: 'import', operation: 'add', file: 'moved.step', hash: hashString(step), data: step };
    const properties = kernel.rebuild({ features: [imported], captures: [0], knownMeshKeys: [], withProperties: true }).result.captures[0]?.properties;
    // Bounding boxes include the tolerance of the shape (1e-7).
    close(properties?.bboxMin ?? [], [-30, -50, -40], 5);
    close(properties?.bboxMax ?? [], [30, 50, 0], 5);
  });
});
