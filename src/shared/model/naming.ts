/**
 * Persistent naming of faces and edges (docs/adr/0002-persistent-naming.md).
 *
 * The kernel names every face after the feature and the role that made it ("<feature id>:top",
 * "<feature id>:side:l3", ...); booleans, fillets and chamfers pass the names of the faces they modify
 * on. An edge is referenced by the names of the faces on both sides plus the point where it was.
 */

import type { EdgeNameRef, EdgeRef, Vec3 } from './feature.ts';
import type { FaceNameRef, VertexNameRef } from './reference.ts';
import type { SketchFrame } from './sketch.ts';

/** Face names of one body and where its edges lie; index i is topological face or edge index i. */
export interface BodyNaming {
  /** One name per face; '' when unknown (imported bodies). */
  faces: string[];
  /** Per face: a point on its plane and the outward unit normal (NaN for faces that are not planar). */
  facePlanes: Float64Array;
  /** Per edge: the indices of the faces on both sides (the same face twice for a seam, -1 when none). */
  edgeFaces: Int32Array;
  /** Per edge: the point in the middle of its curve (NaN for degenerate edges). */
  edgeMidpoints: Float64Array;
  /** Per edge: the vertex indices at its start and end (-1 when none). */
  edgeVertices: Int32Array;
  /** Per vertex: its position. */
  vertexPositions: Float64Array;
  /** Vertex v meets the faces vertexFaces[vertexFaceOffsets[v] .. vertexFaceOffsets[v + 1]). */
  vertexFaceOffsets: Int32Array;
  vertexFaces: Int32Array;
}

/** How a reference found its edge: by face names, by position only (its faces were renamed) or by index. */
export type EdgeMatchKind = 'name' | 'position' | 'index';

export interface EdgeMatch {
  index: number;
  kind: EdgeMatchKind;
}

/**
 * How far (relative to the size of the body) an edge may have moved and still be found by position:
 * with one of its faces renamed, and with both renamed (then it must practically be in the same place).
 */
const NEARBY = 0.05;
const SAME_PLACE = 1e-4;

export function edgeCount(naming: BodyNaming): number {
  return naming.edgeFaces.length / 2;
}

function midpoint(naming: BodyNaming, edge: number): Vec3 {
  return [naming.edgeMidpoints[3 * edge] ?? NaN, naming.edgeMidpoints[3 * edge + 1] ?? NaN, naming.edgeMidpoints[3 * edge + 2] ?? NaN];
}

function faceNameOf(naming: BodyNaming, face: number): string {
  return face < 0 ? '' : (naming.faces[face] ?? '');
}

/** The names of the faces on both sides of an edge, sorted. */
export function edgeFaceNames(naming: BodyNaming, edge: number): [string, string] {
  const a = faceNameOf(naming, naming.edgeFaces[2 * edge] ?? -1);
  const b = faceNameOf(naming, naming.edgeFaces[2 * edge + 1] ?? -1);
  return a <= b ? [a, b] : [b, a];
}

/** A persistent reference to edge `index` of the body; null for degenerate or missing edges. */
export function edgeRefOf(naming: BodyNaming, index: number): EdgeNameRef | null {
  if (!Number.isInteger(index) || index < 0 || index >= edgeCount(naming)) return null;
  const at = midpoint(naming, index);
  if (!at.every(Number.isFinite)) return null;
  return { kind: 'edge', faces: edgeFaceNames(naming, index), at };
}

const pairKey = (faces: readonly [string, string]) => `${faces[0]}\u0000${faces[1]}`;

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/** The diagonal of the box around the edge midpoints (at least 1 mm): the scale for position tolerances. */
function bodySize(naming: BodyNaming): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let edge = 0; edge < edgeCount(naming); edge++) {
    const at = midpoint(naming, edge);
    if (!at.every(Number.isFinite)) continue;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, at[k] as number);
      max[k] = Math.max(max[k] as number, at[k] as number);
    }
  }
  return Math.max(min.every(Number.isFinite) ? distance(min, max) : 0, 1);
}

function add(map: Map<string, number[]>, key: string, edge: number): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

/** Lookup structures for resolving several references against one body. */
class EdgeIndex {
  readonly naming: BodyNaming;
  readonly count: number;
  readonly byFaces = new Map<string, number[]>();
  readonly byFace = new Map<string, number[]>();
  readonly size: number;

