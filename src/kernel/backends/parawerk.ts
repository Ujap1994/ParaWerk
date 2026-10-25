import createParaWerkKernel from '../../../vendor/parawerk-kernel/parawerk-kernel.js';
import { extrudeRange, revolveRange, type BooleanOperation, type Vec3 } from '../../shared/model/feature.ts';
import { holeProfile, throughDepth } from '../../shared/model/hole.ts';
import { transformDirection, transformPoint } from '../../shared/model/pattern.ts';
import type { GeometryBackend, KernelFeature, ResolvedCopy, ResolvedHole, ShapeHandle } from '../backend.ts';
import { FeatureError } from '../feature-error.ts';
import { axisDirection } from '../feature-geometry.ts';
import type { MeshQuality } from '../mesh-quality.ts';
import { encodeProfile, profileEdgeNames } from '../profile-data.ts';
import type { BodyNaming } from '../../shared/model/naming.ts';
import type { CurveKind, EdgeGeometry, EdgeInfo, FaceGeometry, FaceInfo, FeatureErrorCode, MassProperties, MeshPayload, SurfaceKind } from '../protocol.ts';

type KernelModule = Awaited<ReturnType<typeof createParaWerkKernel>>;

type IdResult = { ok: true; id: number; missed?: boolean } | { ok: false; code: string; message: string };
type Failure = { ok: false; code: string; message: string };

interface RawMesh {
  ok: true;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceRanges: Uint32Array;
  edgePositions: Float32Array;
  edgeRanges: Uint32Array;
  faceKinds: Uint8Array;
  faceAreas: Float64Array;
  faceRadii: Float64Array;
  facePlanes: Float64Array;
  edgeKinds: Uint8Array;
  edgeLengths: Float64Array;
  edgeRadii: Float64Array;
  edgeGeometry: Float64Array;
}

/** Must match SurfaceKindCode / CurveKindCode in native/kernel/src/kernel.cpp. */
const SURFACE_KINDS: SurfaceKind[] = ['plane', 'cylinder', 'cone', 'sphere', 'torus', 'bspline', 'revolution', 'extrusion', 'other'];
const CURVE_KINDS: CurveKind[] = ['line', 'circle', 'ellipse', 'bspline', 'other'];

const FEATURE_ERROR_CODES = new Set<FeatureErrorCode>([
  'no-body', 'no-edges', 'edge-missing', 'face-missing', 'plane-missing', 'reference-missing', 'reference-kind', 'reference-parallel', 'reference-not-parallel', 'reference-collinear', 'empty-result', 'first-must-add', 'sketch-missing', 'profile-empty', 'profile-crossing', 'axis-missing', 'axis-not-in-plane', 'hole-no-points', 'hole-invalid', 'pattern-empty', 'pattern-seed-missing', 'pattern-unsupported', 'shell-face-missing', 'end-behind', 'end-parallel', 'profile-crosses-axis',
  'operation-failed', 'unknown',
]);

/** Three finite numbers from `values` at `at`, or null. */
function vec3(values: readonly number[], at: number): Vec3 | null {
  const v = values.slice(at, at + 3);
  return v.length === 3 && v.every(Number.isFinite) ? (v as Vec3) : null;
}

class KernelCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelCallError';
  }
}

function check<T extends { ok: boolean }>(result: T | Failure): T {
  if (!result.ok) throw new KernelCallError((result as Failure).message);
  return result as T;
}

/**
 * Backend on ParaWerk's own OCCT 8 WebAssembly build (native/kernel). Shapes stay in
 * C++ and are referenced by integer ids; every call returns plain data.
 */
export class ParaWerkBackend implements GeometryBackend {
  readonly name = 'parawerk';
  private readonly kernel: KernelModule;

  private constructor(kernel: KernelModule) {
    this.kernel = kernel;
  }

  static async create(wasmUrl?: string): Promise<ParaWerkBackend> {
    const kernel = await createParaWerkKernel(wasmUrl === undefined ? {} : { locateFile: () => wasmUrl });
    return new ParaWerkBackend(kernel);
  }

  get version(): string {
    return this.kernel.version();
  }

  get liveShapes(): number {
    return this.kernel.shapeCount();
  }

  private id(handle: ShapeHandle): number {
    return handle as unknown as number;
  }

  private cutMissed = false;

  takeCutMissed(): boolean {
    const missed = this.cutMissed;
    this.cutMissed = false;
    return missed;
  }

