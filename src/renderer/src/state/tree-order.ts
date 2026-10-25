import type { Feature } from '../../../shared/model/feature.ts';
import { moveFeature, moveRange } from '../../../shared/model/dependencies.ts';
import { rollbackIndex } from './document.ts';

/** The rows of the feature tree that can be dragged: a feature (by id) or the rollback bar. */
export const ROLLBACK_ROW = 'rollback';

export type TreeRow = string;

/** The features in tree order, with the rollback bar in front of the first feature that is not built. */
export function treeRows(features: readonly Feature[], rollback: string | null): TreeRow[] {
  const rows = features.map((feature) => feature.id);
  rows.splice(rollbackIndex(features, rollback), 0, ROLLBACK_ROW);
  return rows;
}

/** What dropping a dragged row into a gap of the tree does. */
export type DropResult =
  | { kind: 'moved'; features: Feature[]; rollback: string | null }
  | { kind: 'refused'; feature: string; reason: 'parent' | 'child' | 'variables'; other: string | null }
  | { kind: 'unchanged' };

/**
 * Drops `dragged` (a feature id or ROLLBACK_ROW) into gap `gap` of treeRows (0: in front of the first
 * row, rows.length: behind the last). A feature cannot come before a feature it builds on or after one
 * that builds on it; nothing goes before the part's variables.
 */
export function dropRow(features: readonly Feature[], rollback: string | null, dragged: TreeRow, gap: number): DropResult {
  const rows = treeRows(features, rollback);
  const from = rows.indexOf(dragged);
  if (from < 0) return { kind: 'unchanged' };
  const next = [...rows];
  next.splice(from, 1);
  const at = Math.max(0, Math.min(gap > from ? gap - 1 : gap, next.length));
  next.splice(at, 0, dragged);
  if (next.every((row, i) => row === rows[i])) return { kind: 'unchanged' };
  const variables = features[0]?.type === 'variables' ? features[0].id : null;
  if (variables !== null && next[0] !== variables) {
    // The variables are needed by everything after them; the rollback bar and other features stay below them.
    return { kind: 'refused', feature: dragged === ROLLBACK_ROW ? variables : dragged, reason: 'variables', other: null };
  }
  const order = next.filter((row) => row !== ROLLBACK_ROW);
  const bar = next.indexOf(ROLLBACK_ROW);
  const nextRollback = next[bar + 1] ?? null;
  if (dragged === ROLLBACK_ROW) return { kind: 'moved', features: [...features], rollback: nextRollback };
  const index = features.findIndex((feature) => feature.id === dragged);
  const to = order.indexOf(dragged);
  const range = moveRange(features, index);
  if (to < range.min) return { kind: 'refused', feature: dragged, reason: 'parent', other: range.parent };
  if (to > range.max) return { kind: 'refused', feature: dragged, reason: 'child', other: range.child };
  return { kind: 'moved', features: moveFeature(features, index, to), rollback: nextRollback };
}
