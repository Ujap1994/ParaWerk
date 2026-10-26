import { resolveLanguage } from '../../shared/i18n.ts';
import type { MenuCommand } from '../../shared/ipc.ts';
import { PART_FILE_EXTENSION } from '../../shared/app-info.ts';
import { hashString } from '../../shared/hash.ts';
import { COPYABLE_TYPES, isCurveFeature, createFeatureId, type ImportFeature, defaultFeature, type BooleanOperation, hasReferenceSlots, isCopyFeature, isEdgeFeature, isReferenceFeature, sketchesUsedBy, type EdgeRef, type ExtrudeEnd, extrudesOneWay, type Feature, type FilletMethod, roundFaceCount, type FeatureType, type HoleFeature, type ReferenceFeature, type SketchFeature, type SlotFeature } from '../../shared/model/feature.ts';
import { holePositions, METRIC_SIZES, metricSize, sizesFor, standardHoleDimensions, type MetricSize } from '../../shared/model/hole.ts';
import { frameTransform } from '../../shared/model/frame.ts';
import { sketchProfile } from '../../shared/model/profile.ts';
import { DEFAULT_THIN_THICKNESS, type ThinSide } from '../../shared/model/thin.ts';
import { AXIS_METHODS, CSYS_METHODS, PLANE_METHODS, POINT_METHODS, REFERENCE_ROLES, type GeometryRef, type ReferenceRole } from '../../shared/model/reference.ts';
import { bodiesOf, bodiesOfRefs, bodyOfFace } from './bodies.ts';
import { coordinateSystems, extrudesUpTo, referenceFits, referenceGeometry, referenceOfPick, referencePicks, referenceRoles } from './references.ts';
import { edgeRefOf, faceRefOf, resolveEdgeRefs } from '../../shared/model/naming.ts';
import { decodePartFile, encodePartFile, PartFileError } from '../../shared/model/part-file.ts';
import { frameOf, frameOnPlane, isDimension, ORIGIN_ID, STANDARD_PLANES, type SketchData, type SketchDimension, type SketchPlaneRef } from '../../shared/model/sketch.ts';
import { CUSTOM_MATERIAL, DEFAULT_PART_COLOR, partColor, type PartMaterial, type PartProperties } from '../../shared/model/material.ts';
import { addConfiguration, applyConfiguration, freeConfigurationName, switchConfiguration, type Configuration, type Configurations } from '../../shared/model/configurations.ts';
import type { Settings } from '../../shared/settings.ts';
import { changeLanguage, t } from './i18n.ts';
import { SketchBuilder } from './sketch/builder.ts';
import { storedAngle, type DimensionDraft } from './sketch/dimensions.ts';
import { convertEdges } from './sketch/convert.ts';
import { curvePoints, deleteEntities, isCurve } from './sketch/geometry.ts';
import { applicableRelations, type RelationKind } from './sketch/relations.ts';
import { sketchSolver } from './sketch/solver.ts';
import { dxfToSketch, sketchToDxf } from './sketch/dxf.ts';
import { offsetSelection } from './sketch/offset.ts';
import { circularPattern, copySelection, linearPattern, mirrorSelection, movedPoints, scaledCopy, scaledInPlace, type TransformResult } from './sketch/transform.ts';
import { sameGeometry } from './sketch/drag.ts';
import type { Point2 } from './sketch/geometry.ts';
import {
  applySketchSession,
  hasSketchChanges,
  openSketchSession,
  recordSketch,
  redoSketch,
  undoSketch,
  type SketchSession,
} from './sketch/session.ts';
import { applyEdit, commit, emptyHistory, featureName, hasBodyBefore, redo as redoHistory, rollbackIndex, undo as undoHistory, type ActiveEdit } from './state/document.ts';
import { dropRow, type TreeRow } from './state/tree-order.ts';
import { regenerate, variablesFeature } from './variables.ts';
import { kernel, whenIdle } from './state/rebuild.ts';
import { getState, modelEnd, partProperties, setHistory, setState, showToast, type AppState, type CommandTab, type Pick } from './state/store.ts';
import type { SketchToolName } from './sketch/tools.ts';
import { offsetRange, type SectionPlane, type SectionSettings } from './section.ts';
import { sketchToolControl, viewport } from './viewport/registry.ts';
import type { StandardView } from './viewport/views.ts';

const api = () => window.parawerk;

function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, '');
}

/** State that leaves every mode (feature edit, sketch) without storing anything. */
function closedModes(): Partial<AppState> {
  return {
    activeEdit: null,
    sketch: null,
    choosingSketchPlane: false,
    selection: [],
    hover: null,
    sketchSelection: [],
    sketchHover: null,
    sketchTool: null,
    commandTab: 'features',
  };
}

function documentName(): string {
  return getState().fileName ?? t('app.untitled');
}

function isTextInputFocused(): boolean {
  const element = document.activeElement;
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

async function confirmDiscard(): Promise<boolean> {
  if (!getState().dirty) return true;
  return api().confirm({
    message: t('dialogs.discardMessage'),
    detail: t('dialogs.discardDetail', { name: documentName() }),
    confirmLabel: t('dialogs.discard'),
    cancelLabel: t('dialogs.cancel'),
  });
}

// ------------------------------------------------------------------ documents

export async function newDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const history = emptyHistory();
  setState({ history, savedFeatures: history.features, savedProperties: partProperties(history), dirty: false, filePath: null, fileName: null, rollback: null, ...closedModes() });
  viewport()?.requestFitOnNextBody();
  viewport()?.setStandardView('isometric');
}

export function loadDocument(path: string, data: Uint8Array): void {
  try {
    const { document } = decodePartFile(data);
    const history = emptyHistory(document.features, document.properties);
    setState({
      history,
      savedFeatures: history.features,
      savedProperties: partProperties(history),
      dirty: false,
      filePath: path,
      fileName: baseName(path),
      rollback: null,
      ...closedModes(),
    });
    viewport()?.requestFitOnNextBody();
    showToast('success', t('toasts.opened', { name: baseName(path) }));
  } catch (error) {
    const message =
      error instanceof PartFileError ? t(`fileErrors.${error.code}`, { detail: error.message }) : error instanceof Error ? error.message : String(error);
    showToast('error', t('toasts.openFailed', { message }));
  }
}

export async function openDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const result = await api().openFile({
    title: t('dialogs.openTitle'),
    filters: [{ name: t('dialogs.partFiles'), extensions: [PART_FILE_EXTENSION] }],
  });
  if (result.status === 'opened') loadDocument(result.path, result.data);
  else if (result.status === 'error') showToast('error', t('toasts.openFailed', { message: result.message }));
}

export async function openFromSystem(path: string, data: Uint8Array): Promise<void> {
  if (!(await confirmDiscard())) return;
  loadDocument(path, data);
}

export async function saveDocument(saveAs = false): Promise<boolean> {
  if (getState().activeEdit) commitEdit();
  storeOpenSketch();
  const state = getState();
  const data = encodePartFile(
    { units: 'mm', features: state.history.features, properties: partProperties(state.history) },
    { appVersion: state.appInfo?.version ?? 'dev', savedAt: new Date().toISOString() },
  );
  const result = await api().saveFile({
    title: t('dialogs.saveTitle'),
    defaultName: `${documentName()}.${PART_FILE_EXTENSION}`,
    filters: [{ name: t('dialogs.partFiles'), extensions: [PART_FILE_EXTENSION] }],
    data,
    ...(saveAs || !state.filePath ? {} : { path: state.filePath }),
  });
  if (result.status === 'saved') {
    setState({ filePath: result.path, fileName: baseName(result.path), savedFeatures: state.history.features, savedProperties: partProperties(state.history), dirty: false });
    showToast('success', t('toasts.saved', { name: baseName(result.path) }));
    return true;
  }
  if (result.status === 'error') showToast('error', t('toasts.saveFailed', { message: result.message }));
  return false;
}

/** The part's material for a 3MF file: its name and the color the part is shown in. */
function exportMaterial(): { name: string; color: string } | undefined {
  const properties = partProperties(getState().history);
  const color = partColor(properties);
  const material = properties.material;
  if (!material && !color) return undefined;
  const name = !material ? documentName() : material.id === CUSTOM_MATERIAL ? (material.name ?? t('material.custom')) : t(`material.names.${material.id}`);
  return { name, color: color ?? DEFAULT_PART_COLOR };
}

/** The file type of each export format: extensions (the first is the default) and the filter name. */
const EXPORT_FILES = {
  step: { extensions: ['step', 'stp'], filter: 'dialogs.stepFiles' },
  stl: { extensions: ['stl'], filter: 'dialogs.stlFiles' },
  '3mf': { extensions: ['3mf'], filter: 'dialogs.threeMfFiles' },
} as const;

export async function exportModel(format: 'step' | 'stl' | '3mf'): Promise<void> {
  // With coordinate systems in the part, the export asks which one the file is in.
  if (coordinateSystems(getState()).length > 0) {
    setState({ exporting: format });
    return;
  }
  await writeExport(format, null);
}

/** Exports in the chosen coordinate system (feature id; null: the model's own axes), or (cancel) not at all. */
export async function confirmExport(frameId: string | null | 'cancel'): Promise<void> {
  const format = getState().exporting;
  setState({ exporting: null });
  if (!format || frameId === 'cancel') return;
  setState({ exportFrame: frameId });
  await writeExport(format, frameId);
}

