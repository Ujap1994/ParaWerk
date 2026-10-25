import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { idle, launchApp, repoRoot, type LaunchedApp } from './harness.ts';

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

  await page.click('[data-command="export-stl"]');
  await expect(page.locator('[data-testid="toast-success"]').last()).toBeVisible();
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
  const features = async () => (await state(page)).history.features as unknown as { id: string; type: string; sketch?: unknown; operation?: string; direction?: string; depth?: number }[];

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

  // Undo takes the pocket back.
  await page.click('[data-command="undo"]');
  expect(await volume(page)).toBeCloseTo((2400 - 36 * Math.PI) * 15, 2);
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