  constructor(naming: BodyNaming) {
    this.naming = naming;
    this.count = edgeCount(naming);
    for (let edge = 0; edge < this.count; edge++) {
      if (!midpoint(naming, edge).every(Number.isFinite)) continue;
      const faces = edgeFaceNames(naming, edge);
      add(this.byFaces, pairKey(faces), edge);
      if (faces[0] !== '') add(this.byFace, faces[0], edge);
      if (faces[1] !== '' && faces[1] !== faces[0]) add(this.byFace, faces[1], edge);
    }
    this.size = bodySize(naming);
  }

  /** The candidate whose middle is nearest to `at`, if it is within `limit`. */
  nearest(candidates: Iterable<number>, at: Vec3, limit = Infinity): number | null {
    let best: number | null = null;
    let bestDistance = limit;
    for (const edge of candidates) {
      const d = distance(midpoint(this.naming, edge), at);
      if (d <= bestDistance) {
        best = edge;
        bestDistance = d;
      }
    }
    return best;
  }

  resolve(ref: EdgeRef): EdgeMatch | null {
    if (ref.kind === 'edge-index') return ref.index < this.count ? { index: ref.index, kind: 'index' } : null;
    const named = this.byFaces.get(pairKey(ref.faces));
    if (named) {
      const index = this.nearest(named, ref.at);
      return index === null ? null : { index, kind: 'name' };
    }
    const present = ref.faces.filter((name) => name !== '' && this.byFace.has(name));
    // Both faces are still there but no longer meet: the edge is gone.
    if (present.length === 2 && ref.faces[0] !== ref.faces[1]) return null;
    const near = present.length > 0 ? this.nearest(this.byFace.get(present[0] as string) ?? [], ref.at, NEARBY * this.size) : null;
    const index = near ?? this.nearest(Array.from({ length: this.count }, (_, i) => i), ref.at, SAME_PLACE * this.size);
    return index === null ? null : { index, kind: 'position' };
  }
}

/** Finds the edges that references mean in a body; null for each reference whose edge is gone. */
export function resolveEdgeRefs(refs: readonly EdgeRef[], naming: BodyNaming): (EdgeMatch | null)[] {
  if (refs.length === 0) return [];
  const index = new EdgeIndex(naming);
  return refs.map((ref) => index.resolve(ref));
}

/** Naming of a body whose kernel does not track names: its edges can only be referenced by index. */
export function anonymousNaming(faces: number, edges: number): BodyNaming {
  return {
    faces: Array.from({ length: faces }, () => ''),
    facePlanes: new Float64Array(6 * faces).fill(NaN),
    edgeFaces: new Int32Array(2 * edges).fill(-1),
    edgeMidpoints: new Float64Array(3 * edges).fill(NaN),
    edgeVertices: new Int32Array(2 * edges).fill(-1),
    vertexPositions: new Float64Array(0),
    vertexFaceOffsets: new Int32Array(1),
    vertexFaces: new Int32Array(0),
  };
}

export function vertexCount(naming: BodyNaming): number {
  return naming.vertexPositions.length / 3;
}

export function vertexPosition(naming: BodyNaming, vertex: number): Vec3 {
  return [naming.vertexPositions[3 * vertex] ?? NaN, naming.vertexPositions[3 * vertex + 1] ?? NaN, naming.vertexPositions[3 * vertex + 2] ?? NaN];
}

/** The names of the faces that meet at a vertex, sorted. */
export function vertexFaceNames(naming: BodyNaming, vertex: number): string[] {
  const from = naming.vertexFaceOffsets[vertex] ?? 0;
  const to = naming.vertexFaceOffsets[vertex + 1] ?? from;
  return Array.from(naming.vertexFaces.subarray(from, to), (face) => faceNameOf(naming, face)).sort();
}

/** A persistent reference to vertex `index` of the body. */
export function vertexRefOf(naming: BodyNaming, index: number): VertexNameRef | null {
  if (!Number.isInteger(index) || index < 0 || index >= vertexCount(naming)) return null;
  return { kind: 'vertex', faces: vertexFaceNames(naming, index), at: vertexPosition(naming, index) };
}

/** A persistent reference to face `index` of the body, picked at `at`; null for faces without a name. */
export function faceRefOf(naming: BodyNaming, index: number, at: Vec3): FaceNameRef | null {
  const name = naming.faces[index];
  return name ? { kind: 'face', name, at } : null;
}

/**
 * The vertex a reference means: the one where faces with the same names meet (the nearest, if there are
 * several), else – when some of the faces were renamed – the nearest vertex that still has two of them
 * within 5 % of the body size, else a vertex in practically the same place.
 */
