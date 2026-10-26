import { test, type Page } from '@playwright/test';
import path from 'node:path';
import { splinePoint, splineRoots, splineThrough } from '../../src/shared/model/spline.ts';
import { crashApp, idle, launchApp, relaunchAfterCrash, repoRoot } from '../e2e/harness.ts';

/**
 * Generates the screenshots used in README.md and docs/user-guide.
 * Run with `npm run docs:screenshots` after `npm run build`.
 */
const out = (name: string) => path.join(repoRoot, 'docs/images/screenshots', name);

async function buildDemoPart(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { setState(s: unknown): void; getState(): { history: unknown } } }).__parawerk;
    const features = [
      { id: 'base', type: 'box', operation: 'add', width: 120, depth: 80, height: 20, position: [0, 0, 0] },
      { id: 'boss', type: 'cylinder', operation: 'add', radius: 22, height: 35, axis: 'z', position: [20, 0, 20] },
      { id: 'bore', type: 'cylinder', operation: 'cut', radius: 12, height: 80, axis: 'z', position: [20, 0, -10] },
      { id: 'slot', type: 'box', operation: 'cut', width: 30, depth: 14, height: 30, position: [-38, 0, -5] },
      { id: 'hole1', type: 'cylinder', operation: 'cut', radius: 4.5, height: 40, axis: 'z', position: [-45, 28, -10] },
      { id: 'hole2', type: 'cylinder', operation: 'cut', radius: 4.5, height: 40, axis: 'z', position: [-45, -28, -10] },
    ];
    const history = { features, past: [], future: [] };
    hooks.setState({ history, savedFeatures: features, dirty: false, fileName: 'Bearing block' });
  });
  await idle(page);
}

