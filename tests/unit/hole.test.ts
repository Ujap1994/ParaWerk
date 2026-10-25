import { describe, expect, it } from 'vitest';
import { defaultFeature, type HoleFeature } from '../../src/shared/model/feature.ts';
import { holePositions, holeProblem, holeProfile, METRIC_SIZES, sizesFor, standardHoleDimensions } from '../../src/shared/model/hole.ts';
import { formatVersionOf } from '../../src/shared/model/part-file.ts';
import { parseFeatures, ValidationError } from '../../src/shared/model/validate.ts';

describe('hole standards', () => {
  it('starts a new hole with the standard dimensions of M6, medium series', () => {
    const hole = defaultFeature('hole', 'h') as HoleFeature;
    expect(hole).toMatchObject(standardHoleDimensions('simple', 'M6', 'normal') ?? {});
  });

  it('takes clearance holes, tap drills, counterbores and thread depths from the tables', () => {
    expect(standardHoleDimensions('simple', 'M8', 'close')?.diameter).toBe(8.4);
    expect(standardHoleDimensions('simple', 'M8', 'loose')?.diameter).toBe(10);
    expect(standardHoleDimensions('counterbore', 'M10', 'normal')).toMatchObject({ diameter: 11, counterboreDiameter: 18, counterboreDepth: 10.6 });
    expect(standardHoleDimensions('tapped', 'M10', 'normal')).toMatchObject({ diameter: 8.5, threadDepth: 20, depth: 26 });
    expect(standardHoleDimensions('simple', 'M7', 'normal')).toBeNull();
  });

  it('offers countersinks only for sizes with countersunk screws, and keeps the tables ordered', () => {
    expect(sizesFor('countersink').map((entry) => entry.size)).not.toContain('M24');
    expect(sizesFor('simple')).toHaveLength(METRIC_SIZES.length);
    for (const entry of METRIC_SIZES) {
      expect(entry.tapDrill).toBeLessThan(entry.d);
      expect(entry.clearance[0]).toBeGreaterThan(entry.d);
      expect(entry.counterbore[0]).toBeGreaterThan(entry.clearance[1]);
    }
  });
});

describe('hole positions and sections', () => {
  it('takes the points that are no ends or centers of curves and no construction', () => {
    const positions = holePositions({
      entities: [
        { id: 'a', type: 'point', x: 1, y: 2 },
        { id: 'b', type: 'point', x: 3, y: 4, construction: true },
        { id: 'c', type: 'point', x: 0, y: 0 },
        { id: 'd', type: 'point', x: 5, y: 0 },
        { id: 'l', type: 'line', p1: 'c', p2: 'd' },
        { id: 'm', type: 'point', x: 9, y: 9 },
        { id: 'k', type: 'circle', center: 'm', radius: 2 },
      ],
      constraints: [],
    });
    expect(positions).toEqual([[1, 2]]);
  });

  it('reports counterbores, countersinks and threads that do not fit the hole', () => {
    const hole = { ...(defaultFeature('hole', 'h') as HoleFeature), end: 'blind' as const };
    expect(holeProblem(hole)).toBeNull();
    expect(holeProblem({ ...hole, kind: 'counterbore', counterboreDepth: 20 })).toBe('counterbore');
    expect(holeProblem({ ...hole, kind: 'countersink', countersinkDiameter: 6 })).toBe('countersink');
    expect(holeProblem({ ...hole, kind: 'tapped', threadDepth: 13 })).toBe('thread');
  });

  it('draws the half section counterclockwise from the surface down to the drill point', () => {
    const hole = defaultFeature('hole', 'h') as HoleFeature;
    const blind = holeProfile({ ...hole, kind: 'counterbore' }, 12, false).regions[0]?.outer;
    expect(blind?.curves).toEqual(['entry', 'counterbore', 'counterboreFloor', 'wall', 'tip', 'axis']);
    expect(blind?.area).toBeGreaterThan(0);
    expect(holeProfile(hole, 30, true).regions[0]?.outer.polygon).toEqual([[0, 0], [3.3, 0], [3.3, 30], [0, 30]]);
  });

  it('reads holes from files and rejects unknown kinds', () => {
    const hole = { ...(defaultFeature('hole', 'h') as HoleFeature) };
    expect(formatVersionOf(parseFeatures([hole]))).toBe(6);
    expect(() => parseFeatures([{ ...hole, kind: 'spot' }])).toThrow(ValidationError);
    expect(() => parseFeatures([{ ...hole, countersinkAngle: 180 }])).toThrow(ValidationError);
  });
});
