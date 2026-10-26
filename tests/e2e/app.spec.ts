import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { crashApp, idle, launchApp, relaunchAfterCrash, repoRoot, type LaunchedApp } from './harness.ts';

interface HookState {
  history: { features: { type: string; id: string; suppressed?: boolean }[] };
  rebuild: { properties: { volume: number } | null; results: { status: string; error?: { code: string } }[] } | null;
  dirty: boolean;
  language: string;
  fileName: string | null;
}

async function state(page: Page): Promise<HookState> {
  return page.evaluate(() => (window as unknown as { __parawerk: { getState(): unknown } }).__parawerk.getState() as HookState);
}

async function volume(page: Page): Promise<number> {
  await idle(page);
  return (await state(page)).rebuild?.properties?.volume ?? Number.NaN;
}

/** Clicks the screen position of a world point (e.g. the middle of an edge). */
async function clickWorldPoint(page: Page, point: [number, number, number]): Promise<void> {
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const screen = await page.evaluate(
    ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
    point,
  );
  await page.mouse.move(canvas.x + screen.x, canvas.y + screen.y);
  await page.mouse.click(canvas.x + screen.x, canvas.y + screen.y);
  await idle(page);
}

/** Changes the feature being edited in the side panel directly (fields the panel offers as several controls). */
async function updateDraft(page: Page, patch: object): Promise<void> {
  await page.evaluate((p) => (window as unknown as { __parawerk: { commands: { updateDraft(patch: object): void } } }).__parawerk.commands.updateDraft(p), patch);
}

/** How many places of lost references the 3D view marks. */
async function lostMarkers(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __parawerk: { viewport: { lostMarkers(): number } } }).__parawerk.viewport.lostMarkers());
}

async function createBox(page: Page): Promise<void> {
  await page.click('[data-command="box"]');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
}

let launched: LaunchedApp | undefined;

test.afterEach(async () => {
  await launched?.app.close();
  launched = undefined;
});

test('starts with one window, the kernel ready and the system language', async () => {
  launched = await launchApp();
  const { app, page } = launched;
  expect(app.windows()).toHaveLength(1);
  await expect(page).toHaveTitle(/ParaWerk/);
  await expect(page.locator('[data-testid="kernel-status"]')).toHaveAttribute('data-status', 'ready');
  const security = await page.evaluate(() => ({
    node: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    isolated: window.crossOriginIsolated,
  }));
  expect(security).toEqual({ node: 'undefined', process: 'undefined', isolated: true });
});

test('allows only a single instance', async () => {
  launched = await launchApp();
  // In Node, the electron package resolves to the path of the Electron binary.
  const electronBinary = require('electron') as string;
  const second = spawn(electronBinary, [repoRoot], {
    env: { ...process.env, PARAWERK_E2E: '1', PARAWERK_USER_DATA: launched.userData },
    stdio: 'ignore',
  });
  const exitCode = await new Promise<number | null>((resolve) => second.on('exit', resolve));
  expect(exitCode).toBe(0);
  expect(launched.app.windows()).toHaveLength(1);
});

test('passes the built-in installation self-test', async () => {
  const electronBinary = require('electron') as string;
  const child = spawn(electronBinary, [repoRoot, '--self-test'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exitCode = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  expect(exitCode, output).toBe(0);
  expect(output).toContain('"ok": true');
});

test('creates a box, rounds edges picked in the 3D view and exports STEP and STL', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page, outputDir } = launched;

  await createBox(page);
  expect(await volume(page)).toBeCloseTo(240_000, 3);

  await page.click('[data-command="fillet"]');
  await idle(page);
  // Middle of the top front edge of the 100 × 60 × 40 box.
  await clickWorldPoint(page, [0, -30, 40]);
  await expect(page.locator('[data-testid="edge-count"]')).toContainText('1');
  await page.locator('[data-testid="fillet-radius"]').fill('5');
  await page.click('[data-testid="panel-ok"]');

  // One rounded 100 mm edge removes r²(1 - π/4) · 100.
  expect(await volume(page)).toBeCloseTo(240_000 - 25 * (1 - Math.PI / 4) * 100, 1);
  expect((await state(page)).history.features.map((f) => f.type)).toEqual(['box', 'fillet']);

  await page.click('[data-command="export-step"]');
  await expect(page.locator('[data-testid="toast-success"]').last()).toBeVisible();
  const step = await readFile(path.join(outputDir, `${await page.evaluate(() => document.title.split(' – ')[0]?.replace(' •', ''))}.step`));
  expect(step.subarray(0, 13).toString()).toBe('ISO-10303-21;');

  // The other formats are in the menu of the export button, which then exports in the last used one.
  await page.click('[data-variants="export"]');
  await page.click('[data-entry="export-stl"]');
  await expect(page.locator('[data-testid="toast-success"]').last()).toContainText('.stl');
  await expect(page.locator('[data-command="export-stl"]')).toBeVisible();
  await page.click('[data-variants="export"]');
  await page.click('[data-entry="export-3mf"]');
  await expect(page.locator('[data-testid="toast-success"]').last()).toContainText('.3mf');
  const threeMf = await readFile(path.join(outputDir, `${await page.evaluate(() => document.title.split(' – ')[0]?.replace(' •', ''))}.3mf`));
  expect(threeMf.subarray(0, 2).toString()).toBe('PK');
});

test('extrudes in two directions and with a draft angle', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  // A 40 × 20 rectangle on the top plane.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [P('a', -20, -10), P('b', 20, -10), P('c', 20, 10), P('d', -20, 10), { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' }, { id: 'l3', type: 'line', p1: 'c', p2: 'd' }, { id: 'l4', type: 'line', p1: 'd', p2: 'a' }],
      constraints: [],
    };
    const features = [{ id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features });
  });
  await idle(page);
  await page.click('[data-command="extrude"]');
  await page.locator('[data-testid="extrude-depth"]').fill('10');
  await page.getByRole('radio', { name: 'Two directions' }).click();
  await page.locator('[data-testid="extrude-depth2"]').fill('4');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(40 * 20 * 14, 3);

  const extrudeId = (await state(page)).history.features[1]?.id;
  await page.dblclick(`[data-feature-id="${extrudeId}"]`);
  await page.getByRole('radio', { name: 'Normal', exact: true }).click();
  await page.locator('[data-testid="extrude-draft-on"]').check();
  await page.locator('[data-testid="extrude-draft"]').fill('5');
  await page.click('[data-testid="panel-ok"]');
  // ∫ (40 − 2kz)(20 − 2kz) dz over 10 mm with k = tan 5°.
  const k = Math.tan((5 * Math.PI) / 180);
  expect(await volume(page)).toBeCloseTo(800 * 10 - k * 60 * 100 + (4 / 3) * k * k * 1000, 2);
  expect((await state(page)).history.features[1]).toMatchObject({ direction: 'normal', draft: 5 });
});

test('chamfers an edge with two distances and with a distance and an angle', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="chamfer"]');
  await idle(page);
  await clickWorldPoint(page, [0, -30, 40]);
  await expect(page.locator('[data-testid="edge-count"]')).toContainText('1');
  await page.getByRole('radio', { name: 'Two distances' }).click();
  await page.locator('[data-testid="chamfer-distance"]').fill('4');
  await page.locator('[data-testid="chamfer-distance2"]').fill('2');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(240_000 - 400, 3);

  const chamferId = (await state(page)).history.features[1]?.id;
  await page.dblclick(`[data-feature-id="${chamferId}"]`);
  await page.getByRole('radio', { name: 'Distance and angle' }).click();
  await page.locator('[data-testid="chamfer-angle"]').fill('30');
  await page.locator('[data-testid="chamfer-flip"]').check();
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(240_000 - 800 * Math.tan(Math.PI / 6), 3);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'chamfer', method: 'angle', distance: 4, angle: 30, flip: true });
});

test('imports a STEP file as a body, keeps it in the part and cuts into it', async () => {
  // A STEP file of the 100 × 60 × 40 box, exported by ParaWerk itself.
  launched = await launchApp();
  await createBox(launched.page);
  await launched.page.click('[data-command="export-step"]');
  await expect(launched.page.locator('[data-testid="toast-success"]').last()).toBeVisible();
  const name = await launched.page.evaluate(() => document.title.split(' – ')[0]?.replace(' •', ''));
  const step = path.join(launched.outputDir, `${name}.step`);
  await launched.app.close();

  launched = await launchApp({ env: { PARAWERK_E2E_OPEN_FILE: step } });
  const { page, outputDir } = launched;
  await page.click('[data-command="import-step"]');
  await expect(page.locator('[data-testid="import-file"]')).toContainText('.step');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(240_000, 3);
  expect((await state(page)).history.features.map((feature) => feature.type)).toEqual(['import']);

  // A bore through the imported body.
  await page.click('[data-command="cylinder"]');
  await page.getByRole('radio', { name: /Remove material/ }).click();
  await page.locator('[data-testid="cylinder-height"]').fill('60');
  await page.locator('[data-testid="position-z"]').fill('-10');
  await page.click('[data-testid="panel-ok"]');
  const cut = 240_000 - Math.PI * 400 * 40;
  expect(await volume(page)).toBeCloseTo(cut, 0);

  // The file goes into the part file: the part opens again without it.
  await page.click('[data-command="save"]');
  await expect.poll(async () => (await state(page)).dirty).toBe(false);
  const part = path.join(outputDir, `${(await state(page)).fileName}.pwpart`);
  await page.click('[data-command="new"]');
  await page.evaluate(async (bytes) => {
    (window as unknown as { __parawerk: { commands: { loadDocument(path: string, data: Uint8Array): void } } }).__parawerk.commands.loadDocument('reopened.pwpart', new Uint8Array(bytes));
  }, [...(await readFile(part))]);
  expect(await volume(page)).toBeCloseTo(cut, 0);
});