test('README and user guide screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  await buildDemoPart(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('main-window.png') });

  // Fillet with preview: pick the three vertical edges of the base plate that are visible in the isometric view.
  await page.click('[data-command="fillet"]');
  await idle(page);
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  for (const point of [[60, -40, 10], [60, 40, 10], [-60, -40, 10]] as const) {
    const screen = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      point,
    );
    if (canvas) await page.mouse.click(canvas.x + screen.x, canvas.y + screen.y);
    await idle(page);
  }
  await page.locator('[data-testid="fillet-radius"]').fill('8');
  await idle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('fillet-preview.png') });
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('filleted-part.png') });

  // Sketch mode: choosing the plane (the hovered plane is highlighted), then sketching on it.
  await page.click('[data-command="sketch"]');
  await page.hover('.plane-choice[data-plane="front"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-choose-plane.png') });
  const topFace = await page.evaluate(
    ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
    [45, -28, 20] as const,
  );
  if (canvas) await page.mouse.move(canvas.x + topFace.x, canvas.y + topFace.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-choose-face.png') });
  await page.click('.plane-choice[data-plane="front"]');
  await idle(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('sketch-mode.png') });
  await page.click('[data-testid="sketch-cancel"]');
  await idle(page);

  // An existing sketch on the top face: geometry, hover information and the other sketches' look.
  const before = await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { setState(s: unknown): void; getState(): { history: { features: unknown[] } } } }).__parawerk;
    const features = hooks.getState().history.features;
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [
        P('a', -52, -32), P('b', -10, -32), P('c', -10, 32), P('d', -52, 32),
        { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
        { id: 'l3', type: 'line', p1: 'c', p2: 'd' }, { id: 'l4', type: 'line', p1: 'd', p2: 'a' },
        P('m', 42, 0), { id: 'k', type: 'circle', center: 'm', radius: 9 },
        P('x1', -60, 0), P('x2', 60, 0), { id: 'axis', type: 'line', p1: 'x1', p2: 'x2', construction: true },
      ],
      constraints: [
        { id: 'h1', type: 'horizontal', line: 'l1' }, { id: 'v1', type: 'vertical', line: 'l2' },
        { id: 'h2', type: 'horizontal', line: 'l3' }, { id: 'v2', type: 'vertical', line: 'l4' },
      ],
    };
    const frame = { origin: [0, 0, 20], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
    const withSketch = [...features, { id: 'doc-sketch', type: 'sketch', plane: { kind: 'face', face: 0, frame }, sketch }];
    hooks.setState({ history: { features: withSketch, past: [], future: [] } });
    return features;
  });
  await idle(page);
  await page.dblclick('.tree-item[data-feature-id="doc-sketch"]');
  await idle(page);
  await page.waitForTimeout(700);
  const lineMiddle = await page.evaluate(
    ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
    [-10, 10, 20] as const,
  );
  if (canvas) await page.mouse.move(canvas.x + lineMiddle.x, canvas.y + lineMiddle.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-geometry.png') });

  // Drawing a line from a corner: preview, measurement, horizontal relation and an inference line.
  const sketchPoint = (u: number, v: number) =>
    page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      [u, v, 20] as const,
    );
  await page.keyboard.press('l');
  const corner = await sketchPoint(-10, 32);
  const target = await sketchPoint(41.6, 32.4);
  if (canvas) {
    await page.mouse.move(canvas.x + corner.x, canvas.y + corner.y, { steps: 4 });
    await page.mouse.click(canvas.x + corner.x, canvas.y + corner.y);
    await page.mouse.move(canvas.x + target.x, canvas.y + target.y, { steps: 6 });
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-drawing.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Two selected lines: the side panel offers the relations that fit and lists the existing ones.
  const bottom = await sketchPoint(-31, -32);
  const top = await sketchPoint(-31, 32);
  if (canvas) {
    await page.mouse.click(canvas.x + bottom.x, canvas.y + bottom.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(canvas.x + top.x, canvas.y + top.y);
    await page.keyboard.up('Shift');
    await page.mouse.move(canvas.x + 40, canvas.y + 40);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-relations.png') });
  await page.keyboard.press('Escape');

  // Dimensions: pick the bottom line, place the value below it and type it; then the circle's diameter.
  await page.keyboard.press('d');
  const clickSketch = async (u: number, v: number) => {
    const p = await sketchPoint(u, v);
    if (!canvas) return;
    await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
  };
  await clickSketch(-31, -32);
  await clickSketch(-31, -43);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-dimension-value.png') });
  await page.locator('[data-testid="dimension-editor"]').fill('40');
  await page.keyboard.press('Enter');
  await idle(page);
  await clickSketch(-10, 10);
  await clickSketch(-2, 22);
  await page.locator('[data-testid="dimension-editor"]').fill('60');
  await page.keyboard.press('Enter');
  await clickSketch(42, 9);
  await clickSketch(56, 20);
  await page.locator('[data-testid="dimension-editor"]').fill('16');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('sketch-dimensions.png') });

  // Relation symbols: pointing at one highlights the geometry it relates.
  const symbols = await page.evaluate(() =>
    (window as unknown as { __parawerk: { viewport: { relationGlyphs(): { kind: string; x: number; y: number }[] } } }).__parawerk.viewport.relationGlyphs(),
  );
  const symbol = symbols.find((glyph) => glyph.kind === 'horizontal');
  if (symbol && canvas) await page.mouse.move(canvas.x + symbol.x, canvas.y + symbol.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-relation-symbols.png') });
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);

  // A conflicting dimension: the sketch is over defined, the conflict is red and listed.
  await page.evaluate(() => {
    const hooks = (window as unknown as {
      __parawerk: { getState(): { sketch: { draft: { sketch: { entities: unknown[]; constraints: unknown[] } } } }; commands: { recordSketchChange(s: unknown): void } };
    }).__parawerk;
    const sketch = hooks.getState().sketch.draft.sketch;
    hooks.commands.recordSketchChange({
      ...sketch,
      constraints: [...sketch.constraints, { id: 'conflict', type: 'horizontalDistance', a: 'a', b: 'b', value: 35, driving: true, offset: [0, -20] }],
    });
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('sketch-conflict.png') });
  await page.click('[data-command="undo"]');
  await page.waitForTimeout(300);
  await page.click('[data-testid="sketch-ok"]');
  await page.evaluate(() => (window as unknown as { __parawerk: { commands: { setView(v: string): void } } }).__parawerk.commands.setView('isometric'));
  await idle(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('sketch-in-model.png') });
  await page.evaluate((features) => {
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  }, before);
  await idle(page);

  // More drawing tools on the front plane, above the part: a line with a tangent arc, a slot, a hexagon.
  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="front"]');
  await idle(page);
  await page.waitForTimeout(600);
  const front = async (u: number, v: number) => {
    const p = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      [u, 0, v] as const,
    );
    if (!canvas) return;
    await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
  };
  await page.keyboard.press('l');
  await front(-75, 75);
  await front(-40, 75);
  await page.keyboard.press('Escape');
  await page.click('.split-toggle[data-variants="centerArc threePointArc tangentArc"]');
  await page.click('.menu-item[data-tool="tangentArc"]');
  await front(-40, 75);
  await front(-25, 92);
  await page.click('[data-command="tool-slot"]');
  await front(-5, 88);
  await front(30, 88);
  await front(12, 96);
  await page.click('[data-command="tool-polygon"]');
  await front(65, 90);
  await front(78, 90);
  // A rectangle with a rounded and a beveled corner.
  await page.keyboard.press('r');
  await front(-130, 70);
  await front(-92, 100);
  await page.click('[data-command="tool-sketchFillet"]');
  await page.locator('[data-testid="corner-size"]').fill('8');
  await front(-92, 100);
  await page.click('.split-toggle[data-variants="sketchFillet sketchChamfer"]');
  await page.click('.menu-item[data-tool="sketchChamfer"]');
  await page.locator('[data-testid="corner-size"]').fill('6');
  await front(-130, 70);
  await page.keyboard.press('Escape');
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('sketch-tools.png') });

  // The rectangle variants.
  await page.click('.split-toggle[data-variants="cornerRectangle centerRectangle threePointRectangle parallelogram"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: out('sketch-rectangle-variants.png') });
  await page.keyboard.press('Escape');

  // Trim: a line across the slot; the piece of the slot's top side left of it turns red under the cursor.
  // (Right of the middle: the view toolbar floats above the slot.)
  await page.keyboard.press('l');
  await front(22, 80);
  await front(22, 102);
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  {
    const p = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      [3, 0, 96] as const,
    );
    if (canvas) await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-trim.png') });
  await page.keyboard.press('Escape');

  // A row of holes: one circle, then a linear pattern from the side panel.
  await page.keyboard.press('c');
  await front(-125, 52);
  await front(-122, 52);
  await page.keyboard.press('Escape');
  await front(-122, 52);
  await page.click('[data-transform="linear"]');
  await page.locator('[data-testid="pattern-count"]').fill('4');
  await page.locator('[data-testid="pattern-step-x"]').fill('11');
  await page.click('[data-testid="sketch-transform"] .transform-action');
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('sketch-pattern.png') });
  await page.click('[data-testid="sketch-cancel"]');
  await idle(page);

  // The fully defined bracket profile of the user guide's example (as the exit-check test draws it).
  const model = await page.evaluate(() => (window as unknown as { __parawerk: { getState(): { history: { features: unknown[] } } } }).__parawerk.getState().history.features);
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const D = (id: string, a: string, b: string, value: number, offset: [number, number], driving = true) => ({ id, type: 'distance', a, b, value, driving, offset });
    const sketch = {
      entities: [
        P('p1', 60, 0), L('l1', 'origin', 'p1'), P('p2', 60, 10), L('l2', 'p1', 'p2'), P('p3', 10, 10), L('l3', 'p2', 'p3'),
        P('p4', 10, 40), L('l4', 'p3', 'p4'), P('p5', 0, 40), L('l5', 'p4', 'p5'), L('l6', 'p5', 'origin'),
        P('p6', 45, 5), { id: 'c1', type: 'circle', center: 'p6', radius: 3 }, P('p7', 5, 30), { id: 'c2', type: 'circle', center: 'p7', radius: 3 },
      ],
      constraints: [
        { id: 'r1', type: 'horizontal', line: 'l1' }, { id: 'r2', type: 'vertical', line: 'l2' }, { id: 'r3', type: 'horizontal', line: 'l3' },
        { id: 'r4', type: 'vertical', line: 'l4' }, { id: 'r5', type: 'horizontal', line: 'l5' }, { id: 'r6', type: 'vertical', line: 'l6' },
        { id: 'r7', type: 'equal', a: 'c1', b: 'c2' },
        D('d1', 'origin', 'p1', 60, [0, -7]), D('d2', 'p1', 'p2', 10, [7, 0]), D('d3', 'p4', 'p5', 10, [-1, 7]), D('d4', 'p5', 'origin', 40, [-7, 0]),
        { id: 'd5', type: 'diameter', circle: 'c1', value: 6, driving: true, offset: [-9, -10] },
        D('d6', 'p6', 'l1', 5, [8, -0.5]), D('d7', 'p6', 'l2', 15, [-0.5, -14]), D('d8', 'p7', 'l6', 5, [-10.5, 0]), D('d9', 'p7', 'l5', 10, [11, 0]),
        D('d10', 'p2', 'p3', 50, [0, 5], false),
      ],
    };
    const features = [{ id: 'bracket', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  });
  await idle(page);
  await page.dblclick('.tree-item[data-feature-id="bracket"]');
  await idle(page);
  await page.waitForTimeout(600);
  await page.click('[data-testid="zoom-to-fit"]');
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('sketch-bracket.png') });
  await page.click('[data-testid="sketch-ok"]');

  // A fully defined ellipse: center at the origin, horizontal axis, both semi-axes, a tangent line.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [
        P('ma', 30, 0), P('mi', 0, 15), { id: 'e', type: 'ellipse', center: 'origin', major: 'ma', minor: 'mi' },
        P('t1', -40, 15), P('t2', 40, 15), { id: 'top', type: 'line', p1: 't1', p2: 't2' },
      ],
      constraints: [
        { id: 'h', type: 'horizontalPoints', a: 'origin', b: 'ma' },
        { id: 'da', type: 'distance', a: 'origin', b: 'ma', value: 30, driving: true, offset: [0, -24] },
        { id: 'db', type: 'distance', a: 'origin', b: 'mi', value: 15, driving: true, offset: [-12, 0] },
        { id: 'flat', type: 'horizontal', line: 'top' },
        { id: 'tan', type: 'tangent', a: 'top', b: 'e' },
        { id: 'w', type: 'distance', a: 't1', b: 't2', value: 80, driving: true, offset: [0, 9] },
        { id: 'left', type: 'horizontalDistance', a: 't1', b: 'origin', value: 40, driving: true, offset: [0, 25] },
      ],
    };
    const features = [{ id: 'oval', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  });
  await idle(page);
  await page.dblclick('.tree-item[data-feature-id="oval"]');
  await idle(page);
  await page.waitForTimeout(600);
  await page.click('[data-testid="zoom-to-fit"]');
  await page.waitForTimeout(800);
  {
    const p = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      [-21.2, -10.6, 0] as const,
    );
    if (canvas) await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-ellipse.png') });
  await page.click('[data-testid="sketch-ok"]');

  // A spline between two lines: a handle profile whose fit points are dimensioned like any points, and
  // a point held on the spline (for a later hole) placed by a dimension.
  const handle = splineThrough([[70, 12], [50, 22], [30, 14], [12, 26], [0, 18]]);
  if (!handle) throw new Error('no spline');
  const onHandle = splinePoint(handle, splineRoots(handle, (p) => p[0] - 22)[0] as number);
  await page.evaluate((onHandle) => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [
        P('a', 70, 0), { id: 'base', type: 'line', p1: 'origin', p2: 'a' },
        P('b', 70, 12), { id: 'end', type: 'line', p1: 'a', p2: 'b' },
        P('s1', 50, 22), P('s2', 30, 14), P('s3', 12, 26), P('c', 0, 18),
        { id: 'curve', type: 'spline', points: ['b', 's1', 's2', 's3', 'c'] },
        { id: 'start', type: 'line', p1: 'c', p2: 'origin' },
        P('q', onHandle[0], onHandle[1]),
      ],
      constraints: [
        { id: 'h', type: 'horizontal', line: 'base' }, { id: 'v1', type: 'vertical', line: 'end' }, { id: 'v2', type: 'vertical', line: 'start' },
        { id: 'w', type: 'distance', a: 'origin', b: 'a', value: 70, driving: true, offset: [0, -8] },
        { id: 'r', type: 'distance', a: 'a', b: 'b', value: 12, driving: true, offset: [8, 0] },
        { id: 'l', type: 'distance', a: 'c', b: 'origin', value: 18, driving: true, offset: [-8, 0] },
        { id: 'top', type: 'verticalDistance', a: 'origin', b: 's1', value: 22, driving: true, offset: [40, 0] },
        { id: 'on', type: 'pointOnCircle', point: 'q', circle: 'curve' },
        { id: 'qx', type: 'horizontalDistance', a: 'origin', b: 'q', value: 22, driving: true, offset: [0, 14] },
      ],
    };
    const features = [{ id: 'handle', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  }, onHandle);
  await idle(page);
  await page.dblclick('.tree-item[data-feature-id="handle"]');
  await idle(page);
  await page.waitForTimeout(600);
  await page.click('[data-testid="zoom-to-fit"]');
  await page.waitForTimeout(800);
  {
    const p = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      [40, 17.4, 0] as const,
    );
    if (canvas) await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-spline.png') });

  // Trim at a spline: a line across the handle; the piece above the spline turns red under the cursor.
  {
    const at = async (x: number, y: number) => {
      const p = await page.evaluate(
        ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
        [x, y, 0] as const,
      );
      return canvas ? { x: canvas.x + p.x, y: canvas.y + p.y } : { x: 0, y: 0 };
    };
    await page.keyboard.press('l');
    for (const [x, y] of [[58, 4], [58, 34]] as const) {
      const p = await at(x, y);
      await page.mouse.move(p.x, p.y, { steps: 3 });
      await page.mouse.click(p.x, p.y);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    const p = await at(58, 30);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('sketch-spline-trim.png') });

    // Remove that piece, then cut the spline at the line: the part beyond the cut is only hinted.
    await page.mouse.click(p.x, p.y);
    const beyond = splinePoint(handle, splineRoots(handle, (q) => q[0] - 65)[0] as number);
    const right = await at(beyond[0], beyond[1]);
    await page.mouse.move(right.x, right.y, { steps: 3 });
    await page.mouse.click(right.x, right.y);
    await page.keyboard.press('Escape');
    if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + canvas.height - 40);
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('sketch-spline-cut.png') });
  }
  await page.click('[data-testid="sketch-ok"]');

  // Convert entities: the outline of a box top and the circle of a boss, projected onto the top plane.
  await page.evaluate(() => {
    const features = [
      { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] },
      { id: 'c', type: 'cylinder', operation: 'add', radius: 12, height: 25, axis: 'z', position: [25, 0, 40] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  });
  await idle(page);
  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="top"]');
  await idle(page);
  await page.waitForTimeout(700);
  const onModel = async (x: number, y: number, z: number) =>
    page.evaluate(
      ([px, py, pz]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(px, py, pz),
      [x, y, z] as const,
    );
  await page.click('[data-command="tool-convert"]');
  for (const [x, y, z] of [[-20, -30, 40], [50, 10, 40], [-20, 30, 40], [37, 0, 65]] as const) {
    const p = await onModel(x, y, z);
    if (canvas) {
      await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
      await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
    }
  }
  // Pointing at the last edge of the outline highlights it in the model.
  {
    const p = await onModel(-50, 10, 40);
    if (canvas) await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-convert.png') });
  await page.keyboard.press('Escape');
  await page.click('[data-testid="sketch-ok"]');
  await idle(page);
  await page.evaluate((features) => {
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  }, model);
  await idle(page);

  // Variables: a list of named values, and a box whose sizes follow them.
  await page.evaluate(() => {
    const features = [
      { id: 'vars', type: 'variables', variables: [{ name: 'width', expression: '120' }, { name: 'depth', expression: 'width / 2' }, { name: 'thickness', expression: '15' }, { name: 'hole', expression: 'thickness * 1.2' }] },
      { id: 'plate', type: 'box', operation: 'add', width: 120, depth: 60, height: 15, position: [0, 0, 0], expressions: { width: 'width', depth: 'depth', height: 'thickness' } },
      { id: 'bore', type: 'cylinder', operation: 'cut', radius: 18, height: 40, axis: 'z', position: [0, 0, -10], expressions: { radius: 'hole' } },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  });
  await idle(page);
  await page.click('[data-command="variables"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('variables.png') });
  await page.click('[data-testid="panel-cancel"]');
  await page.dblclick('.tree-item[data-feature-id="plate"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('variables-parameters.png') });
  await page.click('[data-testid="panel-cancel"]');

  // Extrude: a slot-shaped plate with two holes, then a pocket cut from a sketch on its top face.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const plate = {
      id: 'outline', type: 'sketch', plane: { kind: 'standard', plane: 'top' },
      sketch: {
        entities: [
          P('cl', -35, 0), P('cr', 35, 0), P('a', -35, -25), P('b', 35, -25), P('c', 35, 25), P('d', -35, 25),
          L('bottom', 'a', 'b'), { id: 'right', type: 'arc', center: 'cr', start: 'b', end: 'c' }, L('top', 'c', 'd'), { id: 'left', type: 'arc', center: 'cl', start: 'd', end: 'a' },
          { id: 'h1', type: 'circle', center: 'cl', radius: 8 }, { id: 'h2', type: 'circle', center: 'cr', radius: 8 },
        ],
        constraints: [],
      },
    };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features: [plate], past: [], future: [] } });
  });
  await idle(page);
  await page.click('[data-command="extrude"]');
  await page.locator('[data-testid="extrude-depth"]').fill('12');
  await page.locator('[data-testid="extrude-depth"]').press('Tab');
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { commands: { setView(v: string): void } } }).__parawerk.commands.setView('isometric'));
  await page.waitForTimeout(700);
  await page.click('[data-testid="zoom-to-fit"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('extrude-plate.png') });
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { setState(s: unknown): void; getState(): { history: { features: unknown[] } } } }).__parawerk;
    const pocket = {
      id: 'pocket', type: 'sketch',
      plane: { kind: 'face', face: 0, frame: { origin: [0, 0, 12], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } },
      sketch: {
        entities: [
          { id: 'p1', type: 'point', x: -15, y: -10 }, { id: 'p2', type: 'point', x: 15, y: -10 }, { id: 'p3', type: 'point', x: 15, y: 10 }, { id: 'p4', type: 'point', x: -15, y: 10 },
          { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'l3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'l4', type: 'line', p1: 'p4', p2: 'p1' },
        ],
        constraints: [],
      },
    };
    hooks.setState({ history: { features: [...hooks.getState().history.features, pocket], past: [], future: [] } });
  });
  await idle(page);
  await page.click('[data-command="extrude"]');
  await page.getByRole('radio', { name: 'Remove material' }).click();
  await page.getByRole('radio', { name: 'Reversed' }).click();
  await page.locator('[data-testid="extrude-depth"]').fill('6');
  await page.locator('[data-testid="extrude-depth"]').press('Tab');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  if (canvas) await page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('extrude-pocket.png') });

  // Revolve: the half section of a flanged bush around its centerline, three quarters of a turn.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string, construction = false) => ({ id, type: 'line', p1, p2, ...(construction ? { construction } : {}) });
    const section = {
      id: 'bush', type: 'sketch', plane: { kind: 'standard', plane: 'front' },
      sketch: {
        entities: [
          P('a', 6, 0), P('b', 20, 0), P('c', 20, 6), P('d', 10, 6), P('e', 10, 30), P('f', 6, 30), P('g', 0, -6), P('h', 0, 36),
          L('l1', 'a', 'b'), L('l2', 'b', 'c'), L('l3', 'c', 'd'), L('l4', 'd', 'e'), L('l5', 'e', 'f'), L('l6', 'f', 'a'), L('axis', 'g', 'h', true),
        ],
        constraints: [],
      },
    };
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features: [section], past: [], future: [] } });
  });
  await idle(page);
  await page.click('[data-command="revolve"]');
  await page.locator('[data-testid="revolve-angle"]').fill('270');
  await page.locator('[data-testid="revolve-angle"]').press('Tab');
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { commands: { setView(v: string): void } } }).__parawerk.commands.setView('isometric'));
  await page.waitForTimeout(700);
  await page.click('[data-testid="zoom-to-fit"]');
  await page.waitForTimeout(700);
  if (canvas) await page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);
  await page.screenshot({ path: out('revolve-bush.png') });
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  await page.click('[data-command="settings"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('settings-dialog.png') });
  await page.locator('[data-testid="settings-dialog"] [name="theme"][data-value="dark"]').click();
  await page.locator('[data-testid="settings-dialog"] [name="language"][data-value="de"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('dark-theme-german.png') });
  await app.close();
});

