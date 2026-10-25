import type { SketchConstraint, SketchData, SketchEntity } from '../../src/shared/model/sketch.ts';
import { ORIGIN_ID } from '../../src/shared/model/sketch.ts';

/**
 * A chain of fully dimensioned rectangles in ParaWerk's sketch model, equivalent to the
 * PlaneGCS benchmark sketch: 4 h/v relations + 2 dimensions per rectangle, linked corner
 * to corner, the first one anchored at the origin. Start positions are perturbed.
 */
export function rectangleChain(rectangles: number, seed: number): { sketch: SketchData; constraints: number } {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  for (let r = 0; r < rectangles; r++) {
    const ox = r * 10;
    const oy = r * 6;
    const corners = [[0, 0], [10, 0], [10, 6], [0, 6]];
    corners.forEach(([x, y], i) => entities.push({ id: `p${r}_${i}`, type: 'point', x: ox + (x as number) + (random() - 0.5) * 3, y: oy + (y as number) + (random() - 0.5) * 3 }));
    for (let i = 0; i < 4; i++) entities.push({ id: `l${r}_${i}`, type: 'line', p1: `p${r}_${i}`, p2: `p${r}_${(i + 1) % 4}` });
    constraints.push(
      { id: `c${r}_h0`, type: 'horizontal', line: `l${r}_0` },
      { id: `c${r}_v1`, type: 'vertical', line: `l${r}_1` },
      { id: `c${r}_h2`, type: 'horizontal', line: `l${r}_2` },
      { id: `c${r}_v3`, type: 'vertical', line: `l${r}_3` },
      { id: `c${r}_w`, type: 'distance', a: `p${r}_0`, b: `p${r}_1`, value: 10, driving: true },
      { id: `c${r}_hgt`, type: 'distance', a: `p${r}_1`, b: `p${r}_2`, value: 6, driving: true },
      r === 0 ? { id: 'anchor', type: 'coincident', a: 'p0_0', b: ORIGIN_ID } : { id: `c${r}_link`, type: 'coincident', a: `p${r}_0`, b: `p${r - 1}_2` },
    );
  }
  return { sketch: { entities, constraints }, constraints: constraints.length };
}

/**
 * A spline through `fitPoints` points along a wave with `onCurve` points held on it, each placed by a
 * horizontal dimension from the origin. All fit points but the middle one are fixed, so dragging the
 * middle one re-solves every point on the curve (each depends on all fit points).
 */
export function splineWithPoints(fitPoints: number, onCurve: number): { sketch: SketchData; dragged: string } {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const ids: string[] = [];
  for (let i = 0; i < fitPoints; i++) {
    entities.push({ id: `f${i}`, type: 'point', x: i * 10, y: 8 * Math.sin(i * 0.7) });
    ids.push(`f${i}`);
  }
  entities.push({ id: 's', type: 'spline', points: ids });
  const middle = Math.floor(fitPoints / 2);
  for (let i = 0; i < fitPoints; i++) if (i !== middle) constraints.push({ id: `fix${i}`, type: 'fix', point: `f${i}` });
  const span = (fitPoints - 1) * 10;
  for (let k = 0; k < onCurve; k++) {
    const x = ((k + 0.5) * span) / onCurve;
    entities.push({ id: `q${k}`, type: 'point', x, y: 8 * Math.sin((x / 10) * 0.7) });
    constraints.push(
      { id: `on${k}`, type: 'pointOnCircle', point: `q${k}`, circle: 's' },
      { id: `dx${k}`, type: 'horizontalDistance', a: ORIGIN_ID, b: `q${k}`, value: x, driving: true },
    );
  }
  return { sketch: { entities, constraints }, dragged: `f${middle}` };
}
