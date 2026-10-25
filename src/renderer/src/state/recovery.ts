import { NO_PROPERTIES } from '../../../shared/model/material.ts';
import { decodePartFile, encodePartFile } from '../../../shared/model/part-file.ts';
import type { RecoveryEntry } from '../../../shared/ipc.ts';
import { t } from '../i18n.ts';
import { applySketchSession } from '../sketch/session.ts';
import { emptyHistory } from './document.ts';
import { getState, partProperties, setState, showToast, store } from './store.ts';

/**
 * How long after a change the recovery copy is written; changes in between are part of the same
 * write, so a copy is never older than this while there is unsaved work.
 */
export const RECOVERY_DELAY_MS = 15_000;

const api = () => window.parawerk;

/** This renderer's session: its recovery copy is named after it (see src/main/recovery.ts). */
const session = crypto.randomUUID();

let timer: ReturnType<typeof setTimeout> | null = null;
let written = false;

/** Writes the recovery copy of the unsaved document now (the open sketch included). */
export async function writeRecoveryNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const state = getState();
  if (!state.settings.autoRecover || !state.dirty) return;
  const features = (state.sketch ? applySketchSession(state.history.features, state.sketch) : null) ?? state.history.features;
  const data = encodePartFile(
    { units: 'mm', features, properties: partProperties(state.history) },
    { appVersion: state.appInfo?.version ?? 'dev', savedAt: new Date().toISOString() },
  );
  try {
    await api().writeRecovery({ session, name: state.fileName ?? t('app.untitled'), path: state.filePath, data });
    written = true;
  } catch (error) {
    // A missing recovery copy must never get in the way of the work itself.
    console.warn('Could not write the recovery copy', error);
  }
}

async function discardOwnCopy(): Promise<void> {
  if (!written) return;
  written = false;
  try {
    await api().discardRecovery(session);
  } catch (error) {
    console.warn('Could not remove the recovery copy', error);
  }
}

/** Keeps a recovery copy while there is unsaved work, and removes it once the work is saved or discarded. */
export function startRecovery(): void {
  store.subscribe((state, previous) => {
    if (!state.dirty || !state.settings.autoRecover) {
      if (timer) clearTimeout(timer);
      timer = null;
      if (previous.dirty || previous.settings.autoRecover !== state.settings.autoRecover) void discardOwnCopy();
      return;
    }
    const changed = state.history !== previous.history || state.sketch !== previous.sketch || state.dirty !== previous.dirty || state.fileName !== previous.fileName;
    if (changed && !timer) timer = setTimeout(() => void writeRecoveryNow(), RECOVERY_DELAY_MS);
  });
}

/** Offers the recovery copies that sessions which ended abnormally left behind. */
export async function offerRecovery(): Promise<void> {
  try {
    const entries = await api().listRecovery();
    if (entries.length > 0) setState({ recovery: entries });
  } catch (error) {
    console.warn('Could not look for recovery copies', error);
  }
}

/** Opens a recovery copy as an unsaved document (it has to be saved to be kept) and removes the copy. */
export async function restoreRecovery(entry: RecoveryEntry): Promise<void> {
  const data = await api().readRecovery(entry.session);
  try {
    if (!data) throw new Error(t('recovery.missing'));
    const { document } = decodePartFile(data);
    const history = emptyHistory(document.features, document.properties ?? NO_PROPERTIES);
    // Nothing of it is saved: the document is dirty until it is saved again.
    setState({
      history,
      savedFeatures: [],
      savedProperties: NO_PROPERTIES,
      dirty: true,
      filePath: entry.path,
      fileName: entry.path ? entry.name : null,
      rollback: null,
      activeEdit: null,
      sketch: null,
      selection: [],
      // One document is open at a time; the other copies stay for the next start.
      recovery: [],
    });
    showToast('success', t('recovery.restored', { name: entry.name }));
  } catch (error) {
    showToast('error', t('recovery.failed', { message: error instanceof Error ? error.message : String(error) }));
    setState({ recovery: getState().recovery.filter((other) => other.session !== entry.session) });
  }
  await api().discardRecovery(entry.session);
}

/** Throws a recovery copy away. */
export async function discardRecovery(entry: RecoveryEntry): Promise<void> {
  setState({ recovery: getState().recovery.filter((other) => other.session !== entry.session) });
  await api().discardRecovery(entry.session);
}
