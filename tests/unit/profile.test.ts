import { describe, expect, it } from 'vitest';
import { trimAt } from '../../src/renderer/src/sketch/trim.ts';
import { sketchProfile, type ProfileEdge, type ProfileLoop } from '../../src/shared/model/profile.ts';
import type { SketchData, SketchEntity } from '../../src/shared/model/sketch.ts';
import { closestOnSpline, splineThrough, type Point2 } from '../../src/shared/model/spline.ts';

const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string, construction = false): SketchEntity => ({ id, type: 'line', p1, p2, ...(construction ? { construction } : {}) });
const sketch = (...entities: SketchEntity[]): SketchData => ({ entities, constraints: [] });

/** A rectangle of lines with corner points `${prefix}1..4`. */
function rectangle(prefix: string, x0: number, y0: number, x1: number, y1: number): SketchEntity[] {
  return [
    point(`${prefix}1`, x0, y0), point(`${prefix}2`, x1, y0), point(`${prefix}3`, x1, y1), point(`${prefix}4`, x0, y1),
    line(`${prefix}a`, `${prefix}1`, `${prefix}2`), line(`${prefix}b`, `${prefix}2`, `${prefix}3`),
    line(`${prefix}c`, `${prefix}3`, `${prefix}4`), line(`${prefix}d`, `${prefix}4`, `${prefix}1`),
  ];
}

/** Start and end point of an edge in the direction it runs. */
function ends(edge: ProfileEdge): [Point2, Point2] {
  switch (edge.kind) {
    case 'line':
      return [edge.from, edge.to];
    case 'arc': {
      const at = (angle: number): Point2 => [edge.center[0] + edge.radius * Math.cos(angle), edge.center[1] + edge.radius * Math.sin(angle)];
      return [at(edge.start), at(edge.end)];
    }
    case 'circle':
    case 'ellipse':
      return [[NaN, NaN], [NaN, NaN]];
    case 'bspline':
      return [edge.poles[0] as Point2, edge.poles.at(-1) as Point2];
  }
}

/** Every edge starts where the previous one ends. */
function expectClosed(loop: ProfileLoop): void {
  if (loop.edges.length === 1) return;
  loop.edges.forEach((edge, i) => {
    const previous = loop.edges[(i - 1 + loop.edges.length) % loop.edges.length] as ProfileEdge;
    const [start] = ends(edge);
    const [, end] = ends(previous);
    expect(Math.hypot(start[0] - end[0], start[1] - end[1])).toBeLessThan(1e-9);
  });
}

/** Area of a region: outer minus holes. */
const areaOf = (region: { outer: ProfileLoop; holes: ProfileLoop[] }) => region.outer.area + region.holes.reduce((sum, hole) => sum + hole.area, 0);

