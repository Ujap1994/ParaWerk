import { describe, expect, it } from 'vitest';
import { dragTarget } from '../../src/renderer/src/sketch/drag.ts';
import { dxfToSketch, sketchToDxf } from '../../src/renderer/src/sketch/dxf.ts';
import { curvePolyline, deleteEntities, hiddenSplinePolylines, hitTest, pointPositions, splineOf } from '../../src/renderer/src/sketch/geometry.ts';
import { snapCursor } from '../../src/renderer/src/sketch/snap.ts';
import { boundaries } from '../../src/renderer/src/sketch/intersect.ts';
import { applicableRelations } from '../../src/renderer/src/sketch/relations.ts';
import { extendAt, trimAt } from '../../src/renderer/src/sketch/trim.ts';
import { closestOnSpline, segmentsPerSpan, splineAt, splineEnd, splineLength, splinePoint, splinePolyline, splineRoots, splineThrough } from '../../src/shared/model/spline.ts';
import { createTool, type ToolEvent } from '../../src/renderer/src/sketch/tools.ts';
import { linearPattern } from '../../src/renderer/src/sketch/transform.ts';
import type { SketchData, SketchSpline } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });
const pointAt = (sketch: SketchData, id: string) => {
  const entity = sketch.entities.find((candidate) => candidate.id === id);
  if (entity?.type !== 'point') throw new Error(`no point ${id}`);
  return { x: entity.x, y: entity.y };
};
const EMPTY: SketchData = { entities: [], constraints: [] };

const base: SketchData = {
  entities: [point('a', 0, 0), point('b', 20, 15), point('c', 40, 0), point('d', 60, 10), { id: 's', type: 'spline', points: ['a', 'b', 'c', 'd'] }],
  constraints: [],
};

describe('spline math', () => {
  it('passes through its fit points with continuous curvature and straight ends', () => {
    const spline = splineThrough([[0, 0], [20, 15], [40, 0], [60, 10]]);
    if (!spline) throw new Error('no spline');
    spline.points.forEach(([x, y], i) => {
      expect(splinePoint(spline, spline.knots[i] as number)).toEqual([expect.closeTo(x, 9), expect.closeTo(y, 9)]);
    });
    // Natural end conditions: no bending at the ends.
    expect(spline.second[0]).toEqual([0, 0]);
    expect(spline.second.at(-1)).toEqual([0, 0]);
    // C1 and C2 at an inner point: one-sided differences agree.
    const k = spline.knots[1] as number;
    const e = 1e-4;
    const [p0, p1, p2] = [splinePoint(spline, k - e), splinePoint(spline, k), splinePoint(spline, k + e)];
    const left = [(p1[0] - p0[0]) / e, (p1[1] - p0[1]) / e];
    const right = [(p2[0] - p1[0]) / e, (p2[1] - p1[1]) / e];
    expect(right[0]).toBeCloseTo(left[0] as number, 2);
    expect(right[1]).toBeCloseTo(left[1] as number, 2);
  });

  it('is a straight line through two points and ignores repeated points', () => {
    const spline = splineThrough([[0, 0], [0, 0], [10, 10]]);
    if (!spline) throw new Error('no spline');
    expect(spline.points).toHaveLength(2);
    expect(splinePoint(spline, (spline.knots[1] as number) / 2)).toEqual([expect.closeTo(5, 9), expect.closeTo(5, 9)]);
    expect(splineThrough([[1, 1], [1, 1]])).toBeNull();
  });

  it('is tessellated within the tolerance', () => {
    const spline = splineThrough([[0, 0], [20, 15], [40, 0], [60, 10]]);
    if (!spline) throw new Error('no spline');
    const perSpan = segmentsPerSpan(spline, 0.01);
    const coarse = splinePolyline(spline, perSpan);
    const fine = splinePolyline(spline, 400);
    // Every point of the true curve is within the tolerance of the coarse polyline.
    const distance = (p: readonly number[]) =>
      Math.min(
        ...coarse.slice(1).map((b, i) => {
          const a = coarse[i] as readonly number[];
          const [dx, dy] = [(b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number)];
          const t = Math.max(0, Math.min(1, (((p[0] as number) - (a[0] as number)) * dx + ((p[1] as number) - (a[1] as number)) * dy) / (dx * dx + dy * dy)));
          return Math.hypot((p[0] as number) - (a[0] as number) - t * dx, (p[1] as number) - (a[1] as number) - t * dy);
        }),
      );
    expect(Math.max(...fine.map(distance))).toBeLessThan(0.0105);
    expect(splineLength(spline)).toBeGreaterThan(Math.hypot(20, 15) + Math.hypot(20, 15) + Math.hypot(20, 10));
  });
});