  private handle(result: unknown): ShapeHandle {
    const value = result as IdResult;
    if (value.ok && value.missed) this.cutMissed = true;
    if (!value.ok) {
      const code = FEATURE_ERROR_CODES.has(value.code as FeatureErrorCode) ? (value.code as FeatureErrorCode) : 'operation-failed';
      throw new FeatureError(code, value.message);
    }
    return value.id as unknown as ShapeHandle;
  }

  /** Adds the tool to the body or cuts it out; the tool is released (or becomes the body). */
  private combine(body: ShapeHandle | null, tool: ShapeHandle, operation: BooleanOperation): ShapeHandle {
    if (body === null) {
      if (operation === 'cut') {
        this.release(tool);
        throw new FeatureError('first-must-add');
      }
      return tool;
    }
    try {
      return this.handle(this.kernel.booleanOperation(this.id(body), this.id(tool), operation === 'add' ? 0 : 1));
    } finally {
      this.release(tool);
    }
  }

  /** The solid a box, cylinder, extrusion or revolution adds or cuts; the caller releases it. */
  private tool(body: ShapeHandle | null, feature: Extract<KernelFeature, { type: 'box' | 'cylinder' | 'extrude' | 'revolve' }>): ShapeHandle {
    const k = this.kernel;
    switch (feature.type) {
      case 'box': {
        const [x, y, z] = feature.position;
        return this.handle(k.makeBox(x - feature.width / 2, y - feature.depth / 2, z, feature.width, feature.depth, feature.height, feature.id));
      }
      case 'cylinder': {
        const [x, y, z] = feature.position;
        const [dx, dy, dz] = axisDirection(feature.axis);
        return this.handle(k.makeCylinder(x, y, z, dx, dy, dz, feature.radius, feature.height, feature.id));
      }
      case 'extrude': {
        const { origin, xDir, normal } = feature.frame;
        let extent: [number, number] | undefined;
        if (feature.end === 'throughAll') {
          // Through all goes past the body: its extent along the normal, from the corners of its box.
          if (body === null) throw new FeatureError('no-body');
          const { min, max } = this.boundingBox(body);
          const along = [0, 1, 2, 3, 4, 5, 6, 7].map((corner) => {
            const p: Vec3 = [corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]];
            return (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] + (p[2] - origin[2]) * normal[2];
          });
          extent = [Math.min(...along), Math.max(...along)];
        }
        const [from, to] = feature.range ?? extrudeRange(feature, extent);
        const tool = this.handle(k.extrudeProfile(encodeProfile(feature.profile), [...origin, ...xDir, ...normal], from, to, profileEdgeNames(feature.profile), feature.id));
        if (!feature.trim) return tool;
        // Up to a plane at an angle: cut the extrusion off at the plane.
        try {
          return this.handle(k.trimByPlane(this.id(tool), feature.trim, feature.id));
        } finally {
          this.release(tool);
        }
      }
      case 'revolve': {
        const [from, to] = revolveRange(feature);
        const { origin, xDir, normal } = feature.frame;
        return this.handle(
          k.revolveProfile(encodeProfile(feature.profile), [...origin, ...xDir, ...normal], feature.line, from, to, profileEdgeNames(feature.profile), feature.id),
        );
      }
    }
  }

  /** Cuts holes at their placements; `name` prefixes the names of their faces. */
  private holes(body: ShapeHandle, feature: ResolvedHole, placements: readonly number[], name: string): ShapeHandle {
    const throughAll = feature.end === 'throughAll';
    const { min, max } = this.boundingBox(body);
    const depth = throughAll ? throughDepth(min, max, placements) : feature.depth;
    const profile = holeProfile(feature, depth, throughAll);
    return this.handle(this.kernel.cutHoles(this.id(body), encodeProfile(profile), [...placements], profileEdgeNames(profile), name));
  }

  /** Adds or cuts the copies of a pattern or mirror, one feature it copies after the other. */
  private copies(body: ShapeHandle, feature: ResolvedCopy): ShapeHandle {
    const count = feature.transforms.length / 12;
    const transforms = Array.from({ length: count }, (_, i) => feature.transforms.slice(12 * i, 12 * i + 12));
    let current = body;
    for (const seed of feature.seeds) {
      // Faces of copy i of feature s are "<pattern id>:<s id>:<i>:…".
      const name = `${feature.id}:${seed.id}`;
      let next: ShapeHandle;
      if (seed.type === 'hole') {
        // Holes are drilled again at the moved centers, all in one cut.
        const placements: number[] = [];
        for (const m of transforms) {
          for (let k = 0; k + 5 < seed.placements.length; k += 6) {
            const point = seed.placements.slice(k, k + 3) as Vec3;
            const direction = seed.placements.slice(k + 3, k + 6) as Vec3;
            placements.push(...transformPoint(m, point), ...transformDirection(m, direction));
          }
        }
        next = this.holes(current, seed, placements, name);
      } else if (seed.type === 'box' || seed.type === 'cylinder' || seed.type === 'extrude' || seed.type === 'revolve') {
        const tool = this.tool(current, seed);
        try {
          next = this.handle(this.kernel.combineCopies(this.id(current), this.id(tool), feature.transforms, seed.operation === 'add' ? 0 : 1, name));
        } finally {
          this.release(tool);
        }
      } else {
        throw new FeatureError('pattern-unsupported');
      }
      if (current !== body) this.release(current);
      current = next;
    }
    return current;
  }

  applyFeature(body: ShapeHandle | null, feature: KernelFeature): ShapeHandle {
    const k = this.kernel;
    switch (feature.type) {
      case 'box':
      case 'cylinder':
      case 'extrude':
      case 'revolve':
        return this.combine(body, this.tool(body, feature), feature.operation);
      case 'hole':
        if (body === null) throw new FeatureError('no-body');
        return this.holes(body, feature, feature.placements, feature.id);
      case 'pattern':
      case 'mirror':
        if (body === null) throw new FeatureError('no-body');
        return this.copies(body, feature);
      case 'shell':
        if (body === null) throw new FeatureError('no-body');
        return this.handle(k.shell(this.id(body), feature.faceIndices, feature.thickness, feature.outward, feature.id));
      case 'fillet':
      case 'chamfer': {
        if (body === null) throw new FeatureError('no-body');
        if (feature.edgeIndices.length === 0) throw new FeatureError('no-edges');
        const { edgeIndices, edgeNames, id } = feature;
        return feature.type === 'fillet'
          ? this.handle(k.fillet(this.id(body), edgeIndices, feature.radius, edgeNames, id))
          : this.handle(k.chamfer(this.id(body), edgeIndices, feature.distance, edgeNames, id));
      }
    }
  }

  release(handle: ShapeHandle): void {
    this.kernel.release(this.id(handle));
  }

  counts(handle: ShapeHandle) {
    const result = check(this.kernel.counts(this.id(handle)) as { ok: true; faces: number; edges: number; solids: number } | Failure);
    return { faces: result.faces, edges: result.edges, solids: result.solids };
  }

  boundingBox(handle: ShapeHandle): { min: Vec3; max: Vec3 } {
    const result = check(this.kernel.boundingBox(this.id(handle)) as { ok: true; min: Vec3; max: Vec3 } | Failure);
    return { min: result.min, max: result.max };
  }

  naming(handle: ShapeHandle): BodyNaming {
    const result = check(this.kernel.naming(this.id(handle)) as ({ ok: true } & BodyNaming) | Failure);
    return {
      faces: result.faces,
      facePlanes: result.facePlanes,
      edgeFaces: result.edgeFaces,
      edgeMidpoints: result.edgeMidpoints,
      edgeVertices: result.edgeVertices,
      vertexPositions: result.vertexPositions,
      vertexFaceOffsets: result.vertexFaceOffsets,
      vertexFaces: result.vertexFaces,
    };
  }

  faceGeometry(handle: ShapeHandle, index: number): FaceGeometry {
    type Raw = { ok: true; kind: number; area: number; center: number[]; plane: number[]; axis: number[]; radius: number };
    const raw = check(this.kernel.faceGeometry(this.id(handle), index) as Raw | Failure);
    const result: FaceGeometry = { kind: SURFACE_KINDS[raw.kind] ?? 'other', area: raw.area, center: vec3(raw.center, 0) ?? [NaN, NaN, NaN] };
    const [point, normal] = [vec3(raw.plane, 0), vec3(raw.plane, 3)];
    if (point && normal) result.plane = { point, normal };
    const [axisPoint, direction] = [vec3(raw.axis, 0), vec3(raw.axis, 3)];
    if (axisPoint && direction) result.axis = { point: axisPoint, direction };
    else if (axisPoint) result.sphereCenter = axisPoint;
    if (Number.isFinite(raw.radius)) result.radius = raw.radius;
    return result;
  }

  edgeGeometry(handle: ShapeHandle, index: number): EdgeGeometry {
    type Raw = { ok: true; kind: number; length: number; start: number[]; end: number[]; middle: number[]; center: number[]; axis: number[]; radius: number };
    const raw = check(this.kernel.edgeGeometry(this.id(handle), index) as Raw | Failure);
    const missing: Vec3 = [NaN, NaN, NaN];
    const result: EdgeGeometry = {
      kind: CURVE_KINDS[raw.kind] ?? 'other',
      length: raw.length,
      start: vec3(raw.start, 0) ?? missing,
      end: vec3(raw.end, 0) ?? missing,
      middle: vec3(raw.middle, 0) ?? missing,
    };
    const [center, axis] = [vec3(raw.center, 0), vec3(raw.axis, 0)];
    if (center) result.center = center;
    if (axis) result.axis = axis;
    if (Number.isFinite(raw.radius)) result.radius = raw.radius;
    return result;
  }

  massProperties(handle: ShapeHandle): MassProperties {
    const props = check(
      this.kernel.massProperties(this.id(handle)) as { ok: true; volume: number; area: number; center: Vec3; inertia: MassProperties['inertia'] } | Failure,
    );
    const bbox = this.boundingBox(handle);
    return { volume: props.volume, area: props.area, center: props.center, bboxMin: bbox.min, bboxMax: bbox.max, ...(props.inertia ? { inertia: props.inertia } : {}) };
  }

  mesh(handle: ShapeHandle, quality: MeshQuality, key: string): MeshPayload {
    const raw = check(this.kernel.mesh(this.id(handle), quality.linear, quality.angular) as RawMesh | Failure);
    const faceInfo: FaceInfo[] = Array.from(raw.faceKinds, (kind, i) => {
      const info: FaceInfo = { kind: SURFACE_KINDS[kind] ?? 'other', area: raw.faceAreas[i] ?? 0 };
      const radius = raw.faceRadii[i];
      if (radius !== undefined && !Number.isNaN(radius)) info.radius = radius;
      const plane = Array.from(raw.facePlanes.subarray(i * 6, i * 6 + 6));
      if (plane.length === 6 && plane.every(Number.isFinite)) {
        info.plane = { point: [plane[0], plane[1], plane[2]] as Vec3, normal: [plane[3], plane[4], plane[5]] as Vec3 };
      }
      return info;
    });
    const edgeInfo: EdgeInfo[] = Array.from(raw.edgeKinds, (kind, i) => {
      const info: EdgeInfo = { kind: CURVE_KINDS[kind] ?? 'other', length: raw.edgeLengths[i] ?? 0 };
      const radius = raw.edgeRadii[i];
      if (radius !== undefined && !Number.isNaN(radius)) info.radius = radius;
      const g = Array.from(raw.edgeGeometry.subarray(i * 12, i * 12 + 12));
      const vec = (k: number): Vec3 | null => (g.slice(k, k + 3).every(Number.isFinite) ? (g.slice(k, k + 3) as Vec3) : null);
      const [start, end, center, axis] = [vec(0), vec(3), vec(6), vec(9)];
      if (start && end) {
        info.start = start;
        info.end = end;
      }
      if (center && axis) {
        info.center = center;
        info.axis = axis;
      }
      return info;
    });
    return {
      key,
      naming: this.naming(handle),
      positions: raw.positions,
      normals: raw.normals,
      indices: raw.indices,
      faceRanges: raw.faceRanges,
      edgePositions: raw.edgePositions,
      edgeRanges: raw.edgeRanges,
      faceInfo,
      edgeInfo,
    };
  }

  exportMesh(handle: ShapeHandle, quality: MeshQuality) {
    const raw = check(this.kernel.exportMesh(this.id(handle), quality.linear, quality.angular) as RawMesh | Failure);
    return { positions: raw.positions, indices: raw.indices };
  }

  exportStep(handle: ShapeHandle): Uint8Array {
    return check(this.kernel.exportStep(this.id(handle)) as { ok: true; data: Uint8Array } | Failure).data;
  }

  importStep(bytes: Uint8Array): ShapeHandle {
    const result = this.kernel.importStep(bytes) as IdResult;
    if (!result.ok) throw new KernelCallError(result.message);
    return result.id as unknown as ShapeHandle;
  }

  heapBytes(): number {
    return this.kernel.wasmMemory.buffer.byteLength;
  }

  describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