test('lost references screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  await buildDemoPart(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  const click = async (point: readonly [number, number, number]) => {
    const screen = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      point,
    );
    if (canvas) await page.mouse.click(canvas.x + screen.x, canvas.y + screen.y);
    await idle(page);
  };

  // A fillet on a corner of the base plate and on both upper long edges of the slot.
  await page.click('[data-command="fillet"]');
  await idle(page);
  for (const point of [[60, -40, 10], [-38, -7, 20], [-38, 7, 20]] as const) await click(point);
  await page.locator('[data-testid="fillet-radius"]').fill('3');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // Suppressing the slot removes its edges: the fillet keeps the corner and warns.
  const slot = page.locator('[data-feature-id="slot"]');
  await slot.hover();
  await slot.locator('.tree-actions button').nth(1).click();
  await idle(page);
  const fillet = page.locator('.tree-item[data-feature-id]').last();
  await fillet.hover();
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('fillet-warning.png') });

  await fillet.dblclick();
  await idle(page);
  await page.waitForTimeout(600);
  if (canvas) await page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);
  await page.screenshot({ path: out('fillet-missing-edges.png') });
  await app.close();
});

test('reference geometry screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  await buildDemoPart(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  const pick = (kind: string, index: number, at?: number[]) =>
    page.evaluate(
      ([k, i, a]) => (window as unknown as { __parawerk: { commands: { handlePick(p: object, additive: boolean): void } } }).__parawerk.commands.handlePick({ kind: k, index: i, ...(a ? { at: a } : {}) }, false),
      [kind, index, at] as const,
    );
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  const click = async (point: readonly [number, number, number]) => {
    const screen = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      point,
    );
    if (canvas) await page.mouse.click(canvas.x + screen.x, canvas.y + screen.y);
    await idle(page);
  };

  // The axis of the bore: select its face, then Axis.
  await click([20, -12, 40]);
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="axis"]');
  await idle(page);
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // A plane through that axis at 30° to the front plane, edited with its preview.
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="plane"]');
  await page.selectOption('[data-testid="reference-method"]', 'angle');
  await pick('plane', 0);
  await pick('reference', 6);
  await page.locator('[data-testid="plane-angle"]').fill('30');
  await page.locator('[data-testid="plane-angle"]').press('Tab');
  await idle(page);
  await page.waitForTimeout(600);
  if (canvas) await page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);
  await page.screenshot({ path: out('reference-plane.png') });
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // A point at the center of the back hole's top rim.
  await page.click('[data-variants="reference-geometry"]');
  await page.click('[data-entry="point"]');
  await page.selectOption('[data-testid="reference-method"]', 'center');
  await click([-45, 23.5, 20]);
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('reference-geometry.png') });
  await app.close();
});