describe('sketch profiles', () => {
  it('finds a rectangle as one counterclockwise outline', () => {
    const profile = sketchProfile(sketch(...rectangle('r', 0, 0, 40, 20)));
    expect(profile.problems).toEqual([]);
    expect(profile.regions).toHaveLength(1);
    const region = profile.regions[0];
    if (!region) throw new Error('no region');
    expect(region.outer.area).toBeCloseTo(800, 6);
    expect(region.outer.edges).toHaveLength(4);
    expect(region.holes).toEqual([]);
    expectClosed(region.outer);
  });

  it('cuts holes and keeps islands inside holes (even-odd nesting)', () => {
    const profile = sketchProfile(
      sketch(
        ...rectangle('r', -50, -50, 50, 50),
        point('c', 0, 0), { id: 'hole', type: 'circle', center: 'c', radius: 30 },
        { id: 'island', type: 'circle', center: 'c', radius: 10 },
        point('e', 40, 40), point('ea', 45, 40), point('eb', 40, 42), { id: 'ell', type: 'ellipse', center: 'e', major: 'ea', minor: 'eb' },
      ),
    );
    expect(profile.problems).toEqual([]);
    expect(profile.regions).toHaveLength(2);
    const [plate, island] = profile.regions as [{ outer: ProfileLoop; holes: ProfileLoop[] }, { outer: ProfileLoop; holes: ProfileLoop[] }];
    expect(plate.holes).toHaveLength(2);
    expect(plate.holes.every((hole) => hole.area < 0)).toBe(true);
    expect(plate.holes.map((hole) => hole.edges[0]?.kind).sort()).toEqual(['circle', 'ellipse']);
    // Areas come from fine polylines (inscribed in circles), so they are close, not exact.
    expect(areaOf(plate) / (100 * 100 - Math.PI * 900 - Math.PI * 10)).toBeCloseTo(1, 2);
    expect(island.outer.edges).toEqual([expect.objectContaining({ kind: 'circle', ccw: true })]);
  });

  it('follows arcs in the right direction around a slot', () => {
    const profile = sketchProfile(
      sketch(
        point('c1', 0, 0), point('c2', 40, 0),
        point('a', 0, -10), point('b', 40, -10), point('c', 40, 10), point('d', 0, 10),
        line('bottom', 'a', 'b'), line('top', 'c', 'd'),
        { id: 'right', type: 'arc', center: 'c2', start: 'b', end: 'c' },
        { id: 'left', type: 'arc', center: 'c1', start: 'd', end: 'a' },
      ),
    );
    const region = profile.regions[0];
    if (!region) throw new Error('no region');
    expectClosed(region.outer);
    expect(region.outer.area / (40 * 20 + Math.PI * 100)).toBeCloseTo(1, 2);
    expect(region.outer.curves.sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  it('ignores construction geometry, open chains, dangling lines and lines that divide an outline', () => {
    const profile = sketchProfile(
      sketch(
        ...rectangle('r', 0, 0, 40, 20),
        line('diagonal', 'r1', 'r3'),
        point('x', 60, 10), line('tail', 'r3', 'x'),
        point('o1', 0, 40), point('o2', 20, 50), line('open1', 'o1', 'o2'), point('o3', 40, 40), line('open2', 'o2', 'o3'),
        ...rectangle('k', 100, 0, 120, 20).map((entity) => (entity.type === 'line' ? { ...entity, construction: true } : entity)),
      ),
    );
    expect(profile.regions).toHaveLength(1);
    expect(profile.regions[0]?.outer.area).toBeCloseTo(800, 6);
    expect(profile.regions[0]?.outer.curves).toHaveLength(4);
  });

  it('keeps separate outlines apart, also when a line bridges them', () => {
    const profile = sketchProfile(sketch(...rectangle('a', 0, 0, 10, 10), ...rectangle('b', 20, 0, 30, 10), line('bridge', 'a2', 'b1')));
    expect(profile.regions).toHaveLength(2);
    expect(profile.regions.map((region) => Math.round(region.outer.area))).toEqual([100, 100]);
  });

  it('reports curves that cross each other', () => {
    const profile = sketchProfile(sketch(...rectangle('a', 0, 0, 20, 20), ...rectangle('b', 10, 10, 30, 30)));
    expect(profile.problems.length).toBeGreaterThan(0);
    expect(profile.problems[0]).toMatchObject({ kind: 'crossing' });
  });

  it('turns splines into exact Bézier spans, also trimmed ones', () => {
    const base = sketch(
      point('a', 0, 0), point('b', 20, 15), point('c', 40, 5), point('d', 60, 0),
      { id: 's', type: 'spline', points: ['a', 'b', 'c', 'd'] },
      line('back', 'd', 'a'),
    );
    const spline = splineThrough([[0, 0], [20, 15], [40, 5], [60, 0]]);
    if (!spline) throw new Error('no spline');
    const region = sketchProfile(base).regions[0];
    if (!region) throw new Error('no region');
    expectClosed(region.outer);
    const edge = region.outer.edges.find((candidate) => candidate.kind === 'bspline');
    if (edge?.kind !== 'bspline') throw new Error('no spline edge');
    expect(edge.poles).toHaveLength(3 * 3 + 1);
    // Points of every Bézier span lie on the spline.
    for (let span = 0; span < 3; span++) {
      const [p0, p1, p2, p3] = edge.poles.slice(3 * span, 3 * span + 4) as [Point2, Point2, Point2, Point2];
      for (const t of [0.25, 0.5, 0.75]) {
        const u = 1 - t;
        const p: Point2 = [
          u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
          u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
        ];
        expect(closestOnSpline(spline, p).distance).toBeLessThan(1e-9);
      }
    }

    // Cut at a vertical line, then closed by two lines: the outline runs along the rest of the spline.
    const crossed = sketch(...base.entities.filter((e) => e.id !== 'back'), point('v1', 30, -10), point('v2', 30, 30), line('v', 'v1', 'v2'));
    const trimmed = trimAt(crossed, 's', [10, 9]);
    if (!trimmed.ok) throw new Error(trimmed.error);
    const cut = trimmed.sketch.entities.find((e) => e.id === 's');
    if (cut?.type !== 'spline' || !cut.start) throw new Error('not trimmed');
    const closed = sketch(...trimmed.sketch.entities.filter((e) => !['v', 'v1', 'v2'].includes(e.id)), point('q', 30, 0), line('l1', 'd', 'q'), line('l2', 'q', cut.start));
    const half = sketchProfile(closed);
    expect(half.problems).toEqual([]);
    expect(half.regions).toHaveLength(1);
    const outline = half.regions[0]?.outer as ProfileLoop;
    expectClosed(outline);
    const rest = outline.edges.find((candidate) => candidate.kind === 'bspline');
    if (rest?.kind !== 'bspline') throw new Error('no spline edge');
    for (const pole of [rest.poles[0] as Point2, rest.poles.at(-1) as Point2]) expect(closestOnSpline(spline, pole).distance).toBeLessThan(1e-9);
    expect(Math.min(...rest.poles.map((p) => p[0]))).toBeCloseTo(30, 9);
    expect(rest.knots[0]).toBeLessThan(rest.knots.at(-1) as number);
  });
});
