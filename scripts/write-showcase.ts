/**
 * Writes the feature showcase (tests/fixtures/showcase.ts) as docs/examples/feature-showcase.pwpart: one
 * large part with nearly every feature of ParaWerk, in aluminium, with two configurations.
 * Run with `npm run docs:showcase`.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { strFromU8 } from 'fflate';
import { createKernel } from '../src/kernel/create.ts';
import { encodePartFile } from '../src/shared/model/part-file.ts';
import { buildShowcase, SHOWCASE_CONFIGURATIONS, showcaseStep } from '../tests/fixtures/showcase.ts';

const out = path.resolve(import.meta.dirname, '../docs/examples/feature-showcase.pwpart');
const kernel = await createKernel('parawerk');
try {
  const features = buildShowcase(kernel, strFromU8(showcaseStep(kernel)));
  const result = kernel.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
  const failed = result.features.filter((feature) => feature.status === 'error' || feature.warning);
  if (failed.length > 0) throw new Error(`the showcase does not build cleanly: ${failed.map((feature) => feature.id).join(', ')}`);
  const configurations = SHOWCASE_CONFIGURATIONS;
  const file = encodePartFile(
    { features, units: 'mm', properties: { material: { id: 'aluminium-6061', density: 2700 }, configurations } },
    { appVersion: 'feature showcase', savedAt: '2026-10-27T12:00:00.000Z' },
  );
  writeFileSync(out, file);
  console.info(`${features.length} features, ${(result.captures[0]?.properties?.volume ?? 0).toFixed(0)} mm³ → ${path.relative(process.cwd(), out)}`);
} finally {
  kernel[Symbol.dispose]();
}