async function writeExport(format: 'step' | 'stl' | '3mf', frameId: string | null): Promise<void> {
  const state = getState();
  const features = state.history.features;
  const frame = frameId ? coordinateSystems(state).find((system) => system.id === frameId)?.frame : undefined;
  let data: Uint8Array;
  try {
    await whenIdle();
    const material = format === '3mf' ? exportMaterial() : undefined;
    data = await kernel().exportModel({
      features,
      format,
      ...(format === '3mf' ? { title: documentName(), application: `ParaWerk ${state.appInfo?.version ?? ''}`.trim(), ...(material ? { material } : {}) } : {}),
      ...(frame ? { transform: frameTransform(frame) } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showToast('error', message === 'nothing-to-export' ? t('toasts.nothingToExport') : t('toasts.exportFailed', { message }));
    return;
  }
  const file = EXPORT_FILES[format];
  const result = await api().saveFile({
    title: t('dialogs.exportTitle'),
    defaultName: `${documentName()}.${file.extensions[0]}`,
    filters: [{ name: t(file.filter), extensions: [...file.extensions] }],
    data,
  });
  if (result.status === 'saved') showToast('success', t('toasts.exported', { name: result.path.split(/[\\/]/).pop() ?? result.path }));
  else if (result.status === 'error') showToast('error', t('toasts.exportFailed', { message: result.message }));
}

// ------------------------------------------------------------------ STEP import

/** Largest STEP file imported (characters). */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** Asks for a STEP file; its name and contents (text), or null. */
async function chooseStepFile(): Promise<{ file: string; data: string; hash: string } | null> {
  const result = await api().openFile({ title: t('dialogs.importTitle'), filters: [{ name: t('dialogs.stepFiles'), extensions: ['step', 'stp'] }] });
  if (result.status === 'error') showToast('error', t('toasts.importFailed', { message: result.message }));
  if (result.status !== 'opened') return null;
  if (result.data.byteLength > MAX_IMPORT_BYTES) {
    showToast('error', t('toasts.importFailed', { message: t('import.tooLarge') }));
    return null;
  }
  // STEP files are ASCII (ISO 10303-21); the decoder keeps any other bytes readable.
  const data = new TextDecoder('latin1').decode(result.data);
  if (!data.trimStart().startsWith('ISO-10303-21')) {
    showToast('error', t('toasts.importFailed', { message: t('import.notStep') }));
    return null;
  }
  return { file: result.path.split(/[\\/]/).pop() ?? result.path, data, hash: hashString(data) };
}

/** Imports the solids of a STEP file as a feature at the rollback bar (a body of its own, or cut out). */
export async function importStepFile(): Promise<void> {
  const state = getState();
  if (state.sketch || state.choosingSketchPlane) return;
  const chosen = await chooseStepFile();
  if (!chosen) return;
  if (getState().activeEdit) commitEdit();
  const index = modelEnd(getState());
  const draft: Feature = { ...(defaultFeature('import') as ImportFeature), ...chosen, operation: 'add' };
  setState({ activeEdit: { mode: 'create', index, draft }, selection: [] });
}

/** Replaces the file of the import feature being edited (the faces get new names). */
export async function replaceImportedFile(): Promise<void> {
  if (getState().activeEdit?.draft.type !== 'import') return;
  const chosen = await chooseStepFile();
  if (chosen && getState().activeEdit?.draft.type === 'import') updateDraft(chosen);
}

// ------------------------------------------------------------------ features

export function startFeature(type: FeatureType): void {
  if (type === 'sketch') {
    startSketch();
    return;
  }
  if (type === 'variables') {
    editVariables();
    return;
  }
  const state = getState();
  if (state.sketch || state.choosingSketchPlane) return;
  if (state.activeEdit) commitEdit();
  // New features go in at the rollback bar; they see only the features before it.
  const index = modelEnd(getState());
  const features = getState().history.features.slice(0, index);
  let draft: Feature = defaultFeature(type);
  if (draft.type === 'extrude' || draft.type === 'revolve') {
    const sketch = sketchToUse(features);
    if (!sketch) {
      showToast('info', t('toasts.noSketchToExtrude'));
      return;
    }
    const operation = hasBodyBefore(features, index) ? draft.operation : 'add';
    // A sketch of open curves only becomes walls along them (a thin feature).
    const thin = sketchProfile(sketch.sketch).regions.length === 0 ? { thin: 'one' as const, thickness: DEFAULT_THIN_THICKNESS } : {};
    if (draft.type === 'extrude') {
      draft = { ...draft, sketch: sketch.id, operation, ...thin };
    } else {
      // Without a centerline in the sketch, the last reference axis is the axis.
      const axis = defaultAxis(sketch);
      const reference = features.findLast((feature) => feature.type === 'axis' && !feature.suppressed);
      draft = axis || !reference ? { ...draft, sketch: sketch.id, axis, operation, ...thin } : { ...draft, sketch: sketch.id, axis: '', axisRef: { kind: 'feature', feature: reference.id }, operation, ...thin };
    }
  } else if (draft.type === 'thread') {
    // A cylindrical face selected before starting is the face of the thread (select first, then act).
    const pick = getState().selection.find((candidate) => candidate.kind === 'face');
    const body = getState().display.body;
    const info = pick ? body?.faceInfo[pick.index] : undefined;
    const ref = pick?.at && body && info?.kind === 'cylinder' ? faceRefOf(body.naming, pick.index, pick.at) : null;
    if (ref && info?.radius !== undefined) {
      const size = threadSizeFor(info.radius);
      draft = { ...draft, faces: [ref], size: size.size, pitch: size.pitch };
    }
  } else if (draft.type === 'rib') {
    // A rib is drawn as open curves: the newest sketch without closed outlines that no feature uses yet.
    const used = new Set(features.flatMap(sketchesUsedBy));
    const sketches = features.filter((feature): feature is SketchFeature => feature.type === 'sketch' && !feature.suppressed);
    const open = (sketch: SketchFeature) => sketchProfile(sketch.sketch).regions.length === 0;
    const sketch = sketches.findLast((candidate) => !used.has(candidate.id) && open(candidate)) ?? sketches.findLast(open) ?? sketchToUse(features);
    if (!sketch) {
      showToast('info', t('toasts.noSketchToExtrude'));
      return;
    }
    draft = { ...draft, sketch: sketch.id };
  } else if (draft.type === 'sweep' || draft.type === 'loft') {
    // Sketches no feature uses yet: those with closed outlines are profiles, one without is a path.
    const operation = hasBodyBefore(features, index) ? draft.operation : 'add';
    const used = new Set(features.flatMap(sketchesUsedBy));
    const sketches = features.filter((feature): feature is SketchFeature => feature.type === 'sketch' && !feature.suppressed);
    const unused = sketches.filter((sketch) => !used.has(sketch.id));
    const outlined = (sketch: SketchFeature) => sketchProfile(sketch.sketch).regions.length > 0;
    if (draft.type === 'sweep') {
      const profile = unused.findLast(outlined) ?? sketches.findLast(outlined);
      // The path: the newest curve, helix or sketch of open curves no other sweep follows yet.
      const paths = features.filter((feature) => !feature.suppressed && ((feature.type === 'sketch' && feature !== profile && !outlined(feature)) || feature.type === 'helix' || isCurveFeature(feature)));
      const path = paths.findLast((feature) => !used.has(feature.id)) ?? paths.at(-1);
      if (!profile || !path) {
        showToast('info', t('toasts.noSweepSketches'));
        return;
      }
      draft = { ...draft, operation, sketch: profile.id, path: path.id };
    } else {
      const unusedOutlines = unused.filter(outlined);
      const chosen = unusedOutlines.length >= 2 ? unusedOutlines : sketches.filter(outlined).slice(-2);
      if (chosen.length < 2) {
        showToast('info', t('toasts.noLoftSketches'));
        return;
      }
      draft = { ...draft, operation, sketches: chosen.map((sketch) => sketch.id) };
    }
  } else if (draft.type === 'combine' || draft.type === 'deleteBody') {
    // Faces selected before starting pick their bodies, one face each.
    const naming = getState().display.body?.naming;
    const seen = new Set<number>();
    const bodies = naming
      ? getState().selection.flatMap((pick) => {
          const body = pick.kind === 'face' ? bodyOfFace(naming, pick.index) : null;
          if (body === null || seen.has(body) || !pick.at) return [];
          seen.add(body);
          return faceRefOf(naming, pick.index, pick.at) ?? [];
        })
      : [];
    draft = { ...draft, bodies };
  } else if (draft.type === 'projectedCurve' || draft.type === 'compositeCurve') {
    // Faces (a projected curve) or edges (a composite curve) selected before starting are taken over.
    const naming = getState().display.body?.naming;
    const selection = getState().selection;
    if (draft.type === 'projectedCurve') {
      const sketch = sketchToUse(features);
      if (!sketch) {
        showToast('info', t('toasts.noCurveSketch'));
        return;
      }
      const faces = naming ? selection.flatMap((pick) => (pick.kind === 'face' && pick.at ? (faceRefOf(naming, pick.index, pick.at) ?? []) : [])) : [];
      draft = { ...draft, sketch: sketch.id, faces };
    } else {
      const edges = naming ? selection.flatMap((pick) => (pick.kind === 'edge' ? (edgeRefOf(naming, pick.index) ?? []) : [])) : [];
      draft = { ...draft, edges };
    }
  } else if (draft.type === 'helix') {
    // Around the circle of the newest sketch with one that no feature uses yet.
    const used = new Set(features.flatMap(sketchesUsedBy));
    const circled = features.filter((feature): feature is SketchFeature => feature.type === 'sketch' && !feature.suppressed && feature.sketch.entities.some((entity) => entity.type === 'circle' && !entity.construction));
    const sketch = circled.findLast((candidate) => !used.has(candidate.id)) ?? circled.at(-1);
    if (!sketch) {
      showToast('info', t('toasts.noHelixSketch'));
      return;
    }
    draft = { ...draft, sketch: sketch.id };
  } else if (draft.type === 'hole') {
    const sketch = holeSketchToUse(features);
    if (!sketch) {
      showToast('info', t('toasts.noHoleSketch'));
      return;
    }
    draft = { ...draft, sketch: sketch.id };
  } else if (isEdgeFeature(draft)) {
    // Edges and faces selected before starting the command are taken over (select first, then act).
    const naming = getState().display.body?.naming;
    const selection = getState().selection;
    const edges: EdgeRef[] = naming
      ? selection.flatMap((pick) => {
          const ref = pick.kind === 'edge' ? edgeRefOf(naming, pick.index) : null;
          return ref ? [ref] : [];
        })
      : [];
    const faces = naming
      ? selection.flatMap((pick) => {
          const ref = pick.kind === 'face' && pick.at ? faceRefOf(naming, pick.index, pick.at) : null;
          return ref ? [ref] : [];
        })
      : [];
    draft = { ...draft, edges, ...(faces.length > 0 ? { faces } : {}) };
  } else if (isReferenceFeature(draft)) {
    // What was selected before starting becomes the references, and decides the method (select first, then act).
    draft = withSelectedReferences(draft, getState().selection);
  } else if (draft.type === 'shell') {
    // Faces selected before starting are opened (select first, then act).
    const naming = getState().display.body?.naming;
    const faces = naming
      ? getState().selection.flatMap((pick) => {
          const ref = pick.kind === 'face' && pick.at ? faceRefOf(naming, pick.index, pick.at) : null;
          return ref ? [ref] : [];
        })
      : [];
    draft = { ...draft, faces };
  } else if (isCopyFeature(draft)) {
    // Faces selected before starting name the features to copy.
    const seeds = getState().selection.flatMap((pick) => (pick.kind === 'face' ? [seedOfFace(pick.index)] : [])).filter((id): id is string => id !== null);
    draft = { ...draft, features: [...new Set(seeds)] };
  } else if (!hasBodyBefore(features, index) && (draft.type === 'box' || draft.type === 'cylinder')) {
    draft = { ...draft, operation: 'add' };
  }
  const slot = hasReferenceSlots(draft) ? firstEmptySlot(draft) : 0;
  setState({ activeEdit: { mode: 'create', index, draft }, selection: [], referenceSlot: slot });
}

/** The sketch a new extrusion or revolution uses: the last one no such feature uses yet, else the last one. */
function sketchToUse(features: readonly Feature[]): SketchFeature | null {
  const used = new Set(features.flatMap(sketchesUsedBy));
  const sketches = features.filter((feature): feature is SketchFeature => feature.type === 'sketch' && !feature.suppressed);
  return sketches.findLast((sketch) => !used.has(sketch.id)) ?? sketches.at(-1) ?? null;
}

/** The sketch a new hole uses: the newest one with points for holes that no feature uses yet, else the newest with such points. */
function holeSketchToUse(features: readonly Feature[]): SketchFeature | null {
  const used = new Set(features.flatMap(sketchesUsedBy));
  const sketches = features.filter((feature): feature is SketchFeature => feature.type === 'sketch' && !feature.suppressed && holePositions(feature.sketch).length > 0);
  return sketches.findLast((sketch) => !used.has(sketch.id)) ?? sketches.at(-1) ?? null;
}

/**
 * Changes the kind, size or fit of the edited hole; its dimensions follow the standard tables again
 * (sizes a kind does not come in fall back to the nearest one it does).
 */
export function setHoleType(patch: { kind?: HoleFeature['kind']; size?: string; fit?: HoleFeature['fit'] }): void {
  const edit = getState().activeEdit;
  if (edit?.draft.type !== 'hole') return;
  const kind = patch.kind ?? edit.draft.kind;
  const sizes = sizesFor(kind);
  const wanted = metricSize(patch.size ?? edit.draft.size);
  const size = sizes.some((entry) => entry.size === wanted?.size) ? (wanted?.size ?? 'M6') : (sizes.reduce((a, b) => (Math.abs(b.d - (wanted?.d ?? 6)) < Math.abs(a.d - (wanted?.d ?? 6)) ? b : a)).size);
  const fit = patch.fit ?? edit.draft.fit;
  const dimensions = standardHoleDimensions(kind, size, fit);
  if (!dimensions) return;
  // Equations of the dimensions are replaced by the standard values.
  const { expressions: _expressions, ...draft } = edit.draft;
  setState({ activeEdit: { ...edit, draft: { ...draft, kind, size, fit, ...dimensions } } });
}

/** The axis a revolution of a sketch starts with: its first centerline (none if it has no centerline). */
function defaultAxis(sketch: SketchFeature): string {
  return sketch.sketch.entities.find((entity) => entity.type === 'line' && entity.construction)?.id ?? '';
}

/** Chooses the axis of the revolution being edited: a line id of its sketch, or `feature:<id>` for a reference axis. */
export function chooseRevolveAxis(value: string): void {
  const edit = getState().activeEdit;
  if (edit?.draft.type !== 'revolve') return;
  const { axisRef: _old, ...draft } = edit.draft;
  const feature = value.startsWith('feature:') ? value.slice('feature:'.length) : null;
  const next = feature ? { ...draft, axis: '', axisRef: { kind: 'feature' as const, feature } } : { ...draft, axis: value };
  setState({ activeEdit: { ...edit, draft: next } });
}

/** Chooses the sketch of the extrusion or revolution being edited (a revolution also takes its centerline). */
export function chooseFeatureSketch(id: string): void {
  const draft = getState().activeEdit?.draft;
  if (draft?.type === 'extrude' || draft?.type === 'hole' || draft?.type === 'sweep' || draft?.type === 'rib' || draft?.type === 'helix' || draft?.type === 'projectedCurve') updateDraft({ sketch: id });
  if (draft?.type !== 'revolve') return;
  const sketch = getState().history.features.find((feature): feature is SketchFeature => feature.type === 'sketch' && feature.id === id);
  updateDraft({ sketch: id, axis: sketch ? defaultAxis(sketch) : '' });
}

// ------------------------------------------------------------------ reference geometry

const METHODS = { plane: PLANE_METHODS, axis: AXIS_METHODS, point: POINT_METHODS, csys: CSYS_METHODS } as const;

/** The first method of the feature's type whose references fit `refs` in this order. */
function methodFor(type: ReferenceFeature['type'], refs: readonly { ref: GeometryRef; pick: Pick }[]): string | null {
  const state = getState();
  const roles = REFERENCE_ROLES[type] as Record<string, readonly ReferenceRole[]>;
  return (
    METHODS[type].find((method) => {
      const wanted = roles[method] ?? [];
      return wanted.length === refs.length && wanted.every((role, i) => refs[i] !== undefined && referenceFits(refs[i].ref, role, state, refs[i].pick));
    }) ?? null
  );
}

/** A new reference feature with the selection as its references, in an order and with a method they fit. */
function withSelectedReferences(draft: ReferenceFeature, selection: readonly Pick[]): ReferenceFeature {
  const state = getState();
  const refs = selection.flatMap((pick) => {
    const ref = referenceOfPick(pick, state);
    return ref ? [{ ref, pick }] : [];
  });
  if (refs.length === 0) return draft;
  // Try the selection as picked, then the other way round (an axis picked before its plane, for example).
  for (const order of [refs, [...refs].reverse()]) {
    const method = methodFor(draft.type, order);
    if (method) return { ...draft, method, references: order.map((entry) => entry.ref) } as ReferenceFeature;
  }
  return draft;
}

/**
 * The field the next pick fills: the list of features to copy while a pattern or mirror has none, else the
 * first empty reference field (FEATURES_SLOT stands for the list).
 */
function firstEmptySlot(feature: SlotFeature): number {
  if (isCopyFeature(feature) && feature.features.length === 0) return FEATURES_SLOT;
  // A draft takes its neutral plane first, then any number of faces.
  if (feature.type === 'draft') return feature.references.length === 0 ? 0 : FEATURES_SLOT;
  const roles = referenceRoles(feature);
  const empty = roles.findIndex((_, slot) => feature.references[slot] === undefined);
  return empty >= 0 ? empty : Math.max(0, roles.length - 1);
}

/** Starts a pattern around an axis. */
export function startCircularPattern(): void {
  startFeature('pattern');
  if (getState().activeEdit?.draft.type === 'pattern') setReferenceMethod('circular');
}

/** The "field" of a pattern's or mirror's features to copy (a draft's faces to tilt), in state.referenceSlot. */
export const FEATURES_SLOT = -1;

/** The feature a face of the shown body comes from, if a pattern or mirror can copy it (faces are named after their feature). */
function seedOfFace(face: number): string | null {
  const state = getState();
  const id = state.display.body?.naming.faces[face]?.split(':')[0];
  const feature = state.history.features.slice(0, modelEnd(state)).find((candidate) => candidate.id === id);
  return feature && COPYABLE_TYPES.has(feature.type) ? feature.id : null;
}

/** Adds a feature to the features the edited pattern or mirror copies, or takes it out again. */
export function toggleCopySeed(id: string): void {
  const edit = getState().activeEdit;
  if (!edit || !isCopyFeature(edit.draft)) return;
  const feature = getState().history.features.slice(0, edit.index).find((candidate) => candidate.id === id);
  if (!feature || !COPYABLE_TYPES.has(feature.type)) {
    showToast('info', t('errors.pattern-unsupported'));
    return;
  }
  const features = edit.draft.features.includes(id) ? edit.draft.features.filter((seed) => seed !== id) : [...edit.draft.features, id];
  updateDraft({ features } as Partial<SlotFeature>);
}

/** A pick while a pattern or mirror is edited: a face names a feature to copy when the list is active, else it fills a reference field. */
function pickForCopy(pick: Pick): void {
  if (getState().referenceSlot !== FEATURES_SLOT) {
    assignReference(pick);
    return;
  }
  const seed = pick.kind === 'face' ? seedOfFace(pick.index) : null;
  if (seed) toggleCopySeed(seed);
  else showToast('info', t('errors.pattern-unsupported'));
}

/** The reference field the next pick fills. */
export function setReferenceSlot(slot: number): void {
  setState({ referenceSlot: slot });
}

/** Fills the active reference field of the edited reference feature with a pick (or the origin). */
export function assignReference(pick: Pick | 'origin'): void {
  const state = getState();
  const edit = state.activeEdit;
  if (!edit || !hasReferenceSlots(edit.draft)) return;
  const roles = referenceRoles(edit.draft);
  if (roles.length === 0) return;
  // Fields are filled in order: a field after an empty one cannot be filled yet.
  const slot = Math.max(0, Math.min(state.referenceSlot, edit.draft.references.length, roles.length - 1));
  const role = roles[slot] as ReferenceRole;
  const ref: GeometryRef | null = pick === 'origin' ? { kind: 'origin' } : referenceOfPick(pick, state);
  if (!ref) return;
  if (!referenceFits(ref, role, state, pick === 'origin' ? undefined : pick)) {
    showToast('info', t(`references.unsuitable.${role}`));
    return;
  }
  const references = [...edit.draft.references];
  references[slot] = ref;
  const draft = { ...edit.draft, references } as SlotFeature;
  updateDraft(draft);
  setState({ referenceSlot: firstEmptySlot(draft) });
}

/** Empties a reference field; the next pick fills it. */
export function clearReference(slot: number): void {
  const edit = getState().activeEdit;
  if (!edit || !hasReferenceSlots(edit.draft)) return;
  updateDraft({ references: edit.draft.references.slice(0, slot) } as Partial<SlotFeature>);
  setState({ referenceSlot: slot });
}

/** Changes how the edited reference feature is defined; references that still fit their field stay. */
export function setReferenceMethod(method: string): void {
  const state = getState();
  const edit = state.activeEdit;
  if (!edit || !hasReferenceSlots(edit.draft)) return;
  const draft = { ...edit.draft, method } as SlotFeature;
  const roles = referenceRoles(draft);
  const kept: GeometryRef[] = [];
  for (const [slot, role] of roles.entries()) {
    const ref = edit.draft.references[slot];
    if (!ref || !referenceFits(ref, role, state)) break;
    kept.push(ref);
  }
  const next = { ...draft, references: kept } as SlotFeature;
  updateDraft(next);
  setState({ referenceSlot: firstEmptySlot(next) });
}

export function editFeature(id: string): void {
  if (getState().sketch) return;
  if (getState().activeEdit) cancelEdit();
  const features = getState().history.features;
  const index = features.findIndex((feature) => feature.id === id);
  const feature = features[index];
  if (!feature) return;
  // A feature behind the rollback bar is edited with the bar right behind it.
  if (index >= rollbackIndex(features, getState().rollback)) setState({ rollback: features[index + 1]?.id ?? null });
  if (feature.type === 'sketch') {
    enterSketch(openSketchSession('edit', index, feature));
    return;
  }
  setState({ activeEdit: { mode: 'edit', index, draft: feature }, selection: [], choosingSketchPlane: false, referenceSlot: hasReferenceSlots(feature) ? firstEmptySlot(feature) : 0 });
}

/** Opens the part's variables in the property panel (a new, empty list at the top of the tree if there is none). */
export function editVariables(): void {
  const state = getState();
  if (state.sketch || state.choosingSketchPlane) return;
  const existing = variablesFeature(state.history.features);
  if (existing) {
    editFeature(existing.id);
    return;
  }
  if (state.activeEdit) commitEdit();
  setState({ activeEdit: { mode: 'create', index: 0, draft: defaultFeature('variables') }, selection: [] });
}

/**
 * Applies changed variables: every expression in the part is evaluated again and the sketches whose
 * dimensions change are solved again, all in one undo step.
 */
async function commitVariables(edit: ActiveEdit): Promise<void> {
  const features = applyEdit(getState().history.features, edit);
  setState({ activeEdit: null });
  await commitRegenerated(features);
}

/**
 * Commits features whose variables or suppression changed (and with them, optionally, new part
 * properties): every expression is evaluated again and the sketches whose dimensions change are solved
 * again, all in one undo step.
 */
async function commitRegenerated(features: Feature[], properties?: PartProperties): Promise<void> {
  const before = getState().history;
  try {
    const { features: regenerated, failed } = await regenerate(features, async (sketch) => {
      const solution = await sketchSolver().solve(sketch, { analyze: false });
      return solution.converged && solution.unsatisfied.length === 0 ? solution.sketch : null;
    });
    if (getState().history !== before) return;
    setHistory(commit(before, regenerated, properties ?? partProperties(before)));
    if (failed.length > 0) showToast('error', t('variables.sketchFailed', { count: failed.length }));
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

// ------------------------------------------------------------------ configurations

/** Commits new configurations without changing the part (one undo step). */
function commitConfigurations(configurations: Configurations | undefined): void {
  const history = getState().history;
  const { configurations: _old, ...rest } = partProperties(history);
  setHistory(commit(history, history.features, configurations ? { ...rest, configurations } : rest));
}

/** Adds a configuration as a copy of the part as it is now and makes it the active one. */
export function addPartConfiguration(): void {
  const state = getState();
  if (state.activeEdit || state.sketch) return;
  const current = partProperties(state.history).configurations;
  const configurations = addConfiguration(
    state.history.features,
    current,
    { id: createFeatureId(), name: freeConfigurationName(current, t('configurations.prefix')) },
    { id: createFeatureId(), name: t('configurations.default') },
  );
  commitConfigurations(configurations);
}

/** Shows configuration `id`: the active one keeps the part as it is now, the other one is applied. */
export async function activateConfiguration(id: string): Promise<void> {
  const state = getState();
  const configurations = partProperties(state.history).configurations;
  if (!configurations || configurations.active === id || state.activeEdit || state.sketch) return;
  const switched = switchConfiguration(state.history.features, configurations, id);
  if (!switched) return;
  await commitRegenerated(switched.features, { ...partProperties(state.history), configurations: switched.configurations });
}

/** Renames a configuration; names are unique and not empty. */
export function renameConfiguration(id: string, name: string): boolean {
  const configurations = partProperties(getState().history).configurations;
  const trimmed = name.trim();
  if (!configurations || trimmed.length === 0 || configurations.list.some((other) => other.id !== id && other.name.toLowerCase() === trimmed.toLowerCase())) return false;
  commitConfigurations({ ...configurations, list: configurations.list.map((configuration) => (configuration.id === id ? { ...configuration, name: trimmed } : configuration)) });
  return true;
}

/** Deletes a configuration (the part shows the first other one if it was active); the last one ends configurations. */
export async function deleteConfiguration(id: string): Promise<void> {
  const state = getState();
  const configurations = partProperties(state.history).configurations;
  if (!configurations || state.activeEdit || state.sketch) return;
  const rest = configurations.list.filter((configuration) => configuration.id !== id);
  if (rest.length === 0) {
    commitConfigurations(undefined);
    return;
  }
  if (configurations.active !== id) {
    commitConfigurations({ ...configurations, list: rest });
    return;
  }
  const next = rest[0] as Configuration;
  await commitRegenerated(applyConfiguration(state.history.features, next), { ...partProperties(state.history), configurations: { active: next.id, list: rest } });
}

/**
 * Sets a variable in one configuration (the design table). In the active one it changes the part right
 * away; the others keep it until they are shown.
 */
export async function setConfigurationVariable(id: string, name: string, expression: string): Promise<void> {
  const state = getState();
  const configurations = partProperties(state.history).configurations;
  const text = expression.trim();
  if (!configurations || text.length === 0 || state.activeEdit || state.sketch) return;
  const list = configurations.list.map((configuration) => (configuration.id === id ? { ...configuration, variables: { ...configuration.variables, [name]: text } } : configuration));
  const next = { ...configurations, list };
  if (configurations.active !== id) {
    commitConfigurations(next);
    return;
  }
  const features = state.history.features.map((feature): Feature =>
    feature.type === 'variables' ? { ...feature, variables: feature.variables.map((variable) => (variable.name.toLowerCase() === name.toLowerCase() ? { ...variable, expression: text } : variable)) } : feature,
  );
  await commitRegenerated(features, { ...partProperties(state.history), configurations: next });
}

export function updateDraft(patch: Partial<Feature>): void {
  const edit = getState().activeEdit;
  if (!edit) return;
  setState({ activeEdit: { ...edit, draft: { ...edit.draft, ...patch } as Feature } });
}

/**
 * Adds or removes material. An extrusion from a sketch on a face turns with it: the face's normal points
 * out of the part, so adding goes along it and removing goes against it, into the part.
 */
export function setOperation(operation: BooleanOperation): void {
  const edit = getState().activeEdit;
  if (!edit || !('operation' in edit.draft)) return;
  const draft = edit.draft;
  if (draft.type === 'extrude' && draft.direction !== 'both' && draft.direction !== 'two') {
    const sketch = getState().history.features.find((feature) => feature.type === 'sketch' && feature.id === draft.sketch);
    if (sketch?.type === 'sketch' && sketch.plane.kind === 'face') {
      updateDraft({ operation, direction: operation === 'cut' ? 'reverse' : 'normal' });
      return;
    }
  }
  updateDraft({ operation });
}

/** Gives a parameter of the edited feature as an equation (undefined: a plain value again). */
export function setDraftExpression(field: string, expression: string | undefined): void {
  const edit = getState().activeEdit;
  if (!edit) return;
  const { [field]: _old, ...rest } = edit.draft.expressions ?? {};
  const expressions = expression === undefined ? rest : { ...rest, [field]: expression };
  const { expressions: _previous, ...draft } = edit.draft;
  setState({ activeEdit: { ...edit, draft: (Object.keys(expressions).length > 0 ? { ...draft, expressions } : draft) as Feature } });
}

/**
 * Adds or removes an edge of the shown body (the body the fillet or chamfer modifies). The other
 * references are brought up to date on the way: edges found only by position or index get their
 * current names.
 */
export function toggleDraftEdge(index: number): void {
  const { activeEdit: edit, display } = getState();
  const naming = display.body?.naming;
  if (!edit || !isEdgeFeature(edit.draft) || !naming) return;
  const matches = resolveEdgeRefs(edit.draft.edges, naming);
  const exists = matches.some((match) => match?.index === index);
  const kept = edit.draft.edges.flatMap((ref, i): EdgeRef[] => {
    const match = matches[i];
    if (match?.index === index) return [];
    return [match && match.kind !== 'name' ? (edgeRefOf(naming, match.index) ?? ref) : ref];
  });
  const added = exists ? null : edgeRefOf(naming, index);
  updateDraft({ edges: added ? [...kept, added] : kept });
}

/** Whether a reference can be what an extrusion goes up to: any face or a plane for a surface, a point for a vertex. */
function fitsExtrudeEnd(ref: GeometryRef, end: ExtrudeEnd, state: AppState, pick?: Pick): boolean {
  if (end === 'upToSurface') return ref.kind === 'face' || referenceFits(ref, 'plane', state, pick);
  return end === 'upToVertex' && referenceFits(ref, 'point', state, pick);
}

/** Turns the edited extrusion or revolution into a thin feature with walls on `side`, or (null) back into a solid one. */
export function setThin(side: ThinSide | null): void {
  const edit = getState().activeEdit;
  if (edit?.draft.type !== 'extrude' && edit?.draft.type !== 'revolve') return;
  const { thin: _thin, ...rest } = edit.draft;
  setState({ activeEdit: { ...edit, draft: side ? { ...rest, thin: side, thickness: edit.draft.thickness ?? DEFAULT_THIN_THICKNESS } : rest } });
}

/** Changes how far the edited extrusion goes; up to the next face, a surface or a vertex goes one way only. */
export function setExtrudeEnd(end: ExtrudeEnd): void {
  const edit = getState().activeEdit;
  if (edit?.draft.type !== 'extrude') return;
  const oneWay = extrudesOneWay(end) && (edit.draft.direction === 'both' || edit.draft.direction === 'two');
  // A plane does not fit an up-to-vertex end (and the other way round).
  const { endRef: _ref, ...rest } = edit.draft;
  const keep = edit.draft.endRef && fitsExtrudeEnd(edit.draft.endRef, end, getState());
  setState({ activeEdit: { ...edit, draft: { ...rest, end, ...(oneWay ? { direction: 'normal' as const } : {}), ...(keep && edit.draft.endRef ? { endRef: edit.draft.endRef } : {}) } } });
}

/** What an extrusion up to a surface or vertex goes up to: a picked plane or face, or a vertex or point. */
export function pickExtrudeEnd(pick: Pick | 'origin'): void {
  const state = getState();
  const edit = state.activeEdit;
  if (!edit || !extrudesUpTo(edit.draft)) return;
  const ref: GeometryRef | null = pick === 'origin' ? { kind: 'origin' } : referenceOfPick(pick, state);
  if (!ref) return;
  if (!fitsExtrudeEnd(ref, edit.draft.end, state, pick === 'origin' ? undefined : pick)) {
    showToast('info', t(edit.draft.end === 'upToVertex' ? 'references.unsuitable.point' : 'references.unsuitable.surface'));
    return;
  }
  updateDraft({ endRef: ref });
}

/** Whether the edited feature's added material is fused with the bodies it touches (the default) or stays a body of its own. */
export function setMerge(merge: boolean): void {
  const edit = getState().activeEdit;
  if (!edit || !('merge' in edit.draft || 'operation' in edit.draft)) return;
  const { merge: _merge, ...rest } = edit.draft as Feature & { merge?: boolean };
  setState({ activeEdit: { ...edit, draft: (merge ? rest : { ...rest, merge: false }) as Feature } });
}

/** Adds the body of a picked face to the edited combine or delete-body feature, or takes it out again. */
export function toggleBody(pick: Pick): void {
  const state = getState();
  const edit = state.activeEdit;
  const naming = state.display.body?.naming;
  if ((edit?.draft.type !== 'combine' && edit?.draft.type !== 'deleteBody') || !naming || pick.kind !== 'face' || !pick.at) return;
  const body = bodyOfFace(naming, pick.index);
  const at = bodiesOfRefs(edit.draft.bodies, state).indexOf(body);
  if (at >= 0) {
    updateDraft({ bodies: edit.draft.bodies.filter((_, i) => i !== at) });
    return;
  }
  const ref = faceRefOf(naming, pick.index, pick.at);
  if (ref) updateDraft({ bodies: [...edit.draft.bodies, ref] });
}

/** Selects all faces of a body of the shown part (from the list of bodies in the tree). */
export function selectBody(index: number): void {
  const naming = getState().display.body?.naming;
  const body = naming ? bodiesOf(naming).find((candidate) => candidate.index === index) : undefined;
  if (body) setState({ selection: body.faces.map((face) => ({ kind: 'face' as const, index: face })) });
}

/** Lets the edited loft follow a centerline (a sketch or curve id), or none. */
export function setLoftCenterline(centerline: string | undefined): void {
  const edit = getState().activeEdit;
  if (edit?.draft.type !== 'loft') return;
  const { centerline: _old, ...rest } = edit.draft;
  setState({ activeEdit: { ...edit, draft: centerline ? { ...rest, centerline } : rest } });
}

/** Gives the edited sweep a guide curve (a sketch or curve id), or none; a guided sweep does not twist. */
export function setSweepGuide(guide: string | undefined): void {
  const edit = getState().activeEdit;
  if (edit?.draft.type !== 'sweep') return;
  const { guide: _guide, ...rest } = edit.draft;
  if (!guide) {
    setState({ activeEdit: { ...edit, draft: rest } });
    return;
  }
  const { twist: _twist, expressions, ...plain } = rest;
  const { twist: _expression, ...others } = expressions ?? {};
  setState({ activeEdit: { ...edit, draft: { ...plain, guide, ...(Object.keys(others).length > 0 ? { expressions: others } : {}) } } });
}

/** Adds an edge of the shown body to the edited composite curve, or takes it out again. */
export function toggleCurveEdge(index: number): void {
  const { activeEdit: edit, display } = getState();
  const naming = display.body?.naming;
  if (edit?.draft.type !== 'compositeCurve' || !naming) return;
  const matches = resolveEdgeRefs(edit.draft.edges, naming);
  const at = matches.findIndex((match) => match?.index === index);
  if (at >= 0) {
    updateDraft({ edges: edit.draft.edges.filter((_, i) => i !== at) });
    return;
  }
  const ref = edgeRefOf(naming, index);
  if (ref) updateDraft({ edges: [...edit.draft.edges, ref] });
}

/** Opens the edited shell at a face of the shown body (the body it hollows out), or closes it there again. */
export function toggleShellFace(pick: Pick): void {
  const { activeEdit: edit, display } = getState();
  const naming = display.body?.naming;
  if ((edit?.draft.type !== 'shell' && edit?.draft.type !== 'draft' && edit?.draft.type !== 'projectedCurve') || !naming || pick.kind !== 'face' || !pick.at) return;
  // One entry per reference (also for faces that are gone), so the positions match the list.
  const open = edit.draft.faces.map((ref) => referencePicks([ref], getState())[0]?.index);
  const at = open.indexOf(pick.index);
  if (at >= 0) {
    updateDraft({ faces: edit.draft.faces.filter((_, i) => i !== at) });
    return;
  }
  const ref = faceRefOf(naming, pick.index, pick.at);
  if (ref) updateDraft({ faces: [...edit.draft.faces, ref] });
}

/**
 * The ISO size that fits a cylindrical face of radius `radius`: a bolt of that diameter, or a hole drilled
 * for tapping (its tap drill).
 */
function threadSizeFor(radius: number): MetricSize {
  const diameter = 2 * radius;
  const fit = (size: MetricSize) => Math.min(Math.abs(size.d - diameter), Math.abs(size.tapDrill - diameter));
  return METRIC_SIZES.reduce((best, size) => (fit(size) < fit(best) ? size : best));
}

/** Puts the edited thread on a cylindrical face of the shown body; its size and pitch follow the face. */
export function setThreadFace(pick: Pick): void {
  const { activeEdit: edit, display } = getState();
  const body = display.body;
  if (edit?.draft.type !== 'thread' || !body || pick.kind !== 'face' || !pick.at) return;
  const info = body.faceInfo[pick.index];
  if (info?.kind !== 'cylinder' || info.radius === undefined) {
    showToast('info', t('thread.pickCylinder'));
    return;
  }
  const ref = faceRefOf(body.naming, pick.index, pick.at);
  if (!ref) return;
  const size = threadSizeFor(info.radius);
  updateDraft({ faces: [ref], size: size.size, pitch: size.pitch });
}

/** Changes the size of the edited thread; the pitch follows the standard (coarse) one. */
export function setThreadSize(name: string): void {
  const size = metricSize(name);
  if (size) updateDraft({ size: size.size, pitch: size.pitch });
}

/** Rounds edges with a constant radius, or makes a full round between two side faces. */
export function setFilletMethod(method: FilletMethod): void {
  const edit = getState().activeEdit;
  if (edit?.draft.type !== 'fillet') return;
  // The faces of one kind of round mean something else in the other: they are picked again.
  updateDraft({
    method,
    ...(roundFaceCount(method) > 0 && method !== edit.draft.method ? { round: [] } : {}),
    ...(method === 'variable' && edit.draft.radius2 === undefined ? { radius2: edit.draft.radius * 2 } : {}),
  });
}

/**
 * Picks the faces of the edited face fillet or full round in order (full round: side face 1, center face,
 * side face 2); a face already picked is taken out with the ones after it.
 */
export function pickRoundFace(pick: Pick): void {
  const { activeEdit: edit, display } = getState();
  const naming = display.body?.naming;
  if (edit?.draft.type !== 'fillet' || !naming || pick.kind !== 'face' || !pick.at) return;
  const refs = edit.draft.round ?? [];
  const at = refs.map((ref) => referencePicks([ref], getState())[0]?.index).indexOf(pick.index);
  if (at >= 0) {
    updateDraft({ round: refs.slice(0, at) });
    return;
  }
  const ref = faceRefOf(naming, pick.index, pick.at);
  if (ref && refs.length < roundFaceCount(edit.draft.method)) updateDraft({ round: [...refs, ref] });
}

/** Adds a face (all of its edges) to the edited fillet or chamfer, or removes it again. */
export function toggleDraftFace(pick: Pick): void {
  const { activeEdit: edit, display } = getState();
  const naming = display.body?.naming;
  if (!edit || !isEdgeFeature(edit.draft) || !naming || pick.kind !== 'face' || !pick.at) return;
  const faces = edit.draft.faces ?? [];
  // One entry per reference (also for faces that are gone), so the positions match the list.
  const at = faces.map((ref) => referencePicks([ref], getState())[0]?.index).indexOf(pick.index);
  if (at >= 0) {
    updateDraft({ faces: faces.filter((_, i) => i !== at) });
    return;
  }
  const ref = faceRefOf(naming, pick.index, pick.at);
  if (ref) updateDraft({ faces: [...faces, ref] });
}

/** Removes the edges of the edited fillet or chamfer that no longer exist in the body it modifies. */
export function removeMissingEdges(): void {
  const { activeEdit: edit, display } = getState();
  const naming = display.body?.naming;
  if (!edit || !isEdgeFeature(edit.draft) || !naming) return;
  const matches = resolveEdgeRefs(edit.draft.edges, naming);
  updateDraft({ edges: edit.draft.edges.filter((_, i) => matches[i] !== null) });
}

export function commitEdit(): void {
  const state = getState();
  const edit = state.activeEdit;
  if (!edit) return;
  const unchanged = edit.mode === 'edit' && state.history.features[edit.index] === edit.draft;
  if (unchanged) {
    setState({ activeEdit: null });
    return;
  }
  if (edit.draft.type === 'variables') {
    void commitVariables(edit);
    return;
  }
  setHistory(commit(state.history, applyEdit(state.history.features, edit)), { activeEdit: null });
}

export function cancelEdit(): void {
  if (getState().activeEdit) setState({ activeEdit: null });
}

export function deleteFeature(id: string): void {
  const state = getState();
  if (state.sketch) return;
  if (state.activeEdit) cancelEdit();
  const index = state.history.features.findIndex((feature) => feature.id === id);
  const features = state.history.features.filter((feature) => feature.id !== id);
  // The rollback bar stays where it is when the feature behind it goes.
  const rollback = state.rollback === id ? (state.history.features[index + 1]?.id ?? null) : state.rollback;
  setHistory(commit(state.history, features), { rollback });
}

// ------------------------------------------------------------------ feature tree

/** Puts the rollback bar in front of feature `id` (null: at the end, the whole part is built). */
export function setRollback(id: string | null): void {
  const state = getState();
  if (state.sketch || state.activeEdit || state.choosingSketchPlane) return;
  const features = state.history.features;
  // Nothing comes before the part's variables, not even the bar.
  const rollback = id !== null && features[0]?.type === 'variables' && features[0].id === id ? (features[1]?.id ?? null) : id;
  if (rollback !== state.rollback) setState({ rollback, selection: [], hover: null });
}

/** Moves the rollback bar `steps` features down (negative: up). */
export function moveRollback(steps: number): void {
  const { history, rollback } = getState();
  const index = Math.max(0, Math.min(history.features.length, rollbackIndex(history.features, rollback) + steps));
  setRollback(history.features[index]?.id ?? null);
}

/**
 * Drops a feature (or the rollback bar) dragged in the tree into gap `gap` of the tree rows (see
 * state/tree-order.ts). A move that would put a feature before a feature it builds on, or after one
 * that builds on it, is refused with a message.
 */
export function dropTreeRow(dragged: TreeRow, gap: number): void {
  const state = getState();
  if (state.sketch || state.activeEdit || state.choosingSketchPlane) return;
  const features = state.history.features;
  const result = dropRow(features, state.rollback, dragged, gap);
  if (result.kind === 'unchanged') return;
  if (result.kind === 'refused') {
    const nameOf = (id: string | null) => {
      const index = features.findIndex((feature) => feature.id === id);
      return index >= 0 ? featureName(features, index, t) : '';
    };
    showToast('info', t(`tree.moveRefused.${result.reason}`, { name: nameOf(result.feature), other: nameOf(result.other) }));
    return;
  }
  const reordered = result.features.some((feature, i) => feature !== features[i]);
  if (reordered) setHistory(commit(state.history, result.features), { rollback: result.rollback, selection: [], hover: null });
  else setRollback(result.rollback);
}

export function toggleSuppress(id: string): void {
  const state = getState();
  if (state.sketch) return;
  const features = state.history.features.map((feature) =>
    feature.id === id ? ({ ...feature, suppressed: !feature.suppressed } as Feature) : feature,
  );
  setHistory(commit(state.history, features));
}

export function undo(): void {
  if (isTextInputFocused()) {
    document.execCommand('undo');
    return;
  }
  const { sketch } = getState();
  if (sketch) {
    updateSketch(undoSketch(sketch), { sketchSelection: [], sketchHover: null });
    return;
  }
  if (getState().choosingSketchPlane) {
    setState({ choosingSketchPlane: false });
    return;
  }
  if (getState().activeEdit) {
    cancelEdit();
    return;
  }
  setHistory(undoHistory(getState().history), { selection: [] });
}

export function redo(): void {
  if (isTextInputFocused()) {
    document.execCommand('redo');
    return;
  }
  const { sketch } = getState();
  if (sketch) {
    updateSketch(redoSketch(sketch), { sketchSelection: [], sketchHover: null });
    return;
  }
  if (getState().activeEdit || getState().choosingSketchPlane) return;
  setHistory(redoHistory(getState().history), { selection: [] });
}

// ------------------------------------------------------------------ material and appearance

/** Gives the part a material (null: none); one undo step. A library material starts with its own density. */
export function setMaterial(material: PartMaterial | null): void {
  const state = getState();
  const properties = partProperties(state.history);
  const { material: _old, ...rest } = properties;
  const next: PartProperties = material ? { ...rest, material } : rest;
  if (JSON.stringify(next) === JSON.stringify(properties)) return;
  setHistory(commit(state.history, state.history.features, next));
}

/** The plane of a selected planar face or reference plane, for a section view. */
function sectionPlaneOfSelection(): SectionPlane | null {
  const state = getState();
  const pick = state.selection.length === 1 ? state.selection[0] : undefined;
  if (pick?.kind === 'plane') {
    const plane = STANDARD_PLANES[pick.index];
    return plane ? { kind: 'standard', plane } : null;
  }
  const plane = pick ? sketchPlaneOf(pick) : null;
  if (!plane) return null;
  const frame = frameOf(plane);
  return { kind: 'custom', point: frame.origin, normal: frame.normal };
}

/** Where a new section cuts: through the origin if the part is there, else through its middle. */
function sectionOffset(plane: SectionPlane): number {
  const properties = getState().rebuild?.properties;
  if (!properties) return 0;
  const [low, high] = offsetRange(plane, properties.bboxMin, properties.bboxMax);
  // The bounding box is a little larger than the part (by the tolerance of its faces).
  const margin = 1e-3;
  return low < -margin && high > margin ? 0 : Math.round(((low + high) / 2) * 1000) / 1000;
}

/**
 * Turns the section view on or off. It cuts along the selected planar face or plane, if there is one,
 * else along the front plane.
 */
export function toggleSection(on = getState().section === null): void {
  if (!on) {
    setState({ section: null });
    return;
  }
  const plane = sectionPlaneOfSelection() ?? { kind: 'standard', plane: 'front' };
  setState({ section: { plane, offset: sectionOffset(plane), flip: false } });
}

/** Changes the section view; another plane starts at its own middle offset. */
export function updateSection(patch: Partial<SectionSettings>): void {
  const section = getState().section;
  if (!section) return;
  const plane = patch.plane ?? section.plane;
  const offset = patch.offset ?? (patch.plane ? sectionOffset(plane) : section.offset);
  setState({ section: { ...section, ...patch, plane, offset } });
}

/** Cuts the section view along the selected planar face or plane. */
export function sectionAlongSelection(): void {
  const plane = sectionPlaneOfSelection();
  if (plane) updateSection({ plane });
}

/** Turns the measure tool on or off; what is selected is measured right away. */
export function toggleMeasure(on = !getState().measuring): void {
  const state = getState();
  if (on && (state.sketch || state.choosingSketchPlane)) return;
  if (on && state.activeEdit) commitEdit();
  setState({ measuring: on, ...(on ? {} : { measurement: null }) });
}

/** Shows or hides the mass properties panel over the 3D view. */
export function toggleMassProperties(show = !getState().showMassProperties): void {
  setState({ showMassProperties: show });
}

/** Gives mass properties in a coordinate system (feature id), or (null) in the model's own axes. */
export function setMassFrame(id: string | null): void {
  setState({ massFrame: id });
}

/** Gives the part its own color in the 3D view (null: the material's color); one undo step. */
export function setPartColor(color: string | null): void {
  const state = getState();
  const properties = partProperties(state.history);
  const { color: _old, ...rest } = properties;
  const next: PartProperties = color ? { ...rest, color: color.toLowerCase() } : rest;
  if (next.color === properties.color) return;
  setHistory(commit(state.history, state.history.features, next));
}

// ------------------------------------------------------------------ sketches

/** Where a picked plane or planar face lies, or null if a sketch cannot be placed on the pick. */
function sketchPlaneOf(pick: Pick): SketchPlaneRef | null {
  if (pick.kind === 'plane') {
    const plane = STANDARD_PLANES[pick.index];
    return plane ? { kind: 'standard', plane } : null;
  }
  if (pick.kind === 'reference') {
    const feature = getState().history.features[pick.index];
    const geometry = feature ? referenceGeometry(getState(), feature.id) : undefined;
    return feature && geometry?.kind === 'plane' ? { kind: 'feature', feature: feature.id, frame: geometry.frame } : null;
  }
  if (pick.kind !== 'face') return null;
  const body = getState().display.body;
  const face = body?.faceInfo[pick.index]?.plane;
  if (!face) return null;
  // The face's persistent name lets the sketch follow it when earlier features change.
  const name = body.naming.faces[pick.index];
  return { kind: 'face', face: pick.index, frame: frameOnPlane(face.point, face.normal), ...(name ? { name } : {}) };
}

/** Sketch command: sketches on a selected plane or planar face right away, otherwise asks for one. */
export function startSketch(): void {
  const state = getState();
  if (state.sketch) return;
  if (state.activeEdit) commitEdit();
  const selected = getState().selection;
  const plane = selected.length === 1 && selected[0] ? sketchPlaneOf(selected[0]) : null;
  if (plane) chooseSketchPlane(plane);
  else setState({ choosingSketchPlane: true, selection: [], hover: null, commandTab: 'sketch' });
}

/** Opens a new sketch on reference plane `id`. */
export function sketchOnReferencePlane(id: string): void {
  const index = getState().history.features.findIndex((feature) => feature.id === id);
  const plane = index >= 0 ? sketchPlaneOf({ kind: 'reference', index }) : null;
  if (plane) chooseSketchPlane(plane);
}

/** Opens a new sketch on `plane`, at the rollback bar (behind the last feature). */
export function chooseSketchPlane(plane: SketchPlaneRef): void {
  if (getState().sketch) return;
  const draft: SketchFeature = { ...(defaultFeature('sketch') as SketchFeature), plane };
  enterSketch(openSketchSession('create', rollbackIndex(getState().history.features, getState().rollback), draft));
}

function enterSketch(session: SketchSession): void {
  updateSketch(session, {
    activeEdit: null,
    choosingSketchPlane: false,
    selection: [],
    hover: null,
    sketchSelection: [],
    sketchHover: null,
    sketchTool: null,
    commandTab: 'sketch',
  });
}

/** Replaces the sketch session and keeps the dirty flag in sync with unsaved sketch work. */
function updateSketch(sketch: SketchSession | null, extra: Partial<AppState> = {}): void {
  setState((state) => ({
    ...extra,
    sketch,
    dirty:
      state.history.features !== state.savedFeatures ||
      partProperties(state.history) !== state.savedProperties ||
      (sketch !== null && hasSketchChanges(sketch, state.history.features)),
  }));
}

/** Records one finished sketch operation (one undo step in sketch mode). */
export function recordSketchChange(sketch: SketchData): void {
  const session = getState().sketch;
  if (session) updateSketch(recordSketch(session, sketch));
}

/** Leaves sketch mode and keeps the sketch: one step in the document history. An empty new sketch is dropped. */
export function exitSketch(): void {
  const state = getState();
  const session = state.sketch;
  if (!session) {
    if (state.choosingSketchPlane) setState({ choosingSketchPlane: false, commandTab: 'features' });
    return;
  }
  const leave: Partial<AppState> = { selection: [], hover: null, sketchSelection: [], sketchHover: null, sketchTool: null, commandTab: 'features' };
  const features = applySketchSession(state.history.features, session);
  if (features) setHistory(commit(state.history, features), { ...leave, sketch: null });
  else updateSketch(null, leave);
}

/** Leaves sketch mode and discards its changes (after asking, if there are any). */
export async function cancelSketch(): Promise<void> {
  const state = getState();
  const session = state.sketch;
  if (!session) {
    if (state.choosingSketchPlane) setState({ choosingSketchPlane: false, commandTab: 'features' });
    return;
  }
  if (hasSketchChanges(session, state.history.features)) {
    const confirmed = await api().confirm({
      message: t('dialogs.discardSketchMessage'),
      detail: t('dialogs.discardSketchDetail'),
      confirmLabel: t('dialogs.discard'),
      cancelLabel: t('dialogs.cancel'),
    });
    if (!confirmed || getState().sketch !== session) return;
  }
  updateSketch(null, { selection: [], hover: null, sketchSelection: [], sketchHover: null, sketchTool: null, commandTab: 'features' });
}

/** Activates a drawing tool (null: select and drag). Choosing the active tool again leaves it. */
export function setSketchTool(tool: SketchToolName | null): void {
  const state = getState();
  if (!state.sketch) return;
  const next = tool === state.sketchTool ? null : tool;
  const variants = { ...state.sketchToolVariants };
  if (next === 'line' || next === 'centerline') variants.line = next;
  if (next === 'cornerRectangle' || next === 'centerRectangle' || next === 'threePointRectangle' || next === 'parallelogram') variants.rectangle = next;
  if (next === 'circle' || next === 'threePointCircle' || next === 'ellipse') variants.circle = next;
  if (next === 'centerArc' || next === 'threePointArc' || next === 'tangentArc') variants.arc = next;
  if (next === 'sketchFillet' || next === 'sketchChamfer') variants.corner = next;
  if (next === 'trim' || next === 'extend') variants.trim = next;
  setState({ sketchTool: next, sketchToolVariants: variants, sketchSelection: next ? [] : state.sketchSelection, sketchHover: null, commandTab: 'sketch' });
}

export function setCornerSize(tool: 'sketchFillet' | 'sketchChamfer', size: number): void {
  if (!(size > 0)) return;
  setState(tool === 'sketchFillet' ? { filletRadius: size } : { chamferDistance: size });
}

export function setPolygonSides(sides: number): void {
  if (Number.isFinite(sides)) setState({ polygonSides: Math.max(3, Math.min(64, Math.round(sides))) });
}

/** Turns the selected curves into construction geometry, or back if all of them already are. */
export function toggleConstruction(): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch || sketchSelection.length === 0) return;
  const selected = new Set(sketchSelection);
  const curves = sketch.draft.sketch.entities.filter((entity) => selected.has(entity.id) && entity.type !== 'point');
  if (curves.length === 0) return;
  const construction = !curves.every((curve) => curve.construction);
  const entities = sketch.draft.sketch.entities.map((entity) => {
    if (!selected.has(entity.id) || entity.type === 'point') return entity;
    const { construction: _old, ...rest } = entity;
    return construction ? { ...rest, construction: true } : rest;
  });
  recordSketchChange({ ...sketch.draft.sketch, entities });
}

/** Clicking sketch geometry: select it, add or remove it (additive), or clear the selection (null). */
export function selectSketchEntity(id: string | null, additive: boolean): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  if (!id) {
    if (!additive && sketchSelection.length > 0) setState({ sketchSelection: [] });
    return;
  }
  const selected = sketchSelection.includes(id);
  if (additive) setState({ sketchSelection: selected ? sketchSelection.filter((other) => other !== id) : [...sketchSelection, id] });
  else setState({ sketchSelection: selected && sketchSelection.length === 1 ? [] : [id] });
}

/**
 * Adds a relation to the selected geometry. The solver checks it first: a relation that already
 * follows from others (it would over-define the sketch) or contradicts them is refused with a message.
 */
export async function addSketchRelation(kind: RelationKind): Promise<void> {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const base = sketch.draft.sketch;
  const option = applicableRelations(base, sketchSelection).find((candidate) => candidate.kind === kind);
  if (!option) return;
  const builder = new SketchBuilder(base);
  for (const relation of option.relations) builder.relation(relation);
  const next = builder.build();
  const added = next.constraints.slice(base.constraints.length);
  try {
    const solver = sketchSolver();
    for (const [i, candidate] of added.entries()) {
      const before = { entities: base.entities, constraints: [...base.constraints, ...added.slice(0, i)] };
      if (await solver.isRedundant(before, candidate)) {
        showToast('info', t('sketch.messages.redundantRelation'));
        return;
      }
    }
    const solution = await solver.solve(next, { analyze: false });
    if (!solution.converged) {
      showToast('error', t('sketch.messages.conflictingRelation'));
      return;
    }
    // The sketch changed while the solver worked (undo, another edit): do not apply on top of it.
    if (getState().sketch?.draft.sketch !== base) return;
    recordSketchChange(solution.sketch);
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

/** A typed dimension value in solver units: millimeters, or degrees turned into the stored angle. Null if invalid. */
function dimensionValue(sketch: SketchData, dimension: DimensionDraft, typed: number): number | null {
  if (dimension.type === 'angle') return typed > 0 && typed < 180 ? storedAngle(sketch, dimension, (typed * Math.PI) / 180) : null;
  return typed > 0 ? typed : null;
}

function replaceConstraint(sketch: SketchData, constraint: SketchDimension): SketchData {
  return { ...sketch, constraints: sketch.constraints.map((other) => (other.id === constraint.id ? constraint : other)) };
}

/**
 * Adds a dimension and applies the typed value (null keeps the measured one). A dimension that
 * would over-define the sketch becomes a driven (reference) dimension that only shows the value.
 */
export async function addSketchDimension(draft: DimensionDraft, typed: number | null, expression?: string): Promise<void> {
  const session = getState().sketch;
  if (!session) return;
  const base = session.draft.sketch;
  const builder = new SketchBuilder(base);
  builder.dimension(draft);
  const measured = builder.build();
  const probe = measured.constraints.at(-1) as SketchDimension;
  try {
    const solver = sketchSolver();
    if (await solver.isRedundant(base, probe)) {
      if (getState().sketch?.draft.sketch === base) recordSketchChange({ ...base, constraints: [...base.constraints, { ...probe, driving: false }] });
      showToast('info', t('sketch.messages.drivenDimension'));
      return;
    }
    const value = typed === null ? probe.value : dimensionValue(base, probe, typed);
    if (value === null) showToast('error', t('sketch.messages.invalidDimension'));
    const next = value === null ? measured : replaceConstraint(measured, expression ? { ...probe, value, expression } : { ...probe, value });
    const solution = await solver.solve(next, { analyze: false });
    if (getState().sketch?.draft.sketch !== base) return;
    if (solution.converged) {
      recordSketchChange(solution.sketch);
    } else {
      showToast('error', t('sketch.messages.dimensionNotApplied'));
      recordSketchChange(measured);
    }
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

/** Changes the value of a driving dimension; the geometry follows if the sketch can be solved. */
export async function setSketchDimensionValue(id: string, typed: number, expression?: string): Promise<void> {
  const session = getState().sketch;
  if (!session) return;
  const base = session.draft.sketch;
  const dimension = base.constraints.find((constraint) => constraint.id === id);
  if (!dimension || !isDimension(dimension)) return;
  if (!dimension.driving) {
    showToast('info', t('sketch.messages.drivenNotEditable'));
    return;
  }
  const value = dimensionValue(base, dimension, typed);
  if (value === null) {
    showToast('error', t('sketch.messages.invalidDimension'));
    return;
  }
  try {
    const { expression: _previous, ...plain } = dimension;
    const updated: SketchDimension = expression ? { ...plain, value, expression } : { ...plain, value };
    const solution = await sketchSolver().solve(replaceConstraint(base, updated), { analyze: false });
    if (getState().sketch?.draft.sketch !== base) return;
    if (solution.converged) recordSketchChange(solution.sketch);
    else showToast('error', t('sketch.messages.dimensionNotApplied'));
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

const TRANSFORM_MESSAGES = { 'nothing-selected': 'transformNothing', 'no-axis': 'transformNoAxis' } as const;

function applyTransform(result: TransformResult): void {
  if (result.ok) recordSketchChange(result.sketch);
  else showToast('info', t(`sketch.messages.${TRANSFORM_MESSAGES[result.error]}`));
}

/**
 * The pivot of the selection for rotations and circular patterns: a selected stand-alone point
 * (which is then not copied), or the sketch origin.
 */
export function selectionPivot(): { at: Point2; point: string | null } {
  const { sketch, sketchSelection } = getState();
  const data = sketch?.draft.sketch;
  if (!data) return { at: [0, 0], point: null };
  const selected = new Set(sketchSelection);
  const ofSelectedCurves = new Set(data.entities.flatMap((entity) => (isCurve(entity) && selected.has(entity.id) ? curvePoints(entity) : [])));
  const points = data.entities.filter((entity) => entity.type === 'point' && selected.has(entity.id) && !ofSelectedCurves.has(entity.id));
  const [only] = points;
  return points.length === 1 && only?.type === 'point' && sketchSelection.length > 1 ? { at: [only.x, only.y], point: only.id } : { at: [0, 0], point: null };
}

/** Name of the open sketch for file names: its own name or "Sketch2". */
function openSketchName(): string {
  const { sketch, history } = getState();
  if (!sketch) return t('features.sketch');
  const before = history.features.slice(0, sketch.index).filter((feature) => feature.type === 'sketch').length;
  return sketch.draft.name ?? `${t('features.sketch')}${before + 1}`;
}

/** Adds the lines, circles, arcs and polylines of a DXF file to the open sketch. */
export async function importDxfIntoSketch(): Promise<void> {
  if (!getState().sketch) return;
  const result = await api().openFile({ title: t('dialogs.importDxfTitle'), filters: [{ name: t('dialogs.dxfFiles'), extensions: ['dxf'] }] });
  if (result.status === 'error') showToast('error', t('toasts.openFailed', { message: result.message }));
  if (result.status !== 'opened') return;
  const session = getState().sketch;
  if (!session) return;
  try {
    const imported = dxfToSketch(new TextDecoder().decode(result.data), session.draft.sketch);
    recordSketchChange(imported.sketch);
    const skipped = Object.entries(imported.skipped)
      .map(([type, count]) => `${count} × ${type}`)
      .join(', ');
    showToast('success', t(skipped ? 'toasts.dxfImportedSkipped' : 'toasts.dxfImported', { count: imported.imported, skipped }));
    viewport()?.zoomToFit();
  } catch (error) {
    showToast('error', t('toasts.openFailed', { message: error instanceof Error ? error.message : String(error) }));
  }
}

/** Saves the open sketch as DXF (without construction geometry). */
export async function exportSketchDxf(): Promise<void> {
  const session = getState().sketch;
  if (!session) return;
  const { text } = sketchToDxf(session.draft.sketch);
  const result = await api().saveFile({
    title: t('dialogs.exportTitle'),
    defaultName: `${openSketchName()}.dxf`,
    filters: [{ name: t('dialogs.dxfFiles'), extensions: ['dxf'] }],
    data: new TextEncoder().encode(text),
  });
  if (result.status === 'saved') showToast('success', t('toasts.exported', { name: result.path.split(/[\\/]/).pop() ?? result.path }));
  else if (result.status === 'error') showToast('error', t('toasts.exportFailed', { message: result.message }));
}

/** Converts a model edge into sketch geometry on the open sketch's plane (Convert entities). */
export function convertModelEdge(edge: number): void {
  const { sketch, display } = getState();
  const body = display.body;
  const info = body?.edgeInfo[edge];
  if (!sketch || !body || !info) return;
  const start = body.edgeRanges[edge * 2] ?? 0;
  const count = body.edgeRanges[edge * 2 + 1] ?? 0;
  const polyline = body.edgePositions.subarray(start * 3, (start + count) * 3);
  const result = convertEdges(sketch.draft.sketch, frameOf(sketch.draft.plane), [{ info, polyline }]);
  if (result.ok) recordSketchChange(result.sketch);
  else showToast('info', t(`sketch.messages.${result.error === 'already-converted' ? 'convertRepeated' : 'convertNothing'}`));
}

/**
 * A model edge as fixed construction geometry of the open sketch, so it can be dimensioned to (an edge
 * converted before is reused): the curve and the sketch with it (`changed` when it was added; the caller
 * records it), or null.
 */
export function modelEdgeReference(edge: number): { sketch: SketchData; curve: string; changed: boolean } | null {
  const { sketch, display } = getState();
  const body = display.body;
  const info = body?.edgeInfo[edge];
  if (!sketch || !body || !info) return null;
  const start = body.edgeRanges[edge * 2] ?? 0;
  const count = body.edgeRanges[edge * 2 + 1] ?? 0;
  const polyline = body.edgePositions.subarray(start * 3, (start + count) * 3);
  const result = convertEdges(sketch.draft.sketch, frameOf(sketch.draft.plane), [{ info, polyline }], { construction: true });
  const curve = result.curves[0];
  if (!curve) return null;
  return { sketch: result.ok ? result.sketch : sketch.draft.sketch, curve, changed: result.ok };
}

/** Offsets the selected curves; closed outlines grow outwards unless `flip`. */
export function offsetSketchSelection(distance: number, flip: boolean): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const result = offsetSelection(sketch.draft.sketch, sketchSelection, distance, flip);
  if (result.ok) recordSketchChange(result.sketch);
  else showToast('info', t(`sketch.messages.${result.error === 'too-large' ? 'offsetTooLarge' : 'transformNothing'}`));
}

export function mirrorSketchSelection(): void {
  const { sketch, sketchSelection } = getState();
  if (sketch) applyTransform(mirrorSelection(sketch.draft.sketch, sketchSelection));
}

export function patternSketchSelection(pattern: { kind: 'linear'; step: Point2; count: number } | { kind: 'circular'; count: number; angle: number }): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  if (pattern.kind === 'linear') {
    applyTransform(linearPattern(sketch.draft.sketch, sketchSelection, pattern.step, pattern.count));
    return;
  }
  const pivot = selectionPivot();
  const ids = sketchSelection.filter((id) => id !== pivot.point);
  applyTransform(circularPattern(sketch.draft.sketch, ids, pivot.at, pattern.count, (pattern.angle * Math.PI) / 180));
}

/** Copies the selection shifted by `offset` and rotated by `angle` (degrees) around the pivot. */
export function copySketchSelection(offset: Point2, angle: number): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const pivot = selectionPivot();
  applyTransform(copySelection(sketch.draft.sketch, sketchSelection.filter((id) => id !== pivot.point), offset, (angle * Math.PI) / 180, pivot.at));
}

/** Moves the selection like a drag would: relations and dimensions are kept, held geometry stays. */
export async function moveSketchSelection(offset: Point2, angle: number): Promise<void> {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const base = sketch.draft.sketch;
  const pivot = selectionPivot();
  const points = movedPoints(base, sketchSelection.filter((id) => id !== pivot.point), offset, (angle * Math.PI) / 180, pivot.at);
  if (points.length === 0) {
    showToast('info', t('sketch.messages.transformNothing'));
    return;
  }
  try {
    const solution = await sketchSolver().solve(base, { drag: { kind: 'points', points }, analyze: false });
    if (getState().sketch?.draft.sketch !== base) return;
    if (solution.converged && !sameGeometry(solution.sketch, base)) recordSketchChange(solution.sketch);
    else showToast('info', t('sketch.messages.moveBlocked'));
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * Scales the selection by `factor` around the pivot: as a copy, or in place (dimensions within the
 * selection scale along; relations to other geometry may refuse it).
 */
export async function scaleSketchSelection(factor: number, copy: boolean): Promise<void> {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const base = sketch.draft.sketch;
  const pivot = selectionPivot();
  const ids = sketchSelection.filter((id) => id !== pivot.point);
  if (copy) {
    applyTransform(scaledCopy(base, ids, factor, pivot.at));
    return;
  }
  const result = scaledInPlace(base, ids, factor, pivot.at, pivot.point ?? ORIGIN_ID);
  if (!result.ok) {
    applyTransform(result);
    return;
  }
  try {
    const solution = await sketchSolver().solve(result.sketch, { analyze: false });
    if (getState().sketch?.draft.sketch !== base) return;
    if (solution.converged && solution.unsatisfied.length === 0) recordSketchChange(solution.sketch);
    else showToast('info', t('sketch.messages.scaleBlocked'));
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

/** Removes one relation or dimension of the open sketch. */
export function deleteSketchConstraint(id: string): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  setState({ sketchSelection: sketchSelection.filter((other) => other !== id), sketchHover: null });
  recordSketchChange(deleteEntities(sketch.draft.sketch, [id]));
}

/** Highlights sketch geometry or a relation from outside the view (e.g. the relation list). */
export function hoverSketchEntity(id: string | null): void {
  if (getState().sketch && getState().sketchHover !== id) setState({ sketchHover: id });
}

/** Deletes the selected sketch geometry with everything that depends on it. */
export function deleteSketchSelection(): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch || sketchSelection.length === 0) return;
  const next = deleteEntities(sketch.draft.sketch, sketchSelection);
  setState({ sketchSelection: [], sketchHover: null });
  recordSketchChange(next);
}

/** Stores the open sketch in the document without leaving sketch mode (before saving). */
function storeOpenSketch(): void {
  const state = getState();
  const session = state.sketch;
  if (!session) return;
  const features = applySketchSession(state.history.features, session);
  if (features) setHistory(commit(state.history, features), { sketch: { ...session, mode: 'edit' } });
}

export function setCommandTab(commandTab: CommandTab): void {
  setState({ commandTab });
}

// ------------------------------------------------------------------ selection

export function handlePick(pick: Pick | null, additive: boolean): void {
  const state = getState();
  if (state.choosingSketchPlane) {
    const plane = pick ? sketchPlaneOf(pick) : null;
    if (plane) chooseSketchPlane(plane);
    return;
  }
  // Sketch geometry is picked by the sketch layer, not here.
  if (state.sketch) return;
  const edit = state.activeEdit;
  if (edit?.draft.type === 'fillet' && roundFaceCount(edit.draft.method) > 0) {
    if (pick?.kind === 'face') pickRoundFace(pick);
    return;
  }
  if (edit && isEdgeFeature(edit.draft)) {
    if (pick?.kind === 'edge') toggleDraftEdge(pick.index);
    if (pick?.kind === 'face') toggleDraftFace(pick);
    return;
  }
  if (edit && isCopyFeature(edit.draft)) {
    if (pick) pickForCopy(pick);
    return;
  }
  if (edit?.draft.type === 'shell') {
    if (pick) toggleShellFace(pick);
    return;
  }
  if (edit?.draft.type === 'thread') {
    if (pick) setThreadFace(pick);
    return;
  }
  if (edit?.draft.type === 'projectedCurve') {
    if (pick?.kind === 'face' && edit.draft.method === 'faces') toggleShellFace(pick);
    return;
  }
  if (edit?.draft.type === 'combine' || edit?.draft.type === 'deleteBody') {
    if (pick) toggleBody(pick);
    return;
  }
  if (edit?.draft.type === 'compositeCurve') {
    if (pick?.kind === 'edge') toggleCurveEdge(pick.index);
    return;
  }
  // A draft: the neutral plane first, then the faces to tilt.
  if (edit?.draft.type === 'draft') {
    if (pick && state.referenceSlot === FEATURES_SLOT) toggleShellFace(pick);
    else if (pick) assignReference(pick);
    return;
  }
  if (edit && extrudesUpTo(edit.draft)) {
    if (pick) pickExtrudeEnd(pick);
    return;
  }
  if (edit && isReferenceFeature(edit.draft)) {
    if (pick) assignReference(pick);
    return;
  }
  if (edit) return;
  if (!pick) {
    if (!additive) setState({ selection: [] });
    return;
  }
  const exists = state.selection.some((s) => s.kind === pick.kind && s.index === pick.index);
  if (state.measuring) {
    // The measure tool collects two picks; a third one starts a new measurement.
    const measurable = state.selection.filter((s) => s.kind === 'face' || s.kind === 'edge' || s.kind === 'vertex');
    if (exists) setState({ selection: measurable.filter((s) => !(s.kind === pick.kind && s.index === pick.index)) });
    else setState({ selection: measurable.length >= 2 || (pick.kind !== 'face' && pick.kind !== 'edge' && pick.kind !== 'vertex') ? [pick] : [...measurable, pick] });
    return;
  }
  if (additive) {
    setState({ selection: exists ? state.selection.filter((s) => !(s.kind === pick.kind && s.index === pick.index)) : [...state.selection, pick] });
  } else {
    setState({ selection: exists && state.selection.length === 1 ? [] : [pick] });
  }
}

export function escape(): void {
  const state = getState();
  if (state.choosingSketchPlane) void cancelSketch();
  else if (state.sketch) {
    if (!sketchToolControl()?.escape()) setState({ sketchSelection: [] });
  }
  else if (state.activeEdit) cancelEdit();
  else setState({ selection: [] });
}

/** Hovering reference geometry in the feature tree shows it in the view. */
export function hoverReference(index: number | null): void {
  const hover = getState().hover;
  if (index === null) {
    if (hover?.kind === 'reference') setState({ hover: null });
  } else if (hover?.kind !== 'reference' || hover.index !== index) {
    setState({ hover: { kind: 'reference', index } });
  }
}

/** Hovering a plane in the feature tree shows it in the view. */
export function hoverPlane(index: number | null): void {
  const hover = getState().hover;
  if (index === null) {
    if (hover?.kind === 'plane') setState({ hover: null });
  } else if (hover?.kind !== 'plane' || hover.index !== index) {
    setState({ hover: { kind: 'plane', index } });
  }
}

// ------------------------------------------------------------------ settings and views

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = await api().setSettings(patch);
  const systemLocale = getState().appInfo?.systemLocale ?? navigator.language;
  const language = resolveLanguage(settings.language, systemLocale);
  if (language !== getState().language) await changeLanguage(language);
  setState({ settings, language });
}

export function setView(view: StandardView): void {
  viewport()?.setStandardView(view);
}

export function zoomToFit(): void {
  viewport()?.zoomToFit();
}

export function openDialog(dialog: 'settings' | 'about' | 'material' | 'configurations'): void {
  setState((state) => ({ dialogs: { ...state.dialogs, [dialog]: true } }));
}

export function closeDialog(dialog: 'settings' | 'about' | 'material' | 'configurations'): void {
  setState((state) => ({ dialogs: { ...state.dialogs, [dialog]: false } }));
}

export function runMenuCommand(command: MenuCommand): void {
  switch (command) {
    case 'file.new':
      void newDocument();
      break;
    case 'file.open':
      void openDocument();
      break;
    case 'file.save':
      void saveDocument(false);
      break;
    case 'file.saveAs':
      void saveDocument(true);
      break;
    case 'file.exportStep':
      void exportModel('step');
      break;
    case 'file.exportStl':
      void exportModel('stl');
      break;
    case 'file.export3mf':
      void exportModel('3mf');
      break;
    case 'file.importStep':
      void importStepFile();
      break;
    case 'edit.undo':
      undo();
      break;
    case 'edit.redo':
      redo();
      break;
    case 'view.zoomToFit':
      zoomToFit();
      break;
    case 'view.front':
    case 'view.back':
    case 'view.left':
    case 'view.right':
    case 'view.top':
    case 'view.bottom':
    case 'view.isometric':
      setView(command.slice(5) as StandardView);
      break;
    case 'view.toggleProjection':
      void updateSettings({ projection: getState().settings.projection === 'perspective' ? 'orthographic' : 'perspective' });
      break;
    case 'view.toggleFrameStats':
      void updateSettings({ showFrameStats: !getState().settings.showFrameStats });
      break;
    case 'view.toggleSketchRelations':
      void updateSettings({ showSketchRelations: !getState().settings.showSketchRelations });
      break;
    case 'app.settings':
      openDialog('settings');
      break;
    case 'app.about':
      openDialog('about');
      break;
  }
}