test('hole screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  await buildDemoPart(page);
  // Two points on the base plate's top face, and three on the boss around the bore.
  await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { setState(s: unknown): void; getState(): { history: { features: unknown[] } } } }).__parawerk;
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const frame = (z: number) => ({ origin: [0, 0, z], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] });
    const angle = (k: number) => (2 * Math.PI * k) / 3;
    const features = [
      ...hooks.getState().history.features,
      { id: 'plate-points', type: 'sketch', plane: { kind: 'face', face: 0, name: 'base:top', frame: frame(20) }, sketch: { entities: [P('a', 48, 28), P('b', 48, -28)], constraints: [] } },
      {
        id: 'boss-points', type: 'sketch', plane: { kind: 'face', face: 0, name: 'boss:top', frame: frame(55) },
        sketch: { entities: [0, 1, 2].map((k) => P(`p${k}`, 20 + 17 * Math.cos(angle(k)), 17 * Math.sin(angle(k)))), constraints: [] },
      },
    ];
    hooks.setState({ history: { features, past: [], future: [] } });
  });
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  const canvas = await page.locator('.viewport-canvas').boundingBox();

  // Tapped M4 holes in the boss, 10 mm deep.
  await page.click('[data-command="hole"]');
  await page.selectOption('[data-testid="hole-sketch"]', 'boss-points');
  await page.selectOption('[data-testid="hole-kind"]', 'tapped');
  await page.selectOption('[data-testid="hole-size"]', 'M4');
  await page.getByRole('radio', { name: 'Depth' }).click();
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // Counterbores for M6 cap screws in the base plate, shown while they are edited.
  await page.click('[data-command="hole"]');
  await page.selectOption('[data-testid="hole-sketch"]', 'plate-points');
  await page.selectOption('[data-testid="hole-kind"]', 'counterbore');
  await idle(page);
  await page.waitForTimeout(600);
  if (canvas) await page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);
  await page.screenshot({ path: out('hole-counterbore.png') });
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // Close up on the boss: the threads are drawn as dashed circles of the nominal diameter.
  await page.evaluate(() => (window as unknown as { __parawerk: { commands: { setView(v: string): void } } }).__parawerk.commands.setView('isometric'));
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    const at = await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(20, 0, 55));
    if (canvas) {
      await page.mouse.move(canvas.x + at.x, canvas.y + at.y);
      await page.mouse.wheel(0, -300);
    }
    await page.waitForTimeout(150);
  }
  // The pointer rests in the empty part of the feature tree, so nothing in the view is highlighted.
  if (canvas) await page.mouse.move(canvas.x - 150, canvas.y + canvas.height - 40);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('hole-threads.png') });
  await app.close();
});

