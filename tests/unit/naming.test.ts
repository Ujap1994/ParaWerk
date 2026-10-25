import { describe, expect, it } from 'vitest';
import type { EdgeNameRef } from '../../src/shared/model/feature.ts';
import { anonymousNaming, edgeFaceNames, edgeRefOf, resolveEdgeRefs, type BodyNaming } from '../../src/shared/model/naming.ts';
import { formatVersionOf } from '../../src/shared/model/part-file.ts';
import { parseFeatures, ValidationError } from '../../src/shared/model/validate.ts';

/** A body from a list of edges: the names of the faces on both sides and the middle of the edge. */
function body(edges: [string, string, [number, number, number]][]): BodyNaming {
  const faces = [...new Set(edges.flatMap(([a, b]) => [a, b]))];
  return {
    faces,
    facePlanes: new Float64Array(6 * faces.length).fill(NaN),
    edgeFaces: Int32Array.from(edges.flatMap(([a, b]) => [faces.indexOf(a), faces.indexOf(b)])),
    edgeMidpoints: Float64Array.from(edges.flatMap(([, , at]) => at)),
    edgeVertices: new Int32Array(2 * edges.length).fill(-1),
    vertexPositions: new Float64Array(0),
    vertexFaceOffsets: new Int32Array(1),
    vertexFaces: new Int32Array(0),
  };
}

const ref = (a: string, b: string, at: [number, number, number]): EdgeNameRef => ({ kind: 'edge', faces: [a, b].sort() as [string, string], at });

describe('edge references', () => {
  const plate = body([
    ['b:top', 'b:front', [0, -30, 40]],
    ['b:top', 'b:back', [0, 30, 40]],
    ['b:front', 'b:left', [-50, -30, 20]],
    ['b:top', 'h:side', [-8, 0, 40]],
    ['b:top', 'h:side', [8, 0, 40]],
  ]);

  it('makes sorted references from edges', () => {
    expect(edgeRefOf(plate, 0)).toEqual({ kind: 'edge', faces: ['b:front', 'b:top'], at: [0, -30, 40] });
    expect(edgeFaceNames(plate, 3)).toEqual(['b:top', 'h:side']);
    expect(edgeRefOf(plate, 9)).toBeNull();
    expect(edgeRefOf(anonymousNaming(1, 2), 0)).toBeNull();
  });

  it('finds edges by the names of their faces, wherever they moved', () => {
    expect(resolveEdgeRefs([ref('b:front', 'b:top', [0, -10, 90])], plate)).toEqual([{ index: 0, kind: 'name' }]);
  });

  it('decides between edges with the same faces by position', () => {
    expect(resolveEdgeRefs([ref('b:top', 'h:side', [7, 1, 40]), ref('b:top', 'h:side', [-7, 1, 40])], plate).map((m) => m?.index)).toEqual([4, 3]);
  });

  it('reports an edge whose faces still exist but no longer meet', () => {
    expect(resolveEdgeRefs([ref('b:back', 'b:left', [-50, 30, 20])], plate)).toEqual([null]);
  });

  it('finds an edge nearby when one of its faces was renamed', () => {
    expect(resolveEdgeRefs([ref('b:top', 'old:side', [0, -29, 40])], plate)).toEqual([{ index: 0, kind: 'position' }]);
    // Too far away to be the same edge.
    expect(resolveEdgeRefs([ref('b:top', 'old:side', [0, -10, 40])], plate)).toEqual([null]);
  });

  it('finds an edge in the same place when both faces were renamed', () => {
    expect(resolveEdgeRefs([ref('x:a', 'x:b', [-50, -30, 20])], plate)).toEqual([{ index: 2, kind: 'position' }]);
    expect(resolveEdgeRefs([ref('x:a', 'x:b', [-50, -29, 20])], plate)).toEqual([null]);
  });

  it('resolves edge indices of older files by range', () => {
    expect(resolveEdgeRefs([{ kind: 'edge-index', index: 4 }, { kind: 'edge-index', index: 5 }], plate)).toEqual([{ index: 4, kind: 'index' }, null]);
  });
});

