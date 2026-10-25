/** Shells: bodies hollowed out to walls of a thickness, open at chosen faces. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, Feature, FilletFeature, ShellFeature } from '../../src/shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf } from '../../src/shared/model/naming.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const bottom = { kind: 'face' as const, name: 'box:bottom', at: [10, 10, 0] as [number, number, number] };
const top = { kind: 'face' as const, name: 'box:top', at: [10, 10, 40] as [number, number, number] };
const shell = (overrides: Partial<ShellFeature> = {}): ShellFeature => ({ id: 'shell', type: 'shell', thickness: 2, faces: [bottom], outward: false, ...overrides });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

describe('shell', () => {
  it('hollows a box out, open at the bottom', () => {
    const result = build([box, shell()]);
    expect(result.features[1]?.status).toBe('ok');
    expect(result.captures[0]?.properties?.volume).toBeCloseTo(240_000 - 96 * 56 * 38, 3);
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['box:top', 'shell:box:top', 'shell:box:left']));
  });

  it('leaves two faces open, makes a closed cavity, or grows the walls outwards', () => {
    expect(build([box, shell({ faces: [bottom, top] })]).captures[0]?.properties?.volume).toBeCloseTo(240_000 - 96 * 56 * 40, 3);
    expect(build([box, shell({ faces: [] })]).captures[0]?.properties?.volume).toBeCloseTo(240_000 - 96 * 56 * 36, 3);
    expect(build([box, shell({ outward: true })]).captures[0]?.properties?.volume).toBeCloseTo(104 * 64 * 42 - 240_000, 3);
  });

  it('keeps the open face when the box changes, and warns about a face that is gone', () => {
    expect(build([{ ...box, height: 60 }, shell()]).captures[0]?.properties?.volume).toBeCloseTo(100 * 60 * 60 - 96 * 56 * 58, 3);
    const gone = { kind: 'face' as const, name: 'other:top', at: [0, 0, 99] as [number, number, number] };
    expect(build([box, shell({ faces: [bottom, gone] })]).features[1]).toMatchObject({ status: 'ok', warning: { code: 'shell-face-missing', detail: '1' } });
    expect(build([box, shell({ faces: [gone] })]).features[1]?.error?.code).toBe('shell-face-missing');
    expect(build([shell()]).features[0]?.error?.code).toBe('no-body');
    expect(build([box, shell({ thickness: 40 })]).features[1]?.status).toBe('error');
  });

  it('keeps a fillet on an inside edge of the shell', () => {
    const naming = build([box, shell()]).captures[0]?.mesh?.naming;
    if (!naming) throw new Error('no body');
    const inside = Array.from({ length: naming.edgeFaces.length / 2 }, (_, e) => e).find((e) => edgeFaceNames(naming, e).join('|') === 'shell:box:front|shell:box:top');
    const ref = inside === undefined ? null : edgeRefOf(naming, inside);
    if (!ref) throw new Error('no inside edge');
    const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 1, edges: [ref] };
    for (const thickness of [2, 3, 5]) {
      expect(build([box, shell({ thickness }), fillet]).features.map((feature) => feature.status)).toEqual(['ok', 'ok', 'ok']);
    }
  });
});
