import { describe, expect, it } from 'vitest';
import { defaultFeature } from '../../src/shared/model/feature.ts';
import { frameTransform, pointIn, tensorIn, type Frame } from '../../src/shared/model/frame.ts';
import { formatVersionOf } from '../../src/shared/model/part-file.ts';
import { parseFeature } from '../../src/shared/model/validate.ts';

/** At (10, 20, 30), turned 90° around Z: X along the model's Y, Y along the model's −X. */
const turned: Frame = { origin: [10, 20, 30], xDir: [0, 1, 0], yDir: [-1, 0, 0], zDir: [0, 0, 1] };

describe('coordinate system frames', () => {
  it('gives points in the frame', () => {
    expect(pointIn(turned, [10, 20, 30])).toEqual([0, 0, 0]);
    expect(pointIn(turned, [10, 25, 31])).toEqual([5, 0, 1]);
    expect(pointIn(turned, [7, 20, 30])).toEqual([0, 3, 0]);
  });

  it('turns tensors into the frame axes', () => {
    // Ixx and Iyy swap when the axes turn by 90°; Ixy changes sign.
    expect(tensorIn(turned, [1, 2, 3, 0.5, 0, 0])).toEqual([2, 1, 3, -0.5, 0, 0]);
    // The trace stays.
    const tilted: Frame = { origin: [0, 0, 0], xDir: [Math.SQRT1_2, Math.SQRT1_2, 0], yDir: [-Math.SQRT1_2, Math.SQRT1_2, 0], zDir: [0, 0, 1] };
    const [xx, yy, zz] = tensorIn(tilted, [4, 2, 1, 1, 0.5, 0.25]);
    expect(xx + yy + zz).toBeCloseTo(7, 12);
  });

  it('writes the transformation into the frame as 12 numbers', () => {
    const m = frameTransform(turned);
    const apply = (p: [number, number, number]) => [0, 1, 2].map((row) => (m[4 * row] ?? 0) * p[0] + (m[4 * row + 1] ?? 0) * p[1] + (m[4 * row + 2] ?? 0) * p[2] + (m[4 * row + 3] ?? 0));
    expect(apply([10, 25, 31])).toEqual(pointIn(turned, [10, 25, 31]));
  });

  it('validates coordinate system features and saves them in format version 7', () => {
    const csys = defaultFeature('csys', 'c');
    expect(parseFeature(csys)).toEqual(csys);
    expect(() => parseFeature({ ...csys, method: 'anywhere' })).toThrow('method');
    expect(() => parseFeature({ ...csys, flipX: 'yes' })).toThrow('flipX');
    expect(formatVersionOf([csys])).toBe(7);
  });
});