describe('edge references in files', () => {
  const fillet = (edges: unknown) => [{ id: 'b', type: 'box', operation: 'add', width: 1, depth: 1, height: 1, position: [0, 0, 0] }, { id: 'f', type: 'fillet', radius: 0.1, edges }];

  it('reads named references and sorts their faces', () => {
    const [, parsed] = parseFeatures(fillet([{ kind: 'edge', faces: ['b:top', 'b:front'], at: [0, -0.5, 1] }]));
    expect(parsed).toMatchObject({ edges: [{ kind: 'edge', faces: ['b:front', 'b:top'], at: [0, -0.5, 1] }] });
    expect(formatVersionOf(parseFeatures(fillet([{ kind: 'edge', faces: ['a', 'b'], at: [0, 0, 0] }])))).toBe(5);
    expect(formatVersionOf(parseFeatures(fillet([{ kind: 'edge-index', index: 0 }])))).toBe(1);
  });

  it('rejects damaged references', () => {
    expect(() => parseFeatures(fillet([{ kind: 'edge', faces: ['a'], at: [0, 0, 0] }]))).toThrow(ValidationError);
    expect(() => parseFeatures(fillet([{ kind: 'edge', faces: ['a', 7], at: [0, 0, 0] }]))).toThrow(ValidationError);
    expect(() => parseFeatures(fillet([{ kind: 'edge', faces: ['a', 'x'.repeat(300)], at: [0, 0, 0] }]))).toThrow(ValidationError);
    expect(() => parseFeatures(fillet([{ kind: 'edge', faces: ['a', 'b'], at: [0, 0] }]))).toThrow(ValidationError);
  });
});

describe('reference features in files', () => {
  const plane = (overrides: object = {}) => [{ id: 'p', type: 'plane', method: 'offset', references: [{ kind: 'standard-plane', plane: 'top' }], distance: 10, angle: 45, flip: false, ...overrides }];

  it('reads planes, axes and points with their references', () => {
    const features = parseFeatures([
      ...plane(),
      { id: 'a', type: 'axis', method: 'twoPoints', references: [{ kind: 'origin' }, { kind: 'vertex', faces: ['b:top', 'b:front', 'b:left'], at: [1, 2, 3] }] },
      { id: 'q', type: 'point', method: 'center', references: [{ kind: 'face', name: 'b:top', at: [0, 0, 1] }], x: 0, y: 0, z: 0 },
      { id: 's', type: 'sketch', plane: { kind: 'feature', feature: 'p', frame: { origin: [0, 0, 10], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } }, sketch: { entities: [], constraints: [] } },
    ]);
    expect(features[1]).toMatchObject({ references: [{ kind: 'origin' }, { kind: 'vertex', faces: ['b:front', 'b:left', 'b:top'] }] });
    expect(features[3]).toMatchObject({ plane: { kind: 'feature', feature: 'p' } });
    expect(formatVersionOf(features)).toBe(6);
  });

  it('rejects unknown methods, too many references and damaged ones', () => {
    expect(() => parseFeatures(plane({ method: 'tangent' }))).toThrow(ValidationError);
    expect(() => parseFeatures(plane({ references: Array.from({ length: 4 }, () => ({ kind: 'origin' })) }))).toThrow(ValidationError);
    expect(() => parseFeatures(plane({ references: [{ kind: 'face', name: 'x', at: [0, 0] }] }))).toThrow(ValidationError);
    expect(() => parseFeatures(plane({ references: [{ kind: 'standard-plane', plane: 'side' }] }))).toThrow(ValidationError);
    expect(() => parseFeatures(plane({ angle: 400 }))).toThrow(ValidationError);
  });
});