describe('nearest points and crossings', () => {
  const spline = splineThrough([[0, 0], [20, 15], [40, 0], [60, 10]]);
  if (!spline) throw new Error('no spline');

  it('has derivatives that match the curve and runs on straight beyond its ends', () => {
    for (const s of [3, 17.5, 40, 61]) {
      const e = 1e-5;
      const { tangent, bend } = splineAt(spline, s);
      const [before, after] = [splineAt(spline, s - e), splineAt(spline, s + e)];
      expect(tangent[0]).toBeCloseTo((after.point[0] - before.point[0]) / (2 * e), 5);
      expect(tangent[1]).toBeCloseTo((after.point[1] - before.point[1]) / (2 * e), 5);
      expect(bend[1]).toBeCloseTo((after.tangent[1] - before.tangent[1]) / (2 * e), 4);
    }
    const end = splineEnd(spline);
    const { point, tangent } = splineAt(spline, end);
    expect(splineAt(spline, end + 10).point).toEqual([expect.closeTo(point[0] + 10 * tangent[0], 9), expect.closeTo(point[1] + 10 * tangent[1], 9)]);
    expect(splineAt(spline, end + 10).bend).toEqual([0, 0]);
    // splinePoint stays on the curve.
    expect(splinePoint(spline, end + 10)).toEqual(point);
  });

  it('finds the nearest point: perpendicular foot, signed by side, also on the continuation', () => {
    const on = splinePoint(spline, 30);
    const { tangent } = splineAt(spline, 30);
    const length = Math.hypot(...tangent);
    const normal = [-tangent[1] / length, tangent[0] / length] as const;
    const left = closestOnSpline(spline, [on[0] + 0.5 * normal[0], on[1] + 0.5 * normal[1]]);
    expect(left.s).toBeCloseTo(30, 6);
    expect(left.signed).toBeCloseTo(0.5, 9);
    expect(closestOnSpline(spline, [on[0] - 0.5 * normal[0], on[1] - 0.5 * normal[1]]).signed).toBeCloseTo(-0.5, 9);
    // Beyond the start: the end point, or the straight continuation when extended.
    const start = splineAt(spline, 0);
    const beyond: [number, number] = [-5 * start.tangent[0], -5 * start.tangent[1] + 1];
    expect(closestOnSpline(spline, beyond).s).toBe(0);
    const extended = closestOnSpline(spline, beyond, true);
    expect(extended.s).toBeLessThan(0);
    expect(extended.distance).toBeLessThan(closestOnSpline(spline, beyond).distance);
  });

  it('finds where a function changes its sign along the spline', () => {
    const roots = splineRoots(spline, (p) => p[1] - 5);
    expect(roots).toHaveLength(3);
    for (const s of roots) expect(splinePoint(spline, s)[1]).toBeCloseTo(5, 9);
  });
});