test('keeps a fillet on its edge when an earlier feature changes the topology', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  await createBox(page);
  // A hole through the box: more faces and edges, numbered differently than in the plain box.
  await page.click('[data-command="cylinder"]');
  await updateDraft(page, { operation: 'cut', radius: 8, height: 60, position: [0, 0, -10] });
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  await page.click('[data-command="fillet"]');
  await idle(page);
  await clickWorldPoint(page, [0, -30, 40]);
  await expect(page.locator('[data-testid="edge-count"]')).toContainText('1');
  await page.locator('[data-testid="fillet-radius"]').fill('5');
  await page.click('[data-testid="panel-ok"]');
  const loss = 25 * (1 - Math.PI / 4) * 100;
  expect(await volume(page)).toBeCloseTo(240_000 - 64 * Math.PI * 40 - loss, 1);

  // The fillet stores the faces of its edge, not an index.
  const [boxFeature, hole, fillet] = (await state(page)).history.features as unknown as { id: string; edges?: { kind: string; faces: string[] }[] }[];
  expect(fillet?.edges).toMatchObject([{ kind: 'edge', faces: [`${boxFeature?.id}:front`, `${boxFeature?.id}:top`] }]);

  // Suppressing the hole renumbers the edges; the fillet stays on the top front edge.
  await page.locator(`[data-feature-id="${hole?.id}"]`).hover();
  await page.locator(`[data-feature-id="${hole?.id}"] .tree-actions button`).nth(1).click();
  expect(await volume(page)).toBeCloseTo(240_000 - loss, 1);
  expect((await state(page)).rebuild?.results.map((result) => result.status)).toEqual(['ok', 'suppressed', 'ok']);
});

test('marks fillet edges that an earlier change removed and lets them be removed', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="cylinder"]');
  await updateDraft(page, { operation: 'cut', radius: 8, height: 60, position: [0, 0, -10] });
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // Round the top front edge and the upper rim of the hole.
  await page.click('[data-command="fillet"]');
  await idle(page);
  await clickWorldPoint(page, [0, -30, 40]);
  await clickWorldPoint(page, [0, -8, 40]);
  await expect(page.locator('[data-testid="edge-count"]')).toContainText('2');
  await page.locator('[data-testid="fillet-radius"]').fill('2');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // Without the hole its rim is gone: the fillet rounds the other edge and warns.
  const [, hole, fillet] = (await state(page)).history.features;
  await page.locator(`[data-feature-id="${hole?.id}"]`).hover();
  await page.locator(`[data-feature-id="${hole?.id}"] .tree-actions button`).nth(1).click();
  await idle(page);
  await expect(page.locator(`[data-feature-id="${fillet?.id}"] [data-testid="tree-warning"]`)).toBeVisible();
  expect(await volume(page)).toBeCloseTo(240_000 - 4 * (1 - Math.PI / 4) * 100, 1);

  // Editing it shows what is missing and where it was; Remove drops it and the warning goes away.
  await page.locator(`[data-feature-id="${fillet?.id}"]`).dblclick();
  await idle(page);
  await expect(page.locator('[data-testid="edges-missing"]')).toContainText('1 edge no longer exists');
  await expect.poll(() => lostMarkers(page)).toBe(1);
  await page.click('[data-testid="remove-missing-edges"]');
  await expect(page.locator('[data-testid="edge-count"]')).toContainText('1');
  await expect(page.locator('[data-testid="edges-missing"]')).toHaveCount(0);
  await expect.poll(() => lostMarkers(page)).toBe(0);
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  await expect(page.locator('[data-testid="tree-warning"]')).toHaveCount(0);
});

test('picks whole B-Rep faces and shows their exact geometry', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="cylinder"]');
  await page.locator('[data-testid="cylinder-radius"]').fill('15');
  await page.locator('[data-testid="cylinder-height"]').fill('30');
  await page.locator('[data-testid="position-z"]').fill('40');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // Hover twice over different faces: the BVH is built on the first pick and must not reorder triangles.
  await clickWorldPoint(page, [30, 0, 40]);
  await expect(page.locator('[data-testid="pick-info"]')).toContainText(/Plane · 5,293\.1 mm²/);
  await clickWorldPoint(page, [15 * Math.cos(-0.8), 15 * Math.sin(-0.8), 55]);
  await expect(page.locator('[data-testid="pick-info"]')).toContainText(/Cylinder Ø 30 mm · 2,827\.4 mm²/);
  await clickWorldPoint(page, [0, 0, 70]);
  await expect(page.locator('[data-testid="pick-info"]')).toContainText(/Plane · 706\.9 mm²/);
});

test('saves and reopens a part file', async () => {
  launched = await launchApp();
  const { page, outputDir } = launched;
  await createBox(page);
  await page.click('[data-command="cylinder"]');
  await page.getByRole('radio', { name: /Remove material|Material entfernen/ }).click();
  await page.click('[data-testid="panel-ok"]');
  const expected = await volume(page);
  expect((await state(page)).dirty).toBe(true);

  await page.click('[data-command="save"]');
  await expect.poll(async () => (await state(page)).dirty).toBe(false);
  const fileName = (await state(page)).fileName;
  expect(fileName).toBeTruthy();

  await page.click('[data-command="new"]');
  await expect.poll(async () => (await state(page)).history.features.length).toBe(0);

  const file = path.join(outputDir, `${fileName}.pwpart`);
  await page.evaluate(async (bytes) => {
    const hooks = (window as unknown as { __parawerk: { commands: { loadDocument(path: string, data: Uint8Array): void } } }).__parawerk;
    hooks.commands.loadDocument('reopened.pwpart', new Uint8Array(bytes));
  }, [...(await readFile(file))]);
  await expect.poll(async () => (await state(page)).history.features.length).toBe(2);
  expect(await volume(page)).toBeCloseTo(expected, 6);
});

test('undo, redo and suppress', async () => {
  launched = await launchApp();
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="cylinder"]');
  await page.click('[data-testid="panel-ok"]');
  const both = await volume(page);

  await page.click('[data-command="undo"]');
  expect(await volume(page)).toBeCloseTo(240_000, 3);
  await page.click('[data-command="redo"]');
  expect(await volume(page)).toBeCloseTo(both, 3);

  const cylinderId = (await state(page)).history.features[1]?.id;
  await page.locator(`[data-feature-id="${cylinderId}"]`).hover();
  await page.locator(`[data-feature-id="${cylinderId}"] .tree-actions button`).nth(1).click();
  expect(await volume(page)).toBeCloseTo(240_000, 3);
  await expect(page.locator(`[data-feature-id="${cylinderId}"]`)).toHaveClass(/is-suppressed/);
});

test('gives the part a material and a color and shows its mass properties', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page, outputDir } = launched;
  await createBox(page);
  await expect(page.locator('[data-testid="tree-material"]')).toContainText('not specified');

  // Steel: the 100 × 60 × 40 box weighs 1.884 kg.
  await page.click('[data-tab="evaluate"]');
  await page.click('[data-command="material"]');
  await page.click('[data-material="steel-s235"]');
  await page.click('[data-testid="material-ok"]');
  await expect(page.locator('[data-testid="status-mass"]')).toHaveText('Mass: 1.884 kg');
  await expect(page.locator('[data-testid="tree-material"]')).toContainText('Structural steel S235JR');
  await page.click('[data-command="mass-properties"]');
  await expect(page.locator('[data-testid="mass-value"]')).toHaveText('1.884 kg');
  await expect(page.locator('[data-testid="mass-center"]')).toHaveText('0 ; 0 ; 20 mm');
  // Principal moments m(b² + c²)/12 in kg·mm².
  await expect(page.locator('[data-testid="mass-principal"]')).toContainText('816.4');
  await expect(page.locator('[data-testid="mass-principal"]')).toContainText('1,821.2');
  await expect(page.locator('[data-testid="mass-principal"]')).toContainText('2,135.2');

  // A custom material with the density of water; the dialog is opened from the tree.
  await page.locator('[data-testid="tree-material"]').dblclick();
  await page.click('[data-material="custom"]');
  await page.locator('[data-testid="material-name"]').fill('Test resin');
  await page.locator('[data-testid="material-density"]').fill('1000');
  await page.click('[data-testid="material-ok"]');
  await expect(page.locator('[data-testid="mass-value"]')).toHaveText('240 g');
  await expect(page.locator('[data-testid="tree-material"]')).toContainText('Test resin');

  // An own color; Cancel keeps everything as it is.
  await page.click('[data-command="material"]');
  await page.getByRole('radio', { name: '#d64545' }).click();
  await page.click('[data-testid="material-ok"]');
  await page.click('[data-command="material"]');
  await page.getByRole('radio', { name: '#3f9d5a' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  const properties = () => page.evaluate(() => (window as unknown as { __parawerk: { getState(): { history: { properties?: object } } } }).__parawerk.getState().history.properties);
  expect(await properties()).toEqual({ material: { id: 'custom', density: 1000, name: 'Test resin' }, color: '#d64545' });

  // Saved with the part, and each change is one undo step.
  await page.click('[data-command="save"]');
  await expect.poll(async () => (await state(page)).dirty).toBe(false);
  const fileName = (await state(page)).fileName;
  const file = path.join(outputDir, `${fileName}.pwpart`);
  await page.click('[data-command="new"]');
  await page.evaluate(async (bytes) => {
    const hooks = (window as unknown as { __parawerk: { commands: { loadDocument(path: string, data: Uint8Array): void } } }).__parawerk;
    hooks.commands.loadDocument('reopened.pwpart', new Uint8Array(bytes));
  }, [...(await readFile(file))]);
  expect(await properties()).toEqual({ material: { id: 'custom', density: 1000, name: 'Test resin' }, color: '#d64545' });
  await page.locator('[data-testid="tree-material"]').hover();
  await page.evaluate(() => (window as unknown as { __parawerk: { commands: { setPartColor(color: string | null): void } } }).__parawerk.commands.setPartColor(null));
  expect((await state(page)).dirty).toBe(true);
  await page.click('[data-command="undo"]');
  expect(await properties()).toEqual({ material: { id: 'custom', density: 1000, name: 'Test resin' }, color: '#d64545' });
  expect((await state(page)).dirty).toBe(false);
});

