import { isCopyFeature, isCurveFeature, isSurfaceFeature, isEdgeFeature, isReferenceFeature } from '../../../shared/model/feature.ts';
import type { FeatureResult, MassProperties, MeshPayload } from '../../../kernel/protocol.ts';
import { t } from '../i18n.ts';
import { KernelClient, KernelCrashedError } from '../kernel/kernel-client.ts';
import { extrudesUpTo } from '../references.ts';
import { rebuildPlan, rollbackIndex, type RebuildPlan } from './document.ts';
import { getState, setHistory, setState, showToast, store, type DisplayMeshes } from './store.ts';

/** Show "Rebuilding…" only for rebuilds that take noticeably long, to avoid flicker while typing. */
const BUSY_INDICATOR_DELAY_MS = 150;
/** Stop retrying after this many kernel crashes on the same document state. */
const MAX_CRASHES_PER_PLAN = 2;

let client: KernelClient | null = null;
let running = false;
let queued = false;
let crashes = { plan: '', count: 0 };
const idleWaiters: (() => void)[] = [];

export function startKernel(): KernelClient {
  client = new KernelClient(
    () => new Worker(new URL('../../../kernel/worker.ts', import.meta.url), { type: 'module', name: 'parawerk-kernel' }),
    {
      onReady: () => {
        if (getState().kernelStatus === 'loading') setState({ kernelStatus: 'ready' });
      },
      onWarm: () => undefined,
      onRestart: (reason) => {
        if (reason !== 'memory' && reason !== 'disposed') showToast('error', t('toasts.kernelRestarted'));
        scheduleRebuild();
      },
    },
  );

  store.subscribe((state, previous) => {
    // Sketch edits do not change the body; only entering or leaving sketch mode rolls the model back or forward.
    if (
      state.history.features !== previous.history.features ||
      state.activeEdit !== previous.activeEdit ||
      state.rollback !== previous.rollback ||
      state.sketch?.index !== previous.sketch?.index
    ) {
      scheduleRebuild();
    }
  });
  scheduleRebuild();
  return client;
}

export function kernel(): KernelClient {
  if (!client) throw new Error('kernel not started');
  return client;
}

export function scheduleRebuild(): void {
  queued = true;
  if (!running) void runLoop();
}