describe('splines in sketches', () => {
  it('are valid in files, need at least two points and are drawn through their points', () => {
    expect(() => parseSketchData(JSON.parse(JSON.stringify(base)))).not.toThrow();
    expect(() => parseSketchData({ entities: [point('a', 0, 0), { id: 's', type: 'spline', points: ['a'] }], constraints: [] })).toThrow();
    expect(() => parseSketchData({ entities: [point('a', 0, 0), { id: 's', type: 'spline', points: ['a', 'zz'] }], constraints: [] })).toThrow();
    const polyline = curvePolyline(base.entities[4] as SketchSpline, pointPositions(base), 0.05) ?? [];
    expect(polyline[0]).toEqual([0, 0]);
    expect(polyline.at(-1)).toEqual([60, 10]);
  });

  it('are picked at the curve and follow their points in the solver', () => {
    const positions = pointPositions(base);
    const spline = splineOf(base.entities[4] as SketchSpline, positions);
    if (!spline) throw new Error('no spline');
    const on = splinePoint(spline, ((spline.knots[1] as number) + (spline.knots[2] as number)) / 2);
    expect(hitTest(base, positions, on[0], on[1] + 0.2, 0.5)?.id).toBe('s');
    const result = solveSketch({ ...base, constraints: [{ id: 'h', type: 'horizontalPoints', a: 'a', b: 'c' }, { id: 'o', type: 'coincident', a: 'a', b: 'origin' }] });
    expect(result.converged).toBe(true);
    expect(result.status?.entities.s).toBe('under');
    const full = solveSketch({ ...base, constraints: ['a', 'b', 'c', 'd'].map((id) => ({ id: `f${id}`, type: 'fix' as const, point: id })) });
    expect(full.status?.entities.s).toBe('full');
  });

  it('snap onto the curve between their fit points and keep points there by a relation', () => {
    const positions = pointPositions(base);
    const spline = splineOf(base.entities[4] as SketchSpline, positions);
    if (!spline) throw new Error('no spline');
    const on = splinePoint(spline, ((spline.knots[1] as number) + (spline.knots[2] as number)) / 2);
    const snap = snapCursor(base, positions, on[0] + 0.3, on[1] + 0.3, { tolerance: 1, alignTolerance: 0.1 });
    expect(snap.target).toEqual({ kind: 'curve', curve: 's', curveType: 'spline' });
    expect(closestOnSpline(spline, [snap.u, snap.v]).distance).toBeLessThan(1e-9);
    expect(snapCursor(base, positions, 20.3, 15.2, { tolerance: 1, alignTolerance: 0.1 }).target).toEqual({ kind: 'point', id: 'b' });
    // Aligned with the anchor: the crossing of the alignment with the spline.
    const crossing = splinePoint(spline, splineRoots(spline, (p) => p[1] - 5)[1] as number);
    const aligned = snapCursor(base, positions, crossing[0] + 0.3, 5.3, { tolerance: 1, alignTolerance: 0.5, anchor: [100, 5] });
    expect(aligned.target.kind).toBe('curve');
    expect(aligned.v).toBeCloseTo(5, 9);
    expect(closestOnSpline(spline, [aligned.u, aligned.v]).distance).toBeLessThan(1e-9);

    // The point tool places a point on the spline with an on-curve relation.
    const tool = createTool('point');
    const step = tool.click(base, { u: on[0] + 0.3, v: on[1] + 0.3, tolerance: 1, alignTolerance: 0.1 });
    const sketch = step.commit as SketchData;
    expect(sketch.constraints).toEqual([expect.objectContaining({ type: 'pointOnCircle', circle: 's' })]);
    expect(() => parseSketchData(JSON.parse(JSON.stringify(sketch)))).not.toThrow();
  });

  it('keep a point on them while their fit points move, with one degree of freedom along the curve', () => {
    const fixed = ['a', 'b', 'c', 'd'].map((id) => ({ id: `f${id}`, type: 'fix' as const, point: id }));
    const sketch: SketchData = {
      entities: [...base.entities, point('p', 30, 9)],
      constraints: [{ id: 'on', type: 'pointOnCircle', point: 'p', circle: 's' }],
    };
    const solved = solveSketch({ ...sketch, constraints: [...sketch.constraints, ...fixed] });
    expect(solved.converged).toBe(true);
    const positions = pointPositions(solved.sketch);
    const spline = splineOf(base.entities[4] as SketchSpline, positions);
    if (!spline) throw new Error('no spline');
    expect(closestOnSpline(spline, positions.get('p') as [number, number]).distance).toBeLessThan(1e-7);
    // The point can still slide along the spline ...
    expect(solved.status?.entities.p).toBe('under');
    // ... until a dimension holds it.
    const held = solveSketch({ ...sketch, constraints: [...sketch.constraints, ...fixed, { id: 'dx', type: 'horizontalDistance', a: 'origin', b: 'p', value: 30, driving: true }] });
    expect(held.converged).toBe(true);
    expect(held.status?.entities.p).toBe('full');
    expect(held.status?.sketch).toBe('full');

    // Moving a fit point takes the point along.
    const moved = solveSketch({
      ...sketch,
      constraints: [...sketch.constraints, { id: 'fa', type: 'fix', point: 'a' }, { id: 'fc', type: 'fix', point: 'c' }, { id: 'fd', type: 'fix', point: 'd' }, { id: 'hb', type: 'verticalDistance', a: 'a', b: 'b', value: 25, driving: true }, { id: 'dx', type: 'horizontalDistance', a: 'origin', b: 'p', value: 30, driving: true }],
    });
    expect(moved.converged).toBe(true);
    const movedSpline = splineOf(base.entities[4] as SketchSpline, pointPositions(moved.sketch));
    if (!movedSpline) throw new Error('no spline');
    expect(pointAt(moved.sketch, 'b').y).toBeCloseTo(25, 6);
    expect(closestOnSpline(movedSpline, pointPositions(moved.sketch).get('p') as [number, number]).distance).toBeLessThan(1e-7);
  });

  it('take the on-curve relation for a point, but not for their own fit points', () => {
    const sketch: SketchData = { entities: [...base.entities, point('p', 30, 9)], constraints: [] };
    expect(applicableRelations(sketch, ['p', 's']).map((option) => option.kind)).toEqual(['onCurve']);
    expect(applicableRelations(sketch, ['b', 's'])).toEqual([]);
    // A spline among the selection does not turn point relations into something else.
    expect(applicableRelations(sketch, ['p', 'b', 's'])).toEqual([]);
  });

  it('are not snapped onto while they are drawn', () => {
    const event = (u: number, v: number): ToolEvent => ({ u, v, tolerance: 1, alignTolerance: 0.1 });
    const tool = createTool('spline');
    let sketch = EMPTY;
    for (const [u, v] of [[0, 0], [20, 15], [40, 0]] as const) sketch = tool.click(sketch, event(u, v)).commit ?? sketch;
    // Back near the spline drawn so far: a free point, no relation to the spline itself.
    const step = tool.click(sketch, event(10, 9.5));
    expect(step.commit?.constraints ?? []).toEqual([]);
  });

  it('are drawn point by point, each point one undo step, and ended by a second click', () => {
    const event = (u: number, v: number): ToolEvent => ({ u, v, tolerance: 1, alignTolerance: 0.6 });
    const tool = createTool('spline');
    let sketch = EMPTY;
    const steps: SketchData[] = [];
    for (const [u, v] of [[0, 0], [20, 15], [40, 3], [60, 12], [60, 12]] as const) {
      tool.hover(sketch, event(u, v));
      const step = tool.click(sketch, event(u, v));
      if (step.commit) {
        sketch = step.commit;
        steps.push(sketch);
      }
    }
    expect(steps).toHaveLength(3);
    expect(tool.busy).toBe(false);
    const splines = sketch.entities.filter((entity) => entity.type === 'spline');
    expect(splines).toHaveLength(1);
    expect((splines[0] as SketchSpline).points).toHaveLength(4);
    // The first point snapped to the origin.
    expect((splines[0] as SketchSpline).points[0]).toBe('origin');
    expect(() => parseSketchData(JSON.parse(JSON.stringify(sketch)))).not.toThrow();
  });

  it('move as a whole when dragged, are copied by patterns and vanish with their points', () => {
    const target = dragTarget(base, { id: 's', type: 'spline', distance: 0 }, { u: 30, v: 5 }, { u: 35, v: 5 });
    expect(target).toMatchObject({ kind: 'points' });
    expect(target?.kind === 'points' ? target.points.map((p) => p.x) : []).toEqual([5, 25, 45, 65]);
    const result = linearPattern(base, ['s'], [0, 50], 2);
    if (!result.ok) throw new Error(result.error);
    expect(result.sketch.entities.filter((entity) => entity.type === 'spline')).toHaveLength(2);
    expect(deleteEntities(base, ['c']).entities.some((entity) => entity.type === 'spline')).toBe(false);
  });
});