test('measures faces against each other with the measure tool', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  // A step: a 100 × 60 × 40 block with a 40 mm wide riser of 20 mm on its left end.
  await page.evaluate(() => {
    const features = [
      { id: 'base', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] },
      { id: 'riser', type: 'box', operation: 'add', width: 40, depth: 60, height: 20, position: [-30, 0, 40] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features });
  });
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.click('[data-tab="evaluate"]');
  await page.click('[data-command="measure"]');
  await expect(page.locator('[data-testid="measure-panel"]')).toContainText('Click faces');

  await clickWorldPoint(page, [20, 0, 40]);
  await expect(page.locator('[data-testid="measure-entities"]')).toContainText('Plane');
  await expect(page.locator('[data-testid="measure-entities"]')).toContainText('3,600 mm²');
  await clickWorldPoint(page, [-30, 0, 60]);
  await expect(page.locator('[data-testid="measure-distance"]')).toHaveText('20 mm');
  await expect(page.locator('[data-testid="measure-normal-distance"]')).toHaveText('20 mm');
  await expect(page.locator('[data-testid="measure-angle"]')).toHaveText('0°');
  const lines = () => page.evaluate(() => (window as unknown as { __parawerk: { viewport: { measureLines(): number } } }).__parawerk.viewport.measureLines());
  expect(await lines()).toBe(1);
  await expect(page.locator('.measure-label')).toHaveText('20 mm');

  // A third pick starts a new measurement; closing the tool removes the line.
  await clickWorldPoint(page, [20, 0, 40]);
  await expect(page.locator('[data-testid="measure-results"]')).toHaveCount(0);
  await page.click('[data-command="measure"]');
  await expect(page.locator('[data-testid="measure-panel"]')).toHaveCount(0);
  expect(await lines()).toBe(0);
});

test('cuts the part open in a section view that picks only what is shown', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  await createBox(page);
  const sectionState = () => page.evaluate(() => (window as unknown as { __parawerk: { getState(): { section: unknown; selection: { kind: string }[] } } }).__parawerk.getState());
  const sectionShown = () => page.evaluate(() => (window as unknown as { __parawerk: { viewport: { section(): boolean } } }).__parawerk.viewport.section());

  // Along the front plane: the front half (y < 0) is cut away, so the front face can no longer be picked.
  await page.click('[data-testid="toggle-section"]');
  await expect(page.locator('[data-testid="section-panel"]')).toBeVisible();
  expect(await sectionShown()).toBe(true);
  expect((await sectionState()).section).toEqual({ plane: { kind: 'standard', plane: 'front' }, offset: 0, flip: false });
  await clickWorldPoint(page, [0, -30, 20]);
  expect((await sectionState()).selection).toEqual([]);
  await clickWorldPoint(page, [0, 15, 40]);
  expect((await sectionState()).selection).toMatchObject([{ kind: 'face' }]);

  // Along the selected top face: the cut starts in the middle of the part.
  await page.click('[data-testid="section-use-selection"]');
  expect((await sectionState()).section).toEqual({ plane: { kind: 'custom', point: [0, 0, 40], normal: [0, 0, 1] }, offset: -20, flip: false });
  await page.locator('[data-testid="section-offset"]').fill('-10');
  await page.locator('[data-testid="section-flip"]').check();
  expect((await sectionState()).section).toMatchObject({ offset: -10, flip: true });

  await page.click('[data-testid="toggle-section"]');
  await expect(page.locator('[data-testid="section-panel"]')).toHaveCount(0);
  expect(await sectionShown()).toBe(false);
  await clickWorldPoint(page, [0, -30, 20]);
  expect((await sectionState()).selection).toMatchObject([{ kind: 'face' }]);
});

test('offers unsaved work after a crash, but not after a clean close', async () => {
  launched = await launchApp();
  const { userData } = launched;
  let page = launched.page;
  await createBox(page);
  await page.click('[data-command="cylinder"]');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  const flush = (target: Page) => target.evaluate(() => (window as unknown as { __parawerk: { recovery: { flush(): Promise<void> } } }).__parawerk.recovery.flush());
  await flush(page);

  // The process is killed: the recovery copy stays and is offered at the next start.
  await crashApp(launched.app);
  launched = await relaunchAfterCrash({ userData });
  page = launched.page;
  await expect(page.locator('[data-testid="recovery-dialog"]')).toBeVisible();
  await expect(page.locator('.recovery-entry')).toHaveCount(1);
  await page.click('[data-testid="recovery-restore"]');
  await expect(page.locator('[data-testid="recovery-dialog"]')).toBeHidden();
  await expect.poll(async () => (await state(page)).history.features.map((feature) => feature.type)).toEqual(['box', 'cylinder']);
  expect((await state(page)).dirty).toBe(true);
  await expect(page.locator('[data-testid="toast-success"]').last()).toContainText('restored');

  // A clean close removes the copy of the restored document too: nothing is offered next time.
  await flush(page);
  const restoredProfile = launched.userData;
  await launched.app.close();
  launched = await launchApp({ userData: restoredProfile });
  await idle(launched.page);
  await launched.page.waitForTimeout(500);
  await expect(launched.page.locator('[data-testid="recovery-dialog"]')).toBeHidden();
  expect((await state(launched.page)).history.features).toEqual([]);
});

/** Drags a row of the feature tree (a feature or the rollback bar) just above or below another row. */
async function dragInTree(page: Page, from: string, to: string, where: 'above' | 'below'): Promise<void> {
  const source = await page.locator(from).boundingBox();
  const target = await page.locator(to).boundingBox();
  if (!source || !target) throw new Error('tree row not visible');
  const x = source.x + 30;
  await page.mouse.move(x, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, where === 'above' ? target.y + 3 : target.y + target.height - 3, { steps: 6 });
  await page.mouse.up();
  await idle(page);
}

test('rolls the part back with the rollback bar, inserts features there and reorders features', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="fillet"]');
  await idle(page);
  await clickWorldPoint(page, [0, -30, 40]);
  await page.locator('[data-testid="fillet-radius"]').fill('5');
  await page.click('[data-testid="panel-ok"]');
  await page.click('[data-command="cylinder"]');
  await page.click('[data-testid="panel-ok"]');
  const full = await volume(page);
  const [boxId, filletId, cylinderId] = (await state(page)).history.features.map((feature) => feature.id);

  // The bar dragged in front of the fillet: only the box is built.
  await dragInTree(page, '[data-testid="rollback-bar"]', `[data-feature-id="${filletId}"]`, 'above');
  expect(await volume(page)).toBeCloseTo(240_000, 3);
  await expect(page.locator(`[data-feature-id="${filletId}"]`)).toHaveClass(/is-rolled-back/);
  await expect(page.locator(`[data-feature-id="${cylinderId}"]`)).toHaveClass(/is-rolled-back/);
  await expect(page.locator(`[data-feature-id="${boxId}"]`)).not.toHaveClass(/is-rolled-back/);

  // A new feature goes in at the bar, which stays in front of the fillet.
  await page.click('[data-command="cylinder"]');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  expect((await state(page)).history.features.map((feature) => feature.type)).toEqual(['box', 'cylinder', 'fillet', 'cylinder']);
  await expect(page.locator(`[data-feature-id="${filletId}"]`)).toHaveClass(/is-rolled-back/);
  await page.click('[data-command="undo"]');

  // The arrow keys move the bar; End rolls the part forward to the end.
  await page.locator('[data-testid="rollback-bar"]').focus();
  await page.keyboard.press('ArrowDown');
  await idle(page);
  await expect(page.locator(`[data-feature-id="${filletId}"]`)).not.toHaveClass(/is-rolled-back/);
  await page.keyboard.press('End');
  expect(await volume(page)).toBeCloseTo(full, 3);
  await expect(page.locator('[data-testid="roll-to-end"]')).toHaveCount(0);

  // The fillet cannot move above the box its edge belongs to; the cylinder can move above the fillet.
  await dragInTree(page, `[data-feature-id="${filletId}"]`, `[data-feature-id="${boxId}"]`, 'above');
  await expect(page.locator('[data-testid="toast-info"]').last()).toContainText('builds on');
  expect((await state(page)).history.features.map((feature) => feature.id)).toEqual([boxId, filletId, cylinderId]);
  await dragInTree(page, `[data-feature-id="${cylinderId}"]`, `[data-feature-id="${filletId}"]`, 'above');
  expect((await state(page)).history.features.map((feature) => feature.id)).toEqual([boxId, cylinderId, filletId]);
  expect(await volume(page)).toBeCloseTo(full, 3);
  expect((await state(page)).rebuild?.results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok']);
  // Reordering is one undo step.
  await page.click('[data-command="undo"]');
  expect((await state(page)).history.features.map((feature) => feature.id)).toEqual([boxId, filletId, cylinderId]);
});

test('shows a feature error instead of failing', async () => {
  launched = await launchApp();
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="fillet"]');
  await idle(page);
  await clickWorldPoint(page, [0, -30, 40]);
  await page.locator('[data-testid="fillet-radius"]').fill('80');
  await idle(page);
  await expect(page.locator('.panel-error')).toBeVisible();
  await page.click('[data-testid="panel-cancel"]');
  await expect(page.locator('.feature-tree')).toBeVisible();
  expect((await state(page)).history.features).toHaveLength(1);
});

