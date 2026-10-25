/**
 * Parent and child relations between the features of a part: which features a feature builds on. A
 * feature must come after every feature it builds on, so moving features in the tree is checked here.
 */

import type { Feature } from './feature.ts';

/**
 * Ids of the features that `feature` builds on: its sketch, the reference geometry, edges and faces it
 * references (face names start with the id of the feature that made the face, see
 * docs/adr/0002-persistent-naming.md), the features it copies and what its sketch plane lies on.
 * `ids` are the ids of the part's features.
 */
export function featureParents(feature: Feature, ids: ReadonlySet<string>): Set<string> {
  const parents = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const colon = value.indexOf(':');
      const id = colon >= 0 ? value.slice(0, colon) : value;
      if (id !== feature.id && ids.has(id)) parents.add(id);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  for (const [key, value] of Object.entries(feature)) {
    // The own id and name, equations and the geometry of a sketch (entity ids) never name another feature.
    if (key === 'id' || key === 'name' || key === 'expressions' || (key === 'sketch' && typeof value === 'object')) continue;
    visit(value);
  }
  return parents;
}

/** Where the feature at `index` can go (positions in the list after the move, both inclusive). */
export interface MoveRange {
  min: number;
  max: number;
  /** The last feature it builds on, which keeps it from moving further up. */
  parent: string | null;
  /** The first feature that builds on it, which keeps it from moving further down. */
  child: string | null;
}

/**
 * How far the feature at `index` can move up and down without coming before a feature it builds on or
 * after a feature that builds on it. The part's variables stay at the top.
 */
export function moveRange(features: readonly Feature[], index: number): MoveRange {
  const feature = features[index];
  if (!feature || feature.type === 'variables') return { min: index, max: index, parent: null, child: null };
  const ids = new Set(features.map((candidate) => candidate.id));
  const parents = featureParents(feature, ids);
  let min = features[0]?.type === 'variables' ? 1 : 0;
  let parent: string | null = null;
  for (let i = 0; i < index; i++) {
    const candidate = features[i];
    if (candidate && parents.has(candidate.id)) {
      min = i + 1;
      parent = candidate.id;
    }
  }
  // After the feature is taken out, the features behind it move up by one.
  let max = features.length - 1;
  let child: string | null = null;
  for (let i = index + 1; i < features.length; i++) {
    const candidate = features[i];
    if (candidate && featureParents(candidate, ids).has(feature.id)) {
      max = i - 1;
      child = candidate.id;
      break;
    }
  }
  return { min, max, parent, child };
}

/** The features with the one at `from` moved to position `to` (in the list after the move). */
export function moveFeature(features: readonly Feature[], from: number, to: number): Feature[] {
  const next = [...features];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}