describe('trimming and extending at splines', () => {
  /** The spline `s` of base with a vertical line `v` through it at x = 30 and a circle `k` around (50, 5). */
  const crossed: SketchData = {
    entities: [
      ...base.entities,
      point('v1', 30, -20), point('v2', 30, 30), { id: 'v', type: 'line', p1: 'v1', p2: 'v2' },
      point('kc', 50, 5), { id: 'k', type: 'circle', center: 'kc', radius: 6 },
    ],
    constraints: [],
  };
  const splineIn = (sketch: SketchData) => splineOf(sketch.entities.find((e) => e.id === 's') as SketchSpline, pointPositions(sketch));
  const distanceToSpline = (sketch: SketchData, id: string) => {
    const spline = splineIn(sketch);
    if (!spline) throw new Error('no spline');
    return closestOnSpline(spline, pointPositions(sketch).get(id) as [number, number]).distance;
  };

  it('finds where lines, circles and other splines cross a spline', () => {
    const atLine = boundaries(crossed, 'v');
    expect(atLine).toHaveLength(1);
    expect(atLine[0]).toMatchObject({ curve: 's' });
    expect(distanceToSpline({ ...crossed, entities: [...crossed.entities, point('x', ...(atLine[0]?.at as [number, number]))] }, 'x')).toBeLessThan(1e-9);
    expect(boundaries(crossed, 'k')).toHaveLength(2);
    // Along the spline: the line and both crossings with the circle, in order.
    const along = boundaries(crossed, 's');
    expect(along.map((b) => b.curve)).toEqual(['v', 'k', 'k']);
    // Two splines crossing each other.
    const two: SketchData = {
      entities: [...base.entities, point('t1', 0, 10), point('t2', 30, 0), point('t3', 60, 15), { id: 't', type: 'spline', points: ['t1', 't2', 't3'] }],
      constraints: [],
    };
    const both = boundaries(two, 't');
    expect(both.length).toBeGreaterThan(0);
    for (const crossing of both) {
      const other = splineOf(base.entities[4] as SketchSpline, pointPositions(two));
      if (!other) throw new Error('no spline');
      expect(closestOnSpline(other, crossing.at).distance).toBeLessThan(1e-7);
    }
  });

  it('trims a line and a circle at a spline; the new ends stay on it', () => {
    const line = trimAt(crossed, 'v', [30, 25]);
    if (!line.ok) throw new Error(line.error);
    const end = line.sketch.entities.find((e) => e.id === 'v');
    if (end?.type !== 'line') throw new Error('no line');
    expect(line.sketch.constraints).toEqual([expect.objectContaining({ type: 'pointOnCircle', point: end.p2, circle: 's' })]);
    expect(distanceToSpline(line.sketch, end.p2)).toBeLessThan(1e-9);
    const solved = solveSketch(line.sketch);
    expect(solved.converged).toBe(true);
    expect(() => parseSketchData(JSON.parse(JSON.stringify(line.sketch)))).not.toThrow();

    const circle = trimAt(crossed, 'k', [50, 11]);
    if (!circle.ok) throw new Error(circle.error);
    const arc = circle.sketch.entities.find((e) => e.id === 'k');
    expect(arc?.type).toBe('arc');
    if (arc?.type === 'arc') for (const id of [arc.start, arc.end]) expect(distanceToSpline(circle.sketch, id)).toBeLessThan(1e-9);
  });

  it('extends a line up to a spline', () => {
    const sketch: SketchData = { entities: [...base.entities, point('h1', 30, 40), point('h2', 30, 30), { id: 'h', type: 'line', p1: 'h1', p2: 'h2' }], constraints: [] };
    const result = extendAt(sketch, 'h', [30, 31]);
    if (!result.ok) throw new Error(result.error);
    expect(result.sketch.constraints).toEqual([expect.objectContaining({ type: 'pointOnCircle', point: 'h2', circle: 's' })]);
    expect(distanceToSpline(result.sketch, 'h2')).toBeLessThan(1e-9);
  });

  it('removes a spline that nothing crosses', () => {
    const alone = trimAt(base, 's', [20, 15]);
    expect(alone.ok && alone.sketch.entities.some((e) => e.type === 'spline')).toBe(false);
  });
});

