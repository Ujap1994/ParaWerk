/**
 * The feature showcase (tests/fixtures/showcase.ts): one large part with nearly every feature of
 * ParaWerk, built on each other. It builds without errors or warnings, follows edits of its variables
 * and its first sketch, survives every single feature being suppressed, saves and opens again, and exports.
 */
import { strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { RebuildResult } from '../../src/kernel/protocol.ts';
import { regenerate } from '../../src/renderer/src/variables.ts';
import { EXPRESSION_FIELDS, type Feature, type FeatureType } from '../../src/shared/model/feature.ts';
import { applyConfiguration } from '../../src/shared/model/configurations.ts';
import { decodePartFile, encodePartFile } from '../../src/shared/model/part-file.ts';
import { buildShowcase, SHOWCASE_CONFIGURATIONS, showcaseStep } from '../fixtures/showcase.ts';

let kernel: Kernel;
let features: Feature[];

beforeAll(async () => {
  kernel = await createKernel('parawerk');
  features = buildShowcase(kernel, strFromU8(showcaseStep(kernel)));
}, 120_000);

afterAll(() => {
  kernel[Symbol.dispose]();
});

function build(list: Feature[]): RebuildResult {
  return kernel.rebuild({ features: list, captures: [list.length - 1], knownMeshKeys: [], withProperties: true }).result;
}

/** Every feature that did not build, or built with a warning. */
function problems(result: RebuildResult): string[] {
  return result.features.flatMap((feature) => (feature.status === 'error' || feature.warning ? [`${feature.id}: ${JSON.stringify(feature.error ?? feature.warning)}`] : []));
}

const volume = (result: RebuildResult) => result.captures[0]?.properties?.volume ?? Number.NaN;

/** Sets variables and evaluates every expression of the part again, as the variables panel does. */
async function withVariables(list: Feature[], values: Record<string, string>): Promise<Feature[]> {
  const changed = list.map((feature) =>
    feature.type === 'variables' ? { ...feature, variables: feature.variables.map((variable) => (values[variable.name] !== undefined ? { ...variable, expression: values[variable.name] as string } : variable)) } : feature,
  );
  return (await regenerate(changed, async (sketch) => sketch)).features;
}

describe('the feature showcase', () => {
  it('uses every kind of feature, and every type of fillet, chamfer, hole and extrusion end', () => {
    const used = new Set(features.map((feature) => feature.type));
    const all = Object.keys(EXPRESSION_FIELDS) as FeatureType[];
    expect(all.filter((type) => !used.has(type))).toEqual([]);
    expect(features.length).toBeGreaterThan(80);
    const fillets = new Set(features.flatMap((feature) => (feature.type === 'fillet' ? [feature.method ?? 'constant'] : [])));
    expect([...fillets].sort()).toEqual(['constant', 'faces', 'fullRound', 'variable']);
    const chamfers = new Set(features.flatMap((feature) => (feature.type === 'chamfer' ? [feature.method ?? 'equal'] : [])));
    expect([...chamfers].sort()).toEqual(['angle', 'distances', 'equal']);
    const holes = new Set(features.flatMap((feature) => (feature.type === 'hole' ? [feature.kind] : [])));
    expect([...holes].sort()).toEqual(['counterbore', 'countersink', 'simple', 'tapped']);
    const ends = new Set(features.flatMap((feature) => (feature.type === 'extrude' ? [feature.end ?? 'blind'] : [])));
    expect([...ends].sort()).toEqual(['blind', 'throughAll', 'upToNext', 'upToSurface']);
  });

  it('builds every feature without an error or a warning', async () => {
    // A kernel of its own, so nothing comes from the cache.
    const fresh = await createKernel('parawerk');
    const start = performance.now();
    const result = fresh.rebuild({ features, captures: [features.length - 1], knownMeshKeys: [], withProperties: true }).result;
    const ms = performance.now() - start;
    fresh[Symbol.dispose]();
    expect(problems(result)).toEqual([]);
    expect(volume(result)).toBeGreaterThan(240_000);
    expect(volume(result)).toBeLessThan(270_000);
    // One body: the housing is joined to the plate, the lid deleted again.
    const names = result.captures[0]?.mesh?.naming.faces ?? [];
    expect(names.some((name) => name.startsWith('lid:'))).toBe(false);
    expect(names.filter((name) => name.includes('cornerHole') && name.endsWith(':wall'))).toHaveLength(12);
    console.info(`feature showcase: ${features.length} features, built in ${ms.toFixed(0)} ms`);
  });

  it('follows a thicker plate and a taller boss set in the variables', async () => {
    const before = volume(build(features));
    const thicker = await withVariables(features, { thickness: '16', bossHeight: '38' });
    const result = build(thicker);
    expect(problems(result)).toEqual([]);
    expect(volume(result)).toBeGreaterThan(before + 160 * 100 * 3);
  });

  it('builds each of its configurations', async () => {
    for (const configuration of SHOWCASE_CONFIGURATIONS.list) {
      const configured = (await regenerate(applyConfiguration(features, configuration), async (sketch) => sketch)).features;
      expect(problems(build(configured)), configuration.name).toEqual([]);
    }
  });

  it('follows a longer plate drawn in its first sketch', () => {
    const longer = features.map((feature) =>
      feature.id === 'base' && feature.type === 'sketch'
        ? { ...feature, sketch: { ...feature.sketch, entities: feature.sketch.entities.map((entity) => (entity.type === 'point' && (entity.id === 'r1' || entity.id === 'r4') ? { ...entity, x: -90 } : entity)) } }
        : feature,
    );
    const result = build(longer);
    expect(problems(result)).toEqual([]);
    expect(volume(result)).toBeGreaterThan(volume(build(features)) + 10 * 100 * 11);
  });

  it('survives every single feature being suppressed', () => {
    const unexpected: string[] = [];
    // CI suppresses every feature; locally every third one keeps the run short.
    const step = process.env.CI ? 1 : 3;
    for (const [index, suppressed] of features.entries()) {
      if (suppressed.type === 'variables' || index % step !== 0) continue;
      const list = features.map((feature, i) => (i === index ? ({ ...feature, suppressed: true } as Feature) : feature));
      const result = build(list);
      // Features that build on the suppressed one may fail, but always with a reason, never unexpectedly.
      for (const feature of result.features) if (feature.error?.code === 'unknown') unexpected.push(`${suppressed.id} suppressed → ${feature.id}: ${feature.error.detail ?? ''}`);
    }
    expect(unexpected).toEqual([]);
    // Back to the whole part.
    expect(problems(build(features))).toEqual([]);
  }, 300_000);

  it('saves and opens again with the same geometry', () => {
    const file = encodePartFile({ features, units: 'mm', properties: { configurations: SHOWCASE_CONFIGURATIONS } }, { appVersion: 'test', savedAt: '2026-10-27T00:00:00Z' });
    const { document } = decodePartFile(file);
    expect(document.features).toEqual(features);
    expect(document.properties?.configurations).toEqual(SHOWCASE_CONFIGURATIONS);
    expect(volume(build(document.features))).toBeCloseTo(volume(build(features)), 3);
  });

  it('exports STEP, STL and 3MF, and the STEP file imports with the same volume', () => {
    const step = kernel.exportModel({ features, format: 'step' });
    const stl = kernel.exportModel({ features, format: 'stl' });
    const threeMf = kernel.exportModel({ features, format: '3mf', title: 'Feature showcase' });
    expect(step.length).toBeGreaterThan(100_000);
    expect(stl.length).toBeGreaterThan(100_000);
    expect(threeMf.length).toBeGreaterThan(10_000);
    const data = strFromU8(step);
    const imported = build([{ id: 'again', type: 'import', operation: 'add', file: 'showcase.step', hash: 'x', data }]);
    expect(problems(imported)).toEqual([]);
    expect(volume(imported)).toBeCloseTo(volume(build(features)), 0);
  });
});