test('switches the language at runtime and remembers it', async () => {
  launched = await launchApp();
  const { page, userData } = launched;
  await page.click('[data-command="settings"]');
  await page.locator('[data-testid="settings-dialog"] [name="language"][data-value="de"]').click();
  await expect(page.locator('[data-command="box"] .command-label')).toHaveText('Quader');
  await page.locator('[data-testid="settings-dialog"] [name="language"][data-value="en"]').click();
  await expect(page.locator('[data-command="box"] .command-label')).toHaveText('Box');
  await page.locator('[data-testid="settings-dialog"] [name="language"][data-value="de"]').click();
  await launched.app.close();

  launched = await launchApp({ userData });
  await expect(launched.page.locator('[data-command="box"] .command-label')).toHaveText('Quader');
  expect((await state(launched.page)).language).toBe('de');
});

test('variables drive feature parameters: a box follows the variable it is sized by', async () => {
  launched = await launchApp();
  const { page } = launched;
  const features = async () => (await state(page)).history.features as unknown as { type: string; width?: number; variables?: { name: string; expression: string }[]; expressions?: Record<string, string> }[];

  // A variable d1 = 40.
  await page.click('[data-command="variables"]');
  await page.click('[data-testid="variable-add"]');
  await page.locator('[data-testid="variable-expression"]').fill('40');
  await expect(page.locator('[data-testid="variable-value"]')).toHaveText('40');
  // Invalid names block applying.
  await page.locator('[data-testid="variable-name"]').fill('2x');
  await expect(page.locator('[data-testid="panel-ok"]')).toBeDisabled();
  await page.locator('[data-testid="variable-name"]').fill('d1');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await features())[0]?.variables).toEqual([{ name: 'd1', expression: '40' }]);

  // A box twice as wide.
  await page.click('[data-command="box"]');
  await page.locator('[data-testid="box-width"]').fill('d1*2');
  await page.locator('[data-testid="box-depth"]').click();
  await expect(page.locator('[data-testid="box-width-value"]')).toHaveText('= 80 mm');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  await expect.poll(async () => (await features()).find((f) => f.type === 'box')).toMatchObject({ width: 80, expressions: { width: 'd1*2' } });

  // Changing d1 resizes the box in one undo step; the part stays visible while the variables are edited.
  await page.click('[data-command="variables"]');
  await idle(page);
  expect(await page.evaluate(() => (window as unknown as { __parawerk: { getState(): { display: { body: unknown } } } }).__parawerk.getState().display.body !== null)).toBe(true);
  await page.locator('[data-testid="variable-expression"]').fill('50');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await features()).find((f) => f.type === 'box')?.width).toBe(100);
  await idle(page);
  expect(await volume(page)).toBeCloseTo(100 * 60 * 40, 0);
  await page.click('[data-command="undo"]');
  await expect.poll(async () => (await features()).find((f) => f.type === 'box')?.width).toBe(80);
});

test('extrudes a sketch into a plate and cuts a pocket from a sketch on its top face', async () => {
  launched = await launchApp();
  const { page } = launched;
  const features = async () => (await state(page)).history.features as unknown as { id: string; type: string; sketch?: unknown; operation?: string; direction?: string; depth?: number; end?: string }[];

  // Without a sketch there is nothing to extrude.
  await page.click('[data-command="extrude"]');
  await expect(page.locator('[data-testid="toast-info"]')).toContainText('sketch');
  await expect(page.locator('[data-testid="extrude-depth"]')).toHaveCount(0);

  // A 60 × 40 rectangle with a hole on the top plane, and a circle on the plate's top face (z = 15).
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const plate = {
      id: 'plate', type: 'sketch', plane: { kind: 'standard', plane: 'top' },
      sketch: {
        entities: [P('a', -30, -20), P('b', 30, -20), P('c', 30, 20), P('d', -30, 20), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a'), P('m', -15, 0), { id: 'hole', type: 'circle', center: 'm', radius: 6 }],
        constraints: [],
      },
    };
    const history = { features: [plate], past: [], future: [] };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history, savedFeatures: history.features, dirty: false });
  });
  await idle(page);

  // Extrude (Features tab): the sketch is chosen, the depth typed in.
  await page.click('[data-command="extrude"]');
  await expect(page.locator('[data-testid="feature-sketch"]')).toHaveValue('plate');
  await page.locator('[data-testid="extrude-depth"]').fill('15');
  await page.locator('[data-testid="extrude-depth"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await features()).map((f) => f.type)).toEqual(['sketch', 'extrude']);
  expect(await volume(page)).toBeCloseTo((2400 - 36 * Math.PI) * 15, 2);
  await expect(page.locator('.tree-item[data-feature-id]').nth(1)).toContainText('Extrude1');

  // A sketch on the top face; the next extrusion takes it and cuts a pocket 10 mm deep into the plate.
  await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { setState(s: unknown): void; getState(): { history: { features: unknown[] } } } }).__parawerk;
    const pocket = {
      id: 'pocket', type: 'sketch',
      plane: { kind: 'face', face: 0, frame: { origin: [0, 0, 15], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } },
      sketch: { entities: [{ id: 'c', type: 'point', x: 15, y: 0 }, { id: 'round', type: 'circle', center: 'c', radius: 8 }], constraints: [] },
    };
    const features = [...hooks.getState().history.features, pocket];
    hooks.setState({ history: { features, past: [], future: [] } });
  });
  await idle(page);
  await page.click('[data-command="extrude"]');
  await expect(page.locator('[data-testid="feature-sketch"]')).toHaveValue('pocket');
  await page.getByRole('radio', { name: 'Remove material' }).click();
  await page.getByRole('radio', { name: 'Reversed' }).click();
  await page.locator('[data-testid="extrude-depth"]').fill('10');
  await page.locator('[data-testid="extrude-depth"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await features()).at(-1)).toMatchObject({ type: 'extrude', sketch: 'pocket', operation: 'cut', direction: 'reverse', depth: 10 });
  expect(await volume(page)).toBeCloseTo((2400 - 36 * Math.PI) * 15 - 64 * Math.PI * 10, 2);
  // The sketch was placed without a face name (like in older files): the rebuild found its face and named it.
  const pocketPlane = async () => ((await features()).find((f) => f.id === 'pocket') as unknown as { plane: { name?: string; frame: { origin: number[] } } }).plane;
  await expect.poll(async () => (await pocketPlane()).name).toMatch(/:end$/);

  // A thicker plate moves its top face up; the sketch on it follows, and the pocket is cut from the new top.
  await page.locator('.tree-item[data-feature-id]').nth(1).dblclick();
  await page.locator('[data-testid="extrude-depth"]').fill('25');
  await page.locator('[data-testid="extrude-depth"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await pocketPlane()).frame.origin[2]).toBeCloseTo(25, 6);
  expect(await volume(page)).toBeCloseTo((2400 - 36 * Math.PI) * 25 - 64 * Math.PI * 10, 2);
  expect((await state(page)).rebuild?.results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  await page.click('[data-command="undo"]');
  await expect.poll(async () => (await pocketPlane()).frame.origin[2]).toBeCloseTo(15, 6);

  // Undo takes the pocket back; through all turns the same circle into a hole through the plate.
  await page.click('[data-command="undo"]');
  expect(await volume(page)).toBeCloseTo((2400 - 36 * Math.PI) * 15, 2);
  await page.click('[data-command="extrude"]');
  await expect(page.locator('[data-testid="feature-sketch"]')).toHaveValue('pocket');
  await page.getByRole('radio', { name: 'Remove material' }).click();
  await page.getByRole('radio', { name: 'Reversed' }).click();
  await page.selectOption('[data-testid="extrude-end"]', 'throughAll');
  await expect(page.locator('[data-testid="extrude-depth"]')).toHaveCount(0);
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await features()).at(-1)).toMatchObject({ type: 'extrude', sketch: 'pocket', end: 'throughAll' });
  expect(await volume(page)).toBeCloseTo((2400 - 36 * Math.PI - 64 * Math.PI) * 15, 2);
});

test('revolves a half section around its centerline into a shaft and edits the angle', async () => {
  launched = await launchApp();
  const { page } = launched;
  const features = async () => (await state(page)).history.features as unknown as { id: string; type: string; axis?: string; angle?: number }[];

  // A stepped half section on the front plane (radius 10 over 40 mm, radius 16 over 10 mm) and a centerline.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string, construction = false) => ({ id, type: 'line', p1, p2, ...(construction ? { construction } : {}) });
    const section = {
      id: 'section', type: 'sketch', plane: { kind: 'standard', plane: 'front' },
      sketch: {
        entities: [
          P('a', 0, 0), P('b', 16, 0), P('c', 16, 10), P('d', 10, 10), P('e', 10, 50), P('f', 0, 50), P('g', 0, -10), P('h', 0, 60),
          L('l1', 'a', 'b'), L('l2', 'b', 'c'), L('l3', 'c', 'd'), L('l4', 'd', 'e'), L('l5', 'e', 'f'), L('l6', 'f', 'a'), L('axis', 'g', 'h', true),
        ],
        constraints: [],
      },
    };
    const history = { features: [section], past: [], future: [] };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history, savedFeatures: history.features, dirty: false });
  });
  await idle(page);

  // Revolve: the sketch and its centerline are chosen, the full turn is the default.
  await page.click('[data-command="revolve"]');
  await expect(page.locator('[data-testid="feature-sketch"]')).toHaveValue('section');
  await expect(page.locator('[data-testid="revolve-axis"]')).toHaveValue('axis');
  await expect(page.locator('[data-testid="revolve-axis"] option:checked')).toHaveText('Centerline 1');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await features()).map((f) => f.type)).toEqual(['sketch', 'revolve']);
  const full = Math.PI * 16 * 16 * 10 + Math.PI * 10 * 10 * 40;
  expect(await volume(page)).toBeCloseTo(full, 2);

  // Half a turn after editing the feature.
  await page.locator('.tree-item[data-feature-id]').nth(1).dblclick();
  await page.locator('[data-testid="revolve-angle"]').fill('180');
  await page.locator('[data-testid="revolve-angle"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await features()).at(-1)?.angle).toBe(180);
  expect(await volume(page)).toBeCloseTo(full / 2, 2);
});