/** Resolves when no rebuild is running or queued (used by tests and exports). */
export function whenIdle(): Promise<void> {
  if (!running && !queued) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function planSignature(plan: RebuildPlan): string {
  return JSON.stringify(plan);
}

async function runLoop(): Promise<void> {
  if (!client) return;
  running = true;
  while (queued) {
    queued = false;
    const state = getState();
    const plan = rebuildPlan(state.history.features, state.activeEdit, state.sketch?.index ?? null, rollbackIndex(state.history.features, state.rollback));
    const busyTimer = setTimeout(() => setState({ kernelStatus: 'busy' }), BUSY_INDICATOR_DELAY_MS);
    try {
      const { result, meshes } = await client.rebuild({
        features: plan.features,
        captures: plan.captures,
        withProperties: state.activeEdit === null && state.sketch === null,
      });
      crashes = { plan: '', count: 0 };
      // A newer state is already waiting: skip these results to avoid flicker.
      if (queued) continue;
      applyResult(plan, result.features, result.captures[result.captures.length - 1]?.properties ?? null, meshes, {
        totalMs: result.timings.totalMs,
        rebuiltFeatures: result.timings.rebuiltFeatures,
      });
      setState({ kernelStatus: 'ready' });
    } catch (error) {
      if (error instanceof KernelCrashedError) {
        const signature = planSignature(plan);
        crashes = crashes.plan === signature ? { plan: signature, count: crashes.count + 1 } : { plan: signature, count: 1 };
        if (crashes.count > MAX_CRASHES_PER_PLAN) {
          // The same state keeps crashing the kernel; wait for the user to change the document (e.g. undo).
          queued = false;
          setState({ kernelStatus: 'error' });
        }
      } else {
        setState({ kernelStatus: 'error' });
        showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      clearTimeout(busyTimer);
    }
  }
  running = false;
  for (const resolve of idleWaiters.splice(0)) resolve();
  void client.recycleIfNeeded().catch(() => undefined);
}

function applyResult(
  plan: RebuildPlan,
  results: FeatureResult[],
  properties: MassProperties | null,
  meshes: Map<number, MeshPayload | null>,
  timings: { totalMs: number; rebuiltFeatures: number },
): void {
  const { activeEdit, sketch } = getState();
  const last = plan.features.length - 1;
  let display: DisplayMeshes;
  if (sketch) {
    display = { body: meshes.get(last) ?? null, preview: null, pickable: false };
  } else if (activeEdit?.draft.type === 'variables') {
    // While the variables are edited, the whole part stays as it is (see rebuildPlan).
    display = { body: meshes.get(last) ?? null, preview: null, pickable: false };
  } else if (!activeEdit) {
    display = { body: meshes.get(last) ?? null, preview: null, pickable: true };
  } else if (
    isEdgeFeature(activeEdit.draft) ||
    activeEdit.draft.type === 'shell' ||
    activeEdit.draft.type === 'draft' ||
    activeEdit.draft.type === 'thread' ||
    activeEdit.draft.type === 'combine' ||
    activeEdit.draft.type === 'deleteBody' ||
    extrudesUpTo(activeEdit.draft)
  ) {
    // Edges and faces are picked on the body before the feature; its result is shown as a preview.
    display = { body: meshes.get(activeEdit.index - 1) ?? null, preview: meshes.get(activeEdit.index) ?? null, pickable: true };
  } else if (isReferenceFeature(activeEdit.draft) || isCurveFeature(activeEdit.draft) || isSurfaceFeature(activeEdit.draft)) {
    // Reference geometry is built on faces, edges and vertices of the body before it (which it does not change).
    display = { body: meshes.get(activeEdit.index - 1) ?? null, preview: null, pickable: true };
  } else if (isCopyFeature(activeEdit.draft)) {
    // A pattern or mirror shows its result; faces of the features it copies and references are picked on it.
    display = { body: meshes.get(activeEdit.index) ?? null, preview: null, pickable: true };
  } else {
    display = { body: meshes.get(activeEdit.index) ?? null, preview: null, pickable: false };
  }

  setState((state) => {
    const bodyChanged = state.display.body?.key !== display.body?.key;
    return {
      display,
      rebuild: {
        results,
        properties: activeEdit || sketch ? (state.rebuild?.properties ?? null) : properties,
        totalMs: timings.totalMs,
        rebuiltFeatures: timings.rebuiltFeatures,
      },
      // Topological indices refer to one specific body; a new body invalidates the selection.
      ...(bodyChanged ? { selection: [], hover: null } : {}),
    };
  });
  takeOverHealedEdges(plan, results);
}

/**
 * Takes over references that the kernel brought up to date (docs/adr/0002-persistent-naming.md): edge
 * indices of older files and edges found again only by position get their current names, and sketches
 * on faces get the plane where their face is now (sketches on reference planes where the plane is),
 * and references of reference geometry found by position their current names. This is not an undo step, and a document that was
 * saved stays saved: its geometry is the same.
 */
function takeOverHealedEdges(plan: RebuildPlan, results: FeatureResult[]): void {
  const healed = new Map(
    results.flatMap((result) => (result.healedEdges || result.healedPlane || result.healedReferences || result.healedFaces ? [[result.id, result] as const] : [])),
  );
  if (healed.size === 0) return;
  const state = getState();
  // Only the document as it is: while a feature or sketch is edited, the plan is not the whole part.
  if (state.activeEdit || state.sketch || state.history.features !== plan.features) return;
  let changed = false;
  const features = state.history.features.map((feature) => {
    const result = healed.get(feature.id);
    // Only real changes: taking over the same references again would rebuild forever.
    if (result?.healedEdges && isEdgeFeature(feature) && JSON.stringify(result.healedEdges) !== JSON.stringify(feature.edges)) {
      changed = true;
      return { ...feature, edges: result.healedEdges };
    }
    if (result?.healedPlane && feature.type === 'sketch' && JSON.stringify(result.healedPlane) !== JSON.stringify(feature.plane)) {
      changed = true;
      return { ...feature, plane: result.healedPlane };
    }
    if (result?.healedFaces && (feature.type === 'shell' || feature.type === 'draft' || feature.type === 'thread') && JSON.stringify(result.healedFaces) !== JSON.stringify(feature.faces)) {
      changed = true;
      return { ...feature, faces: result.healedFaces };
    }
    if (result?.healedReferences && isReferenceFeature(feature) && JSON.stringify(result.healedReferences) !== JSON.stringify(feature.references)) {
      changed = true;
      return { ...feature, references: result.healedReferences };
    }
    return feature;
  });
  if (!changed) return;
  const saved = state.savedFeatures === state.history.features;
  setHistory({ ...state.history, features }, saved ? { savedFeatures: features } : {});
}