test('pattern screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  await buildDemoPart(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  const canvas = await page.locator('.viewport-canvas').boundingBox();

  // The two holes at the left end, copied twice to the right, 22 mm apart along the plate's front edge.
  await page.click('[data-command="pattern"]');
  await page.click('.feature-tree .tree-item[data-feature-id="hole1"]');
  await page.click('.feature-tree .tree-item[data-feature-id="hole2"]');
  await page.click('[data-testid="reference-slot-0"] .reference-slot-button');
  const edge = await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(30, -40, 20));
  if (canvas) await page.mouse.click(canvas.x + edge.x, canvas.y + edge.y);
  await page.locator('[data-testid="pattern-spacing"]').fill('22');
  await page.locator('[data-testid="pattern-spacing"]').press('Tab');
  await idle(page);
  // Picking in the tree scrolled the side bar; the panel is shown from its top.
  await page.evaluate(() => document.querySelector('.sidebar')?.scrollTo(0, 0));
  await page.waitForTimeout(600);
  if (canvas) await page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);
  await page.screenshot({ path: out('pattern-linear.png') });
  await page.click('[data-testid="panel-ok"]');
  await app.close();
});

test('shell screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  // An enclosure: a box with rounded vertical edges.
  await page.evaluate(() => {
    const features = [
      { id: 'body', type: 'box', operation: 'add', width: 120, depth: 80, height: 45, position: [0, 0, 0] },
      { id: 'round', type: 'fillet', radius: 8, edges: [0, 2, 4, 6].map((index) => ({ kind: 'edge-index', index })) },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, fileName: 'Enclosure' });
  });
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  const canvas = await page.locator('.viewport-canvas').boundingBox();

  // Shell: open at the top face, 2.5 mm walls.
  await page.click('[data-command="shell"]');
  await idle(page);
  const top = await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(0, 0, 45));
  if (canvas) await page.mouse.click(canvas.x + top.x, canvas.y + top.y);
  await page.locator('[data-testid="shell-thickness"]').fill('2.5');
  await page.locator('[data-testid="shell-thickness"]').press('Tab');
  await idle(page);
  await page.waitForTimeout(600);
  if (canvas) await page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);
  await page.screenshot({ path: out('shell.png') });
  await page.click('[data-testid="panel-ok"]');
  await app.close();
});

