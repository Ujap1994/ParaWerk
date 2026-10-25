/** Recovery copies on disk (src/main/recovery.ts). */
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidSession, RecoveryStore } from '../../src/main/recovery.ts';

const data = (text: string) => new TextEncoder().encode(text);

describe('recovery store', () => {
  it('writes, lists newest first, reads and discards copies', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'parawerk-recovery-')), 'recovery');
    const store = new RecoveryStore(dir);
    expect(await store.list()).toEqual([]);
    await store.write('session-one', 'Bracket', '/parts/bracket.pwpart', data('one'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.write('session-two', 'Untitled', null, data('two'));
    const entries = await store.list();
    expect(entries.map((entry) => [entry.session, entry.name, entry.path, entry.size])).toEqual([
      ['session-two', 'Untitled', null, 3],
      ['session-one', 'Bracket', '/parts/bracket.pwpart', 3],
    ]);
    expect(await store.list('session-two')).toHaveLength(1);
    expect(new TextDecoder().decode((await store.read('session-one')) ?? new Uint8Array())).toBe('one');
    await store.discard('session-one');
    expect((await store.list()).map((entry) => entry.session)).toEqual(['session-two']);
    // No temporary files are left behind.
    expect((await readdir(dir)).sort()).toEqual(['session-two.json', 'session-two.pwpart']);
  });

  it('rejects session ids that could leave the folder and skips incomplete copies', async () => {
    expect(isValidSession('0f6c1c4e-9b1a-4c55-a2c1-3f8a2a1c9d10')).toBe(true);
    for (const bad of ['../evil', 'a/b', 'short', 'UPPER-CASE-ID', '', 42]) expect(isValidSession(bad)).toBe(false);
    const dir = await mkdtemp(path.join(tmpdir(), 'parawerk-recovery-'));
    const store = new RecoveryStore(dir);
    await expect(store.write('../evil-session', 'x', null, data('x'))).rejects.toThrow();
    expect(await store.read('../evil-session')).toBeNull();
    // A description without its data, and broken JSON, are not offered.
    await writeFile(path.join(dir, 'lonely-session.json'), JSON.stringify({ name: 'x', path: null, savedAt: '2026-10-25T00:00:00Z' }));
    await writeFile(path.join(dir, 'broken-session.json'), '{');
    await writeFile(path.join(dir, 'broken-session.pwpart'), 'x');
    expect(await store.list()).toEqual([]);
  });
});