describe('cutting splines', () => {
  const crossed: SketchData = {
    entities: [
      ...base.entities,
      point('v1', 30, -20), point('v2', 30, 30), { id: 'v', type: 'line', p1: 'v1', p2: 'v2' },
      point('kc', 50, 5), { id: 'k', type: 'circle', center: 'kc', radius: 6 },
    ],
    constraints: [],
  };
  const spline = (sketch: SketchData, id = 's') => sketch.entities.find((e) => e.id === id) as SketchSpline;
  const original = splineOf(base.entities[4] as SketchSpline, pointPositions(base));
  if (!original) throw new Error('no spline');
  const onOriginal = (sketch: SketchData, id: string) => closestOnSpline(original, pointPositions(sketch).get(id) as [number, number]).distance;

  it('keeps all fit points and the exact shape, and shows only the rest', () => {
    // The piece from the first fit point to the line goes.
    const result = trimAt(crossed, 's', [10, 10]);
    if (!result.ok) throw new Error(result.error);
    const trimmed = spline(result.sketch);
    expect(trimmed.points).toEqual(['a', 'b', 'c', 'd']);
    expect(trimmed.start).toBeDefined();
    expect(trimmed.end).toBeUndefined();
    expect(onOriginal(result.sketch, trimmed.start as string)).toBeLessThan(1e-9);
    // The new end is held on the line by a relation and on the spline by the spline itself.
    expect(result.sketch.constraints).toEqual([expect.objectContaining({ type: 'pointOnLine', point: trimmed.start, line: 'v' })]);
    const polyline = curvePolyline(trimmed, pointPositions(result.sketch), 0.01) ?? [];
    expect(polyline[0]?.[0]).toBeCloseTo(30, 9);
    expect(polyline.at(-1)).toEqual([60, 10]);
    for (const p of polyline) expect(closestOnSpline(original, p).distance).toBeLessThan(1e-9);
    // Picking ignores the part that is cut off; it is only hinted.
    expect(hitTest(result.sketch, pointPositions(result.sketch), 10, 10.6, 1)).toBeNull();
    expect(hiddenSplinePolylines(trimmed, pointPositions(result.sketch), 0.01)).toHaveLength(1);
    expect(() => parseSketchData(JSON.parse(JSON.stringify(result.sketch)))).not.toThrow();
  });

  it('cuts a piece out of the middle: two splines through the same fit points', () => {
    const between = boundaries(crossed, 's');
    const middle = ((between[0]?.t as number) + (between[1]?.t as number)) / 2;
    const shape = { at: splinePoint(original, middle * (original.knots.at(-1) as number)) };
    const result = trimAt(crossed, 's', shape.at);
    if (!result.ok) throw new Error(result.error);
    const pieces = result.sketch.entities.filter((e): e is SketchSpline => e.type === 'spline');
    expect(pieces).toHaveLength(2);
    expect(pieces[1]?.points).toEqual(pieces[0]?.points);
    const [first, second] = pieces as [SketchSpline, SketchSpline];
    expect(first.start).toBeUndefined();
    expect(second.end).toBeUndefined();
    for (const id of [first.end, second.start]) expect(onOriginal(result.sketch, id as string)).toBeLessThan(1e-9);
    expect(result.sketch.constraints.map((c) => c.type).sort()).toEqual(['pointOnCircle', 'pointOnLine']);
    // Trimming the rest of the second piece at the circle again.
    const again = trimAt(result.sketch, second.id, [58, 10]);
    if (!again.ok) throw new Error(again.error);
    const last = spline(again.sketch, second.id);
    expect(last.start).toBe(second.start);
    expect(last.end).toBeDefined();
    expect(onOriginal(again.sketch, last.end as string)).toBeLessThan(1e-9);
  });

  it('holds trim ends on the curve while the fit points move, and they count for the definition', () => {
    const result = trimAt(crossed, 's', [10, 10]);
    if (!result.ok) throw new Error(result.error);
    const trimmed = spline(result.sketch);
    const fixed = ['a', 'b', 'c', 'd', 'v1', 'v2'].map((id) => ({ id: `f${id}`, type: 'fix' as const, point: id }));
    const full = solveSketch({ ...result.sketch, constraints: [...result.sketch.constraints, ...fixed] });
    expect(full.converged).toBe(true);
    expect(full.status?.entities.s).toBe('full');
    // Without the line, the trim end slides along the spline.
    const free = solveSketch({ ...result.sketch, constraints: fixed.filter((c) => !c.point.startsWith('v')) });
    expect(free.status?.entities.s).toBe('under');
    // Moving a fit point keeps the trim end on the changed curve.
    const moved = solveSketch({
      ...result.sketch,
      constraints: [...result.sketch.constraints, ...fixed.filter((c) => c.point !== 'b'), { id: 'hb', type: 'verticalDistance', a: 'a', b: 'b', value: 25, driving: true }],
    });
    expect(moved.converged).toBe(true);
    const movedSpline = splineOf(spline(moved.sketch), pointPositions(moved.sketch));
    if (!movedSpline) throw new Error('no spline');
    expect(closestOnSpline(movedSpline, pointPositions(moved.sketch).get(trimmed.start as string) as [number, number], true).distance).toBeLessThan(1e-7);
  });

  it('are validated, copied with their trim ends and ignore crossings in the cut-off part', () => {
    const result = trimAt(crossed, 's', [10, 10]);
    if (!result.ok) throw new Error(result.error);
    const trimmed = spline(result.sketch);
    const invalid = (patch: Partial<SketchSpline>) => ({ ...result.sketch, entities: result.sketch.entities.map((e) => (e.id === 's' ? { ...e, ...patch } : e)) });
    expect(() => parseSketchData(invalid({ start: 'b' }))).toThrow();
    expect(() => parseSketchData(invalid({ end: trimmed.start as string }))).toThrow();
    expect(() => parseSketchData(invalid({ start: 'zz' }))).toThrow();
    const copy = linearPattern(result.sketch, ['s'], [0, 50], 2);
    if (!copy.ok) throw new Error(copy.error);
    const copied = copy.sketch.entities.filter((e): e is SketchSpline => e.type === 'spline');
    expect(copied).toHaveLength(2);
    expect(copied[1]?.start).toBeDefined();
    expect(copied[1]?.start).not.toBe(trimmed.start);
    // A line across the cut-off part does not split the trimmed spline.
    const across: SketchData = { ...result.sketch, entities: [...result.sketch.entities, point('w1', 10, -20), point('w2', 10, 30), { id: 'w', type: 'line', p1: 'w1', p2: 'w2' }] };
    expect(boundaries(across, 's').some((b) => b.curve === 'w')).toBe(false);
  });
});

describe('DXF', () => {
  it('exports splines as fine open polylines and imports fit-point splines', () => {
    const { text, entities } = sketchToDxf(base);
    expect(entities).toBe(1);
    expect(text).toContain('POLYLINE');
    const text2 = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'SPLINE', '8', '0', '70', '8', '71', '3', '74', '3', '11', '0', '21', '0', '31', '0', '11', '20', '21', '15', '31', '0', '11', '40', '21', '0', '31', '0',
      '0', 'SPLINE', '8', '0', '70', '8', '71', '3', '73', '4', '10', '0', '20', '0', '30', '0', '10', '1', '20', '1', '30', '0',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const result = dxfToSketch(text2, EMPTY);
    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual({ SPLINE: 1 });
    const spline = result.sketch.entities.find((entity) => entity.type === 'spline') as SketchSpline;
    expect(spline.points).toHaveLength(3);
  });
});
