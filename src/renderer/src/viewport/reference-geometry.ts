import { Box3, CanvasTexture, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial, Vector3, type Raycaster, type Vector2 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { ReferenceGeometry } from '../../../shared/model/reference.ts';
import type { ViewportPalette } from './palette.ts';

/** `preview`: the reference geometry being edited (in its own color, drawn stronger than the others). */
export type ReferenceStyle = 'normal' | 'hovered' | 'selected' | 'preview';

/** A reference plane, axis or point to show; `index` is its position in the feature list. */
export interface ReferenceItem {
  index: number;
  geometry: ReferenceGeometry;
  style: ReferenceStyle;
}

/** Reference planes and axes are drawn as large as the part (its bounding box), a little larger. */
export type ReferenceExtent = Box3 | null;

/** Size of planes and axes without a part, and the margin around the part (relative to its size, at least MIN_MARGIN). */
const EMPTY_HALF_SIZE = 40;
const MARGIN = 0.12;
const MIN_MARGIN = 4;

/** The corners of a box. */
function corners(box: Box3): Vector3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
}

/** The range [min, max] of the box corners along a direction, relative to `origin`. */
function span(box: Box3, origin: Vector3, direction: Vector3): [number, number] {
  const values = corners(box).map((corner) => corner.clone().sub(origin).dot(direction));
  return [Math.min(...values), Math.max(...values)];
}

const SQUARE = [-1, -1, 0, 1, -1, 0, 1, -1, 0, 1, 1, 0, 1, 1, 0, -1, 1, 0, -1, 1, 0, -1, -1, 0];
/** The three axes of a coordinate system, unit length, with small arrow heads; colored like the axis triad. */
const AXES = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0.82, 0.07, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0.07, 0.82, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0.07, 0, 0.82];
const AXIS_COLORS = [0xe5484d, 0x30a46c, 0x3e63dd].flatMap((hex) => {
  const color = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => c / 255);
  return [...color, ...color, ...color, ...color];
});
/** Length of coordinate system axes on screen, in CSS pixels. */
const AXIS_LENGTH_PX = 64;
/** Point symbols on screen, in CSS pixels; how close the pointer must come to pick one. */
const POINT_SIZE_PX = 16;
const POINT_PICK_PX = 9;

/** A filled point in a ring, drawn white and tinted by the material color. */
export function pointTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.strokeStyle = '#fff';
    context.fillStyle = '#fff';
    context.lineWidth = 6;
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 5, 0, 2 * Math.PI);
    context.stroke();
    context.beginPath();
    context.arc(size / 2, size / 2, 9, 0, 2 * Math.PI);
    context.fill();
  }
  return new CanvasTexture(canvas);
}

/** Dash-dot segments along a line from `a` to `b` (positions for LineSegmentsGeometry). */
function dashDot(a: Vector3, b: Vector3, dash: number, gap: number, dot: number): number[] {
  const out: number[] = [];
  const length = a.distanceTo(b);
  const direction = b.clone().sub(a).normalize();
  const at = (t: number) => a.clone().addScaledVector(direction, Math.min(t, length));
  for (let t = 0; t < length; t += dash + gap + dot + gap) {
    out.push(...at(t).toArray(), ...at(t + dash).toArray());
    if (t + dash + gap < length) out.push(...at(t + dash + gap).toArray(), ...at(t + dash + gap + dot).toArray());
  }
  return out;
}

interface Drawn {
  item: ReferenceItem;
  /** Pick target (plane fill, axis line or point sprite). */
  target: Mesh | LineSegments2 | Sprite;
  objects: (Mesh | LineSegments2 | Sprite)[];
  /** Coordinate systems: the axes and where they stand (scaled to the same size on screen). */
  axes?: { lines: LineSegments2; placement: Matrix4 };
}

/** Reference planes, axes, points and coordinate systems of the part (src/shared/model/reference.ts). */
export class ReferenceGeometryLayer {
  readonly group = new Group();
  private readonly fills: Record<ReferenceStyle, MeshBasicMaterial>;
  private readonly lines: Record<ReferenceStyle, LineMaterial>;
  /** Axes behind or inside the part show through it, dimmed. */
  private readonly hiddenLines: Record<ReferenceStyle, LineMaterial>;
  private readonly points: Record<ReferenceStyle, SpriteMaterial>;
  /** Coordinate system axes: in the axis colors, or all in the hover or selection color. */
  private readonly axisLines: Record<ReferenceStyle, LineMaterial>;
  private readonly squareGeometry = new LineSegmentsGeometry().setPositions(SQUARE);
  private readonly axesGeometry = new LineSegmentsGeometry().setPositions(AXES).setColors(AXIS_COLORS);
  private readonly planeGeometry = new PlaneGeometry(2, 2);
  private drawn: Drawn[] = [];
  private items: readonly ReferenceItem[] = [];
  private extent: ReferenceExtent = null;
  private mmPerPixel = 1;

