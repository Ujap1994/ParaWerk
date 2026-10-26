import { describe, expect, it } from 'vitest';
import type { Profile, ProfileLoop } from '../../src/shared/model/profile.ts';
import type { SketchData, SketchEntity } from '../../src/shared/model/sketch.ts';
import { thinProfile, type ThinProblem } from '../../src/shared/model/thin.ts';

const P = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const sketch = (...entities: SketchEntity[]): SketchData => ({ entities, constraints: [] });

/** An L of two lines: 40 along x, then 30 up. */
const ell = sketch(P('a', 0, 0), P('b', 40, 0), P('c', 40, 30), L('ab', 'a', 'b'), L('bc', 'b', 'c'));

function walls(data: SketchData, side: 'one' | 'other' | 'both', thickness: number): Profile {
  const result = thinProfile(data, side, thickness);
  if ('code' in result) throw new Error(result.code);
  return result;
}

/** The exact area of a loop: lines by the shoelace formula, arcs by their segments. */
function areaOf(loop: ProfileLoop): number {
  let area = 0;
  for (const edge of loop.edges) {
    if (edge.kind === 'line') area += (edge.from[0] * edge.to[1] - edge.to[0] * edge.from[1]) / 2;
    else if (edge.kind === 'arc') {
      const [cx, cy] = edge.center;
      const [r, a, b] = [edge.radius, edge.start, edge.end];
      // ∫ x dy − y dx / 2 along the arc.
      area += (cx * r * (Math.sin(b) - Math.sin(a)) - cy * r * (-Math.cos(b) + Math.cos(a)) + r * r * (b - a)) / 2;
    } else if (edge.kind === 'circle') area += (edge.ccw ? 1 : -1) * Math.PI * edge.radius ** 2;
  }
  return area;
}

const regionArea = (profile: Profile) => profile.regions.reduce((sum, region) => sum + areaOf(region.outer) + region.holes.reduce((h, hole) => h + areaOf(hole), 0), 0);

