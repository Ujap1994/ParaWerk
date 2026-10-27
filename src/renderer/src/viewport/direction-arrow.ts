import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Vec3 } from '../../../shared/model/feature.ts';

/** Length of the arrow on screen, in CSS pixels. */
const LENGTH_PX = 72;
/** A unit arrow along +X: the shaft and a head of four strokes, so it reads from every side. */
const ARROW = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0.78, 0.09, 0, 1, 0, 0, 0.78, -0.09, 0, 1, 0, 0, 0.78, 0, 0.09, 1, 0, 0, 0.78, 0, -0.09];

/** Where a direction starts and which way it points (a unit vector), e.g. where the copies of a pattern go. */
export interface DirectionArrowSpec {
  origin: Vec3;
  direction: Vec3;
}

/**
 * The direction of the pattern being edited: an arrow from the features it copies the way its copies
 * go, drawn on top of the model at the same size on screen at every zoom.
 */
export class DirectionArrow {
  readonly group = new Group();
  private readonly geometry = new LineSegmentsGeometry().setPositions(ARROW);
  private readonly material = new LineMaterial({ linewidth: 3, worldUnits: false, transparent: true, depthTest: false, depthWrite: false });
  private readonly lines = new LineSegments2(this.geometry, this.material);
  private placement: Matrix4 | null = null;
  private mmPerPixel = 1;

  constructor() {
    this.lines.matrixAutoUpdate = false;
    this.lines.renderOrder = 12;
    this.lines.raycast = () => undefined;
    this.group.renderOrder = 12;
  }

  get shown(): DirectionArrowSpec | null {
    if (!this.placement) return null;
    const origin = new Vector3().setFromMatrixPosition(this.placement);
    const direction = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromRotationMatrix(this.placement));
    return { origin: origin.toArray() as Vec3, direction: direction.toArray() as Vec3 };
  }

  setColor(color: number): void {
    this.material.color.setHex(color);
  }

  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height);
  }

  set(arrow: DirectionArrowSpec | null): void {
    this.group.clear();
    this.placement = null;
    if (!arrow) return;
    const direction = new Vector3(...arrow.direction);
    if (direction.lengthSq() < 1e-12) return;
    const rotation = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction.normalize());
    this.placement = new Matrix4().makeRotationFromQuaternion(rotation).setPosition(...arrow.origin);
    this.group.add(this.lines);
    this.setZoom(this.mmPerPixel);
  }

  /** Keeps the arrow the same length on screen. */
  setZoom(mmPerPixel: number): void {
    this.mmPerPixel = mmPerPixel;
    if (!this.placement) return;
    const length = LENGTH_PX * mmPerPixel;
    this.lines.matrix.copy(this.placement).multiply(new Matrix4().makeScale(length, length, length));
    this.lines.updateMatrixWorld(true);
  }

  dispose(): void {
    this.group.clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}
