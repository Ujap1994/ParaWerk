import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RecoveryEntry } from '../shared/ipc.ts';

/** Session ids come from the renderer: only these characters, so they cannot leave the folder. */
const SESSION = /^[a-z0-9-]{8,64}$/;
/** Largest recovery copy kept (part files are small; this guards against runaway data). */
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_NAME = 260;

export function isValidSession(session: unknown): session is string {
  return typeof session === 'string' && SESSION.test(session);
}

interface RecoveryMeta {
  name: string;
  path: string | null;
  savedAt: string;
}

/**
 * Recovery copies of unsaved documents (docs/user-guide/files.md#recovery): the renderer writes the
 * document a few seconds after changes; a clean close removes the copy, so whatever is left at the next
 * start comes from a session that ended abnormally (crash, power loss, killed process).
 */
export class RecoveryStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(session: string, extension: 'pwpart' | 'json'): string {
    if (!isValidSession(session)) throw new Error('invalid recovery session');
    return path.join(this.dir, `${session}.${extension}`);
  }

  /** Writes the copy of a session; the data file first, then its description, both atomically. */
  async write(session: string, name: string, documentPath: string | null, data: Uint8Array): Promise<void> {
    if (!(data instanceof Uint8Array) || data.byteLength > MAX_BYTES) throw new Error('invalid recovery data');
    if (typeof name !== 'string' || name.length > MAX_NAME) throw new Error('invalid recovery name');
    if (documentPath !== null && typeof documentPath !== 'string') throw new Error('invalid recovery path');
    await mkdir(this.dir, { recursive: true });
    const meta: RecoveryMeta = { name, path: documentPath, savedAt: new Date().toISOString() };
    for (const [target, content] of [
      [this.file(session, 'pwpart'), data],
      [this.file(session, 'json'), JSON.stringify(meta)],
    ] as const) {
      const temporary = `${target}.tmp`;
      await writeFile(temporary, content);
      await rename(temporary, target);
    }
  }

  async discard(session: string): Promise<void> {
    if (!isValidSession(session)) return;
    await Promise.all([rm(this.file(session, 'pwpart'), { force: true }), rm(this.file(session, 'json'), { force: true })]);
  }

  /** The copies left behind, newest first (incomplete or unreadable ones are skipped). */
  async list(except?: string): Promise<RecoveryEntry[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const entries: RecoveryEntry[] = [];
    for (const file of files) {
      const session = file.endsWith('.json') ? file.slice(0, -'.json'.length) : '';
      if (!isValidSession(session) || session === except) continue;
      try {
        const meta = JSON.parse(await readFile(this.file(session, 'json'), 'utf8')) as Partial<RecoveryMeta>;
        const info = await stat(this.file(session, 'pwpart'));
        if (typeof meta.name !== 'string' || typeof meta.savedAt !== 'string') continue;
        entries.push({ session, name: meta.name, path: typeof meta.path === 'string' ? meta.path : null, savedAt: meta.savedAt, size: info.size });
      } catch {
        // A copy without its data (or description) cannot be restored.
      }
    }
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async read(session: string): Promise<Uint8Array | null> {
    if (!isValidSession(session)) return null;
    try {
      const data = await readFile(this.file(session, 'pwpart'));
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } catch {
      return null;
    }
  }
}
