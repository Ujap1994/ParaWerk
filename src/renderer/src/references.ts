/**
 * Reference geometry in the UI: turning picks into references, checking that they fit a field, showing
 * the reference planes, axes and points and highlighting what the edited feature refers to.
 */
import { hasReferenceGeometry, hasReferenceSlots, type ExtrudeFeature, type Feature, type SlotFeature } from '../../shared/model/feature.ts';
import { edgeRefOf, faceRefOf, resolveEdgeRefs, resolveFaceRef, resolveVertexRef, vertexRefOf } from '../../shared/model/naming.ts';
import { REFERENCE_ROLES, type GeometryRef, type ReferenceGeometry, type ReferenceRole } from '../../shared/model/reference.ts';
import { STANDARD_PLANES } from '../../shared/model/sketch.ts';
import type { CosmeticThread } from '../../shared/model/hole.ts';
import type { Frame } from '../../shared/model/frame.ts';
import { modelEnd, type AppState, type Pick } from './state/store.ts';
import type { ReferenceItem } from './viewport/reference-geometry.ts';

/** An extrusion that ends up to a surface or vertex. */
export function extrudesUpTo(feature: Feature): feature is ExtrudeFeature {
  return feature.type === 'extrude' && (feature.end === 'upToSurface' || feature.end === 'upToVertex');
}

/** Whether picks in the 3D view and the tree go to references of the edited feature (and the tree shows below the panel). */
export function picksReferences(feature: Feature | undefined): boolean {
  return feature !== undefined && (hasReferenceSlots(feature) || extrudesUpTo(feature));
}

/** The references of a feature to highlight while it is edited. */
export function builtOn(feature: Feature): GeometryRef[] {
  if (hasReferenceSlots(feature)) return feature.references;
  if (feature.type === 'revolve' && feature.axisRef) return [feature.axisRef];
  if (extrudesUpTo(feature) && feature.endRef) return [feature.endRef];
  return [];
}

/** The roles of the references the feature's method takes, in order. */
export function referenceRoles(feature: SlotFeature): readonly ReferenceRole[] {
  return (REFERENCE_ROLES[feature.type] as Record<string, readonly ReferenceRole[]>)[feature.method] ?? [];
}

/** The coordinate systems of the built part (up to the rollback bar): feature ids with where they lie. */
export function coordinateSystems(state: AppState): { id: string; index: number; frame: Frame }[] {
  const end = modelEnd(state);
  return state.history.features.flatMap((feature, index) => {
    const geometry = index < end && !feature.suppressed ? referenceGeometry(state, feature.id) : undefined;
    return geometry?.kind === 'csys' ? [{ id: feature.id, index, frame: geometry }] : [];
  });
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
      return role === 'plane' || role === 'direction';
    case 'origin':
      return role === 'point' || role === 'center';
    case 'feature': {
      const kind = referenceGeometry(state, ref.feature)?.kind ?? state.history.features.find((feature) => feature.id === ref.feature)?.type;
      // A coordinate system is a point (its origin), a plane (XY) and an axis (Z) at once.
      // A helix stands for its axis.
      if (kind === 'helix') return role === 'axis' || role === 'direction';
      return kind === 'csys' || kind === role || (kind === 'point' && role === 'center') || (role === 'direction' && (kind === 'plane' || kind === 'axis'));
    }
    case 'vertex':
      return role === 'point' || role === 'center';
    case 'face': {
      const info = pick?.kind === 'face' ? body?.faceInfo[pick.index] : undefined;
      if (role === 'center') return true;
      if (role === 'plane') return info ? info.plane !== undefined : true;
      if (role === 'axis') return info ? AXIS_SURFACES.has(info.kind) : true;
      if (role === 'direction') return info ? info.plane !== undefined || AXIS_SURFACES.has(info.kind) : true;
      return false;
    }
    case 'edge': {
      const info = pick?.kind === 'edge' ? body?.edgeInfo[pick.index] : undefined;
      if (role === 'center') return true;
      if (role === 'axis' || role === 'direction') return info ? info.kind === 'line' || info.kind === 'circle' || info.kind === 'ellipse' : true;
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

/** The cosmetic threads shown: those of tapped holes before the feature or sketch being edited, and of the edited hole. */
export function visibleThreads(state: AppState): CosmeticThread[] {
  const features = state.history.features;
  const edit = state.activeEdit;
  const end = modelEnd(state);
  const shown = new Set(features.slice(0, end).filter((feature) => feature.type === 'hole' && !feature.suppressed).map((feature) => feature.id));
  if (edit?.draft.type === 'hole' && !state.sketch) shown.add(edit.draft.id);
  return (state.rebuild?.results ?? []).flatMap((result) => (shown.has(result.id) ? (result.threads ?? []) : []));
}

/**
 * The reference planes, axes and points shown in the 3D view: those before the feature or sketch being
 * edited, and the one being edited (as a preview, highlighted), with hovered and selected ones marked.
 */
export function referenceItems(state: AppState): ReferenceItem[] {
  const features = state.history.features;
  const edit = state.activeEdit;
  const end = modelEnd(state);
  const results = new Map(state.rebuild?.results.map((result) => [result.id, result]));
  // What the edited feature is built on is highlighted: the references of reference geometry, the axis of a revolution.
  const built = edit ? builtOn(edit.draft) : [];
  const referenced = new Set(referencePicks(built, state).filter((pick) => pick.kind === 'reference').map((pick) => pick.index));
  const selected = new Set(state.selection.filter((pick) => pick.kind === 'reference').map((pick) => pick.index));
  const hovered = state.hover?.kind === 'reference' ? state.hover.index : null;
  const items: ReferenceItem[] = [];
  const add = (feature: Feature, index: number, preview: boolean) => {
    if (!hasReferenceGeometry(feature) || feature.suppressed) return;
    const geometry = results.get(feature.id)?.reference;
    if (!geometry) return;
    const style = preview ? 'preview' : hovered === index ? 'hovered' : selected.has(index) || referenced.has(index) ? 'selected' : 'normal';
    items.push({ index, geometry, style });
  };
  features.slice(0, end).forEach((feature, index) => add(feature, index, false));
  if (edit && !state.sketch) add(edit.draft, edit.index, true);
  return items;
}