test('feature tree screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  // A flange: plate, boss, bore and two rounded edges; the bar sits above the fillet and the bore.
  await page.evaluate(() => {
    const features = [
      { id: 'plate', type: 'box', operation: 'add', width: 100, depth: 70, height: 15, position: [0, 0, 0] },
      { id: 'boss', type: 'cylinder', operation: 'add', radius: 22, height: 30, axis: 'z', position: [0, 0, 15] },
      {
        id: 'round',
        type: 'fillet',
        radius: 8,
        edges: [
          { kind: 'edge', faces: ['plate:front', 'plate:left'], at: [-50, -35, 7.5] },
          { kind: 'edge', faces: ['plate:front', 'plate:right'], at: [50, -35, 7.5] },
          { kind: 'edge', faces: ['plate:back', 'plate:right'], at: [50, 35, 7.5] },
          { kind: 'edge', faces: ['plate:back', 'plate:left'], at: [-50, 35, 7.5] },
        ],
      },
      { id: 'bore', type: 'cylinder', operation: 'cut', radius: 12, height: 60, axis: 'z', position: [0, 0, -5] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, fileName: 'Flange', rollback: 'round' });
  });
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  await page.locator('[data-testid="rollback-bar"]').hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('feature-tree-rollback.png') });
  await app.close();
});

