/** Fillets and chamfers on faces: all edges of the faces, also edges they get later. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CylinderFeature, EdgeRef, Feature, FilletFeature } from '../../src/shared/model/feature.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

/** 100 × 60 × 40 on the top plane. */
const box: BoxFeature = { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const top = { kind: 'face' as const, name: 'b:top', at: [0, 0, 40] as [number, number, number] };
const topEdges: EdgeRef[] = [
  { kind: 'edge', faces: ['b:front', 'b:top'], at: [0, -30, 40] },
  { kind: 'edge', faces: ['b:right', 'b:top'], at: [50, 0, 40] },
  { kind: 'edge', faces: ['b:back', 'b:top'], at: [0, 30, 40] },
  { kind: 'edge', faces: ['b:left', 'b:top'], at: [-50, 0, 40] },
];
const fillet = (more: Partial<FilletFeature>): FilletFeature => ({ id: 'f', type: 'fillet', radius: 4, edges: [], ...more });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

const volumeOf = (features: Feature[]) => build(features).captures[0]?.properties?.volume ?? NaN;

describe('fillets on faces', () => {
  it('round every edge of a face', () => {
    const byFace = volumeOf([box, fillet({ faces: [top] })]);
    expect(byFace).toBeCloseTo(volumeOf([box, fillet({ edges: topEdges })]), 6);
    expect(byFace).toBeLessThan(240_000);
  });

  it('take edges the face gets later, but not the seams of curved faces', () => {
    // A bore cut into the top face before the fillet: its rim is rounded too.
    const bore: CylinderFeature = { id: 'h', type: 'cylinder', operation: 'cut', radius: 10, height: 60, axis: 'z', position: [0, 0, -10] };
    const result = build([box, bore, fillet({ faces: [top] })]);
    expect(result.features.at(-1)?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeLessThan(volumeOf([box, bore, fillet({ edges: topEdges })]) - 1);
    // The side of a cylinder: its top and bottom circles, not its seam.
    const post: CylinderFeature = { id: 'p', type: 'cylinder', operation: 'add', radius: 10, height: 30, axis: 'z', position: [0, 0, 40] };
    const side = { kind: 'face' as const, name: 'p:side', at: [10, 0, 55] as [number, number, number] };
    expect(build([box, post, fillet({ radius: 2, faces: [side] })]).features.at(-1)?.status).toBe('ok');
  });

  it('chamfer the edges of faces as well and warn about faces that are gone', () => {
    const chamfered = build([box, { id: 'c', type: 'chamfer', distance: 2, edges: [], faces: [top] }]);
    // Each edge loses a prism of d²/2 per length; at the four corners two of them overlap by d³/3.
    expect(chamfered.captures[0]?.properties?.volume).toBeCloseTo(240_000 - 2 * 320 + 4 * (8 / 3), 6);
    // Not a face of this body, by name or by place.
    const gone = { kind: 'face' as const, name: 'x:top', at: [0, 0, 500] as [number, number, number] };
    const partly = build([box, fillet({ faces: [top, gone] })]).features.at(-1);
    expect(partly).toMatchObject({ status: 'ok', warning: { code: 'edge-missing', detail: '1' } });
    expect(build([box, fillet({ faces: [gone] })]).features.at(-1)?.error?.code).toBe('edge-missing');
  });
});

describe('variable radius fillets', () => {
  const edge: EdgeRef[] = [{ kind: 'edge', faces: ['b:front', 'b:top'], at: [0, -30, 40] }];
  it('changes the radius evenly along the edge', () => {
    // From 2 at the left end (x = −50) to 6 at the right end: cross sections r²(1 − π/4) across the edge
    // integrate to L(r1² + r1·r2 + r2²)/3; the round leans slightly where its radius changes, so a little more goes.
    const variable = volumeOf([box, fillet({ edges: edge, method: 'variable', radius: 2, radius2: 6 })]);
    const estimate = (1 - Math.PI / 4) * ((100 * (4 + 12 + 36)) / 3);
    expect(Math.abs(240_000 - variable - estimate) / estimate).toBeLessThan(0.03);
    // Equal radii give the constant fillet; swapping the ends mirrors the round.
    expect(volumeOf([box, fillet({ edges: edge, method: 'variable', radius: 4, radius2: 4 })])).toBeCloseTo(volumeOf([box, fillet({ edges: edge })]), 4);
    const swapped = build([box, fillet({ edges: edge, method: 'variable', radius: 2, radius2: 6, swap: true })]);
    expect(swapped.captures[0]?.properties?.volume).toBeCloseTo(variable, 3);
    // The larger end is now on the left: the center of mass moves to the right.
    const plain = build([box, fillet({ edges: edge, method: 'variable', radius: 2, radius2: 6 })]);
    expect(swapped.captures[0]?.properties?.center[0] ?? NaN).toBeGreaterThan(plain.captures[0]?.properties?.center[0] ?? NaN);
    // Whichever way an edge runs, the start is its left end: more goes on the right, the center moves left.
    for (const faces of [['b:front', 'b:top'], ['b:back', 'b:top'], ['b:bottom', 'b:front'], ['b:back', 'b:bottom']] as const) {
      const names: readonly string[] = faces;
      const at: [number, number, number] = [0, names.includes('b:back') ? 30 : -30, names.includes('b:top') ? 40 : 0];
      const result = build([box, fillet({ edges: [{ kind: 'edge', faces: [...faces], at }], method: 'variable', radius: 2, radius2: 6 })]);
      expect(result.captures[0]?.properties?.center[0], faces.join(' ')).toBeLessThan(0);
    }
  });
});