test('builds reference planes, axes and points that follow the part, and sketches on a reference plane', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  type Feature = { id: string; type: string; method?: string; references?: { kind: string; name?: string }[] };
  type Result = { id: string; status: string; reference?: { kind: string; frame?: { origin: number[] }; point?: number[]; direction?: number[] } };
  const hooks = async () =>
    page.evaluate(() => {
      const s = (window as unknown as { __parawerk: { getState(): { history: { features: unknown[] }; rebuild: { results: unknown[] } | null } } }).__parawerk.getState();
      return { features: s.history.features as Feature[], results: (s.rebuild?.results ?? []) as Result[] };
    });
  const geometry = async (index: number) => (await hooks()).results[index]?.reference;
  const pick = (kind: string, index: number) =>
    page.evaluate(([k, i]) => (window as unknown as { __parawerk: { commands: { handlePick(p: object, additive: boolean): void } } }).__parawerk.commands.handlePick({ kind: k, index: i }, false), [kind, index] as const);
  await createBox(page);

  // Select the top face, then Plane: an offset plane from that face.
  await clickWorldPoint(page, [10, 10, 40]);
  await page.click('[data-command="plane"]');
  await expect(page.locator('[data-testid="reference-method"]')).toHaveValue('offset');
  await expect(page.locator('[data-testid="reference-slot-0"]')).toContainText('Face');
  await page.locator('[data-testid="plane-distance"]').fill('25');
  await page.locator('[data-testid="plane-distance"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await geometry(1))?.frame?.origin[2]).toBeCloseTo(65, 6);
  expect((await hooks()).features[1]).toMatchObject({ type: 'plane', method: 'offset', references: [{ kind: 'face', name: expect.stringMatching(/:top$/) }] });

  // An axis where the front and right plane meet: the Z axis.
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="axis"]');
  await page.selectOption('[data-testid="reference-method"]', 'twoPlanes');
  await pick('plane', 0);
  await pick('plane', 2);
  await expect(page.locator('[data-testid="reference-slot-1"]')).toContainText('Right plane');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await geometry(2))?.direction?.map((v) => Math.round(v) + 0)).toEqual([0, 0, 1]);

  // A point where the axis meets the plane; an axis does not fit a plane field.
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="point"]');
  await page.selectOption('[data-testid="reference-method"]', 'intersection');
  await pick('reference', 1);
  await expect(page.locator('[data-testid="toast-info"]')).toContainText('axis');
  await pick('reference', 2);
  await pick('reference', 1);
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await geometry(3))?.point?.map((v) => Math.round(v) + 0)).toEqual([0, 0, 65]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __parawerk: { viewport: { references(): number } } }).__parawerk.viewport.references())).toBe(3);

  // A taller box moves the face, and with it the plane and the point.
  await page.locator('.tree-item[data-feature-id]').first().dblclick();
  await page.locator('[data-testid="box-height"]').fill('60');
  await page.locator('[data-testid="box-height"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  await expect.poll(async () => (await geometry(1))?.frame?.origin[2]).toBeCloseTo(85, 6);
  await expect.poll(async () => (await geometry(3))?.point?.[2]).toBeCloseTo(85, 6);

  // Sketch on the plane from the tree.
  const plane = page.locator('.tree-item[data-feature-id]').nth(1);
  await plane.hover();
  await plane.locator('[data-testid="sketch-on-plane"]').click();
  await expect(page.locator('.sketch-panel')).toContainText('Plane1');
  await page.click('[data-testid="sketch-cancel"]');
  await idle(page);
  expect((await hooks()).features).toHaveLength(4);
});

test('picks vertices in the 3D view for a plane through three points', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="plane"]');
  await page.selectOption('[data-testid="reference-method"]', 'threePoints');
  for (const corner of [[-50, -30, 40], [50, -30, 40], [50, 30, 0]] as const) await clickWorldPoint(page, [...corner]);
  const features = (await state(page)).history.features;
  expect(features).toHaveLength(1);
  await expect(page.locator('[data-testid="reference-slot-2"]')).toContainText('Vertex');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  const plane = (await state(page)).history.features[1] as unknown as { references: { kind: string; at: number[] }[] };
  expect(plane.references.map((ref) => ref.kind)).toEqual(['vertex', 'vertex', 'vertex']);
  expect(plane.references.map((ref) => ref.at.map((v) => Math.round(v) + 0))).toEqual([[-50, -30, 40], [50, -30, 40], [50, 30, 0]]);
  expect((await state(page)).rebuild?.results.map((result) => result.status)).toEqual(['ok', 'ok']);
});

test('revolves a sketch around a reference axis', async () => {
  launched = await launchApp();
  const { page } = launched;
  // A reference axis where the front and right plane meet (the Z axis), and a square beside it on the front plane.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const features = [
      { id: 'z', type: 'axis', method: 'twoPlanes', references: [{ kind: 'standard-plane', plane: 'front' }, { kind: 'standard-plane', plane: 'right' }] },
      {
        id: 'section', type: 'sketch', plane: { kind: 'standard', plane: 'front' },
        sketch: { entities: [P('a', 10, 0), P('b', 20, 0), P('c', 20, 10), P('d', 10, 10), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a')], constraints: [] },
      },
    ];
    const history = { features, past: [], future: [] };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history, savedFeatures: features, dirty: false });
  });
  await idle(page);
  // The sketch has no centerline, so the reference axis is the axis.
  await page.click('[data-command="revolve"]');
  await expect(page.locator('[data-testid="revolve-axis"] option:checked')).toHaveText('Axis1');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(100 * 2 * Math.PI * 15, 2);
  expect((await state(page)).history.features[2]).toMatchObject({ type: 'revolve', axis: '', axisRef: { kind: 'feature', feature: 'z' } });
});

test('drills holes for metric screws at the points of a sketch', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  // A 100 × 60 × 40 box and a sketch with two points on its top face.
  await page.evaluate(() => {
    const features = [
      { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] },
      {
        id: 'positions', type: 'sketch',
        plane: { kind: 'face', face: 5, name: 'box:top', frame: { origin: [0, 0, 40], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } },
        sketch: { entities: [{ id: 'a', type: 'point', x: -30, y: 0 }, { id: 'b', type: 'point', x: 30, y: 0 }], constraints: [] },
      },
    ];
    const history = { features, past: [], future: [] };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history, savedFeatures: features, dirty: false });
  });
  await idle(page);
  const threads = () => page.evaluate(() => (window as unknown as { __parawerk: { viewport: { threads(): number } } }).__parawerk.viewport.threads());

  // Hole takes the sketch with points; M6 clearance holes, medium series, through all.
  await page.click('[data-command="hole"]');
  await expect(page.locator('[data-testid="hole-sketch"]')).toHaveValue('positions');
  await expect(page.locator('[data-testid="hole-count"]')).toContainText('2 holes');
  await expect(page.locator('[data-testid="hole-diameter"]')).toHaveValue('6.6');
  await idle(page);

  // A tapped M8 hole: the tap drill comes from the table, and the threads are shown.
  await page.selectOption('[data-testid="hole-kind"]', 'tapped');
  await page.selectOption('[data-testid="hole-size"]', 'M8');
  await expect(page.locator('[data-testid="hole-diameter"]')).toHaveValue('6.8');
  await idle(page);
  await expect.poll(threads).toBe(2);
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(240_000 - 2 * Math.PI * 3.4 * 3.4 * 40, 2);
  expect((await state(page)).history.features[2]).toMatchObject({ type: 'hole', kind: 'tapped', size: 'M8', diameter: 6.8, sketch: 'positions' });
  await expect.poll(threads).toBe(2);
});

test('patterns a boss along a plane normal and around an axis, and mirrors it', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  // A 200 × 100 × 10 plate and a Ø 10 boss on it, left of the middle.
  await page.evaluate(() => {
    const features = [
      { id: 'plate', type: 'box', operation: 'add', width: 200, depth: 100, height: 10, position: [0, 0, 0] },
      { id: 'boss', type: 'cylinder', operation: 'add', radius: 5, height: 10, axis: 'z', position: [-60, 0, 10] },
    ];
    const history = { features, past: [], future: [] };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history, savedFeatures: features, dirty: false });
  });
  await idle(page);
  const PLATE = 200_000;
  const BOSS = Math.PI * 25 * 10;

  // Pattern: the boss is picked by clicking its top face, the direction is the right plane (from the tree).
  await page.click('[data-command="pattern"]');
  await expect(page.locator('[data-testid="copy-features"]')).toHaveClass(/is-active/);
  await clickWorldPoint(page, [-60, 0, 20]);
  await expect(page.locator('[data-testid="copy-features"]')).toContainText('Cylinder1');
  await page.click('[data-testid="reference-slot-0"] .reference-slot-button');
  await page.click('.tree-item[data-plane="right"]');
  await expect(page.locator('[data-testid="reference-slot-0"]')).toContainText('Right plane');
  await page.locator('[data-testid="pattern-count"]').fill('4');
  await page.locator('[data-testid="pattern-count"]').press('Tab');
  await page.locator('[data-testid="pattern-spacing"]').fill('30');
  await page.locator('[data-testid="pattern-spacing"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(PLATE + 4 * BOSS, 2);
  expect((await state(page)).history.features[2]).toMatchObject({ type: 'pattern', method: 'linear', features: ['boss'], count: 4, spacing: 30 });

  // Undo, then a mirror through the right plane picked first in the tree.
  await page.click('[data-command="undo"]');
  await page.click('[data-variants="copy"]');
  await page.click('[data-entry="mirror"]');
  await page.click('.feature-tree .tree-item[data-feature-id="boss"]');
  await page.click('[data-testid="reference-slot-0"] .reference-slot-button');
  await page.click('.tree-item[data-plane="right"]');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(PLATE + 2 * BOSS, 2);
  expect((await state(page)).history.features.map((f) => f.type)).toEqual(['box', 'cylinder', 'mirror']);
});