  constructor() {
    const fill = (opacity: number) => new MeshBasicMaterial({ transparent: true, opacity, side: DoubleSide, depthWrite: false });
    this.fills = { normal: fill(0.08), hovered: fill(0.16), selected: fill(0.16), preview: fill(0.22) };
    const line = (linewidth: number) => new LineMaterial({ linewidth, worldUnits: false, transparent: true, depthWrite: false });
    this.lines = { normal: line(1.4), hovered: line(2.6), selected: line(2.6), preview: line(3) };
    const hidden = (linewidth: number) => new LineMaterial({ linewidth, worldUnits: false, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
    this.hiddenLines = { normal: hidden(1.2), hovered: hidden(2), selected: hidden(2), preview: hidden(2.4) };
    const texture = pointTexture();
    const point = () => new SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true });
    this.points = { normal: point(), hovered: point(), selected: point(), preview: point() };
    const axis = (linewidth: number, vertexColors: boolean) => new LineMaterial({ linewidth, worldUnits: false, vertexColors, transparent: true, depthTest: false, depthWrite: false });
    this.axisLines = { normal: axis(2.6, true), hovered: axis(3.4, false), selected: axis(3.4, false), preview: axis(3.4, true) };
  }

  setPalette(palette: ViewportPalette): void {
    const colors: Record<ReferenceStyle, number> = { normal: palette.reference, hovered: palette.hover, selected: palette.selected, preview: palette.reference };
    for (const style of Object.keys(colors) as ReferenceStyle[]) {
      this.fills[style].color.setHex(colors[style]);
      this.lines[style].color.setHex(colors[style]);
      this.hiddenLines[style].color.setHex(colors[style]);
      this.points[style].color.setHex(colors[style]);
    }
    this.axisLines.hovered.color.setHex(palette.hover);
    this.axisLines.selected.color.setHex(palette.selected);
  }

  setResolution(resolution: Vector2): void {
    for (const material of [...Object.values(this.lines), ...Object.values(this.hiddenLines), ...Object.values(this.axisLines)]) material.resolution.copy(resolution);
  }

  set(items: readonly ReferenceItem[]): void {
    this.items = items;
    this.redraw();
  }

  setExtent(extent: ReferenceExtent): void {
    if (extent === this.extent || (extent && this.extent && extent.equals(this.extent))) return;
    this.extent = extent?.clone() ?? null;
    this.redraw();
  }

  /** Keeps point symbols the same size on screen. */
  setZoom(mmPerPixel: number): void {
    this.mmPerPixel = mmPerPixel;
    for (const drawn of this.drawn) {
      if (drawn.target instanceof Sprite) drawn.target.scale.setScalar(POINT_SIZE_PX * mmPerPixel);
      if (drawn.axes) this.placeAxes(drawn.axes);
    }
  }

  private placeAxes(axes: { lines: LineSegments2; placement: Matrix4 }): void {
    const length = AXIS_LENGTH_PX * this.mmPerPixel;
    axes.lines.matrix.copy(axes.placement).multiply(new Matrix4().makeScale(length, length, length));
    axes.lines.updateMatrixWorld(true);
  }

  get count(): number {
    return this.drawn.length;
  }

  /** The feature index of the reference geometry under the ray (only of `kind`, if given), with its distance along the ray. */
  intersect(raycaster: Raycaster, kind?: ReferenceGeometry['kind']): { index: number; distance: number } | null {
    let best: { index: number; distance: number } | null = null;
    const consider = (index: number, distance: number) => {
      if (!best || distance < best.distance) best = { index, distance };
    };
    for (const drawn of this.drawn) {
      if (kind && drawn.item.geometry.kind !== kind) continue;
      if (drawn.target instanceof Sprite) {
        const position = drawn.target.position;
        const closest = raycaster.ray.closestPointToPoint(position, new Vector3());
        if (closest.distanceTo(position) <= POINT_PICK_PX * this.mmPerPixel) consider(drawn.item.index, raycaster.ray.origin.distanceTo(closest));
        continue;
      }
      const hit = raycaster.intersectObject(drawn.target, false)[0];
      if (hit) consider(drawn.item.index, hit.distance);
    }
    return best;
  }

  /** The space the drawn planes and axes take, so the camera's depth range includes them. */
  bounds(): Box3 | null {
    if (this.drawn.length === 0) return null;
    const box = new Box3();
    for (const drawn of this.drawn) box.expandByObject(drawn.target);
    return box;
  }

