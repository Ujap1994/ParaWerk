/**
 * Reference geometry in the UI: turning picks into references, checking that they fit a field, showing
 * the reference planes, axes and points and highlighting what the edited feature refers to.
 */
import { isReferenceFeature, type Feature, type ReferenceFeature } from '../../shared/model/feature.ts';
import { edgeRefOf, faceRefOf, resolveEdgeRefs, resolveFaceRef, resolveVertexRef, vertexRefOf } from '../../shared/model/naming.ts';
import { REFERENCE_ROLES, type GeometryRef, type ReferenceGeometry, type ReferenceRole } from '../../shared/model/reference.ts';
import { STANDARD_PLANES } from '../../shared/model/sketch.ts';
import type { AppState, Pick } from './state/store.ts';
import type { ReferenceItem } from './viewport/reference-geometry.ts';

/** The roles of the references the feature's method takes, in order. */
export function referenceRoles(feature: ReferenceFeature): readonly ReferenceRole[] {
  return (REFERENCE_ROLES[feature.type] as Record<string, readonly ReferenceRole[]>)[feature.method] ?? [];
}

/** Where reference feature `id` lies, as the last rebuild computed it. */
export function referenceGeometry(state: AppState, id: string): ReferenceGeometry | undefined {
  return state.rebuild?.results.find((result) => result.id === id)?.reference;
}

/** The reference a pick stands for; null when it cannot be one (or would refer to itself or later features). */
export function referenceOfPick(pick: Pick, state: AppState): GeometryRef | null {
  const naming = state.display.body?.naming;
  switch (pick.kind) {
    case 'plane': {
      const plane = STANDARD_PLANES[pick.index];
      return plane ? { kind: 'standard-plane', plane } : null;
    }
    case 'reference': {
      const feature = state.history.features[pick.index];
      const before = state.activeEdit ? pick.index < state.activeEdit.index : true;
      return feature && before ? { kind: 'feature', feature: feature.id } : null;
    }
    case 'face':
      return naming && pick.at ? faceRefOf(naming, pick.index, pick.at) : null;
    case 'edge':
      return naming ? edgeRefOf(naming, pick.index) : null;
    case 'vertex':
      return naming ? vertexRefOf(naming, pick.index) : null;
  }
}

const AXIS_SURFACES = new Set(['cylinder', 'cone', 'torus', 'revolution']);

/** Whether a reference can play a role (a plane, an axis, a point or something with a center). */
export function referenceFits(ref: GeometryRef, role: ReferenceRole, state: AppState, pick?: Pick): boolean {
  const body = state.display.body;
  switch (ref.kind) {
    case 'standard-plane':
      return role === 'plane';
    case 'origin':
      return role === 'point' || role === 'center';
    case 'feature': {
      const kind = referenceGeometry(state, ref.feature)?.kind ?? state.history.features.find((feature) => feature.id === ref.feature)?.type;
      return kind === role || (kind === 'point' && role === 'center');
    }
    case 'vertex':
      return role === 'point' || role === 'center';
    case 'face': {
      const info = pick?.kind === 'face' ? body?.faceInfo[pick.index] : undefined;
      if (role === 'center') return true;
      if (role === 'plane') return info ? info.plane !== undefined : true;
      if (role === 'axis') return info ? AXIS_SURFACES.has(info.kind) : true;
      return false;
    }
    case 'edge': {
      const info = pick?.kind === 'edge' ? body?.edgeInfo[pick.index] : undefined;
      if (role === 'center') return true;
      if (role === 'axis') return info ? info.kind === 'line' || info.kind === 'circle' || info.kind === 'ellipse' : true;
      return false;
    }
  }
}

/** The part of the state references are looked up in: the shown body and the features. */
export type ReferenceState = { display: AppState['display']; history: AppState['history'] };

/** What the references of the edited reference feature point at in the shown body, for highlighting. */
export function referencePicks(refs: readonly GeometryRef[], state: ReferenceState): Pick[] {
  const naming = state.display.body?.naming;
  return refs.flatMap((ref): Pick[] => {
    switch (ref.kind) {
      case 'standard-plane':
        return [{ kind: 'plane', index: STANDARD_PLANES.indexOf(ref.plane) }];
      case 'feature': {
        const index = state.history.features.findIndex((feature) => feature.id === ref.feature);
        return index >= 0 ? [{ kind: 'reference', index }] : [];
      }
      case 'origin':
        return [];
      case 'face': {
        const match = naming ? resolveFaceRef(ref, naming, () => 0) : null;
        return match ? [{ kind: 'face', index: match.index }] : [];
      }
      case 'edge': {
        const match = naming ? resolveEdgeRefs([ref], naming)[0] : null;
        return match ? [{ kind: 'edge', index: match.index }] : [];
      }
      case 'vertex': {
        const match = naming ? resolveVertexRef(ref, naming) : null;
        return match ? [{ kind: 'vertex', index: match.index }] : [];
      }
    }
  });
}

/**
 * The reference planes, axes and points shown in the 3D view: those before the feature or sketch being
 * edited, and the one being edited (as a preview, highlighted), with hovered and selected ones marked.
 */
export function referenceItems(state: AppState): ReferenceItem[] {
  const features = state.history.features;
  const edit = state.activeEdit;
  const end = state.sketch?.index ?? edit?.index ?? features.length;
  const results = new Map(state.rebuild?.results.map((result) => [result.id, result]));
  const referenced = new Set(edit && isReferenceFeature(edit.draft) ? referencePicks(edit.draft.references, state).filter((pick) => pick.kind === 'reference').map((pick) => pick.index) : []);
  const selected = new Set(state.selection.filter((pick) => pick.kind === 'reference').map((pick) => pick.index));
  const hovered = state.hover?.kind === 'reference' ? state.hover.index : null;
  const items: ReferenceItem[] = [];
  const add = (feature: Feature, index: number, preview: boolean) => {
    if (!isReferenceFeature(feature) || feature.suppressed) return;
    const geometry = results.get(feature.id)?.reference;
    if (!geometry) return;
    const style = preview ? 'preview' : hovered === index ? 'hovered' : selected.has(index) || referenced.has(index) ? 'selected' : 'normal';
    items.push({ index, geometry, style });
  };
  features.slice(0, end).forEach((feature, index) => add(feature, index, false));
  if (edit && !state.sketch) add(edit.draft, edit.index, true);
  return items;
}