test('copies a pattern with a second pattern into a grid', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A plate, a boss and a row of three bosses along x.
  await page.evaluate(() => {
    const features = [
      { id: 'plate', type: 'box', operation: 'add', width: 200, depth: 100, height: 10, position: [0, 0, 0] },
      { id: 'boss', type: 'cylinder', operation: 'add', radius: 5, height: 10, axis: 'z', position: [-60, 0, 10] },
      { id: 'row', type: 'pattern', method: 'linear', references: [{ kind: 'standard-plane', plane: 'right' }], features: ['boss'], count: 3, spacing: 30, angle: 360, flip: false },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  // The row is picked by clicking the top of one of its copies; the copies go along the front plane's normal.
  await page.click('[data-command="pattern"]');
  await clickWorldPoint(page, [0, 0, 20]);
  await expect(page.locator('[data-testid="copy-features"]')).toContainText('Pattern1');
  await page.click('[data-testid="reference-slot-0"] .reference-slot-button');
  await page.click('.tree-item[data-plane="front"]');
  await page.locator('[data-testid="pattern-count"]').fill('2');
  await page.locator('[data-testid="pattern-count"]').press('Tab');
  await page.locator('[data-testid="pattern-spacing"]').fill('30');
  await page.locator('[data-testid="pattern-spacing"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(200_000 + 6 * Math.PI * 25 * 10, 2);
  expect((await state(page)).history.features[3]).toMatchObject({ type: 'pattern', features: ['row'], count: 2 });
});

test('hollows a box out to a shell open at a picked face', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="shell"]');
  await expect(page.locator('[data-testid="shell-faces"]')).toContainText('Closed');
  await idle(page);
  // The top face is opened by clicking it; the walls get 3 mm thick.
  await clickWorldPoint(page, [10, 10, 40]);
  await expect(page.locator('[data-testid="shell-faces"]')).toContainText('1 face open');
  await page.locator('[data-testid="shell-thickness"]').fill('3');
  await page.locator('[data-testid="shell-thickness"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(240_000 - 94 * 54 * 37, 2);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'shell', thickness: 3, faces: [{ kind: 'face', name: expect.stringMatching(/:top$/) }] });
});

test('extrudes up to a reference plane picked in the tree, with an offset', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  // A plane 30 mm above the top plane and a 10 × 10 square on the top plane.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const features = [
      { id: 'plane', type: 'plane', method: 'offset', references: [{ kind: 'standard-plane', plane: 'top' }], distance: 30, angle: 45, flip: false },
      {
        id: 'square', type: 'sketch', plane: { kind: 'standard', plane: 'top' },
        sketch: { entities: [P('a', 0, 0), P('b', 10, 0), P('c', 10, 10), P('d', 0, 10), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a')], constraints: [] },
      },
    ];
    const history = { features, past: [], future: [] };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-command="extrude"]');
  await page.selectOption('[data-testid="extrude-end"]', 'upToSurface');
  await page.click('.feature-tree .tree-item[data-feature-id="plane"]');
  await expect(page.locator('[data-testid="extrude-end-ref"]')).toContainText('Plane1');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(3000, 3);

  // 5 mm short of the plane.
  await page.locator('.feature-tree .tree-item[data-feature-id]').nth(2).dblclick();
  await page.locator('[data-testid="extrude-end-offset"]').fill('5');
  await page.locator('[data-testid="extrude-end-offset"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(2500, 3);
  expect((await state(page)).history.features[2]).toMatchObject({ type: 'extrude', end: 'upToSurface', endRef: { kind: 'feature', feature: 'plane' }, endOffset: 5 });
});

test('extrudes up to the next face and up to a curved face picked in the 3D view', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A shaft of radius 20 along y, its axis 60 above the top plane, and a 10 × 10 square on the top plane.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const features = [
      { id: 'shaft', type: 'cylinder', operation: 'add', radius: 20, height: 60, axis: 'y', position: [0, -30, 60] },
      {
        id: 'square', type: 'sketch', plane: { kind: 'standard', plane: 'top' },
        sketch: { entities: [P('a', 0, 0), P('b', 10, 0), P('c', 10, 10), P('d', 0, 10), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a')], constraints: [] },
      },
    ];
    const history = { features, past: [], future: [] };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history, savedFeatures: features, dirty: false });
  });
  await idle(page);
  const cylinder = Math.PI * 400 * 60;
  // The volume under the shaft (a circle of radius r around z = 60) over the square.
  const column = (r: number) => 10 * (600 - (5 * Math.sqrt(r * r - 100) + ((r * r) / 2) * Math.asin(10 / r)));

  await page.click('[data-command="extrude"]');
  await page.selectOption('[data-testid="extrude-end"]', 'upToNext');
  await expect(page.locator('.panel-hint').first()).toContainText('until the outline meets the body');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(cylinder + column(20), 1);

  // Up to the shaft's curved face, 5 mm short of it.
  await page.locator('.feature-tree .tree-item[data-feature-id]').nth(2).dblclick();
  await page.selectOption('[data-testid="extrude-end"]', 'upToSurface');
  await idle(page);
  await clickWorldPoint(page, [0, -20, 80]);
  await expect(page.locator('[data-testid="extrude-end-ref"]')).not.toContainText('Select in the 3D view');
  await page.locator('[data-testid="extrude-end-offset"]').fill('5');
  await page.locator('[data-testid="extrude-end-offset"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(cylinder + column(25), 1);
  expect((await state(page)).history.features[2]).toMatchObject({ type: 'extrude', end: 'upToSurface', endRef: { kind: 'face', name: 'shaft:side' }, endOffset: 5 });
});

test('extrudes open curves as a thin feature and switches the side of the walls', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // An L of two lines (40 along x, then 30 up) on the top plane: no closed outline.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const features = [{ id: 'ell', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [P('a', 0, 0), P('b', 40, 0), P('c', 40, 30), L('ab', 'a', 'b'), L('bc', 'b', 'c')], constraints: [] } }];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  // Extrude starts as a thin feature, since the sketch has no closed outline.
  await page.click('[data-command="extrude"]');
  await expect(page.locator('[data-testid="thin-on"]')).toBeChecked();
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo((42 * 2 + 30 * 2) * 20, 3);
  // 4 mm walls inside the corner.
  await page.locator('.feature-tree .tree-item[data-feature-id]').nth(1).dblclick();
  await page.locator('[data-testid="thin-thickness"]').fill('4');
  await page.locator('[data-testid="thin-thickness"]').press('Tab');
  await page.getByRole('radio', { name: 'Other side' }).click();
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo((40 * 4 + 26 * 4) * 20, 3);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'extrude', thin: 'other', thickness: 4 });
  // Turned off, the open curves have no outline to extrude.
  await page.locator('.feature-tree .tree-item[data-feature-id]').nth(1).dblclick();
  await page.locator('[data-testid="thin-on"]').uncheck();
  await idle(page);
  expect((await state(page)).rebuild?.results[1]?.error?.code).toBe('profile-empty');
});

test('creates a coordinate system, gives mass properties in it and exports in it', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page, outputDir } = launched;
  await createBox(page);
  // On the top face of the 100 × 60 × 40 box, turned by 90°.
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="csys"]');
  await page.locator('[data-testid="csys-z"]').fill('40');
  await page.locator('[data-testid="csys-z"]').press('Tab');
  await page.locator('[data-testid="csys-angle"]').fill('90');
  await page.locator('[data-testid="csys-angle"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'csys', method: 'position', z: 40, angle: 90 });

  // The center of mass (0, 0, 20) lies 20 below its origin.
  await page.click('[data-tab="evaluate"]');
  await page.click('[data-command="mass-properties"]');
  await expect(page.locator('[data-testid="mass-center"]')).toContainText('0 ; 0 ; 20 mm');
  await page.selectOption('[data-testid="mass-frame"]', { index: 1 });
  await expect(page.locator('[data-testid="mass-center"]')).toContainText('0 ; 0 ; -20 mm');
  await page.click('[data-testid="mass-properties"] .mass-panel-header .icon-button');

  // Exports ask for the coordinate system; in it, the box lies below its origin.
  await page.click('[data-variants="export"]');
  await page.click('[data-entry="export-stl"]');
  await expect(page.locator('[data-testid="export-frame-dialog"]')).toBeVisible();
  await page.selectOption('[data-testid="export-frame"]', { index: 1 });
  await page.click('[data-testid="export-frame-ok"]');
  await expect(page.locator('[data-testid="toast-success"]').last()).toContainText('.stl');
  const stl = await readFile(path.join(outputDir, `${await page.evaluate(() => document.title.split(' – ')[0]?.replace(' •', ''))}.stl`));
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  let top = -Infinity;
  for (let t = 0; t < view.getUint32(80, true); t++) for (let v = 0; v < 3; v++) top = Math.max(top, view.getFloat32(84 + 50 * t + 12 + 12 * v + 8, true));
  expect(top).toBeCloseTo(0, 4);
});

test('rounds all edges of a face picked in the 3D view', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="fillet"]');
  await idle(page);
  // The middle of the top face, away from its edges.
  await clickWorldPoint(page, [10, 10, 40]);
  await expect(page.locator('[data-testid="face-count"]')).toContainText('1 face');
  await page.locator('[data-testid="fillet-radius"]').fill('5');
  await page.click('[data-testid="panel-ok"]');
  // Four rounded top edges (100, 60, 100, 60 mm) remove r²(1 − π/4) per mm, less where they meet at the corners.
  const volume = await (async () => {
    await idle(page);
    return (await state(page)).rebuild?.properties?.volume ?? NaN;
  })();
  expect(volume).toBeLessThan(240_000 - 25 * (1 - Math.PI / 4) * 300);
  expect(volume).toBeGreaterThan(240_000 - 25 * (1 - Math.PI / 4) * 320);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'fillet', edges: [], faces: [{ kind: 'face', name: expect.stringMatching(/:top$/) }] });
  // Clicking the face again takes it out.
  await page.locator('.feature-tree .tree-item[data-feature-id]').nth(1).dblclick();
  await idle(page);
  await clickWorldPoint(page, [10, 10, 40]);
  await expect(page.locator('[data-testid="face-count"]')).toHaveCount(0);
});

