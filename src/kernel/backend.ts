import type { CopyFeature, EdgeFeature, EdgeRef, ExtrudeFeature, HoleFeature, RevolveFeature, ShellFeature, SolidModelingFeature, Vec3 } from '../shared/model/feature.ts';
import type { FaceNameRef } from '../shared/model/reference.ts';
import type { BodyNaming } from '../shared/model/naming.ts';
import type { Profile } from '../shared/model/profile.ts';
import type { SketchFrame } from '../shared/model/sketch.ts';
import type { EdgeGeometry, FaceGeometry, MassProperties, MeshPayload } from './protocol.ts';
import type { MeasuredDistance, MeasureTarget } from './measure.ts';
import type { MeshQuality } from './mesh-quality.ts';

/** An extrude with the closed outlines and the plane of its sketch (see resolveFeature). */
export interface ResolvedExtrude extends ExtrudeFeature {
  profile: Profile;
  frame: SketchFrame;
  /** Up to a surface or vertex: where the extrusion starts and ends along the sketch normal. */
  range?: [number, number];
  /** Up to a plane at an angle: the plane the extrusion is cut off at (point and normal; the side the normal points to goes). */
  trim?: [number, number, number, number, number, number];
  /**
   * Up to the next face of the body, or up to a curved face of it (topological index; `offset` towards
   * the sketch, negative past the face): the extrusion goes past the body and is stopped there.
   */
  limit?: { kind: 'next' } | { kind: 'face'; face: number; offset: number };
}

/** A revolution with the outlines and plane of its sketch and its axis in sketch coordinates. */
export interface ResolvedRevolve extends RevolveFeature {
  profile: Profile;
  frame: SketchFrame;
  /** Start and end point of the axis line: x0, y0, x1, y1. */
  line: [number, number, number, number];
}

/** Holes with their centers and directions in model space (6 values per hole). */
export interface ResolvedHole extends HoleFeature {
  placements: number[];
}

/** A pattern or mirror with the features it copies (resolved) and the placements of the copies. */
export type ResolvedCopy = CopyFeature & {
  seeds: KernelFeature[];
  /** 12 numbers per copy (see src/shared/model/pattern.ts). */
  transforms: number[];
};

/** A shell with its open faces resolved in the body it hollows out. */
export interface ResolvedShell extends ShellFeature {
  faceIndices: number[];
  /** How many open faces are gone and left out. */
  missingFaces?: number;
  /** The face references the document should take over (faces found again by position). */
  healedFaces?: FaceNameRef[];
}

/** A fillet or chamfer with its edge references resolved in the body it modifies. */
export type ResolvedEdgeFeature = EdgeFeature & {
  /** Topological indices of the edges, without duplicates. */
  edgeIndices: number[];
  /** Per edge: the name of the faces made for it (see FaceNames in native/kernel/src/core.hpp). */
  edgeNames: string[];
  /** The references the document should take over (older index references, edges found again by position). */
  healedEdges?: EdgeRef[];
  /** How many referenced edges are gone and left out. */
  missingEdges?: number;
};

/** A feature as a backend builds it, with its references to earlier features resolved. */
export type KernelFeature =
  | Exclude<SolidModelingFeature, ExtrudeFeature | RevolveFeature | EdgeFeature | HoleFeature | CopyFeature | ShellFeature>
  | ResolvedExtrude
  | ResolvedRevolve
  | ResolvedHole
  | ResolvedCopy
  | ResolvedShell
  | ResolvedEdgeFeature;

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
  /** Whether a cut since the last call removed nothing (its tool missed the body); the call clears it. */
  takeCutMissed?(): boolean;
  counts(shape: ShapeHandle): { faces: number; edges: number; solids: number };
  boundingBox(shape: ShapeHandle): { min: Vec3; max: Vec3 };
  /** Persistent face names and edge positions (docs/adr/0002-persistent-naming.md). */
  naming(shape: ShapeHandle): BodyNaming;
  /** Exact geometry of one face or edge (topological index); throws when the backend cannot tell. */
  faceGeometry(shape: ShapeHandle, index: number): FaceGeometry;
  edgeGeometry(shape: ShapeHandle, index: number): EdgeGeometry;
  /** The shortest distance between two faces, edges or vertices (topological indices) and where it is. */
  distance?(shape: ShapeHandle, a: MeasureTarget, b: MeasureTarget): MeasuredDistance;
  massProperties(shape: ShapeHandle): MassProperties;
  /** Display mesh with edges and exact face/edge information. */
  mesh(shape: ShapeHandle, quality: MeshQuality, key: string): MeshPayload;
  /** Fine mesh for STL export; does not change the display triangulation. */
  exportMesh(shape: ShapeHandle, quality: MeshQuality): { positions: Float32Array; indices: Uint32Array };
  exportStep(shape: ShapeHandle): Uint8Array;
  /** A copy of the shape moved by a transformation (12 values, rows of a 3 × 4 matrix); the caller releases it. */
  transformed?(shape: ShapeHandle, transform: readonly number[]): ShapeHandle;
  importStep(bytes: Uint8Array): ShapeHandle;
  heapBytes(): number;
  describeError(error: unknown): string;
}
