/** The README and the docs link only to files, images and headings that exist (as GitHub shows them). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return markdownFiles(file);
    return name.endsWith('.md') ? [file] : [];
  });
}

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces as hyphens. */
function slug(heading: string): string {
  return heading
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function anchors(file: string): Set<string> {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slug(match[1] ?? '')));
}

/** Relative links and images of a Markdown file, outside code blocks. */
function links(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? '').filter((target) => !/^(https?:|mailto:)/.test(target));
}

const files = [path.join(root, 'README.md'), path.join(root, 'CHANGELOG.md'), ...markdownFiles(path.join(root, 'docs'))];

describe('documentation links', () => {
  it('finds the function reference', () => {
    expect(files.filter((file) => file.includes(`${path.sep}reference${path.sep}`)).length).toBeGreaterThan(50);
  });

  it.each(files.map((file) => [path.relative(root, file), file]))('%s links to existing files and headings', (_name, file) => {
    const broken: string[] = [];
    for (const target of links(file)) {
      const [target_path = '', anchor] = target.split('#');
      const linked = target_path === '' ? file : path.resolve(path.dirname(file), decodeURIComponent(target_path));
      if (!existsSync(linked)) {
        broken.push(target);
        continue;
      }
      if (anchor && linked.endsWith('.md') && !anchors(linked).has(anchor)) broken.push(target);
    }
    expect(broken).toEqual([]);
  });
});
