/** Helices around the circle of a sketch, and springs swept along them. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { Feature, HelixFeature, SketchFeature, SweepFeature } from '../../src/shared/model/feature.ts';
import type { SketchEntity, SketchPlaneRef } from '../../src/shared/model/sketch.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const C = (id: string, center: string, radius: number): SketchEntity => ({ id, type: 'circle', center, radius });
const sketch = (id: string, plane: SketchPlaneRef, ...entities: SketchEntity[]): SketchFeature => ({ id, type: 'sketch', plane, sketch: { entities, constraints: [] } });

function build(features: Feature[]) {
  return kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

// A base circle of radius 10 around the origin on the top plane, and a wire of radius 1 on the front
// plane where the helix starts (on the sketch X axis).
const base = sketch('base', { kind: 'standard', plane: 'top' }, P('o', 0, 0), C('c', 'o', 10));
const wire = sketch('wire', { kind: 'standard', plane: 'front' }, P('m', 10, 0), C('w', 'm', 1));
const helix = (more: Partial<HelixFeature> = {}): HelixFeature => ({ id: 'h', type: 'helix', sketch: 'base', pitch: 5, turns: 3, startAngle: 0, leftHand: false, reverse: false, ...more });
const spring: SweepFeature = { id: 's', type: 'sweep', operation: 'add', sketch: 'wire', path: 'h' };

/** A profile in a plane through the axis, screwed around it: its area times the way its centroid goes around. */
const springVolume = (area: number, centroidRadius: number, turns: number) => area * 2 * Math.PI * centroidRadius * turns;

describe('helix', () => {
  it('winds around the axis of the circle of its sketch', () => {
    const result = build([base, helix()]);
    const geometry = result.features.at(-1)?.reference;
    expect(geometry?.kind).toBe('helix');
    if (geometry?.kind !== 'helix') return;
    expect(geometry.center).toEqual([0, 0, 0]);
    expect(geometry.radius).toBe(10);
    expect(geometry.axis[2]).toBeCloseTo(1, 9);
    expect(geometry.xDir[0]).toBeCloseTo(1, 9);
    // The start angle turns the start point around the axis; reversed, it winds the other way along it.
    const turned = build([base, helix({ startAngle: 90, reverse: true })]).features.at(-1)?.reference;
    expect(turned?.kind === 'helix' && turned.xDir[1]).toBeCloseTo(1, 9);
    expect(turned?.kind === 'helix' && turned.axis[2]).toBeCloseTo(-1, 9);
  });

  it('needs a circle in its sketch', () => {
    const empty = sketch('base', { kind: 'standard', plane: 'top' }, P('o', 0, 0));
    expect(build([empty, helix()]).features.at(-1)?.error?.code).toBe('helix-circle');
    expect(build([helix()]).features.at(-1)?.error?.code).toBe('sketch-missing');
  });

  it('is the path of a spring', () => {
    const result = build([base, helix(), wire, spring]);
    expect(result.features.at(-1)?.status).toBe('ok');
    const properties = result.captures[0]?.properties;
    expect(properties?.volume).toBeCloseTo(springVolume(Math.PI, 10, 3), -1);
    expect(Math.abs((properties?.volume ?? 0) / springVolume(Math.PI, 10, 3) - 1)).toBeLessThan(1e-3);
    // Whole turns: the center of mass lies on the axis, halfway up.
    expect(properties?.center[0]).toBeCloseTo(0, 1);
    expect(properties?.center[1]).toBeCloseTo(0, 1);
    expect(properties?.center[2]).toBeCloseTo(7.5, 1);
    expect(properties?.bboxMax[2]).toBeCloseTo(16, 1);
    expect(result.captures[0]?.mesh?.naming.faces).toEqual(expect.arrayContaining(['s:side:w', 's:start', 's:end']));
  });

  it('winds right-handed or left-handed, up or down', () => {
    // A quarter turn: right-handed it goes from the X axis towards +Y, left-handed towards −Y.
    const right = build([base, helix({ turns: 0.25 }), wire, spring]).captures[0]?.properties;
    const left = build([base, helix({ turns: 0.25, leftHand: true }), wire, spring]).captures[0]?.properties;
    expect(right?.center[1]).toBeGreaterThan(3);
    expect(left?.center[1]).toBeLessThan(-3);
    expect(left?.volume).toBeCloseTo(right?.volume ?? 0, 1);
    const down = build([base, helix({ reverse: true }), wire, spring]).captures[0]?.properties;
    expect(down?.center[2]).toBeCloseTo(-7.5, 1);
  });

  it('follows changes of the helix', () => {
    const pitch = build([base, helix({ pitch: 4, turns: 5 }), wire, spring]).captures[0]?.properties;
    expect(Math.abs((pitch?.volume ?? 0) / springVolume(Math.PI, 10, 5) - 1)).toBeLessThan(1e-3);
    expect(pitch?.bboxMax[2]).toBeCloseTo(21, 1);
    const wider = sketch('base', { kind: 'standard', plane: 'top' }, P('o', 0, 0), C('c', 'o', 15));
    const far = sketch('wire', { kind: 'standard', plane: 'front' }, P('m', 15, 0), C('w', 'm', 1));
    const radius = build([wider, helix(), far, spring]).captures[0]?.properties;
    expect(Math.abs((radius?.volume ?? 0) / springVolume(Math.PI, 15, 3) - 1)).toBeLessThan(1e-3);
  });

  it('cuts a helical groove into a body', () => {
    // A rod of radius 10 with the wire around its surface: half of each wire section is in the rod.
    const rod = sketch('rod', { kind: 'standard', plane: 'top' }, P('r0', 0, 0), C('rc', 'r0', 10));
    const extrude: Feature = { id: 'e', type: 'extrude', operation: 'add', sketch: 'rod', direction: 'both', end: 'blind', depth: 60 };
    const groove = build([rod, extrude, base, helix(), wire, { ...spring, operation: 'cut' }]);
    expect(groove.features.at(-1)?.status).toBe('ok');
    const removed = Math.PI * 100 * 60 - (groove.captures[0]?.properties?.volume ?? 0);
    // Slightly less than half the wire: the inner half of each section is narrower around the axis.
    expect(removed).toBeGreaterThan(0.4 * springVolume(Math.PI, 10, 3));
    expect(removed).toBeLessThan(0.5 * springVolume(Math.PI, 10, 3));
  });

  it('takes outlines without holes along a helix', () => {
    const tube = sketch('wire', { kind: 'standard', plane: 'front' }, P('m', 10, 0), C('w', 'm', 1), C('w2', 'm', 0.5));
    expect(build([base, helix(), tube, spring]).features.at(-1)?.error?.code).toBe('sweep-holes');
  });
});
