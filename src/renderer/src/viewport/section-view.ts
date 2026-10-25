import {
  BackSide,
  DecrementWrapStencilOp,
  DoubleSide,
  FrontSide,
  Group,
  IncrementWrapStencilOp,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  Plane,
  PlaneGeometry,
  ReplaceStencilOp,
  Vector3,
  AlwaysStencilFunc,
  type Material,
  type Sphere,
} from 'three';
import type { Vec3 } from '../../../shared/model/feature.ts';
import type { PartModel } from './part-model.ts';

/** A section through the part: what lies on the side the normal points to is cut away. */
export interface SectionCut {
  point: Vec3;
  normal: Vec3;
}

/** Render order of the passes: stencil counts after the body, then the cap over the cut. */
const STENCIL_ORDER = 5;
const CAP_ORDER = 6;

/**
 * The section view: a clipping plane on the body's materials and a cap where the plane cuts through
 * material. The cap is found with the stencil buffer: along a view ray, back faces of the clipped body
 * count up and front faces count down, so the count is not zero exactly where the ray meets the plane
 * inside the solid. It is a view only; the model does not change.
 */
export class SectionView {
  readonly group = new Group();
  /** three.js keeps what lies on the positive side; the cut normal points to the side that goes. */
  readonly plane = new Plane(new Vector3(0, -1, 0), 0);
  private readonly back = new MeshBasicMaterial({ side: BackSide, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilZPass: IncrementWrapStencilOp, stencilFail: IncrementWrapStencilOp, stencilZFail: IncrementWrapStencilOp });
  private readonly front = new MeshBasicMaterial({ side: FrontSide, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilZPass: DecrementWrapStencilOp, stencilFail: DecrementWrapStencilOp, stencilZFail: DecrementWrapStencilOp });
  private readonly capMaterial = new MeshStandardMaterial({
    side: DoubleSide,
    metalness: 0.05,
    roughness: 0.8,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: NotEqualStencilFunc,
    stencilFail: ReplaceStencilOp,
    stencilZFail: ReplaceStencilOp,
    stencilZPass: ReplaceStencilOp,
  });
  private readonly cap = new Mesh(new PlaneGeometry(1, 1), this.capMaterial);
  private stencils: Mesh[] = [];
  private clipped: Material[] = [];
  private cut: SectionCut | null = null;

  constructor() {
    this.back.clippingPlanes = [this.plane];
    this.front.clippingPlanes = [this.plane];
    this.cap.renderOrder = CAP_ORDER;
    this.cap.raycast = () => undefined;
    this.cap.visible = false;
    this.group.add(this.cap);
  }

  get active(): boolean {
    return this.cut !== null;
  }

  setCapColor(color: number): void {
    this.capMaterial.color.setHex(color);
  }

  /** The materials the plane clips (body faces, edges and highlights). */
  setClippedMaterials(materials: readonly Material[]): void {
    this.clipped = [...materials];
    this.applyClipping();
  }

  /** Puts the stencil passes on the body (again after every new body). */
  attach(body: PartModel | null): void {
    for (const mesh of this.stencils) mesh.removeFromParent();
    this.stencils = [];
    if (!body) return;
    for (const material of [this.back, this.front]) {
      const mesh = new Mesh(body.mesh.geometry, material);
      mesh.renderOrder = STENCIL_ORDER;
      mesh.raycast = () => undefined;
      mesh.visible = this.active;
      body.group.add(mesh);
      this.stencils.push(mesh);
    }
  }

  /** Cuts at `cut` (null: no section), with a cap large enough for a part within `bounds`. */
  set(cut: SectionCut | null, bounds: Sphere): void {
    this.cut = cut;
    if (cut) {
      const normal = new Vector3(...cut.normal).normalize();
      const point = new Vector3(...cut.point);
      // Kept: n · p + c >= 0 with n pointing away from the side that goes.
      this.plane.setFromNormalAndCoplanarPoint(normal.clone().negate(), point);
      const center = this.plane.projectPoint(bounds.center, new Vector3());
      const size = Math.max(1, bounds.radius * 4);
      this.cap.position.copy(center);
      this.cap.scale.set(size, size, 1);
      this.cap.lookAt(center.clone().add(normal));
    }
    this.cap.visible = cut !== null;
    for (const mesh of this.stencils) mesh.visible = cut !== null;
    this.applyClipping();
  }

  /** Whether a point is shown (not cut away). */
  keeps(point: Vector3): boolean {
    return !this.cut || this.plane.distanceToPoint(point) >= -1e-6;
  }

  private applyClipping(): void {
    const planes = this.cut ? [this.plane] : [];
    for (const material of this.clipped) {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of this.stencils) mesh.removeFromParent();
    this.back.dispose();
    this.front.dispose();
    this.capMaterial.dispose();
    this.cap.geometry.dispose();
  }
}
