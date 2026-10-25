/** Parent and child relations between features, moving features in the tree and the rollback bar. */
import { describe, expect, it } from 'vitest';
import { featureParents, moveRange } from '../../src/shared/model/dependencies.ts';
import { defaultFeature, type ExtrudeFeature, type Feature, type FilletFeature, type PatternFeature, type PlaneFeature, type SketchFeature } from '../../src/shared/model/feature.ts';
import { rebuildPlan, rollbackIndex } from '../../src/renderer/src/state/document.ts';
import { dropRow, ROLLBACK_ROW, treeRows } from '../../src/renderer/src/state/tree-order.ts';

const variables = defaultFeature('variables', 'vars');
const box = defaultFeature('box', 'box');
const plane: PlaneFeature = { ...(defaultFeature('plane', 'plane') as PlaneFeature), references: [{ kind: 'face', name: 'box:top', at: [0, 0, 40] }] };
const sketch: SketchFeature = {
  ...(defaultFeature('sketch', 'sketch') as SketchFeature),
  plane: { kind: 'feature', feature: 'plane', frame: { origin: [0, 0, 50], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } },
  // Entity ids are not feature ids, even when they happen to look alike.
  sketch: { entities: [{ id: 'box', type: 'point', x: 0, y: 0 }], constraints: [] },
};
const boss: ExtrudeFeature = { ...(defaultFeature('extrude', 'boss') as ExtrudeFeature), sketch: 'sketch' };
const cylinder = defaultFeature('cylinder', 'cyl');
const fillet: FilletFeature = { id: 'fillet', type: 'fillet', radius: 1, edges: [{ kind: 'edge', faces: ['boss:side:l1', 'box:top'], at: [0, 0, 40] }] };
const pattern: PatternFeature = { ...(defaultFeature('pattern', 'pattern') as PatternFeature), features: ['boss'], references: [{ kind: 'standard-plane', plane: 'front' }] };

const part: Feature[] = [variables, box, plane, sketch, boss, cylinder, fillet, pattern];
const ids = new Set(part.map((feature) => feature.id));
const order = (features: readonly Feature[]) => features.map((feature) => feature.id);

describe('feature parents', () => {
  it('finds sketches, reference geometry, named faces and copied features', () => {
    expect([...featureParents(plane, ids)]).toEqual(['box']);
    expect([...featureParents(sketch, ids)]).toEqual(['plane']);
    expect([...featureParents(boss, ids)]).toEqual(['sketch']);
    expect([...featureParents(fillet, ids)].sort()).toEqual(['boss', 'box']);
    expect([...featureParents(pattern, ids)]).toEqual(['boss']);
    expect([...featureParents(cylinder, ids)]).toEqual([]);
  });

  it('limits moves to between the last parent and the first child', () => {
    // The boss builds on the sketch (index 3); the fillet (index 6) builds on the boss.
    expect(moveRange(part, 4)).toEqual({ min: 4, max: 5, parent: 'sketch', child: 'fillet' });
    // The cylinder is free, but stays below the variables.
    expect(moveRange(part, 5)).toEqual({ min: 1, max: 7, parent: null, child: null });
    expect(moveRange(part, 0)).toMatchObject({ min: 0, max: 0 });
  });
});

describe('moving in the tree', () => {
  it('moves a feature to a gap and refuses moves that break parents or children', () => {
    // Rows: vars box plane sketch boss cyl fillet pattern | bar.
    expect(treeRows(part, null).at(-1)).toBe(ROLLBACK_ROW);
    const up = dropRow(part, null, 'cyl', 1);
    expect(up.kind === 'moved' && order(up.features)).toEqual(['vars', 'cyl', 'box', 'plane', 'sketch', 'boss', 'fillet', 'pattern']);
    expect(dropRow(part, null, 'boss', 2)).toEqual({ kind: 'refused', feature: 'boss', reason: 'parent', other: 'sketch' });
    expect(dropRow(part, null, 'boss', 8)).toEqual({ kind: 'refused', feature: 'boss', reason: 'child', other: 'fillet' });
    expect(dropRow(part, null, 'cyl', 0)).toMatchObject({ kind: 'refused', reason: 'variables' });
    expect(dropRow(part, null, 'cyl', 5)).toEqual({ kind: 'unchanged' });
    expect(dropRow(part, null, 'cyl', 6)).toEqual({ kind: 'unchanged' });
  });

  it('moves the rollback bar, and features across it', () => {
    // The bar in front of the fillet: the fillet and the pattern are not built.
    const rolled = dropRow(part, null, ROLLBACK_ROW, 6);
    expect(rolled).toMatchObject({ kind: 'moved', rollback: 'fillet' });
    expect(rollbackIndex(part, 'fillet')).toBe(6);
    expect(order(rebuildPlan(part, null, null, rollbackIndex(part, 'fillet')).features)).toEqual(['vars', 'box', 'plane', 'sketch', 'boss', 'cyl']);
    // Rows: vars box plane sketch boss cyl | bar | fillet pattern. The cylinder dragged below the bar is rolled back too.
    const below = dropRow(part, 'fillet', 'cyl', 7);
    expect(below.kind === 'moved' && [order(below.features), below.rollback]).toEqual([['vars', 'box', 'plane', 'sketch', 'boss', 'cyl', 'fillet', 'pattern'], 'cyl']);
    expect(dropRow(part, 'fillet', ROLLBACK_ROW, 0)).toMatchObject({ kind: 'refused', reason: 'variables' });
    expect(dropRow(part, 'fillet', ROLLBACK_ROW, 9)).toMatchObject({ kind: 'moved', rollback: null });
    // A rollback bar in front of a feature that is gone is at the end.
    expect(rollbackIndex(part, 'gone')).toBe(part.length);
    expect(rebuildPlan(part, null, null, part.length).features).toBe(part);
  });
});
