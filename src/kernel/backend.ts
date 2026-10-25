import type { ExtrudeFeature, SolidModelingFeature, Vec3 } from '../shared/model/feature.ts';
import type { Profile } from '../shared/model/profile.ts';
import type { SketchFrame } from '../shared/model/sketch.ts';
import type { MassProperties, MeshPayload } from './protocol.ts';
import type { MeshQuality } from './mesh-quality.ts';

/** An extrude with the closed outlines and the plane of its sketch (see resolveFeature). */
export interface ResolvedExtrude extends ExtrudeFeature {
  profile: Profile;
  frame: SketchFrame;
}

/** A feature as a backend builds it, with its references to earlier features resolved. */
export type KernelFeature = Exclude<SolidModelingFeature, ExtrudeFeature> | ResolvedExtrude;

/** Opaque reference to a shape owned by a backend. */
export type ShapeHandle = { readonly __shape: unique symbol };

/**
 * A geometry kernel implementation. The rebuild logic, caching and the worker
 * protocol are shared; backends only provide the geometric operations.
 * See docs/adr/0001-geometry-kernel.md.
 */
export interface GeometryBackend {
  readonly name: 'parawerk' | 'replicad';
  /** Builds the body after `feature`; throws FeatureError. The caller owns the result. */
  applyFeature(body: ShapeHandle | null, feature: KernelFeature): ShapeHandle;
  release(shape: ShapeHandle): void;
  counts(shape: ShapeHandle): { faces: number; edges: number; solids: number };
  boundingBox(shape: ShapeHandle): { min: Vec3; max: Vec3 };
  massProperties(shape: ShapeHandle): MassProperties;
  /** Display mesh with edges and exact face/edge information. */
  mesh(shape: ShapeHandle, quality: MeshQuality, key: string): MeshPayload;
  /** Fine mesh for STL export; does not change the display triangulation. */
  exportMesh(shape: ShapeHandle, quality: MeshQuality): { positions: Float32Array; indices: Uint32Array };
  exportStep(shape: ShapeHandle): Uint8Array;
  importStep(bytes: Uint8Array): ShapeHandle;
  heapBytes(): number;
  describeError(error: unknown): string;
}