test('sweeps an outline along a path and lofts two outlines', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A circle of radius 2 on the front plane, a path of 50 mm on the top plane, and two squares for a loft.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const square = (p: string, half: number) => [
      P(`${p}1`, -half, -half), P(`${p}2`, half, -half), P(`${p}3`, half, half), P(`${p}4`, -half, half),
      L(`${p}a`, `${p}1`, `${p}2`), L(`${p}b`, `${p}2`, `${p}3`), L(`${p}c`, `${p}3`, `${p}4`), L(`${p}d`, `${p}4`, `${p}1`),
    ];
    const sketch = (id: string, plane: unknown, entities: unknown[]) => ({ id, type: 'sketch', plane, sketch: { entities, constraints: [] } });
    const features = [
      sketch('profile', { kind: 'standard', plane: 'front' }, [P('m', 0, 0), { id: 'k', type: 'circle', center: 'm', radius: 2 }]),
      sketch('path', { kind: 'standard', plane: 'top' }, [P('a', 0, 0), P('b', 0, 50), L('ab', 'a', 'b')]),
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
    (window as unknown as { __loftSketches: unknown[] }).__loftSketches = [
      { id: 'plane', type: 'plane', method: 'offset', references: [{ kind: 'standard-plane', plane: 'top' }], distance: 30, angle: 45, flip: false },
      sketch('low', { kind: 'standard', plane: 'top' }, square('a', 10)),
      sketch('high', { kind: 'feature', feature: 'plane', frame: { origin: [0, 0, 30], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } }, square('b', 5)),
      sketch('axis', { kind: 'standard', plane: 'front' }, [P('c1', 0, 0), P('c2', 0, 30), L('c', 'c1', 'c2')]),
    ];
  });
  await idle(page);
  await page.click('[data-variants="solid"]');
  await page.click('[data-entry="sweep"]');
  await expect(page.locator('[data-testid="sweep-profile"]')).toHaveValue('profile');
  await expect(page.locator('[data-testid="sweep-path"]')).toHaveValue('path');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(Math.PI * 4 * 50, 2);

  // A new part with the loft sketches: a frustum from a 20 × 20 square to a 10 × 10 one 30 above.
  await page.evaluate(() => {
    const features = (window as unknown as { __loftSketches: unknown[] }).__loftSketches;
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-variants="solid"]');
  await page.click('[data-entry="loft"]');
  await expect(page.locator('[data-testid="loft-sketches"] li')).toHaveCount(2);
  await page.locator('[data-testid="loft-ruled"]').check();
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(10 * (400 + 100 + 200), 2);
  expect((await state(page)).history.features[4]).toMatchObject({ type: 'loft', sketches: ['low', 'high'], ruled: true });
  // Along a straight centerline: the same frustum, without the flat-faces option.
  await page.locator('.feature-tree .tree-item[data-feature-id]').nth(4).dblclick();
  await page.selectOption('[data-testid="loft-centerline"]', 'axis');
  await expect(page.locator('[data-testid="loft-ruled"]')).toHaveCount(0);
  await page.click('[data-testid="panel-ok"]');
  expect(Math.abs((await volume(page)) / 7000 - 1)).toBeLessThan(2e-3);
  expect((await state(page)).history.features[4]).toMatchObject({ type: 'loft', centerline: 'axis' });
});

test('twists a sweep and lets another one follow a guide curve', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A 20 × 4 bar on the front plane, a path of 50 along y and a guide drifting out from 10 to 15.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const features = [
      { id: 'bar', type: 'sketch', plane: { kind: 'standard', plane: 'front' }, sketch: { entities: [P('p1', -10, -2), P('p2', 10, -2), P('p3', 10, 2), P('p4', -10, 2), L('l1', 'p1', 'p2'), L('l2', 'p2', 'p3'), L('l3', 'p3', 'p4'), L('l4', 'p4', 'p1')], constraints: [] } },
      { id: 'path', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [P('a', 0, 0), P('b', 0, 50), L('ab', 'a', 'b')], constraints: [] } },
      { id: 'guide', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [P('g1', 10, 0), P('g2', 15, 50), L('g', 'g1', 'g2')], constraints: [] } },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-variants="solid"]');
  await page.click('[data-entry="sweep"]');
  await page.selectOption('[data-testid="sweep-path"]', 'path');
  await page.locator('[data-testid="sweep-twist"]').fill('180');
  await page.locator('[data-testid="sweep-twist"]').press('Tab');
  await idle(page);
  await page.click('[data-testid="panel-ok"]');
  expect(Math.abs((await volume(page)) / 4000 - 1)).toBeLessThan(1e-3);
  expect((await state(page)).history.features[3]).toMatchObject({ type: 'sweep', twist: 180 });

  // Edited again with the guide: no twist, the bar grows to 1.5 times its width.
  await page.locator('.feature-tree .tree-item[data-feature-id]').nth(3).dblclick();
  await page.selectOption('[data-testid="sweep-guide"]', 'guide');
  await expect(page.locator('[data-testid="sweep-twist"]')).toHaveCount(0);
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  const sweep = (await state(page)).history.features[3] as unknown as { guide?: string; twist?: number };
  expect(sweep.guide).toBe('guide');
  expect(sweep.twist).toBeUndefined();
  // Scaled from 1 to 1.5 evenly: the area grows with the square, 80 · (1 + 1.5 + 2.25) / 3 on average.
  expect(Math.abs((await volume(page)) / ((80 * 50 * (1 + 1.5 + 2.25)) / 3) - 1)).toBeLessThan(2e-3);
});

test('creates a helix around a sketch circle and sweeps a spring along it', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A circle of radius 10 on the top plane: the helix winds around it.
  await page.evaluate(() => {
    const features = [{ id: 'base', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [{ id: 'o', type: 'point', x: 0, y: 0 }, { id: 'c', type: 'circle', center: 'o', radius: 10 }], constraints: [] } }];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="helix"]');
  await expect(page.locator('[data-testid="feature-sketch"]')).toHaveValue('base');
  await page.locator('[data-testid="helix-turns"]').fill('4');
  await page.locator('[data-testid="helix-turns"]').press('Tab');
  await expect(page.locator('[data-testid="helix-height"]')).toContainText('20');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'helix', sketch: 'base', pitch: 5, turns: 4 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __parawerk: { viewport: { references(): number } } }).__parawerk.viewport.references())).toBe(1);

  // A wire of radius 1 on the front plane where the helix starts, swept along it.
  await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { getState(): { history: { features: unknown[] } }; setState(s: unknown): void } }).__parawerk;
    const features = [...hooks.getState().history.features, { id: 'wire', type: 'sketch', plane: { kind: 'standard', plane: 'front' }, sketch: { entities: [{ id: 'm', type: 'point', x: 10, y: 0 }, { id: 'w', type: 'circle', center: 'm', radius: 1 }], constraints: [] } }];
    hooks.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-variants="solid"]');
  await page.click('[data-entry="sweep"]');
  await expect(page.locator('[data-testid="sweep-profile"]')).toHaveValue('wire');
  expect(await page.locator('[data-testid="sweep-path"]').inputValue()).toBe((await state(page)).history.features[1]?.id);
  await page.click('[data-testid="panel-ok"]');
  // The wire's area times the way its center goes around: π · 2π · 10 · 4.
  expect(Math.abs((await volume(page)) / (Math.PI * 2 * Math.PI * 10 * 4) - 1)).toBeLessThan(1e-3);
});

test('builds a composite curve from picked edges and a projected curve on a picked face', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A block from x 0 to 100 (y −30 to 30, z 0 to 40), a shaft of radius 10 on it, and a line on the top plane across the shaft.
  await page.evaluate(() => {
    const features = [
      { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [50, 0, 0] },
      { id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [{ id: 'a', type: 'point', x: 20, y: -5 }, { id: 'c', type: 'point', x: 80, y: -5 }, { id: 'l', type: 'line', p1: 'a', p2: 'c' }], constraints: [] } },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="compositeCurve"]');
  await expect(page.locator('[data-testid="curve-edges"]')).toContainText(/click/i);
  await clickWorldPoint(page, [50, -30, 40]);
  await idle(page);
  await clickWorldPoint(page, [100, 0, 40]);
  await idle(page);
  await expect(page.locator('[data-testid="curve-edges"]')).toContainText('2');
  await expect(page.locator('[data-testid="curve-summary"]')).toContainText('160');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  expect((await state(page)).history.features[2]).toMatchObject({ type: 'compositeCurve', curves: [] });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __parawerk: { viewport: { references(): number } } }).__parawerk.viewport.references())).toBe(1);

  // The line projected onto the top face of the block: 60 long, one piece.
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="projectedCurve"]');
  await expect(page.locator('[data-testid="feature-sketch"]')).toHaveValue('s');
  await clickWorldPoint(page, [50, 15, 40]);
  await idle(page);
  await expect(page.locator('[data-testid="curve-faces"]')).toContainText('1');
  await expect(page.locator('[data-testid="curve-summary"]')).toContainText('60');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  expect((await state(page)).history.features[3]).toMatchObject({ type: 'projectedCurve', method: 'faces', sketch: 's' });
  expect((await state(page)).rebuild?.results.every((result) => result.status === 'ok')).toBe(true);
});

