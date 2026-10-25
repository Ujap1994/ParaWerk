import { CanvasTexture, Group, Sprite, SpriteMaterial } from 'three';
import type { Vec3 } from '../../../shared/model/feature.ts';

/** Marker size on screen, in CSS pixels. */
const SIZE_PX = 22;

/** A ring with a cross: "something was here". Drawn white, tinted by the material color. */
function markerTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.strokeStyle = '#fff';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 6, 0, 2 * Math.PI);
    context.stroke();
    const [a, b] = [size * 0.34, size * 0.66];
    context.beginPath();
    context.moveTo(a, a);
    context.lineTo(b, b);
    context.moveTo(b, a);
    context.lineTo(a, b);
    context.stroke();
  }
  return new CanvasTexture(canvas);
}

/**
 * Marks where references pointed that no longer resolve (for example the edges of a fillet that an
 * earlier change removed), drawn on top of the model at a constant size on screen.
 */
export class LostMarkers {
  readonly group = new Group();
  private readonly material = new SpriteMaterial({ map: markerTexture(), depthTest: false, depthWrite: false, transparent: true });
  private mmPerPixel = 1;

  constructor() {
    this.group.renderOrder = 12;
  }

  get count(): number {
    return this.group.children.length;
  }

  setColor(color: number): void {
    this.material.color.setHex(color);
  }

  set(points: readonly Vec3[]): void {
    this.group.clear();
    for (const [x, y, z] of points) {
      const sprite = new Sprite(this.material);
      sprite.position.set(x, y, z);
      sprite.renderOrder = 12;
      this.group.add(sprite);
    }
    this.setZoom(this.mmPerPixel);
  }

  /** Keeps the markers the same size on screen. */
  setZoom(mmPerPixel: number): void {
    this.mmPerPixel = mmPerPixel;
    for (const sprite of this.group.children) sprite.scale.setScalar(SIZE_PX * mmPerPixel);
  }

  dispose(): void {
    this.group.clear();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