export function resolveVertexRef(ref: VertexNameRef, naming: BodyNaming): EdgeMatch | null {
  const count = vertexCount(naming);
  const key = ref.faces.join('\u0000');
  const all = Array.from({ length: count }, (_, v) => v);
  const nearest = (candidates: number[], limit = Infinity): number | null => {
    let best: number | null = null;
    let bestDistance = limit;
    for (const v of candidates) {
      const d = distance(vertexPosition(naming, v), ref.at);
      if (d <= bestDistance) {
        best = v;
        bestDistance = d;
      }
    }
    return best;
  };
  const named = all.filter((v) => vertexFaceNames(naming, v).join('\u0000') === key);
  const exact = nearest(named);
  if (exact !== null) return { index: exact, kind: 'name' };
  const size = bodySize(naming);
  const wanted = new Set(ref.faces.filter((name) => name !== ''));
  const sharing = all.filter((v) => vertexFaceNames(naming, v).filter((name) => wanted.has(name)).length >= 2);
  const index = nearest(sharing, NEARBY * size) ?? nearest(all, SAME_PLACE * size);
  return index === null ? null : { index, kind: 'position' };
}

/**
 * The face a reference means: the face with its name (when a split face left several pieces, the one
 * `distanceTo` says is nearest to where it was picked), else – when it was renamed – a planar face whose
 * plane goes through that point.
 */
export function resolveFaceRef(ref: FaceNameRef, naming: BodyNaming, distanceTo: (face: number, point: Vec3) => number): EdgeMatch | null {
  const nearest = (faces: number[]) => faces.reduce((a, b) => (distanceTo(b, ref.at) < distanceTo(a, ref.at) ? b : a));
  const named = naming.faces.flatMap((name, face) => (name === ref.name ? [face] : []));
  if (named.length > 0) return { index: named.length === 1 ? (named[0] as number) : nearest(named), kind: 'name' };
  const size = bodySize(naming);
  const through = naming.faces.flatMap((_, face) => {
    const plane = facePlane(naming, face);
    const offset = plane ? Math.abs(dot([ref.at[0] - plane.point[0], ref.at[1] - plane.point[1], ref.at[2] - plane.point[2]], plane.normal)) : Infinity;
    return offset <= SAME_PLACE * size ? [face] : [];
  });
  return through.length > 0 ? { index: nearest(through), kind: 'position' } : null;
}

/** A planar face of a body: its index and name, and a point on its plane with the outward normal. */
export interface FacePlane {
  index: number;
  name: string;
  point: Vec3;
  normal: Vec3;
  /** Found by name, or (when its name changed or was never stored) by lying in the same plane. */
  kind: 'name' | 'position';
}

function facePlane(naming: BodyNaming, face: number): Omit<FacePlane, 'kind'> | null {
  const values = Array.from(naming.facePlanes.subarray(6 * face, 6 * face + 6));
  if (values.length !== 6 || !values.every(Number.isFinite)) return null;
  return { index: face, name: naming.faces[face] ?? '', point: values.slice(0, 3) as Vec3, normal: values.slice(3, 6) as Vec3 };
}

const dot = (a: readonly number[], b: readonly number[]) => (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

/**
 * The planar face a sketch lies on: the face with its name (the one turned most like the plane where the
 * sketch was, then the nearest), else a face in the same plane as the sketch, facing the same way.
 */
export function resolveFacePlane(name: string | undefined, frame: SketchFrame, naming: BodyNaming): FacePlane | null {
  const faces = Array.from({ length: naming.faces.length }, (_, face) => facePlane(naming, face)).filter((face) => face !== null);
  const offset = (face: Omit<FacePlane, 'kind'>) => Math.abs(dot([face.point[0] - frame.origin[0], face.point[1] - frame.origin[1], face.point[2] - frame.origin[2]], face.normal));
  if (name) {
    const named = faces.filter((face) => face.name === name);
    named.sort((a, b) => dot(b.normal, frame.normal) - dot(a.normal, frame.normal) || offset(a) - offset(b));
    if (named[0]) return { ...named[0], kind: 'name' };
  }
  const size = bodySize(naming);
  const same = faces.find((face) => dot(face.normal, frame.normal) > 1 - 1e-9 && offset(face) <= SAME_PLACE * size);
  return same ? { ...same, kind: 'position' } : null;
}