  dispose(): void {
    this.clear();
    this.squareGeometry.dispose();
    this.axesGeometry.dispose();
    this.planeGeometry.dispose();
    this.points.normal.map?.dispose();
    for (const material of [...Object.values(this.fills), ...Object.values(this.lines), ...Object.values(this.hiddenLines), ...Object.values(this.points), ...Object.values(this.axisLines)]) material.dispose();
  }

  private clear(): void {
    for (const drawn of this.drawn) {
      for (const object of drawn.objects) {
        this.group.remove(object);
        // Axes have geometry of their own (shared by their two lines); planes, points and coordinate systems share theirs.
        if (object instanceof LineSegments2 && object.geometry !== this.squareGeometry && object.geometry !== this.axesGeometry) object.geometry.dispose();
      }
    }
    this.drawn = [];
  }

  private redraw(): void {
    this.clear();
    const box = this.extent && !this.extent.isEmpty() ? this.extent : null;
    const margin = box ? Math.max(MIN_MARGIN, MARGIN * box.getSize(new Vector3()).length()) : 0;
    /** Where the part lies along a direction from `origin`, with the margin (around 0 without a part). */
    const range = (origin: Vector3, direction: Vector3): [number, number] => {
      if (!box) return [-EMPTY_HALF_SIZE, EMPTY_HALF_SIZE];
      const [min, max] = span(box, origin, direction);
      return [min - margin, max + margin];
    };
    for (const item of this.items) {
      const geometry = item.geometry;
      let drawn: Drawn;
      if (geometry.kind === 'plane') {
        const { frame } = geometry;
        const [xDir, yDir, normal] = [new Vector3(...frame.xDir), new Vector3(...frame.yDir), new Vector3(...frame.normal)];
        // A rectangle in the plane covering the part as seen along the normal.
        const origin = new Vector3(...frame.origin);
        const [u0, u1] = range(origin, xDir);
        const [v0, v1] = range(origin, yDir);
        const middle = origin.clone().addScaledVector(xDir, (u0 + u1) / 2).addScaledVector(yDir, (v0 + v1) / 2);
        const matrix = new Matrix4()
          .makeBasis(xDir, yDir, normal)
          .setPosition(middle)
          .multiply(new Matrix4().makeScale((u1 - u0) / 2, (v1 - v0) / 2, 1));
        const fill = new Mesh(this.planeGeometry, this.fills[item.style]);
        const outline = new LineSegments2(this.squareGeometry, this.lines[item.style]);
        outline.raycast = () => undefined;
        for (const object of [fill, outline]) {
          object.matrixAutoUpdate = false;
          object.matrix.copy(matrix);
          object.renderOrder = 3;
          object.updateMatrixWorld(true);
        }
        drawn = { item, target: fill, objects: [fill, outline] };
      } else if (geometry.kind === 'axis') {
        const point = new Vector3(...geometry.point);
        const direction = new Vector3(...geometry.direction).normalize();
        // As long as the part along the axis.
        const [t0, t1] = range(point, direction);
        const [a, b] = [point.clone().addScaledVector(direction, t0), point.clone().addScaledVector(direction, t1)];
        const unit = Math.max(1, (t1 - t0) / 24);
        const segments = new LineSegmentsGeometry().setPositions(dashDot(a, b, 2.4 * unit, 0.6 * unit, 0.4 * unit));
        const lines = new LineSegments2(segments, this.lines[item.style]);
        lines.renderOrder = 3;
        const through = new LineSegments2(segments, this.hiddenLines[item.style]);
        through.renderOrder = 2;
        through.raycast = () => undefined;
        drawn = { item, target: lines, objects: [lines, through] };
      } else if (geometry.kind === 'csys') {
        // Its origin as a point (what is picked) and its axes, the same size on screen at every zoom.
        const sprite = new Sprite(this.points[item.style]);
        sprite.position.set(...geometry.origin);
        sprite.renderOrder = 12;
        sprite.scale.setScalar(POINT_SIZE_PX * this.mmPerPixel);
        const lines = new LineSegments2(this.axesGeometry, this.axisLines[item.style]);
        lines.matrixAutoUpdate = false;
        lines.renderOrder = 12;
        lines.raycast = () => undefined;
        const placement = new Matrix4().makeBasis(new Vector3(...geometry.xDir), new Vector3(...geometry.yDir), new Vector3(...geometry.zDir)).setPosition(...geometry.origin);
        const axes = { lines, placement };
        this.placeAxes(axes);
        drawn = { item, target: sprite, objects: [lines, sprite], axes };
      } else {
        const sprite = new Sprite(this.points[item.style]);
        sprite.position.set(...geometry.point);
        sprite.renderOrder = 12;
        sprite.scale.setScalar(POINT_SIZE_PX * this.mmPerPixel);
        drawn = { item, target: sprite, objects: [sprite] };
      }
      this.group.add(...drawn.objects);
      this.drawn.push(drawn);
    }
  }
}
