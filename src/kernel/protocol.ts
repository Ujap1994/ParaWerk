import type { EdgeRef, Feature, Vec3 } from '../shared/model/feature.ts';
import type { BodyNaming } from '../shared/model/naming.ts';
import type { GeometryRef, ReferenceGeometry } from '../shared/model/reference.ts';
import type { SketchPlaneRef } from '../shared/model/sketch.ts';

export type SurfaceKind = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'bspline' | 'revolution' | 'extrusion' | 'other';
export type CurveKind = 'line' | 'circle' | 'ellipse' | 'bspline' | 'other';

/** Exact geometry of a B-Rep face (from the kernel, not from the triangles). */
export interface FaceInfo {
  kind: SurfaceKind;
  /** mm² */
  area: number;
  /** Cylinders and spheres. */
  radius?: number;
  /** Planar faces: a point on the plane and the unit normal pointing out of the material. */
  plane?: { point: Vec3; normal: Vec3 };
}

/** Exact geometry of a B-Rep edge. */
export interface EdgeInfo {
  kind: CurveKind;
  /** mm */
  length: number;
  /** Circles and arcs. */
  radius?: number;
  /**
   * Start and end of the curve's own parameter range (equal for closed curves); an arc runs
   * counterclockwise around `axis` from start to end.
   */
  start?: Vec3;
  end?: Vec3;
  /** Circles and arcs: center and unit axis. */
  center?: Vec3;
  axis?: Vec3;
}

/** Exact geometry of one face, for reference geometry built on it. */
export interface FaceGeometry {
  kind: SurfaceKind;
  area: number;
  /** Center of the area. */
  center: Vec3;
  /** Planes: a point on the plane and the outward normal. */
  plane?: { point: Vec3; normal: Vec3 };
  /** Cylinders, cones, tori and surfaces of revolution: their axis. */
  axis?: { point: Vec3; direction: Vec3 };
  sphereCenter?: Vec3;
  radius?: number;
}

/** Exact geometry of one edge, for reference geometry built on it. */
export interface EdgeGeometry {
  kind: CurveKind;
  length: number;
  start: Vec3;
  end: Vec3;
  middle: Vec3;
  /** Circles and ellipses. */
  center?: Vec3;
  /** Circles and ellipses: the normal of their plane; lines: the direction from start to end. */
  axis?: Vec3;
  radius?: number;
}

/** Triangulated body ready for rendering. All buffers are transferable. */
export interface MeshPayload {
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** [start, count] per B-Rep face, in units of `indices`. Face i is topological face index i. */
  faceRanges: Uint32Array;
  /** Line segments (pairs of points) for all edges. */
  edgePositions: Float32Array;
  /** [start, count] per B-Rep edge, in points of `edgePositions`. Edge i is topological edge index i. */
  edgeRanges: Uint32Array;
  /** Exact geometry per face and edge (same indices as the ranges); empty for export meshes. */
  faceInfo: FaceInfo[];
  edgeInfo: EdgeInfo[];
  /** Persistent face names and edge positions, for references to faces and edges. */
  naming: BodyNaming;
}

export type FeatureErrorCode =
  | 'no-body'
  | 'no-edges'
  | 'edge-missing'
  | 'face-missing'
  | 'plane-missing'
  | 'reference-missing'
  | 'reference-kind'
  | 'reference-parallel'
  | 'reference-not-parallel'
  | 'reference-collinear'
  | 'empty-result'
  | 'first-must-add'
  | 'sketch-missing'
  | 'profile-empty'
  | 'profile-crossing'
  | 'axis-missing'
  | 'profile-crosses-axis'
  | 'operation-failed'
  | 'unknown';

export interface FeatureResult {
  id: string;
  status: 'ok' | 'error' | 'suppressed';
  error?: { code: FeatureErrorCode; detail?: string };
  /** The feature was built, but not completely (for example a fillet without edges that are gone). */
  warning?: { code: FeatureErrorCode; detail?: string };
  /** Time spent on this feature in the last rebuild (0 when it came from the cache). */
  timeMs: number;
  cached: boolean;
  /**
   * Fillets and chamfers whose references were older edge indices or found their edges only by position:
   * the up-to-date references, for the document to take over (docs/adr/0002-persistent-naming.md).
   */
  healedEdges?: EdgeRef[];
  /** Sketches on faces: where the face is now (or the plane of an older file with its face's name), for the document to take over. */
  healedPlane?: SketchPlaneRef;
  /** Reference planes, axes and points: where they lie now. */
  reference?: ReferenceGeometry;
  /** Reference geometry whose references were found only by position: the up-to-date references, for the document to take over. */
  healedReferences?: GeometryRef[];
}

export interface MassProperties {
  /** mm³ */
  volume: number;
  /** mm² */
  area: number;
  center: Vec3;
  bboxMin: Vec3;
  bboxMax: Vec3;
}

/** The state of the body after a given feature, as requested by `RebuildRequest.captures`. */
export interface CapturedState {
  /** Feature index; -1 means "before the first feature". */
  index: number;
  /** Null when there is no body at this point. */
  meshKey: string | null;
  /** Omitted when the client already holds the mesh (see `knownMeshKeys`). */
  mesh?: MeshPayload;
  properties: MassProperties | null;
  faceCount: number;
  edgeCount: number;
}

export interface RebuildRequest {
  features: Feature[];
  captures: number[];
  knownMeshKeys: string[];
  withProperties: boolean;
}

export interface RebuildResult {
  features: FeatureResult[];
  captures: CapturedState[];
  timings: { totalMs: number; rebuiltFeatures: number; meshMs: number };
}

export type ExportFormat = 'step' | 'stl';

export interface ExportRequest {
  features: Feature[];
  format: ExportFormat;
}

export interface MemoryStats {
  wasmHeapBytes: number;
  cachedShapes: number;
}

export type KernelRequest =
  | { type: 'rebuild'; payload: RebuildRequest }
  | { type: 'export'; payload: ExportRequest }
  | { type: 'memory' };

export type KernelRequestMessage = KernelRequest & { id: number };

export type KernelResponseMessage =
  | { kind: 'reply'; id: number; ok: true; result: unknown }
  | { kind: 'reply'; id: number; ok: false; error: string }
  | { kind: 'ready'; initMs: number }
  | { kind: 'warm'; warmUpMs: number }
  | { kind: 'fatal'; error: string };
