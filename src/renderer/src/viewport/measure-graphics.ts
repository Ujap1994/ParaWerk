import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Group, Line, LineBasicMaterial, LineDashedMaterial, Sprite, SpriteMaterial } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Vec3 } from '../../../shared/model/feature.ts';

/** A measured distance drawn in the 3D view: the shortest distance solid, center distances dashed. */
export interface MeasureLine {
  from: Vec3;
  to: Vec3;
  label: string;
  style: 'distance' | 'center';
}

/** End points on screen, in CSS pixels. */
const POINT_PX = 9;
/** Dashes of center distances on screen, in CSS pixels. */
const DASH_PX = 7;
const GAP_PX = 5;
const RENDER_ORDER = 13;

function dotTexture(): CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 2, 0, 2 * Math.PI);
    context.fill();
  }
  return new CanvasTexture(canvas);
}

/** The lines of the measure tool with their end points and values, on top of the model. */
export class MeasureGraphics {
  readonly group = new Group();
  private readonly solid = new LineBasicMaterial({ depthTest: false, depthWrite: false, transparent: true });
  private readonly dashed = new LineDashedMaterial({ depthTest: false, depthWrite: false, transparent: true, dashSize: 1, gapSize: 1 });
  private readonly point = new SpriteMaterial({ map: dotTexture(), depthTest: false, depthWrite: false, transparent: true });
  private labels = 0;

  constructor() {
    this.group.renderOrder = RENDER_ORDER;
  }

  /** Whether there are value labels to render (the label pass is skipped otherwise). */
  get hasLabels(): boolean {
    return this.labels > 0;
  }

  get count(): number {
    return this.group.children.filter((child) => child instanceof Line).length;
  }

  setColor(color: number): void {
    this.solid.color.setHex(color);
    this.dashed.color.setHex(color);
    this.point.color.setHex(color);
  }

  set(lines: readonly MeasureLine[]): void {
    this.clear();
    for (const line of lines) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([...line.from, ...line.to], 3));
      const object = new Line(geometry, line.style === 'center' ? this.dashed : this.solid);
      if (line.style === 'center') object.computeLineDistances();
      object.renderOrder = RENDER_ORDER;
      this.group.add(object);
      for (const [x, y, z] of [line.from, line.to]) {
        const sprite = new Sprite(this.point);
        sprite.position.set(x, y, z);
        sprite.renderOrder = RENDER_ORDER;
        this.group.add(sprite);
      }
      if (line.label) {
        const element = document.createElement('div');
        element.className = `measure-label is-${line.style}`;
        element.textContent = line.label;
        const label = new CSS2DObject(element);
        label.position.set((line.from[0] + line.to[0]) / 2, (line.from[1] + line.to[1]) / 2, (line.from[2] + line.to[2]) / 2);
        this.group.add(label);
        this.labels++;
      }
    }
  }

  /** Keeps points and dashes the same size on screen. */
  setZoom(mmPerPixel: number): void {
    this.dashed.dashSize = DASH_PX * mmPerPixel;
    this.dashed.gapSize = GAP_PX * mmPerPixel;
    for (const child of this.group.children) if (child instanceof Sprite) child.scale.setScalar(POINT_PX * mmPerPixel);
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      if (child instanceof Line) child.geometry.dispose();
      // CSS2DRenderer leaves the element of a removed label in the page.
      if (child instanceof CSS2DObject) child.element.remove();
    }
    this.group.clear();
    this.labels = 0;
  }

  dispose(): void {
    this.clear();
    this.solid.dispose();
    this.dashed.dispose();
    this.point.map?.dispose();
    this.point.dispose();
  }
}
