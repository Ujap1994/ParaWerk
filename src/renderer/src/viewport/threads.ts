import { Group, Vector3, type Vector2 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { CosmeticThread } from '../../../shared/model/hole.ts';

/** Dashes per circle (each dash is followed by a gap of the same length). */
const DASHES = 24;

/** A dashed circle around `center` in the plane normal to `axis` (positions for LineSegmentsGeometry). */
function dashedCircle(center: Vector3, axis: Vector3, radius: number): number[] {
  const u = new Vector3(1, 0, 0).cross(axis);
  if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(axis);
  u.normalize();
  const v = axis.clone().cross(u).normalize();
  const at = (angle: number) => center.clone().addScaledVector(u, radius * Math.cos(angle)).addScaledVector(v, radius * Math.sin(angle));
  const out: number[] = [];
  const step = Math.PI / DASHES;
  for (let i = 0; i < DASHES; i++) {
    const [a, b] = [2 * i * step, (2 * i + 1) * step];
    out.push(...at(a).toArray(), ...at((a + b) / 2).toArray(), ...at((a + b) / 2).toArray(), ...at(b).toArray());
  }
  return out;
}

/**
 * Cosmetic threads of tapped holes: dashed circles of the nominal diameter where the thread starts and
 * ends. Where the part hides them they show through, dimmed.
 */
export class CosmeticThreads {
  readonly group = new Group();
  private readonly visible = new LineMaterial({ linewidth: 1.4, worldUnits: false });
  private readonly hidden = new LineMaterial({ linewidth: 1.2, worldUnits: false, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false });
  private lines: LineSegments2[] = [];
  private key = '';
  private shown = 0;

  /** How many threads are shown. */
  get count(): number {
    return this.shown;
  }

  setColor(color: number): void {
    this.visible.color.setHex(color);
    this.hidden.color.setHex(color);
  }

  setResolution(resolution: Vector2): void {
    this.visible.resolution.copy(resolution);
    this.hidden.resolution.copy(resolution);
  }

  set(threads: readonly CosmeticThread[]): void {
    const key = JSON.stringify(threads);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    this.shown = threads.length;
    if (threads.length === 0) return;
    const positions: number[] = [];
    for (const thread of threads) {
      const center = new Vector3(...thread.point);
      const axis = new Vector3(...thread.direction).normalize();
      positions.push(...dashedCircle(center, axis, thread.radius), ...dashedCircle(center.clone().addScaledVector(axis, thread.depth), axis, thread.radius));
    }
    const geometry = new LineSegmentsGeometry().setPositions(positions);
    const front = new LineSegments2(geometry, this.visible);
    const through = new LineSegments2(geometry, this.hidden);
    front.renderOrder = 3;
    through.renderOrder = 2;
    for (const line of [front, through]) line.raycast = () => undefined;
    this.lines = [front, through];
    this.group.add(front, through);
  }

  dispose(): void {
    this.clear();
    this.visible.dispose();
    this.hidden.dispose();
  }

  private clear(): void {
    this.lines[0]?.geometry.dispose();
    for (const line of this.lines) this.group.remove(line);
    this.lines = [];
  }
}
