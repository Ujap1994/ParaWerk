/** Where the section view cuts and how far its offset can go (src/renderer/src/section.ts). */
import { describe, expect, it } from 'vitest';
import { offsetRange, sectionCut } from '../../src/renderer/src/section.ts';

describe('section view', () => {
  it('cuts away the side the plane normal points to, or the other one', () => {
    // The front plane looks at the viewer (−Y): the front half goes.
    expect(sectionCut({ plane: { kind: 'standard', plane: 'front' }, offset: 0, flip: false })).toEqual({ point: [0, 0, 0], normal: [0, -1, 0] });
    expect(sectionCut({ plane: { kind: 'standard', plane: 'top' }, offset: 12, flip: true })).toEqual({ point: [0, 0, 12], normal: [-0, -0, -1] });
    // A face plane with an unnormalized normal, moved 5 mm into the part.
    const cut = sectionCut({ plane: { kind: 'custom', point: [10, 0, 0], normal: [2, 0, 0] }, offset: -5, flip: false });
    expect(cut).toEqual({ point: [5, 0, 0], normal: [1, 0, 0] });
  });

  it('gives the offsets at which the plane passes through the part', () => {
    expect(offsetRange({ kind: 'standard', plane: 'right' }, [-50, -30, 0], [50, 30, 40])).toEqual([-50, 50]);
    expect(offsetRange({ kind: 'standard', plane: 'front' }, [-50, -30, 0], [50, 30, 40])).toEqual([-30, 30]);
    expect(offsetRange({ kind: 'custom', point: [0, 0, 40], normal: [0, 0, 1] }, [-50, -30, 0], [50, 30, 40])).toEqual([-40, 0]);
  });
});