test('material and mass properties screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  // The flange of the feature tree screenshots, all built.
  await page.evaluate(() => {
    const features = [
      { id: 'plate', type: 'box', operation: 'add', width: 100, depth: 70, height: 15, position: [0, 0, 0] },
      { id: 'boss', type: 'cylinder', operation: 'add', radius: 22, height: 30, axis: 'z', position: [0, 0, 15] },
      {
        id: 'round',
        type: 'fillet',
        radius: 8,
        // The four vertical edges of the plate, between its sides.
        edges: [
          { kind: 'edge', faces: ['plate:front', 'plate:left'], at: [-50, -35, 7.5] },
          { kind: 'edge', faces: ['plate:front', 'plate:right'], at: [50, -35, 7.5] },
          { kind: 'edge', faces: ['plate:back', 'plate:right'], at: [50, 35, 7.5] },
          { kind: 'edge', faces: ['plate:back', 'plate:left'], at: [-50, 35, 7.5] },
        ],
      },
      { id: 'bore', type: 'cylinder', operation: 'cut', radius: 12, height: 60, axis: 'z', position: [0, 0, -5] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, fileName: 'Flange' });
  });
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.click('[data-tab="evaluate"]');
  await page.click('[data-command="material"]');
  await page.click('[data-material="aluminium-6061"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('material-dialog.png') });
  await page.click('[data-testid="material-ok"]');
  await page.click('[data-command="mass-properties"]');
  await idle(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('mass-properties.png') });
  await app.close();
});

test('measure screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  // A bearing plate with two bores: the distance of the bore axes is measured.
  await page.evaluate(() => {
    const features = [
      { id: 'plate', type: 'box', operation: 'add', width: 120, depth: 60, height: 20, position: [0, 0, 0] },
      { id: 'left', type: 'cylinder', operation: 'cut', radius: 10, height: 40, axis: 'z', position: [-30, 0, -10] },
      { id: 'right', type: 'cylinder', operation: 'cut', radius: 7, height: 40, axis: 'z', position: [35, 0, -10] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, fileName: 'Bearing plate' });
  });
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(400);
  await page.click('[data-tab="evaluate"]');
  await page.click('[data-command="measure"]');
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  // The far walls of both bores (visible from the isometric view), away from their seams.
  for (const point of [[-30 - 7.07, 7.07, 14], [35 - 4.95, 4.95, 14]] as const) {
    const screen = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      point,
    );
    if (canvas) await page.mouse.click(canvas.x + screen.x, canvas.y + screen.y);
    await idle(page);
  }
  if (canvas) await page.mouse.move(canvas.x + canvas.width - 30, canvas.y + canvas.height - 30);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('measure.png') });
  await app.close();
});

test('section view screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  // A hollow hub: a flange with a boss, a stepped bore and a pocket from below.
  await page.evaluate(() => {
    const features = [
      { id: 'plate', type: 'box', operation: 'add', width: 100, depth: 70, height: 15, position: [0, 0, 0] },
      { id: 'boss', type: 'cylinder', operation: 'add', radius: 22, height: 30, axis: 'z', position: [0, 0, 15] },
      { id: 'bore', type: 'cylinder', operation: 'cut', radius: 9, height: 60, axis: 'z', position: [0, 0, -5] },
      { id: 'counterbore', type: 'cylinder', operation: 'cut', radius: 15, height: 12, axis: 'z', position: [0, 0, 33] },
      { id: 'pocket', type: 'box', operation: 'cut', width: 70, depth: 50, height: 8, position: [0, 0, -1] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, fileName: 'Hub' });
  });
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.click('[data-testid="toggle-section"]');
  await idle(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('section-view.png') });
  await app.close();
});

test('recovery screenshots', async () => {
  // A session with unsaved work ends abnormally; the next start offers the copy.
  const first = await launchApp({ width: 1440, height: 900 });
  await first.page.evaluate(() => {
    const features = [
      { id: 'plate', type: 'box', operation: 'add', width: 100, depth: 70, height: 15, position: [0, 0, 0] },
      { id: 'boss', type: 'cylinder', operation: 'add', radius: 22, height: 30, axis: 'z', position: [0, 0, 15] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: [], dirty: true, fileName: 'Flange', filePath: '/Users/me/Parts/Flange.pwpart' });
  });
  await idle(first.page);
  await first.page.evaluate(() => (window as unknown as { __parawerk: { recovery: { flush(): Promise<void> } } }).__parawerk.recovery.flush());
  await crashApp(first.app);
  const { app, page } = await relaunchAfterCrash({ width: 1440, height: 900, userData: first.userData });
  await page.locator('[data-testid="recovery-dialog"]').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('recovery.png') });
  await app.close();
});

