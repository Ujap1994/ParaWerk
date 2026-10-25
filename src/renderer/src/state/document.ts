import { BODY_TYPES, type Feature, type FeatureType } from '../../../shared/model/feature.ts';
import { NO_PROPERTIES, type PartProperties } from '../../../shared/model/material.ts';

/** Undo steps kept per document. */
export const HISTORY_LIMIT = 200;

/** The document as one undo step sees it: the features and the part's material and color. */
export interface Snapshot {
  features: Feature[];
  properties?: PartProperties;
}

export interface History {
  features: Feature[];
  /** Material and color of the part; absent: none. */
  properties?: PartProperties;
  past: Snapshot[];
  future: Snapshot[];
}

export function emptyHistory(features: Feature[] = [], properties: PartProperties = NO_PROPERTIES): History {
  return { features, properties, past: [], future: [] };
}

function snapshot(history: History): Snapshot {
  return { features: history.features, properties: history.properties ?? NO_PROPERTIES };
}

export function commit(history: History, features: Feature[], properties: PartProperties = history.properties ?? NO_PROPERTIES): History {
  return { features, properties, past: [...history.past, snapshot(history)].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { ...previous, properties: previous.properties ?? NO_PROPERTIES, past: history.past.slice(0, -1), future: [snapshot(history), ...history.future] };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return { ...next, properties: next.properties ?? NO_PROPERTIES, past: [...history.past, snapshot(history)], future: history.future.slice(1) };
}

/**
 * Position of the rollback bar: the index of the first feature that is not built (`rollback` is its
 * id; null, or a feature that no longer exists, puts the bar at the end). New features are inserted
 * there.
 */
export function rollbackIndex(features: readonly Feature[], rollback: string | null): number {
  if (rollback === null) return features.length;
  const index = features.findIndex((feature) => feature.id === rollback);
  return index < 0 ? features.length : index;
}

/** A feature being created or edited in the property panel. */
export interface ActiveEdit {
  mode: 'create' | 'edit';
  /** Position of the draft in the feature list. */
  index: number;
  draft: Feature;
}

export interface RebuildPlan {
  features: Feature[];
  /** Feature indices whose resulting body is needed (see CapturedState). */
  captures: number[];
}

/**
 * What the kernel has to build for the current state.
 *
 * While a feature is edited, everything after it is rolled back and the body
 * before the feature is captured too, so its edges can be picked. In sketch mode
 * the model is rolled back to the sketch (`sketchIndex`). Otherwise it is built up
 * to the rollback bar (`end`, see rollbackIndex).
 */
export function rebuildPlan(features: Feature[], edit: ActiveEdit | null, sketchIndex: number | null = null, end = features.length): RebuildPlan {
  // The whole part is the same list, so references healed by the kernel can be taken over (see rebuild.ts).
  const built = end >= features.length ? features : features.slice(0, end);
  // Editing the variables changes nothing until they are applied: the part stays visible as it is.
  if (edit?.draft.type === 'variables') return { features: built, captures: [built.length - 1] };
  if (sketchIndex !== null) {
    const before = features.slice(0, sketchIndex);
    return { features: before, captures: [before.length - 1] };
  }
  if (!edit) return { features: built, captures: [built.length - 1] };
  const before = features.slice(0, edit.index);
  return { features: [...before, edit.draft], captures: [edit.index - 1, edit.index] };
}

export function applyEdit(features: Feature[], edit: ActiveEdit): Feature[] {
  const next = [...features];
  if (edit.mode === 'create') next.splice(edit.index, 0, edit.draft);
  else next[edit.index] = edit.draft;
  return next;
}

/** The name of the feature at `index` as the tree shows it: the user's name, else e.g. "Fillet2". */
export function featureName(features: readonly Feature[], index: number, translate: (key: string) => string): string {
  const feature = features[index];
  if (!feature) return '';
  // A part has one list of variables, so it needs no number.
  if (feature.type === 'variables') return feature.name ?? translate('features.variables');
  return feature.name ?? `${translate(`features.${feature.type}`)}${featureOrdinal(features, index)}`;
}

/** 1-based number of a feature among features of the same type, for default names like "Fillet2". */
export function featureOrdinal(features: readonly Feature[], index: number): number {
  const type: FeatureType | undefined = features[index]?.type;
  let count = 0;
  for (let i = 0; i <= index; i++) if (features[i]?.type === type) count++;
  return count;
}

export function hasBodyBefore(features: readonly Feature[], index: number): boolean {
  return features.slice(0, index).some((feature) => !feature.suppressed && BODY_TYPES.has(feature.type));
}
