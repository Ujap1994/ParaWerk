/** STEP import as a feature: a body of its own or a cut, with named faces that later features use. */
import { strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import { hashString } from '../../src/shared/hash.ts';
import type { BoxFeature, CylinderFeature, Feature, FilletFeature, ImportFeature } from '../../src/shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf } from '../../src/shared/model/naming.ts';

let kernel: Kernel;
let step: string;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
  const box: BoxFeature = { id: 'source', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
  step = strFromU8(kernel.exportModel({ features: [box], format: 'step' }));
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const imported = (operation: ImportFeature['operation'] = 'add', id = 'imp'): ImportFeature => ({ id, type: 'import', operation, file: 'box.step', hash: hashString(step), data: step });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

describe('STEP import', () => {
  it('makes a body from the solids of the file, with faces named after the feature', () => {
    const result = build([imported()]);
    expect(result.features[0]?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(240_000, 3);
    const naming = result.captures[0]?.mesh?.naming;
    expect(naming?.faces).toHaveLength(6);
    expect(naming?.faces.every((name) => /^imp:f\d$/.test(name))).toBe(true);
  });

  it('cuts an imported body out of the part and rounds an edge between imported faces', () => {
    const block: BoxFeature = { id: 'block', type: 'box', operation: 'add', width: 200, depth: 100, height: 20, position: [0, 0, 30] };
    expect(build([block, imported('cut')]).captures[0]?.properties?.volume).toBeCloseTo(200 * 100 * 20 - 100 * 60 * 10, 3);
    const naming = build([imported()]).captures[0]?.mesh?.naming;
    if (!naming) throw new Error('no body');
    const edge = Array.from({ length: naming.edgeFaces.length / 2 }, (_, e) => e).find((e) => edgeFaceNames(naming, e).every((name) => name.startsWith('imp:')));
    const ref = edge === undefined ? null : edgeRefOf(naming, edge);
    if (!ref) throw new Error('no edge');
    const fillet: FilletFeature = { id: 'round', type: 'fillet', radius: 3, edges: [ref] };
    const bore: CylinderFeature = { id: 'bore', type: 'cylinder', operation: 'cut', radius: 5, height: 60, axis: 'z', position: [20, 0, -10] };
    const result = build([imported(), bore, fillet]);
    expect(result.features.map((feature) => feature.status)).toEqual(['ok', 'ok', 'ok']);
    expect(result.features[2]?.healedEdges).toBeUndefined();
  });

  it('reports a file that is not STEP, and is cached by its hash', () => {
    const broken = { ...imported(), data: 'not a step file', hash: 'x' };
    expect(build([broken]).features[0]?.error?.code).toBe('operation-failed');
    // The same file again rebuilds nothing.
    build([imported()]);
    expect(kernel.rebuild({ features: [imported()], captures: [0], knownMeshKeys: [], withProperties: false }).result.timings.rebuiltFeatures).toBe(0);
  });
});