test('STEP import screenshots', async () => {
  // A STEP file from another part: the bearing block, exported as STEP.
  const source = await launchApp({ width: 1440, height: 900 });
  await buildDemoPart(source.page);
  await source.page.click('[data-command="export-step"]');
  await source.page.locator('[data-testid="toast-success"]').last().waitFor();
  const step = path.join(source.outputDir, 'Bearing block.step');
  await source.app.close();

  const { app, page } = await launchApp({ width: 1440, height: 900, env: { PARAWERK_E2E_OPEN_FILE: step } });
  await page.click('[data-command="import-step"]');
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('import-step.png') });
  await page.click('[data-testid="panel-ok"]');
  await app.close();
});

test('extrude end screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  // A plate with a shaft above it; a square boss on the plate goes up to the shaft's curved face.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const features = [
      { id: 'plate', type: 'box', operation: 'add', width: 90, depth: 70, height: 10, position: [0, 0, 0] },
      { id: 'shaft', type: 'cylinder', operation: 'add', radius: 15, height: 70, axis: 'y', position: [0, -35, 45] },
      {
        id: 'square', type: 'sketch', plane: { kind: 'face', face: 5, name: 'plate:top', frame: { origin: [0, 0, 10], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } },
        sketch: { entities: [P('a', -8, -20), P('b', 8, -20), P('c', 8, 20), P('d', -8, 20), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a')], constraints: [] },
      },
      { id: 'rib', type: 'extrude', operation: 'add', sketch: 'square', depth: 10, direction: 'normal', end: 'upToSurface', endRef: { kind: 'face', name: 'shaft:side', at: [0, 0, 30] }, name: 'Rib' },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, fileName: 'Shaft support' });
  });
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.locator('.feature-tree .tree-item[data-feature-id="rib"]').dblclick();
  await idle(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('extrude-up-to-surface.png') });
  await page.click('[data-testid="panel-ok"]');
  await app.close();
});

test('part modeling overview screenshot', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  // A bearing housing built the way a user would: sketches, extrusions, a bore through all, counterbored
  // M6 holes, rounds and a chamfer, in aluminium.
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const rect = (p: string, w: number, h: number) => [
      P(`${p}1`, -w / 2, -h / 2), P(`${p}2`, w / 2, -h / 2), P(`${p}3`, w / 2, h / 2), P(`${p}4`, -w / 2, h / 2),
      L(`${p}a`, `${p}1`, `${p}2`), L(`${p}b`, `${p}2`, `${p}3`), L(`${p}c`, `${p}3`, `${p}4`), L(`${p}d`, `${p}4`, `${p}1`),
    ];
    const circle = (id: string, r: number) => [P(`${id}c`, 0, 0), { id, type: 'circle', center: `${id}c`, radius: r }];
    const onFace = (name: string, z: number) => ({ kind: 'face', face: 0, name, frame: { origin: [0, 0, z], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } });
    const sketch = (id: string, name: string, plane: unknown, entities: unknown[]) => ({ id, type: 'sketch', name, plane, sketch: { entities, constraints: [] } });
    const extrude = (id: string, name: string, from: string, depth: number, more: object = {}) => ({ id, type: 'extrude', name, operation: 'add', sketch: from, depth, direction: 'normal', end: 'blind', ...more });
    const edge = (a: string, b: string, at: number[]) => ({ kind: 'edge', faces: [a, b].sort(), at });
    const features = [
      sketch('base', 'Base sketch', { kind: 'standard', plane: 'top' }, rect('q', 120, 80)),
      extrude('plate', 'Plate', 'base', 12),
      {
        id: 'corners', type: 'fillet', name: 'Corner rounds', radius: 10,
        edges: [edge('plate:side:qa', 'plate:side:qb', [60, -40, 6]), edge('plate:side:qb', 'plate:side:qc', [60, 40, 6]), edge('plate:side:qc', 'plate:side:qd', [-60, 40, 6]), edge('plate:side:qd', 'plate:side:qa', [-60, -40, 6])],
      },
      sketch('boss-sketch', 'Boss sketch', onFace('plate:end', 12), circle('k', 26)),
      extrude('boss', 'Boss', 'boss-sketch', 28),
      sketch('bore-sketch', 'Bore sketch', onFace('boss:end', 40), circle('b', 15)),
      extrude('bore', 'Bore', 'bore-sketch', 10, { operation: 'cut', direction: 'reverse', end: 'throughAll' }),
      sketch('points', 'Mounting points', onFace('plate:end', 12), [P('m1', -45, -25), P('m2', 45, -25), P('m3', 45, 25), P('m4', -45, 25)]),
      {
        id: 'mount', type: 'hole', name: 'M6 counterbores', kind: 'counterbore', size: 'M6', fit: 'normal', sketch: 'points', end: 'throughAll', reverse: false,
        diameter: 6.6, depth: 12, counterboreDiameter: 11, counterboreDepth: 6.4, countersinkDiameter: 13.7, countersinkAngle: 90, threadDepth: 12,
      },
      { id: 'foot', type: 'fillet', name: 'Boss fillet', radius: 4, edges: [edge('boss:side:k', 'plate:end', [26, 0, 12])] },
      { id: 'rim', type: 'chamfer', name: 'Bore chamfer', distance: 1.5, edges: [edge('boss:end', 'bore:side:b', [15, 0, 40])] },
    ];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, fileName: 'Bearing housing' });
  });
  await idle(page);
  await page.click('[data-tab="evaluate"]');
  await page.click('[data-command="material"]');
  await page.click('[data-material="aluminium-6061"]');
  await page.click('[data-testid="material-ok"]');
  await page.click('[data-tab="features"]');
  await idle(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (canvas) await page.mouse.move(canvas.x + canvas.width - 30, canvas.y + canvas.height - 30);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('part-modeling.png') });
  await app.close();
});