test('adds a configuration, changes its variable in the design table and switches between them', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A box 10 × 10 whose height is the variable "length" (20).
  await page.evaluate(() => {
    const features = [
      { id: 'vars', type: 'variables', variables: [{ name: 'length', expression: '20' }] },
      { id: 'box', type: 'box', operation: 'add', width: 10, depth: 10, height: 20, position: [0, 0, 0], expressions: { height: 'length' } },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  expect(await volume(page)).toBeCloseTo(2000, 3);
  await page.click('[data-tab="evaluate"]');
  await page.click('[data-command="configurations"]');
  await expect(page.locator('[data-testid="configurations-none"]')).toBeVisible();
  await page.click('[data-testid="configuration-add"]');
  // "Default" keeps the part as it was; the new one is shown and starts as a copy.
  await expect(page.locator('[data-testid="design-table"] tbody tr')).toHaveCount(2);
  await page.locator('[data-testid="cell-Configuration 1-length"]').fill('50');
  await page.locator('[data-testid="cell-Configuration 1-length"]').press('Enter');
  await expect.poll(() => volume(page)).toBeCloseTo(5000, 3);
  await page.click('[data-testid="configurations-dialog"] .modal-actions .is-primary');
  // The switch in the tree shows Default again.
  await page.selectOption('[data-testid="configuration-switch"]', { label: 'Default' });
  await expect.poll(() => volume(page)).toBeCloseTo(2000, 3);
  await page.selectOption('[data-testid="configuration-switch"]', { label: 'Configuration 1' });
  await expect.poll(() => volume(page)).toBeCloseTo(5000, 3);
  // Undo goes back to Default in one step.
  await page.click('[data-command="undo"]');
  await expect.poll(() => volume(page)).toBeCloseTo(2000, 3);
});

test('cuts a modeled thread into a bolt picked in the 3D view', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A bolt of 10 mm diameter, 30 long.
  await page.evaluate(() => {
    const features = [{ id: 'bolt', type: 'cylinder', operation: 'add', radius: 5, height: 30, axis: 'z', position: [0, 0, 0] }];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  const plain = await volume(page);
  await page.click('[data-variants="holes"]');
  await page.click('[data-entry="thread"]');
  await idle(page);
  await clickWorldPoint(page, [3.54, -3.54, 15]);
  // The size follows the face: M10 with its pitch of 1.5.
  await expect(page.locator('[data-testid="thread-size"]')).toHaveValue('M10');
  await expect(page.locator('[data-testid="thread-pitch"]')).toHaveValue('1.5');
  await page.locator('[data-testid="thread-length"]').fill('12');
  await page.locator('[data-testid="thread-length"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  const threaded = await volume(page);
  expect(threaded).toBeLessThan(plain - 50);
  expect(threaded).toBeGreaterThan(plain - 200);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'thread', size: 'M10', pitch: 1.5, length: 12, faces: [{ name: 'bolt:side' }] });
});

test('adds a rib in the corner of an angle bracket', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A floor, a wall at its left end and a line on the front plane from the wall down to the floor.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const features = [
      { id: 'f', type: 'box', operation: 'add', width: 100, depth: 60, height: 10, position: [0, 0, 0] },
      { id: 'w', type: 'box', operation: 'add', width: 10, depth: 60, height: 60, position: [-45, 0, 10] },
      { id: 'line', type: 'sketch', plane: { kind: 'standard', plane: 'front' }, sketch: { entities: [P('a', -40, 50), P('b', 10, 10), { id: 'ab', type: 'line', p1: 'a', p2: 'b' }], constraints: [] } },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-variants="form"]');
  await page.click('[data-entry="rib"]');
  await expect(page.locator('[data-testid="feature-sketch"]')).toHaveValue('line');
  await page.locator('[data-testid="rib-thickness"]').fill('4');
  await page.locator('[data-testid="rib-thickness"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  // A triangle of 50 × 40, 4 thick.
  expect(await volume(page)).toBeCloseTo(96_000 + 4000, 2);
  expect((await state(page)).history.features[3]).toMatchObject({ type: 'rib', sketch: 'line', thickness: 4, direction: 'parallel' });
});

test('drafts faces picked in the 3D view about a neutral plane picked in the tree', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-variants="form"]');
  await page.click('[data-entry="draft"]');
  // The top plane (z = 0) is the neutral plane; then the front and the right face are tilted by 5°.
  await page.click('.feature-tree .tree-item:has-text("Top plane")');
  await expect(page.locator('[data-testid="draft-faces"]')).toHaveClass(/is-active/);
  await clickWorldPoint(page, [0, -30, 20]);
  await clickWorldPoint(page, [50, 0, 20]);
  await expect(page.locator('[data-testid="draft-faces"]')).toContainText('2 faces');
  await page.locator('[data-testid="draft-angle"]').fill('5');
  await page.locator('[data-testid="draft-angle"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  // Two sides lean in towards the top: less material than the plain box, more than with four sides.
  const shrink = 40 * Math.tan((5 * Math.PI) / 180);
  const drafted = await volume(page);
  expect(drafted).toBeLessThan(240_000 - 0.9 * (100 + 60) * 20 * shrink);
  expect(drafted).toBeGreaterThan(240_000 - (100 + 60) * 20 * shrink);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'draft', angle: 5, references: [{ kind: 'standard-plane', plane: 'top' }], faces: [{ kind: 'face' }, { kind: 'face' }] });
});

test('rounds an edge with a radius that changes along it', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="fillet"]');
  await page.getByRole('radio', { name: 'Variable radius' }).click();
  await idle(page);
  await clickWorldPoint(page, [0, -30, 40]);
  await expect(page.locator('[data-testid="edge-count"]')).toContainText('1');
  await page.locator('[data-testid="fillet-radius"]').fill('2');
  await page.locator('[data-testid="fillet-radius"]').press('Tab');
  await page.locator('[data-testid="fillet-radius2"]').fill('6');
  await page.locator('[data-testid="fillet-radius2"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  // Between a round of 2 and one of 6 all along the 100 mm edge.
  const removed = 240_000 - (await volume(page));
  expect(removed).toBeGreaterThan(4 * (1 - Math.PI / 4) * 100);
  expect(removed).toBeLessThan(36 * (1 - Math.PI / 4) * 100);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'fillet', method: 'variable', radius: 2, radius2: 6 });
});

test('rounds between two faces picked for a face fillet', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="fillet"]');
  await page.getByRole('radio', { name: 'Face fillet' }).click();
  await idle(page);
  // The top and the front face of the 100 × 60 × 40 box.
  await clickWorldPoint(page, [10, 10, 40]);
  await clickWorldPoint(page, [10, -30, 20]);
  await expect(page.locator('[data-testid="round-slot-1"]')).toHaveClass(/is-filled/);
  await page.locator('[data-testid="fillet-radius"]').fill('5');
  await page.locator('[data-testid="fillet-radius"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(240_000 - 25 * (1 - Math.PI / 4) * 100, 2);
  expect((await state(page)).history.features[1]).toMatchObject({ type: 'fillet', method: 'faces', radius: 5, round: [{ name: expect.stringMatching(/:top$/) }, { name: expect.stringMatching(/:front$/) }] });
});

test('rounds the top of a rib fully between its side faces', async () => {
  launched = await launchApp({ width: 1000, height: 640 });
  const { page } = launched;
  // A plate with a rib 80 long, 6 wide and 20 high.
  await page.evaluate(() => {
    const features = [
      { id: 'p', type: 'box', operation: 'add', width: 100, depth: 60, height: 10, position: [0, 0, 0] },
      { id: 'rib', type: 'box', operation: 'add', width: 80, depth: 6, height: 20, position: [0, 0, 10] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-command="fillet"]');
  await page.getByRole('radio', { name: 'Full round' }).click();
  await idle(page);
  // The front side and the top are in view; the back side is given directly.
  await clickWorldPoint(page, [0, -3, 20]);
  await expect(page.locator('[data-testid="round-slot-0"]')).toHaveClass(/is-filled/);
  await clickWorldPoint(page, [10, 0, 30]);
  await expect(page.locator('[data-testid="round-slot-1"]')).toHaveClass(/is-filled/);
  await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { getState(): { display: { body: { naming: { faces: string[] } } } }; commands: { pickRoundFace(pick: unknown): void } } }).__parawerk;
    const index = hooks.getState().display.body.naming.faces.indexOf('rib:back');
    hooks.commands.pickRoundFace({ kind: 'face', index, at: [0, 3, 20] });
  });
  await expect(page.locator('[data-testid="round-slot-2"]')).toHaveClass(/is-filled/);
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(60_000 + 80 * 6 * 17 + 80 * (Math.PI * 9) / 2, 2);
  expect((await state(page)).history.features[2]).toMatchObject({ type: 'fillet', method: 'fullRound', round: [{ name: 'rib:front' }, { name: 'rib:top' }, { name: 'rib:back' }] });
});

test('cutting from a sketch on a face goes into the part, and a cut that misses warns', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page } = launched;
  // A box and a 10 × 10 square on its top face.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const features = [
      { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] },
      {
        id: 'square', type: 'sketch',
        plane: { kind: 'face', face: 5, name: 'box:top', frame: { origin: [0, 0, 40], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } },
        sketch: { entities: [P('a', 0, 0), P('b', 10, 0), P('c', 10, 10), P('d', 0, 10), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a')], constraints: [] },
      },
    ];
    const history = { features, past: [], future: [] };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-command="extrude"]');
  await page.locator('[data-testid="extrude-depth"]').fill('5');
  await page.locator('[data-testid="extrude-depth"]').press('Tab');
  // Remove material turns the direction into the part.
  await page.getByRole('radio', { name: 'Remove material' }).click();
  await expect(page.getByRole('radio', { name: 'Reversed' })).toHaveAttribute('aria-checked', 'true');
  await idle(page);
  await expect(page.locator('[data-testid="panel-warning"]')).toHaveCount(0);
  // Out of the part, the cut removes nothing: the panel says so.
  await page.getByRole('radio', { name: 'Normal' }).click();
  await idle(page);
  await expect(page.locator('[data-testid="panel-warning"]')).toContainText('does not touch the part');
  await page.getByRole('radio', { name: 'Reversed' }).click();
  await page.click('[data-testid="panel-ok"]');
  expect(await volume(page)).toBeCloseTo(240_000 - 500, 2);
});
