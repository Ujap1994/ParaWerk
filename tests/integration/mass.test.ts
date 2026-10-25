/** Mass properties from the exact B-Rep: volume, center of mass and the inertia tensor. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CylinderFeature, Feature } from '../../src/shared/model/feature.ts';
import { massOf, principalMoments } from '../../src/shared/model/material.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

function properties(features: Feature[]) {
  const result = kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
  const props = result.captures[0]?.properties;
  if (!props?.inertia) throw new Error('no mass properties');
  return { ...props, inertia: props.inertia };
}

const close = (actual: number, expected: number) => expect(actual / expected).toBeCloseTo(1, 9);

describe('mass properties', () => {
  it('gives the inertia tensor of a box at its center of mass', () => {
    const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [10, 0, 0] };
    const { volume, center, inertia } = properties([box]);
    const m = 100 * 60 * 40;
    close(volume, m);
    expect(center.map((value) => +value.toFixed(9) + 0)).toEqual([10, 0, 20]);
    close(inertia[0], (m * (60 ** 2 + 40 ** 2)) / 12);
    close(inertia[1], (m * (100 ** 2 + 40 ** 2)) / 12);
    close(inertia[2], (m * (100 ** 2 + 60 ** 2)) / 12);
    for (const product of inertia.slice(3)) expect(Math.abs(product)).toBeLessThan(1e-6 * inertia[0]);
    // Steel: 1.884 kg, and the moments in kg·mm².
    expect(massOf(volume, 7850)).toBeCloseTo(1.884, 6);
    expect(massOf(inertia[2], 7850)).toBeCloseTo((1.884 * (100 ** 2 + 60 ** 2)) / 12, 6);
  });

  it('has products of inertia for a body off its principal axes, and principal moments', () => {
    // An L of two boxes: its principal axes are turned against the model axes.
    const leg: BoxFeature = { id: 'leg', type: 'box', operation: 'add', width: 80, depth: 20, height: 10, position: [30, 0, 0] };
    const arm: BoxFeature = { id: 'arm', type: 'box', operation: 'add', width: 20, depth: 80, height: 10, position: [-20, 30, 0] };
    const { inertia } = properties([leg, arm]);
    expect(Math.abs(inertia[3])).toBeGreaterThan(1e3);
    const moments = principalMoments(inertia);
    // The trace of the tensor does not change with the axes; the moment about z stays a principal one.
    close(moments[0] + moments[1] + moments[2], inertia[0] + inertia[1] + inertia[2]);
    expect(moments[2]).toBeCloseTo(inertia[2], 0);
  });

  it('integrates a cylinder exactly', () => {
    const cylinder: CylinderFeature = { id: 'cyl', type: 'cylinder', operation: 'add', radius: 20, height: 50, axis: 'z', position: [0, 0, 0] };
    const { volume, inertia } = properties([cylinder]);
    close(volume, Math.PI * 400 * 50);
    close(inertia[2], (volume * 400) / 2);
    close(inertia[0], (volume * (3 * 400 + 50 ** 2)) / 12);
  });
});
