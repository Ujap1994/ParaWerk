import type { MeasureTarget } from '../../../kernel/measure.ts';
import { rebuildPlan, rollbackIndex } from './document.ts';
import { kernel, whenIdle } from './rebuild.ts';
import { getState, setState, store, type AppState, type Pick } from './store.ts';

/** The faces, edges and vertices of the selection that the measure tool measures (the first two). */
export function measureTargets(selection: readonly Pick[]): MeasureTarget[] {
  return selection.flatMap((pick) => (pick.kind === 'face' || pick.kind === 'edge' || pick.kind === 'vertex' ? [{ kind: pick.kind, index: pick.index }] : [])).slice(0, 2);
}

let generation = 0;

/** Measures the selection of the shown body in the kernel worker; a newer selection wins. */
async function measure(state: AppState): Promise<void> {
  const current = ++generation;
  const targets = measureTargets(state.selection);
  if (!state.measuring || targets.length === 0 || state.activeEdit || state.sketch || !state.display.body) {
    if (state.measurement) setState({ measurement: null });
    return;
  }
  // The shown body is the part up to the rollback bar.
  const { features } = rebuildPlan(state.history.features, null, null, rollbackIndex(state.history.features, state.rollback));
  try {
    await whenIdle();
    const result = await kernel().measure({ features, targets });
    if (current !== generation) return;
    setState({ measurement: { targets: state.selection, result } });
  } catch {
    if (current === generation) setState({ measurement: null });
  }
}

/** Keeps the measurement up to date with the selection and the shown body while the measure tool is on. */
export function startMeasuring(): void {
  store.subscribe((state, previous) => {
    if (state.measuring === previous.measuring && state.selection === previous.selection && state.display.body === previous.display.body) return;
    void measure(state);
  });
  if (getState().measuring) void measure(getState());
}