describe('thin walls', () => {
  it('makes a wall of a line with square ends, to either side or both', () => {
    const line = sketch(P('a', 0, 0), P('b', 50, 0), L('ab', 'a', 'b'));
    for (const side of ['one', 'other', 'both'] as const) {
      const profile = walls(line, side, 4);
      expect(profile.regions).toHaveLength(1);
      expect(regionArea(profile)).toBeCloseTo(200, 9);
    }
    // One side is to the right of the line walked from its left end: below it.
    const ys = walls(line, 'one', 4).regions[0]?.outer.polygon.map((p) => p[1]) ?? [];
    expect(Math.min(...ys)).toBeCloseTo(-4, 9);
    expect(Math.max(...ys)).toBeCloseTo(0, 9);
  });

  it('meets in a sharp corner', () => {
    // Outside the corner (one side: right of a→b→c is below and right of the L): 44 × 4 + 30 × 4.
    expect(regionArea(walls(ell, 'one', 4))).toBeCloseTo(44 * 4 + 30 * 4, 9);
    // Inside the corner: 40 × 4 + 26 × 4.
    expect(regionArea(walls(ell, 'other', 4))).toBeCloseTo(40 * 4 + 26 * 4, 9);
    expect(regionArea(walls(ell, 'both', 4))).toBeCloseTo(42 * 4 + 28 * 4, 9);
  });

  it('names the walls after their curves and side', () => {
    const outline = walls(ell, 'both', 4).regions[0]?.outer;
    expect(outline?.curves).toEqual(expect.arrayContaining(['ab:right', 'bc:right', 'bc:left', 'ab:left', 'bc:end', 'ab:start']));
    // The same names on whichever side the walls are: the face on the curves is named after its side too.
    expect(walls(ell, 'one', 4).regions[0]?.outer.curves).toEqual(expect.arrayContaining(['ab:left', 'bc:left', 'ab:right']));
    expect([...(walls(ell, 'other', 4).regions[0]?.outer.curves ?? [])].sort()).toEqual([...(walls(ell, 'one', 4).regions[0]?.outer.curves ?? [])].sort());
  });

  it('makes a ring of a closed outline: outside, inside or both', () => {
    const square = sketch(P('a', 0, 0), P('b', 20, 0), P('c', 20, 20), P('d', 0, 20), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a'));
    const one = walls(square, 'one', 2);
    expect(one.regions[0]?.holes).toHaveLength(1);
    expect(regionArea(one)).toBeCloseTo(24 * 24 - 400, 9);
    expect(regionArea(walls(square, 'other', 2))).toBeCloseTo(400 - 16 * 16, 9);
    expect(regionArea(walls(square, 'both', 2))).toBeCloseTo(22 * 22 - 18 * 18, 9);
    expect(one.regions[0]?.outer.curves).toEqual(['ab:outer', 'bc:outer', 'cd:outer', 'da:outer']);
  });

  it('offsets arcs and circles around their centers', () => {
    const circle = sketch(P('m', 0, 0), { id: 'k', type: 'circle', center: 'm', radius: 10 });
    expect(regionArea(walls(circle, 'one', 2))).toBeCloseTo(Math.PI * (144 - 100), 9);
    expect(regionArea(walls(circle, 'other', 2))).toBeCloseTo(Math.PI * (100 - 64), 9);
    // A half circle arc (counterclockwise from (10, 0) to (−10, 0)): walls on the outside.
    const arc = sketch(P('m', 0, 0), P('s', 10, 0), P('e', -10, 0), { id: 'r', type: 'arc', center: 'm', start: 's', end: 'e' });
    const outward = walls(arc, 'one', 2);
    expect(regionArea(outward) + regionArea(walls(arc, 'other', 2))).toBeCloseTo((Math.PI * (144 - 64)) / 2, 9);
  });

  it('joins a line and an arc that runs on tangentially', () => {
    // A slot half: a line to (20, 0), then a half circle up to (20, 20), then a line back.
    const hook = sketch(
      P('a', 0, 0), P('b', 20, 0), P('m', 20, 10), P('c', 20, 20), P('d', 0, 20),
      L('ab', 'a', 'b'), { id: 'r', type: 'arc', center: 'm', start: 'b', end: 'c' }, L('cd', 'c', 'd'),
    );
    const area = 2 * 20 * 2 + (Math.PI * (144 - 100)) / 2;
    expect(regionArea(walls(hook, 'one', 2))).toBeCloseTo(area, 9);
  });

  it('rounds the outside of a very sharp corner', () => {
    // A hairpin of 10°: the sharp corner would reach far out.
    const angle = (10 * Math.PI) / 180;
    const hairpin = sketch(P('a', 0, 0), P('b', 40, 0), P('c', 40 - 40 * Math.cos(angle), 40 * Math.sin(angle)), L('ab', 'a', 'b'), L('bc', 'b', 'c'));
    const outline = walls(hairpin, 'one', 1).regions[0]?.outer;
    expect(outline?.curves).toContain('ab:bc:join');
    expect(outline?.edges.some((edge) => edge.kind === 'arc')).toBe(true);
  });

  it('reports what cannot be made thin', () => {
    const problem = (data: SketchData, thickness = 2): ThinProblem['code'] | null => {
      const result = thinProfile(data, 'other', thickness);
      return 'code' in result ? result.code : null;
    };
    expect(problem(sketch())).toBe('thin-empty');
    expect(problem(sketch(P('a', 0, 0), P('b', 10, 0), P('c', 0, 10), P('d', -10, 0), L('ab', 'a', 'b'), L('ac', 'a', 'c'), L('ad', 'a', 'd')))).toBe('thin-branching');
    expect(problem(sketch(P('a', 0, 0), P('b', 10, 5), { id: 's', type: 'spline', points: ['a', 'b'] }))).toBe('thin-unsupported');
    // Walls of 30 inside a square of 20.
    const square = sketch(P('a', 0, 0), P('b', 20, 0), P('c', 20, 20), P('d', 0, 20), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a'));
    expect(problem(square, 30)).toBe('thin-too-thick');
    expect(problem(sketch(P('m', 0, 0), { id: 'k', type: 'circle', center: 'm', radius: 1 }))).toBe('thin-too-thick');
    // Construction geometry does not count.
    expect(problem(sketch(P('a', 0, 0), P('b', 10, 0), { ...L('ab', 'a', 'b'), construction: true } as SketchEntity))).toBe('thin-empty');
  });
});
